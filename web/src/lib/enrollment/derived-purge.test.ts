import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listDerivedPurgeTargets, runDerivedPurge } from "./derived-purge.ts";

import type { BillingAdapter } from "@/lib/billing/types";
import type { CrsAdapter, CrsMemberRef } from "@/lib/crs/types";
import type { DerivedPurgeRepository } from "./derived-purge.ts";

const ENROLLMENT_ID = "26000000-0000-4000-8000-000000000301";
const CLIENT_ID = "26000000-0000-4000-8000-000000000201";
const MEMBER_REF = "mock_clean_r1d05" as CrsMemberRef;

/** No open billing obligation, which is every pre-R4C-07 fixture's shape. */
const NO_BILLING_INTENT = {
  async readPendingProviderCancel() { return null; },
  async completeProviderCancel() { throw new Error("unreachable"); },
};

function billing(events: string[], outcome: "confirmed" | "unavailable" = "confirmed"): Pick<BillingAdapter, "cancel"> {
  return {
    async cancel({ subscriptionRef }) {
      events.push(`billing_cancel:${subscriptionRef}`);
      if (outcome === "unavailable") throw new Error("provider unavailable");
      return { cancelledAt: "2026-08-17T00:00:00.000Z", status: "cancelled" as const, subscriptionRef };
    },
  };
}

function adapter(events: string[]): CrsAdapter {
  return {
    driver: "mock",
    async closeMember(ref) {
      events.push(`close:${ref}`);
      return { closedAt: "2026-08-17T00:00:00.000Z" };
    },
  } as CrsAdapter;
}

describe("derived enrollment purge", () => {
  it("closes the provider member before atomically purging the derived graph", async () => {
    const events: string[] = [];
    const repository: DerivedPurgeRepository = {
      ...NO_BILLING_INTENT,
      async listOutstanding() { throw new Error("unreachable"); },
      async readTarget() { return { clientId: CLIENT_ID, enrollmentId: ENROLLMENT_ID, memberRef: MEMBER_REF }; },
      async purge(enrollmentId, memberRef) {
        events.push(`purge:${enrollmentId}:${memberRef}`);
        return 7;
      },
    };
    assert.deepEqual(
      await runDerivedPurge(`enrollment:${ENROLLMENT_ID}`, "2026-08-17", {
        repository,
        getAdapter: () => adapter(events),
        getBilling: () => billing(events),
      }),
      { status: "ok", rows: 7 },
    );
    assert.deepEqual(events, [
      `close:${MEMBER_REF}`,
      `purge:${ENROLLMENT_ID}:${MEMBER_REF}`,
    ]);
  });

  it("is replay-safe and retries a database failure after provider close", async () => {
    const events: string[] = [];
    let fail = true;
    const repository: DerivedPurgeRepository = {
      ...NO_BILLING_INTENT,
      async listOutstanding() { throw new Error("unreachable"); },
      async readTarget() { return { clientId: CLIENT_ID, enrollmentId: ENROLLMENT_ID, memberRef: MEMBER_REF }; },
      async purge() {
        events.push("purge");
        if (fail) { fail = false; throw new Error("transient"); }
        return 1;
      },
    };
    const overrides = { repository, getAdapter: () => adapter(events), getBilling: () => billing(events) };
    assert.deepEqual(await runDerivedPurge(`enrollment:${ENROLLMENT_ID}`, "2026-08-17", overrides), { status: "failed" });
    assert.deepEqual(await runDerivedPurge(`enrollment:${ENROLLMENT_ID}`, "2026-08-17", overrides), { status: "ok", rows: 1 });
    assert.deepEqual(events, [`close:${MEMBER_REF}`, "purge", `close:${MEMBER_REF}`, "purge"]);
  });

  it("skips an absent enrollment without resolving the provider", async () => {
    let adapterCalls = 0;
    const repository: DerivedPurgeRepository = {
      ...NO_BILLING_INTENT,
      async listOutstanding() { throw new Error("unreachable"); },
      async readTarget() { return null; },
      async purge() { throw new Error("unreachable"); },
    };
    assert.deepEqual(await runDerivedPurge(`enrollment:${ENROLLMENT_ID}`, "2026-08-17", {
      repository,
      getAdapter() { adapterCalls += 1; return adapter([]); },
      getBilling: () => billing([]),
    }), { status: "skipped", rows: 0 });
    assert.equal(adapterCalls, 0);
  });

  // R4C-07: the durable provider-cancellation obligation rides this handler's
  // close step. Fails on c2df7ae, where `runDerivedPurge` has no billing call
  // at all and `DerivedPurgeRepository` has no cancellation members.
  it("cancels the retained provider subscription before closing the member and purging", async () => {
    const events: string[] = [];
    const repository: DerivedPurgeRepository = {
      async listOutstanding() { throw new Error("unreachable"); },
      async readTarget() { return { clientId: CLIENT_ID, enrollmentId: ENROLLMENT_ID, memberRef: MEMBER_REF }; },
      async readPendingProviderCancel() { return "sub_r4c07_orphan"; },
      async completeProviderCancel(enrollmentId, subscriptionRef) {
        events.push(`complete:${enrollmentId}:${subscriptionRef}`);
      },
      async purge() { events.push("purge"); return 3; },
    };
    assert.deepEqual(
      await runDerivedPurge(`enrollment:${ENROLLMENT_ID}`, "2026-08-17", {
        repository, getAdapter: () => adapter(events), getBilling: () => billing(events),
      }),
      { status: "ok", rows: 3 },
    );
    assert.deepEqual(events, [
      "billing_cancel:sub_r4c07_orphan",
      `complete:${ENROLLMENT_ID}:sub_r4c07_orphan`,
      `close:${MEMBER_REF}`,
      "purge",
    ]);
  });

  it("keeps the obligation open until the provider confirms, then stops calling out", async () => {
    const events: string[] = [];
    let completed = false;
    const repository: DerivedPurgeRepository = {
      async listOutstanding() { throw new Error("unreachable"); },
      async readTarget() { return { clientId: CLIENT_ID, enrollmentId: ENROLLMENT_ID, memberRef: null }; },
      async readPendingProviderCancel() { return completed ? null : "sub_r4c07_orphan"; },
      async completeProviderCancel() { completed = true; },
      async purge() { events.push("purge"); return 0; },
    };
    assert.deepEqual(
      await runDerivedPurge(`enrollment:${ENROLLMENT_ID}`, "2026-08-17", {
        repository, getAdapter: () => adapter(events), getBilling: () => billing(events, "unavailable"),
      }),
      { status: "failed" },
    );
    assert.equal(completed, false);
    assert.deepEqual(events, ["billing_cancel:sub_r4c07_orphan"]);

    assert.deepEqual(
      await runDerivedPurge(`enrollment:${ENROLLMENT_ID}`, "2026-08-18", {
        repository, getAdapter: () => adapter(events), getBilling: () => billing(events),
      }),
      { status: "ok", rows: 0 },
    );
    assert.equal(completed, true);

    // A third tuple sees a completed obligation and issues no further cancel.
    assert.deepEqual(
      await runDerivedPurge(`enrollment:${ENROLLMENT_ID}`, "2026-08-19", {
        repository, getAdapter: () => adapter(events), getBilling: () => billing(events),
      }),
      { status: "ok", rows: 0 },
    );
    assert.equal(events.filter((event) => event.startsWith("billing_cancel:")).length, 2);
  });
});

