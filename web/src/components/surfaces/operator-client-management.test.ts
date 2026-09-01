import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const surface = readFileSync(new URL("./operator.tsx", import.meta.url), "utf8");
const route = readFileSync(
  new URL("../../app/api/clients/[id]/route.ts", import.meta.url),
  "utf8",
);
const repository = readFileSync(
  new URL("../../lib/tracker/read.server.ts", import.meta.url),
  "utf8",
);
const realtime = readFileSync(
  new URL("../../lib/tracker/realtime.client.ts", import.meta.url),
  "utf8",
);

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing source section: ${start}`);
  return source.slice(from, to);
}

describe("durable operator client lifecycle", () => {
  it("edits identity and assignment through the tenant-scoped PATCH then re-reads", () => {
    const save = section(
      surface,
      "async function saveTrackerClientEdit()",
      "async function confirmTrackerStatusChange()",
    );
    assert.match(save, /patchOperatorTrackerClient\(draft\.id/);
    assert.match(save, /displayName,/);
    assert.match(save, /businessName: draft\.businessName\.trim\(\) \|\| null/);
    assert.match(save, /assignmentChanged \? \{ assignedToId: draft\.assignedToId \}/);
    assert.match(save, /await refreshTrackerAfterMutation/);

    const serverWrite = section(
      repository,
      "export async function updateTrackerClientMetadata",
      "async function mutationReadbackClient",
    );
    assert.match(serverWrite, /const before = await readTrackerClient\(session, clientId\)/);
    assert.match(serverWrite, /\.eq\("org_id", session\.orgId\)/);
    assert.match(serverWrite, /\.is\("disabled_at", null\)/);
    assert.match(serverWrite, /update\.display_name = patch\.displayName/);
    assert.match(serverWrite, /update\.business_name = patch\.businessName/);
    assert.match(serverWrite, /update\.assigned_to = patch\.assignedToId/);
    assert.match(serverWrite, /\.update\(update, \{ count: "exact" \}\)/);
    assert.match(serverWrite, /\.eq\("status", "active"\)/);
    assert.match(serverWrite, /if \(count !== 1\) return null/);
    assert.match(route, /assignee_unavailable/);
  });

  it("offers only the server-proven active same-workspace roster for reassignment", () => {
    const peek = section(
      surface,
      "{/* Durable tracker client peek",
      "{/* End durable tracker client peek. */}",
    );
    assert.match(peek, /trackerClients\.assignableMembers\.map/);
    assert.match(peek, /member\.isCurrentUser/);
    assert.match(peek, /Assign client to team member/);
    assert.match(realtime, /member\.active === true/);
    assert.match(realtime, /isTrackerAssigneeOrgRole\(member\.orgRole\)/);
  });

  it("archives and reactivates through the governed status route with confirmation", () => {
    const status = section(
      surface,
      "async function confirmTrackerStatusChange()",
      "async function runTrackerBulkMutation",
    );
    assert.match(status, /patchOperatorTrackerClient\(candidate\.id, \{ status: candidate\.status \}\)/);
    assert.match(status, /await refreshTrackerAfterMutation/);
    assert.match(surface, /Archive client/);
    assert.match(surface, /Reactivate client/);
    assert.match(surface, /record and history stay stored/);
    assert.match(route, /setTrackerClientStatus\(session, id, parsed\.value\.status\)/);
  });

  it("keeps bulk writes active-only, confirmed, sequential, and server-read back", () => {
    const bulk = section(
      surface,
      "async function runTrackerBulkMutation",
      "function renderPersistedClientsTracker()",
    );
    assert.match(bulk, /for \(const id of input\.ids\)/);
    assert.match(bulk, /await patchOperatorTrackerClient\(id, input\.patch\)/);
    assert.match(bulk, /failure = trackerMutationMessage\(error\);[\s\S]*?break;/);
    assert.match(bulk, /await trackerClients\.refetch\(\)/);

    const tracker = section(
      surface,
      "function renderPersistedClientsTracker()",
      "function renderClientsTracker()",
    );
    assert.match(tracker, /allSelectedTrackerClientsActive/);
    assert.match(tracker, /Assign selected/);
    assert.match(tracker, /Archive selected/);
    assert.match(tracker, /Confirm assignment/);
    assert.match(tracker, /Archive clients/);
  });
});

describe("restorable filters and conservative export", () => {
  it("restores and rewrites every tracker view choice in the URL", () => {
    for (const key of [
      "clients_q",
      "clients_stage",
      "clients_member",
      "clients_affiliate",
      "clients_status",
      "clients_view",
    ]) {
      assert.match(surface, new RegExp(`params\\.get\\("${key}"\\)`));
      assert.match(surface, new RegExp(`\\["${key}",`));
    }
    assert.match(surface, /window\.history\.replaceState/);
    assert.match(realtime, /params\.set\("status", filters\.status\)/);
  });

  it("exports the selected rows or the current filtered rows and neutralizes formulas", () => {
    const csv = section(surface, "function csvCell", "function localDateOnly");
    assert.match(csv, /\[\\t\\r\]/);
    assert.match(csv, /\\s\*\[=\+\\-@\]/);
    assert.match(csv, /safe\.replaceAll\('"', '""'\)/);
    assert.match(csv, /text\/csv;charset=utf-8/);
    assert.match(csv, /mostfundable-clients-/);

    const tracker = section(
      surface,
      "function renderPersistedClientsTracker()",
      "function renderClientsTracker()",
    );
    assert.match(tracker, /selectedTrackerClients\.length > 0[\s\S]*?selectedTrackerClients[\s\S]*?: filteredTrackerClients/);
    assert.match(tracker, /downloadTrackerClientsCsv\(exportClients\)/);
  });

  it("keeps active as the default while archived and all are explicit", () => {
    assert.match(surface, /useState<[\s\S]*?TrackerClientStatus \| "all"[\s\S]*?>\("active"\)/);
    assert.match(surface, /Active clients/);
    assert.match(surface, /Archived clients/);
    assert.match(surface, /All statuses/);
    assert.match(repository, /filters\.status \?\? "active"/);
    assert.match(repository, /filters\.status !== "all"/);
  });
});
