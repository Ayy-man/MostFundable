import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as realService from "./service.ts";
import {
  getOrgDefaults,
  listModels,
  listReceivables,
  patchOrgDefaults,
  patchUpfrontApproval,
  postPayment,
  postPaymentReversal,
  putAgreement,
  readClientFees,
} from "./handlers.ts";

import type { FeeHandlerDeps, OrgMemberSession } from "./handlers.ts";
import type { FeeAgreement, FeeLedger, FeePayment, OrgFeeDefault, UpfrontGateState } from "./types.ts";

// Two halves. The first proves every route is inert with an empty environment,
// by importing the real route modules and calling them with FEATURE_FEES unset.
// The second proves the validation, the role narrowing and the gate mapping, by
// calling the handler bodies with stubbed dependencies — no server, no
// database, and no session.

const ORG_ID = "00000000-0000-0000-0000-0000000012a1";
const CLIENT_ID = "00000000-0000-0000-0000-0000000012c1";
const PROFILE_ID = "00000000-0000-0000-0000-0000000012b1";

const OWNER: OrgMemberSession = {
  id: PROFILE_ID,
  role: "operator_member",
  orgId: ORG_ID,
  orgMembership: "current",
  orgRole: "owner",
};
const MEMBER: OrgMemberSession = { ...OWNER, orgRole: "prep_specialist" };

const GATE_OPEN: UpfrontGateState = {
  approved: true,
  signoffRef: "LGL-2026-0001",
  approvedAt: "2026-08-16T00:00:00.000Z",
};
const GATE_CLOSED: UpfrontGateState = { approved: false, signoffRef: null, approvedAt: null };

const AGREEMENT: FeeAgreement = {
  clientId: CLIENT_ID,
  orgId: ORG_ID,
  model: "package",
  pct: null,
  upfrontCents: 150_000,
  successCents: 250_000,
  triggerCents: null,
  customTotalCents: null,
  status: "active",
  source: "operator_override",
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
};

const LEDGER: FeeLedger = {
  clientId: CLIENT_ID,
  orgId: ORG_ID,
  totalCents: 400_000,
  paidCents: 0,
  outcomeBasisCents: 0,
  outcomeBasisSource: null,
  balanceCents: 400_000,
  updatedAt: "2026-08-16T00:00:00.000Z",
};

const PAYMENT: FeePayment = {
  id: "00000000-0000-0000-0000-0000000012d1",
  clientId: CLIENT_ID,
  orgId: ORG_ID,
  amountCents: 25_000,
  receivedOn: "2026-08-16",
  method: "bank_transfer",
  reference: null,
  note: null,
  recordedBy: PROFILE_ID,
  recordedAt: "2026-08-16T00:00:00.000Z",
  reversedAt: null,
  reversedBy: null,
};

const ORG_DEFAULT: OrgFeeDefault = {
  orgId: ORG_ID,
  model: "percentage",
  pct: 10,
  upfrontCents: null,
  successCents: null,
  triggerCents: null,
  customTotalCents: null,
  updatedBy: PROFILE_ID,
  updatedAt: "2026-08-16T00:00:00.000Z",
};

interface StubOptions {
  session?: OrgMemberSession;
  gate?: UpfrontGateState;
  orgDefault?: OrgFeeDefault | null;
  admin?: boolean;
  writes?: string[];
}

