// The platform-scoped answer path, built with F-08.
//
// Every assertion here derives its expectation from the row type or from the
// builder's own output. That matters more than usual on this file, because the
// grounding is cross-tenant: a test that transcribed "three documents" would go
// on passing on the day a fourth tenant stopped being included, which is exactly
// the failure an admin would not notice — the answer would simply be about a
// smaller platform than the one they run.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionProfile } from "../auth/session.ts";
import type { AdminTenantRow } from "../admin/platform.ts";
import type { ChatRequest, ChatTransport } from "../llm/chat-transport.ts";
import {
  ADMIN_METRIC_PREFIX,
  ADMIN_OPERATOR_PREFIX,
  buildAdminGrounding,
  createAdminKbAnswer,
  type AdminKbDependencies,
} from "./admin-answer.ts";
import { containsUuidShaped } from "./identifiers.ts";
import { ADMIN_KB_PROMPT } from "./prompts.ts";

const ORG_A = "e1000000-0000-4000-8000-000000000001";
const ORG_B = "e1000000-0000-4000-8000-000000000002";

function admin(): SessionProfile {
  return { disabledAt: null, id: "admin-1", manages: [], orgId: null, orgMembership: null, orgRole: null, role: "platform_admin" };
}

function tenant(id: string, name: string, slug: string): AdminTenantRow {
  return {
    clients: 9,
    fundedAllTimeCents: 900_000,
    fundedOutcomes: 3,
    fundedYtdCents: 500_000,
    fundingReadyDays: 21,
    id,
    membership: "active",
    name,
    plan: "growth",
    slug,
    startedAt: "2026-01-04",
  };
}

function echoTransport(): ChatTransport {
  return {
    async complete(request: ChatRequest) {
      if (!request.operation.endsWith(".candidate")) return { approved: true };
      const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
      return {
        bullets: ["Funded volume is up on the quarter."],
        citations: body.documents.slice(0, 8).map((document) => ({ id: document.id })),
        headline: "Northbridge Capital grew fastest.",
      };
    },
    driver: "mock",
    model: "probe",
  };
}

function dependencies(
  tenants: readonly AdminTenantRow[] = [tenant(ORG_A, "Northbridge Capital", "northbridge"), tenant(ORG_B, "Harbour Row Funding", "harbour-row")],
  transport: () => ChatTransport = echoTransport,
): AdminKbDependencies {
  return {
    async readCounts() {
      return { analyses: 12, consumers: 40, operators: tenants.length };
    },
    async readFundedVolume(today) {
      return { monthly: [{ amountCents: 500_000, label: today.slice(0, 7) }], weekly: [] };
    },
    async readPlatformMrrCents() {
      return 250_000;
    },
    async readTenants() {
      return tenants;
    },
    today: () => "2026-08-22",
    transport,
  };
}

describe("admin KB grounding", () => {
  it("gives every operator on the roster a document and names it by its display name", async () => {
    const tenants = [tenant(ORG_A, "Northbridge Capital", "northbridge"), tenant(ORG_B, "Harbour Row Funding", "harbour-row")];
    const documents = await buildAdminGrounding(dependencies(tenants));

    const operators = documents.filter((document) => document.id.startsWith(ADMIN_OPERATOR_PREFIX));
    // Derived from the roster, so a tenant the builder starts skipping fails
    // here rather than quietly narrowing what the admin is answered about.
    assert.deepEqual(
      operators.map((document) => document.label),
      tenants.map((row) => `Operator · ${row.name}`),
    );
    assert.equal(documents.filter((document) => document.id.startsWith(ADMIN_METRIC_PREFIX)).length, 2);
  });

  it("keeps the platform figures when the roster is long enough to truncate", async () => {
    // The bound cuts from the end. Metrics are ordered first for that reason, and
    // this is the case that proves it rather than the comment claiming it: a
    // roster far past the context bound must not cost the platform totals.
    const many = Array.from({ length: 400 }, (_, index) =>
      tenant(`e1000000-0000-4000-8000-${String(index).padStart(12, "0")}`, `Operator ${index}`, `operator-${index}`),
    );
    const documents = await buildAdminGrounding(dependencies(many));

    assert.equal(documents.filter((document) => document.id.startsWith(ADMIN_METRIC_PREFIX)).length, 2);
    assert.ok(documents.length < many.length, "the bound must have truncated something");
    assert.ok(
      documents.reduce((total, document) => total + document.content.length, 0) <= 8_000,
      "the grounding is over the context bound",
    );
  });

  it("puts no consumer record and no stored key into a document body", async () => {
    // Read off the row type rather than listed: `AdminTenantRow` is the whole of
    // what a tenant document may carry, so a field added to the row and copied
    // in here is covered, and a field invented here is caught.
    const allowed = new Set(Object.keys(tenant(ORG_A, "Northbridge Capital", "northbridge")));
    const documents = await buildAdminGrounding(dependencies());

    for (const document of documents.filter((row) => row.id.startsWith(ADMIN_OPERATOR_PREFIX))) {
      const content = JSON.parse(document.content) as Record<string, unknown>;
      for (const key of Object.keys(content)) {
        assert.ok(allowed.has(key), `${key} is not a field of the operator roster row`);
      }
      // `id`, `name` and `slug` identify the row rather than describing it, and
      // the first of them is a stored key.
      for (const identifying of ["id", "name", "slug"]) {
        assert.equal(identifying in content, false, `the document body carries ${identifying}`);
      }
      assert.equal(containsUuidShaped(document.content), false, "a stored key reached a document body");
    }
  });
});

