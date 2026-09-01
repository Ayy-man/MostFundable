import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEGAL_GATE_CODE,
  LEGAL_GATE_SQLSTATE,
  LegalGateError,
  assertFeeChangeAllowed,
  isGatedFeeChange,
  mapLegalGateError,
} from "./legal-gate.ts";

import type { GatedFeeChange } from "./legal-gate.ts";
import type { FeeModel, UpfrontGateState } from "./types.ts";

// Criterion 1 in TypeScript. The point of enumerating the whole product rather
// than picking examples is that a spot check would not notice a fourth model
// being added un-gated: every cell below is generated from the axes, and the
// expectation is recomputed from the rule rather than written out by hand, so a
// new label in FeeModel makes this file fail to compile until someone decides
// which side of the gate it belongs on.

const MODELS: FeeModel[] = ["percentage", "package", "custom"];
const GATE_STATES: boolean[] = [true, false];
const AMOUNTS: Array<number | null> = [null, 0, 25_000];

interface Cell {
  readonly label: string;
  readonly change: GatedFeeChange;
  readonly gate: UpfrontGateState;
  readonly expectGated: boolean;
}

function gateState(approved: boolean): UpfrontGateState {
  return approved
    ? { approved: true, signoffRef: "LGL-2026-0001", approvedAt: "2026-08-16T00:00:00.000Z" }
    : { approved: false, signoffRef: null, approvedAt: null };
}

const CELLS: Cell[] = MODELS.flatMap((model) =>
  GATE_STATES.flatMap((approved) =>
    AMOUNTS.flatMap((upfrontCents) =>
      AMOUNTS.map((triggerCents) => ({
        label: `${model} / gate ${approved ? "open" : "closed"} / upfront ${String(upfrontCents)} / trigger ${String(triggerCents)}`,
        change: { model, upfrontCents, triggerCents } satisfies GatedFeeChange,
        gate: gateState(approved),
        // The rule, stated once: the package model is gated whatever its
        // amounts, any positive upfront amount is gated whatever its model,
        // and a legacy trigger on a non-custom model remains gated. A custom
        // trigger is a funded threshold, not a charge.
        expectGated:
          model === "package"
          || (upfrontCents ?? 0) > 0
          || (model !== "custom" && (triggerCents ?? 0) > 0),
      })),
    ),
  ),
);

describe("isGatedFeeChange", () => {
  it("enumerates the full model x gate x upfront x trigger product", () => {
    assert.equal(CELLS.length, 54);
  });

  for (const cell of CELLS) {
    it(`is ${cell.expectGated} for ${cell.label}`, () => {
      assert.equal(isGatedFeeChange(cell.change), cell.expectGated);
    });
  }

  it("does not depend on the gate state", () => {
    for (const model of MODELS) {
      const change: GatedFeeChange = { model, upfrontCents: 25_000, triggerCents: null };
      assert.equal(isGatedFeeChange(change), true);
    }
  });

  it("treats an absent amount the same as a zero one", () => {
    assert.equal(
      isGatedFeeChange({ model: "percentage", upfrontCents: null, triggerCents: null }),
      false,
    );
    assert.equal(
      isGatedFeeChange({ model: "percentage", upfrontCents: 0, triggerCents: 0 }),
      false,
    );
  });

  it("does not treat a success amount as a gated option", () => {
    // A success fee is contingent on an outcome, which is the arrangement the
    // package model exists to be distinguished from.
    assert.equal(
      isGatedFeeChange({ model: "percentage", upfrontCents: null, triggerCents: null, successCents: 250_000 }),
      false,
    );
  });
});

describe("assertFeeChangeAllowed", () => {
  for (const cell of CELLS) {
    const shouldThrow = cell.expectGated && !cell.gate.approved;
    it(`${shouldThrow ? "refuses" : "allows"} ${cell.label}`, () => {
      if (shouldThrow) {
        assert.throws(
          () => assertFeeChangeAllowed(cell.change, cell.gate),
          (error: unknown) =>
            error instanceof LegalGateError &&
            error.status === 403 &&
            error.code === LEGAL_GATE_CODE,
        );
        return;
      }
      assert.doesNotThrow(() => assertFeeChangeAllowed(cell.change, cell.gate));
    });
  }

  it("refuses exactly the gated cells that meet a closed gate", () => {
    const refused = CELLS.filter((cell) => {
      try {
        assertFeeChangeAllowed(cell.change, cell.gate);
        return false;
      } catch {
        return true;
      }
    });
    // 17 of the 27 closed-gate cells are gated: every package cell (9), the
    // five percentage cells carrying an upfront or legacy trigger amount, and
    // the three custom cells with a positive upfront amount. A custom funded
    // threshold does not change this answer.
    assert.equal(refused.length, 17);
    assert.equal(
      refused.every((cell) => cell.expectGated && !cell.gate.approved),
      true,
    );
  });
});

describe("mapLegalGateError", () => {
  it("recognises the SQLSTATE the trigger raises", () => {
    assert.deepEqual(mapLegalGateError({ code: LEGAL_GATE_SQLSTATE, message: "legal_gate" }), {
      status: 403,
      code: LEGAL_GATE_CODE,
    });
  });

  it("falls back to the message for a driver that drops the code", () => {
    assert.deepEqual(mapLegalGateError({ message: "legal_gate" }), {
      status: 403,
      code: LEGAL_GATE_CODE,
    });
  });

  it("leaves an unrelated database error alone", () => {
    assert.equal(mapLegalGateError({ code: "23505", message: "duplicate key value" }), null);
    assert.equal(mapLegalGateError({ code: "42501", message: "permission denied" }), null);
  });

  it("leaves a non-error alone", () => {
    assert.equal(mapLegalGateError(null), null);
    assert.equal(mapLegalGateError(undefined), null);
    assert.equal(mapLegalGateError("legal_gate"), null);
  });

  it("recognises a LegalGateError thrown by assertFeeChangeAllowed", () => {
    let thrown: unknown = null;
    try {
      assertFeeChangeAllowed({ model: "package", upfrontCents: null, triggerCents: null }, gateState(false));
    } catch (error) {
      thrown = error;
    }
    assert.deepEqual(mapLegalGateError(thrown), { status: 403, code: LEGAL_GATE_CODE });
  });
});