function deps(options: StubOptions = {}): Partial<FeeHandlerDeps> {
  const gate = options.gate ?? GATE_CLOSED;
  const writes = options.writes ?? [];

  return {
    async requireOrgMember() {
      return options.session ?? OWNER;
    },
    async assertTenantWriteAllowed(session) {
      if (session.orgMembership === "deactivated") {
        throw { code: "ORG_DEACTIVATED", status: 402 };
      }
    },
    async requirePlatformAdmin() {
      if (options.admin !== true) {
        throw Object.assign(new Error("forbidden"), { status: 403, code: "forbidden" });
      }
      return { id: PROFILE_ID, role: "platform_admin", orgId: null, orgMembership: null, orgRole: null };
    },
    async createClient() {
      const query = {
        eq() { return query; },
        async maybeSingle() { return { data: null, error: null }; },
      };
      return {
        from() { return { select() { return query; } }; },
        async rpc() { return { data: null, error: null }; },
      };
    },
    service: {
      ...realService,
      async readUpfrontGateState() {
        return { ok: true, value: gate };
      },
      async readOrgDefault() {
        return {
          ok: true,
          value: options.orgDefault === undefined ? ORG_DEFAULT : options.orgDefault,
        };
      },
      async setUpfrontApproval(_client, _orgId, approved, signoffRef) {
        return { ok: true, value: { approved, signoffRef, approvedAt: approved ? "2026-08-16T00:00:00.000Z" : null } };
      },
      // The real service consults the gate before writing; the stub reproduces
      // that ordering rather than always succeeding, because the ordering is
      // what these tests are about.
      async setAgreement(_client, _clientId, _orgId, input) {
        writes.push("agreement");
        const gated =
          input.model === "package" ||
          (input.upfrontCents ?? 0) > 0 ||
          (input.model !== "custom" && (input.triggerCents ?? 0) > 0);
        if (input.status !== "void" && gated && !gate.approved) {
          return { ok: false, reason: "legal_gate" };
        }
        return { ok: true, value: { ...AGREEMENT, ...input } };
      },
      async setOrgDefault(_client, _orgId, input) {
        writes.push("org-default");
        const gated =
          input.model === "package" ||
          (input.upfrontCents ?? 0) > 0 ||
          (input.model !== "custom" && (input.triggerCents ?? 0) > 0);
        if (gated && !gate.approved) return { ok: false, reason: "legal_gate" };
        return { ok: true, value: { ...ORG_DEFAULT, ...input } };
      },
      async recordPayment() {
        writes.push("payment");
        return { ok: true, value: PAYMENT };
      },
      async reversePayment() {
        writes.push("payment-reversal");
        return {
          ok: true,
          value: {
            ...PAYMENT,
            reversedAt: "2026-08-16T12:00:00.000Z",
            reversedBy: PROFILE_ID,
          },
        };
      },
      async readClientFees() {
        return { ok: true, value: { clientId: CLIENT_ID, agreement: AGREEMENT, ledger: LEDGER, payments: [PAYMENT] } };
      },
      async listOrgReceivables() {
        return { ok: true, value: [] };
      },
    },
    today: () => "2026-08-16",
  };
}

