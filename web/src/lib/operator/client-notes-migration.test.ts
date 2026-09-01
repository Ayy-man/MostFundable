import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const MIGRATION = readFileSync(
  new URL("../../../../supabase/migrations/430_operator_client_notes.sql", import.meta.url),
  "utf8",
);

describe("client notes database boundary", () => {
  it("applies the established per-client reach to both RLS and service-role RPCs", () => {
    assert.match(MIGRATION, /private\.can_access_client\(client_notes\.client_id\)/);
    assert.match(MIGRATION, /client_notes_actor_can_access_client/);
    assert.match(MIGRATION, /organization\.team_sees_all_clients/);
    assert.match(MIGRATION, /client\.assigned_to = actor\.id/);
    assert.match(MIGRATION, /managed\.id = any\(actor\.manages\)/);
    assert.match(MIGRATION, /raise exception using errcode = 'P0002', message = 'CLIENT_NOTES_NOT_FOUND'/);
  });

  it("serializes writes with privacy completion and keeps terminal records read-only", () => {
    assert.match(MIGRATION, /from public\.clients as client[\s\S]*?for update/);
    assert.match(MIGRATION, /request\.kind = 'deletion'/);
    assert.match(MIGRATION, /request\.status = 'completed'/);
    assert.match(MIGRATION, /CLIENT_NOTES_WRITE_BLOCKED/);
    assert.match(MIGRATION, /app\.privacy_erasure/);
    assert.match(MIGRATION, /privacy_requests_erase_client_notes/);
  });

  it("keeps create retries idempotent and refuses unattributed stale edits or deletes", () => {
    assert.match(MIGRATION, /request_id uuid not null/);
    assert.match(MIGRATION, /client_notes_org_request_key unique \(org_id, request_id\)/);
    assert.match(MIGRATION, /on conflict \(org_id, request_id\) do nothing/);
    assert.match(MIGRATION, /return private\.client_note_projection\(v_note\)/);
    assert.match(MIGRATION, /v_note\.body is not distinct from v_body/);
    assert.ok(
      MIGRATION.indexOf("v_note.updated_at is distinct from p_expected_updated_at")
        < MIGRATION.indexOf("v_note.body is not distinct from v_body"),
      "a same-body update must prove the current version before it is accepted as a no-op",
    );
    assert.match(
      MIGRATION,
      /if v_note\.deleted_at is not null then[\s\S]{0,500}CLIENT_NOTE_STALE/,
      "an operator tombstone alone cannot prove which request performed the deletion",
    );
  });

  it("enforces the same total live-note cap that the complete read declares", () => {
    assert.match(MIGRATION, /pg_catalog\.count\(\*\)[\s\S]*?>= 100/);
    assert.match(MIGRATION, /CLIENT_NOTE_LIMIT_REACHED/);
    assert.match(MIGRATION, /'live_limit', 100/);
    assert.match(MIGRATION, /pg_catalog\.jsonb_agg\(/);
    assert.doesNotMatch(MIGRATION, /limit p_limit/);
  });
});
