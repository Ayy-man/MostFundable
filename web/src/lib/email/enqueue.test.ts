import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createOperatorCardFailureEmailRepository,
  enqueueOperatorCardFailureEmail,
  type OperatorCardFailureEmailRepository,
  type OperatorCardFailureRpcClient,
} from "@/lib/email/enqueue";

const ORG_ID = "70000000-0000-4000-8000-0000000000aa";
const EVENT_ID = "evt_email_enqueue_01";

describe("email enqueue", () => {
  for (const value of [undefined, "", "junk", "0", "false"]) {
    it(`does not construct or call the repository when FEATURE_EMAIL is ${String(value)}`, async () => {
      let calls = 0;
      const repository: OperatorCardFailureEmailRepository = {
        async enqueue() {
          calls += 1;
          throw new Error("must not be called");
        },
      };

      const result = await enqueueOperatorCardFailureEmail(
        { orgId: ORG_ID, eventId: EVENT_ID },
        { env: { FEATURE_EMAIL: value }, repository },
      );

      assert.equal(result, null);
      assert.equal(calls, 0);
    });
  }

  it("rejects invalid source identifiers before a repository call", async () => {
    let calls = 0;
    const repository: OperatorCardFailureEmailRepository = {
      async enqueue() {
        calls += 1;
        return { deliveryId: ORG_ID, inserted: true };
      },
    };

    await assert.rejects(
      enqueueOperatorCardFailureEmail(
        { orgId: "not-an-org", eventId: EVENT_ID },
        { env: { FEATURE_EMAIL: "true" }, repository },
      ),
      /ORG_ID_INVALID/,
    );
    await assert.rejects(
      enqueueOperatorCardFailureEmail(
        { orgId: ORG_ID, eventId: "event id with spaces" },
        { env: { FEATURE_EMAIL: "true" }, repository },
      ),
      /EVENT_ID_INVALID/,
    );
    assert.equal(calls, 0);
  });

  it("maps the exact RPC parameters and inserted result", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = [];
    const client: OperatorCardFailureRpcClient = {
      async rpc(name, args) {
        calls.push({ name, args });
        return {
          data: [{ delivery_id: "70000000-0000-4000-8000-0000000000bb", inserted: true }],
          error: null,
        };
      },
    };

    const result = await enqueueOperatorCardFailureEmail(
      { orgId: ORG_ID, eventId: EVENT_ID },
      {
        env: { FEATURE_EMAIL: "on" },
        repository: createOperatorCardFailureEmailRepository(client),
      },
    );

    assert.deepEqual(calls, [{
      name: "enqueue_operator_card_failure_email",
      args: { p_billing_event_id: EVENT_ID, p_org_id: ORG_ID },
    }]);
    assert.deepEqual(result, {
      deliveryId: "70000000-0000-4000-8000-0000000000bb",
      inserted: true,
    });
  });

  it("returns an idempotent duplicate as a successful inserted-false result", async () => {
    let calls = 0;
    const result = await enqueueOperatorCardFailureEmail(
      { orgId: ORG_ID, eventId: EVENT_ID },
      {
        env: { FEATURE_EMAIL: "yes" },
        repository: {
          async enqueue() {
            calls += 1;
            return { deliveryId: "70000000-0000-4000-8000-0000000000bb", inserted: false };
          },
        },
      },
    );

    assert.equal(calls, 1);
    assert.deepEqual(result, {
      deliveryId: "70000000-0000-4000-8000-0000000000bb",
      inserted: false,
    });
  });
});
