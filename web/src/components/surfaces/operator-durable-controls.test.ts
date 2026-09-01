import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

/**
 * The operator surface's simulated controls, closed against the routes that
 * decide whether each one can be real (docs/backend/UI-WIRING-BACKLOG.md #7,
 * #8, #9, #10, #17).
 *
 * Written in the same style as `failed-read-disclosure.test.ts`: these read
 * source and assert the mechanism, because the thing that rots is not the
 * pixels, it is a control quietly regaining a local-only write. Nothing here is
 * transcribed — the counts come out of the backlog, the fee verdict comes out
 * of the fee route's export list, and the Workspace identity contract comes out
 * of the setup component plus the settings route's allow-list — so an assertion
 * that stopped describing the tree fails rather than passing on a stale copy of
 * itself.
 */

const surface = fs.readFileSync(
  new URL("./operator.tsx", import.meta.url),
  "utf8",
);
// #9's Inbox moved to `components/operator/inbox/` with the chat-rebuild extraction, and then the
// rebuild split it into five files. Its three assertions read that whole directory rather than one
// path inside it: naming a path is how this check would go quiet the next time a lane splits the
// module, which is exactly what happened once already. The rest of this file still reads the
// surface, which still owns those controls.
const inboxDir = new URL("../operator/inbox/", import.meta.url);
const inbox = fs
  .readdirSync(inboxDir)
  .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
  .map((name) => fs.readFileSync(new URL(name, inboxDir), "utf8"))
  .join("\n");
const APPLICATION_CONTROL_COUNT = 9;
const AFFILIATE_CONTROL_COUNT = 8;
// The server page and its client wrapper carry the rail flags down to the
// surface; if either stops threading one, both props fall back to `false` and
// every gated control re-enables with nothing behind it.
const operatorPage = fs.readFileSync(
  new URL("../../app/(surfaces)/operator/page.tsx", import.meta.url),
  "utf8",
);
const operatorClient = fs.readFileSync(
  new URL("../../app/(surfaces)/operator/surface-client.tsx", import.meta.url),
  "utf8",
);
const feeClientRoute = fs.readFileSync(
  new URL("../../app/api/fees/[clientId]/route.ts", import.meta.url),
  "utf8",
);
const feeAgreementRoute = fs.readFileSync(
  new URL("../../app/api/fees/[clientId]/agreement/route.ts", import.meta.url),
  "utf8",
);
const feeEditor = fs.readFileSync(
  new URL("../operator/fee-edit-sheet.tsx", import.meta.url),
  "utf8",
);
const orgSettingsRoute = fs.readFileSync(
  new URL("../../app/api/org/settings/route.ts", import.meta.url),
  "utf8",
);
const operatorOnboarding = fs.readFileSync(
  new URL("./operator-onboarding.tsx", import.meta.url),
  "utf8",
);

function occurrences(needle: string): number {
  return surface.split(needle).length - 1;
}

