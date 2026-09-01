import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/testing/strip-comments";

/**
 * A feature flag may decide whether a read happens. It may never decide whose
 * account this is.
 *
 * That confusion is the whole Tier-2 class. Six panels on the consumer surface
 * chose their data with a test like `ancillaryState === "disabled"` or
 * `trackerClients.enabled === false`, and when that test came back true they
 * rendered the fixture walkthrough's records — one fixture person's six-snapshot
 * readiness graph and named tradeline target, their four unread credit alerts,
 * their Articles of Organization stamped "Jun 24 · encrypted storage", their
 * pre-completed enrollment checklist, an Account & Billing panel with a Cancel
 * control made of four `setState` calls, a conversation greeting them by first
 * name, and a scripted $19 purchase that announced itself paid after 2.2
 * seconds of `setTimeout`. None of it was reachable while the flags stayed on,
 * which is exactly why it survived: it is latent, and one flag flip publishes it
 * to whoever is signed in.
 *
 * The first guard is the derived one and the one that matters. It reads every
 * flag-off selector out of the tree at test time — every `const` whose
 * initializer asks whether a bootstrap answered `"disabled"` or whether a read
 * reported `enabled === false` — and requires each to consult `durableWorkspace`
 * as well. A seventh panel added tomorrow with the same mistake fails here
 * without anybody extending a list, and a selector that gets renamed carries its
 * guard with it. The enumeration is the thing that rots (round-5 standard), so
 * there is no enumeration.
 *
 * Every scan below walks `web/src` rather than reading one file, because these
 * bodies move: the chat extraction relocated the consumer's Team Chat out of
 * `consumer.tsx` while this lane was running, and a guard that reads a single
 * path would have passed over the relocated copy without noticing.
 *
 * Watched failing on the pre-fix tree (4ef499a). Failure texts are in the lane
 * report.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");

/**
 * Comments are prose, not behaviour. Every guard below reads control flow, and
 * a comment that quotes the branch it replaced must not satisfy a guard about
 * that branch — the comment-prose taint the operator dashboard guard already
 * documents.
 */
const withoutComments = stripComments;

/** Every non-test TypeScript module under `web/src`, comment-stripped. */
function sources(): Array<{ relative: string; text: string }> {
  const out: Array<{ relative: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      out.push({
        relative: path.relative(SRC, full),
        text: withoutComments(fs.readFileSync(full, "utf8")),
      });
    }
  };
  walk(SRC);
  return out;
}

const MODULES = sources();

/**
 * Modules that hold the durable-versus-fixture distinction at all.
 *
 * Scoping the flag-off rule to them is what makes it a rule rather than a
 * blanket ban: a module that never learned whose account it is renders for one
 * audience only and has nothing to get wrong here, while a module that DOES
 * know the difference has no excuse for asking a flag instead.
 */
function durableAwareModules(): Array<{ relative: string; text: string }> {
  return MODULES.filter((module) => module.text.includes("durableWorkspace"));
}

/**
 * Every `const NAME = …;` whose initializer decides something from a flag-off
 * signal: a bootstrap reporting `"disabled"`, or a read reporting
 * `enabled === false`.
 */
function flagOffSelectors(): Array<{ initializer: string; name: string; relative: string }> {
  const found: Array<{ initializer: string; name: string; relative: string }> = [];
  const pattern = /const (\w+) = ([^;\n]*(?:=== "disabled"|enabled === false)[^;\n]*);/g;
  for (const { relative, text } of durableAwareModules()) {
    for (const match of text.matchAll(pattern)) {
      found.push({ initializer: match[2], name: match[1], relative });
    }
  }
  return found;
}

/** The one module whose text contains `anchor`, wherever it now lives. */
function moduleContaining(anchor: string, subject: string): { relative: string; text: string } {
  const hits = MODULES.filter((module) => module.text.includes(anchor));
  assert.equal(
    hits.length,
    1,
    `${subject}: expected exactly one module under web/src containing ${JSON.stringify(anchor)}, found ${hits.length}${hits.length ? ` (${hits.map((hit) => hit.relative).join(", ")})` : ""}`,
  );
  return hits[0];
}

describe("no panel picks its data from a feature flag alone", () => {
  it("the tree walk and both flag-off signals still have subjects", () => {
    // If any premise disappears, the scan finds nothing and every assertion
    // below passes vacuously. So prove the premises first.
    assert.ok(MODULES.length > 200, `the web/src walk found only ${MODULES.length} modules`);
    assert.ok(
      durableAwareModules().length > 0,
      "no module under web/src knows about durableWorkspace; this scan has no subject",
    );
    const bootstrap = MODULES.find((module) =>
      module.relative.endsWith("consumer-bootstrap.ts"),
    );
    assert.ok(bootstrap, "consumer-bootstrap.ts is gone; this scan has no subject");
    assert.match(
      bootstrap.text,
      /"disabled"/,
      "BootstrapState no longer carries a disabled state; this scan has no subject",
    );
    assert.ok(
      MODULES.some((module) => module.text.includes("trackerClients.enabled === false")),
      "the tracker read no longer reports enabled:false; this scan has no subject",
    );
    assert.ok(
      flagOffSelectors().length >= 4,
      "the flag-off selector scan found almost nothing, which means its pattern stopped matching",
    );
  });

  it("every flag-off selector also asks whether this is a durable workspace", () => {
    for (const { initializer, name, relative } of flagOffSelectors()) {
      assert.ok(
        initializer.includes("durableWorkspace"),
        `${relative}: ${name} selects on a flag alone (\`${initializer.trim()}\`); a flag being off is not a fact about whose account this is`,
      );
    }
  });
});

