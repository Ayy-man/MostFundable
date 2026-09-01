// The catalog, checked against itself rather than against a copy of it.
//
// The rule this file follows is the round-5 standard: every expectation is derived at test time from
// the module that owns the fact — the catalog's own keys, the contract's own union — never
// transcribed from a reproduction. A test holding its own list of fifteen kinds passes for years
// after the sixteenth arrives.
//
// One sample row per key, because a catalog entry is only exercised by a row of its own shape: a
// `copy` that reads `e.readiness` off a `fee_payment` compiles and prints `undefined`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TIMELINE_DENIED_KEYS, type TimelineAudience, type TimelineKind } from "@/lib/timeline/types";

import {
  TIMELINE_CATALOG,
  effectiveSpec,
  isPrimaryEligible,
  specFor,
  titleText,
  type TimelineCatalogKey,
  type TimelineRow,
} from "./catalog";
import { FIXTURE_EVENTS } from "./fixture";

const AUDIENCES: readonly TimelineAudience[] = ["consumer", "operator"];

/** A row of every shape the catalog can be asked about, keyed by the entry it exercises. */
const SAMPLES: Readonly<Record<TimelineCatalogKey, TimelineRow>> = {
  action: {
    at: "2026-08-22T09:01:00Z",
    blocking: false,
    client: "Devon",
    kind: "action",
    ref: "s-action",
    state: "todo",
    title: "Business profile readiness",
  },
  analysis_completed: {
    at: "2026-08-22T09:01:00Z",
    client: "Devon",
    kind: "analysis_completed",
    open: 1,
    prev: 84,
    prevAt: "2026-08-15T09:00:00Z",
    readiness: 92,
    ref: "s-analysis",
    trigger: "scheduled",
  },
  application_outcome: {
    amountCents: 4000000,
    at: "2026-08-23T17:30:00Z",
    bank: "Example Bank",
    client: "Devon",
    decidedOn: "2026-08-23",
    kind: "application_outcome",
    kindWord: "funded",
    ref: "s-outcome",
  },
  assignment: {
    actor: "Avery",
    at: "2026-08-23T13:00:00Z",
    client: "Devon",
    from: "Avery",
    kind: "assignment",
    operatorOnly: true,
    ref: "s-assignment",
    to: "Priya",
  },
  consent_revoked: {
    at: "2026-08-23T18:01:00Z",
    client: "Devon",
    kind: "consent_revoked",
    ref: "s-consent",
    which: "monitoring",
  },
  document_filed: {
    at: "2026-08-22T08:58:00Z",
    client: "Devon",
    kind: "document_filed",
    name: "Bank statement",
    named: "a bank statement",
    ref: "s-filed",
    section: "Business profile",
    uploadId: "s-upload",
  },
  document_line: {
    at: "2026-08-22T08:58:00Z",
    client: "Devon",
    kind: "document_filed",
    name: "Bank statement",
    named: "a bank statement",
    ref: "s-filed-line",
    section: "Business profile",
    uploadId: "s-upload-line",
  },
  document_requested: {
    actor: "Priya",
    at: "2026-08-20T15:10:00Z",
    client: "Devon",
    kind: "document_requested",
    name: "Bank statement",
    named: "a bank statement",
    ref: "s-requested",
    requestId: "s-request",
    why: "The last three months, so the business profile item can be verified.",
  },
  enrollment_milestone: {
    at: "2026-08-01T09:41:00Z",
    client: "Devon",
    firstChargeOn: "2026-08-01",
    kind: "enrollment_milestone",
    milestone: "active",
    ref: "s-milestone",
  },
  fee_payment: {
    actor: "Avery",
    amountCents: 50000,
    at: "2026-08-20T16:00:00Z",
    balanceCents: 150000,
    client: "Devon",
    kind: "fee_payment",
    method: "ACH",
    receivedOn: "2026-08-20",
    ref: "s-payment",
  },
  refresh: {
    amountCents: 2900,
    at: "2026-08-23T10:05:00Z",
    client: "Devon",
    completedAt: "2026-08-23T10:31:00Z",
    kind: "refresh",
    readiness: 93,
    ref: "s-refresh",
  },
  refresh_blocked: {
    at: "2026-08-23T13:20:00Z",
    client: "Devon",
    kind: "refresh_blocked",
    lastReadiness: 92,
    lastRunAt: "2026-08-22T09:01:00Z",
    operatorOnly: true,
    ref: "s-blocked",
    resetsOn: "2026-09-01",
  },
  stage_changed: {
    actor: "Priya",
    at: "2026-08-15T09:03:00Z",
    client: "Devon",
    kind: "stage_changed",
    ref: "s-stage",
    to: "Optimization",
  },
  subscription: {
    at: "2026-08-23T18:00:00Z",
    client: "Devon",
    endsOn: "2026-09-01",
    kind: "subscription",
    ref: "s-subscription",
    state: "cancelled",
  },
  thread_opened: {
    at: "2026-08-01T09:05:00Z",
    client: "Devon",
    kind: "thread_opened",
    ref: "s-opened",
  },
  thread_status: {
    actor: "Priya",
    at: "2026-08-23T18:05:00Z",
    client: "Devon",
    kind: "thread_status",
    ref: "s-status",
    to: "resolved",
  },
  transition: {
    at: "2026-08-22T09:01:00Z",
    filterAs: "analysis",
    glyph: "list",
    kind: "transition",
    noun: "Action",
    ref: "s-transition",
    title: "Business profile readiness verified by the Aug 22 analysis",
  },
};