describe("admin KB answer", () => {
  it("refuses a session that is not platform staff before any read runs", async () => {
    let reads = 0;
    const deps: AdminKbDependencies = {
      ...dependencies(),
      async readTenants() {
        reads += 1;
        return [];
      },
    };
    const operator: SessionProfile = { ...admin(), orgId: "org-1", role: "operator_member" };

    const result = await createAdminKbAnswer("Which operator grew fastest?", operator, deps);

    assert.equal(result.status, "unavailable");
    assert.equal(reads, 0, "the cross-tenant read ran for a caller without the role");
  });

  it("declines when the roster names no operator", async () => {
    // Not "no documents": the two platform figures are unconditional, so a
    // length check would be an arm nothing can reach. An empty roster is the
    // condition that actually makes a comparison question unanswerable.
    const result = await createAdminKbAnswer("Which operator grew fastest?", admin(), dependencies([]));

    assert.equal(result.status, "insufficient_grounding");
    assert.deepEqual(result.citations, []);
  });

  it("answers in parts, cites by resolved document id, and carries no footer", async () => {
    const result = await createAdminKbAnswer("Which operator grew fastest?", admin(), dependencies());

    assert.equal(result.status, "answered");
    if (result.status !== "answered") return;
    assert.equal(result.headline, "Northbridge Capital grew fastest.");
    assert.deepEqual([...result.bullets], ["Funded volume is up on the quarter."]);
    // Platform staff are not the audience the not-advice line is written for, and
    // an empty field says so where a missing one would read as an omission.
    assert.equal(result.footer, null);
    // The handles resolved back to the documents they stood for, so every chip
    // can open something the admin surface already holds.
    const documents = await buildAdminGrounding(dependencies());
    assert.deepEqual(
      result.citations.map((citation) => citation.id),
      documents.slice(0, 8).map((document) => document.id),
    );
  });

  it("names its own failure when a platform read throws", async () => {
    const deps: AdminKbDependencies = {
      ...dependencies(),
      async readPlatformMrrCents() {
        throw new Error("the analytics client is down");
      },
    };

    const result = await createAdminKbAnswer("Which operator grew fastest?", admin(), deps);

    assert.equal(result.status, "unavailable");
    // The record itself is asserted in `diagnostics/route-failure-coverage.test.ts`,
    // which derives its catalog from the modules that import the seam.
    assert.deepEqual(result.citations, []);
  });

  it("runs on its own prompt key, so an eval record cannot be attributed to another scope", async () => {
    const operations: string[] = [];
    const transport: ChatTransport = {
      async complete(request) {
        operations.push(request.operation);
        return echoTransport().complete(request);
      },
      driver: "mock",
      model: "probe",
    };

    await createAdminKbAnswer("Which operator grew fastest?", admin(), dependencies(undefined, () => transport));

    assert.equal(operations[0], `${ADMIN_KB_PROMPT.key}.candidate`);
  });
});
