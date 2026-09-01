import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import type { SessionProfile } from "@/lib/auth/session";
import type { TrackerClient } from "@/lib/tracker";
import {
  ADMIN_WORKSPACE_TOOL_NAMES,
  CONSUMER_WORKSPACE_TOOL_NAMES,
  OPERATOR_WORKSPACE_TOOL_NAMES,
  CODE_FIELDS,
  WORKSPACE_ASSISTANT_DENIED_FIELDS,
  createWorkspaceToolRegistry,
  readableCode,
  type WorkspaceToolDependencies,
} from "./workspace-tools.ts";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";

const operator: SessionProfile = { disabledAt: null, id: PROFILE_ID, role: "operator_member", orgId: ORG_ID, orgRole: "owner", orgMembership: "current", manages: [] };
const consumer: SessionProfile = { disabledAt: null, id: PROFILE_ID, role: "consumer", orgId: null, orgRole: null, orgMembership: null, manages: [] };
const admin: SessionProfile = { disabledAt: null, id: PROFILE_ID, role: "platform_admin", orgId: null, orgRole: null, orgMembership: null, manages: [] };

const client: TrackerClient = {
  id: CLIENT_ID, consumerProfileId: PROFILE_ID, displayName: "Acme Bakery", businessName: "Acme Bakery LLC",
  assignedToId: PROFILE_ID, assignedToName: "Alex Operator", stage: "ready", stageEnteredAt: "2026-08-01T00:00:00Z",
  startedAt: "2026-01-01", history: [], analysisAt: "2026-08-20T00:00:00Z", analysisPending: null,
  readiness: 84, openActionCount: 2, estimatedCompletionAt: null, monitoring: "active", nextRefreshAt: null,
  goalCents: 2_000_000, matchesUnlockedOverride: false, fundingApprovedCents: null, health: "green", status: "active",
  lastActivityAt: "2026-08-22T00:00:00Z", archivedAt: null, archivedById: null,
};

function dependencies(realAuthEnabled = true): WorkspaceToolDependencies {
  return {
    realAuthEnabled: () => realAuthEnabled,
    featureEnabled: () => true,
    now: () => new Date("2026-08-23T00:00:00Z"),
    async readClients() { return [client]; },
    async readApplications() { return [{ id: "app-secret", clientId: CLIENT_ID, bankRef: "bank-secret", operatorStatus: "todo", consumerStatus: "pending", amountCents: 125_000, visibility: "details", createdAt: "2026-08-01", updatedAt: "2026-08-02" }]; },
    async readApplicationsByBank() { return [{ id: "app-secret", clientId: CLIENT_ID, bankRef: "bank-secret", operatorStatus: "todo", consumerStatus: "pending", amountCents: 125_000, visibility: "details", createdAt: "2026-08-01", updatedAt: "2026-08-02" }]; },
    async readOutcomes() { return []; },
    async readOutcomesByBank() { return []; },
    async readFees() { return [{ clientId: CLIENT_ID, displayName: client.displayName, model: "percentage", status: "active", outcomeBasisCents: 125_000, totalCents: 12_500, paidCents: 2_500, balanceCents: 10_000, lastPaymentOn: "2026-08-10" }]; },
    async readBanks() { return [{ bankRef: "bank-secret", name: "Example Bank", products: ["Business card"], bureauPulls: "excluded", qualificationSummary: "excluded", heatLevel: "hot", lastOutcomeAt: null, windows: { d30: { outcomes: 0, approvals: 0, approvalRate: 0, fundedCount: 0, fundedAmount: 0, averageFundedAmount: 0 }, d60: { outcomes: 0, approvals: 0, approvalRate: 0, fundedCount: 0, fundedAmount: 0, averageFundedAmount: 0 }, d90: { outcomes: 0, approvals: 0, approvalRate: 0, fundedCount: 0, fundedAmount: 0, averageFundedAmount: 0 }, d183: { outcomes: 0, approvals: 0, approvalRate: 0, fundedCount: 0, fundedAmount: 0, averageFundedAmount: 0 }, d365: { outcomes: 0, approvals: 0, approvalRate: 0, fundedCount: 0, fundedAmount: 0, averageFundedAmount: 0 } } }]; },
    async readOperators() { return [{ id: ORG_ID, name: "Northstar Funding", slug: "northstar", plan: "pro", membership: "current", startedAt: "2026-01-01", clients: 12, fundedYtdCents: 500_000, fundedAllTimeCents: 900_000, fundedOutcomes: 3, fundingReadyDays: 18 }]; },
    async readRollups() { return { operatorCount: 4, consumerCount: 30, fundedCents: 900_000, cashCents: 40_000, platformMrrCents: 25_000, fundedVolume: { monthly: [], weekly: [] } }; },
    async readRevenue() {
      return {
        kpis: { complete: true, incompleteCodes: [], monitoringShareTotalCents: 8_000, saasReferralTotalCents: 3_000 },
        operatorEntries: [{ operatorName: "Northstar Funding", accrualMonth: "2026-08-01", baseAmountCents: 40_000, pct: 20, amountCents: 8_000, complete: true, settlementStatus: "accrued" }],
        referralEntries: [{ referrerName: "Northstar Funding", referredName: "Harbor Funding", accrualMonth: "2026-08-01", cycle: 2, baseAmountCents: 15_000, pct: 20, amountCents: 3_000, complete: true, settlementStatus: "accrued" }],
      };
    },
    async readAudit() { return [{ action: "client.stage_changed", occurredAt: "2026-08-22T00:00:00Z", subjectType: "client" }]; },
  };
}

