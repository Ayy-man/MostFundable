import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

/**
 * The G-HOST-14 class, closed as a class: a client-side reader that maps a
 * failed HTTP read to its empty/default state renders an outage as a healthy
 * screen. The revenue client was the first instance (fixed at `44f3267`); the
 * wiring audit (docs/backend/UI-WIRING-BACKLOG.md #5, #6, #16) found three
 * more. These assertions read the source of the two surfaces and fail if any
 * of the three readers loses its failure branch again.
 *
 * They assert the mechanism (the failure branch exists and reaches a rendered
 * state), not pixel output — the same style the repo's other source-derived
 * guards use, so a refactor that keeps the behaviour under different local
 * names must keep the state names asserted here or update this test with the
 * rename in the same commit.
 */

const consumer = fs.readFileSync(new URL("./consumer.tsx", import.meta.url), "utf8");
const admin = fs.readFileSync(new URL("./admin.tsx", import.meta.url), "utf8");

describe("a failed read must not render as a healthy screen", () => {
  it("consumer documents: the initial read has a failure branch that reaches the render", () => {
    assert.ok(consumer.includes("setLiveError(true)"), "documents reader lost its failure branch");
    assert.ok(
      consumer.includes("ancillaryPending || (ancillaryEnabled && liveError)"),
      "the section empty-state no longer distinguishes an outage from an empty vault",
    );
  });

  it("consumer notifications: a failed read reaches the unavailable notice", () => {
    assert.ok(
      consumer.includes("setLiveNotificationsError(true)"),
      "notifications reader lost its failure branch",
    );
    assert.ok(
      consumer.includes("ancillaryPending || (ancillaryEnabled && liveError) ?"),
      "the notifications view no longer renders the unavailable notice on a failed read",
    );
  });

  it("admin Stripe mode: unknown is a state of its own, never rendered as live", () => {
    assert.ok(!admin.includes("stripeTestMode"), "the boolean Stripe-mode state is back");
    assert.ok(admin.includes('setStripeMode("unknown")'), "the unknown branch is gone");
    assert.ok(
      admin.includes('stripeMode === "unknown" ?'),
      "the unknown state no longer renders — an unreadable config would look like live mode",
    );
  });

  it("admin Stripe mode: the flag-off 404 is still a known state, not a failure", () => {
    assert.ok(
      admin.includes("if (response.status === 404) return { testMode: false }"),
      "the 404 flag-off answer must not be reported as an unreadable configuration",
    );
  });
});
