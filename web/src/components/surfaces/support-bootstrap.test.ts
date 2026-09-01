import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  bootstrapTeamChat,
  readTeamChat,
  sendTeamChatMessage,
} from "@/components/consumer/team-chat/transport";

// The consumer half of this contract was rewritten for the chat rebuild.
//
// Its previous form said the assertions were unchanged "because the code is — only the file they
// read moved". That stopped being true: the inline bootstrap became `transport.ts`, the message
// array became a discriminated union, and five of the seven assertions were regexes over an
// implementation that no longer exists. None of them was ever the fact. Where the behaviour can be
// driven it now is; where it is genuinely composition it is derived from whatever owns it.
const consumerTeamChatPath = new URL("../consumer/team-chat/index.tsx", import.meta.url);
const consumerStatePath = new URL("../consumer/team-chat/use-team-chat.ts", import.meta.url);

/** A `fetch` replaying a queue, so the transport can be driven rather than read. */
function fetcher(queue: { ok: boolean; body?: unknown }[]) {
  return (async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("unexpected request");
    return { json: async () => next.body ?? null, ok: next.ok } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("support bootstrap surface contract", () => {
  it("keeps consumer transport failures unavailable with no local send path", async () => {
    // Driven, not matched. The old pair of regexes checked how two early returns were spelled; a
    // rewrite to `if (!ok) { return { state: "unavailable" } }` would have failed them while
    // changing nothing, and a rewrite that returned `disabled` on a network error would have passed
    // them if the spelling held. What matters is which answer comes back, and it matters because
    // the caller renders a written conversation on one branch and a stated absence on the other.
    for (const queue of [
      [{ ok: false }],
      [{ body: { enabled: true }, ok: true }, { ok: false }],
      [{ body: null, ok: true }],
    ]) {
      assert.equal((await bootstrapTeamChat(fetcher(queue))).state, "unavailable");
    }
    assert.equal(
      (await bootstrapTeamChat(fetcher([{ body: { enabled: false }, ok: true }]))).state,
      "disabled",
      "a flag-off answer is the only thing that may come back disabled",
    );
    assert.equal(
      (await readTeamChat("thread-a", fetcher([{ body: { thread: { id: "x" } }, ok: true }]))).state,
      "unavailable",
      "a payload that cannot be mapped is half-rendered rather than refused",
    );

    // `if (!fixture) return; setMessages` is gone and is not replaced: it guarded against setting a
    // message array to nothing, and `TeamChatState` makes a thread with no designed state
    // unrepresentable, so there is no longer a case for it to guard. What replaces it is the check
    // below, which is the rule that mattered — no state may leave the composer usable when nothing
    // can be sent from it.
    const view = await readFile(consumerTeamChatPath, "utf8");
    const union = /export type TeamChatState =([\s\S]*?)\n\n/.exec(
      await readFile(consumerStatePath, "utf8"),
    );
    assert.ok(union, "TeamChatState is no longer declared where this test reads it");
    const kinds = [...union[1].matchAll(/kind: "([a-z]+)"/g)].map((match) => match[1]);
    assert.ok(kinds.length >= 4, `TeamChatState parsed as ${kinds.join(", ")}`);

    const opens = view.indexOf("switch (chat.state.kind) {");
    assert.ok(opens !== -1, "the thread no longer switches on its own state");
    const thread = view.slice(opens, view.indexOf("\n  }", opens));
    for (const kind of kinds) {
      const start = thread.indexOf(`case "${kind}":`);
      assert.ok(start !== -1, `the thread has no branch for ${kind}`);
      const end = thread.indexOf("break;", start);
      const branch = thread.slice(start, end === -1 ? undefined : end);
      // Unconditional means "before the branch's first `if`". Reading the whole branch would count
      // a lock that only applies to a resolved thread as one that always applies, which is the
      // difference this check exists to see; indentation would say the same thing but would be a
      // claim about formatting.
      const guarded = branch.indexOf("if (");
      const unconditional = guarded < 0 ? branch : branch.slice(0, guarded);
      const locks = /lockedReason = "/.test(unconditional);
      if (kind === "ready") {
        // The one branch that may go either way, and the only one where a lock carries product
        // meaning rather than hiding a broken control: a thread the team has resolved refuses the
        // write in the database, so the lock has to be conditional rather than absent or absolute.
        assert.equal(locks, false, "the ready branch locks the composer unconditionally");
        assert.match(branch, /if \([\s\S]*?lockedReason =/, "a resolved thread is not locked at all");
        continue;
      }
      assert.equal(
        locks,
        kind !== "fixture",
        kind === "fixture"
          ? "the demo shell's composer is locked, so the client demo cannot be typed in"
          : `the ${kind} branch leaves the composer usable with nothing to send to`,
      );
    }
    assert.match(view, /Nothing can be sent until it reconnects/);
  });

  it("re-reads a successful durable consumer post before reporting its result", async () => {
    // The old version compared `indexOf` positions of three literals in one file, which is source
    // order rather than execution order and was already a proxy. The fact underneath is real: a
    // send may only report success on what the database wrote, never on the text that was typed.
    //
    // Driven. The transport is handed one body and asked to send a different one, and what comes
    // back has to be the server's row.
    const written = {
      authorKind: "operator",
      authorProfileId: "profile-a",
      body: "What the database wrote.",
      id: "3f6c2a7e-0000-0000-0000-000000000002",
      origin: "human",
      originDraftId: null,
      sentAt: "2026-08-20T09:05:00.000Z",
      threadId: "3f6c2a7e-0000-0000-0000-000000000001",
      visibility: "participants",
    };
    const sent = await sendTeamChatMessage(
      written.threadId,
      "Something else entirely.",
      fetcher([{ body: { message: written }, ok: true }]),
    );
    assert.equal(sent?.body, written.body);
    assert.equal(sent?.sentAt, written.sentAt);
    assert.equal(
      await sendTeamChatMessage(written.threadId, "Hello.", fetcher([{ ok: false }])),
      null,
      "a send that did not go reports something other than null, so the composer would clear",
    );

    // And the surface reports the outcome the transport gave it rather than the attempt: the
    // success notice is reachable only from the value `send` returned.
    const view = await readFile(consumerTeamChatPath, "utf8");
    assert.match(view, /const sent = await chat\.send\(body\);[\s\S]{0,240}?sent\s*\?/);
  });

  it("selects the operator fixture only for an explicit disabled response", async () => {
    const source = await readFile(new URL("./operator.tsx", import.meta.url), "utf8");
    assert.match(source, /response\.ok[\s\S]*?body\?\.enabled === true[\s\S]*?"ready"[\s\S]*?body\?\.enabled === false[\s\S]*?"disabled"/);
    assert.match(source, /supportState === "disabled" \? \([\s\S]*?renderPlatformSupport\(\)/);
    assert.doesNotMatch(source, /renderReview|held-replies|Held replies/i);
    assert.match(source, /Suggestions stay inside the current composer and require an operator action/);
    assert.match(source, /Support is unavailable right now\. No message can be submitted/);
  });
});
