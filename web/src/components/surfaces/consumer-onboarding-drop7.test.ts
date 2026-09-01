import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { describe, it } from "node:test";

import { CONSUMER_KB_IDENTITY } from "@/lib/kb/consumer";

import { stripComments } from "@/lib/testing/strip-comments";

/**
 * Every source file of the Team Chat view, joined.
 *
 * Drop 7's copy is a claim about what a client reads on this view, not about which file holds it,
 * and pinning it per-file is what made the rebuild's pure moves look like deletions. The view is
 * discovered rather than listed so a file added to it is covered on the next run.
 *
 * Comments are stripped, and that is not tidiness. Several files in this view explain the frozen
 * sentence they carry by quoting it, so an unstripped join reports the copy as present after it has
 * been reworded out of the render — the assertion passes on the explanation of the rule instead of
 * on the rule. Both frozen-copy mutations survived until this stripped.
 */
async function teamChatView(): Promise<string> {
  const names = (await readdir(teamChatDir)).filter(
    (name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"),
  );
  assert.ok(names.length >= 8, `the Team Chat view is ${names.length} files; the layout moved`);
  const sources = await Promise.all(
    names.map((name) => readFile(new URL(name, teamChatDir), "utf8")),
  );
  return stripComments(sources.join("\n"));
}

const consumerPath = new URL("./consumer.tsx", import.meta.url);
const shellPath = new URL("../consumer/consumer-shell.tsx", import.meta.url);
const teamChatDir = new URL("../consumer/team-chat/", import.meta.url);
const assistantPath = new URL("../assistant/global-companion.tsx", import.meta.url);
const TEAM_CHAT_LABEL = "Team Chat";

async function sourceSection(start: string, end: string) {
  const source = await readFile(consumerPath, "utf8");
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing source section ${start}`);
  return source.slice(from, to);
}

describe("Drop 7 consumer onboarding", () => {
  it("maps the four live milestone kinds to Alec's labels in order", async () => {
    const onboarding = await sourceSection("const onboardingMilestones", "function OnboardingHubView");
    const expected = [
      ["agreement_signed", "Agreement signed"],
      ["documents_uploaded", "Docs uploaded"],
      ["monitoring_connected", "Credit monitoring connected"],
      ["onboarding_call_completed", "Onboarding call completed"],
    ];
    let previous = -1;
    for (const [kind, label] of expected) {
      const position = onboarding.indexOf(`kind: "${kind}", label: "${label}"`);
      assert.ok(position > previous, `${label} must follow the required order`);
      previous = position;
    }
    assert.match(onboarding, /fixtureComplete:/);
  });

  it("uses fixture completion only when enrollment is explicitly disabled", async () => {
    const onboarding = await sourceSection("function OnboardingHubView", "function SettingsView");
    assert.match(onboarding, /enrollment\?\.milestones\.map\(\(milestone\) => milestone\.kind\)/);
    // Phase 9's own `enrollmentConfigState` was folded into round 4's shared `BootstrapState`
    // on the merge; "enabled" became "ready" and the other three names are unchanged.
    assert.match(onboarding, /enrollmentState === "ready"[\s\S]*?completedMilestones\.has\(milestone\.kind\)/);
    // Re-pinned by the Tier-2 eviction lane. "Explicitly disabled" was necessary and is no longer
    // sufficient: the bootstrap being off is a deployment fact, and on a signed-in account it left
    // three milestones pre-marked Complete over an enrollment that never happened. The fixture arm
    // now needs the disabled state AND the fixture shell.
    assert.match(onboarding, /enrollmentState === "disabled" && !durableWorkspace\s+\? milestone\.fixtureComplete\s+: false/);
    // This started life as `doesNotMatch(/enrollment\.status/)` — "the checklist must not be
    // derived from enrollment status". R4D-04 then introduced one legitimate reader of that
    // field, so the blanket refusal would now pass for the wrong reason. Assert the property
    // instead: enrollment status has exactly one consumer, and it is the cancellation
    // derivation, not the milestone rows.
    assert.match(onboarding, /const cancelledEnrollment = enrollment\?\.status === "cancelled";/);
    assert.equal((onboarding.match(/enrollment\?\.status/g) ?? []).length, 1);
  });

  it("keeps agreement approval separate from Account settings withdrawal", async () => {
    const onboarding = await sourceSection("function OnboardingHubView", "function SettingsView");
    const settings = await sourceSection("function SettingsView", "function AnalysisQueuedView");
    // The rows now carry a fourth, evidence-derived download capability because
    // the signed service agreement has a real endpoint. Approval, signing and
    // downloading remain separate: an unsigned authorization refuses signing,
    // the signed service agreement downloads through its scoped route, and the
    // fixture-only demo helper never becomes a durable fallback.
    assert.match(onboarding, /status === "Approved" \? "success" : status === "Pending" \? "warning" : "neutral"/);
    assert.match(
      onboarding,
      /status === "Pending" \?[\s\S]{0,300}<Button[^>]+disabled[^>]*>Review and sign<\/Button>/,
    );
    assert.match(
      onboarding,
      /download === "signed" \?[\s\S]{0,500}aria-label="Download signed service agreement"[\s\S]{0,500}downloadSignedAgreement\(\)/,
    );
    assert.match(
      onboarding,
      /download === "demo" \?[\s\S]{0,300}downloadDemoDocument\(name\)/,
    );
    assert.match(
      onboarding,
      /download === "unavailable" \?[\s\S]{0,300}<Button[^>]+disabled/,
    );
    assert.doesNotMatch(onboarding, />Revoke</);
    assert.match(settings, /title="Data permissions"/);
    assert.match(settings, /kind: "analysis" as const/);
    assert.match(settings, /kind: "monitoring" as const/);
    assert.match(settings, /onRevoke\(permission\.kind\)/);
    // Active still revokes. A previously signed Revoked permission now enters
    // the explicit reauthorization flow, while Retained belongs to a cancelled
    // enrollment and remains disabled historical evidence.
    assert.match(settings, /permission\.label === "Revoked" \? "Re-authorize" : "Revoke"/);
    assert.match(
      settings,
      /permission\.label === "Revoked"[\s\S]{0,120}\? onReauthorize\(permission\.kind\)[\s\S]{0,80}: onRevoke\(permission\.kind\)/,
    );
    assert.match(
      settings,
      /permission\.label === "Revoked"[\s\S]{0,160}\? enrollment === null \|\| cancelledEnrollment[\s\S]{0,80}: !permission\.active/,
    );
    assert.match(settings, /label: analysisLabel/);
    assert.match(settings, /label: monitoringLabel/);
  });

  it("keeps the compact chat, nav and assistant contract", async () => {
    // Rewritten for the chat rebuild. Every fact this held is still held; three of them are now
    // held against the view rather than against one file inside it, because the rebuild moved copy
    // between files without changing a word of it and a per-file pin reported that as a deletion.
    // One fact no longer applies and is replaced rather than dropped — see the assistant block.
    const consumer = await readFile(consumerPath, "utf8");
    const shell = await readFile(shellPath, "utf8");
    const view = await teamChatView();

    assert.ok(view.includes(TEAM_CHAT_LABEL), `the ${TEAM_CHAT_LABEL} label did not survive the rebuild`);

    // `eyebrow="Apex Funding Partners"` was one hardcoded brand in one header, and banning that one
    // string says nothing about the next one. The rule underneath it is that this surface has
    // exactly one opinion about the operator's name — the white-label resolution — and the brand
    // literal is the fallback inside it. So the literal is read off that resolution rather than
    // written here, and then required to appear nowhere else in the file. Several eyebrows on this
    // surface are static section labels and stay literal; what may not be literal is a brand.
    const resolution = /sessionIdentity\?\.orgName \?\? "([^"]+)"/.exec(consumer);
    assert.ok(resolution, "the consumer surface no longer resolves its operator brand in one place");
    assert.equal(
      (consumer.match(new RegExp(`"${resolution[1]}"`, "g")) ?? []).length,
      1,
      `"${resolution[1]}" is written somewhere other than the white-label resolution`,
    );

    // Copy that was removed and must stay removed, checked across the view for the same reason as
    // above — a deleted string that reappears one file over is still back on the screen.
    //
    // The last three joined the list on 2026-08-24 by owner ruling (Ayman): the Team Chat's trust
    // strip and the "Protected messages" badge that expanded it are gone, so the sentence this
    // block used to require is now a sentence it forbids. Inverted rather than dropped, because a
    // dropped claim would not notice the strip returning as three literals in another file.
    for (const dead of [
      "Suggestions draft a message",
      "Ask a question answered from the knowledge base",
      "no automated message is posted",
      "Protected messages",
      "Reviewed by your team",
    ]) {
      assert.equal(view.includes(dead), false, `${dead} came back with the rebuild`);
    }

    assert.match(shell, /min-w-0 flex-1 truncate whitespace-nowrap/);
    assert.match(shell, /size-1\.5 shrink-0/);

    // Replaces `<section className="rounded` on the assistant. That assertion pinned the assistant
    // as a block rendered inside the Team Chat, and contract R3 rules that composition out: the
    // consumer assistant is a side panel, never a tab or a block sharing the thread's space. So
    // what is checked is the composition R3 requires — the assistant is a dialog surface — and the
    // identity it carries, imported from the route that stamps it rather than transcribed.
    const assistant = await readFile(assistantPath, "utf8");
    assert.match(assistant, /<Sheet\b/);
    assert.match(assistant, /<SheetContent\b/);
    // The identity is compared against the route's own constant rather than found in the view. The
    // string also appears on the entry tile, so "it is somewhere in the view" stayed true through a
    // rename of the value the panel actually prints — which is the whole thing being guarded.
    const hook = await readFile(new URL("use-assistant.ts", teamChatDir), "utf8");
    assert.ok(
      hook.includes(`const IDENTITY = "${CONSUMER_KB_IDENTITY}"`),
      "the assistant names itself something other than what the route stamps on its answers",
    );
  });
});
