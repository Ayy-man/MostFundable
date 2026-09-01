import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { SUPPORT_TICKET_FIXTURES } from "@/lib/demo/co-fixtures";
import {
  BANK_FIXTURES,
  OPERATOR_FIXTURES,
  deriveOperatorBillingRows,
} from "@/lib/demo/feedback-fixtures";
import { MANDATORY_PROMPT_EVALUATORS } from "./prompt-types.ts";

import { stripComments } from "@/lib/testing/strip-comments";

/**
 * The admin surface's half of the 2026-08-22 fixture-eviction census.
 *
 * Every assertion below derives what it is looking for from the fixture module,
 * the policy object or the roster type that owns it, rather than transcribing
 * the strings the census happened to quote. That is the round-5 rule and it is
 * the one that matters here: the census itself found that the panels naming
 * "Apex Funding Partners" had been fixed once already for a different reason,
 * and a test pinned to a quoted sentence passes happily while the cast comes
 * back through a different door.
 */
const SURFACE = readFileSync(new URL("../../components/surfaces/admin.tsx", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("../../app/(surfaces)/admin/page.tsx", import.meta.url), "utf8");
const CLIENT = readFileSync(new URL("../../app/(surfaces)/admin/surface-client.tsx", import.meta.url), "utf8");

/**
 * Comments are where this file explains what it removed, and several of those
 * explanations necessarily quote the names they removed. Scanning the rendered
 * source means scanning the source with its commentary taken out; leaving it in
 * would make the honest record of a deletion look like the deletion failing.
 */
const withoutComments = stripComments;

const CODE = withoutComments(SURFACE);

/**
 * The fixture shell's operator persona, read out of the role table that owns
 * it. The runner cannot import a `.tsx` module, so the name is parsed from
 * `demo-chrome.tsx` rather than written down here — renaming the persona there
 * has to move this assertion with it.
 */
function fixtureOperatorPersona(): string {
  const chrome = readFileSync(new URL("../../components/demo/demo-chrome.tsx", import.meta.url), "utf8");
  const roles = chrome.slice(chrome.indexOf("export const DEMO_ROLES"));
  const operator = roles.slice(roles.indexOf("  operator: {"));
  const name = /name: "([^"]+)"/.exec(operator)?.[1];
  assert.ok(name, "the fixture role table no longer names its operator persona");
  return name;
}

function region(start: string, end: string): string {
  const from = CODE.indexOf(start);
  const through = CODE.indexOf(end, from);
  assert.ok(from >= 0 && through > from, `${start} region is missing`);
  return CODE.slice(from, through);
}

