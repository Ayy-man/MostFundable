import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  readWorkspacePreferences,
  saveWorkspacePreferences,
  workspacePreferencesFromResponse,
  workspacePreferencesFromRow,
} from "./preferences.ts";
import {
  handlePortalPreferences,
  type PortalPreferencesDependencies,
} from "./preferences.server.ts";

const ORG = "00000000-0000-4000-8000-000000004101";
const row = {
  notification_client_messages: false,
  notification_digest_enabled: true,
  notification_digest_frequency: "weekly",
  notification_email_holds: true,
  notification_payment_failed: true,
  notification_task_due: true,
  portal_allow_document_uploads: false,
  portal_application_visibility: "status-only",
  portal_show_funding_progress: false,
  portal_show_trainings: true,
} as const;
const preferences = workspacePreferencesFromRow(row)!;

describe("workspace portal preference contract", () => {
  it("strictly projects the database row and refuses partial or unknown values", () => {
    assert.equal(preferences.portal.applicationVisibility, "status-only");
    assert.equal(preferences.portal.allowDocumentUploads, false);
    assert.equal(workspacePreferencesFromRow({ ...row, notification_digest_frequency: "sometimes" }), null);
    assert.equal(workspacePreferencesFromRow({ ...row, portal_show_trainings: undefined }), null);
  });

  it("parses the public response without accepting a malformed success", () => {
    assert.deepEqual(workspacePreferencesFromResponse({ preferences }), preferences);
    assert.equal(workspacePreferencesFromResponse({ preferences: { portal: preferences.portal } }), null);
  });

  it("reads with private same-origin semantics", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return Response.json({ preferences });
    }) as typeof fetch;
    assert.deepEqual(await readWorkspacePreferences(fetcher), preferences);
    assert.equal(String(calls[0]?.input), "/api/portal/preferences");
    assert.equal(calls[0]?.init?.credentials, "same-origin");
    assert.equal(calls[0]?.init?.cache, "no-store");
  });

  it("saves only the supplied allow-listed field and requires server readback", async () => {
    let sent: Record<string, unknown> | null = null;
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ org: row });
    }) as typeof fetch;
    assert.deepEqual(await saveWorkspacePreferences({ portal_allow_document_uploads: false }, fetcher), preferences);
    assert.deepEqual(sent, { portal_allow_document_uploads: false });
  });
});

describe("workspace portal preference route", () => {
  function dependencies(role = "consumer", orgId: string | null = ORG): PortalPreferencesDependencies {
    return {
      async read(scopedOrgId) {
        assert.equal(scopedOrgId, ORG);
        return preferences;
      },
      async requireSession() { return { id: "actor", orgId, role }; },
    };
  }

  it("returns only the caller workspace projection with private caching", async () => {
    const response = await handlePortalPreferences(dependencies());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { preferences });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  it("allows operators and refuses identities without a workspace", async () => {
    assert.equal((await handlePortalPreferences(dependencies("operator_member"))).status, 200);
    assert.equal((await handlePortalPreferences(dependencies("platform_admin", null))).status, 403);
  });
});