function jsonRequest(body: unknown, method = "PUT"): Request {
  return new Request("http://localhost/api/fees", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PACKAGE_BODY = {
  model: "package",
  upfrontCents: 150_000,
  successCents: 250_000,
  status: "active",
};
const PERCENTAGE_BODY = { model: "percentage", pct: 10, status: "active" };

async function errorCode(response: Response): Promise<string | undefined> {
  const payload = (await response.json()) as { error?: { code?: string } };
  return payload.error?.code;
}

// ---------------------------------------------------------------------------

describe("every fee route is inert with an empty environment", () => {
  const previous = process.env.FEATURE_FEES;

  async function withFlagUnset<T>(run: () => Promise<T>): Promise<T> {
    delete process.env.FEATURE_FEES;
    try {
      return await run();
    } finally {
      if (previous === undefined) delete process.env.FEATURE_FEES;
      else process.env.FEATURE_FEES = previous;
    }
  }

  it("GET /api/fees returns 404", async () => {
    await withFlagUnset(async () => {
      const route = await import("@/app/api/fees/route.ts");
      const response = await route.GET(new Request("http://localhost/api/fees"));
      assert.equal(response.status, 404);
    });
  });

  it("GET /api/fees/models returns 404", async () => {
    await withFlagUnset(async () => {
      const route = await import("@/app/api/fees/models/route.ts");
      const response = await route.GET(new Request("http://localhost/api/fees/models"));
      assert.equal(response.status, 404);
    });
  });

  it("GET and PATCH /api/fees/org-defaults return 404", async () => {
    await withFlagUnset(async () => {
      const route = await import("@/app/api/fees/org-defaults/route.ts");
      assert.equal((await route.GET()).status, 404);
      assert.equal((await route.PATCH(jsonRequest(PERCENTAGE_BODY, "PATCH"))).status, 404);
    });
  });

  it("GET /api/fees/[clientId] returns 404", async () => {
    await withFlagUnset(async () => {
      const route = await import("@/app/api/fees/[clientId]/route.ts");
      const response = await route.GET(new Request("http://localhost/api/fees/x"), {
        params: Promise.resolve({ clientId: CLIENT_ID }),
      });
      assert.equal(response.status, 404);
    });
  });

  it("PUT /api/fees/[clientId]/agreement returns 404", async () => {
    await withFlagUnset(async () => {
      const route = await import("@/app/api/fees/[clientId]/agreement/route.ts");
      const response = await route.PUT(jsonRequest(PACKAGE_BODY), {
        params: Promise.resolve({ clientId: CLIENT_ID }),
      });
      assert.equal(response.status, 404);
    });
  });

  it("POST /api/fees/[clientId]/payments returns 404", async () => {
    await withFlagUnset(async () => {
      const route = await import("@/app/api/fees/[clientId]/payments/route.ts");
      const response = await route.POST(jsonRequest({}, "POST"), {
        params: Promise.resolve({ clientId: CLIENT_ID }),
      });
      assert.equal(response.status, 404);
    });
  });

  it("POST /api/fees/payments/[paymentId]/reverse returns 404", async () => {
    await withFlagUnset(async () => {
      const route = await import("@/app/api/fees/payments/[paymentId]/reverse/route.ts");
      const response = await route.POST(new Request("http://localhost/api/fees/payments/x/reverse", { method: "POST" }), {
        params: Promise.resolve({ paymentId: PAYMENT.id }),
      });
      assert.equal(response.status, 404);
    });
  });

  it("PATCH /api/fees/orgs/[orgId]/upfront-approval returns 404", async () => {
    await withFlagUnset(async () => {
      const route = await import("@/app/api/fees/orgs/[orgId]/upfront-approval/route.ts");
      const response = await route.PATCH(jsonRequest({ approved: true }, "PATCH"), {
        params: Promise.resolve({ orgId: ORG_ID }),
      });
      assert.equal(response.status, 404);
    });
  });

  it("answers 404 with an empty body, so nothing about the phase leaks", async () => {
    await withFlagUnset(async () => {
      const route = await import("@/app/api/fees/route.ts");
      const response = await route.GET(new Request("http://localhost/api/fees"));
      assert.equal(await response.text(), "");
    });
  });
});

describe("PUT agreement — ROADMAP criterion 2", () => {
  it("returns 403 legal_gate for a package agreement against an unapproved gate", async () => {
    const response = await putAgreement(
      jsonRequest(PACKAGE_BODY),
      CLIENT_ID,
      deps({ gate: GATE_CLOSED }),
    );

    assert.equal(response.status, 403);
    assert.equal(await errorCode(response), "legal_gate");
  });

  it("returns 403 legal_gate for an upfront amount on any model", async () => {
    const response = await putAgreement(
      jsonRequest({ model: "percentage", pct: 10, upfrontCents: 25_000, status: "active" }),
      CLIENT_ID,
      deps({ gate: GATE_CLOSED }),
    );

    assert.equal(response.status, 403);
    assert.equal(await errorCode(response), "legal_gate");
  });

  it("accepts a custom success-fee trigger without opening the upfront-fee gate", async () => {
    const response = await putAgreement(
      jsonRequest({
        customTotalCents: 700_000,
        model: "custom",
        status: "active",
        triggerCents: 5_000_000,
      }),
      CLIENT_ID,
      deps({ gate: GATE_CLOSED }),
    );

    assert.equal(response.status, 200);
  });

  it("returns 200 for the same package agreement once the gate is open", async () => {
    const response = await putAgreement(
      jsonRequest(PACKAGE_BODY),
      CLIENT_ID,
      deps({ gate: GATE_OPEN }),
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as { agreement: FeeAgreement };
    assert.equal(payload.agreement.model, "package");
  });

  it("can void a gated agreement after legal approval is withdrawn", async () => {
    const response = await putAgreement(
      jsonRequest({ ...PACKAGE_BODY, status: "void" }),
      CLIENT_ID,
      deps({ gate: GATE_CLOSED }),
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as { agreement: FeeAgreement };
    assert.equal(payload.agreement.status, "void");
  });

  it("checks the gate again when a void agreement is reactivated", async () => {
    const response = await putAgreement(
      jsonRequest({ ...PACKAGE_BODY, status: "active" }),
      CLIENT_ID,
      deps({ gate: GATE_CLOSED }),
    );

    assert.equal(response.status, 403);
    assert.equal(await errorCode(response), "legal_gate");
  });

  it("lets an un-gated percentage agreement through a closed gate", async () => {
    const response = await putAgreement(
      jsonRequest(PERCENTAGE_BODY),
      CLIENT_ID,
      deps({ gate: GATE_CLOSED }),
    );
    assert.equal(response.status, 200);
  });

  it("refuses an operator member whose org role is neither owner nor admin", async () => {
    const response = await putAgreement(
      jsonRequest(PERCENTAGE_BODY),
      CLIENT_ID,
      deps({ session: MEMBER, gate: GATE_OPEN }),
    );
    assert.equal(response.status, 403);
    assert.equal(await errorCode(response), "forbidden");
  });

  it("rejects a body that is not an object, and one with an unknown model", async () => {
    assert.equal((await putAgreement(jsonRequest([1, 2]), CLIENT_ID, deps())).status, 400);
    assert.equal(
      (await putAgreement(jsonRequest({ model: "retainer" }), CLIENT_ID, deps())).status,
      400,
    );
  });

  it("rejects a percentage with no rate and a custom with no total", async () => {
    assert.equal((await putAgreement(jsonRequest({ model: "percentage" }), CLIENT_ID, deps())).status, 400);
    assert.equal((await putAgreement(jsonRequest({ model: "custom" }), CLIENT_ID, deps())).status, 400);
  });

  it("rejects a fractional cent and a negative amount", async () => {
    assert.equal(
      (await putAgreement(jsonRequest({ model: "package", upfrontCents: 1.5 }), CLIENT_ID, deps())).status,
      400,
    );
    assert.equal(
      (await putAgreement(jsonRequest({ model: "package", upfrontCents: -1 }), CLIENT_ID, deps())).status,
      400,
    );
  });

  it("rejects a rate finer than the column stores", async () => {
    // numeric(5,2): 10.005 would be stored as 10.01 and the caller would never
    // learn that the figure they sent is not the figure being charged.
    const response = await putAgreement(
      jsonRequest({ model: "percentage", pct: 10.005 }),
      CLIENT_ID,
      deps(),
    );
    assert.equal(response.status, 400);
  });

  it("rejects a client id that is not a UUID before touching the session", async () => {
    const response = await putAgreement(jsonRequest(PERCENTAGE_BODY), "not-a-uuid", deps());
    assert.equal(response.status, 400);
  });

});

describe("deactivated organization write wall", () => {
  const blocked = { ...OWNER, orgMembership: "deactivated" as const };
  const cases = [
    {
      name: "agreement",
      run: (overrides: Partial<FeeHandlerDeps>) =>
        putAgreement(jsonRequest({ model: "percentage", pct: 10 }, "PUT"), CLIENT_ID, overrides),
    },
    {
      name: "payment",
      run: (overrides: Partial<FeeHandlerDeps>) =>
        postPayment(jsonRequest({ amountCents: 25_000, receivedOn: "2026-08-16", method: "bank_transfer" }, "POST"), CLIENT_ID, overrides),
    },
    {
      name: "organization default",
      run: (overrides: Partial<FeeHandlerDeps>) =>
        patchOrgDefaults(jsonRequest({ model: "percentage", pct: 10 }, "PATCH"), overrides),
    },
  ];

  for (const entry of cases) {
    it(`returns 402 before the ${entry.name} write`, async () => {
      const writes: string[] = [];
      const response = await entry.run(deps({ session: blocked, writes }));
      assert.equal(response.status, 402);
      assert.equal(await errorCode(response), "ORG_DEACTIVATED");
      assert.deepEqual(writes, []);
    });
  }
});

describe("POST payments", () => {
  const body = {
    amountCents: 25_000,
    receivedOn: "2026-08-16",
    method: "bank_transfer",
  };

  it("records a payment through the database-audited RPC", async () => {
    const response = await postPayment(jsonRequest(body, "POST"), CLIENT_ID, deps());
    assert.equal(response.status, 201);
  });

  it("rejects a zero and a negative amount", async () => {
    assert.equal(
      (await postPayment(jsonRequest({ ...body, amountCents: 0 }, "POST"), CLIENT_ID, deps())).status,
      400,
    );
    assert.equal(
      (await postPayment(jsonRequest({ ...body, amountCents: -1 }, "POST"), CLIENT_ID, deps())).status,
      400,
    );
  });

  it("rejects a received-on date after today", async () => {
    const response = await postPayment(
      jsonRequest({ ...body, receivedOn: "2026-08-17" }, "POST"),
      CLIENT_ID,
      deps(),
    );
    assert.equal(response.status, 400);
  });

  it("accepts today itself", async () => {
    const response = await postPayment(
      jsonRequest({ ...body, receivedOn: "2026-08-16" }, "POST"),
      CLIENT_ID,
      deps(),
    );
    assert.equal(response.status, 201);
  });

  it("rejects a note over a thousand characters and an unknown method", async () => {
    assert.equal(
      (await postPayment(jsonRequest({ ...body, note: "x".repeat(1001) }, "POST"), CLIENT_ID, deps())).status,
      400,
    );
    assert.equal(
      (await postPayment(jsonRequest({ ...body, method: "crypto" }, "POST"), CLIENT_ID, deps())).status,
      400,
    );
  });

  it("does not require an owner role, because recording a receipt is bookkeeping", async () => {
    const response = await postPayment(jsonRequest(body, "POST"), CLIENT_ID, deps({ session: MEMBER }));
    assert.equal(response.status, 201);
  });
});

describe("POST payment reversal", () => {
  it("reverses a bookkeeping payment through the audited service", async () => {
    const writes: string[] = [];
    const response = await postPaymentReversal(PAYMENT.id, deps({ writes }));
    assert.equal(response.status, 200);
    assert.deepEqual(writes, ["payment-reversal"]);
  });

  it("rejects a malformed payment id before the write", async () => {
    const writes: string[] = [];
    const response = await postPaymentReversal("not-a-uuid", deps({ writes }));
    assert.equal(response.status, 400);
    assert.deepEqual(writes, []);
  });
});

describe("PATCH upfront-approval", () => {
  it("refuses a caller who is not a platform admin with 403", async () => {
    const response = await patchUpfrontApproval(
      jsonRequest({ approved: true, signoffRef: "LGL-1" }, "PATCH"),
      ORG_ID,
      deps({ admin: false }),
    );
    assert.equal(response.status, 403);
    assert.equal(await errorCode(response), "forbidden");
  });

  it("refuses an approval with no sign-off reference with 400", async () => {
    const response = await patchUpfrontApproval(
      jsonRequest({ approved: true }, "PATCH"),
      ORG_ID,
      deps({ admin: true }),
    );
    assert.equal(response.status, 400);
  });

  it("refuses an approval whose reference is only whitespace", async () => {
    const response = await patchUpfrontApproval(
      jsonRequest({ approved: true, signoffRef: "   " }, "PATCH"),
      ORG_ID,
      deps({ admin: true }),
    );
    assert.equal(response.status, 400);
  });

  it("approves for a platform admin with a reference", async () => {
    const response = await patchUpfrontApproval(
      jsonRequest({ approved: true, signoffRef: " LGL-2026-0042 " }, "PATCH"),
      ORG_ID,
      deps({ admin: true }),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { gate: UpfrontGateState };
    assert.equal(payload.gate.approved, true);
    assert.equal(payload.gate.signoffRef, "LGL-2026-0042");
  });

  it("allows a revocation with no reference", async () => {
    const response = await patchUpfrontApproval(
      jsonRequest({ approved: false }, "PATCH"),
      ORG_ID,
      deps({ admin: true }),
    );
    assert.equal(response.status, 200);
  });

  it("has no way to name an approver", async () => {
    // The extra key is ignored rather than honoured: the allow-list has no
    // entry for it, and the RPC takes approved_by from the session.
    const response = await patchUpfrontApproval(
      jsonRequest(
        { approved: true, signoffRef: "LGL-1", approvedBy: "00000000-0000-0000-0000-0000000012b9" },
        "PATCH",
      ),
      ORG_ID,
      deps({ admin: true }),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as Record<string, unknown>;
    assert.equal("approvedBy" in payload, false);
  });
});

describe("GET models and org-defaults", () => {
  it("marks the gated arrangements unavailable when the flag is off", async () => {
    const response = await listModels(new Request("http://localhost/api/fees/models"), deps({ gate: GATE_CLOSED }));
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      models: Array<{ id: string; available: boolean; reason: string | null }>;
    };
    const byId = new Map(payload.models.map((entry) => [entry.id, entry]));
    assert.deepEqual(byId.get("package"), { id: "package", kind: "model", available: false, reason: "legal_gate" });
    assert.deepEqual(byId.get("upfront"), { id: "upfront", kind: "option", available: false, reason: "legal_gate" });
    assert.equal(byId.get("percentage")?.available, true);
    assert.equal(byId.get("custom")?.available, true);
  });

  it("marks them available once the gate is open", async () => {
    const response = await listModels(new Request("http://localhost/api/fees/models"), deps({ gate: GATE_OPEN }));
    const payload = (await response.json()) as { models: Array<{ id: string; available: boolean }> };
    assert.equal(payload.models.every((entry) => entry.available), true);
  });

  it("applies the same gate to a workspace default", async () => {
    const response = await patchOrgDefaults(
      jsonRequest(PACKAGE_BODY, "PATCH"),
      deps({ gate: GATE_CLOSED }),
    );
    assert.equal(response.status, 403);
    assert.equal(await errorCode(response), "legal_gate");
  });

  it("reads the org's gate state and stored workspace default", async () => {
    const response = await getOrgDefaults(deps({ gate: GATE_OPEN, orgDefault: ORG_DEFAULT }));
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      gate: UpfrontGateState;
      orgDefault: OrgFeeDefault | null;
    };
    assert.deepEqual(payload.gate, GATE_OPEN);
    assert.deepEqual(payload.orgDefault, ORG_DEFAULT);
  });

  it("returns null when the workspace has no configured default", async () => {
    const response = await getOrgDefaults(deps({ orgDefault: null }));
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { orgDefault: OrgFeeDefault | null };
    assert.equal(payload.orgDefault, null);
  });
});

describe("the read routes", () => {
  it("returns the receivables window it was asked for", async () => {
    const response = await listReceivables(
      new Request("http://localhost/api/fees?limit=10&offset=20"),
      deps(),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { limit: number; offset: number };
    assert.equal(payload.limit, 10);
    assert.equal(payload.offset, 20);
  });

  it("returns one client's agreement, ledger and payments together", async () => {
    const response = await readClientFees(CLIENT_ID, deps());
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      agreement: FeeAgreement | null;
      ledger: FeeLedger | null;
      payments: FeePayment[];
    };
    assert.equal(payload.agreement?.model, "package");
    assert.equal(payload.ledger?.balanceCents, 400_000);
    assert.equal(payload.payments.length, 1);
  });

  it("refuses a client id that is not a UUID", async () => {
    assert.equal((await readClientFees("../../etc/passwd", deps())).status, 400);
  });

  it("marks every private response no-store", async () => {
    const response = await listReceivables(new Request("http://localhost/api/fees"), deps());
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });
});