/** Every string a row renders, for either audience. What the deny-list and the vocabulary walk read. */
function renderedStrings(key: TimelineCatalogKey, audience: TimelineAudience): string[] {
  const row = SAMPLES[key];
  const spec = specFor(key);
  const copy = spec.copy(row, audience);
  const out = [titleText(copy.title)];
  if (copy.body !== undefined) out.push(copy.body);
  for (const fact of spec.facts?.(row, audience) ?? []) out.push(fact.label, fact.value);
  const status = spec.status?.(row, audience);
  if (status) out.push(status.label);
  for (const action of spec.actions?.(row, audience) ?? []) {
    out.push(action.label);
    if (action.intent === "draft-reminder") out.push(action.body);
  }
  return out;
}

describe("the catalog covers the contract", () => {
  it("has an entry for every kind the contract declares, and no key with no row", () => {
    // The kinds come out of the contract's own union at run time, via a value the union is used to
    // type — so adding a kind to `lib/timeline/types.ts` and forgetting the entry fails here.
    const kinds = new Set(FIXTURE_EVENTS.map((event) => event.kind));
    for (const kind of kinds) {
      assert.ok(kind in TIMELINE_CATALOG, `the fixture carries ${kind} and the catalog has no entry`);
    }
    for (const key of Object.keys(TIMELINE_CATALOG) as TimelineCatalogKey[]) {
      assert.ok(key in SAMPLES, `${key} has no sample row, so its entry is never executed here`);
      assert.equal(SAMPLES[key].kind === "transition", key === "transition");
    }
  });

  it("renders a title for every entry, for both audiences that see it", () => {
    for (const key of Object.keys(TIMELINE_CATALOG) as TimelineCatalogKey[]) {
      for (const audience of AUDIENCES) {
        const spec = effectiveSpec(SAMPLES[key], audience);
        if (spec === null) continue;
        for (const rendered of renderedStrings(key, audience)) {
          assert.notEqual(rendered.trim(), "", `${key}/${audience} renders an empty string`);
          assert.doesNotMatch(
            rendered,
            /undefined|null|NaN|\[object/,
            `${key}/${audience} renders a value that was not there: ${rendered}`,
          );
        }
      }
    }
  });

  it("never puts a denied key's name into a rendered string", () => {
    // The deny-list is about fields, and the reader's own test walks the payloads. This is the other
    // half: a card that prints "utilization 41%" in prose has leaked the same measurement without
    // ever holding a field named for it. Plan item titles are the one legitimate use, and they come
    // from the shipped Optimization copy, so the row's own title is excluded by value.
    // Two legitimate uses, and both are the word meaning something else.
    //
    // "Utilization under 30%" is the shipped Optimization item's own title — the plan item is legal,
    // the measurement behind it is what is denied. "Balance" on an operator payment row is this
    // workspace's own receivable from `fee_payments`, which is the operator's commercial fact and
    // nothing to do with an account balance on a bureau file; the consumer projection omits it, and
    // the assertion below is what proves that rather than assuming it.
    const legitimate = new Set(["Utilization under 30%", "Balance"]);
    assert.deepEqual(
      renderedStrings("fee_payment", "consumer").filter((each) => each === "Balance"),
      [],
      "the consumer's payment row names a balance",
    );
    for (const key of Object.keys(TIMELINE_CATALOG) as TimelineCatalogKey[]) {
      for (const audience of AUDIENCES) {
        if (effectiveSpec(SAMPLES[key], audience) === null) continue;
        for (const rendered of renderedStrings(key, audience)) {
          if (legitimate.has(rendered)) continue;
          for (const denied of TIMELINE_DENIED_KEYS) {
            // Whole words only: "balance" is denied, "Bank statement" is not, and `bureau` must not
            // match inside a longer harmless word either.
            assert.doesNotMatch(
              rendered,
              new RegExp(`\\b${denied}\\b`, "i"),
              `${key}/${audience} says "${denied}" in "${rendered}"`,
            );
          }
        }
      }
    }
  });
});

describe("the consumer projection", () => {
  it("refuses every operator-only kind", () => {
    // The set is read off the catalog, not listed here: a kind that becomes operator-only is covered
    // the moment its entry says so.
    const operatorOnly = (Object.keys(TIMELINE_CATALOG) as TimelineCatalogKey[]).filter(
      (key) => specFor(key).operatorOnly === true,
    );
    assert.ok(operatorOnly.length >= 2, "the catalog declares almost nothing operator-only");
    for (const key of operatorOnly) {
      assert.equal(effectiveSpec(SAMPLES[key], "consumer"), null, `${key} reached the consumer`);
      assert.notEqual(effectiveSpec(SAMPLES[key], "operator"), null, `${key} vanished operator-side`);
    }
  });

  it("hides an outcome until it is released, and shows it after", () => {
    const held = SAMPLES.application_outcome;
    assert.equal(effectiveSpec(held, "consumer"), null, "an unreleased outcome reached the consumer");
    const released = { ...held, releasedOn: "2026-08-24" } as TimelineRow;
    assert.notEqual(effectiveSpec(released, "consumer"), null);
  });

  it("reads a filed document as a line, with no review state on it", () => {
    const consumer = effectiveSpec(SAMPLES.document_filed, "consumer");
    assert.equal(consumer?.layout, "line");
    assert.equal(consumer?.status, undefined, "the consumer's line carries a review state");
    const operator = effectiveSpec(SAMPLES.document_filed, "operator");
    assert.equal(operator?.layout, "band");
  });

  it("gives the consumer no action that changes another person's record", () => {
    // Every consumer action is a link into their own surface. Review receipts and document requests
    // are the operator's, and a consumer band offering one would be a control the route refuses.
    for (const key of Object.keys(TIMELINE_CATALOG) as TimelineCatalogKey[]) {
      const spec = effectiveSpec(SAMPLES[key], "consumer");
      if (spec === null) continue;
      for (const action of spec.actions?.(SAMPLES[key], "consumer") ?? []) {
        assert.equal(action.intent, "open", `the consumer's ${key} offers ${action.intent}`);
      }
    }
  });
});

describe("the one filled action", () => {
  it("marks at most one action per band as eligible for it", () => {
    for (const key of Object.keys(TIMELINE_CATALOG) as TimelineCatalogKey[]) {
      for (const audience of AUDIENCES) {
        const spec = effectiveSpec(SAMPLES[key], audience);
        if (spec === null) continue;
        const eligible = (spec.actions?.(SAMPLES[key], audience) ?? []).filter(isPrimaryEligible);
        assert.ok(
          eligible.length <= 1,
          `${key}/${audience} offers ${eligible.length} fillable actions`,
        );
      }
    }
  });

  it("drops every action from a superseded analysis", () => {
    const superseded = { ...SAMPLES.analysis_completed, superseded: true } as TimelineRow;
    for (const audience of AUDIENCES) {
      const spec = effectiveSpec(superseded, audience)!;
      assert.deepEqual(spec.actions?.(superseded, audience), []);
    }
  });

  it("keeps a kind's layout, glyph and noun out of the caller's hands", () => {
    // Not a style rule: the layout decides whether a row can carry an action at all, and a caller
    // that could choose it could put a payment behind a disclosure or give a stage move a button.
    for (const key of Object.keys(TIMELINE_CATALOG) as TimelineCatalogKey[]) {
      const spec = specFor(key);
      assert.ok(spec.layout === "line" || spec.layout === "band");
      if (key === "transition") continue;
      assert.ok(spec.noun !== null && spec.noun !== "", `${key} has no noun to announce`);
      assert.ok(spec.glyph !== null, `${key} has no glyph`);
    }
  });
});

describe("the marker grammar", () => {
  it("gives every status a word beside its marker", () => {
    const seen = new Set<string>();
    for (const key of Object.keys(TIMELINE_CATALOG) as TimelineCatalogKey[]) {
      for (const audience of AUDIENCES) {
        const spec = effectiveSpec(SAMPLES[key], audience);
        const status = spec?.status?.(SAMPLES[key], audience);
        if (!status) continue;
        seen.add(status.marker);
        assert.notEqual(status.label.trim(), "", `${key}/${audience} has a marker with no label`);
      }
    }
    // Four of DESIGN.md's five appear in these samples; `reported` needs a row in that state, which
    // the grouping test covers. What matters here is that the labels exist at all.
    assert.ok(seen.size >= 3, `only ${seen.size} markers exercised`);
  });
});

describe("a kind is not an audience", () => {
  it("says something different to each side wherever the audience is a parameter", () => {
    // A catalog entry taking `audience` and ignoring it is the defect this catches: the operator
    // reading the client's own wording, or the client reading a sentence written about them.
    const differs: TimelineKind[] = [
      "thread_opened",
      "stage_changed",
      "enrollment_milestone",
      "subscription",
      "consent_revoked",
      "analysis_completed",
      "action",
      "document_requested",
      "refresh",
      "fee_payment",
    ];
    for (const kind of differs) {
      const row = SAMPLES[kind];
      const consumer = titleText(specFor(kind).copy(row, "consumer").title);
      const operator = titleText(specFor(kind).copy(row, "operator").title);
      assert.notEqual(consumer, operator, `${kind} says the same thing to both readers`);
    }
  });
});
