import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

/**
 * The seam between the operator shell and the durable Inbox.
 *
 * The defect this was written for is a body that quietly does less than the one it replaced:
 * `PATCH /api/support/threads/[id]`, `POST` and `DELETE .../draft` and the `draftId` pairing were
 * all built and merged with no caller anywhere in `web/src`, and nothing failed while that was
 * true. That class is still the point, and this file is still where it is caught.
 *
 * **Rewritten 2026-08-22 (chat rebuild, lane 2).** The Inbox moved out of `operator.tsx` into
 * `components/operator/inbox/` and became five files rather than two functions. Every assertion
 * here used to work by slicing that one file between two literals — `section(source,
 * "function renderDurableInbox(", "function renderInbox() {")` — and then matching identifiers
 * inside the slice. That is transcription wearing a derivation's clothes twice over: the slice
 * fails silently when either neighbour moves, and the identifiers inside it were copied from an
 * implementation rather than derived from a rule. Both halves are gone. The scan now reads the
 * whole Inbox directory, so splitting it again cannot blind this file, and every expectation is
 * read at run time out of the module that owns the fact.
 *
 * What lives here is the surface's half: what the shell hands over, and what the Inbox owes the
 * rail. The Inbox's own internal wiring is checked in
 * `components/operator/inbox/inbox-contract.test.ts`, and the draft-send rules that used to be
 * pinned here by requiring `<SupportThreadView>` now live in `lib/support/draft-send.ts` with
 * their own tests, including a walk that fails if any surface writes a second copy.
 */

const operatorPath = new URL("./operator.tsx", import.meta.url);
const inboxDir = new URL("../operator/inbox/", import.meta.url);
const railPath = new URL("../../lib/operator/support-inbox.client.ts", import.meta.url);
const threadPath = new URL("../chat/message-thread.tsx", import.meta.url);

async function read(path: URL) {
  return readFile(path, "utf8");
}

/**
 * Source with its comments removed.
 *
 * Prose that names an element is not the element. `operator.tsx` explains the Inbox's hook
 * placement in a comment that spells `<OperatorInbox>`, and a JSX scan that reads it picks up the
 * first `/>` after it — several hundred lines of unrelated markup — and reports the mount missing.
 * Block comments go first so that `{/* x *\/}` degrades to an inert `{ }` rather than losing its
 * closing brace to the line-comment pass.
 */
const withoutComments = stripComments;

/**
 * Every file the Inbox is made of, concatenated.
 *
 * A directory rather than a path, because the last time this file named one path the Inbox moved
 * and the guard went green over an empty slice. Splitting the Inbox further is a thing lanes do;
 * it must not be a thing that turns this off.
 */
