import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

function read(relative: string): string {
  return stripComments(fs.readFileSync(new URL(relative, import.meta.url), "utf8"));
}

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing source section ${start}`);
  return source.slice(from, to);
}

/** CSS, so it is read raw: `stripComments` is a TypeScript scanner. */
const globalsCss = fs.readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

const consumer = read("./consumer.tsx");
const consumerShell = read("../consumer/consumer-shell.tsx");
const optimization = read("../consumer/optimization-view.tsx");
const teamChat = read("../consumer/team-chat/index.tsx");
const operator = read("./operator.tsx");
const trackerDetail = read("../../lib/operator/tracker-detail.ts");
const fundingPipeline = read("../operator/tracker-funding-pipeline.tsx");
const feeEditor = read("../operator/fee-edit-sheet.tsx");
const inbox = read("../operator/inbox/index.tsx");
const overview = section(consumer, "function DashboardView", "function useConsumerTracker");

describe("Alec feedback · consumer contract", () => {
  it("A1-A3 and B2-B3 leave one greeting header and one non-action monitoring state", () => {
    assert.doesNotMatch(consumerShell, /WorkspaceHeader/);
    assert.doesNotMatch(overview, /title="Your action plan"|title="Credit monitoring"|Open credit snapshot|title="Current work"/);
    assert.match(consumer, /metric\.label === "Monitoring"/);
    assert.match(consumer, /<ShieldCheck/);
    assert.match(consumer, /Monitoring \$\{monitoringActive \? "active"/);
    assert.doesNotMatch(consumer, /Open Cinderella profile/);
    assert.match(consumer, /Open Optimization/);
  });

  it("A1 removes the workspace header bar at every width and keeps its controls reachable", () => {
    // The bar itself is gone — not hidden at one breakpoint. Which widths render
    // what is browser layout and carries no guard; this pins the DOM fact that
    // the shell no longer contains a header element at all.
    assert.doesNotMatch(consumerShell, /<header/);
    // The workspace / client identity pair renders exactly once, in the sidebar,
    // so the name cannot appear twice at any width.
    assert.equal((consumerShell.match(/\{operatorName\}/g) ?? []).length, 1);
    // The removed bar carried the only sub-lg sign-out and demo-role controls;
    // they stay reachable through the More sheet.
    const moreSheet = consumerShell.slice(consumerShell.indexOf("<Sheet "));
    assert.match(moreSheet, /\/api\/auth\/sign-out/);
    assert.match(moreSheet, /signOutAvailable/);
    assert.match(moreSheet, /Switch demo role/);
    // The removed bell was the only always-visible unread signal below lg; the
    // More tab carries it now.
    assert.match(consumerShell, /notificationCount > 0[\s\S]{0,600}unread/);
  });

  it("B1 opens each checklist factor as an inline disclosure", () => {
    const factor = section(optimization, "function FactorRow", "function UtilizationSection");
    assert.match(factor, /<details/);
    assert.match(factor, /<summary/);
    assert.match(factor, /signal \|\|/);
    // The factor row nests inside the track's own <details className="group">,
    // and an unnamed group-open: matches ANY open ancestor group — which made
    // every closed row's chevron point up whenever its track was expanded
    // (measured on production, 2026-08-31). The row must scope its state cue
    // to its own element with a named group.
    // Whitespace-tolerant only because the element now carries `open` and
    // `onToggle` too and prettier breaks the props onto their own lines; the fact
    // guarded is unchanged.
    assert.match(factor, /<details\s+className="group\/factor/);
    assert.match(factor, /group-open\/factor:rotate-180/);
    assert.doesNotMatch(factor, /[^/]group-open:/);
  });

  it("B1 gives the checklist disclosure a legible affordance", () => {
    const factor = section(optimization, "function FactorRow", "function UtilizationSection");
    const track = section(optimization, "function Track({", "function FactorRow");

    // 1 · One row opens by default. The definition lives in Track, which is the
    // only place that knows the rendered order; FactorRow seeds its own state
    // from it once, so a manual close sticks for the session.
    assert.match(track, /const defaultOpenKey =/);
    assert.match(track, /=== "action-needed"/);
    assert.match(track, /canceled \|\| noAnalysis/);
    assert.match(track, /defaultOpen=\{factor\.key === defaultOpenKey\}/);
    assert.match(factor, /const \[isOpen, setIsOpen\] = useState\(defaultOpen\)/);
    assert.match(factor, /onToggle=\{\(event\) => setIsOpen\(event\.currentTarget\.open\)\}/);
    assert.match(factor, /open=\{isOpen\}/);

    // 2 · The row is the control: the whole summary washes, and an open row
    // deepens from the well rather than washing back to the closed hover.
    assert.match(factor, /hover:bg-\[var\(--muted\)\]/);
    assert.match(factor, /group-open\/factor:hover:bg-\[color-mix\(in_srgb,var\(--consumer-muted\),transparent_90%\)\]/);

    // 3 · Chip and chevron are one cluster. The hover that lights the chevron is
    // scoped to the summary, not the details: hovering the open body must not
    // light it. The chip drops the icon its marker already carries, except on
    // warning, where the triangle is the second non-colour channel.
    assert.match(factor, /group\/summary/);
    assert.match(factor, /group-hover\/summary:text-foreground/);
    assert.doesNotMatch(factor, /group-hover\/factor:/);
    assert.match(factor, /icon=\{tone === "warning" \? undefined : false\}/);

    // 4 · The open row recesses into a well. The border is present and
    // transparent at rest, so opening changes colour and not layout.
    assert.match(factor, /border border-transparent/);
    assert.match(factor, /open:border-\[var\(--consumer-surface-border\)\]/);
    assert.match(factor, /open:bg-\[color-mix\(in_srgb,var\(--consumer-muted\),transparent_96%\)\]/);
    assert.match(factor, /motion-safe:group-open\/factor:animate-\[mf-disclosure-reveal/);
    assert.match(globalsCss, /@keyframes mf-disclosure-reveal/);
    // Reduced motion removes the reveal, the wash transition and the rotation.
    // The reveal is gated in with `motion-safe:` rather than out with
    // `motion-reduce:animate-none`, which is one class and would have lost on
    // specificity to the `group-open/factor:` rule it was meant to cancel.
    assert.doesNotMatch(factor, /motion-reduce:animate-none/);
    assert.equal((factor.match(/motion-reduce:transition-none/g) ?? []).length, 2);

    // 5 · Below sm the chip drops under the title and the chevron stays pinned
    // to the first line. Whether the result *reads* as openable is a judgment no
    // module owns, so nothing here guards it.
    assert.match(factor, /grid-cols-\[auto_minmax\(0,1fr\)_auto\]/);
    assert.match(factor, /sm:grid-cols-\[auto_minmax\(0,1fr\)_auto_auto\]/);
    assert.match(factor, /col-start-2 row-start-2 justify-self-start/);
  });

  it("B5 keeps the conversation viewport-bound and B7 keeps one collapsible white rail", () => {
    assert.match(teamChat, /h-\[calc\(100dvh-/);
    assert.match(teamChat, /sm:h-\[calc\(100dvh-/);
    assert.equal((consumerShell.match(/<aside/g) ?? []).length, 1);
    assert.match(consumerShell, /sidebarCollapsed/);
    assert.match(consumerShell, /Collapse sidebar/);
    assert.match(consumerShell, /Expand sidebar/);
  });

  it("B4 presents the monitoring summary as three first-class score cards", () => {
    const credit = section(consumer, "function CreditScoreCard", "function OnboardingHubView");
    assert.match(credit, /title="Your credit scores"/);
    assert.match(credit, /score range 300–850/);
    assert.match(credit, /md:grid-cols-3/);
    assert.match(credit, /<CreditScoreCard/);
    assert.match(credit, /Watch items/);
  });

  it("B6 preserves the independently revocable permission controls", () => {
    assert.match(consumer, /title="Data permissions"/);
    assert.match(consumer, /onRevoke\(permission\.kind\)/);
    assert.match(consumer, />Revoke permission</);
    assert.match(consumer, /does not revoke the separate analysis authorization or cancel your subscription/);
    assert.match(consumer, /does not revoke the separate monitoring consent or cancel your subscription/);
    assert.match(consumer, /Cancel the subscription separately in Account & Billing if you also want to stop renewal/);
  });
});

describe("Alec feedback · operator contract", () => {
  it("B8 and B14 use Alec's labels in both durable and fixture dashboards", () => {
    assert.equal((operator.match(/\["Completed AI analysis"/g) ?? []).length, 2);
    assert.doesNotMatch(operator, /\["Analyses"/);
    assert.match(operator, /id: "bank-vault", label: "Bank Vault"/);
    assert.doesNotMatch(operator, /label: "BANK VAULT"/);
  });

  it("B9 keeps the requested plan-field order and reads current CRS scores", () => {
    const plan = section(trackerDetail, "export function trackerPlanFields", "export function trackerFundingFields");
    const fields = plan.slice(plan.lastIndexOf("return ["));
    const labels = ["Readiness score", "Remaining steps", "Last analysis", "Next refresh", "Estimated completion", "creditScoreField", "Credit monitoring"];
    let prior = -1;
    for (const label of labels) {
      const at = fields.indexOf(label === "creditScoreField" ? label : `"${label}"`);
      assert.ok(at > prior, `${label} is missing or out of order`);
      prior = at;
    }
    assert.match(plan, /label: "Credit Score"/);
    assert.match(plan, /Equifax/);
    assert.match(operator, /readOperatorCreditScores/);
    assert.match(operator, /trackerCreditScores/);
  });

  it("B10 exposes recorded funding plus the existing application pipeline", () => {
    assert.match(trackerDetail, /"Funding approved"/);
    assert.match(trackerDetail, /"Funding goal"/);
    assert.match(fundingPipeline, /Funding plan and pipeline/);
    assert.match(fundingPipeline, /readClientApplications\(clientId\)/);
    assert.match(fundingPipeline, /recordClientApplicationOutcome\(/);
  });

  it("B11-B12 edit the fee model, trigger and paid states in a side sheet", () => {
    assert.match(operator, /<FeeEditSheet/);
    assert.match(feeEditor, /<Sheet/);
    assert.match(feeEditor, /Funding trigger/);
    assert.match(feeEditor, /Admin upfront paid/);
    assert.match(feeEditor, /Success fee paid/);
    assert.match(feeEditor, /setClientFeeAgreement/);
    assert.match(feeEditor, /recordFeePayment/);
    assert.match(feeEditor, /reverseFeePayment/);
  });

  it("B13-B15 tighten Clients, sentence-case Bank Vault and lock saved tasks behind Edit", () => {
    assert.match(operator, /space-y-5 lg:-mt-3 xl:-mt-5/);
    assert.match(operator, /loadTasks\(\)/);
    assert.match(operator, /createTask\(\{/);
    assert.match(operator, /updateTask\(task\.id/);
    assert.match(operator, /removeTask\(task\.id\)/);
    assert.match(operator, />\s*Edit task\s*</);
    assert.match(operator, /editingTaskId !== task\.id/);
    assert.doesNotMatch(operator, /Saved for this visit\. Task persistence is not connected yet\./);
  });

  it("B16 splits audiences and moves system updates to client Activity", () => {
    assert.match(inbox, /Client inbox/);
    assert.match(inbox, /Internal notes/);
    assert.match(inbox, /message\.visibility === "internal"/);
    assert.match(operator, /timelineEnabled=\{timelineEnabled\}/);
    assert.match(operator, /<TrackerClientTimeline/);
  });

  it("B17 removes the workspace default while preserving per-client goals", () => {
    assert.doesNotMatch(operator, /Default client funding goal|saveWorkspaceGoal\(|id="default-goal"/);
    assert.match(operator, /aria-label=\{`Funding goal for \$\{selectedClient\.name\}`\}/);
    assert.match(operator, /Clear goal/);
  });
});
