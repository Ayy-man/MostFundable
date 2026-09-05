import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BUSINESS_CHECKLIST_V1, PERSONAL_CHECKLIST_V1 } from "../llm/checklist-seeds.ts";
import {
  buckets,
  displayState,
  documentNoun,
  FACTOR_OWNER_BY_KEY_V1,
  nextUp,
  openActionCount,
  referencedTrack,
  signalCopy,
  trackSummary,
} from "./view-model.ts";

import type { ConsumerOptimizationV1, FactorStateV1, FactorV1, TrackV1 } from "./types.ts";

function factor(key: string, state: FactorStateV1, signal: string | null = null, overrides: Partial<FactorV1> = {}): FactorV1 {
  return { blocking: true, children: [], key, reported: null, signal, state, title: key, ...overrides };
}

function track(kind: TrackV1["kind"], factors: FactorV1[], rollup: TrackV1["rollup"] = null): TrackV1 {
  return { factors, kind, rollup, total: factors.length, verifiedCount: factors.filter((f) => f.state === "verified").length };
}

function view(personal: FactorV1[], business: FactorV1[], overrides: Partial<ConsumerOptimizationV1> = {}): ConsumerOptimizationV1 {
  return {
    analysis: { bureausPulled: ["EQF"], ranAt: "2026-08-15T00:00:00Z", trigger: "enrollment" },
    clientId: "c",
    estimatedCompletion: { days: null, label: "TBD" },
    narrative: null,
    provenance: "plan",
    readiness: 58,
    readinessLabel: "Optimization",
    reporting: { enabled: false, reason: "no-write-path" },
    schemaVersion: 1,
    tracks: { business: track("business_setup", business), personal: track("personal_credit", personal) },
    utilization: { accounts: [], overallPct: 62, target: 30 },
    ...overrides,
  };
}

const personalKeys = PERSONAL_CHECKLIST_V1.map((seed) => seed.key);
const businessKeys = BUSINESS_CHECKLIST_V1.map((seed) => seed.key);

describe("optimization view-model", () => {
  it("assigns an owner to every engine seed, derived from the seed catalog", () => {
    for (const key of [...personalKeys, ...businessKeys]) {
      assert.ok(key in FACTOR_OWNER_BY_KEY_V1, `${key} has no owner`);
    }
    // The two reporting-state factors are nobody's task.
    assert.equal(FACTOR_OWNER_BY_KEY_V1.no_negative_items_reported, "report");
    assert.equal(FACTOR_OWNER_BY_KEY_V1.overall_report_ready, "report");
  });

  it("renders the tag from the owner axis, never only the state", () => {
    const t = track("personal_credit", []);
    assert.equal(displayState(factor("utilization_under_30", "action-needed", "x"), t, false), "action-needed");
    assert.equal(displayState(factor("average_age_two_years", "action-needed", "x"), t, false), "tracked");
    assert.equal(displayState(factor("personal_card_ten_k_limit", "action-needed", "x"), t, false), "tracked");
    assert.equal(displayState(factor("no_negative_items_reported", "action-needed", "x"), t, false), "reported");
    // Canceled: nothing is on the consumer, so nothing is action-needed.
    assert.equal(displayState(factor("utilization_under_30", "action-needed", "x"), t, true), "tracked");
  });

  it("moves business factors to checking when the profile rollup is reported, without changing their owner", () => {
    const business = track(
      "business_setup",
      businessKeys.map((key) => factor(key, "not-yet-checked")),
      { at: "2026-08-20T00:00:00Z", state: "reported" },
    );
    for (const f of business.factors) assert.equal(displayState(f, business, false), "checking");
    const v = view(personalKeys.map((key) => factor(key, "verified")), [...business.factors], {
      tracks: { business, personal: track("personal_credit", personalKeys.map((key) => factor(key, "verified"))) },
    });
    const b = buckets(v, false);
    assert.equal(b.checking, 7);
    assert.equal(b.docs.length, 0);
    assert.equal(openActionCount(v), 0);
    assert.deepEqual(nextUp(v, false), { kind: "rollup", reportedAt: "2026-08-20T00:00:00Z" });
    assert.equal(referencedTrack(v, false), "business");
  });

  it("names one next thing in a fixed order: ready, you, docs, rollup, waiting", () => {
    const allVerified = view(personalKeys.map((k) => factor(k, "verified")), businessKeys.map((k) => factor(k, "verified")));
    assert.deepEqual(nextUp(allVerified, false), { kind: "ready" });

    const devon = view(
      personalKeys.map((k) => factor(k, k === "utilization_under_30" ? "action-needed" : "verified", "s")),
      businessKeys.map((k) => factor(k, "not-yet-checked")),
    );
    const next = nextUp(devon, false);
    assert.equal(next.kind, "you");
    if (next.kind === "you") {
      assert.equal(next.factor.key, "utilization_under_30");
      assert.equal(next.docsAlso, true);
      assert.equal(next.hasAccountRows, false);
    }
    assert.equal(referencedTrack(devon, false), "personal");

    const casey = view(personalKeys.map((k) => factor(k, "verified")), businessKeys.map((k) => factor(k, "not-yet-checked")));
    assert.equal(nextUp(casey, false).kind, "docs");
    assert.equal(referencedTrack(casey, false), "business");

    const riley = view(
      personalKeys.map((k) => factor(k, k === "average_age_two_years" ? "action-needed" : "verified", "s")),
      businessKeys.map((k) => factor(k, "verified")),
    );
    assert.deepEqual(nextUp(riley, false), { kind: "waiting" });
    assert.equal(referencedTrack(riley, false), null);
  });

  it("counts attention only for factors the consumer can move, and nothing while canceled", () => {
    const personal = track(
      "personal_credit",
      personalKeys.map((k) => factor(k, k === "personal_information_confirmed" ? "not-yet-checked" : k === "four_personal_accounts_open" ? "verified" : "action-needed", "s")),
    );
    const live = trackSummary(personal, false);
    assert.equal(live.attention, 1);
    // Every open row that is not on the consumer, including the not-yet-checked one.
    assert.equal(live.tracked, 6);
    assert.equal(live.done, 1);
    assert.deepEqual(live.caption, ["1 needs attention", "6 tracked, not on you", "1 of 8 verified"]);
    const canceled = trackSummary(personal, true);
    assert.equal(canceled.attention, 0);
    assert.equal(canceled.tracked, 7);
    assert.equal(openActionCount(view([...personal.factors], [])), 7);
  });

  it("restates the two reporting-state signals as observations, not targets", () => {
    assert.equal(
      signalCopy(factor("no_negative_items_reported", "action-needed", "2 negative items are reported, target none")),
      "2 negative items are reported. This factor stays open while they report; it is not a task for you.",
    );
    assert.equal(signalCopy(factor("no_negative_items_reported", "verified", "No negative items are reported")), "No negative items are reported.");
    assert.equal(signalCopy(factor("business_name_confirmed", "not-yet-checked", null)), null);
  });

  it("turns engine titles into document nouns", () => {
    assert.equal(documentNoun(factor("k", "verified", null, { title: "Business name is confirmed for funding readiness" })), "business name");
    assert.equal(documentNoun(factor("k", "verified", null, { title: "Business website is present" })), "business website");
    assert.equal(documentNoun(factor("k", "verified", null, { title: "Net asset value information is confirmed" })), "net asset value");
  });
});
