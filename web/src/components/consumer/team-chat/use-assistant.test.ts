// What the assistant panel is told, and the rule that every answer has to be renderable.
//
// Both cases here came out of a browser rather than out of the code. The panel opened on the demo
// shell and showed three skeleton bars that never resolved, because the bootstrap effect returns
// early when nothing asked and the initial state says `loading`. Fixing that to `disabled` then
// exposed the second one: the panel had no branch for `disabled`, so it fell through to the branch
// that promises answers from published articles — on top of a route that will refuse. A dead
// control is worse than an absent one (contract §7), and it is worse still when it makes a promise.
//
// Watched failing: with `bootstrapFor` returning `read` unconditionally, "says nothing is connected
// when nothing was asked" reports `loading`; with the panel's `disabled` branch removed, "has a
// branch for every answer the bootstrap can give" names `disabled`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CONSUMER_KB_ROUTE,
  askBody,
  bootstrapFor,
  consumerAssistantStatusIsRetryable,
  parseCitations,
  parseStatus,
  type AssistantBootstrap,
} from "./use-assistant";

const HERE = import.meta.dirname;

/** The three answers, read off the union that declares them. */
function bootstrapStates(): AssistantBootstrap[] {
  const source = fs.readFileSync(path.join(HERE, "use-assistant.ts"), "utf8");
  const declaration = /export type AssistantBootstrap =([^;]+);/.exec(source);
  assert.ok(declaration, "AssistantBootstrap is no longer declared where this test reads it");
  const states = [...declaration[1].matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
  assert.equal(states.length, 4, `AssistantBootstrap parsed as ${states.join(", ")}`);
  return states as AssistantBootstrap[];
}

describe("consumer assistant · what the panel is told", () => {
  it("says nothing was asked rather than that the server refused", () => {
    // Two facts, and the difference decides whether a control is offered at all. Reporting the
    // demo shell as `disabled` would take the assistant out of the client-review artifact;
    // reporting a server refusal as `unasked` would offer a signed-in client a door onto nothing.
    for (const read of bootstrapStates()) {
      assert.equal(bootstrapFor(false, read), "unasked");
    }
  });

  it("reports the read once one has happened", () => {
    for (const read of bootstrapStates()) {
      assert.equal(bootstrapFor(true, read), read);
    }
  });

  it("has a branch for every answer the bootstrap can give", () => {
    // The panel decides what to render from this value, and a state it has no branch for either
    // renders nothing or falls through to a branch that means something else. Both happened.
    const panel = fs.readFileSync(path.join(HERE, "../../assistant/consumer-companion.tsx"), "utf8");
    for (const state of bootstrapStates()) {
      assert.ok(
        panel.includes(`assistant.bootstrap === "${state}"`),
        `the panel has no branch for a bootstrap of ${state}`,
      );
    }
  });

  it("mounts one global way in and leaves none inside Team Chat", () => {
    const teamChat = fs.readFileSync(path.join(HERE, "index.tsx"), "utf8");
    const consumerSurface = fs.readFileSync(path.join(HERE, "../../surfaces/consumer.tsx"), "utf8");
    assert.doesNotMatch(teamChat, /Assistant(?:Entry|Panel)/, "Team Chat still owns an assistant entry point");
    assert.match(consumerSurface, /<ConsumerAssistantCompanion\b/, "the consumer surface does not mount the global assistant");
  });

  it("locks the composer on every answer that is not a working one", () => {
    // Derived from the union rather than from the two names the branch happens to spell: a fifth
    // state added to `AssistantBootstrap` must be locked unless it is deliberately unlocked.
    const panel = fs.readFileSync(path.join(HERE, "../../assistant/consumer-companion.tsx"), "utf8");
    assert.match(
      panel,
      /lockedReason=\{assistant\.bootstrap === "enabled" \|\| assistant\.bootstrap === "loading" \? null :/,
      "the assistant composer is unlocked on a state the server has not said yes to",
    );
  });
});

describe("consumer assistant · what it admits about itself", () => {
  it("says the conversation is not kept, somewhere that cannot disappear", () => {
    // §3.4's persistent history is scope-bound and there is no consumer scope, so this history is
    // in-session — and the sentence saying so is the only thing between a reader and the assumption
    // that it persists. It used to sit in the empty state, which is the one place it could not do
    // its job: the empty state is replaced the moment somebody asks something, so the notice
    // vanished exactly when there started being a conversation to be wrong about.
    //
    // The words are copy and are written here as copy. What is derived is the thing that was
    // actually wrong — where it sits. The footer renders on every branch, so the claim is that the
    // notice is inside it and that nothing in it is gated on how many turns there are.
    const panel = fs.readFileSync(path.join(HERE, "../../assistant/global-companion.tsx"), "utf8");
    // `lastIndexOf`, because an earlier docblock names the component while explaining why the
    // panel has a composer of its own — anchoring on the first mention put the whole branch chain
    // inside the "footer" and the check passed on text it was not looking at.
    assert.match(panel, /Not your team · nothing saved/);
    assert.match(panel, /consumer conversations are not saved to the account/);
  });
});

describe("consumer assistant · what it sends", () => {
  it("asks the route that told it it was enabled", () => {
    // The fact `components/kb/surface-contract.test.ts` held by reading the scope out of one fetch
    // call and matching it against the other. An assistant bootstrapped against one scope and
    // asking another is enabled by a check that does not cover it. It is now true by construction —
    // one exported constant, used twice — so what is checked is that no second route was written.
    const source = fs.readFileSync(path.join(HERE, "use-assistant.ts"), "utf8");
    const routes = new Set([...source.matchAll(/"(\/api\/[a-z/-]+)"/g)].map((match) => match[1]));
    assert.deepEqual([...routes], [CONSUMER_KB_ROUTE], "a second route is named in this module");
    for (const call of [...source.matchAll(/fetch\(\s*([A-Za-z_]+)/g)]) {
      assert.equal(call[1], "CONSUMER_KB_ROUTE", `a fetch here is called with ${call[1]}`);
    }
    assert.match(CONSUMER_KB_ROUTE, /^\/api\/kb\//);
  });

  it("sends the question and nothing the route derives from the session", () => {
    // Migration 103 and the route resolve the client, the org and the enrollment from the signed-in
    // profile, so anything asserted here would be ignored or a claim the browser is not entitled to
    // make. Driven rather than matched on the `JSON.stringify` line, which said nothing about what
    // the object ended up containing.
    const sent = JSON.parse(askBody("What should I finish first?")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(sent), ["question"]);
    assert.equal(sent.question, "What should I finish first?");
  });
});

describe("consumer assistant · citations", () => {
  it("drops every field of the route's citation except the one that may be read", () => {
    // Rail 3, narrowed rather than remembered. `KbCitation` carries the id the supervisor gate
    // needs and the title and url the surfaces do not, and the fields are read off that declaration
    // so a fifth one added there is refused here without anybody coming back.
    const driver = fs.readFileSync(path.resolve(HERE, "../../../lib/kb/chat-driver.ts"), "utf8");
    const declaration = /export interface KbCitation \{([^}]*)\}/.exec(driver);
    assert.ok(declaration, "KbCitation is no longer declared where this test reads it");
    const fields = [...declaration[1].matchAll(/readonly ([A-Za-z]+):/g)].map((match) => match[1]);
    assert.ok(fields.length >= 3, `KbCitation parsed as ${fields.join(", ")}`);

    const full = Object.fromEntries(fields.map((field) => [field, `value-for-${field}`]));
    const [parsed] = parseCitations([full]);
    assert.ok(parsed, "a complete citation from the route did not survive parsing");
    assert.deepEqual(Object.keys(parsed), ["label"]);
  });

  it("keeps a citation only when it has a human label", () => {
    // F-06's other half. A citation with no label would otherwise be printed as whatever field is
    // left, and the field left is an identifier.
    assert.deepEqual(parseCitations([{ label: "Building business credit" }]), [
      { label: "Building business credit" },
    ]);
    assert.deepEqual(parseCitations([{ title: "Building business credit" }]), []);
    assert.deepEqual(parseCitations([{ id: "9f1c2a7e-0000-0000-0000-000000000001" }]), []);
    assert.deepEqual(parseCitations("not a list"), []);
  });
});

describe("consumer assistant · retryability", () => {
  it("offers retry only for provider or legacy transport failures", () => {
    assert.equal(consumerAssistantStatusIsRetryable("provider_unreachable"), true);
    assert.equal(consumerAssistantStatusIsRetryable("data_unreachable"), true);
    assert.equal(consumerAssistantStatusIsRetryable("unavailable"), true);
    for (const status of ["answered", "insufficient_grounding", "no_matching_records", "out_of_scope", "refused_by_policy"] as const) {
      assert.equal(consumerAssistantStatusIsRetryable(status), false, status);
    }
  });
});

describe("consumer assistant · the outcomes that were once an outage", () => {
  it("carries both new statuses through the wire parser instead of collapsing them", () => {
    for (const status of ["answer_malformed", "result_too_large"] as const) {
      assert.equal(parseStatus(status), status);
    }
  });

  it("offers a retry for an unusable answer and withholds it from an overflowing read", () => {
    assert.equal(consumerAssistantStatusIsRetryable("answer_malformed"), true);
    assert.equal(consumerAssistantStatusIsRetryable("result_too_large"), false);
  });
});