describe("admin surface: no fixture cast reaches a signed-in administrator", () => {
  it("names no fixture operator workspace anywhere it renders", () => {
    // Derived from the two fixture modules the surface used to read, so adding
    // a fixture operator back — under any panel — fails this rather than
    // needing the census's list of panels to be re-read.
    const cast = new Set<string>([
      ...OPERATOR_FIXTURES.map((operator) => operator.name),
      ...SUPPORT_TICKET_FIXTURES.map((ticket) => ticket.operatorName),
      ...deriveOperatorBillingRows().map((row) => row.name),
    ]);
    for (const name of cast) {
      assert.equal(CODE.includes(name), false, `a fixture operator workspace renders on the admin surface: ${name}`);
    }
  });

  it("stamps the signed-in account on what it records, never a persona", () => {
    // The persona is the fixture shell's own, read from the shell's role table
    // rather than spelled here. It may appear exactly once — as the flag-off
    // fallback — and never as the author or actor of a recorded line.
    const persona = fixtureOperatorPersona();
    assert.equal((CODE.match(new RegExp(persona, "g")) ?? []).length, 1);
    assert.match(CODE, /const actorName = sessionIdentity\?\.name \?\?/);
    assert.equal(CODE.includes(`actor: "${persona}"`), false);
    assert.equal(CODE.includes(`author: "${persona}"`), false);
    assert.match(CODE, /profileName=\{actorName\}/);
    // The recorder fills the actor from the session; a call site that could
    // name one could name the wrong one.
    assert.match(CODE, /recordAudit\(event: Omit<AuditEvent, "actor" \| "time">/);
  });

  it("reads that account server-side and threads it through the client wrapper", () => {
    assert.ok(PAGE.includes("readSessionDisplayIdentity"));
    assert.ok(PAGE.indexOf("requireRole(SURFACE_ROLE)") < PAGE.indexOf("readSessionDisplayIdentity(sessionProfile)"));
    assert.ok(PAGE.includes("sessionIdentity={sessionIdentity ?? undefined}"));
    assert.ok(CLIENT.includes("sessionIdentity={sessionIdentity}"));
  });
});

describe("admin surface: every panel names a source or says it has none", () => {
  it("builds the SaaS ledger from the tenant roster, not the billing fixture", () => {
    const billing = region("function BillingView(", "function SecurityView(");
    assert.ok(billing.includes('useAdminResource("/api/admin/tenants", parseAdminTenants)'));
    assert.equal(billing.includes("deriveOperatorBillingRows"), false);
    // The export is the half that outlives the page, so it refuses rather than
    // writing a file the caller will read as the platform's own record.
    const exporter = billing.slice(billing.indexOf("function exportLedger()"), billing.indexOf("function handleBillingAction"));
    assert.ok(exporter.includes("isAdminReady(ledgerRead)"));
    assert.ok(exporter.indexOf("isAdminReady(ledgerRead)") < exporter.indexOf("createObjectURL"));
  });

  it("holds no seeded audit row, staged finding, held reply or eval run", () => {
    assert.match(CODE, /const INTEL_ITEMS: IntelItem\[\] = \[\];/);
    assert.match(CODE, /const HELD_REPLIES: readonly HeldReply\[\] = \[\];/);
    assert.match(CODE, /useState<AuditEvent\[\]>\(\[\]\)/);
    assert.match(CODE, /useState<BankComment\[\]>\(\[\]\)/);
    // The four run rows and their metric strip are gone with the type that
    // described them, so there is nothing left to seed them from.
    assert.equal(CODE.includes("type EvalRun ="), false);
    assert.equal(CODE.includes("Runs this month"), false);
  });

  it("takes the platform support queue from the support API", () => {
    assert.ok(CODE.includes('from "@/lib/operator/support-inbox.client"'));
    assert.equal(CODE.includes("SUPPORT_TICKET_FIXTURES"), false);
    const health = region("function SupportTicketsSection()", "function SupportView()");
    assert.ok(health.includes("readSupportInbox()"));
    // Neither hardcoded element verdict survives: nothing counts replies
    // awaiting review, and no route serves the vault's sync time.
    assert.equal(health.includes("awaiting review"), false);
    assert.equal(/Synced \d+ min ago/.test(health), false);
  });

  it("reads the Bank Vault through Phase 8 on both admin tabs", () => {
    const vault = region("function LendersView(", "function LendersBody(");
    assert.ok(vault.includes("useVaultBanks(vaultEnabled, true)"));
    assert.ok(vault.includes("bankVaultSource(vaultEnabled, vaultBanks.state)"));
    // Fixtures answer for the flag being off and for nothing else: a loading or
    // refused read renders the empty catalog with a reason.
    assert.ok(vault.includes('source === "fixtures"'));
    assert.ok(vault.includes("EMPTY_BANK_STATS"));
    // The seven fixture lenders are no longer reachable from this surface, so
    // no picker, dialog or trend panel can name one the vault does not hold.
    assert.equal(CODE.includes("BANK_FIXTURES"), false);
    for (const bank of BANK_FIXTURES) {
      assert.equal(CODE.includes(`"${bank.name}"`), false, `a fixture lender is named on the admin surface: ${bank.name}`);
    }
  });

  it("describes the release gate from the policy that enforces it", () => {
    const evaluators = Object.values(MANDATORY_PROMPT_EVALUATORS);
    const required = evaluators.reduce((total, keys) => total + keys.length, 0);
    const summary = region("const GOVERNED_GATE_SUMMARY", "type AdminView");
    assert.ok(summary.includes("MANDATORY_PROMPT_EVALUATORS"));
    assert.ok(summary.includes("required evaluators across"));
    // Derived, not transcribed: the sentence must move when the policy does.
    assert.equal(CODE.includes(`${required} required evaluators`), false, "the count is spelled out instead of computed");
    assert.equal(CODE.includes("Current gate:"), false);
  });

  it("puts the durable funded-volume chart on the durable analytics body", () => {
    const governed = region("function GovernedAnalyticsBody()", "const GOVERNED_SETTING_LABELS");
    const fixtureTwin = region("function AnalyticsBody()", "function ToggleSetting(");
    assert.ok(governed.includes("<FundedVolumePanel />"));
    assert.equal(fixtureTwin.includes("<FundedVolumePanel />"), false);
    assert.equal(CODE.includes("BookStatsPanel"), false);
    assert.equal(CODE.includes("deriveAdminBookStats"), false);
  });

  it("wires durable training writes without falling back to browser-only claims", () => {
    const trainings = region("function TrainingsView({", "function FundedVolumePanel()");
    assert.equal(trainings.includes("shared to all operator workspaces"), false);
    assert.equal(trainings.includes("Draft created"), false);
    assert.equal(trainings.includes("TRAINING_DISTRIBUTION_UNAVAILABLE"), false);
    assert.equal(trainings.includes("TRAINING_AUTHORING_UNAVAILABLE"), false);
    for (const helper of [
      "createAdminTraining",
      "updateAdminTraining",
      "publishAdminTraining",
      "unpublishAdminTraining",
      "deleteAdminTraining",
      "loadAdminTrainings",
    ]) assert.ok(trainings.includes(helper), `${helper} is not wired`);
    assert.ok(trainings.includes("mutateTrainingAndReadBack"));
    assert.ok(trainings.includes("sourceFile"));
    assert.ok(trainings.includes("adminTrainingSourcePath"));
    assert.equal(trainings.includes("TRAINING_ATTACHMENT_UNSUPPORTED"), false);
    // The synced-operator count had no source at any flag setting.
    assert.equal(/\d+ operators synced/.test(trainings), false);
  });

  it("sends the chat playground to the live grounded assistant", () => {
    const playground = region("function ChatPlaygroundSection(", "function GovernedPromptsSection(");
    assert.ok(playground.includes("<AdminAssistantWorkspace"));
    // Admin scope, not the operator index: a platform administrator is grounded on platform records.
    assert.equal(playground.includes("/api/kb/operator"), false);
    // No canned answer, and no picker offering models nothing calls.
    assert.equal(playground.includes("OpenRouter"), false);
    assert.equal(playground.includes("AssistantReply"), false);
  });

  it("gives the sidebar no count it cannot read", () => {
    const nav = region("const ADMIN_SECTIONS", "const ADMIN_VIEW_IDS");
    // Derived from the roster, not from the one item that carried the literal:
    // any future nav badge has to come from a live count, and ADMIN_SECTIONS is
    // a module constant with nothing live in scope.
    assert.equal(/badge:\s*\d/.test(nav), false, "a nav item carries a hard-coded badge count");
  });

  it("lets the overview grid shrink below its widest durable name", () => {
    const grid = region('<div className="mt-5 grid gap-5', "function TenantsView(");
    const panels = grid.match(/<Panel\b/g) ?? [];
    const shrinkable = grid.match(/className="min-w-0"/g) ?? [];
    // Both panels, derived by counting them: a grid item defaults to
    // min-width:auto, so any panel left without min-w-0 pushes the single
    // 390px-viewport track out to its own min-content width. The census
    // measured that as a 4px horizontal scroll on this exact grid.
    assert.ok(panels.length > 0, "the overview grid has no panels to check");
    assert.equal(shrinkable.length, panels.length, "an overview grid panel can still force the track wider than the viewport");
  });
});
