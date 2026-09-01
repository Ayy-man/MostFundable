import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LEGAL_GATE_SQLSTATE, mapLegalGateError } from "./legal-gate.ts";
import {
  computeBalanceCents,
  computePaidCents,
  computeTotalCents,
  listOrgReceivables,
  readOrgDefault,
  setAgreement,
  setOrgDefault,
} from "./service.ts";

import type { FeeRepository } from "./service.ts";
import type { FeesRpcClient } from "./repository.ts";
import type { FeeAgreementInput, FeePayment, UpfrontGateState } from "./types.ts";

// No database. The repository is a stub that records what it was asked for, so
// what is under test here is the arithmetic and the ordering of the gate check
// against the write — the two things the routes must not have to re-derive.

const CLIENT = {} as FeesRpcClient;
const ORG_ID = "00000000-0000-0000-0000-0000000012a1";
const CLIENT_ID = "00000000-0000-0000-0000-0000000012c1";

const GATE_OPEN: UpfrontGateState = {
  approved: true,
  signoffRef: "LGL-2026-0001",
  approvedAt: "2026-08-16T00:00:00.000Z",
};
const GATE_CLOSED: UpfrontGateState = {
  approved: false,
  signoffRef: null,
  approvedAt: null,
};

interface Call {
  name: string;
  args: unknown[];
}

function stubRepository(gate: UpfrontGateState, calls: Call[]): FeeRepository {
  const unexpected = (name: string) => async (...args: unknown[]) => {
    calls.push({ name, args });
    throw new Error(`unexpected call: ${name}`);
  };

  return {
    async readUpfrontGateState(...args) {
      calls.push({ name: "readUpfrontGateState", args });
      return { ok: true, value: gate };
    },
    async readOrgDefault(...args) {
      calls.push({ name: "readOrgDefault", args });
      return { ok: true, value: null };
    },
    async setAgreement(...args) {
      calls.push({ name: "setAgreement", args });
      return {
        ok: true,
        value: {
          clientId: CLIENT_ID,
          orgId: ORG_ID,
          model: "percentage",
          pct: 10,
          upfrontCents: null,
          successCents: null,
          triggerCents: null,
          customTotalCents: null,
          status: "active",
          source: "operator_override",
          createdAt: "2026-08-16T00:00:00.000Z",
          updatedAt: "2026-08-16T00:00:00.000Z",
        },
      };
    },
    async setOrgDefault(...args) {
      calls.push({ name: "setOrgDefault", args });
      return {
        ok: true,
        value: {
          orgId: ORG_ID,
          model: "percentage",
          pct: 10,
          upfrontCents: null,
          successCents: null,
          triggerCents: null,
          customTotalCents: null,
          updatedBy: null,
          updatedAt: "2026-08-16T00:00:00.000Z",
        },
      };
    },
    async listOrgReceivables(...args) {
      calls.push({ name: "listOrgReceivables", args });
      return { ok: true, value: [] };
    },
    setUpfrontApproval: unexpected("setUpfrontApproval") as FeeRepository["setUpfrontApproval"],
    recordPayment: unexpected("recordPayment") as FeeRepository["recordPayment"],
    reversePayment: unexpected("reversePayment") as FeeRepository["reversePayment"],
    readClientFees: unexpected("readClientFees") as FeeRepository["readClientFees"],
  };
}

function payment(amountCents: number, reversed: boolean): FeePayment {
  return {
    id: "00000000-0000-0000-0000-0000000012d1",
    clientId: CLIENT_ID,
    orgId: ORG_ID,
    amountCents,
    receivedOn: "2026-08-16",
    method: "bank_transfer",
    reference: null,
    note: null,
    recordedBy: null,
    recordedAt: "2026-08-16T00:00:00.000Z",
    reversedAt: reversed ? "2026-08-16T01:00:00.000Z" : null,
    reversedBy: reversed ? "00000000-0000-0000-0000-0000000012b1" : null,
  };
}

