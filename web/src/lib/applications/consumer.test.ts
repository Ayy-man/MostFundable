import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addConsumerApplicationNote,
  clearSubmittedConsumerNoteDraft,
  clearSubmittedConsumerOutcomeDraft,
  deriveConsumerApprovedFunding,
  parseConsumerApplications,
  readConsumerApplications,
  recordConsumerApplicationOutcome,
} from "./consumer.ts";
import { handleConsumerApplications, type ConsumerApplicationsDependencies } from "./consumer.server.ts";
import type { SessionProfile } from "@/lib/auth/session";
import type { Application, ApplicationNote, Outcome } from "./types.ts";

const CLIENT = "00000000-0000-4000-8000-000000004211";
const ORG = "00000000-0000-4000-8000-000000004212";
const PROFILE = "00000000-0000-4000-8000-000000004213";
const APPLICATION = "00000000-0000-4000-8000-000000004214";

const consumerSession: SessionProfile = {
  disabledAt: null,
  id: PROFILE,
  manages: [],
  orgId: ORG,
  orgMembership: null,
  orgRole: null,
  role: "consumer",
};

const application: Application = {
  amountCents: 25_000,
  bankRef: "example-bank",
  clientId: CLIENT,
  consumerStatus: "pending",
  createdAt: "2026-08-30T10:00:00.000Z",
  id: APPLICATION,
  operatorStatus: "todo",
  updatedAt: "2026-08-31T10:00:00.000Z",
  visibility: "inherit",
};

const note: ApplicationNote = {
  applicationId: APPLICATION,
  attested: true,
  authorKind: "operator",
  authorProfileId: "private-profile-id",
  body: "Please confirm the response.",
  createdAt: "2026-08-31T11:00:00.000Z",
  id: "00000000-0000-4000-8000-000000004215",
};

const outcome: Outcome = {
  amountCents: 45_000,
  applicationId: APPLICATION,
  bankRef: "example-bank",
  clientId: CLIENT,
  createdAt: "2026-09-01T10:00:00.000Z",
  decidedOn: "2026-09-01",
  id: "00000000-0000-4000-8000-000000004216",
  kind: "approved",
  recordedByKind: "consumer",
  state: "counted",
};

function dependencies(overrides: Partial<ConsumerApplicationsDependencies> = {}): ConsumerApplicationsDependencies {
  return {
    async listApplications(clientId) { assert.equal(clientId, CLIENT); return [application]; },
    async listClients() { return [{ id: CLIENT }] as never; },
    async listNotes(applicationId) { assert.equal(applicationId, APPLICATION); return [note]; },
    async listOutcomes(clientId) { assert.equal(clientId, CLIENT); return [outcome]; },
    async readBanks(bankRefs) {
      assert.deepEqual(bankRefs, ["example-bank"]);
      return [{ bankRef: "example-bank", name: "Example Bank", products: ["Business card"], qualificationSummary: "Current records", sourceUpdatedAt: "2026-08-30" }];
    },
    async readPreferences(orgId) {
      assert.equal(orgId, ORG);
      return {
        notifications: { clientMessages: true, digestEnabled: true, digestFrequency: "weekly", emailHolds: true, paymentFailed: true, taskDue: true },
        portal: { allowDocumentUploads: true, applicationVisibility: "details", showFundingProgress: true, showTrainings: true },
      };
    },
    async requireConsumer() { return consumerSession; },
    ...overrides,
  };
}

