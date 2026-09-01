// The Inbox's decisions, driven rather than described.
//
// Every assertion below derives what it expects from the module that owns the fact at the moment
// it runs — the draft engine for a draft's verdict, the tracker's own label table for the stage
// vocabulary, the watermark on the payload for unread. Nothing is transcribed out of the code it
// checks, because a transcription passes for exactly as long as nobody changes the thing it was
// copied from, which is the failure round 5 named.
//
// Each block records what it was watched failing against. Since this module is new, "before the
// fix" is a planted mutation rather than an earlier tree: the mutation is stated, it was applied,
// the named assertion was seen red, and it was reverted.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { NORMALIZED_ADVERSARIAL_LANGUAGE } from "@/lib/compliance/__fixtures__/adversarial-language.mjs";
import { runDraftEngine } from "@/lib/support/engine";
import { evaluateDraftLanguage } from "@/lib/support/language-gate";
import { SUPPORT_DRAFT_EMBEDDED_PROMPT } from "@/lib/support/prompt";
import { SUPPORT_THREAD_STATUSES } from "@/lib/operator/support-inbox.client";
import { TRACKER_STAGES, TRACKER_STAGE_LABELS } from "@/lib/tracker/types";
import type {
  SupportDraftCandidate,
  SupportDraftContext,
  SupportDraftDecision,
  SupportDraftDriver,
  SupportDraftReasonCode,
  SupervisorVerdict,
} from "@/lib/support/types";
import type {
  SupportInboxDraft,
  SupportInboxMessage,
  SupportInboxThread,
} from "@/lib/operator/support-inbox.client";
import type { ChatThreadStatus, ChatThreadSummary } from "@/components/chat/types";

import {
  INBOX_SOURCES,
  autoSelect,
  draftPlacement,
  authorFor,
  composerLock,
  draftPresentation,
  filterThreads,
  isOwnMessage,
  snapshotRows,
  stageLabel,
  statusCounts,
  stepSelection,
  threadDigest,
  toSelectable,
  toThreadItems,
  toThreadSummary,
  type DraftHold,
} from "./view-model";

// ---------------------------------------------------------------------------------------------
// Fixtures shaped like the payloads, not like the assertions
// ---------------------------------------------------------------------------------------------

function thread(over: Partial<SupportInboxThread> = {}): SupportInboxThread {
  return {
    clientId: "client-handle",
    id: "thread-handle",
    kind: "team_chat",
    internalMessageCount: 0,
    lastActivityAt: "2026-08-20T10:00:00.000Z",
    lastInternalMessagePreview: null,
    lastMessagePreview: "The statements are uploaded.",
    lastParticipantMessagePreview: "The statements are uploaded.",
    participantMessageCount: 1,
    read: { counterpartReadAt: null, lastReadAt: null, unreadCount: 0 },
    status: "open",
    subject: "Team Chat",
    ...over,
  };
}

function message(over: Partial<SupportInboxMessage> = {}): SupportInboxMessage {
  return {
    authorKind: "consumer",
    body: "Anything else before the next update?",
    id: "message-handle",
    origin: "human",
    sentAt: "2026-08-20T10:00:00.000Z",
    visibility: "participants",
    ...over,
  };
}

function summary(over: Partial<ChatThreadSummary> = {}): ChatThreadSummary {
  return {
    lastActivityAt: "2026-08-20T10:00:00.000Z",
    preview: null,
    ref: "a",
    status: "open",
    title: "Maya Okafor",
    unreadCount: 0,
    ...over,
  };
}

const NAMES = { admin: "Platform team", consumer: "Maya Okafor", operator: "Apex Funding" };

// ---------------------------------------------------------------------------------------------
// The held draft, against the engine that decides it
// ---------------------------------------------------------------------------------------------

/**
 * A driver that returns exactly what a case needs, so the engine reaches each of its verdicts.
 *
 * The engine is the module that owns the mapping — `reasonFor` resolves the four reasons in
 * precedence order and `status` is `approved` if and only if the reason was `gates_passed`. So
 * this drives the real thing and asserts the surface's inversion agrees with it, rather than
 * re-stating the precedence here where it would be a copy that rots on its own.
 */
function driverFor(candidate: SupportDraftCandidate, approved: boolean): SupportDraftDriver {
  return {
    driver: "mock",
    model: candidate.model,
    generateDraft: async () => candidate,
    superviseDraft: async (): Promise<SupervisorVerdict> => ({
      approved,
      codes: approved ? [] : ["SUPERVISOR_HELD"],
    }),
  };
}

const CONTEXT: SupportDraftContext = {
  recentMessages: [{ authorKind: "consumer", body: "Is that expected now?" }],
  threadKind: "team_chat",
  threadSubject: "Team Chat",
};