describe("computeTotalCents", () => {
  it("takes the percentage of the approved outcome", () => {
    assert.equal(
      computeTotalCents({ model: "percentage", pct: 10, status: "active" }, 1_000_000),
      100_000,
    );
    assert.equal(
      computeTotalCents({ model: "percentage", pct: 12.5, status: "active" }, 1_000_000),
      125_000,
    );
  });

  it("is zero while no outcome has been approved", () => {
    // Not unknown, and not an error. A percentage of nothing is nothing, and
    // this is what every percentage client reads until Phase 11 calls the seam.
    assert.equal(computeTotalCents({ model: "percentage", pct: 10, status: "active" }, 0), 0);
  });

  it("rounds once, the way the SQL does", () => {
    // 0.01% of 150 cents is 0.015 cents.
    assert.equal(computeTotalCents({ model: "percentage", pct: 0.01, status: "active" }, 150), 0);
    // 0.5% of 100 cents is exactly half a cent, and rounds up in both languages.
    assert.equal(computeTotalCents({ model: "percentage", pct: 0.5, status: "active" }, 100), 1);
    // Two decimal places is the whole domain of numeric(5,2).
    assert.equal(computeTotalCents({ model: "percentage", pct: 33.33, status: "active" }, 999_999), 333_300);
  });

  it("treats a missing rate as zero rather than as a fault", () => {
    assert.equal(computeTotalCents({ model: "percentage", pct: null, status: "active" }, 1_000_000), 0);
  });

  it("uses the stated figure for a custom agreement", () => {
    assert.equal(
      computeTotalCents({ model: "custom", customTotalCents: 400_000, status: "active" }, 9_999_999),
      400_000,
    );
  });

  it("owes a flat success fee only after its funded trigger is reached", () => {
    const agreement = {
      customTotalCents: 700_000,
      model: "custom" as const,
      status: "active" as const,
      triggerCents: 5_000_000,
    };
    assert.equal(computeTotalCents(agreement, 4_999_999), 0);
    assert.equal(computeTotalCents(agreement, 5_000_000), 700_000);
    assert.equal(computeTotalCents(agreement, 8_000_000), 700_000);
  });

  it("sums the three amounts of a package agreement", () => {
    assert.equal(
      computeTotalCents(
        {
          model: "package",
          upfrontCents: 150_000,
          successCents: 250_000,
          triggerCents: 50_000,
          status: "active",
        },
        0,
      ),
      450_000,
    );
  });

  it("totals zero for a withdrawn agreement whatever its shape", () => {
    assert.equal(
      computeTotalCents(
        { model: "package", upfrontCents: 150_000, successCents: 250_000, status: "void" },
        0,
      ),
      0,
    );
    assert.equal(computeTotalCents({ model: "percentage", pct: 10, status: "void" }, 1_000_000), 0);
  });

  it("totals zero when there is no agreement at all", () => {
    assert.equal(computeTotalCents(null, 1_000_000), 0);
  });
});

describe("computePaidCents and computeBalanceCents", () => {
  it("sums what was received and ignores what was reversed", () => {
    assert.equal(computePaidCents([payment(25_000, false), payment(10_000, false)]), 35_000);
    assert.equal(computePaidCents([payment(25_000, false), payment(10_000, true)]), 25_000);
    assert.equal(computePaidCents([]), 0);
  });

  it("lets the balance go negative on an overpayment", () => {
    // Recording what actually happened is more useful than refusing to, and the
    // generated column in the database behaves the same way.
    assert.equal(computeBalanceCents(100_000, 125_000), -25_000);
    assert.equal(computeBalanceCents(100_000, 25_000), 75_000);
  });

  it("agrees with the ledger arithmetic end to end", () => {
    const total = computeTotalCents({ model: "percentage", pct: 10, status: "active" }, 1_000_000);
    const paid = computePaidCents([payment(25_000, false)]);
    assert.equal(computeBalanceCents(total, paid), 75_000);
  });
});