describe("consumer application projection", () => {
  it("resolves the caller's only client and returns details without private actor ids", async () => {
    const response = await handleConsumerApplications(dependencies());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.applications[0].lender.name, "Example Bank");
    assert.equal(body.applications[0].outcome.kind, "approved");
    assert.equal(body.applications[0].notes[0].authorKind, "operator");
    assert.equal(JSON.stringify(body).includes("private-profile-id"), false);
    assert.notEqual(parseConsumerApplications(body), null);
  });

  it("enforces a per-application status-only override before the DTO", async () => {
    let bankReads = 0;
    const response = await handleConsumerApplications(dependencies({
      async listApplications() { return [{ ...application, visibility: "status_only" }]; },
      async readBanks(refs) { bankReads += 1; assert.deepEqual(refs, []); return []; },
    }));
    const body = await response.json();
    assert.equal(body.applications[0].presentation, "status-only");
    assert.equal(body.applications[0].lender, null);
    assert.equal(body.applications[0].requestedAmountCents, null);
    assert.equal(body.applications[0].outcome.amountCents, null);
    assert.equal(bankReads, 1);
    assert.notEqual(parseConsumerApplications(body), null);
  });

  it("applies the inherited workspace privacy setting to lender and money fields", async () => {
    const response = await handleConsumerApplications(dependencies({
      async readBanks(refs) { assert.deepEqual(refs, []); return []; },
      async readPreferences() {
        return {
          notifications: { clientMessages: true, digestEnabled: true, digestFrequency: "weekly", emailHolds: true, paymentFailed: true, taskDue: true },
          portal: { allowDocumentUploads: true, applicationVisibility: "status-only", showFundingProgress: true, showTrainings: true },
        };
      },
    }));
    const projected = (await response.json()).applications[0];
    assert.deepEqual(
      { lender: projected.lender, outcomeAmount: projected.outcome.amountCents, requestedAmount: projected.requestedAmountCents },
      { lender: null, outcomeAmount: null, requestedAmount: null },
    );
  });

  it("orders the oldest application first and appends new rows without renumbering existing rows", async () => {
    const earlier = { ...application, bankRef: "earlier-bank", createdAt: "2026-08-29T10:00:00.000Z", id: "00000000-0000-4000-8000-000000004217", updatedAt: "2026-08-29T10:00:00.000Z" };
    const later = { ...application, bankRef: "later-bank", createdAt: "2026-08-31T10:00:00.000Z", id: "00000000-0000-4000-8000-000000004218" };
    const newest = { ...application, bankRef: "newest-bank", createdAt: "2026-09-01T10:00:00.000Z", id: "00000000-0000-4000-8000-000000004219" };
    let rows = [later, earlier];
    const deps = dependencies({
      async listApplications() { return rows; },
      async listNotes(applicationId) { return applicationId === earlier.id ? [note] : []; },
      async listOutcomes() { return []; },
      async readBanks(refs) { return refs.map((bankRef) => ({ bankRef, name: bankRef, products: [], qualificationSummary: null, sourceUpdatedAt: null })); },
    });

    const first = await (await handleConsumerApplications(deps)).json();
    assert.deepEqual(first.applications.map((row: { id: string; sequence: number }) => [row.id, row.sequence]), [[earlier.id, 1], [later.id, 2]]);
    assert.equal(first.applications[0].notes[0].body, note.body);

    rows = [newest, later, earlier];
    const appended = await (await handleConsumerApplications(deps)).json();
    assert.deepEqual(appended.applications.map((row: { id: string; sequence: number }) => [row.id, row.sequence]), [[earlier.id, 1], [later.id, 2], [newest.id, 3]]);
  });

  it("keeps application status readable when the lender catalog fails", async () => {
    const response = await handleConsumerApplications(dependencies({ async readBanks() { throw new Error("down"); } }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).applications[0].lender, null);
  });

  it("refuses ambiguous or missing consumer scope", async () => {
    assert.equal((await handleConsumerApplications(dependencies({ async listClients() { return [] as never; } }))).status, 409);
    assert.equal((await handleConsumerApplications(dependencies({
      async requireConsumer() {
        return { ...consumerSession, orgMembership: "current", orgRole: "owner", role: "operator_member" };
      },
    }))).status, 403);
  });
});

