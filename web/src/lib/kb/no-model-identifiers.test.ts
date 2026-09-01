// F-05, checked at the boundary where it is actually breached.
//
// The finding was that `buildOperatorGrounding` hands the model
// `id: "tracker:<uuid>"` and `url: "/workspace/clients/<uuid>"`, and only a line
// in the prompt stops it echoing them into the answer. Prompt v2 closed the
// prose leak and left the structure alone, which is a convention where rail 3 of
// the lane contract wants a mechanism.
//
// So this file asserts the mechanism rather than the symptom. Nothing here
// transcribes a document id or a handle format: every expected value is derived
// at test time from what the real grounding builders produce and from what the
// transport is actually handed. A builder that starts emitting a new id shape is
// covered on the day it is written, because the assertion reads the shape off
// the builder rather than out of this file.
//
// Watched failing on the pre-fix tree (`4ef499a`): the first two cases fail with
// the client and application uuids present in the request the transport
// received, and the third fails because there were no handles to leak — the
// model was cited with the real ids and the answer body was never scanned.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionProfile } from "../auth/session.ts";
import type { Application } from "../applications/types.ts";
import type { TrackerClient } from "../tracker/types.ts";
import type { ChatRequest, ChatTransport } from "../llm/chat-transport.ts";
import type { AdminTenantRow } from "../admin/platform.ts";
import { buildAdminGrounding, type AdminKbDependencies } from "./admin-answer.ts";
import { runGroundedChat, type GroundingDocument } from "./chat-driver.ts";
import { containsUuidShaped } from "./identifiers.ts";
import { buildOperatorGrounding, type OperatorKbDependencies } from "./operator.ts";
import { ADMIN_KB_PROMPT, OPERATOR_KB_PROMPT } from "./prompts.ts";

// Real uuids, because the point of the fix is that a real one cannot get out.
// Shaped by hand rather than generated so the failure message names the row.
const CLIENT_ID = "a3000000-0000-4000-8000-000000000006";
const APPLICATION_ID = "b4000000-0000-4000-8000-000000000007";
const BANK_REF = "demo-lender";

function session(): SessionProfile {
  return {
    disabledAt: null,
    id: "c5000000-0000-4000-8000-000000000001",
    manages: [],
    orgId: "d6000000-0000-4000-8000-000000000002",
    orgMembership: null,
    orgRole: null,
    role: "platform_admin",
  };
}

function client(): TrackerClient {
  return {
    analysisAt: null,
    analysisPending: null,
    archivedAt: null,
    archivedById: null,
    assignedToId: null,
    assignedToName: null,
    businessName: null,
    consumerProfileId: null,
    displayName: "Morgan Ready Demo",
    estimatedCompletionAt: null,
    fundingApprovedCents: null,
    goalCents: 100_000,
    health: "green",
    history: [],
    id: CLIENT_ID,
    lastActivityAt: "2026-08-16T00:00:00Z",
    matchesUnlockedOverride: false,
    monitoring: "active",
    nextRefreshAt: null,
    openActionCount: 2,
    readiness: 88,
    stage: "ready",
    stageEnteredAt: "2026-08-16T00:00:00Z",
    startedAt: "2026-08-01T00:00:00Z",
    status: "active",
  };
}

function application(): Application {
  return {
    amountCents: 10_000,
    bankRef: BANK_REF,
    clientId: CLIENT_ID,
    consumerStatus: "pending",
    createdAt: "2026-08-16T00:00:00Z",
    id: APPLICATION_ID,
    operatorStatus: "todo",
    updatedAt: "2026-08-16T00:00:00Z",
    visibility: "inherit",
  };
}

function dependencies(transport: () => ChatTransport): OperatorKbDependencies {
  return {
    async generateDraft() {
      throw new Error("not reached");
    },
    async listApplications() {
      return [application()];
    },
    async listBankRetrievalDocuments(refs) {
      const period = { approved: 1, approvedAmountCents: 100, denied: 0, withdrawn: 0 };
      return (refs ?? []).map((bankRef) => ({
        bankRef,
        document: {
          bank_ref: bankRef,
          heat_level: "warm" as const,
          windows: { d183: period, d30: period, d365: period, d60: period, d90: period },
        },
        documentFingerprint: "f",
        rebuiltAt: "2026-08-16T00:00:00Z",
        statsVersion: 1,
      }));
    },
    async listTrackerClients() {
      return [client()];
    },
    transport,
  };
}