describe("workspace assistant tool registry", () => {
  it("registers only the fixed tools allowed for each role", () => {
    const registry = createWorkspaceToolRegistry(dependencies());
    assert.deepEqual(registry.namesFor(operator), OPERATOR_WORKSPACE_TOOL_NAMES);
    assert.deepEqual(registry.namesFor(admin), ADMIN_WORKSPACE_TOOL_NAMES);
    assert.deepEqual(registry.namesFor(consumer), CONSUMER_WORKSPACE_TOOL_NAMES);
  });

  it("returns cited, human-labelled client readiness without protected fields", async () => {
    const result = await createWorkspaceToolRegistry(dependencies()).run("client_readiness", operator, { stage: "ready" });
    assert.equal(result.status, "records");
    assert.equal(result.documents[0]?.label, "Client · Acme Bakery");
    assert.match(result.documents[0]?.content ?? "", /"readiness":84/);
    assert.doesNotMatch(JSON.stringify(result), /consumerProfileId|assignedToId|monitoring|bureau|tradeline|utilization|credit.?score/i);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(CLIENT_ID));
    for (const field of WORKSPACE_ASSISTANT_DENIED_FIELDS) assert.doesNotMatch(JSON.stringify(result), new RegExp(field, "i"));
  });

  it("ranks the full authorized client book before applying the answer limit", async () => {
    const deps = dependencies();
    deps.readClients = async () => Array.from({ length: 21 }, (_, index) => ({
      ...client,
      id: `client-${index}`,
      displayName: index === 20 ? "Highest Readiness" : `Client ${index}`,
      readiness: index === 20 ? 99 : index,
    }));
    const result = await createWorkspaceToolRegistry(deps).run("client_readiness", operator, { limit: 5 });
    assert.equal(result.documents[0]?.label, "Client · Highest Readiness");
    assert.equal(result.documents.length, 5);
  });

  it("uses lender and client names while keeping raw application, bank, and client keys out of model context", async () => {
    const result = await createWorkspaceToolRegistry(dependencies()).run("client_applications", consumer);
    assert.equal(result.status, "records");
    assert.equal(result.documents[0]?.label, "Application · Acme Bakery · Application 1");
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /app-secret|bank-secret|Bank Secret|clientId|bankRef/);
    assert.match(serialized, /Acme Bakery/);
    assert.match(result.documents[0]?.content ?? "", /"lenderName":null/);
  });

  it("keeps every application distinct when one client has multiple applications with the same lender", async () => {
    const deps = dependencies();
    deps.readApplications = async () => [
      { id: "app-secret-a", clientId: CLIENT_ID, bankRef: "bank-secret", operatorStatus: "todo", consumerStatus: "pending", amountCents: 125_000, visibility: "details", createdAt: "2026-08-01", updatedAt: "2026-08-02" },
      { id: "app-secret-b", clientId: CLIENT_ID, bankRef: "bank-secret", operatorStatus: "wait", consumerStatus: "approved", amountCents: 250_000, visibility: "details", createdAt: "2026-08-03", updatedAt: "2026-08-04" },
    ];
    const result = await createWorkspaceToolRegistry(deps).run("client_applications", operator);

    assert.equal(result.status, "records");
    assert.deepEqual(result.documents.map((row) => row.label), [
      "Application · Acme Bakery · Example Bank · Application 1",
      "Application · Acme Bakery · Example Bank · Application 2",
    ]);
    assert.match(result.documents[0]?.content ?? "", /\"consumer\":\"pending\"/);
    assert.match(result.documents[1]?.content ?? "", /\"consumer\":\"approved\"/);
    assert.doesNotMatch(JSON.stringify(result), /app-secret-[ab]|bank-secret/);
  });

  it("filters visible applications by an authorized lender name", async () => {
    const result = await createWorkspaceToolRegistry(dependencies()).run("client_applications", operator, { query: "Example Bank" });
    assert.equal(result.status, "records");
    assert.equal(result.documents[0]?.label, "Application · Acme Bakery · Example Bank");
    assert.doesNotMatch(JSON.stringify(result), /bank-secret|app-secret/);
  });

  it("keeps application and outcome amounts out of status-only consumer context", async () => {
    const deps = dependencies();
    deps.readApplications = async () => [{ id: "app-secret", clientId: CLIENT_ID, bankRef: "bank-secret", operatorStatus: "todo", consumerStatus: "pending", amountCents: 125_000, visibility: "status_only", createdAt: "2026-08-01", updatedAt: "2026-08-02" }];
    deps.readOutcomes = async () => [{
      outcome: { id: "outcome-secret", applicationId: "app-secret", bankRef: "bank-secret", clientId: CLIENT_ID, kind: "approved", amountCents: 90_000, state: "counted", recordedByKind: "operator", decidedOn: "2026-08-05", createdAt: "2026-08-05" },
      review: null,
    }];
    const result = await createWorkspaceToolRegistry(deps).run("client_applications", consumer);
    // The nulling survives the money rewrite: the key loses its storage suffix,
    // the absence does not become a formatted zero, and neither raw integer nor
    // its dollar reading reaches the model.
    const content = JSON.parse(result.documents[0]?.content ?? "{}") as Record<string, unknown>;
    assert.equal("amountCents" in content, false, "a cents-suffixed key reached the model");
    assert.equal(content.amount, null);
    assert.doesNotMatch(result.documents[0]?.content ?? "", /125000|90000|\$1,250|\$900/);
  });

  it("refuses cross-scope tools, identifier-shaped args, and demo-mode admin fallbacks", async () => {
    const registry = createWorkspaceToolRegistry(dependencies());
    assert.equal((await registry.run("platform_operators", operator)).status, "out_of_scope");
    assert.equal((await registry.run("client_readiness", operator, { orgId: "other-org" } as never)).status, "out_of_scope");
    assert.equal((await createWorkspaceToolRegistry(dependencies(false)).run("client_readiness", operator)).status, "out_of_scope");
    const disabled = dependencies();
    disabled.featureEnabled = (name) => name !== "FEATURE_APPLICATIONS";
    assert.equal((await createWorkspaceToolRegistry(disabled).run("client_applications", operator)).status, "out_of_scope");
  });

  it("reports an honest empty read", async () => {
    const deps = dependencies();
    deps.readClients = async () => [];
    const result = await createWorkspaceToolRegistry(deps).run("client_readiness", operator);
    assert.deepEqual(result, { status: "no_matching", documents: [] });
  });

  it("does not turn a fee-store outage into an empty-record answer", async () => {
    const deps = dependencies();
    deps.readFees = async () => { throw new Error("fee store unreachable"); };
    await assert.rejects(() => createWorkspaceToolRegistry(deps).run("client_fees", operator), /fee store unreachable/);

    const source = fs.readFileSync(new URL("./workspace-tools.ts", import.meta.url), "utf8");
    assert.match(source, /if \(!result\.ok\) throw new Error\("ASSISTANT_FEE_READ_FAILED"\)/);
  });

  it("returns bounded admin revenue ledger entries with organization names and no ledger ids", async () => {
    const result = await createWorkspaceToolRegistry(dependencies()).run("platform_revenue", admin, { month: "2026-08" });
    assert.equal(result.status, "records");
    assert.deepEqual(result.documents.map((row) => row.label), [
      "Revenue · 2026-08",
      "Operator earnings · Northstar Funding · 2026-08-01",
      "Referral earnings · Northstar Funding · Harbor Funding · 2026-08-01",
    ]);
    assert.doesNotMatch(JSON.stringify(result), /ledgerId|operator_org_id|referrer_org_id|referred_org_id/i);
  });

  it("filters admin revenue entries by an operator name", async () => {
    const deps = dependencies();
    let receivedQuery: string | undefined;
    const original = deps.readRevenue;
    deps.readRevenue = async (month, query) => {
      receivedQuery = query;
      return original(month, query);
    };
    const result = await createWorkspaceToolRegistry(deps).run("platform_revenue", admin, { month: "2026-08", query: "Northstar Funding" });
    assert.equal(result.status, "records");
    assert.equal(receivedQuery, "Northstar Funding");
    assert.deepEqual(result.documents.map((row) => row.label), [
      "Operator earnings · Northstar Funding · 2026-08-01",
      "Referral earnings · Northstar Funding · Harbor Funding · 2026-08-01",
    ]);
    const source = fs.readFileSync(new URL("./workspace-tools.ts", import.meta.url), "utf8");
    assert.match(source, /\.eq\("name", operatorName\)/);
    assert.match(source, /operatorQuery\.in\("operator_org_id", targetOrgIds\)/);
  });

  it("keeps the assistant tracker read off service-role and enrollment enrichments", () => {
    const source = fs.readFileSync(new URL("../tracker/read.server.ts", import.meta.url), "utf8");
    const assistantRead = source.slice(source.indexOf("export async function listAssistantTrackerClients"), source.indexOf("export async function readTrackerClient"));
    assert.doesNotMatch(assistantRead, /createAdminClient|pendingAnalysisByClient\(/);
    assert.match(assistantRead, /includeEnrollment: false/);
    assert.match(assistantRead, /FEATURE_REAL_AUTH/);
  });
});

/**
 * The application read stops hiding what it left out.
 *
 * Both assertions derive their expectation from the reads the registry actually
 * performed rather than from a number copied out of the reproduction: the first
 * counts the clients it was handed, the second counts the rows the dependency
 * returned. A ceiling changed in one place moves both.
 */
describe("workspace assistant application completeness", () => {
  function book(size: number) {
    return Array.from({ length: size }, (_, index) => ({
      id: `app-${index}`,
      clientId: CLIENT_ID,
      bankRef: "bank-secret",
      operatorStatus: "todo" as const,
      consumerStatus: "pending" as const,
      amountCents: 125_000,
      visibility: "details" as const,
      createdAt: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
      updatedAt: "2026-08-23",
    }));
  }

  it("reads the whole authorized client book before any application answer is composed", async () => {
    const deps = dependencies();
    const clients = Array.from({ length: 25 }, (_, index) => ({ ...client, id: `client-${index}`, displayName: `Client ${index + 1}` }));
    const asked = new Set<string>();
    deps.readClients = async () => clients;
    deps.readApplications = async (clientId) => {
      asked.add(clientId);
      return clientId === clients.at(-1)!.id ? book(1) : [];
    };
    const result = await createWorkspaceToolRegistry(deps).run("client_applications", operator);
    assert.equal(asked.size, clients.length, "the client book was cut before its applications were read");
    assert.equal(result.status, "records");
    assert.equal(result.truncated, undefined);
    assert.equal(result.documents[0]?.label, `Application · ${clients.at(-1)!.displayName} · Example Bank`);
  });

  it("says so when the authorized read holds more applications than one answer carries", async () => {
    const deps = dependencies();
    let returned = 0;
    deps.readApplications = async () => {
      const rows = book(40);
      returned = rows.length;
      return rows;
    };
    const result = await createWorkspaceToolRegistry(deps).run("client_applications", operator);
    assert.equal(result.status, "records");
    assert.ok(result.documents.length < returned, "the read claimed to be complete while dropping rows");
    assert.equal(result.truncated, true, "a partial application book was returned as a whole one");
  });
});

/**
 * No storage representation of money reaches the model, in any scope.
 *
 * Found live: an operator answer read "Riley Funded Demo owes $1,000 (100,000
 * cents)" because `totalCents` was handed over verbatim and the model printed
 * both readings. The assertion walks every document every tool emits and
 * compares against the cents integers the dependency fixtures actually returned
 * — collected at test time by walking those fixtures — so a `*Cents` field added
 * to any read, at any depth, is covered on the day it lands rather than when
 * someone remembers to extend a list.
 */
describe("assistant grounding carries money as an amount, never as cents", () => {
  function leaves(value: unknown, onKey: (key: string) => void, onNumber: (value: number) => void): void {
    if (Array.isArray(value)) {
      for (const item of value) leaves(item, onKey, onNumber);
      return;
    }
    if (typeof value === "number") {
      onNumber(value);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      onKey(key);
      leaves(child, onKey, onNumber);
    }
  }

  it("emits no cents-suffixed key and no raw cents integer from any read in any scope", async () => {
    const deps = dependencies();
    // Every cents figure the fixtures will hand the registry, gathered from the
    // fixtures themselves rather than transcribed.
    const rawCents = new Set<number>();
    for (const source of await Promise.all([
      deps.readClients(operator, { scope: "all" }),
      deps.readApplications(CLIENT_ID),
      deps.readOutcomes(CLIENT_ID),
      deps.readFees(ORG_ID),
      deps.readOperators(),
      deps.readRollups("2026-08-23"),
      deps.readRevenue("2026-08"),
    ])) {
      const collect = (value: unknown): void => {
        if (Array.isArray(value)) { for (const item of value) collect(item); return; }
        if (!value || typeof value !== "object") return;
        for (const [key, child] of Object.entries(value)) {
          if (/cents$/i.test(key) && typeof child === "number" && child !== 0) rawCents.add(child);
          collect(child);
        }
      };
      collect(source);
    }
    assert.ok(rawCents.size > 0, "the fixtures no longer carry any money for this test to police");

    const registry = createWorkspaceToolRegistry(deps);
    const scopes = [
      [operator, OPERATOR_WORKSPACE_TOOL_NAMES],
      [admin, ADMIN_WORKSPACE_TOOL_NAMES],
      [consumer, CONSUMER_WORKSPACE_TOOL_NAMES],
    ] as const;

    let inspected = 0;
    for (const [session, names] of scopes) {
      for (const name of names) {
        const result = await registry.run(name, session);
        for (const grounded of result.documents) {
          inspected += 1;
          const content: unknown = JSON.parse(grounded.content);
          leaves(content, (key) => {
            assert.doesNotMatch(key, /cents$/i, `${name} emitted the storage key "${key}"`);
          }, (number) => {
            assert.equal(rawCents.has(number), false, `${name} emitted the raw cents integer ${number}`);
          });
          assert.doesNotMatch(grounded.title, /cents/i, `${name} put cents in a visible title`);
        }
      }
    }
    assert.ok(inspected > 0, "no document was inspected");
  });

  it("reads a formatted amount where a cents integer used to be", async () => {
    const deps = dependencies();
    const [fee] = await deps.readFees(ORG_ID);
    const result = await createWorkspaceToolRegistry(deps).run("client_fees", operator);
    const content = JSON.parse(result.documents[0]?.content ?? "{}") as Record<string, unknown>;
    assert.equal(content.total, new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(fee!.totalCents / 100));
    assert.equal(typeof content.total, "string");
  });
});

/**
 * Machine values reach the model in the reader's form.
 *
 * All three admin questions on the live walk were declined by the supervisor,
 * whose rule is that every statement be supported by the supplied documents —
 * and the documents supplied `client.stage_changed`, `2026-08-22T00:00:00Z` and
 * `pro`, none of which a readable answer can quote. The coverage is derived from
 * the exported `CODE_FIELDS` and from the raw fixture values, so a code field
 * added to the rule is policed everywhere it appears without extending a list
 * here.
 */
describe("assistant grounding presents recorded codes and dates the way a reader reads them", () => {
  const ISO = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;

  it("renders every recorded code as a label and keeps the raw code beside it", async () => {
    const deps = dependencies();
    const registry = createWorkspaceToolRegistry(deps);
    let checkedCodes = 0;
    let checkedDates = 0;

    for (const [session, names] of [
      [operator, OPERATOR_WORKSPACE_TOOL_NAMES],
      [admin, ADMIN_WORKSPACE_TOOL_NAMES],
      [consumer, CONSUMER_WORKSPACE_TOOL_NAMES],
    ] as const) {
      for (const name of names) {
        const result = await registry.run(name, session);
        for (const grounded of result.documents) {
          const walk = (value: unknown): void => {
            if (Array.isArray(value)) { for (const item of value) walk(item); return; }
            if (!value || typeof value !== "object") return;
            const row = value as Record<string, unknown>;
            for (const [key, child] of Object.entries(row)) {
              if (typeof child === "string" && CODE_FIELDS.has(key)) {
                checkedCodes += 1;
                assert.equal(typeof row[`${key}Code`], "string", `${name} dropped the raw code for ${key}`);
                assert.equal(child, readableCode(row[`${key}Code`] as string), `${name} left ${key} as a machine code`);
              }
              if (key.endsWith("Iso") || key.endsWith("Code")) continue;
              if (typeof child === "string" && /(?:At|On)$/.test(key) && typeof row[`${key}Iso`] === "string") {
                checkedDates += 1;
                assert.doesNotMatch(child, ISO, `${name} left ${key} as an ISO timestamp`);
                assert.match(row[`${key}Iso`] as string, ISO);
              }
              walk(child);
            }
          };
          walk(JSON.parse(grounded.content));
        }
      }
    }
    assert.ok(checkedCodes > 0, "no recorded code was emitted for this test to police");
    assert.ok(checkedDates > 0, "no recorded date was emitted for this test to police");
  });

  it("keeps a machine code out of the citation label a reader is shown", async () => {
    const deps = dependencies();
    const [entry] = await deps.readAudit({ limit: 1 });
    const result = await createWorkspaceToolRegistry(deps).run("platform_audit", admin);
    const title = result.documents[0]?.title ?? "";
    assert.ok(title.includes(readableCode(entry!.action)), "the audit citation does not name the action in words");
    assert.equal(title.includes(entry!.action), false, "the audit citation prints the raw action code");
    assert.equal(title.includes(entry!.occurredAt), false, "the audit citation prints a raw ISO timestamp");
  });
});