describe("consumer application browser client", () => {
  it("reads one strict no-store projection", async () => {
    const response = await handleConsumerApplications(dependencies());
    const body = await response.json();
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ input, init }); return Response.json(body); }) as typeof fetch;
    const result = await readConsumerApplications(fetcher);
    assert.equal(result.status, "ready");
    assert.equal(String(calls[0].input), "/api/consumer/applications");
    assert.equal(calls[0].init?.credentials, "same-origin");
    assert.equal(parseConsumerApplications({ applications: [{ ...body.applications[0], presentation: "status-only" }] }), null);
  });

  it("posts only the consumer note and outcome fields", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ input, init }); return new Response(null, { status: 201 }); }) as typeof fetch;
    assert.equal(await addConsumerApplicationNote(APPLICATION, "Update", fetcher), true);
    assert.equal(await recordConsumerApplicationOutcome(APPLICATION, { amountCents: 45_000, kind: "approved" }, fetcher), true);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { attested: false, body: "Update" });
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { amountCents: 45_000, kind: "approved" });
  });

  it("rejects either monetary field when a status-only payload leaks it", async () => {
    const response = await handleConsumerApplications(dependencies({
      async readBanks() { return []; },
      async readPreferences() {
        return {
          notifications: { clientMessages: true, digestEnabled: true, digestFrequency: "weekly", emailHolds: true, paymentFailed: true, taskDue: true },
          portal: { allowDocumentUploads: true, applicationVisibility: "status-only", showFundingProgress: true, showTrainings: true },
        };
      },
    }));
    const body = await response.json();
    assert.notEqual(parseConsumerApplications(body), null);
    assert.equal(parseConsumerApplications({ applications: [{ ...body.applications[0], requestedAmountCents: 1 }] }), null);
    assert.equal(parseConsumerApplications({ applications: [{ ...body.applications[0], outcome: { ...body.applications[0].outcome, amountCents: 1 } }] }), null);
  });
});

describe("consumer application derived state", () => {
  it("withholds a partial funded total when any approved amount is private", async () => {
    const detailsBody = await (await handleConsumerApplications(dependencies())).json();
    const details = parseConsumerApplications(detailsBody);
    assert.notEqual(details, null);
    assert.deepEqual(deriveConsumerApprovedFunding(details), { amountCents: 45_000, status: "ready" });
    const hidden = { ...details![0], outcome: { ...details![0].outcome!, amountCents: null }, presentation: "status-only" as const, lender: null, requestedAmountCents: null };
    assert.deepEqual(deriveConsumerApprovedFunding([details![0], hidden]), { status: "private" });
    assert.deepEqual(deriveConsumerApprovedFunding(null), { status: "unavailable" });
  });

  it("preserves per-application edits made while a submitted request is pending", () => {
    const other = "00000000-0000-4000-8000-000000004220";
    const submittedNotes = { [APPLICATION]: "Submitted", [other]: "Other draft" };
    assert.deepEqual(clearSubmittedConsumerNoteDraft(submittedNotes, APPLICATION, "Submitted"), { [other]: "Other draft" });
    const editedNotes = { ...submittedNotes, [APPLICATION]: "Edited after submit" };
    assert.equal(clearSubmittedConsumerNoteDraft(editedNotes, APPLICATION, "Submitted"), editedNotes);

    const submittedOutcome = { approvedAmount: "450.00", kind: "approved" as const };
    const outcomeDrafts = { [APPLICATION]: submittedOutcome, [other]: { approvedAmount: "", kind: "denied" as const } };
    assert.deepEqual(clearSubmittedConsumerOutcomeDraft(outcomeDrafts, APPLICATION, submittedOutcome), { [other]: outcomeDrafts[other] });
    const editedOutcomes = { ...outcomeDrafts, [APPLICATION]: { ...submittedOutcome, approvedAmount: "500.00" } };
    assert.equal(clearSubmittedConsumerOutcomeDraft(editedOutcomes, APPLICATION, submittedOutcome), editedOutcomes);
  });
});
