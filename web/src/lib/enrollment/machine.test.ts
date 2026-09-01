import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextState } from "./machine";
import { IDV_LOCK_DURATION_HOURS, MAX_IDV_ATTEMPTS } from "@/lib/idv/config";
import type { MachineEffect, MachineState } from "@/lib/enrollment/types";

const NOW = new Date("2026-08-16T00:00:00.000Z");

function state(overrides: Partial<MachineState> = {}): MachineState {
  return {
    status: "enrolled",
    idvState: "pending",
    attemptsUsed: 0,
    maxAttempts: MAX_IDV_ATTEMPTS,
    subscriptionSettled: false,
    ...overrides,
  };
}

function kinds(effects: readonly MachineEffect[]): string[] {
  return effects.map((effect) => effect.kind);
}

describe("enrollment state machine", () => {
  it("the parked branch emits no charge effect", () => {
    const output = nextState(
      state({ idvState: "quiz", attemptsUsed: MAX_IDV_ATTEMPTS - 1 }),
      { kind: "idv_answer_wrong" },
      NOW,
    );

    assert.equal(output.next.status, "parked", "the attempt cap must park enrollment");
    assert.ok(
      !output.effects.some((effect) => effect.kind === "start_subscription"),
      "the parked branch emitted a charge effect — ENRL-02 and DEV-ONBOARDING rule 5 are violated",
    );
    const park = output.effects.find((effect) => effect.kind === "park");
    const expected = new Date(NOW);
    expected.setUTCHours(expected.getUTCHours() + IDV_LOCK_DURATION_HOURS);
    assert.equal(
      park?.kind === "park" ? park.until : undefined,
      expected.toISOString(),
      "the park deadline must use the configured lock duration",
    );
  });

  it("starts IDV from pending", () => {
    const output = nextState(state(), { kind: "idv_start" }, NOW);
    assert.equal(output.next.idvState, "sms_sent");
    assert.deepEqual(kinds(output.effects), ["start_idv"]);
  });

  it("activates and starts a subscription after the correct SMS code", () => {
    const output = nextState(
      state({ idvState: "sms_sent" }),
      { kind: "idv_code_correct" },
      NOW,
    );
    assert.equal(output.next.status, "active");
    assert.equal(output.next.idvState, "passed");
    assert.deepEqual(kinds(output.effects), ["activate", "start_subscription"]);
  });

  it("moves a wrong SMS code to the quiz without a money effect", () => {
    const output = nextState(
      state({ idvState: "sms_sent" }),
      { kind: "idv_code_wrong" },
      NOW,
    );
    assert.equal(output.next.idvState, "quiz");
    assert.ok(!output.effects.some((effect) => effect.kind === "start_subscription"));
  });

  it("activates and starts a subscription after the correct quiz answer", () => {
    const output = nextState(
      state({ idvState: "quiz" }),
      { kind: "idv_answer_correct" },
      NOW,
    );
    assert.equal(output.next.idvState, "passed");
    assert.ok(kinds(output.effects).includes("start_subscription"));
  });

  it("retries after the first wrong quiz answer", () => {
    const output = nextState(
      state({ idvState: "quiz" }),
      { kind: "idv_answer_wrong" },
      NOW,
    );
    assert.equal(output.next.idvState, "retry");
    assert.equal(output.next.attemptsUsed, 1);
    assert.ok(!output.effects.some((effect) => effect.kind === "start_subscription"));
  });

  it("does not emit a second subscription start when already settled", () => {
    const output = nextState(
      state({ idvState: "quiz", subscriptionSettled: true }),
      { kind: "idv_answer_correct" },
      NOW,
    );
    assert.deepEqual(kinds(output.effects), ["activate"]);
  });

  it("passed is absorbing", () => {
    const initial = state({ status: "active", idvState: "passed" });
    const output = nextState(initial, { kind: "idv_code_wrong" }, NOW);
    assert.deepEqual(output, { next: initial, effects: [] });
  });

  it("locked is absorbing", () => {
    const initial = state({ status: "parked", idvState: "locked" });
    const output = nextState(initial, { kind: "idv_answer_correct" }, NOW);
    assert.deepEqual(output, { next: initial, effects: [] });
  });

  it("cancel works from pending", () => {
    const output = nextState(state(), { kind: "cancel" }, NOW);
    assert.equal(output.next.status, "cancelled");
    assert.deepEqual(kinds(output.effects), ["cancel_subscription"]);
  });

  it("cancel works after a pass", () => {
    const output = nextState(
      state({ status: "active", idvState: "passed" }),
      { kind: "cancel" },
      NOW,
    );
    assert.equal(output.next.status, "cancelled");
    assert.deepEqual(kinds(output.effects), ["cancel_subscription"]);
  });

  it("is deterministic for identical arguments", () => {
    const initial = state({ idvState: "quiz" });
    const first = nextState(initial, { kind: "idv_answer_wrong" }, NOW);
    const second = nextState(initial, { kind: "idv_answer_wrong" }, NOW);
    assert.deepEqual(second, first);
  });
});
