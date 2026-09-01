import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isTimelineAuditAction } from "./catalog.ts";
import { readTimeline } from "./read.server.ts";
import { TIMELINE_DENIED_KEYS } from "./types.ts";

import type { TimelineReadDependencies } from "./read.server.ts";
import type { TimelineAudience, TimelineEvent } from "./types.ts";

const CLIENTS = [
  { id: "a3000000-0000-0000-0000-000000000001", name: "Casey", readiness: 92 },
  { id: "a3000000-0000-0000-0000-000000000002", name: "Devon", readiness: 58 },
  { id: "a3000000-0000-0000-0000-000000000003", name: "Taylor", readiness: 64 },
] as const;

function measurementsByClient(): Map<string, Set<number>> {
  const seed = readFileSync(new URL("../../../../supabase/seed.sql", import.meta.url), "utf8");
  const result = new Map<string, Set<number>>();
  const run = /\(\s*'a6000000-[^']+'\s*,\s*'(a3000000-[^']+)'\s*,\s*'[^']+'\s*,\s*'[^']+'\s*,\s*\d+\s*,\s*'(\{[\s\S]*?\})'::jsonb\s*\)/g;
  for (const match of seed.matchAll(run)) {
    const clientId = match[1];
    const values = new Set<number>();
    const visit = (value: unknown) => {
      if (typeof value === "number") values.add(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value !== null && typeof value === "object") Object.values(value).forEach(visit);
    };
    visit(JSON.parse(match[2]));
    result.set(clientId, values);
  }
  return result;
}

function eventFamilies(client: string, readiness: number): TimelineReadDependencies {
  const at = (day: number, minute = 0) => `2026-08-${String(day).padStart(2, "0")}T10:${String(minute).padStart(2, "0")}:00.000Z`;
  const event = <T extends TimelineEvent>(value: T): T => value;
  return {
    readSupport: async () => [
      event({ ref: "support:opened", kind: "thread_opened", at: at(1), client, actor: "Priya" }),
      event({ ref: "support:resolved", kind: "thread_status", at: at(23), client, actor: "Priya", to: "resolved" }),
      event({ ref: "support:reopened", kind: "thread_status", at: at(24), client, actor: "Priya", to: "open" }),
    ],
    readStages: async () => [event({ ref: "stage:one", kind: "stage_changed", at: at(2), client, actor: "Priya", from: "Onboarding", to: "Optimization" })],
    readEnrollment: async () => [
      event({ ref: "enrollment:consents", kind: "enrollment_milestone", at: at(3), client, milestone: "consents" }),
      event({ ref: "enrollment:esign", kind: "enrollment_milestone", at: at(3, 1), client, milestone: "esign" }),
      event({ ref: "enrollment:idv", kind: "enrollment_milestone", at: at(3, 2), client, milestone: "idv" }),
      event({ ref: "enrollment:active", kind: "enrollment_milestone", at: at(3, 3), client, milestone: "active", firstChargeOn: "2026-08-03" }),
      event({ ref: "subscription:active", kind: "subscription", at: at(3, 4), client, state: "active" }),
      event({ ref: "consent:revoked", kind: "consent_revoked", at: at(25), client, actor: "Priya", which: "analysis" }),
    ],
    readAnalysis: async () => [
      event({ ref: "analysis:old", kind: "analysis_completed", at: at(15), client, readiness: readiness - 1, open: 17, trigger: "scheduled" }),
      event({ ref: "analysis:new", kind: "analysis_completed", at: at(22), client, readiness, prev: readiness - 1, prevAt: at(15), open: 17, trigger: "refresh" }),
    ],
    readActions: async () => [
      event({ ref: "action:todo", kind: "action", at: at(16), client, title: "Complete the business profile", state: "todo", blocking: true }),
      event({ ref: "action:reported", kind: "action", at: at(17), client, title: "Confirm the filing date", state: "reported", blocking: false, reportedAt: at(18) }),
      event({ ref: "action:verified", kind: "action", at: at(18), client, title: "Upload the current statement", state: "verified", blocking: true, reportedAt: at(19), verifiedAt: at(22) }),
    ],
    readDocuments: async () => [
      event({ ref: "document:filed-one", kind: "document_filed", at: at(20), client, actor: client, uploadId: `${client}-upload-1`, name: "Bank statement", named: "a bank statement", section: "Financial", reviewedBy: "Priya" }),
      event({ ref: "document:filed-two", kind: "document_filed", at: at(20, 1), client, actor: client, uploadId: `${client}-upload-2`, name: "EIN confirmation", named: "an EIN confirmation", section: "Company" }),
      event({ ref: "document:request", kind: "document_requested", at: at(20, 2), client, actor: "Priya", requestId: `${client}-request-1`, uploadId: `${client}-upload-1`, name: "Bank statement", named: "a bank statement", why: "The latest statement is needed for checklist review.", fulfilledAt: at(22), reviewedBy: "Priya" }),
    ],
    readRefreshes: async () => [
      event({ ref: "refresh:pending", kind: "refresh", at: at(21), client, amountCents: 2900 }),
      event({ ref: "refresh:complete", kind: "refresh", at: at(22), client, amountCents: 2900, completedAt: at(22, 1), readiness }),
      event({ ref: "refresh:blocked", kind: "refresh_blocked", at: at(23, 1), client, operatorOnly: true, resetsOn: "2026-09-01", lastReadiness: readiness, lastRunAt: at(22) }),
    ],
    readFees: async () => [event({ ref: "fee:one", kind: "fee_payment", at: at(12), client, actor: "Priya", amountCents: 17500, balanceCents: 42000, method: "card", receivedOn: "2026-08-12" })],
    readApplications: async () => [
      event({ ref: "outcome:released", kind: "application_outcome", at: at(26), client, actor: "Priya", kindWord: "funded", bank: "Example Bank", amountCents: 5000000, decidedOn: "2026-08-26", releasedOn: "2026-08-27" }),
      event({ ref: "outcome:pending", kind: "application_outcome", at: at(27), client, actor: "Priya", kindWord: "declined", bank: "Sample Bank", decidedOn: "2026-08-27" }),
    ],
    readAssignments: async () => [event({ ref: "assignment:one", kind: "assignment", at: at(19), client, actor: "Avery", operatorOnly: true, from: "Avery", to: "Priya" })],
  };
}

function walk(value: unknown, visit: (key: string | null, value: unknown) => void, key: string | null = null): void {
  visit(key, value);
  if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
  else if (value !== null && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) walk(child, visit, childKey);
  }
}