/**
 * Run the real pipeline and hand back both halves: what the transport received,
 * and the documents the builder produced.
 *
 * `respond` is given the candidate request so a case can build its reply out of
 * the handles the pipeline actually issued. That is what keeps the third case
 * from transcribing a handle format this file would then be pinning.
 */
async function probe(respond: (candidate: ChatRequest) => unknown): Promise<{
  documents: readonly GroundingDocument[];
  requests: readonly ChatRequest[];
  answer: Awaited<ReturnType<typeof runGroundedChat>>;
}> {
  const requests: ChatRequest[] = [];
  const transport: ChatTransport = {
    async complete(request) {
      requests.push(request);
      return request.operation.endsWith(".candidate")
        ? respond(request)
        : { approved: true };
    },
    driver: "mock",
    model: "probe",
  };
  const deps = dependencies(() => transport);
  const documents = await buildOperatorGrounding(session(), "Which clients are closest to funding?", deps);
  const answer = await runGroundedChat({
    documents,
    prompt: OPERATOR_KB_PROMPT,
    question: "Which clients are closest to funding?",
    transport,
  });
  return { answer, documents, requests };
}

/** The whole request as the provider would see it — every field, not just the messages. */
function wire(request: ChatRequest): string {
  return JSON.stringify(request);
}

describe("the model never sees a real identifier (F-05)", () => {
  it("sends no uuid-shaped token in any request the transport receives", async () => {
    const { requests } = await probe((candidate) => {
      const body = JSON.parse(candidate.messages[1]!.content) as { documents: Array<{ id: string }> };
      return { bullets: [], citations: [{ id: body.documents[0]!.id }], headline: "Morgan Ready Demo is closest." };
    });

    assert.ok(requests.length >= 2, "the pipeline must have made both model calls");
    for (const request of requests) {
      assert.equal(
        containsUuidShaped(wire(request)),
        false,
        `operation ${request.operation} carries a uuid-shaped token to the provider`,
      );
    }
  });

  it("sends none of the grounding documents' own ids or urls", async () => {
    const { documents, requests } = await probe((candidate) => {
      const body = JSON.parse(candidate.messages[1]!.content) as { documents: Array<{ id: string }> };
      return { bullets: [], citations: [{ id: body.documents[0]!.id }], headline: "Morgan Ready Demo is closest." };
    });

    // Derived from the builder, so a fourth document kind is covered the day it
    // is added rather than the day somebody remembers this file.
    assert.ok(documents.length >= 3, `the builder produced only ${documents.length} documents`);
    for (const request of requests) {
      const serialized = wire(request);
      for (const document of documents) {
        assert.equal(serialized.includes(document.id), false, `${document.id} reached the provider`);
        assert.equal(serialized.includes(document.url), false, `${document.url} reached the provider`);
      }
    }
  });

  it("repairs a candidate that writes one of the issued handles into the answer, so no handle reaches a surface", async () => {
    // The handle is read off the request rather than written here, so the format
    // is the module's to change. The boundary this file guards is unchanged —
    // the model's citation vocabulary never reaches a person — but since
    // 2026-08-23 the mechanism for the table's own handles is translation back
    // to the document title rather than refusal: the retry that re-asked was
    // measured failing twice in a row on the live deployment (correlations
    // 556edc35, then 8bf63863 / 2a340bb2 / 007acc04 after it gained a note),
    // and a handle is the one identifier this process can repair honestly.
    const leaked = await probe((candidate) => {
      const body = JSON.parse(candidate.messages[1]!.content) as { documents: Array<{ id: string }> };
      const handle = body.documents[0]!.id;
      return {
        bullets: [`See ${handle} for the readiness figure.`],
        citations: [{ id: handle }],
        headline: "Morgan Ready Demo is closest.",
      };
    });
    const { answer, requests } = leaked;

    assert.ok(answer !== null, "the repaired candidate is answerable");
    const sent = JSON.parse(requests[0]!.messages[1]!.content) as { documents: Array<{ id: string; title: string }> };
    const visible = [answer.headline, ...answer.bullets].join("\n");
    assert.ok(!visible.includes(sent.documents[0]!.id), `a handle reached the surface: ${visible}`);
    assert.equal(answer.bullets[0], `See ${sent.documents[0]!.title} for the readiness figure.`, "the mention was translated to the record's own title, read off the request rather than transcribed here");
    // One candidate request, then the supervisor: the repair costs no retry.
    assert.deepEqual(
      requests.map((request) => request.operation.endsWith(".candidate")),
      [true, false],
      "one draft, one review — the repair consumed no regeneration",
    );
  });

  it("returns the real record id on the citation, so a surface can still open a peek", async () => {
    const { answer, documents } = await probe((candidate) => {
      const body = JSON.parse(candidate.messages[1]!.content) as { documents: Array<{ id: string }> };
      return { bullets: [], citations: [{ id: body.documents[0]!.id }], headline: "Morgan Ready Demo is closest." };
    });

    assert.ok(answer !== null, "the clean candidate must be answered");
    assert.equal(answer.citations.length, 1);
    assert.equal(
      answer.citations[0]!.id,
      documents[0]!.id,
      "the handle must resolve back to the document it stood for",
    );
  });
});

