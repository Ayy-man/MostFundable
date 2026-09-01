import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { beginEnrollment } from "./repository.ts";

const INPUT = {
  actorId: "10000000-0000-4000-8000-000000000001",
  affiliateReferralSlug: undefined,
  agreementVersion: "agreement-v1",
  analysisVersion: "analysis-v1",
  clientId: "10000000-0000-4000-8000-000000000002",
  draftId: "10000000-0000-4000-8000-000000000003",
  ip: "127.0.0.1",
  monitoringVersion: "monitoring-v1",
  signerName: "Jordan Newcomer Demo",
  typedSignature: "Jordan Newcomer Demo",
  userAgent: "test",
};

describe("begin enrollment replay", () => {
  it("recovers the client's durable enrollment after a new draft collides", async () => {
    const calls: Array<[string, unknown]> = [];
    const query = {
      eq(column: string, value: string) {
        calls.push([column, value]);
        return query;
      },
      async maybeSingle() {
        return {
          data: {
            esig_doc_id: "10000000-0000-4000-8000-000000000004",
            id: "10000000-0000-4000-8000-000000000005",
          },
          error: null,
        };
      },
      select(columns: string) {
        calls.push(["select", columns]);
        return query;
      },
    };
    const client = {
      from(table: string) {
        calls.push(["from", table]);
        return query;
      },
      async rpc() {
        return { data: null, error: { code: "23505" } };
      },
    };

    const result = await beginEnrollment(INPUT, client as never);

    assert.deepEqual(result, {
      ok: true,
      value: {
        enrollmentId: "10000000-0000-4000-8000-000000000005",
        esignatureId: "10000000-0000-4000-8000-000000000004",
      },
    });
    assert.deepEqual(calls, [
      ["from", "enrollments"],
      ["select", "id, esig_doc_id"],
      ["client_id", INPUT.clientId],
    ]);
  });

  it("preserves the conflict when no enrollment exists for that client", async () => {
    const query = {
      eq() { return query; },
      async maybeSingle() { return { data: null, error: null }; },
      select() { return query; },
    };
    const client = {
      from() { return query; },
      async rpc() { return { data: null, error: { code: "23505" } }; },
    };

    const result = await beginEnrollment(INPUT, client as never);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "conflict");
      assert.equal(result.error.message, "The requested record already exists.");
    }
  });
});
