import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { modelAvailability } from "@/lib/fees/handlers";

import {
  feeOptionAvailable,
  parseFeeGateBody,
  parseReceivable,
  parseWorkspaceFeeDefaultsBody,
  readClientFeeDetails,
  readFeeGate,
  readWorkspaceFeeDefaults,
  recordFeePayment,
  reverseFeePayment,
  setClientFeeAgreement,
  type FeeGateRead,
} from "./fees.client.ts";

import type { UpfrontGateState } from "@/lib/fees/types";

/**
 * The upfront-fee legal gate, as the operator surface sees it (T-CL-03,
 * DEC-OWN-CLIENTLIST-AUG18 ruling 7).
 *
 * The defect this pins: `operator.tsx` rendered a `Pending legal review` pill
 * and a permanently disabled Upfront amount field as literals, so the panel
 * kept refusing after the org's `org_flags.upfront_fee_approved` was set true.
 * The pill said something the database had stopped saying.
 *
 * Nothing here transcribes which arrangements are gated. Both fixtures are
 * built by calling `modelAvailability()` — the rule module the route itself
 * answers `/api/fees/models` with, which in turn asks `isGatedFeeChange` about
 * the smallest change that selects each entry. Widen or narrow the gate in one
 * place and these expectations move with it instead of going stale.
 *
 * The database trigger `private.fee_agreement_legal_gate` (migration 091) stays
 * the authority and is untouched: it refuses a gated write whatever this layer
 * believes, which is why an unreadable gate here has to render closed.
 */

const SURFACE = new URL("../../components/surfaces/operator.tsx", import.meta.url);
const surface = fs.readFileSync(SURFACE, "utf8");

function gateState(approved: boolean): UpfrontGateState {
  return {
    approved,
    approvedAt: approved ? "2026-08-18T00:00:00.000Z" : null,
    signoffRef: approved ? "DEC-OWN-CLIENTLIST-AUG18" : null,
  };
}

/** The body `/api/fees/models` returns for an org in that state, built from the
 * rule module rather than written out here. */
function modelsBody(approved: boolean) {
  const gate = gateState(approved);
  return { gate, models: modelAvailability(gate) };
}

const ORG_DEFAULT = {
  customTotalCents: null,
  model: "percentage",
  orgId: "00000000-0000-0000-0000-0000000012a1",
  pct: 12.5,
  successCents: null,
  triggerCents: null,
  upfrontCents: 25_000,
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: "00000000-0000-0000-0000-0000000012b1",
} as const;

const CLIENT_ID = "00000000-0000-0000-0000-0000000012c1";
const PAYMENT_ID = "00000000-0000-0000-0000-0000000012d1";
const AGREEMENT = {
  clientId: CLIENT_ID,
  createdAt: "2026-09-01T08:00:00.000Z",
  customTotalCents: 450_000,
  model: "custom",
  orgId: ORG_DEFAULT.orgId,
  pct: null,
  source: "operator_override",
  status: "active",
  successCents: null,
  triggerCents: 2_500_000,
  updatedAt: "2026-09-01T08:00:00.000Z",
  upfrontCents: null,
} as const;
const PAYMENT = {
  amountCents: 125_050,
  clientId: CLIENT_ID,
  id: PAYMENT_ID,
  method: "bank_transfer",
  note: "First partial payment",
  orgId: ORG_DEFAULT.orgId,
  receivedOn: "2026-09-01",
  recordedAt: "2026-09-01T08:05:00.000Z",
  recordedBy: ORG_DEFAULT.updatedBy,
  reference: "WIRE-42",
  reversedAt: null,
  reversedBy: null,
} as const;
const LEDGER = {
  balanceCents: 324_950,
  clientId: CLIENT_ID,
  orgId: ORG_DEFAULT.orgId,
  outcomeBasisCents: 4_000_000,
  outcomeBasisSource: "approved_outcomes",
  paidCents: 125_050,
  totalCents: 450_000,
  updatedAt: "2026-09-01T08:05:00.000Z",
} as const;

/** Every entry the rule module closes for an unapproved org. */
function gatedIds(): string[] {
  return modelAvailability(gateState(false))
    .filter((row) => !row.available)
    .map((row) => row.id);
}

function stubFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  })) as unknown as typeof fetch;
}

