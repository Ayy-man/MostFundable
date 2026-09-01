import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ADMIN_AUDIT_MAX_LIMIT } from "./audit-types.ts";
import { createAuditRepository } from "./audit-repository.ts";

const EVENT_ID = "21000000-0000-4000-8000-000000000001";
const SUBJECT_ID = "21000000-0000-4000-8000-000000000002";
const ACTOR_ID = "21000000-0000-4000-8000-000000000003";

type Call = {
  filters: string[];
  projection: string;
  table: string;
};

function fakeClient(
  tables: Record<string, unknown[]>,
  calls: Call[],
  errors: Partial<Record<string, unknown>> = {},
) {
  return {
    from(table: string) {
      return {
        select(projection: string) {
          const call: Call = { filters: [], projection, table };
          calls.push(call);
          return {
            in(column: string, values: readonly string[]) {
              call.filters.push(`in:${column}:${values.join("|")}`);
              return this;
            },
            limit(value: number) {
              call.filters.push(`limit:${value}`);
              return this;
            },
            order(column: string, options: { ascending: boolean }) {
              call.filters.push(`order:${column}:${options.ascending ? "asc" : "desc"}`);
              return this;
            },
            then<T>(resolve: (payload: { data: unknown[] | null; error: unknown }) => T) {
              return Promise.resolve(resolve({
                data: errors[table] ? null : tables[table] ?? [],
                error: errors[table] ?? null,
              }));
            },
          };
        },
      };
    },
  };
}

const AUDIT_ROW = {
  id: EVENT_ID,
  actor_profile_id: ACTOR_ID,
  action: "org.lifecycle_changed",
  subject_type: "org",
  subject_id: SUBJECT_ID,
  occurred_at: "2026-08-31T14:38:59.421586+00:00",
  // A realistic source row may carry metadata, but the projection and mapped
  // response must make it impossible for this value to cross the boundary.
  meta: { internal: "do-not-return" },
};

describe("admin audit repository", () => {
  it("uses a bounded newest-first projection and resolves display names without email", async () => {
    const calls: Call[] = [];
    const repository = createAuditRepository(() => fakeClient({
      audit_log: [AUDIT_ROW],
      profiles: [{ id: ACTOR_ID, full_name: "  Ada Admin  ", email: "private@example.test" }],
    }, calls));

    assert.deepEqual(await repository.list(25), [{
      action: "org.lifecycle_changed",
      actorName: "Ada Admin",
      id: EVENT_ID,
      occurredAt: "2026-08-31T14:38:59.421586+00:00",
      subjectId: SUBJECT_ID,
      subjectType: "org",
    }]);

    const audit = calls.find((call) => call.table === "audit_log");
    assert.equal(audit?.projection, "id, action, subject_type, subject_id, occurred_at, actor_profile_id");
    assert.deepEqual(audit?.filters, [
      "order:occurred_at:desc",
      "order:id:desc",
      "limit:25",
    ]);
    assert.doesNotMatch(audit?.projection ?? "", /meta|email/i);

    const profiles = calls.find((call) => call.table === "profiles");
    assert.equal(profiles?.projection, "id, full_name");
    assert.deepEqual(profiles?.filters, [`in:id:${ACTOR_ID}`]);
    assert.doesNotMatch(profiles?.projection ?? "", /email/i);
  });

  it("does not query profiles for actor-free events or invent an actor", async () => {
    const calls: Call[] = [];
    const repository = createAuditRepository(() => fakeClient({
      audit_log: [{ ...AUDIT_ROW, actor_profile_id: null }],
    }, calls));
    const [event] = await repository.list();
    assert.equal(event.actorName, null);
    assert.equal(calls.some((call) => call.table === "profiles"), false);
  });

  it("returns an unknown actor when the referenced profile has no display name", async () => {
    const repository = createAuditRepository(() => fakeClient({
      audit_log: [AUDIT_ROW],
      profiles: [{ id: ACTOR_ID, full_name: "" }],
    }, []));
    const [event] = await repository.list();
    assert.equal(event.actorName, null);
  });

  it("rejects limits outside the hard bound before creating a database client", async () => {
    let clients = 0;
    const repository = createAuditRepository(() => { clients += 1; return fakeClient({}, []); });
    await assert.rejects(() => repository.list(0), /ADMIN_AUDIT_LIMIT_INVALID/);
    await assert.rejects(() => repository.list(ADMIN_AUDIT_MAX_LIMIT + 1), /ADMIN_AUDIT_LIMIT_INVALID/);
    assert.equal(clients, 0);
  });

  it("fails closed on unreadable or malformed source rows", async () => {
    const readFailure = createAuditRepository(() => fakeClient({}, [], { audit_log: new Error("down") }));
    await assert.rejects(() => readFailure.list(), /ADMIN_AUDIT_READ_FAILED/);

    const malformed = createAuditRepository(() => fakeClient({
      audit_log: [{ ...AUDIT_ROW, subject_id: "not-a-uuid" }],
    }, []));
    await assert.rejects(() => malformed.list(), /ADMIN_AUDIT_ROW_INVALID/);
  });

  it("fails rather than dropping actor-resolution errors", async () => {
    const repository = createAuditRepository(() => fakeClient(
      { audit_log: [AUDIT_ROW] },
      [],
      { profiles: new Error("down") },
    ));
    await assert.rejects(() => repository.list(), /ADMIN_AUDIT_ACTORS_FAILED/);
  });
});