describe("setAgreement", () => {
  const packageInput: FeeAgreementInput = {
    model: "package",
    pct: null,
    upfrontCents: 150_000,
    successCents: 250_000,
    triggerCents: null,
    customTotalCents: null,
    status: "active",
  };
  const percentageInput: FeeAgreementInput = {
    model: "percentage",
    pct: 10,
    upfrontCents: null,
    successCents: null,
    triggerCents: null,
    customTotalCents: null,
    status: "active",
  };

  it("refuses a gated change against a closed gate without touching the write", async () => {
    const calls: Call[] = [];
    const result = await setAgreement(CLIENT, CLIENT_ID, ORG_ID, packageInput, {
      repository: stubRepository(GATE_CLOSED, calls),
    });

    assert.deepEqual(result, { ok: false, reason: "legal_gate" });
    assert.deepEqual(
      calls.map((call) => call.name),
      ["readUpfrontGateState"],
    );
  });

  it("writes a gated change once the gate is open", async () => {
    const calls: Call[] = [];
    const result = await setAgreement(CLIENT, CLIENT_ID, ORG_ID, packageInput, {
      repository: stubRepository(GATE_OPEN, calls),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      calls.map((call) => call.name),
      ["readUpfrontGateState", "setAgreement"],
    );
  });

  it("allows a gated agreement to be voided after approval is withdrawn", async () => {
    const calls: Call[] = [];
    const result = await setAgreement(
      CLIENT,
      CLIENT_ID,
      ORG_ID,
      { ...packageInput, status: "void" },
      { repository: stubRepository(GATE_CLOSED, calls) },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((call) => call.name), ["setAgreement"]);
    assert.equal(
      (calls[0]?.args[2] as FeeAgreementInput | undefined)?.status,
      "void",
    );
  });

  it("writes an un-gated change against a closed gate", async () => {
    const calls: Call[] = [];
    const result = await setAgreement(CLIENT, CLIENT_ID, ORG_ID, percentageInput, {
      repository: stubRepository(GATE_CLOSED, calls),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      calls.map((call) => call.name),
      ["readUpfrontGateState", "setAgreement"],
    );
  });

  it("passes the input through unchanged", async () => {
    const calls: Call[] = [];
    await setAgreement(CLIENT, CLIENT_ID, ORG_ID, percentageInput, {
      repository: stubRepository(GATE_CLOSED, calls),
    });

    const write = calls.find((call) => call.name === "setAgreement");
    assert.deepEqual(write?.args[2], percentageInput);
  });
});

describe("setOrgDefault", () => {
  it("applies the same gate to a workspace default", async () => {
    const calls: Call[] = [];
    const result = await setOrgDefault(
      CLIENT,
      ORG_ID,
      {
        model: "package",
        pct: null,
        upfrontCents: 150_000,
        successCents: 250_000,
        triggerCents: null,
        customTotalCents: null,
      },
      { repository: stubRepository(GATE_CLOSED, calls) },
    );

    assert.deepEqual(result, { ok: false, reason: "legal_gate" });
    assert.deepEqual(
      calls.map((call) => call.name),
      ["readUpfrontGateState"],
    );
  });
});

describe("readOrgDefault", () => {
  it("passes the session client and org id to the read repository", async () => {
    const calls: Call[] = [];
    const result = await readOrgDefault(CLIENT, ORG_ID, {
      repository: stubRepository(GATE_OPEN, calls),
    });

    assert.deepEqual(result, { ok: true, value: null });
    assert.deepEqual(calls.map((call) => call.name), ["readOrgDefault"]);
    assert.deepEqual(calls[0]?.args, [CLIENT, ORG_ID]);
  });
});

describe("listOrgReceivables", () => {
  it("bounds the window the caller asked for", async () => {
    const calls: Call[] = [];
    await listOrgReceivables(CLIENT, ORG_ID, 100_000, -5, {
      repository: stubRepository(GATE_OPEN, calls),
    });

    const call = calls.find((entry) => entry.name === "listOrgReceivables");
    assert.equal(call?.args[2], 200);
    assert.equal(call?.args[3], 0);
  });

  it("uses the default window when none is given", async () => {
    const calls: Call[] = [];
    await listOrgReceivables(CLIENT, ORG_ID, undefined, undefined, {
      repository: stubRepository(GATE_OPEN, calls),
    });

    const call = calls.find((entry) => entry.name === "listOrgReceivables");
    assert.equal(call?.args[2], 50);
    assert.equal(call?.args[3], 0);
  });
});

describe("mapLegalGateError over a PostgREST-shaped error", () => {
  it("maps the gate refusal and leaves everything else alone", () => {
    assert.deepEqual(
      mapLegalGateError({
        code: LEGAL_GATE_SQLSTATE,
        message: "legal_gate",
        details: "org has no recorded legal sign-off",
        hint: null,
      }),
      { status: 403, code: "legal_gate" },
    );
    assert.equal(
      mapLegalGateError({ code: "23514", message: "new row violates check constraint" }),
      null,
    );
  });
});
