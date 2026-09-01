import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ClientCapError, createClientCapService } from "./client-cap.ts";

function repository(value: { activeCount: number; clientCap: number | null } | null) {
  const raises: unknown[] = [];
  return {
    raises,
    service: createClientCapService({
      async read() { return { ok: true as const, value }; },
      async raise(input) {
        raises.push(input);
        return { ok: true as const, value: { applied: true, clientCap: input.cap, from: null, orgId: input.orgId } };
      },
    }),
  };
}

describe("client cap service", () => {
  it("allows uncapped and under-cap meters, including a zero count", async () => {
    assert.deepEqual(await repository({ activeCount: 9, clientCap: null }).service.assertClientCap("org"), { count: 9, cap: null });
    assert.deepEqual(await repository({ activeCount: 0, clientCap: 1 }).service.assertClientCap("org"), { count: 0, cap: 1 });
  });

  it("throws the one private typed error at zero or finite exhaustion", async () => {
    for (const meter of [{ activeCount: 0, clientCap: 0 }, { activeCount: 3, clientCap: 3 }]) {
      await assert.rejects(repository(meter).service.assertClientCap("org"), (error: unknown) =>
        error instanceof ClientCapError && error.code === "CLIENT_CAP_REACHED" && error.status === 409 && !error.message.includes("database"));
    }
  });

  it("rejects corrupt or absent repository results", async () => {
    await assert.rejects(repository(null).service.readClientCap("org"), /METER_UNAVAILABLE/);
  });

  it("raises only positive 32-bit integer caps", async () => {
    const { service, raises } = repository({ activeCount: 0, clientCap: null });
    for (const cap of [0, -1, 1.5, 2_147_483_648]) {
      await assert.rejects(service.raiseClientCap({ actorId: "actor", cap, orgId: "org" }), /CLIENT_CAP_INVALID/);
    }
    await service.raiseClientCap({ actorId: "actor", cap: 8, orgId: "org" });
    assert.deepEqual(raises, [{ actorId: "actor", cap: 8, orgId: "org" }]);
  });
});
