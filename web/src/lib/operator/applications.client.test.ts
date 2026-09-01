import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createClientApplication,
  isApplicationDate,
  parseApplication,
  parseApplicationLendersBody,
  parseApplicationsBody,
  parseDollarInput,
  readApplicationLenders,
  readClientApplications,
  recordClientApplicationOutcome,
  updateClientApplication,
} from "./applications.client.ts";

const CLIENT_ID = "00000000-0000-4000-8000-000000000101";
const APPLICATION_ID = "00000000-0000-4000-8000-000000000201";

const APPLICATION = {
  amountCents: 2_500_000,
  bankRef: "example-bank",
  clientId: CLIENT_ID,
  consumerStatus: "pending",
  createdAt: "2026-09-01T00:00:00.000Z",
  id: APPLICATION_ID,
  operatorStatus: "todo",
  updatedAt: "2026-09-01T00:00:00.000Z",
  visibility: "details",
} as const;

const OUTCOME = {
  amountCents: 2_000_000,
  applicationId: APPLICATION_ID,
  bankRef: "example-bank",
  clientId: CLIENT_ID,
  createdAt: "2026-09-01T12:00:00.000Z",
  decidedOn: "2026-09-01",
  id: "00000000-0000-4000-8000-000000000301",
  kind: "approved",
  recordedByKind: "operator",
  state: "counted",
} as const;

function jsonFetch(
  status: number,
  body: unknown,
  calls: Array<{ input: string; init?: RequestInit }> = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    return Response.json(body, { status });
  }) as typeof fetch;
}

describe("operator application response parsing", () => {
  it("accepts the route's application and lender shapes", () => {
    assert.deepEqual(parseApplication(APPLICATION), APPLICATION);
    assert.deepEqual(parseApplicationsBody({ applications: [APPLICATION] }), [APPLICATION]);
    assert.deepEqual(
      parseApplicationLendersBody({
        banks: [{ bankRef: "example-bank", name: "Example Bank", products: ["Business card"] }],
      }),
      [{ bankRef: "example-bank", name: "Example Bank", products: ["Business card"] }],
    );
  });

  it("rejects partial or invalid 200 responses instead of rendering them", () => {
    assert.equal(parseApplication({ ...APPLICATION, amountCents: 1.5 }), null);
    assert.equal(parseApplication({ ...APPLICATION, visibility: "everyone" }), null);
    assert.equal(parseApplicationsBody({ applications: [{ ...APPLICATION, operatorStatus: "done" }] }), null);
    assert.equal(
      parseApplicationLendersBody({ banks: [{ bankRef: "x", name: "X", products: [1] }] }),
      null,
    );
  });
});

describe("operator application reads", () => {
  it("reads a selected client's applications with private no-store semantics", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const result = await readClientApplications(
      CLIENT_ID,
      jsonFetch(200, { applications: [APPLICATION] }, calls),
    );
    assert.deepEqual(result, { applications: [APPLICATION], state: "ready" });
    assert.equal(calls[0]?.input, `/api/applications?clientId=${CLIENT_ID}`);
    assert.equal(calls[0]?.init?.cache, "no-store");
    assert.equal(calls[0]?.init?.credentials, "same-origin");
  });

  it("keeps disabled, failed and malformed responses distinct", async () => {
    assert.deepEqual(
      await readClientApplications(
        CLIENT_ID,
        jsonFetch(503, { error: "applications_disabled", message: "Applications are disabled." }),
      ),
      { state: "disabled" },
    );
    assert.deepEqual(
      await readClientApplications(
        CLIENT_ID,
        jsonFetch(403, { error: "role_forbidden", message: "Access is denied." }),
      ),
      { message: "Access is denied.", state: "failed" },
    );
    assert.deepEqual(
      await readClientApplications(CLIENT_ID, jsonFetch(200, { applications: "invalid" })),
      { message: "Applications returned an unreadable response.", state: "failed" },
    );
  });

  it("reads the real lender catalog and reports its independent disabled state", async () => {
    assert.deepEqual(
      await readApplicationLenders(
        jsonFetch(200, {
          banks: [{ bankRef: "example-bank", name: "Example Bank", products: ["Business card"] }],
        }),
      ),
      {
        lenders: [{ bankRef: "example-bank", name: "Example Bank", products: ["Business card"] }],
        state: "ready",
      },
    );
    assert.deepEqual(
      await readApplicationLenders(
        jsonFetch(503, { error: "vault_disabled", message: "The lender database is not enabled." }),
      ),
      { state: "disabled" },
    );
  });
});