// Same probe, over the platform builder.
//
// Two builders now produce grounding, and the rail is about the boundary rather
// than about one of them — so the wire assertion below runs over both. A third
// builder added without a probe here is a builder nobody checked, which is why
// the catalog is short and named rather than implied.
const ADMIN_ORG_ID = "e1000000-0000-4000-8000-000000000009";

function adminDependencies(transport: () => ChatTransport): AdminKbDependencies {
  const tenant: AdminTenantRow = {
    clients: 9,
    fundedAllTimeCents: 900_000,
    fundedOutcomes: 3,
    fundedYtdCents: 500_000,
    fundingReadyDays: 21,
    id: ADMIN_ORG_ID,
    membership: "active",
    name: "Northbridge Capital",
    plan: "growth",
    slug: "northbridge",
    startedAt: "2026-01-04",
  };
  return {
    async readCounts() {
      return { analyses: 12, consumers: 40, operators: 1 };
    },
    async readFundedVolume() {
      return { monthly: [{ amountCents: 500_000, label: "2026-07" }], weekly: [] };
    },
    async readPlatformMrrCents() {
      return 250_000;
    },
    async readTenants() {
      return [tenant];
    },
    today: () => "2026-08-22",
    transport,
  };
}

async function adminProbe(): Promise<{ documents: readonly GroundingDocument[]; requests: readonly ChatRequest[] }> {
  const requests: ChatRequest[] = [];
  const transport: ChatTransport = {
    async complete(request) {
      requests.push(request);
      if (!request.operation.endsWith(".candidate")) return { approved: true };
      const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
      return { bullets: [], citations: [{ id: body.documents[0]!.id }], headline: "Northbridge Capital grew fastest." };
    },
    driver: "mock",
    model: "probe",
  };
  const documents = await buildAdminGrounding(adminDependencies(() => transport));
  await runGroundedChat({
    documents,
    prompt: ADMIN_KB_PROMPT,
    question: "Which operator grew fastest?",
    transport,
  });
  return { documents, requests };
}

describe("the platform builder holds the same boundary (F-05)", () => {
  it("sends no uuid-shaped token and none of its documents' own ids or urls", async () => {
    const { documents, requests } = await adminProbe();

    assert.ok(requests.length >= 2, "the pipeline must have made both model calls");
    assert.ok(documents.length >= 3, `the builder produced only ${documents.length} documents`);
    for (const request of requests) {
      const serialized = wire(request);
      assert.equal(containsUuidShaped(serialized), false, `operation ${request.operation} carries a uuid-shaped token`);
      for (const document of documents) {
        assert.equal(serialized.includes(document.id), false, `${document.id} reached the provider`);
        assert.equal(serialized.includes(document.url), false, `${document.url} reached the provider`);
      }
    }
  });
});
