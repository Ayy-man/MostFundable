import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAccrualWindow,
  parseOperatorSubject,
  percentageAmountCents,
  referralCycle,
  resolveMonitoringSplit,
  resolveReferralBase,
} from "./config.ts";

test("monitoring split is null when absent or blank", () => {
  assert.equal(resolveMonitoringSplit({}), null);
  assert.equal(resolveMonitoringSplit({ MONITORING_SPLIT_PCT: "  " }), null);
});

test("monitoring split accepts closed two-decimal boundaries", () => {
  for (const [raw, expected] of [["0", 0], ["0.01", 0.01], ["20.50", 20.5], ["100.00", 100]] as const) {
    assert.equal(resolveMonitoringSplit({ MONITORING_SPLIT_PCT: raw }), expected);
  }
});

test("monitoring split rejects explicit malformed values without echoing them", () => {
  for (const raw of ["-1", "100.01", "20.001", "NaN", "secret-shaped-value"]) {
    assert.throws(
      () => resolveMonitoringSplit({ MONITORING_SPLIT_PCT: raw }),
      (error) => error instanceof Error
        && error.message === "MONITORING_SPLIT_PCT_INVALID"
        && !error.message.includes(raw),
    );
  }
});

test("referral base defaults and accepts only ratified values", () => {
  assert.equal(resolveReferralBase({}), "platform_subscription");
  assert.equal(resolveReferralBase({ SAAS_REFERRAL_BASE: " " }), "platform_subscription");
  assert.equal(resolveReferralBase({ SAAS_REFERRAL_BASE: "platform_subscription" }), "platform_subscription");
  assert.equal(resolveReferralBase({ SAAS_REFERRAL_BASE: "consumer_subscriptions" }), "consumer_subscriptions");
  assert.throws(
    () => resolveReferralBase({ SAAS_REFERRAL_BASE: "private-value" }),
    (error) => error instanceof Error
      && error.message === "SAAS_REFERRAL_BASE_INVALID"
      && !error.message.includes("private-value"),
  );
});

test("subject and month parsers accept only canonical forms", () => {
  const id = "14140000-0000-4000-8000-000000000001";
  assert.equal(parseOperatorSubject(`org:${id}`), id);
  // seeded ids (zero version/variant nibbles) are valid subjects — G-3B-07
  assert.equal(
    parseOperatorSubject("org:a0000000-0000-0000-0000-000000000001"),
    "a0000000-0000-0000-0000-000000000001",
  );
  assert.equal(parseAccrualWindow("2026-08"), "2026-08-01");
  for (const invalid of [id, "org:not-a-uuid", "global"]) {
    assert.throws(() => parseOperatorSubject(invalid), /REVENUE_SUBJECT_INVALID/);
  }
  for (const invalid of ["2026-8", "2026-13", "2026-08-01", "August"]) {
    assert.throws(() => parseAccrualWindow(invalid), /REVENUE_WINDOW_INVALID/);
  }
});

test("referral cycle includes one through twelve and excludes thirteen", () => {
  assert.equal(referralCycle("2026-01-31", "2026-01-01"), 1);
  assert.equal(referralCycle("2024-02-29", "2025-01-01"), 12);
  assert.equal(referralCycle("2024-02-29", "2025-02-01"), null);
  assert.equal(referralCycle("2026-08-01", "2026-07-01"), null);
});

test("percentage calculation stays in integer cents", () => {
  assert.equal(percentageAmountCents(49_700, 20), 9_940);
  assert.equal(percentageAmountCents(101, 12.5), 13);
  assert.equal(Number.isInteger(percentageAmountCents(1, 50)), true);
  assert.throws(() => percentageAmountCents(1.2, 20), /REVENUE_CENTS_INVALID/);
});