describe("the fixture stores are unreachable from a durable workspace", () => {
  it("the seeded notification list has no reader that does not gate it", () => {
    // Derived: find the module-level fixture array wherever it lives, then
    // every other reference to that identifier in the same module, and require
    // each to name a gate.
    const { relative, text } = moduleContaining(
      'event("monitoring_alert:alert-aug-24"',
      "the seeded consumer notifications",
    );
    // The array carries a type annotation (`NotificationEventV2[]`) and its rows are now built by
    // a helper rather than written as object literals, so the declaration is matched with the
    // annotation optional and without assuming the element's shape.
    const declaration = /^const (\w+)(?::[^=\n]+)? = \[\n\s+event\("monitoring_alert:alert-aug-24"/m.exec(text);
    assert.ok(declaration, `${relative}: the fixture notification array is no longer a named const`);
    const identifier = declaration[1];
    const readers = text
      .split("\n")
      // Narrow to reads of THIS binding, in code. String literals go first, so
      // the `"notifications"` view id and the word inside a toast are not
      // mistaken for the array. The lookbehind then drops `liveNotifications`,
      // `readNotifications`, the `consumer-notifications` import specifier and
      // `data.notifications`, and the lookahead drops the `notifications?:`
      // response-shape field.
      .filter((line) =>
        new RegExp(`(?<![\\w/.\\-])${identifier}\\b(?!\\?|\\s*:)`).test(
          line.replaceAll(/"[^"]*"/g, '""').replaceAll(/'[^']*'/g, "''"),
        ),
      )
      .filter((line) => !line.startsWith(`const ${identifier} = [`));
    assert.ok(readers.length > 0, `${relative}: nothing reads the fixture notifications`);
    for (const line of readers) {
      assert.ok(
        /notificationsOff|ancillaryFixture/.test(line),
        `${relative}: a fixture-notification reader is ungated: ${line.trim()}`,
      );
    }
  });

  it("the seeded document files reach the rendered list only through a gate", () => {
    const { relative, text } = moduleContaining(
      '"Articles of Organization.pdf"',
      "the seeded consumer documents",
    );
    // Derived: the property name comes out of the section declaration rather
    // than being transcribed.
    const property = /^\s+(\w+): string\[\];/m.exec(text);
    assert.ok(property, `${relative}: the document sections no longer declare a fixture-file field`);
    const rendered = text
      .split("\n")
      .find((line) => line.includes("const files = ancillaryEnabled"));
    assert.ok(rendered, `${relative}: the document list no longer builds a \`files\` array`);
    assert.ok(
      rendered.includes(`section.${property[1]}`),
      `${relative}: the rendered list stopped reading the fixture files`,
    );
    assert.ok(
      rendered.includes("documentsOff"),
      `${relative}: the rendered document list is ungated: ${rendered.trim()}`,
    );
    assert.match(
      text,
      /const documentsOff = durableWorkspace && !ancillaryEnabled && !ancillaryPending;/,
      `${relative}: the document gate stopped asking whether this is a durable workspace`,
    );
  });

  it("the pre-completed enrollment checklist needs the fixture shell", () => {
    const { relative, text } = moduleContaining(
      'kind: "agreement_signed"',
      "the enrollment milestone checklist",
    );
    const property = /^\s+(\w+): boolean;\n\s+kind:/m.exec(text);
    assert.ok(property, `${relative}: the milestones no longer declare a fixture-completion field`);
    const reader = text.indexOf(`milestone.${property[1]}`);
    assert.notEqual(reader, -1, `${relative}: nothing reads the fixture completion flag`);
    const rowsStart = text.indexOf("const milestoneRows");
    assert.notEqual(rowsStart, -1, `${relative}: the milestone rows are gone`);
    assert.ok(
      text.slice(rowsStart, reader).includes("!durableWorkspace"),
      `${relative}: enrollment milestones can still be pre-marked Complete on an account that never enrolled`,
    );
  });

  it("the scripted refresh purchase cannot run on a durable workspace", () => {
    // The claim under test is a money claim, so the guard is on the control
    // that makes it rather than on the words: find the toast that announces a
    // pending charge and require the control carrying it to be withheld.
    const { relative, text } = moduleContaining(
      "charge is pending",
      "the scripted refresh purchase",
    );
    const pending = text.split("\n").find((line) => line.includes("charge is pending"));
    assert.ok(pending, `${relative}: the scripted purchase toast is gone`);
    assert.ok(
      pending.includes("paidRefreshOff ? null :"),
      `${relative}: a signed-in consumer can still be told a charge is pending and then paid, from component state alone`,
    );
    assert.match(
      text,
      /const paidRefreshOff = durableWorkspace && !paidRefreshEnabled;/,
      `${relative}: the purchase gate stopped asking whether this is a durable workspace`,
    );
  });

  /**
   * Rewritten at integration, when the chat rebuild replaced the mechanism this case used to read.
   *
   * The fact is the one it always was and the one this whole file is about: a signed-in client
   * cannot be shown a conversation nobody sent them. What changed is how that is enforced. The
   * boolean gate this case pinned — a `TeamMessage[]` factory called as
   * `durableWorkspace ? [] : factory(analysisActive, canceled)` — is gone, and in its place the
   * thread takes a prop with three meanings, of which only "absent" selects the fixture. That is
   * a stronger guarantee, because absent is reachable from exactly one mount, but it is a
   * different shape, so the assertions follow the fact across rather than being deleted with the
   * code that used to carry it.
   *
   * Three hops, each failing on its own, none of them naming a value this file chose: the factory
   * is found by its export, its callers by scanning the tree, and the state that admits it by the
   * comparison that produces that state.
   */
  it("the seeded Team Chat conversation needs the fixture shell", () => {
    const { relative, text } = moduleContaining(
      "I reviewed the Jul 14 source snapshot",
      "the seeded Team Chat conversation",
    );

    // Hop 1: what the fixture conversation is called, read off its own export.
    const factory = /export function (\w+)\(/.exec(text);
    assert.ok(
      factory,
      `${relative}: the fixture conversation is no longer built by an exported factory`,
    );
    const name = factory[1];

    // Hop 2: who calls it. One caller, and the call sits inside the arm of the thread's state
    // switch that only the fixture state can select — so a second call site anywhere in the tree,
    // or this one drifting out of its arm, fails here.
    const callers = MODULES.filter(
      (module) =>
        module.relative !== relative && new RegExp(`(?<![\\w.])${name}\\s*\\(`).test(module.text),
    );
    assert.equal(
      callers.length,
      1,
      `the fixture conversation is built in ${callers.length} places: ${callers.map((c) => c.relative).join(", ")}`,
    );
    const [caller] = callers;
    const armStart = caller.text.indexOf('case "fixture":');
    assert.notEqual(
      armStart,
      -1,
      `${caller.relative}: the thread no longer has a fixture arm to confine the seeded conversation to`,
    );
    const armEnd = caller.text.indexOf("break;", armStart);
    assert.notEqual(armEnd, -1, `${caller.relative}: the fixture arm does not end`);
    assert.ok(
      caller.text.slice(armStart, armEnd).includes(`${name}(`),
      `${caller.relative}: the seeded conversation is built outside the fixture arm, so a durable workspace can reach it`,
    );

    // Hop 3: what selects that state, which is the eviction itself. The fixture state may be
    // produced only by the handover being absent, because absent is what the demo shell passes
    // and what the real-auth page — which returns a snapshot or null, never nothing — cannot.
    //
    // Scoped to the caller's own directory, derived from hop 2 rather than written down here.
    // `"fixture"` is a word other domains use for their own unrelated states, so an unscoped scan
    // reports a truthful match about somebody else's state machine and says nothing about this one.
    const home = path.dirname(caller.relative);
    const producers = MODULES.filter((module) => path.dirname(module.relative) === home).flatMap((module) =>
      module.text
        .split("\n")
        .filter((line) => line.includes('kind: "fixture"') && line.includes("return"))
        .map((line) => ({ line: line.trim(), relative: module.relative })),
    );
    assert.ok(producers.length > 0, "nothing produces the fixture state; the scan changed shape");
    for (const producer of producers) {
      assert.ok(
        producer.line.includes("=== undefined"),
        `${producer.relative}: the fixture conversation is selected by something other than an absent handover: ${producer.line}`,
      );
    }
  });
});

describe("the consumer surface cannot be mounted against a guessed account", () => {
  it("applicationContext is required, so a caller that forgets it fails to compile", () => {
    const { relative, text } = moduleContaining(
      "export function ConsumerSurface(",
      "the consumer surface entry point",
    );
    assert.doesNotMatch(
      text,
      /applicationContext = \{ clientId:/,
      `${relative}: the surface still defaults to a fixture client id and a fixture readiness score`,
    );
    assert.match(
      text,
      /^\s+applicationContext: ConsumerApplicationContext;$/m,
      `${relative}: applicationContext is no longer a required prop`,
    );
  });
});
