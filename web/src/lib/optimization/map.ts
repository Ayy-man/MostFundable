import {
  BUSINESS_CHECKLIST_V1,
  PERSONAL_CHECKLIST_V1,
  checklistStatesFor,
} from "../llm/checklist-seeds.ts";
import { readinessLabelFor } from "../llm/evaluator.ts";
import { accountStates } from "../llm/mock-driver.ts";
import { parseNarrativeV1 } from "./narrative-guard.ts";

import type { AccountFeature, DerivedFeatures } from "../analysis/features.ts";
import type { ChecklistStateV1, FundingReadinessPlanV1 } from "../llm/types.ts";
import type {
  ChecklistRowStateV1,
  ConsumerOptimizationV1,
  FactorChildV1,
  FactorStateV1,
  FactorV1,
  TrackV1,
  UtilizationAccountV1,
  UtilizationV1,
} from "./types.ts";

export type {
  ChecklistRowStateV1,
  ConsumerOptimizationV1,
  FactorChildV1,
  FactorStateV1,
  FactorV1,
  TrackV1,
} from "./types.ts";

/** Revolving utilization target, in percent. One constant so copy and arithmetic cannot drift. */
export const UTILIZATION_TARGET_PCT = 30 as const;

/** The one template that covers a whole track rather than a single factor. */
export const BUSINESS_ROLLUP_TEMPLATE_KEY_V1 = "business-profile-complete" as const;

/**
 * The founder's ten personal factor keys, in checklist order.
 * The engine's seed order already matches; this constant makes the dependency explicit so a
 * future reorder of the seeds fails the ordering test rather than silently reshuffling the view.
 */
export const CONSUMER_PERSONAL_FACTOR_ORDER_V1 = [
  "credit_score_700",
  "personal_information_confirmed",
  "clean_report",
  "utilization_under_30",
  "four_personal_accounts_open",
  "average_age_two_years",
  "no_late_payments",
  "no_negative_items_reported",
  "personal_card_ten_k_limit",
  "inquiries_within_bureau_limit",
] as const;

/**
 * Client-facing labels for the personal track (feedback #172). The engine's own titles are the
 * internal phrasing and stay in `checklist-seeds.ts`; these are what a consumer reads. Each one
 * names a readiness STATE, never a repair action, which is the compliance line this product
 * cannot cross.
 */
export const CONSUMER_PERSONAL_FACTOR_TITLES_V1: Readonly<
  Record<(typeof CONSUMER_PERSONAL_FACTOR_ORDER_V1)[number], string>
> = Object.freeze({
  credit_score_700: "Credit score 700 or higher",
  average_age_two_years: "Average credit age across all accounts 2+ years",
  four_personal_accounts_open: "Minimum 4 personal credit accounts open",
  inquiries_within_bureau_limit: "Max 2 inquiries on each bureau",
  no_negative_items_reported: "No negative items",
  clean_report: "Clean report",
  no_late_payments: "No late payments reported",
  personal_card_ten_k_limit: "Minimum 1 personal credit card with limit $10k+",
  personal_information_confirmed: "Correct personal information",
  utilization_under_30: "Utilization under 30%",
});

/**
 * How a `checklist_item_state` row finds the factor it belongs to.
 *
 * The durable checklist is keyed by `checklist_templates.key`; the engine's factors are keyed by
 * seed key. Only two templates exist today, and only ONE of them is per-factor:
 *
 *   utilization-under-thirty   -> utilization_under_30   (exactly one factor: it may overlay)
 *   business-profile-complete  -> NO factor              (track-level: see the rollup below)
 *
 * `business-profile-complete` is deliberately absent from this table. It is one row standing for a
 * whole seven-factor track, so overlaying it per factor would flip all seven to "checking" and
 * tell a consumer we are checking seven things we have no per-factor knowledge of. The row is not
 * discarded: `TrackV1.rollup` carries it beside the factors so a surface can say the profile was
 * reported, without pretending to know which part of it. A factor with no entry here has no
 * durable row to overlay and keeps its derived state.
 */
