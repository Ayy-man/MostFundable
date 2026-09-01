import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const operatorPath = new URL("./operator.tsx", import.meta.url);

async function operatorSource() {
  return readFile(operatorPath, "utf8");
}

function section(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing operator section ${start}`);
  return source.slice(from, to);
}

describe("Drop 7 operator workflow", () => {
  it("routes Client Fees to the existing fee renderer", async () => {
    const source = await operatorSource();
    const clientsView = section(source, "function renderClients()", "async function createPersistedTrackerClient");
    assert.match(source, /type ClientsTab = "tracker" \| "client-fees" \| "platform-rev"/);
    assert.match(clientsView, /label: "Client Fees", value: "client-fees"/);
    assert.match(clientsView, /clientsTab === "client-fees"[\s\S]*?renderFees\(\)/);
    assert.doesNotMatch(clientsView, /Receivables|receivables/);
  });

  it("keeps task links optional and persists the signed-in task workflow", async () => {
    const source = await operatorSource();
    const typeahead = section(source, "function TaskClientTypeahead", "const TEAM_ROWS");
    const tasks = section(source, "function renderTasks()", "function renderPlatformSupport()");
    // Re-pinned 2026-08-22 (fixture eviction, LANE A): the typeahead takes its
    // candidates as a prop now, so its option field is `id` rather than the
    // fixture book's `clientId`. Same property — the selection is by stable id
    // and "no client" is a real option — asserted against the new field name.
    assert.match(typeahead, /client\?\.id \?\? null/);
    assert.match(typeahead, /clients: readonly TaskClientOption\[\]/);
    assert.match(typeahead, /Search client or business/);
    assert.match(typeahead, /role="combobox"/);
    assert.match(typeahead, /role="listbox"/);
    assert.match(typeahead, /event\.key === "Escape"/);
    assert.match(typeahead, /event\.key === "Enter"/);
    assert.match(typeahead, /client\?\.name \?\? "No client"/);
    assert.match(tasks, /createTask\(\{/);
    assert.match(tasks, /assigneeProfileId: newTaskAssigneeId/);
    assert.match(tasks, /clientId: newTaskClientId/);
    assert.match(tasks, /setNewTaskClientId\(null\)/);
    assert.match(tasks, /updateTask\(task\.id, \{/);
    assert.match(tasks, /clientId: draft\.clientId/);
    assert.match(tasks, /removeTask\(task\.id\)/);
    assert.match(tasks, /Save task/);
    assert.match(tasks, /Open \{linkedClient\.name\}[\s\S]*?profile/);
    assert.doesNotMatch(tasks, /this visit|task records are not stored|persistence is not connected/i);
  });

  it("drafts assignments, sorts selected clients first and applies them only on Save", async () => {
    const source = await operatorSource();
    const team = section(source, "function renderTeam()", "async function chooseBrandAccent");
    assert.match(team, /setClientAssignmentDraft\(new Set\(/);
    assert.match(team, /Number\(clientAssignmentDraft\.has\(right\.clientId\)\) - Number\(clientAssignmentDraft\.has\(left\.clientId\)\)/);
    assert.match(team, /max-h-72[^"]*overflow-y-auto/);
    assert.match(team, /aria-label="Search clients to assign"/);
    assert.match(team, /setClientAssignmentDraft\(\(current\)/);
    assert.match(team, /setClientOwnerOverrides\(\(current\)/);
    assert.match(team, />Save assignments</);
    // Re-pinned 2026-08-22: the dismiss button reads "Close" on a signed-in
    // workspace, where there is nothing to cancel — the assignment grid it
    // saved was the fixture book. Both labels come off `closeTeamMember`.
    assert.match(team, /onClick=\{closeTeamMember\}[\s\S]*?(Close|Cancel)/);
    assert.match(team, /TODO\(#191: referent inferred — confirm which control Alec meant\)/);
    assert.match(team, /aria-label=\{`Manage \$\{member\.name\}`\}/);
    assert.match(team, /className="min-h-11"/);
  });

  it("has one Platform support destination with drafts inside the current composer", async () => {
    const source = await operatorSource();
    assert.doesNotMatch(source, /Held replies|held-replies|renderReview/i);
    assert.match(source, /aria-label="Open Platform support"/);
    assert.match(source, /supportState === "ready" \? \([\s\S]*?<SupportBubblePanel \/>[\s\S]*?supportState === "disabled" \? \([\s\S]*?renderPlatformSupport\(\)/);
    assert.match(source, /title="Current conversation"/);
    assert.match(source, /<SupportThreadView/);
    assert.match(source, /status: "draft"/);
    assert.match(source, /Reply copied into the local composer\. Nothing was sent\./);
    assert.match(source, /Support is unavailable right now\. No message can be submitted until it reconnects\./);
  });
});