describe("derived purge rediscovery (R4D-03)", () => {
  const SECOND_ID = "26000000-0000-4000-8000-000000000302";
  function selector(ids: readonly string[], seen: string[]): DerivedPurgeRepository {
    return {
      async listOutstanding(staleBefore) { seen.push(staleBefore); return ids; },
      async readTarget() { throw new Error("unreachable"); },
      async readPendingProviderCancel() { throw new Error("unreachable"); },
      async completeProviderCancel() { throw new Error("unreachable"); },
      async purge() { throw new Error("unreachable"); },
    };
  }

  it("emits one fresh daily tuple per outstanding enrollment behind the executing-tuple age guard", async () => {
    const seen: string[] = [];
    const now = new Date("2026-08-18T02:05:00.000Z");
    assert.deepEqual(
      await listDerivedPurgeTargets("2026-08-18", now, selector([ENROLLMENT_ID, SECOND_ID], seen)),
      [
        { subject: `enrollment:${ENROLLMENT_ID}`, window: "2026-08-18" },
        { subject: `enrollment:${SECOND_ID}`, window: "2026-08-18" },
      ],
    );
    assert.deepEqual(seen, ["2026-08-18T01:50:00.000Z"]);
  });

  it("emits nothing once the obligation is discharged and refuses a malformed window", async () => {
    const seen: string[] = [];
    assert.deepEqual(
      await listDerivedPurgeTargets("2026-08-19", new Date("2026-08-19T02:05:00.000Z"), selector([], seen)),
      [],
    );
    await assert.rejects(
      listDerivedPurgeTargets("2026-8-19", new Date("2026-08-19T02:05:00.000Z"), selector([], seen)),
      /PURGE_WINDOW_INVALID/,
    );
  });
});