describe("the fee gate read is the route's own answer", () => {
  it("closes at least the upfront option while the org is unapproved", () => {
    const closed = gatedIds();
    assert.ok(
      closed.length > 0,
      "the rule module now gates nothing, so this whole file proves nothing — check isGatedFeeChange",
    );
    assert.ok(
      closed.includes("upfront"),
      "`upfront` is no longer a gated entry; the operator panel's field is keyed to that id",
    );
  });

  it("parses both gate states out of the route body", async () => {
    const refused = await readFeeGate(stubFetch(200, modelsBody(false)));
    const approved = await readFeeGate(stubFetch(200, modelsBody(true)));
    assert.equal(refused.state, "ready");
    assert.equal(approved.state, "ready");
    for (const id of gatedIds()) {
      assert.equal(
        feeOptionAvailable(refused, id),
        false,
        `${id} reads as open for an unapproved org`,
      );
      assert.equal(
        feeOptionAvailable(approved, id),
        true,
        `${id} still reads as closed after the flag was set`,
      );
    }
  });

  it("carries the recorded sign-off reference through", async () => {
    const approved = await readFeeGate(stubFetch(200, modelsBody(true)));
    assert.equal(
      approved.state === "ready" ? approved.signoffRef : null,
      "DEC-OWN-CLIENTLIST-AUG18",
      "the sign-off the approval was filed under no longer reaches the surface",
    );
  });

  it("renders closed for every read that is not a parsed answer", async () => {
    const unready: FeeGateRead[] = [
      { state: "loading" },
      { state: "disabled" },
      { state: "failed" },
      await readFeeGate(stubFetch(404, null)),
      await readFeeGate(stubFetch(500, null)),
      await readFeeGate(stubFetch(200, { gate: { approved: true }, models: "invalid" })),
    ];
    for (const read of unready) {
      assert.equal(
        feeOptionAvailable(read, "upfront"),
        false,
        "a gate the surface could not read rendered open; the trigger refuses by default and so must the panel",
      );
    }
  });

  it("refuses a body whose rows do not carry an availability verdict", () => {
    assert.equal(parseFeeGateBody({ gate: { approved: false, signoffRef: null }, models: [] }), null);
    assert.equal(
      parseFeeGateBody({
        gate: { approved: false, signoffRef: null },
        models: [{ id: "upfront" }],
      }),
      null,
    );
  });
});

describe("the operator panel derives its refusal instead of asserting it", () => {
  it("reads the gate for the id the rule module gates", () => {
    assert.ok(
      surface.includes('feeOptionAvailable(feeGateRead, "upfront")'),
      "the Admin upfront panel no longer asks the gate module whether the upfront option is open",
    );
    assert.ok(
      surface.includes("readWorkspaceFeeDefaults()"),
      "nothing fetches the org-default snapshot, so the surface has no gate state to derive from",
    );
  });

  it("leaves no refusal wording anywhere that the gate value does not govern", () => {
    // Deliberately shape-agnostic, and it has to stay that way. The per-client
    // fee-model control's markup is not stable — it was a native `<select>`
    // with a disabled `<option>` and became a combobox whose entries are plain
    // objects — so an assertion naming either form would start failing on a
    // tree where the defect is still fixed. The invariant that outlives the
    // markup is that every place this surface says "pending legal review" is
    // reached through the gate value rather than written in by hand.
    for (const hit of surface.matchAll(/pending legal review/gi)) {
      const window = surface.slice(
        Math.max(0, hit.index - 400),
        hit.index + 400,
      );
      assert.ok(
        window.includes("upfrontFeeApproved"),
        `a "pending legal review" literal at index ${hit.index} is not governed by the gate value`,
      );
    }
  });

  it("gates the pill and the amount field on that value, not on a literal", () => {
    const section = surface.slice(
      surface.indexOf(">Admin upfront<"),
      surface.indexOf(">Success fee · backend<"),
    );
    assert.ok(section.length > 0, "the Admin upfront section moved; re-anchor this assertion");
    assert.ok(
      section.includes("upfrontFeeApproved ? ("),
      "the pill is no longer chosen by the gate value",
    );
    assert.ok(
      section.includes("disabled={!upfrontFeeApproved}"),
      "the Upfront amount field's disabled state is not derived from the gate",
    );
    assert.ok(
      !/\n\s*disabled\n/.test(section),
      "the Upfront amount field carries a bare `disabled` again, which refuses regardless of the flag",
    );
  });
});

describe("the workspace default read hydrates saved values", () => {
  it("parses the gate and stored arrangement from the same response", async () => {
    const body = { ...modelsBody(true), orgDefault: ORG_DEFAULT };
    const parsed = parseWorkspaceFeeDefaultsBody(body);
    assert.equal(parsed?.state, "ready");
    assert.deepEqual(parsed?.state === "ready" ? parsed.orgDefault : null, ORG_DEFAULT);

    const read = await readWorkspaceFeeDefaults(stubFetch(200, body));
    assert.equal(read.state, "ready");
    assert.equal(read.state === "ready" ? read.orgDefault?.pct : null, 12.5);
  });

  it("distinguishes no configured default from an unreadable body", async () => {
    const absent = await readWorkspaceFeeDefaults(
      stubFetch(200, { ...modelsBody(false), orgDefault: null }),
    );
    assert.deepEqual(
      absent.state === "ready" ? absent.orgDefault : "failed",
      null,
    );
    assert.equal(
      (await readWorkspaceFeeDefaults(stubFetch(200, modelsBody(false)))).state,
      "failed",
    );
    assert.equal(
      (await readWorkspaceFeeDefaults(stubFetch(200, {
        ...modelsBody(false),
        orgDefault: { ...ORG_DEFAULT, upfrontCents: 12.5 },
      }))).state,
      "failed",
    );
  });

  it("renders the saved funded basis and removes the stale no-read warning", () => {
    assert.ok(surface.includes("formatDemoMoney(row.outcomeBasisCents / 100)"));
    assert.ok(surface.includes("setDefaultSuccessFeePct(saved.pct ?? 0)"));
    assert.ok(surface.includes("setDefaultCustomFee((saved.customTotalCents ?? 0) / 100)"));
    assert.equal(
      surface.includes("A workspace default that was saved earlier cannot be read back"),
      false,
    );
  });
});