export const CHECKLIST_TEMPLATE_KEY_BY_FACTOR_KEY: Readonly<Record<string, string>> = Object.freeze({
  utilization_under_30: "utilization-under-thirty",
});

/**
 * The synthetic factor key a surface reports the business track's rollup under.
 *
 * The business row stands for the whole track and belongs to no single factor, so it has no seed
 * key to name it by. `POST /api/optimization/report` still has to accept it, because "the consumer
 * reported the business profile" is one of the exactly two things this platform lets a consumer
 * say, so it gets a key of its own here rather than a place in the read map above.
 */
export const BUSINESS_ROLLUP_FACTOR_KEY_V1 = "business_profile" as const;

/**
 * What the WRITE path accepts, and the only thing it accepts.
 *
 * Derived from the read map rather than restated beside it, so a factor that gains a durable
 * template becomes reportable in one place instead of two. The one entry the read map cannot hold
 * is the business rollup: overlaying that row per factor is exactly what the comment above refuses
 * to do, and it is still the row a consumer reports.
 *
 * This table is a convenience for the route, not a boundary. The boundary is the SQL allow-list in
 * migration 391, which a browser cannot reach past; every key here has to appear there too, and
 * `map.test.ts` asserts that both directions hold by reading the migration.
 */
export const CONSUMER_REPORTABLE_TEMPLATE_KEY_BY_FACTOR_KEY: Readonly<Record<string, string>> =
  Object.freeze({
    ...CHECKLIST_TEMPLATE_KEY_BY_FACTOR_KEY,
    [BUSINESS_ROLLUP_FACTOR_KEY_V1]: BUSINESS_ROLLUP_TEMPLATE_KEY_V1,
  });

/** The two actions `report_checklist_item` understands. */
export const CONSUMER_REPORT_ACTIONS_V1 = ["report", "undo"] as const;

export type ConsumerReportActionV1 = (typeof CONSUMER_REPORT_ACTIONS_V1)[number];

/** The template key each track's rollup row is read from, or null for a track that has none. */
const ROLLUP_TEMPLATE_KEY_BY_TRACK: Readonly<Record<TrackV1["kind"], string | null>> = Object.freeze({
  business_setup: BUSINESS_ROLLUP_TEMPLATE_KEY_V1,
  personal_credit: null,
});

/**
 * The only keys a utilization account entry may carry. The projection builds each entry from this
 * list rather than by spreading the source row, so a new column on `analysis_runs.derived` reaches
 * the browser only when someone adds it here on purpose.
 */
export const UTILIZATION_ACCOUNT_KEYS_V1 = [
  "accountRef",
  "overTarget",
  "pointsOverTarget",
  "utilizationPct",
] as const;

export interface ConsumerChecklistStateRow {
  readonly templateKey: string;
  readonly state: ChecklistRowStateV1;
  readonly reportedAt: string | null;
  readonly verifyingAt: string | null;
  readonly verifiedAt: string | null;
}

export interface ConsumerOptimizationSourceV1 {
  readonly clientId: string;
  /**
   * The latest `plans` row, or null when the client has none. `body` is unvalidated jsonb.
   *
   * `narrative` is the same row's `plans.narrative`, also unvalidated. It is OPTIONAL rather than
   * nullable because a database that predates migration 435 has no such column, so the read cannot
   * select it and hands back a row with the property absent; the guard treats absent and null
   * alike.
   */
  readonly plan: {
    readonly body: unknown;
    readonly readinessScore: number;
    readonly narrative?: unknown;
  } | null;
  /** The latest `analysis_runs` row, or null when nothing has been analyzed. */
  readonly run: {
    readonly ranAt: string;
    readonly trigger: string;
    readonly readinessScore: number | null;
    /** Unvalidated jsonb; shaped like `DerivedFeatures` when the run succeeded. */
    readonly derived: unknown;
  } | null;
  readonly checklistStates: readonly ConsumerChecklistStateRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Is this stored `plans.body` a real generated plan, or the seed stub?
 *
 * A stub body (`{"summary": "..."}`) carries no factor states, so treating it as a plan would
 * render eight empty factors as though they had been checked. The guard is structural rather than
 * a version check because the stub has no version field to compare against.
 */
export function isFundingReadinessPlanBody(value: unknown): value is FundingReadinessPlanV1 {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (!Array.isArray(value.personalChecklist) || !Array.isArray(value.businessChecklist)) return false;
  return [...value.personalChecklist, ...value.businessChecklist].every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.key === "string" &&
      (entry.state === "verified" || entry.state === "unverified"),
  );
}