async function readAll(audience: TimelineAudience) {
  const results = [];
  for (const client of CLIENTS) {
    results.push({
      client,
      read: await readTimeline(eventFamilies(client.name, client.readiness), {
        clientId: client.id,
        audience,
        viewer: { profileId: "a1000000-0000-0000-0000-000000000002", role: audience === "consumer" ? "consumer" : "operator_member" },
      }),
    });
  }
  return results;
}

describe("timeline denial boundary", () => {
  it("keeps the audit catalog closed", () => {
    assert.equal(isTimelineAuditAction("support.thread_opened"), true);
    assert.equal(isTimelineAuditAction("document_request.created"), false);
  });

  for (const audience of ["consumer", "operator"] as const) {
    it(`walks every ${audience} event for all seeded clients`, async () => {
      const measurements = measurementsByClient();
      const results = await readAll(audience);
      assert.equal(results.length, 3);
      for (const { client, read } of results) {
        assert.equal(read.readFailed, undefined);
        assert.equal(read.events.length, audience === "consumer" ? 22 : 25);
        const sourceMeasurements = measurements.get(client.id);
        assert.ok(sourceMeasurements && sourceMeasurements.size > 0);
        for (const timelineEvent of read.events) {
          walk(timelineEvent, (key, value) => {
            if (key !== null) assert.equal((TIMELINE_DENIED_KEYS as readonly string[]).includes(key), false, `${timelineEvent.ref} emitted denied key ${key}`);
            if (typeof value === "number") assert.equal(sourceMeasurements.has(value), false, `${timelineEvent.ref} emitted a seeded source measurement`);
          });
        }
      }
    });
  }

  it("keeps successful families when one family fails", async () => {
    const deps = eventFamilies("Devon", 58);
    const read = await readTimeline({ ...deps, readDocuments: async () => { throw new Error("DOCUMENT_FAMILY_UNAVAILABLE"); } }, {
      clientId: CLIENTS[1].id,
      audience: "consumer",
      viewer: { profileId: "a1000000-0000-0000-0000-000000000012", role: "consumer" },
    });
    assert.equal(read.readFailed, true);
    assert.ok(read.events.length > 0);
    assert.equal(read.events.some((timelineEvent) => timelineEvent.kind === "document_filed"), false);
  });
});
