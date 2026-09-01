// The orb cannot appear over work that is not happening.
//
// This is the rule the contract cares most about — "a data fetch is not thinking, and an orb over
// a `GET` is the interface lying about what the machine is doing" — and it is a rule that decays
// silently, because the lie renders perfectly.
//
// Two halves. The type half is enforced by `tsc` and asserted here against the source: the brand
// is a non-exported `unique symbol`, so no literal can be passed where an `OrbActivity` is
// wanted, and the component takes no `label` prop at all. The behavioural half drives
// `orbActivity` across every state each source can be in and insists on `null` everywhere the
// work is not live.
//
// Watched failing before it counted, one change at a time against this tree: `analysis` returning
// an activity for `complete` — the finished-job case failed; `supervisor` returning its activity
// unconditionally — the not-checking case failed; adding `label?: string` to `ThinkingOrbProps` —
// the no-label-prop case failed; exporting the `truthful` symbol — the brand case failed; and
// adding a seventh `profile_fetch` source to the union — the coverage case failed by name.
//
// The type half was checked the only way it can be, by asking the compiler: a file assigning
// `{ label, state }` to an `OrbActivity` was written and `tsc` rejected it with TS2741, "Property
// '[truthful]' is missing". That file is not kept, because a file whose job is to fail to compile
// cannot live in a tree that has to compile.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

import { orbActivity, type OrbJobStatus, type OrbSource } from "./activity.ts";

const HERE = path.resolve(import.meta.dirname);
/**
 * Comments out, strings kept, because this file reads code as text in both directions at once and
 * a comment defeats each of them differently.
 *
 * The coverage case parses `readonly kind: "…"` out of the union and then demands a live case for
 * every kind it finds, so a comment mentioning a kind invents a source that does not exist and
 * fails by name — the same failure the guard would report for a real un-covered branch, which is
 * the worst kind of false alarm. The brand case runs the other way: it requires
 * `declare const truthful: unique symbol` to be present and counts `as OrbActivity` casts, so a
 * comment quoting either one can hold the assertion up after the code beneath it is gone.
 *
 * Strings stay: `index.tsx` is JSX and the props check reads a real interface body.
 */
const read = (file: string) => stripComments(fs.readFileSync(path.join(HERE, file), "utf8"));

/** Every status a job row can hold, taken off the type rather than listed from memory. */
const STATUSES: OrbJobStatus[] = ["queued", "running", "complete", "failed", "canceled"];

describe("an orb only exists while work does", () => {
  it("says nothing for a job that has finished, failed, or was cancelled", () => {
    for (const status of STATUSES) {
      const live = status === "queued" || status === "running";
      for (const kind of ["analysis", "paid_refresh"] as const) {
        const activity = orbActivity({ kind, status } as OrbSource);
        if (!live) {
          assert.equal(activity, null, `${kind} shows an orb while ${status}`);
        }
      }
    }
    // A queued refresh is not a running one. The contract's trigger table says `running`, and a
    // job sitting in a queue is a wait, not a thought.
    assert.equal(orbActivity({ kind: "paid_refresh", status: "queued" }), null);
    assert.notEqual(orbActivity({ kind: "analysis", status: "queued" }), null);
  });

  it("says nothing for every in-flight source that is not in flight", () => {
    const idle: OrbSource[] = [
      { kind: "assistant", stage: "Reading your plan", streamOpen: false },
      { kind: "supervisor", checking: false },
      { kind: "held_draft", inFlight: false },
    ];
    for (const source of idle) {
      assert.equal(orbActivity(source), null, `${source.kind} shows an orb while idle`);
    }
  });

  it("covers every source the type declares, so a new one cannot arrive untested", () => {
    // Parsed out of the union rather than listed, because a list is exactly what rots: adding a
    // sixth source without a case here should fail rather than quietly go unchecked.
    const declared = [...read("activity.ts").matchAll(/readonly kind: "([a-z_]+)"/g)].map((m) => m[1]);
    assert.ok(declared.length >= 5, `only ${declared.length} sources parsed from the union`);

    const live: Record<string, OrbSource> = {
      analysis: { kind: "analysis", status: "running" },
      assistant: { kind: "assistant", stage: "Reading your plan", streamOpen: true },
      held_draft: { kind: "held_draft", inFlight: true },
      paid_refresh: { kind: "paid_refresh", status: "running" },
      supervisor: { kind: "supervisor", checking: true },
    };
    for (const kind of declared) {
      const source = live[kind];
      assert.ok(source, `the union declares "${kind}" and this test has no live case for it`);
      const activity = orbActivity(source);
      assert.notEqual(activity, null, `${kind} shows nothing while genuinely working`);
      assert.ok((activity as { label: string }).label.length > 0, `${kind} has an empty label`);
    }
  });

  it("takes the assistant's words from the stream rather than inventing them", () => {
    const streamed = orbActivity({ kind: "assistant", stage: "Reading your plan", streamOpen: true });
    assert.equal((streamed as { label: string }).label, "Reading your plan");
    // No stage yet is a real state; what it must not do is borrow another state's sentence.
    const bare = orbActivity({ kind: "assistant", stage: null, streamOpen: true });
    assert.notEqual((bare as { label: string }).label, "Reviewing against policy");
  });
});

describe("the guard is structural, not a convention", () => {
  it("brands the activity with a symbol nothing else can reach", () => {
    const source = read("activity.ts");
    assert.match(source, /declare const truthful: unique symbol/, "the brand is gone");
    assert.doesNotMatch(source, /export (?:declare )?const truthful/, "the brand is exported and forgeable");
    // One construction site, inside the module. More than one means the brand has a second door.
    const casts = source.match(/as OrbActivity\b/g) ?? [];
    assert.equal(casts.length, 1, `${casts.length} places cast into OrbActivity; there should be one`);
  });

  it("gives the component no way to be handed a label directly", () => {
    const component = read("index.tsx");
    const props = /export interface ThinkingOrbProps \{([\s\S]*?)\n\}/.exec(component);
    assert.ok(props, "ThinkingOrbProps is gone");
    assert.doesNotMatch(props[1], /\blabel\b/, "the orb takes a label prop, which is the whole hole");
    assert.match(props[1], /activity: OrbActivity/, "the orb no longer requires an activity");
  });
});