/**
 * Is this stored `analysis_runs.derived` shaped like the features the engine reads?
 *
 * Only the fields this module actually consumes are checked. A run whose derived payload fails
 * the guard is treated as "no run" rather than half-read: a partially understood file must not
 * produce factor states a consumer would act on.
 */
export function isDerivedFeaturesBody(value: unknown): value is DerivedFeatures {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.accounts)) return false;
  const flags = value.flags;
  if (!isRecord(flags)) return false;
  return value.schemaVersion === 1 || value.schemaVersion === 2;
}

function utilizationAccount(account: AccountFeature): UtilizationAccountV1 {
  const pct = typeof account.utilizationPct === "number" ? account.utilizationPct : null;
  const overTarget = pct !== null && pct >= UTILIZATION_TARGET_PCT;
  return {
    accountRef: account.accountRef,
    overTarget,
    pointsOverTarget: overTarget ? Math.round((pct - UTILIZATION_TARGET_PCT) * 10) / 10 : null,
    utilizationPct: pct,
  };
}

function utilizationBlock(features: DerivedFeatures): UtilizationV1 {
  return {
    accounts: features.accounts
      .filter((account) => account.isOpen && account.kind === "revolving")
      .map(utilizationAccount),
    overallPct: typeof features.overallUtilizationPct === "number" ? features.overallUtilizationPct : null,
    target: UTILIZATION_TARGET_PCT,
  };
}

/**
 * The derived explanation behind a factor's state, in the consumer's words.
 *
 * Percentages, counts and months only. A dollar figure here would be a bureau balance rendered on
 * a screen, which the two-rails rule forbids; the one dollar amount that appears is the $10,000
 * limit THRESHOLD, which is a published criterion rather than an observation about this file.
 *
 * A factor with no evidence flag gets null, and null is what makes the difference between
 * "action-needed" and "not-yet-checked" downstream.
 */
function signalFor(key: string, features: DerivedFeatures): string | null {
  const openAccountCount = features.accounts.filter((account) => account.isOpen).length;
  const highestInquiries = Math.max(0, ...Object.values(features.inquiriesByBureau ?? {}));
  switch (key) {
    case "credit_score_700": {
      const scores = features.scores ?? [];
      return scores.length === 0 ? null : `Lowest pulled bureau score is ${Math.min(...scores.map((score) => score.score))}, target 700 or higher`;
    }
    case "personal_information_confirmed":
      return null;
    case "clean_report":
      return features.identity === undefined ? null : `${features.identity.addressesOnFile ?? 0} addresses and ${features.identity.employersOnFile ?? 0} employers are reported, target 1 address and 0 employers`;
    case "utilization_under_30":
      return features.overallUtilizationPct === null
        ? null
        : `Overall utilization is ${features.overallUtilizationPct}%, target under ${UTILIZATION_TARGET_PCT}%`;
    case "four_personal_accounts_open":
      return `${openAccountCount} personal accounts are reported open, target 4 or more`;
    case "average_age_two_years":
      return features.averageAgeMonths === null
        ? null
        : `Average account age is ${features.averageAgeMonths} months, target 24 months or more`;
    case "no_late_payments":
      return features.lateAccountsCount === undefined ? null : `${features.lateAccountsCount} late-payment accounts are reported, target 0`;
    case "no_negative_items_reported":
      return features.negativesCount === 0
        ? "No negative items are reported"
        : `${features.negativesCount} negative items are reported, target none`;
    case "personal_card_ten_k_limit":
      return features.flags.cardWithTenKLimit
        ? "A personal revolving account reports a limit of at least $10,000"
        : "No personal revolving account reports a limit of at least $10,000";
    case "inquiries_within_bureau_limit":
      return `The highest bureau inquiry count is ${highestInquiries}, target 2 or fewer on each bureau`;
    default:
      return null;
  }
}