describe("#9 — the Inbox reply reaches the messages route or is refused", () => {
  it("has no local sent-reply store left to write into", () => {
    // Both files, because the store could come back on either side of the seam now.
    for (const [label, source] of [["surface", surface], ["inbox", inbox]] as const) {
      assert.ok(
        !source.includes("sentReplies"),
        `the local sent-reply map is back in the ${label}; a reply rendered from it was never sent`,
      );
    }
  });

  it("sends through the support client and re-reads the thread", () => {
    assert.ok(inbox.includes("postSupportReply("), "the send no longer calls the route");
    assert.ok(
      inbox.includes("readSupportThread("),
      "the thread is no longer re-read after a send, so what renders as sent is a local guess",
    );
  });

  /**
   * Rewritten 2026-08-22 (chat rebuild, lane 2). It matched `replyBlockedReason` and the literal
   * `<Button className="shrink-0" disabled>` — an identifier and a piece of markup copied out of
   * an implementation, the second of which now belongs to the shared composer rather than to this
   * surface at all. The property they protected is unchanged: a demonstration conversation cannot
   * send, and it must say so rather than look live.
   *
   * The derived form follows that property through the two places it is actually decided. The
   * reason is computed by `composerLock`, which `view-model.test.ts` drives over the whole product
   * of sources and statuses — including the case this assertion was written for — and the shared
   * composer takes it as `lockedReason` and removes every send control while it is present. So a
   * Send that stopped being locked fails in the view model, and a locked composer that grew a
   * Send back fails here.
   */
  it("keeps a fixture conversation's Send disabled and says why", () => {
    const model = fs.readFileSync(
      new URL("../operator/inbox/view-model.ts", import.meta.url),
      "utf8",
    );
    const decider = /export function (\w*[Ll]ock\w*)\(/.exec(model);
    assert.ok(decider, "nothing in the Inbox's view model decides whether the composer is locked");

    // Callers only. The concatenation above includes the module that declares the function, so a
    // bare search for the name would match its own `export function` line and pass on an Inbox
    // that had stopped calling it — which is precisely how this assertion was rotting before.
    const callers = fs
      .readdirSync(inboxDir)
      .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
      .filter((name) => name !== "view-model.ts")
      .filter((name) =>
        new RegExp(`\\b${decider[1]}\\s*\\(`).test(
          fs.readFileSync(new URL(name, inboxDir), "utf8"),
        ),
      );
    assert.notDeepEqual(callers, [], `nothing in the Inbox asks \`${decider[1]}\` why it cannot send`);

    // And the reason has to reach the shared composer, which is the thing that removes the send.
    // Checked on the element rather than anywhere in the directory, because the reason travelling
    // as far as an intermediate pane and stopping there is the same defect.
    // Comments stripped first: this directory's headers explain their own composition and spell
    // `<Composer sendOn="modifier">` in prose, and a JSX scan that reads the prose picks up the
    // first `/>` after it — a different element entirely.
    const composerElement = /<Composer\b[\s\S]*?\n\s*\/>/.exec(
      stripComments(inbox),
    );
    assert.ok(composerElement, "the Inbox no longer mounts the shared composer");
    assert.match(
      composerElement[0],
      /lockedReason=\{/,
      "the reason never reaches the composer, so a demonstration Send looks live",
    );

    // The composer is where "locked" becomes "no send control", and it must stay that way: a
    // disabled button on a conversation that can never send teaches a person to keep pressing it.
    const composer = fs.readFileSync(
      new URL("../chat/composer.tsx", import.meta.url),
      "utf8",
    );
    assert.match(
      composer,
      /const locked = lockedReason !== null/,
      "the composer no longer derives its lock from the reason it was given",
    );
    assert.match(
      composer,
      /const disabled = locked \|\|/,
      "a locked composer no longer disables its controls",
    );
  });
});

describe("#7 — the fee tab reads the ledger and writes what it can", () => {
  it("hydrates from the receivables route and records component payments through the editor", () => {
    assert.ok(surface.includes("readReceivables("), "the fee tab no longer reads /api/fees");
    assert.ok(
      feeEditor.includes("recordFeePayment("),
      "the paid controls no longer record a payment",
    );
    assert.ok(feeEditor.includes("reverseFeePayment("), "a Paid switch can no longer be reversed");
    assert.ok(
      surface.includes("setWorkspaceFeeDefault("),
      "the workspace default fee model is no longer persisted",
    );
  });

  it("never renders fixture money while the ledger is unreadable", () => {
    assert.ok(
      surface.includes("feesUnreadable"),
      "the unreadable-ledger state is gone; an outage would show fixture totals",
    );
    assert.ok(
      surface.includes("Unable to load fee records."),
      "a failed receivables read no longer reaches the screen",
    );
  });

  it("shows funded basis and keeps an edit path for unconfigured active clients", () => {
    const durableTable = surface.slice(
      surface.indexOf("function renderDurableFeeTracking"),
      surface.indexOf("function renderFees"),
    );
    assert.ok(durableTable.includes('model === "package"'));
    assert.ok(durableTable.includes('"Not configured"'));
    assert.ok(durableTable.includes("row.outcomeBasisCents / 100"));
    assert.ok(durableTable.includes("clientId: row.clientId"));
    assert.match(durableTable, />\s*Edit\s*</);
  });

  it("uses the per-client agreement writer instead of an inline simulated select", () => {
    const verbs = [...feeClientRoute.matchAll(/export async function ([A-Z]+)\(/g)]
      .map((match) => match[1]);
    assert.deepEqual(verbs, ["GET"]);
    assert.match(feeAgreementRoute, /export async function PUT\(/);
    assert.match(feeEditor, /setClientFeeAgreement\(/);
    assert.match(surface, /<FeeEditSheet/);
  });
});

/**
 * Re-pinned 2026-08-22 (fixture eviction, LANE A).
 *
 * These counted `applicationWritesDurable` / `affiliateWritesDurable` at the
 * gated controls, which passed while the gate ran the wrong way round: the
 * controls were disabled only while the rail was LIVE, so with the flag off
 * every one of them re-enabled and wrote into an in-memory provider with the
 * "records are not stored" disclosure hidden. The rows those controls act on
 * are fixture handles rather than the UUIDs either route requires, so neither
 * state stores anything. The counts still come out of the backlog; what they
 * count is the unconditional gate, and the two assertions below hold it
 * unconditional so the polarity cannot quietly come back.
 */
describe("#8 and #10 — a live rail disables the controls it cannot back", () => {
  it("gates every application control", () => {
    assert.ok(
      occurrences("applicationControlsDisabled") >= APPLICATION_CONTROL_COUNT,
      "fewer application controls are gated than the surface requires",
    );
    assert.ok(
      surface.includes("const applicationControlsDisabled = true;"),
      "the application gate depends on a rail flag again; a fixture handle reaches neither rail",
    );
  });

  it("gates every affiliate control", () => {
    assert.ok(
      occurrences("affiliateControlsDisabled") >= AFFILIATE_CONTROL_COUNT,
      "fewer affiliate controls are gated than the surface requires",
    );
    assert.ok(
      surface.includes("const affiliateControlsDisabled = true;"),
      "the affiliate gate depends on a rail flag again; a fixture handle reaches neither rail",
    );
  });

  it("takes each rail from a server-rendered flag, never by provoking a 4xx", () => {
    // This started as a client-side probe that read the rail by provoking a 400
    // from /api/applications and a 403 from /api/affiliates/me on every page
    // load. It was correct and it was noisy: two failures in the console and in
    // the walk harness's non-2xx tally, on the one surface whose clean console
    // is checked before every demo. The flags are server-only, so the page
    // passes them down. Assert the mechanism, and assert the probe stays gone.
    assert.ok(
      surface.includes("const applicationWritesDurable = applicationsEnabled"),
      "the applications rail no longer comes from the server-rendered flag",
    );
    assert.ok(
      surface.includes("const affiliateWritesDurable = affiliatesEnabled"),
      "the affiliates rail no longer comes from the server-rendered flag",
    );
    assert.ok(
      !surface.includes("readApplicationsRail(") && !surface.includes("readAffiliatesRail("),
      "the 4xx-provoking rail probe is back on the operator surface",
    );
    // The flags must actually reach the surface, or both props sit at their
    // `false` default and every gated control silently re-enables.
    for (const file of [operatorPage, operatorClient]) {
      assert.ok(
        file.includes("applicationsEnabled") && file.includes("affiliatesEnabled"),
        "a rail flag stopped being threaded from the server page to the surface",
      );
    }
  });
});

describe("#17 — workspace identity is saved through durable rails", () => {
  it("does not render or submit a workspace-wide default goal", () => {
    assert.doesNotMatch(surface, /Default client funding goal/);
    assert.doesNotMatch(surface, /saveWorkspaceGoal\(/);
    assert.doesNotMatch(surface, /id="default-goal"/);
  });

  it("persists workspace name and brand while keeping unsupported support email disabled", () => {
    const declaration = /const SETTABLE_KEYS = \[([\s\S]*?)\] as const;/.exec(
      orgSettingsRoute,
    );
    assert.ok(declaration, "the settings route no longer declares SETTABLE_KEYS");
    const keys = [...declaration[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assert.ok(
      keys.includes("name"),
      "Workspace Setup can no longer persist the workspace name",
    );
    assert.ok(
      !keys.includes("support_email"),
      "support email gained a durable key — wire its field before enabling it",
    );
    assert.match(operatorOnboarding, /fetch\("\/api\/org\/settings"[\s\S]*?JSON\.stringify\(\{ name: nextBusinessName \}\)/);
    assert.match(operatorOnboarding, /fetch\("\/api\/org\/brand"[\s\S]*?portalName: nextPortalName/);
    assert.match(operatorOnboarding, /verifiedWorkspaceNameResponse\(settingsBody, nextBusinessName\)/);
    assert.match(operatorOnboarding, /verifiedBrandResponse\(colorBody/);
    assert.ok(
      operatorOnboarding.indexOf("await saveBrand()")
        < operatorOnboarding.indexOf('setRoute("complete")'),
      "Workspace Setup can claim completion before its durable writes finish",
    );

    const supportEmailAt = surface.indexOf('id="support-email"');
    assert.ok(supportEmailAt > 0, "the support-email field is gone");
    const supportEmail = surface.slice(
      surface.lastIndexOf("<Input", supportEmailAt),
      supportEmailAt,
    );
    assert.ok(
      supportEmail.includes("disabled"),
      "support-email collects text even though no route persists it",
    );
  });
});
