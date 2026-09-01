import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import type { CrsAdapter, CrsIdentity, CrsMemberRef } from "@/lib/crs/types";
import { createCrsIdvAdapter } from "@/lib/idv/crs";
import { CRS_SPEC_SMFA_CHALLENGE_KIND } from "@/lib/crs/spec-catalog";

const MEMBER = "550e8400-e29b-41d4-a716-446655440000" as CrsMemberRef;
const IDENTITY: CrsIdentity = {
  firstName: "Contract",
  lastName: "Consumer",
  dateOfBirth: "1990-01-01",
  ssn: "000000000",
  address: {
    line1: "1 Contract Way",
    city: "Contract",
    state: "CA",
    postalCode: "00000",
  },
  email: "contract@example.test",
  phone: "5555550100",
};

describe("CRS enrollment IDV adapter", () => {
  it("the append-only migration ledger accepts the spec-derived SMFA challenge kind", () => {
    const migrationRoot = path.resolve(import.meta.dirname, "../../../../supabase/migrations");
    const ledger = readdirSync(migrationRoot)
      .toSorted()
      .map((file) => readFileSync(path.join(migrationRoot, file), "utf8"))
      .join("\n");
    const latestConstraint = ledger.match(/idv_sessions_kind_valid[\s\S]*?kind in \(([^)]+)\)/g)?.at(-1) ?? "";
    assert.match(latestConstraint, new RegExp(`['"]${CRS_SPEC_SMFA_CHALLENGE_KIND}['"]`));
  });

  it("passes the transient full identity to CRS once and delegates SMFA status", async () => {
    const calls: unknown[] = [];
    const crs = {
      driver: "sandbox",
      async createMember(identity: CrsIdentity) {
        calls.push(identity);
        return {
          memberRef: MEMBER,
          idpass: false,
          challenge: {
            kind: "smfa_link" as const,
            attemptsRemaining: 1,
            expiresAt: "2026-08-29T15:15:00.000Z",
          },
        };
      },
      async submitIdvStep(memberRef: CrsMemberRef, submission: unknown) {
        calls.push({ memberRef, submission });
        return { outcome: "pass" as const, verifiedAt: "2026-08-29T15:05:00.000Z" };
      },
      async closeMember(memberRef: CrsMemberRef) {
        calls.push({ close: memberRef });
        return { closedAt: "2026-08-29T15:06:00.000Z" };
      },
      async pauseMember(memberRef: CrsMemberRef) {
        calls.push({ pause: memberRef });
        return { pausedAt: "2026-08-29T15:07:00.000Z" };
      },
      async resumeMember(memberRef: CrsMemberRef) {
        calls.push({ resume: memberRef });
        return { resumedAt: "2026-08-29T15:08:00.000Z" };
      },
    } as CrsAdapter;
    const adapter = createCrsIdvAdapter(crs);

    const started = await adapter.start({
      clientId: "00000000-0000-4000-8000-000000000001",
      enrollmentId: "00000000-0000-4000-8000-000000000002",
      identity: { email: IDENTITY.email, fullName: "Contract Consumer", phone: IDENTITY.phone },
      crsIdentity: IDENTITY,
    });
    const submitted = await adapter.submit({
      enrollmentId: "00000000-0000-4000-8000-000000000002",
      memberRef: MEMBER,
      submission: { kind: "smfa_status" },
      attemptsUsed: 0,
      maxAttempts: 2,
    });
    await adapter.close(MEMBER);
    await adapter.pause(MEMBER);
    await adapter.resume(MEMBER);

    assert.equal(started.memberRef, MEMBER);
    assert.equal(submitted.outcome, "pass");
    assert.deepEqual(calls, [
      IDENTITY,
      { memberRef: MEMBER, submission: { kind: "smfa_status" } },
      { close: MEMBER },
      { pause: MEMBER },
      { resume: MEMBER },
    ]);
  });

  it("refuses to construct a CRS member without transient full identity", async () => {
    let calls = 0;
    const adapter = createCrsIdvAdapter({
      driver: "sandbox",
      async createMember() {
        calls += 1;
        throw new Error("must not be called");
      },
    } as unknown as CrsAdapter);

    await assert.rejects(() => adapter.start({
      clientId: "00000000-0000-4000-8000-000000000001",
      enrollmentId: "00000000-0000-4000-8000-000000000002",
      identity: { email: IDENTITY.email, fullName: "Contract Consumer", phone: IDENTITY.phone },
    }));
    assert.equal(calls, 0);
  });
});