function childrenFrom(entries: ChecklistStateV1["children"]): FactorChildV1[] {
  return entries.map((child) => ({
    accountRef: child.accountRef,
    key: child.key,
    // Every child in this list is there because its observed utilization is at or over target,
    // so the honest rendering is the same one an unverified parent factor gets.
    observedUtilizationPct: child.observedUtilizationPct,
    state: "action-needed" as const,
    title: child.title,
  }));
}

function checklistRowFor(
  key: string,
  rowsByTemplateKey: ReadonlyMap<string, ConsumerChecklistStateRow>,
): ConsumerChecklistStateRow | null {
  const templateKey = CHECKLIST_TEMPLATE_KEY_BY_FACTOR_KEY[key];
  if (templateKey === undefined) return null;
  return rowsByTemplateKey.get(templateKey) ?? null;
}

function reportedAt(row: ConsumerChecklistStateRow): string | null {
  return row.verifiedAt ?? row.verifyingAt ?? row.reportedAt ?? null;
}

/**
 * Resolve one factor's state.
 *
 * Order matters and is the whole rule: derived evidence wins, because a consumer telling us
 * something cannot un-verify what the file already shows. Only when the evidence is missing or
 * unsatisfied does a mid-flight checklist row take over, and only then does the presence of a
 * signal decide between "we looked and it needs action" and "we have not looked".
 */
function factorState(
  derivedState: "verified" | "unverified" | null,
  row: ConsumerChecklistStateRow | null,
  signal: string | null,
): FactorStateV1 {
  if (derivedState === "verified") return "verified";
  if (row !== null && (row.state === "reported" || row.state === "verifying")) return "checking";
  if (row !== null && row.state === "verified" && derivedState === null) return "verified";
  if (derivedState === "unverified" && signal !== null) return "action-needed";
  return "not-yet-checked";
}

function buildTrack(
  kind: TrackV1["kind"],
  states: readonly ChecklistStateV1[] | null,
  titleFor: (key: string, engineTitle: string) => string,
  features: DerivedFeatures | null,
  rowsByTemplateKey: ReadonlyMap<string, ConsumerChecklistStateRow>,
  seeds: readonly { key: string; title: string; blocking: boolean }[],
): TrackV1 {
  const byKey = new Map((states ?? []).map((entry) => [entry.key, entry]));
  const factors: FactorV1[] = seeds.map((seed) => {
    const derived = byKey.get(seed.key) ?? null;
    const signal = features === null ? null : signalFor(seed.key, features);
    const row = checklistRowFor(seed.key, rowsByTemplateKey);
    return {
      blocking: seed.blocking,
      children: derived === null ? [] : childrenFrom(derived.children),
      key: seed.key,
      reported: row === null ? null : { at: reportedAt(row), state: row.state },
      signal,
      state: factorState(derived === null ? null : derived.state, row, signal),
      title: titleFor(seed.key, seed.title),
    };
  });
  const rollupTemplateKey = ROLLUP_TEMPLATE_KEY_BY_TRACK[kind];
  const rollupRow = rollupTemplateKey === null ? undefined : rowsByTemplateKey.get(rollupTemplateKey);
  return {
    factors,
    kind,
    rollup:
      rollupRow === undefined ? null : { at: reportedAt(rollupRow), state: rollupRow.state },
    total: factors.length,
    verifiedCount: factors.filter((entry) => entry.state === "verified").length,
  };
}

