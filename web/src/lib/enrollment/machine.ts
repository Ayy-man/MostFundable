import {
  IDV_LOCK_DURATION_HOURS,
  MAX_IDV_ATTEMPTS,
} from "@/lib/idv/config";
import type {
  MachineEffect,
  MachineEvent,
  MachineResult,
  MachineState,
} from "@/lib/enrollment/types";

export function nextState(
  state: MachineState,
  event: MachineEvent,
  now: Date,
): MachineResult {
  if (event.kind === "cancel") {
    return result(
      { ...state, status: "cancelled" },
      [{ kind: "cancel_subscription" }],
    );
  }

  if (state.idvState === "passed" || state.idvState === "locked") {
    return result(state);
  }

  if (state.idvState === "pending" && event.kind === "idv_start") {
    return result(
      { ...state, idvState: "sms_sent" },
      [{ kind: "start_idv" }],
    );
  }

  if (state.idvState === "sms_sent" && event.kind === "idv_code_correct") {
    return pass(state);
  }

  if (state.idvState === "sms_sent" && event.kind === "idv_code_wrong") {
    return result(
      { ...state, idvState: "quiz" },
      [{ kind: "settle_idv", outcome: "retry", nextState: "quiz" }],
    );
  }

  if (
    (state.idvState === "quiz" || state.idvState === "retry") &&
    event.kind === "idv_answer_correct"
  ) {
    return pass(state);
  }

  if (
    (state.idvState === "quiz" || state.idvState === "retry") &&
    event.kind === "idv_answer_wrong"
  ) {
    const attemptsUsed = state.attemptsUsed + 1;
    const maxAttempts =
      state.maxAttempts > 0 ? state.maxAttempts : MAX_IDV_ATTEMPTS;

    if (attemptsUsed < maxAttempts) {
      return result(
        { ...state, attemptsUsed, idvState: "retry" },
        [{ kind: "settle_idv", outcome: "retry", nextState: "retry" }],
      );
    }

    const until = addHours(now, IDV_LOCK_DURATION_HOURS).toISOString();
    return result(
      {
        ...state,
        attemptsUsed,
        idvState: "locked",
        status: "parked",
      },
      [{ kind: "park", until }],
    );
  }

  return result(state);
}

function pass(state: MachineState): MachineResult {
  const effects: MachineEffect[] = [{ kind: "activate" }];

  // D-06 control one: only an unsettled pass emits this effect. Migration 022
  // adds the client-level unique index and active-enrollment trigger as the
  // other two controls, so this branch is never the sole charge guard.
  if (!state.subscriptionSettled) {
    effects.push({ kind: "start_subscription" });
  }

  return result({ ...state, idvState: "passed", status: "active" }, effects);
}

function result(
  next: MachineState,
  effects: readonly MachineEffect[] = [],
): MachineResult {
  return { next, effects };
}

function addHours(date: Date, hours: number): Date {
  const value = new Date(date);
  value.setUTCHours(value.getUTCHours() + hours);
  return value;
}