async function inboxSource() {
  const names = (await readdir(inboxDir)).filter(
    (name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"),
  );
  assert.ok(names.length > 1, "the Inbox directory no longer holds the Inbox");
  const bodies = await Promise.all(names.map((name) => read(new URL(name, inboxDir))));
  return bodies.join("\n");
}

/** The `<OperatorInbox … />` element as the shell writes it. */
function mountElement(surface: string) {
  const element = /<OperatorInbox[\s\S]*?\/>/.exec(withoutComments(surface));
  assert.ok(element, "the surface no longer mounts the Inbox");
  assert.ok(element[0].length > 80, "the mount parsed as an empty element");
  return element[0];
}

describe("the durable Inbox drives the whole support rail", () => {
  /**
   * The un-wired-rail class itself, derived rather than listed.
   *
   * Naming the functions here would pin today's gap and nothing else; requiring the surface to
   * *call* every capability the rail exports means the next one added cannot ship unwired.
   *
   * Strengthened in the rewrite: this used to check an import list, which a body that imported
   * every capability and used none would have satisfied.
   */
  it("calls every function the rail exports", async () => {
    const rail = await read(railPath);
    const exported = [...rail.matchAll(/export async function (\w+)\s*\(/g)].map(
      (match) => match[1],
    );
    assert.ok(exported.length >= 4, "the rail module exports almost nothing; parse changed");

    const source = await inboxSource();
    const uncalled = exported.filter((name) => !new RegExp(`\\b${name}\\s*\\(`).test(source));
    assert.deepEqual(uncalled, [], "the Inbox never calls these durable rail capabilities");
  });

  /**
   * The thread statuses, from the column's own list.
   *
   * This used to match `SUPPORT_THREAD_STATUSES.map(` inside the sliced body, which pinned how the
   * options were built rather than where they came from. What matters is that the picker is handed
   * the rail module's constant and not a list written at the call site, so both halves are checked
   * and neither is a literal from the reproduction.
   */
  it("offers the thread statuses from the shared constant, not a hand-written list", async () => {
    const source = await inboxSource();
    const statuses = /statuses=\{([^}]*)\}/.exec(source);
    assert.ok(statuses, "the conversation header no longer offers the thread statuses");
    const expression = statuses[1].trim();
    assert.match(expression, /^[A-Za-z_][\w.]*$/, "the statuses are written out at the call site");

    const imported = /import \{([\s\S]*?)\} from "@\/lib\/operator\/support-inbox\.client";/.exec(
      source,
    );
    assert.ok(imported, "the Inbox no longer imports from the rail module");
    assert.match(
      imported[1],
      new RegExp(`\\b${expression}\\b`),
      `the picker is handed \`${expression}\`, which is not the rail module's status list`,
    );
  });

  /**
   * The draft rules, which is the assertion this file's rewrite turned on.
   *
   * It used to require `<SupportThreadView`, because that component is where "never send a draft
   * that is not approved" and "an edited draft is a human message" lived, and its own header said
   * a second copy would be a second place to lose one. The rebuilt Inbox does not render that
   * component — so rather than let the requirement lapse or reimplement the rules inline, the
   * rules moved to `lib/support/draft-send.ts` and both composer paths call them.
   *
   * The property is therefore unchanged and now enforced where it belongs: exactly one module may
   * state either rule, and the Inbox must be a caller rather than an author.
   */
  it("puts the suggestion under the one module that knows the draft rules", async () => {
    const rules = await read(new URL("../../lib/support/draft-send.ts", import.meta.url));
    const owned = [...rules.matchAll(/export function (\w+)\s*\(/g)].map((match) => match[1]);
    assert.ok(owned.length >= 2, "the draft-send module no longer exports its rules");

    const source = await inboxSource();
    assert.match(
      source,
      /from "@\/lib\/support\/draft-send"/,
      "the Inbox does not reach the draft rules through the module that owns them",
    );
    assert.ok(
      owned.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(source)),
      "the Inbox imports the draft rules without calling any of them",
    );
    // And it does not answer either rule for itself. The tree-wide version of this, which catches
    // any surface rather than only this one, is in `lib/support/draft-send.test.ts`.
    assert.doesNotMatch(
      source,
      /\.status\s*===\s*"approved"/,
      "the Inbox writes the approval rule out instead of asking for it",
    );
  });

  /**
   * The control the durable body used to drop.
   *
   * This used to derive the team filter's id from the fixture body and require the durable body to
   * contain the same id — a comparison of two hand-sliced function bodies. There are no longer two
   * bodies to compare: one shell renders for all three sources. So the claim is restated as the
   * property that makes the old defect unreachable, and it is checked at the seam this file owns —
   * the shell must hand over the team facts, and the Inbox must take them.
   */
  it("keeps the team filter the fixture body has", async () => {
    const mount = mountElement(await read(operatorPath));
    const handed = [...mount.matchAll(/^\s+(\w*[Tt]eam\w*)=\{/gm)].map((match) => match[1]);
    assert.ok(handed.length > 0, "the shell hands the Inbox nothing about the team");

    const source = await inboxSource();
    for (const prop of handed) {
      assert.match(
        source,
        new RegExp(`readonly ${prop}\\??:`),
        `the shell hands over \`${prop}\` and the Inbox does not accept it`,
      );
    }
    // `inboxTeamOptions` is the rail's own list builder; the filter cannot be assembled elsewhere
    // without disagreeing with the directory read that feeds it.
    assert.match(source, /\binboxTeamOptions\s*\(/, "the team filter is built without the rail");
  });

  /**
   * The one control that must NOT be invented — inverted, because the answer changed.
   *
   * The original said the durable body may not grow an unread marker, because `support_messages`
   * had no read state and no endpoint reported one. That endpoint now exists: the watermark and
   * `support_list_thread_digest` derive the count in SQL. So the property — the surface never
   * claims state no endpoint reports — is unchanged and finally enforceable, and the derived form
   * is the stronger one: the count must come off the payload and must not be worked out here.
   */
  it("never grows an unread marker the schema cannot answer for", async () => {
    const rail = await read(railPath);
    assert.match(
      rail,
      /unreadCount/,
      "the rail no longer parses an unread count; this claim has inverted back",
    );

    const source = await inboxSource();
    assert.match(
      source,
      /\.read\.unreadCount/,
      "the Inbox no longer takes the unread count off the watermark the server derived",
    );
    const guesses = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .filter((line) => /unreadCount/.test(line))
      .filter((line) => /\.filter\(|\.reduce\(|\.length\b|[<>]=?|\+\+|\s\+\s/.test(line));
    assert.deepEqual(guesses, [], "an unread count is being worked out in the browser");
  });

  it("writes under the workspace's own brand in both bodies", async () => {
    // The shell resolves the name once and hands it over; three copies of the same `??` chain
    // disagreed the moment one was edited. Followed across the seam rather than assumed: the mount
    // names the prop, the Inbox must take it, and the composer must interpolate rather than spell
    // a name. Nothing here is a literal from the reproduction.
    const carrier = [...mountElement(await read(operatorPath)).matchAll(/^\s+(\w*[Bb]rand\w*)=\{(\w+)\}/gm)];
    assert.equal(carrier.length, 1, "exactly one mount prop should carry the workspace's name");
    const [, prop] = carrier[0];

    const source = await inboxSource();
    assert.match(
      source,
      new RegExp(`readonly ${prop}\\??:`),
      `the Inbox never takes a \`${prop}\` prop`,
    );
    const signature = /`(?:Reply|Write) as \$\{(\w+)\}`/.exec(source);
    assert.ok(signature, "the composer no longer says who the reply is written as");
    assert.match(
      source,
      new RegExp(`${signature[1]}=\\{${prop}\\}|\\b${prop}\\b`),
      "the composer signs with something the shell never handed it",
    );
  });

  /**
   * Every origin the payload can carry is told apart on screen.
   *
   * Re-pointed in the rewrite: this read `support/support-thread-view.tsx`, which the rebuilt
   * Inbox does not render, so it was green and asserting nothing about this surface. It now reads
   * the thread the Inbox actually mounts, discovered from the Inbox's own source rather than
   * named here, so the next replacement cannot leave it checking a component nobody uses.
   */
  it("renders every message origin the payload parser accepts", async () => {
    const rail = await read(railPath);
    const declaration = /const MESSAGE_ORIGINS = new Set\(\[([^\]]*)\]\)/.exec(rail);
    assert.ok(declaration, "the rail no longer declares MESSAGE_ORIGINS");
    const origins = [...declaration[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assert.ok(origins.length > 1, "MESSAGE_ORIGINS parsed as a single value");

    const source = await inboxSource();
    assert.match(source, /<MessageThread/, "the Inbox no longer renders a message thread");
    assert.match(source, /origin: message\.origin/, "an origin is rewritten on its way to the view");

    const view = await read(threadPath);
    for (const origin of origins.filter((each) => each !== "human")) {
      assert.match(
        view,
        new RegExp(`origin === "${origin}"`),
        `the thread never distinguishes the \`${origin}\` origin it is handed`,
      );
    }
  });

  it("says a resolved thread is closed instead of blaming the send", async () => {
    // The refusal has a code, the route sends it, and the copy this surface shows is keyed off
    // that code. Derived from the shared catalog rather than compared against a literal, so
    // inventing a code here or retiring one there both fail.
    const errors = await read(new URL("../../lib/support/errors.ts", import.meta.url));
    const catalog = [...errors.matchAll(/'(SUPPORT_\w+)'/g)].map((match) => match[1]);
    assert.ok(catalog.length > 4, "the support error catalog parsed as almost nothing");

    const source = await inboxSource();
    assert.match(source, /lockedReason=\{/, "the composer no longer explains why it is locked");
    const named = [...source.matchAll(/code === "(SUPPORT_\w+)"/g)].map((match) => match[1]);
    assert.ok(named.length > 0, "the Inbox no longer tells any refusal apart by its code");
    assert.deepEqual(
      named.filter((code) => !catalog.includes(code)),
      [],
      "the Inbox reads refusal codes the support rail never sends",
    );
    assert.ok(
      named.some((code) => /CLOSED/.test(code)),
      "a resolved conversation's refusal is no longer told apart from a failed send",
    );
  });
});
