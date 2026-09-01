import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("Drop 7 consumer overview", () => {
  it("locks the shared Overview row order and historical funding presentation", async () => {
    const source = await readFile(new URL("./consumer.tsx", import.meta.url), "utf8");

    assert.match(
      source,
      /top: \[input\.stage, input\.monitoring, input\.nextRefresh\]/,
    );
    assert.match(
      source,
      /bottom: \[input\.readiness, input\.openActions, input\.estimatedCompletion, fundingApproved\]/,
    );
    assert.match(source, /function formatFundingApproved\(amountCents: number \| null\)/);
    assert.match(source, /detail: "Recorded historical outcome"/);
    assert.match(source, /detail: "No recorded historical outcome"/);
    assert.match(source, /value: formatFundingApproved\(input\.fundingApprovedCents\)/);
  });

  it("keeps Alec's warning and readiness-factor literals exact", async () => {
    const source = await readFile(new URL("./consumer.tsx", import.meta.url), "utf8");
    const warningBlock = source.slice(
      source.indexOf("const optimizationWarnings"),
      source.indexOf("type OverviewMetric"),
    );
    const factorBlock = source.slice(
      source.indexOf("const factors"),
      source.indexOf("const optimizationWarnings"),
    );
    const personalLabels = Array.from(
      factorBlock.matchAll(/label: "([^"]+)", state: "[^"]+", track: "personal"/g),
      (match) => match[1],
    );

    assert.deepEqual(personalLabels, [
      "Correct personal information",
      "Clean report",
      "Utilization under 30%",
      "Minimum 4 personal credit accounts open",
      "Average credit age across all accounts 2+ years",
      "No negative items",
      "Minimum 1 personal credit card with limit $10k+",
      "Max 2 inquiries on each bureau",
    ]);
    assert.match(warningBlock, /"Hold all new credit applications"/);
    assert.match(
      warningBlock,
      /"Do not complete steps on your own if unsure\. Ask for help! We may ask you to do it again so save time & money\."/,
    );
    assert.match(
      warningBlock,
      /"Be patient! Everything we do will help your credit & finances for life\."/,
    );
    assert.equal((warningBlock.match(/^\s+"/gm) ?? []).length, 3);
    assert.match(
      source,
      /Based on your credit report, your docs, and what you report to us\./,
    );
  });

  it("removes the redundant Overview elements and leaves one journey in Overview", async () => {
    const source = await readFile(new URL("./consumer.tsx", import.meta.url), "utf8");
    const dashboard = source.slice(
      source.indexOf("function DashboardView"),
      source.indexOf("function OptimizationView"),
    );
    const funding = source.slice(
      source.indexOf("function FundingPlanView"),
      source.indexOf("function JourneyTimeline"),
    );

    assert.doesNotMatch(dashboard, /Last reported balance|Reported balance|Payment target|Target balance/);
    assert.doesNotMatch(dashboard, /\["Experian", "Equifax", "TransUnion"\]/);
    // One journey *section* on the Overview. The durable/fixture branch means
    // two <JourneyTimeline invocations, but both live inside the single
    // "Your funding journey" WorkspaceSection.
    assert.equal((dashboard.match(/title="Your funding journey"/g) ?? []).length, 1);
    const journeySection = dashboard.slice(dashboard.indexOf('title="Your funding journey"'));
    assert.equal(
      (dashboard.match(/<JourneyTimeline/g) ?? []).length,
      (journeySection.match(/<JourneyTimeline/g) ?? []).length,
      "a JourneyTimeline renders outside the journey section",
    );
    assert.doesNotMatch(funding, /JourneyTimeline|View journey|navigate\("journey"\)/);
    assert.doesNotMatch(source, /case "journey"|\| "journey"/);
    assert.match(source, /border-t border-\[var\(--consumer-border\)\]/);
  });

  it("raises the shared lower-row metric value size one token", async () => {
    const kit = await readFile(
      new URL("../consumer/consumer-kit.tsx", import.meta.url),
      "utf8",
    );
    const metricRow = kit.slice(
      kit.indexOf("export function MetricRow"),
      kit.indexOf("export function LabeledProgress"),
    );

    assert.match(metricRow, /mt-1\.5 text-2xl font-semibold/);
    assert.doesNotMatch(metricRow, /mt-1\.5 text-xl font-semibold/);
  });
});
