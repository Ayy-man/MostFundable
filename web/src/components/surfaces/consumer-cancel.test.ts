import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import type { EnrollmentView } from "@/lib/enrollment/types";
import {
  CANCELLATION_SUCCESS,
  cancelConsumerEnrollment,
  consentStateFromView,
} from "./consumer-cancel.ts";

// R5D-03. This fixture used to define the cancelled view with **both consents already false**, which
// is a shape `enrollment_cancel_sub` cannot produce: cancellation retains the grants on purpose, and
// `cancelEnrollment` returns them as `authorized: true`. Asserting against the pre-masked shape is
// exactly the "test asserted the reproduction, not the property" mechanism — the callback's missing
// mask was invisible to it. `VIEW` is now the real retained-consent shape the server returns.
const VIEW: EnrollmentView = {
  attemptsRemaining: 2,
  consents: [
    { authorized: true, kind: "monitoring", signedAt: "2026-07-02T00:00:00.000Z", textVersion: "v1" },
    { authorized: true, kind: "analysis", signedAt: "2026-07-02T00:00:00.000Z", textVersion: "v1" },
  ],
  enrollmentId: "11111111-1111-4111-8111-111111111111",
  idvState: "passed",
  lockedUntil: null,
  milestones: [],
  needsOperatorAttention: null,
  parkedUntil: null,
  status: "cancelled",
  subscription: {
    activatedAt: "2026-07-02T00:00:00.000Z",
    authorizedAt: "2026-07-02T00:00:00.000Z",
    cancelledAt: "2026-07-21T00:00:00.000Z",
    currency: "usd",
    paymentMethodOnFile: true,
    priceCents: 4900,
    status: "cancelled",
  },
};

const ACTIVE_VIEW: EnrollmentView = {
  ...VIEW,
  status: "active",
  subscription: { ...VIEW.subscription!, cancelledAt: null, status: "active" },
};

describe("consumer cancellation control", () => {
  test("a failed request applies no server state and shows no success copy", async () => {
    const applied: EnrollmentView[] = [];
    const messages: string[] = [];
    await cancelConsumerEnrollment(VIEW.enrollmentId, {
      apply(view) { applied.push(view); },
      fail(message) { messages.push(message); },
      succeed(message) { messages.push(message); },
    }, async () => ({ code: "network", message: "Cancellation unavailable.", ok: false }));

    assert.deepEqual(applied, [], "a failing request must not apply cancellation state");
    assert.deepEqual(messages, ["Cancellation unavailable."]);
    assert.equal(messages.includes(CANCELLATION_SUCCESS), false, "a failing request must not show success copy");
  });

  test("success calls the endpoint once and applies only the returned view", async () => {
    const calls: Array<{ body: unknown; path: string }> = [];
    const applied: EnrollmentView[] = [];
    const messages: string[] = [];
    await cancelConsumerEnrollment(VIEW.enrollmentId, {
      apply(view) { applied.push(view); },
      fail(message) { messages.push(message); },
      succeed(message) { messages.push(message); },
    }, async (path, body) => {
      calls.push({ body, path });
      return { data: VIEW, ok: true };
    });

    assert.deepEqual(calls, [{
      body: {},
      path: `/api/enrollments/${VIEW.enrollmentId}/cancel`,
    }], "the live cancellation endpoint must be called exactly once");
    assert.deepEqual(applied, [VIEW]);
    assert.deepEqual(messages, [CANCELLATION_SUCCESS]);
  });
});

describe("R5D-03 — retained consent never renders as a live permission", () => {
  test("a cancelled view with both grants still authorized derives both booleans false", () => {
    // The real shape: `enrollment_cancel_sub` retains the grants, so this is what the success
    // callback is handed. Before the fix the callback wrote `authorized=true` straight into
    // `monitoringActive`/`analysisActive` and Credit Monitoring took its active branch.
    assert.deepEqual(consentStateFromView(VIEW), {
      analysisActive: false,
      canceled: true,
      monitoringActive: false,
    });
  });

  test("the mask is the cancelled status, not a hard-coded false", () => {
    assert.deepEqual(consentStateFromView(ACTIVE_VIEW), {
      analysisActive: true,
      canceled: false,
      monitoringActive: true,
    });
    assert.deepEqual(
      consentStateFromView({
        ...ACTIVE_VIEW,
        consents: [
          { authorized: true, kind: "monitoring", signedAt: null, textVersion: "v1" },
          { authorized: false, kind: "analysis", signedAt: null, textVersion: "v1" },
        ],
      }),
      { analysisActive: false, canceled: false, monitoringActive: true },
      "a revoked analysis grant on a live enrollment still reads independently",
    );
  });

  test("the retained grants stay visible as retained history", () => {
    // The retention is correct behaviour, not the defect: Account settings reads the grants off the
    // view and labels them `Retained` on a cancelled enrollment. The derivation must not erase them.
    const state = consentStateFromView(VIEW);
    assert.equal(VIEW.consents.every((consent) => consent.authorized), true);
    assert.equal(state.canceled, true);
  });

  test("no path in consumer.tsx applies a consent grant without the shared derivation", () => {
    // Derived, not listed: every consent assignment in the surface is enumerated from the source,
    // and any one that reads `consents` inline fails. That is the property — the defect was a second
    // copy of the mask drifting from the first across Phase 9's hand-resolved merge, so the test has
    // to refuse a second copy rather than check the two known sites.
    const source = readFileSync(new URL("./consumer.tsx", import.meta.url), "utf8");
    const assignments = [...source.matchAll(/set(?:Monitoring|Analysis)Active\(([^;]*?)\);/g)]
      .map((hit) => hit[1].trim());

    assert.ok(assignments.length >= 4, "the consent setters must be found in the source");
    const raw = assignments.filter((argument) => argument.includes("consents"));
    assert.deepEqual(
      raw,
      [],
      "a consent grant may only reach the surface through consentStateFromView",
    );
    assert.match(source, /consentStateFromView\(view\)/, "the cancel callback must use it");
    assert.match(source, /consentStateFromView\(current\)/, "the bootstrap path must use it");
  });

  test("the Credit Monitoring active branch is the one monitoringActive gates", () => {
    // The rendered consequence of the two booleans. `Connected` and the bureau scores live inside
    // the arm that only runs when `monitoringActive` is true, so deriving it false is what removes
    // them — asserted here rather than by rendering, because the surface has no render harness.
    const source = readFileSync(new URL("./consumer.tsx", import.meta.url), "utf8");
    const inactive = source.indexOf("Credit monitoring is inactive");
    const guard = source.lastIndexOf("!monitoringActive ? (", inactive);
    // The trailing slot became conditional when the paid-refresh watcher landed (a queued refresh
    // renders "Refresh running" there), so the anchor is the Connected tag itself rather than the
    // whole slot expression. The property asserted is unchanged: Connected renders only in the
    // arm `monitoringActive` gates.
    const connected = source.indexOf('<StatusTag tone="success">Connected</StatusTag>');

    assert.ok(guard > -1 && guard < inactive, "the inactive panel must sit under the !monitoringActive guard");
    assert.ok(connected > inactive, "the Connected snapshot must be the other arm of that branch");
  });
});
