import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reauthorizeConsent } from "./repository.ts";

const INPUT = {
  actorId: "10000000-0000-4000-8000-000000000001",
  draftId: "10000000-0000-4000-8000-000000000002",
  enrollmentId: "10000000-0000-4000-8000-000000000003",
  ip: "127.0.0.1",
  kind: "analysis" as const,
  signerName: "Consumer Name",
  textVersion: "analysis-current",
  typedSignature: "Consumer Name",
  userAgent: "test",
};

describe("consent reauthorization repository", () => {
  it("calls the single signed-grant RPC and maps its durable result", async () => {
    let call: { name: string; args: Record<string, unknown> } | null = null;
    const client = {
      from() { throw new Error("the reauthorization repository uses no direct table write"); },
      async rpc(name: string, args: Record<string, unknown>) {
        call = { args, name };
        return {
          data: [{
            consent_id: "10000000-0000-4000-8000-000000000004",
            replayed: false,
            signed_at: "2026-09-01T00:00:00.000Z",
          }],
          error: null,
        };
      },
    };

    const result = await reauthorizeConsent(INPUT, client as never);

    assert.deepEqual(result, {
      ok: true,
      value: {
        consentId: "10000000-0000-4000-8000-000000000004",
        replayed: false,
        signedAt: "2026-09-01T00:00:00.000Z",
      },
    });
    assert.deepEqual(call, {
      name: "enrollment_reauthorize_consent",
      args: {
        p_actor_id: INPUT.actorId,
        p_draft_id: INPUT.draftId,
        p_enrollment_id: INPUT.enrollmentId,
        p_ip: INPUT.ip,
        p_kind: INPUT.kind,
        p_signer_name: INPUT.signerName,
        p_text_version: INPUT.textVersion,
        p_typed_signature: INPUT.typedSignature,
        p_user_agent: INPUT.userAgent,
      },
    });
  });

  it("fails closed when the RPC does not return signed evidence", async () => {
    const client = {
      from() { throw new Error("unused"); },
      async rpc() { return { data: [], error: null }; },
    };
    const result = await reauthorizeConsent(INPUT, client as never);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "unexpected");
  });
});