/**
 * Build the consumer's Optimization read from the rows their own session was allowed to see.
 *
 * Pure: no IO, no session, no clock. Everything about WHICH rows arrive is decided by
 * `read.server.ts` under RLS; everything about what those rows are allowed to say is decided here.
 */
export function buildConsumerOptimization(
  input: ConsumerOptimizationSourceV1,
): ConsumerOptimizationV1 {
  const features = input.run !== null && isDerivedFeaturesBody(input.run.derived) ? input.run.derived : null;
  const planBody = input.plan !== null && isFundingReadinessPlanBody(input.plan.body) ? input.plan.body : null;

  const provenance: ConsumerOptimizationV1["provenance"] =
    planBody !== null ? "plan" : features !== null ? "derived-flags" : "none";

  // The derived-flags path runs the engine's own seed evaluation rather than a second copy of the
  // rules, so a factor can never mean one thing in a generated plan and another in this fallback.
  let personalStates: ChecklistStateV1[] | null = null;
  let businessStates: ChecklistStateV1[] | null = null;
  if (planBody !== null) {
    personalStates = planBody.personalChecklist;
    businessStates = planBody.businessChecklist;
  } else if (features !== null) {
    personalStates = checklistStatesFor(PERSONAL_CHECKLIST_V1, features);
    const utilizationIndex = personalStates.findIndex((item) => item.key === "utilization_under_30");
    if (utilizationIndex >= 0) personalStates[utilizationIndex] = { ...personalStates[utilizationIndex], children: accountStates(features) };
    businessStates = checklistStatesFor(BUSINESS_CHECKLIST_V1, features);
  }

  const rowsByTemplateKey = new Map(input.checklistStates.map((row) => [row.templateKey, row]));

  const readiness =
    planBody !== null ? planBody.readinessScore : input.run?.readinessScore ?? null;

  return {
    analysis:
      input.run === null
        ? null
        : {
            bureausPulled: features?.bureausPulled ?? [],
            ranAt: input.run.ranAt,
            trigger: input.run.trigger,
          },
    clientId: input.clientId,
    estimatedCompletion: { days: null, label: "TBD" },
    // Validated here rather than at the query, so every path into this projection — the real read,
    // a fixture, a test gateway — passes through the one guard.
    narrative: parseNarrativeV1(input.plan?.narrative),
    provenance,
    readiness,
    readinessLabel:
      planBody !== null
        ? planBody.readinessLabel
        : readiness === null
          ? null
          : readinessLabelFor(readiness),
    // Every client that reaches this projection is `status = 'active'`, because that is the only
    // kind `resolveConsumerClientIds` returns; see `ReportingV1` for why the closed-account branch
    // exists in the type and emits from nowhere yet.
    reporting: { enabled: true },
    schemaVersion: 1,
    tracks: {
      business: buildTrack(
        "business_setup",
        businessStates,
        (_key, engineTitle) => engineTitle,
        features,
        rowsByTemplateKey,
        BUSINESS_CHECKLIST_V1.map((seed) => ({ blocking: seed.blocking, key: seed.key, title: seed.title })),
      ),
      personal: buildTrack(
        "personal_credit",
        personalStates,
        (key, engineTitle) =>
          CONSUMER_PERSONAL_FACTOR_TITLES_V1[
            key as (typeof CONSUMER_PERSONAL_FACTOR_ORDER_V1)[number]
          ] ?? engineTitle,
        features,
        rowsByTemplateKey,
        CONSUMER_PERSONAL_FACTOR_ORDER_V1.map((key) => {
          const seed = PERSONAL_CHECKLIST_V1.find((entry) => entry.key === key);
          if (seed === undefined) throw new Error("OPTIMIZATION_PERSONAL_SEED_MISSING");
          return { blocking: seed.blocking, key: seed.key, title: seed.title };
        }),
      ),
    },
    utilization: features === null ? null : utilizationBlock(features),
  };
}