describe("the receivables parser keeps unconfigured active clients editable", () => {
  it("accepts null agreement fields with honest zero values and requires funded basis", () => {
    const row = {
      balanceCents: 0,
      clientId: "00000000-0000-0000-0000-0000000012c2",
      displayName: "New Client",
      lastPaymentOn: null,
      model: null,
      outcomeBasisCents: 0,
      paidCents: 0,
      status: null,
      totalCents: 0,
    };
    assert.deepEqual(parseReceivable(row), row);
    const withoutBasis: Record<string, unknown> = { ...row };
    delete withoutBasis.outcomeBasisCents;
    assert.equal(parseReceivable(withoutBasis), null);
  });
});

describe("the per-client fee ledger client", () => {
  it("reads the agreement, authoritative balance, and full payment history together", async () => {
    const read = await readClientFeeDetails(
      CLIENT_ID,
      stubFetch(200, {
        agreement: AGREEMENT,
        clientId: CLIENT_ID,
        ledger: LEDGER,
        payments: [PAYMENT, { ...PAYMENT, id: `${PAYMENT_ID.slice(0, -1)}2`, reversedAt: "2026-09-01T09:00:00.000Z", reversedBy: ORG_DEFAULT.updatedBy }],
      }),
    );

    assert.equal(read.state, "ready");
    assert.equal(read.state === "ready" ? read.fees.ledger?.balanceCents : null, 324_950);
    assert.equal(read.state === "ready" ? read.fees.payments.length : null, 2);
    assert.equal(read.state === "ready" ? read.fees.payments[1]?.reversedAt : null, "2026-09-01T09:00:00.000Z");
  });

  it("records an arbitrary partial payment with its reconciliation fields", async () => {
    const calls: Array<{ input: RequestInit | undefined; url: string }> = [];
    const fetcher = (async (url: string | URL | Request, input?: RequestInit) => {
      calls.push({ input, url: String(url) });
      return {
        json: async () => ({ payment: PAYMENT }),
        ok: true,
        status: 201,
      };
    }) as typeof fetch;

    const result = await recordFeePayment(
      CLIENT_ID,
      {
        amountCents: PAYMENT.amountCents,
        method: PAYMENT.method,
        note: PAYMENT.note,
        receivedOn: PAYMENT.receivedOn,
        reference: PAYMENT.reference,
      },
      fetcher,
    );

    assert.deepEqual(result, { ok: true, value: PAYMENT });
    assert.equal(calls[0]?.url, `/api/fees/${CLIENT_ID}/payments`);
    assert.deepEqual(JSON.parse(String(calls[0]?.input?.body)), {
      amountCents: 125_050,
      method: "bank_transfer",
      note: "First partial payment",
      receivedOn: "2026-09-01",
      reference: "WIRE-42",
    });
  });

  it("rejects a successful write response that does not read back the same client", async () => {
    const result = await recordFeePayment(
      CLIENT_ID,
      {
        amountCents: PAYMENT.amountCents,
        method: PAYMENT.method,
        note: null,
        receivedOn: PAYMENT.receivedOn,
        reference: null,
      },
      stubFetch(201, { payment: { ...PAYMENT, clientId: "00000000-0000-0000-0000-0000000012c9" } }),
    );
    assert.deepEqual(result, { ok: false });
  });

  it("parses create, amend, void, and reactivate responses from the agreement writer", async () => {
    for (const status of ["active", "void", "active"] as const) {
      const input = {
        customTotalCents: AGREEMENT.customTotalCents,
        model: AGREEMENT.model,
        pct: null,
        status,
        successCents: null,
        triggerCents: AGREEMENT.triggerCents,
        upfrontCents: null,
      };
      const result = await setClientFeeAgreement(
        CLIENT_ID,
        input,
        stubFetch(200, { agreement: { ...AGREEMENT, status } }),
      );
      assert.equal(result.ok, true);
      assert.equal(result.ok ? result.value.status : null, status);
    }
  });

  it("accepts a reversal only when the returned ledger row is the requested reversed payment", async () => {
    const reversed = {
      ...PAYMENT,
      reversedAt: "2026-09-01T09:00:00.000Z",
      reversedBy: ORG_DEFAULT.updatedBy,
    };
    assert.deepEqual(
      await reverseFeePayment(PAYMENT_ID, stubFetch(200, { payment: reversed })),
      { ok: true, value: reversed },
    );
    assert.deepEqual(
      await reverseFeePayment(PAYMENT_ID, stubFetch(200, { payment: PAYMENT })),
      { ok: false },
    );
  });
});