describe("operator application mutations", () => {
  it("creates an application with only fields the POST route accepts", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const result = await createClientApplication(
      { amountCents: 2_500_000, bankRef: "example-bank", clientId: CLIENT_ID },
      jsonFetch(201, { application: APPLICATION, stage: "advanced" }, calls),
    );
    assert.deepEqual(result, { ok: true, value: APPLICATION });
    assert.equal(calls[0]?.input, "/api/applications");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      amountCents: 2_500_000,
      bankRef: "example-bank",
      clientId: CLIENT_ID,
    });
  });

  it("patches every supported editable field and trusts the read-back row", async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fields = {
      amountCents: null,
      consumerStatus: "approved" as const,
      operatorStatus: "wait" as const,
      visibility: "status_only" as const,
    };
    const changed = { ...APPLICATION, ...fields };
    const result = await updateClientApplication(
      APPLICATION_ID,
      fields,
      jsonFetch(200, { application: changed }, calls),
    );
    assert.deepEqual(result, { ok: true, value: changed });
    assert.equal(calls[0]?.input, `/api/applications/${APPLICATION_ID}`);
    assert.equal(calls[0]?.init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), fields);
  });

  it("records approved, denied and withdrawn outcomes with the route's amount shape", async () => {
    for (const kind of ["approved", "denied", "withdrawn"] as const) {
      const calls: Array<{ input: string; init?: RequestInit }> = [];
      const outcome = {
        ...OUTCOME,
        amountCents: kind === "approved" ? OUTCOME.amountCents : null,
        kind,
      };
      const result = await recordClientApplicationOutcome(
        APPLICATION_ID,
        {
          amountCents: kind === "approved" ? OUTCOME.amountCents : null,
          decidedOn: "2026-09-01",
          kind,
        },
        jsonFetch(201, { outcome }, calls),
      );
      assert.deepEqual(result, { ok: true, value: outcome });
      assert.equal(
        calls[0]?.input,
        `/api/applications/${APPLICATION_ID}/outcomes`,
      );
      assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
        amountCents: kind === "approved" ? OUTCOME.amountCents : null,
        decidedOn: "2026-09-01",
        kind,
      });
    }
  });

  it("surfaces safe route validation and conflict messages", async () => {
    assert.deepEqual(
      await createClientApplication(
        { amountCents: null, bankRef: "example-bank", clientId: CLIENT_ID },
        jsonFetch(409, { error: "conflict", message: "This client already has an application with that lender." }),
      ),
      { message: "This client already has an application with that lender.", ok: false },
    );
    assert.deepEqual(
      await recordClientApplicationOutcome(
        APPLICATION_ID,
        { amountCents: null, decidedOn: "2026-09-01", kind: "approved" },
        jsonFetch(400, { error: "invalid_request", message: "An approved outcome needs a positive amountCents." }),
      ),
      { message: "An approved outcome needs a positive amountCents.", ok: false },
    );
  });
});

describe("operator application form validation", () => {
  it("preserves optional blank amounts and converts exact dollars to cents", () => {
    assert.deepEqual(parseDollarInput("", "optional"), { cents: null, ok: true });
    assert.deepEqual(parseDollarInput("1250.25", "optional"), { cents: 125_025, ok: true });
    assert.equal(parseDollarInput("12.345", "optional").ok, false);
    assert.equal(parseDollarInput("-1", "optional").ok, false);
  });

  it("requires a positive approved amount and a real date-shaped value", () => {
    assert.equal(parseDollarInput("", "positive").ok, false);
    assert.equal(parseDollarInput("0", "positive").ok, false);
    assert.deepEqual(parseDollarInput("0.01", "positive"), { cents: 1, ok: true });
    assert.equal(isApplicationDate("2026-09-01"), true);
    assert.equal(isApplicationDate("09/01/2026"), false);
    assert.equal(isApplicationDate(""), false);
  });
});