async function decide(
  body: string,
  confidence: number,
  approved: boolean,
): Promise<SupportDraftDecision> {
  return runDraftEngine(driverFor({ body, confidence, model: "test" }, approved), CONTEXT, 0.7, {
    env: {},
    recordEvaluation: async () => undefined,
    resolvePrompt: async () => ({ ...SUPPORT_DRAFT_EMBEDDED_PROMPT, source: "embedded" as const }),
  });
}

/** The decision as the browser receives it: the route sends these six fields and no others. */
function asPayload(decision: SupportDraftDecision): SupportInboxDraft {
  return {
    body: decision.body,
    confidence: decision.confidence,
    confidenceThreshold: decision.confidenceThreshold,
    guardrailFlags: decision.guardrailFlags,
    id: "draft-handle",
    status: decision.status,
  };
}

describe("a held draft is described in terms the payload supports", () => {
  const CLEAN = "Upload the statements in Files and I will confirm the packet before you continue.";

  /**
   * A body the language gate refuses, read out of the shared corpus rather than written here.
   *
   * Two reasons pulling the same way, and `lib/support/engine.test.ts` made the same call for the
   * same pair. A literal would be restricted vocabulary sitting in a source file, so
   * `verify-compliance-copy.mjs` would fail this tree and the repair would be a new allow-list
   * entry on a compliance gate — the wrong direction entirely. And reading the corpus means this
   * exercises whatever the gate actually refuses today rather than a copy of it that can drift.
   */
  const FLAGGED = ((): string => {
    const found = NORMALIZED_ADVERSARIAL_LANGUAGE.find(
      (candidate: string) => evaluateDraftLanguage(candidate).length > 0,
    );
    assert.ok(found, "the shared adversarial corpus no longer holds a body the gate refuses");
    return found;
  })();

  /**
   * Every reason the engine can record, reached through the engine itself.
   *
   * This is where the first version of this suite was wrong and the test is what found it. It
   * asserted `draftHold` reproduced `decision.reasonCode` exactly, and it went red on the
   * supervisor case: `reasonFor` resolves the supervisor before the guardrail flags, so a draft
   * that is both flagged and rejected records `supervisor_rejected` while the payload the browser
   * gets — flags, confidence, `status: "draft"` — is identical to a purely flagged one. The
   * inversion I had claimed was exhaustive is not, and the fix was to stop claiming it rather
   * than to reorder the surface until the assertion passed.
   *
   * So what is asserted now is what the payload can actually carry, which is strictly weaker and
   * true: the send is offered exactly where the database would accept it, and every held draft is
   * described by a statement its own fields support.
   */
  async function decisionsByReason(): Promise<Map<SupportDraftReasonCode, SupportDraftDecision>> {
    const cases = [
      { approved: true, body: CLEAN, confidence: 0.9 },
      { approved: true, body: FLAGGED, confidence: 0.9 },
      { approved: true, body: CLEAN, confidence: 0.4 },
      { approved: false, body: CLEAN, confidence: 0.9 },
    ];
    const byReason = new Map<SupportDraftReasonCode, SupportDraftDecision>();
    for (const each of cases) {
      const decision = await decide(each.body, each.confidence, each.approved);
      byReason.set(decision.reasonCode, decision);
    }

    // Every reason the engine's own type declares was exercised, so a fifth member added to the
    // union fails here rather than falling quietly into the surface's last branch.
    const source = readFileSync(
      new URL("../../../lib/support/types.ts", import.meta.url),
      "utf8",
    );
    const union = /export type SupportDraftReasonCode =([\s\S]*?);/.exec(source);
    assert.ok(union, "SupportDraftReasonCode is no longer declared as a union");
    const declared = [...union[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    assert.ok(declared.length >= 4, `only ${declared.length} reason codes parsed`);
    assert.deepEqual(
      [...byReason.keys()].sort(),
      [...declared].sort(),
      "a reason code the engine can return was never driven through the surface",
    );
    return byReason;
  }

  /**
   * Watched failing against a planted mutation: dropping the `guardrailFlags.length > 0` branch
   * from `draftHold`, so a flagged draft is described as a reviewer hold. The language assertion
   * below then names a draft whose flags the frame does not mention.
   */
  it("says compliance language when, and only when, the gate flagged it", async () => {
    for (const decision of (await decisionsByReason()).values()) {
      const shown = draftPresentation(asPayload(decision));
      if (shown.hold === "cleared") continue;
      assert.equal(
        shown.hold === "language",
        decision.guardrailFlags.length > 0,
        `a draft with ${decision.guardrailFlags.length} flag(s) is described as \`${shown.hold}\``,
      );
    }
  });

  it("calls a draft thin only when nothing but the bar is against it", async () => {
    for (const decision of (await decisionsByReason()).values()) {
      const payload = asPayload(decision);
      const shown = draftPresentation(payload);
      if (!shown.thin) continue;
      assert.equal(payload.guardrailFlags.length, 0);
      assert.ok(payload.confidence < payload.confidenceThreshold);
    }
  });

  /**
   * Watched failing against a planted mutation: making the language branch's `sendable` follow
   * the confidence bar. The flagged draft's confidence is 0.9, so it starts offering a send that
   * migration 101 would refuse, and this names it.
   *
   * Driven over every reason the engine can reach rather than over three hand-picked cases. The
   * first version used its own clean-bodied cases, never reached the language branch, and let
   * that exact mutation through — which is the enumeration failure one level down.
   */
  it("offers a send only where the database would accept one", async () => {
    for (const decision of (await decisionsByReason()).values()) {
      const shown = draftPresentation(asPayload(decision));
      assert.equal(
        shown.sendable,
        decision.status === "approved",
        `a ${decision.reasonCode} draft offers a send the guard would reject`,
      );
    }
  });

  it("states confidence in words and never as a figure", async () => {
    for (const confidence of [0.05, 0.4, 0.7, 0.95]) {
      const decision = await decide("Bring the card under the target.", confidence, true);
      const shown = draftPresentation(asPayload(decision));
      for (const line of [shown.confidence, shown.holdReason ?? ""]) {
        assert.equal(
          /\d/.test(line),
          false,
          `the draft frame prints a figure: ${JSON.stringify(line)}`,
        );
      }
    }
  });

  /**
   * The design brief's thin draft. Derived from the engine rather than from the mock's 0.40:
   * whatever the fallback confidence becomes, a draft under its own bar with nothing else against
   * it is the one that must not be framed as a draft.
   */
  it("refuses to frame a draft the engine returned under its own bar", async () => {
    const under = draftPresentation(
      asPayload(await decide("I am not sure what you are asking.", 0.4, false)),
    );
    assert.equal(under.thin, true);
    assert.equal(under.hold, "thin");

    const over = draftPresentation(
      asPayload(await decide("I am not sure what you are asking.", 0.9, false)),
    );
    assert.equal(over.thin, false, "a draft that cleared the bar is being called thin");
  });
});

// ---------------------------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------------------------

describe("a list row says what the server said", () => {
  /**
   * Watched failing against a planted mutation: deriving `unreadCount` from
   * `read.lastReadAt === null ? 1 : 0`. The row then reports one unread on a thread the database
   * says has four, and this names the disagreement.
   *
   * Driven from the parser's own output rather than a literal, so a change to how the watermark
   * arrives moves both sides together.
   */
  it("copies the unread count off the watermark instead of computing one", () => {
    for (const unreadCount of [0, 1, 4, 97]) {
      const row = toThreadSummary(thread({ read: { counterpartReadAt: null, lastReadAt: null, unreadCount } }), undefined);
      assert.equal(row.unreadCount, unreadCount);
    }
  });

  it("falls back to the subject only when the directory cannot name the client", () => {
    assert.equal(toThreadSummary(thread(), undefined).title, "Team Chat");
    assert.equal(
      toThreadSummary(thread(), { displayName: "Maya Okafor" }).title,
      "Maya Okafor",
    );
  });

  it("uses the preview for the selected inbox audience", () => {
    const row = thread({
      internalMessageCount: 1,
      lastInternalMessagePreview: "Review the agreement before replying.",
      lastParticipantMessagePreview: "The statements are uploaded.",
    });
    assert.equal(toThreadSummary(row, undefined, "participants").preview, "The statements are uploaded.");
    assert.equal(toThreadSummary(row, undefined, "internal").preview, "Review the agreement before replying.");
  });

  /**
   * Watched failing against a planted mutation: dropping the `TRACKER_STAGE_LABELS` lookup and
   * returning the raw token. Every tracker stage then renders lowercase and this fails on the
   * first one.
   */
  it("crosses every tracker stage into the chat vocabulary", () => {
    for (const stage of TRACKER_STAGES) {
      const expected = TRACKER_STAGE_LABELS[stage];
      assert.equal(stageLabel(stage), expected, `\`${stage}\` has no label`);
      // The fixture rows already carry the label form, so both shapes have to resolve.
      assert.equal(stageLabel(expected), expected);
    }
    assert.equal(stageLabel(null), undefined);
    assert.equal(stageLabel("not-a-stage"), undefined);
  });
});

describe("filtering and moving through the list", () => {
  const rows = [
    summary({ preview: "Chase Ink payment", ref: "a", title: "Maya Okafor" }),
    summary({ ref: "b", status: "pending", title: "Tasha Nguyen" }),
    summary({ ref: "c", status: "resolved", title: "Amara Sow" }),
    summary({ ref: "d", subtitle: "Cho Bakery", title: "Priya Cho" }),
  ];

  it("counts every status the summaries carry", () => {
    const counts = statusCounts(rows);
    assert.deepEqual(counts, { open: 2, pending: 1, resolved: 1 });
    // The totals account for every row, so a status added to the union cannot vanish from the
    // tab row without this going red.
    assert.equal(
      Object.values(counts).reduce((total, count) => total + count, 0),
      rows.length,
    );
  });

  it("searches every field the row actually shows", () => {
    const base = { member: "all", ownerByThread: undefined, status: "open" } as const;
    assert.deepEqual(
      filterThreads(rows, { ...base, query: "okafor" }).map((row) => row.ref),
      ["a"],
    );
    assert.deepEqual(
      filterThreads(rows, { ...base, query: "chase" }).map((row) => row.ref),
      ["a"],
      "the preview is not searched, so a result the row displays cannot be found",
    );
    assert.deepEqual(
      filterThreads(rows, { ...base, query: "bakery" }).map((row) => row.ref),
      ["d"],
      "the subtitle is not searched",
    );
    assert.deepEqual(filterThreads(rows, { ...base, query: "  " }).map((row) => row.ref), [
      "a",
      "d",
    ]);
  });

  it("filters by the owner the caller resolved, never by a name", () => {
    const owners = new Map([
      ["a", "member-1"],
      ["d", null],
    ]);
    assert.deepEqual(
      filterThreads(rows, {
        member: "member-1",
        ownerByThread: owners,
        query: "",
        status: "open",
      }).map((row) => row.ref),
      ["a"],
    );
  });

  /**
   * Watched failing against a planted mutation: wrapping the index with a modulo. `k` at the top
   * then jumps to the bottom of the list, and the first assertion names it.
   */
  it("clamps at both ends rather than wrapping", () => {
    const refs = ["a", "b", "c"];
    assert.equal(stepSelection(refs, "a", -1), "a");
    assert.equal(stepSelection(refs, "c", 1), "c");
    assert.equal(stepSelection(refs, "b", 1), "c");
    assert.equal(stepSelection(refs, "b", -1), "a");
    assert.equal(stepSelection(refs, null, 1), "a");
    assert.equal(stepSelection(refs, "gone", 1), "a");
    assert.equal(stepSelection([], "a", 1), null);
  });
});

// ---------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------

describe("messages carry an author and no claim about the reader", () => {
  /**
   * Watched failing against a planted mutation: setting `delivery` to `"read"` for operator
   * messages, which is the specific lie contract §4 names — the only watermark this surface holds
   * is the operator's own and it says nothing about the client.
   */
  it("never marks a stored message read", () => {
    const items = toThreadItems(
      [message(), message({ authorKind: "operator", id: "m2" }), message({ authorKind: "admin", id: "m3" })],
      NAMES,
    );
    for (const item of items) {
      assert.equal(item.type, "message");
      if (item.type !== "message") continue;
      assert.equal(item.message.delivery, "delivered");
    }
  });

  it("attributes each author kind the payload can carry", () => {
    // The kinds come off the parser's own closed set rather than a list here, so a fourth kind
    // added to the rail fails this rather than rendering as an unnamed bubble.
    const rail = readFileSync(
      new URL("../../../lib/operator/support-inbox.client.ts", import.meta.url),
      "utf8",
    );
    const declared = /const AUTHOR_KINDS = new Set\(\[([^\]]*)\]\)/.exec(rail);
    assert.ok(declared, "the rail no longer declares AUTHOR_KINDS");
    const kinds = [...declared[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assert.ok(kinds.length >= 3, "AUTHOR_KINDS parsed as almost nothing");

    for (const kind of kinds) {
      const author = authorFor(kind as "consumer", NAMES);
      assert.equal(typeof author.name, "string");
      assert.notEqual(author.name, "", `\`${kind}\` has no name to render`);
      assert.notEqual(author.roleLabel, undefined, `\`${kind}\` has no role chip`);
    }
  });

  /**
   * Re-homed from `surfaces/operator-inbox-durable.test.ts`, which made this claim against
   * `SupportThreadView` — a component the rebuilt Inbox no longer renders, so the assertion was
   * green and checking nothing about this surface. Restated against the thread the Inbox actually
   * mounts, and still derived from the parser's own closed set rather than a list here.
   *
   * Watched failing against a planted mutation: `origin: "human" as const` in `toThreadItems`,
   * which is exactly the defect that would make an assisted reply indistinguishable from a typed
   * one in the bubble — the disclosure contract §4 requires.
   */
  it("carries every message origin the payload parser accepts through to the bubble", () => {
    const rail = readFileSync(
      new URL("../../../lib/operator/support-inbox.client.ts", import.meta.url),
      "utf8",
    );
    const declared = /const MESSAGE_ORIGINS = new Set\(\[([^\]]*)\]\)/.exec(rail);
    assert.ok(declared, "the rail no longer declares MESSAGE_ORIGINS");
    const origins = [...declared[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assert.ok(origins.length > 1, "MESSAGE_ORIGINS parsed as a single value");

    const items = toThreadItems(
      origins.map((origin, index) =>
        message({ id: `m${index}`, origin: origin as "human" }),
      ),
      NAMES,
    );
    assert.deepEqual(
      items.map((item) => (item.type === "message" ? item.message.origin : null)),
      origins,
      "an origin is rewritten on the way to the bubble",
    );

    // And the bubble it is handed to tells them apart. Without this the pass-through above is
    // satisfied by a component that ignores the field entirely.
    const thread = readFileSync(
      new URL("../../chat/message-thread.tsx", import.meta.url),
      "utf8",
    );
    for (const origin of origins.filter((each) => each !== "human")) {
      assert.match(
        thread,
        new RegExp(`origin === "${origin}"`),
        `the thread never distinguishes the \`${origin}\` origin it is handed`,
      );
    }
  });

  it("puts the client opposite everyone who works here", () => {
    const items = toThreadItems(
      [message(), message({ authorKind: "operator", id: "m2" })],
      NAMES,
    );
    const own = items.map((item) => (item.type === "message" ? isOwnMessage(item.message) : null));
    assert.deepEqual(own, [false, true]);
  });
});

// ---------------------------------------------------------------------------------------------
// The composer lock
// ---------------------------------------------------------------------------------------------

/**
 * Re-homed from `#9` in `surfaces/operator-durable-controls.test.ts`, which pinned this by
 * matching `replyBlockedReason` and the literal `<Button className="shrink-0" disabled>` in the
 * old body. Both are transcriptions of markup, and the second belongs to a component this lane
 * does not own any more. The claim under them — a Send that cannot work is never merely dead, it
 * says why — is restated here against the decision itself, driven over the whole product of
 * sources and statuses rather than the one case the reproduction happened to hit.
 */
describe("a composer that cannot send says why", () => {
  /**
   * Watched failing against a planted mutation: returning `null` for the fixture source, which is
   * the exact regression — a demonstration Send that looks live and silently does nothing.
   */
  it("never locks without a reason, and never gives a reason without locking", () => {
    const statuses: (ChatThreadStatus | null)[] = [null, ...SUPPORT_THREAD_STATUSES];
    assert.ok(INBOX_SOURCES.length === 3, "the source set changed; re-derive what each one owes");

    const seen = new Map<string, string | null>();
    for (const source of INBOX_SOURCES) {
      for (const status of statuses) {
        const reason = composerLock(source, status);
        if (reason !== null) {
          assert.ok(reason.trim().length > 0, `\`${source}/${status}\` locks with an empty reason`);
          assert.match(reason, /\.$/, `\`${source}/${status}\` does not say why in a sentence`);
        }
        seen.set(`${source}/${status}`, reason);
      }
    }

    // The fixture body has nowhere to send to, so it is locked whatever the conversation says.
    for (const status of statuses) {
      assert.notEqual(seen.get(`fixture/${status}`), null, "the demonstration Send is not locked");
    }
    // A signed-in workspace is locked by the conversation and nothing else.
    for (const status of SUPPORT_THREAD_STATUSES) {
      assert.equal(
        seen.get(`durable/${status}`) === null,
        status !== "resolved",
        `a \`${status}\` conversation is locked wrongly`,
      );
    }
  });

  it("blames the conversation rather than the send when it is resolved", () => {
    // The route refuses this with `SUPPORT_THREAD_CLOSED`, so the copy has to name the state the
    // operator can act on rather than report a failure they cannot.
    const reason = composerLock("durable", "resolved");
    assert.ok(reason !== null);
    assert.match(reason, /resolved/i);
    assert.doesNotMatch(reason, /fail|error|could not|went wrong/i);
  });
});

// ---------------------------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------------------------

describe("the digest is computed from the conversation", () => {
  it("leads with whoever spoke last", () => {
    assert.match(
      threadDigest({
        clientName: "Maya Okafor",
        hasDraft: false,
        messages: [message()],
        status: "open",
        unreadCount: 0,
      }).lead,
      /Maya Okafor/,
    );
    assert.match(
      threadDigest({
        clientName: "Maya Okafor",
        hasDraft: false,
        messages: [message({ authorKind: "operator" })],
        status: "open",
        unreadCount: 0,
      }).lead,
      /Your team/,
    );
  });

  it("says nothing at all rather than inventing a summary of an empty thread", () => {
    const digest = threadDigest({
      clientName: "Maya Okafor",
      hasDraft: false,
      messages: [],
      status: "open",
      unreadCount: 0,
    });
    assert.equal(digest.at, null);
    assert.deepEqual(digest.bullets, []);
  });

  /**
   * Watched failing against a planted mutation: dropping the `slice(0, 3)`. This thread is
   * unread, waiting, holding a draft, carrying a note and holding two messages, so five candidate
   * bullets are collected and the rail stops being a summary.
   */
  it("never runs past three bullets", () => {
    const digest = threadDigest({
      clientName: "Maya Okafor",
      hasDraft: true,
      messages: [
        message({ id: "m1", visibility: "internal", authorKind: "operator" }),
        message({ id: "m2" }),
      ],
      status: "open",
      unreadCount: 2,
    });
    assert.ok(digest.bullets.length <= 3, `${digest.bullets.length} bullets`);
    assert.ok(digest.bullets.length > 0);
  });

  /**
   * W-11, from the walk of the production deploy: a conversation nobody had written in filled the
   * rail with three sentences — "Nothing has been said in this conversation yet.", then a caption
   * saying the figures were counted from the messages and that no model wrote them. Two of those
   * three explain the provenance of a count that is not on screen, and the pane spent more words
   * on a zero than it does on a live conversation.
   *
   * The caption belongs to the figures, so the digest is what decides whether there is one: it
   * comes back with the bullets or it does not come back at all. Watched failing against the rail
   * that printed it unconditionally, where this returned `undefined` for both threads.
   */
  it("captions the figures only where there are figures", () => {
    const counted = threadDigest({
      clientName: "Maya Okafor",
      hasDraft: false,
      messages: [message()],
      status: "open",
      unreadCount: 1,
    });
    assert.ok(counted.bullets.length > 0, "this thread was supposed to produce figures");
    assert.equal(typeof counted.provenance, "string");
    assert.ok((counted.provenance ?? "").length > 0);

    const empty = threadDigest({
      clientName: "Maya Okafor",
      hasDraft: false,
      messages: [],
      status: "open",
      unreadCount: 0,
    });
    assert.deepEqual(empty.bullets, [], "this thread was supposed to produce no figures");
    assert.equal(empty.provenance, null);
  });

  it("counts unread in the singular when there is one of it", () => {
    const one = threadDigest({
      clientName: "Maya",
      hasDraft: false,
      messages: [message()],
      status: "open",
      unreadCount: 1,
    });
    assert.ok(one.bullets.some((bullet) => bullet.startsWith("1 message since")));
  });
});

describe("the client snapshot shows only what it was told", () => {
  const format = { date: (iso: string) => iso.slice(0, 10) };

  /**
   * Watched failing against a planted mutation: rendering an em dash for an absent readiness.
   * The row then appears with no value and no provenance, which reads as "this client has none"
   * rather than "this pane was not told".
   */
  it("omits a figure it does not have instead of drawing a blank row", () => {
    const rows = snapshotRows({ displayName: "Maya Okafor" }, format);
    assert.deepEqual(rows, []);
  });

  it("carries provenance with every figure that has a source date", () => {
    const rows = snapshotRows(
      {
        displayName: "Maya Okafor",
        nextRefreshAt: "2026-09-01T00:00:00.000Z",
        openActionCount: 3,
        readiness: 71,
        readinessAt: "2026-08-14T00:00:00.000Z",
        stage: "optimization",
      },
      format,
    );
    const readiness = rows.find((row) => row.label === "Verified readiness");
    assert.ok(readiness, "the readiness row is gone");
    assert.equal(readiness.value, "71");
    assert.match(readiness.provenance ?? "", /2026-08-14/);
    assert.ok(rows.some((row) => row.label === "Stage" && row.value === "Optimization"));
  });

  /**
   * Watched failing against the copy this replaced — "Awaiting its first source review" — which is
   * the tri-state mistake in one line: a missing date has two causes, only one of which is a fact
   * about the client, and the pane was picking the one that reads as a confident statement. The
   * field really was unthreaded for a while, so every client with a readiness score was being
   * described as never reviewed.
   */
  it("never turns a missing source date into a claim about the client", () => {
    for (const readinessAt of [null, undefined, ""]) {
      const rows = snapshotRows(
        { displayName: "Maya", readiness: 62, readinessAt },
        format,
      );
      const readiness = rows.find((row) => row.label === "Verified readiness");
      assert.ok(readiness, `the readiness row is gone for ${JSON.stringify(readinessAt)}`);
      // The figure is never bare — a score with nothing beside it is read as today's.
      assert.ok((readiness.provenance ?? "").length > 0, "the figure renders with no provenance");
      assert.doesNotMatch(
        readiness.provenance ?? "",
        /awaiting|never|first|not yet|no review/i,
        "an absent date is being reported as something the client has not done",
      );
    }
  });

  it("dates the figure when the source review is known", () => {
    const rows = snapshotRows(
      { displayName: "Maya", readiness: 62, readinessAt: "2026-08-14T00:00:00.000Z" },
      format,
    );
    const readiness = rows.find((row) => row.label === "Verified readiness");
    assert.ok(readiness);
    assert.match(readiness.provenance ?? "", /2026-08-14/);
  });
});

// ---------------------------------------------------------------------------------------------
// Where a held draft goes
// ---------------------------------------------------------------------------------------------

describe("a held draft is always shown somewhere", () => {
  /**
   * Watched failing on the tree that introduced this: the frame and the notice were two separate
   * conditions in JSX, and there was a combination both refused — an approved suggestion on a
   * conversation with no send wired at all, which is what the demonstration workspace is. The
   * Copilot rail said "a suggestion is already waiting in your composer" and the composer showed
   * nothing at all. Found in a browser, not by a test, which is why the decision is a total
   * function now and this drives the whole product of its inputs rather than the case that broke.
   */
  it("has a place for every combination of hold, lock, send and tab", () => {
    const holds: DraftHold[] = ["cleared", "language", "thin", "review"];
    const places = new Set<string>();
    for (const hold of holds) {
      for (const canSend of [false, true]) {
        for (const locked of [false, true]) {
          for (const note of [false, true]) {
            const place = draftPlacement({ canSend, hold, locked, note });
            assert.ok(
              ["frame", "notice", "hidden"].includes(place),
              `no place for ${hold}/${canSend}/${locked}/${note}`,
            );
            places.add(place);
          }
        }
      }
    }
    assert.deepEqual(
      [...places].sort(),
      ["frame", "hidden", "notice"],
      "one of the three placements is unreachable",
    );
  });

  it("never frames a suggestion the shared composer would draw a live Send for", () => {
    // The frame draws its own send controls unless the composer is locked. Framing a draft with
    // no send wired and no lock would put a Send on screen that does nothing.
    for (const hold of ["cleared", "language", "thin", "review"] as DraftHold[]) {
      assert.equal(
        draftPlacement({ canSend: false, hold, locked: false, note: false }),
        "notice",
        `a \`${hold}\` draft is framed with no send behind it`,
      );
    }
  });

  /**
   * Watched failing on the tree that introduced this, in a browser: the note tab shared the
   * notice's branch, so a suggested reply for the client sat directly above the field for a note
   * to the team, on the same amber ground, with a Take-it-into-my-reply control that would have
   * put it in the wrong composer.
   */
  it("puts the reply's suggestion away entirely on the note tab", () => {
    for (const hold of ["cleared", "language", "thin", "review"] as DraftHold[]) {
      for (const canSend of [false, true]) {
        for (const locked of [false, true]) {
          assert.equal(
            draftPlacement({ canSend, hold, locked, note: true }),
            "hidden",
            `a \`${hold}\` suggestion is still on screen above an internal note`,
          );
        }
      }
    }
  });
});


// ---------------------------------------------------------------------------------------------
// Which conversation opens, against the column the database nulls
// ---------------------------------------------------------------------------------------------

const MIGRATIONS = fileURLToPath(new URL("../../../../../supabase/migrations", import.meta.url));

/**
 * The digest's definition, found by what defines it rather than by a file number.
 *
 * More than one migration may define it, because a `returns table` column cannot be added by
 * `create or replace` and the only way to add one is drop-and-recreate in a forward migration.
 * The ledger is applied in filename order and the last definition is the one the database runs,
 * so this reads the highest-numbered definer rather than asserting there is exactly one. The
 * assertion that remains is the one that still means something: at least one file defines it.
 */
function digestBody(): string {
  const owners = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .filter((name) =>
      readFileSync(path.join(MIGRATIONS, name), "utf8").includes(
        "create function public.support_list_thread_digest",
      ),
    )
    .sort();
  assert.notEqual(owners.length, 0, "no migration defines the thread digest at all");
  const sql = readFileSync(path.join(MIGRATIONS, owners[owners.length - 1]), "utf8");
  const from = sql.indexOf("create function public.support_list_thread_digest");
  const to = sql.indexOf("$$;", from);
  assert.notEqual(to, -1, "the digest's definition is not closed");
  return sql.slice(from, to);
}

/** Depth-aware, because every interesting expression in this function is a subquery. */
function splitTopLevel(text: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

describe("which conversation the Inbox opens for you", () => {
  /**
   * The rule reads `preview === null` as "nothing has been said here", and that is only true for
   * as long as the database keeps producing null for exactly that. So the equivalence is derived
   * from the digest rather than believed: the expression behind `last_message_preview` is located
   * by its position in the returns table, and it has to be a single-row subselect over the
   * messages this reader may see, with nothing coalescing the empty case into a value.
   *
   * Watched failing by wrapping the expression in `coalesce(..., '')` in the migration: the rule
   * would then have opened a conversation with nothing in it and no test would have said so.
   */
  it("reads emptiness off the column the database nulls for exactly that", () => {
    const body = digestBody();

    const returns = body.slice(body.indexOf("returns table (") + "returns table (".length);
    const columns = splitTopLevel(returns.slice(0, returns.indexOf("\n)"))).map(
      (column) => column.split(/\s+/)[0],
    );
    const position = columns.indexOf("last_message_preview");
    assert.notEqual(position, -1, "the digest no longer returns a preview at all");

    const listStart = body.indexOf("select", body.indexOf("as $$"));
    let depth = 0;
    let listEnd = -1;
    for (let index = listStart; index < body.length; index += 1) {
      const char = body[index];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (depth === 0 && body.slice(index, index + 5).toLowerCase() === "from ") {
        listEnd = index;
        break;
      }
    }
    assert.notEqual(listEnd, -1, "the digest's select list could not be read");
    const expressions = splitTopLevel(body.slice(listStart + "select".length, listEnd));
    assert.equal(
      expressions.length,
      columns.length,
      "the digest returns a different number of columns than it selects",
    );

    const preview = expressions[position];
    assert.match(preview, /from\s+public\.support_messages/, "the preview is no longer read from the messages");
    assert.match(preview, /limit\s+1/, "the preview is no longer a single row");
    assert.doesNotMatch(
      preview,
      /coalesce/i,
      "the preview has a fallback value, so a thread with nothing in it no longer reads as empty",
    );
  });

  /**
   * W-9, found in a browser walk of the production deploy: the Inbox opened on the thread at the
   * top of the list, the list is ordered by last activity, and the newest row was one nobody had
   * written in — so the middle pane said "Nothing here yet" while two clients with unread messages
   * sat underneath it.
   *
   * Watched failing against the rule it replaced, `threads[0]`, which returns the empty row here.
   */
  it("never opens a conversation nobody has written in", () => {
    const chosen = autoSelect([
      summary({ lastActivityAt: "2026-08-22T09:00:00.000Z", preview: null, ref: "silent" }),
      summary({ lastActivityAt: "2026-08-18T09:00:00.000Z", preview: "Good progress.", ref: "spoken" }),
    ]);
    assert.equal(chosen, "spoken");
  });

  it("opens the most recently active one of the conversations that have messages", () => {
    const chosen = autoSelect([
      summary({ lastActivityAt: "2026-08-17T09:00:00.000Z", preview: "Older.", ref: "older" }),
      summary({ lastActivityAt: "2026-08-18T09:00:00.000Z", preview: "Newer.", ref: "newer" }),
      summary({ lastActivityAt: "2026-08-22T09:00:00.000Z", preview: null, ref: "silent" }),
    ]);
    assert.equal(chosen, "newer");
  });

  /**
   * The statuses come from the client module's own list rather than from a pair written here, so a
   * fourth status arriving is covered the moment it exists. Only `resolved` is off the default
   * tab, and pre-selecting a row that tab does not show is the same as selecting nothing.
   */
  it("prefers a conversation the default tab actually shows", () => {
    for (const status of SUPPORT_THREAD_STATUSES.filter((each) => each !== "resolved")) {
      const chosen = autoSelect([
        summary({
          lastActivityAt: "2026-08-22T09:00:00.000Z",
          preview: "Closed out.",
          ref: "resolved",
          status: "resolved",
        }),
        summary({
          lastActivityAt: "2026-08-01T09:00:00.000Z",
          preview: "Still waiting.",
          ref: "showing",
          status,
        }),
      ]);
      assert.equal(chosen, "showing", `a resolved conversation outranks a ${status} one`);
    }
  });

  it("opens nothing at all rather than a conversation with nothing in it", () => {
    assert.equal(autoSelect([summary({ preview: null, ref: "a" }), summary({ preview: null, ref: "b" })]), null);
    assert.equal(autoSelect([]), null);
  });

  /**
   * Both callers have to be asking the same question, and they hold different shapes: the first
   * durable read has raw rows, the render has summaries. The mapping is checked against the row it
   * maps rather than against field names written out here.
   */
  it("asks the same question of a raw row as of a list row", () => {
    const row = thread({
      id: "raw",
      lastActivityAt: "2026-08-19T09:00:00.000Z",
      lastMessagePreview: "Uploaded.",
      status: "open",
    });
    const mapped = toSelectable(row);
    assert.equal(mapped.ref, row.id);
    assert.equal(mapped.preview, row.lastMessagePreview);
    assert.equal(mapped.lastActivityAt, row.lastActivityAt);
    assert.equal(mapped.status, row.status);

    const silent = toSelectable(thread({ id: "silent", lastMessagePreview: null }));
    assert.equal(autoSelect([silent, mapped]), "raw");
    assert.equal(autoSelect([silent]), null);
  });
});
