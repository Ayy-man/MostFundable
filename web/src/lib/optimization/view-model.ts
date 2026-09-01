/**
 * The Optimization view's presentation rules, kept pure so they can be tested without React.
 *
 * Two axes, kept separate on purpose. The STATE axis comes from the read contract and says what
 * the evidence shows. The OWNER axis is a catalog decision about who can move a factor, and it is
 * what stops the screen from manufacturing urgency: a factor that "moves with time" or is "with
 * your funding team" is never tagged as something the consumer is failing at, and the two
 * reporting-state factors (what the bureaus report as-is) are never assigned to anyone at all.
 *
 * Nothing here re-derives evidence. Nothing here carries a balance, a limit or an age.
 */
import type {
  ConsumerOptimizationV1,
  FactorStateV1,
  FactorV1,
  TrackV1,
  UtilizationAccountV1,
} from "./types.ts";

export type FactorOwnerV1 = "you" | "team" | "time" | "docs" | "report";

export const OWNER_LABEL_V1: Readonly<Record<FactorOwnerV1, string>> = {
  docs: "Needs your documents",
  report: "Reported as-is, nothing to action",
  team: "With your funding team",
  time: "Moves with time",
  you: "On you",
};

/**
 * Who can move each factor. Keys are the engine's checklist keys (`checklist-seeds.ts`); a key
 * missing here is treated as the funding team's, which is the honest default for anything new.
 */
export const FACTOR_OWNER_BY_KEY_V1: Readonly<Record<string, FactorOwnerV1>> = {
  average_age_two_years: "time",
  business_email_present: "docs",
  business_entity_age_confirmed: "docs",
  business_identifier_present: "docs",
  business_name_confirmed: "docs",
  business_website_present: "docs",
  four_personal_accounts_open: "team",
  industry_classification_confirmed: "docs",
  inquiries_within_bureau_limit: "time",
  net_asset_value_confirmed: "docs",
  no_negative_items_reported: "report",
  overall_report_ready: "report",
  personal_card_ten_k_limit: "team",
  personal_information_confirmed: "team",
  utilization_under_30: "you",
};

export function ownerOf(key: string): FactorOwnerV1 {
  return FACTOR_OWNER_BY_KEY_V1[key] ?? "team";
}

/** What a row renders as. The two extra values exist only on this axis, never in the contract. */
export type DisplayStateV1 = FactorStateV1 | "reported" | "tracked";

export const DISPLAY_STATE_LABEL_V1: Readonly<Record<DisplayStateV1, string>> = {
  "action-needed": "Action needed",
  checking: "Checking",
  "not-yet-checked": "Not yet checked",
  reported: "Reported as-is",
  tracked: "Tracked",
  verified: "Verified",
};

/**
 * A reported business profile moves the business factors along the STATE axis, to checking, and
 * never along the owner axis: the consumer still owns their own documents, the team simply has
 * them in hand.
 */
export function effectiveFactorState(factor: FactorV1, track: TrackV1): FactorStateV1 {
  if (factor.state === "verified") return "verified";
  if (
    track.kind === "business_setup" &&
    track.rollup !== null &&
    (track.rollup.state === "reported" || track.rollup.state === "verifying")
  ) {
    return "checking";
  }
  return factor.state;
}

export function displayState(
  factor: FactorV1,
  track: TrackV1,
  canceled: boolean,
): DisplayStateV1 {
  const state = effectiveFactorState(factor, track);
  if (state !== "action-needed") return state;
  const owner = ownerOf(factor.key);
  if (owner === "report") return "reported";
  if (canceled || !(owner === "you" || owner === "docs")) return "tracked";
  return "action-needed";
}

export function isOpen(state: DisplayStateV1): boolean {
  return state === "action-needed" || state === "not-yet-checked" || state === "reported" || state === "tracked";
}

/**
 * The engine's signal is a measurement. A couple of them read as an instruction on a factor
 * nobody actions, so those are restated as the observation they are.
 */
export function signalCopy(factor: FactorV1): string | null {
  if (factor.signal === null) return null;
  if (factor.key === "no_negative_items_reported") {
    return factor.signal.replace(/, target none$/, "") +
      (factor.signal.endsWith("target none")
        ? ". This factor stays open while they report; it is not a task for you."
        : ".");
  }
  if (factor.key === "average_age_two_years") {
    return `${factor.signal}. Keep older accounts open; nothing else to do.`;
  }
  if (factor.key === "inquiries_within_bureau_limit") {
    return `${factor.signal}. Inquiries age off on their own; every new application resets the wait.`;
  }
  if (factor.key === "personal_card_ten_k_limit") {
    return `${factor.signal}. Sequenced by your funding team, not applied for alone.`;
  }
  return `${factor.signal}.`;
}

export interface BucketsV1 {
  readonly checking: number;
  readonly docs: readonly FactorV1[];
  readonly report: readonly FactorV1[];
  readonly team: readonly FactorV1[];
  readonly time: readonly FactorV1[];
  readonly total: number;
  readonly verified: number;
  readonly you: readonly FactorV1[];
}

export function buckets(view: ConsumerOptimizationV1, canceled: boolean): BucketsV1 {
  const tracks = [view.tracks.personal, view.tracks.business];
  const rows = tracks.flatMap((track) =>
    track.factors.map((factor) => ({ factor, owner: ownerOf(factor.key), state: displayState(factor, track, canceled) })),
  );
  const open = rows.filter((row) => isOpen(row.state));
  const by = (owner: FactorOwnerV1) => open.filter((row) => row.owner === owner).map((row) => row.factor);
  return {
    checking: rows.filter((row) => row.state === "checking").length,
    docs: by("docs"),
    report: by("report"),
    team: by("team"),
    time: by("time"),
    total: rows.length,
    verified: rows.filter((row) => row.state === "verified").length,
    you: by("you"),
  };
}

/**
 * The current open-action total used outside the Optimization page.
 *
 * This deliberately reuses the same display-state and ownership rules as the
 * page's Open filter. A row being checked is in progress rather than open; a
 * tracked/reporting row remains open even when it is not a task for the
 * consumer. Keeping this here prevents Overview and Team Chat from inventing
 * a second checklist arithmetic.
 */
export function openActionCount(view: ConsumerOptimizationV1, canceled = false): number {
  const summary = buckets(view, canceled);
  return summary.docs.length
    + summary.report.length
    + summary.team.length
    + summary.time.length
    + summary.you.length;
}

export type NextUpV1 =
  | { readonly kind: "ready" }
  | { readonly kind: "you"; readonly factor: FactorV1; readonly overallUtilizationPct: number | null; readonly hasAccountRows: boolean; readonly docsAlso: boolean }
  | { readonly kind: "docs"; readonly missing: readonly FactorV1[] }
  | { readonly kind: "rollup"; readonly reportedAt: string | null }
  | { readonly kind: "waiting" };

/**
 * The one thing the hero names. Order is the rule: complete beats everything; something the
 * consumer can do now beats documents they owe; documents beat waiting; a reported business
 * profile is a wait with a receipt.
 */
export function nextUp(view: ConsumerOptimizationV1, canceled: boolean): NextUpV1 {
  const b = buckets(view, canceled);
  if (b.verified === b.total) return { kind: "ready" };
  if (b.you.length > 0) {
    const factor = b.you[0];
    return {
      docsAlso: b.docs.length > 0 && !canceled,
      factor,
      hasAccountRows: (view.utilization?.accounts.length ?? 0) > 0 || factor.children.length > 0,
      kind: "you",
      overallUtilizationPct: view.utilization?.overallPct ?? null,
    };
  }
  if (b.docs.length > 0) return { kind: "docs", missing: b.docs };
  const rollup = view.tracks.business.rollup;
  if (rollup !== null && (rollup.state === "reported" || rollup.state === "verifying") && view.tracks.business.verifiedCount < view.tracks.business.total) {
    return { kind: "rollup", reportedAt: rollup.at };
  }
  return { kind: "waiting" };
}

export type TrackKindV1 = "personal" | "business";

export function referencedTrack(view: ConsumerOptimizationV1, canceled: boolean): TrackKindV1 | null {
  const next = nextUp(view, canceled);
  if (next.kind === "you") return "personal";
  if (next.kind === "docs" || next.kind === "rollup") return "business";
  return null;
}

export interface TrackSummaryV1 {
  readonly attention: number;
  readonly caption: readonly string[];
  readonly checking: number;
  readonly complete: boolean;
  readonly done: number;
  readonly pct: number;
  readonly pctChecking: number;
  readonly sameDocsLead: boolean;
  readonly total: number;
  readonly tracked: number;
}

export function trackSummary(track: TrackV1, canceled: boolean): TrackSummaryV1 {
  const rows = track.factors.map((factor) => ({ factor, owner: ownerOf(factor.key), state: displayState(factor, track, canceled) }));
  const total = rows.length;
  const done = rows.filter((row) => row.state === "verified").length;
  const checking = rows.filter((row) => row.state === "checking").length;
  const attention = canceled ? 0 : rows.filter((row) => row.state === "action-needed").length;
  const tracked = rows.filter((row) => isOpen(row.state) && row.state !== "action-needed").length;
  const openRows = rows.filter((row) => isOpen(row.state));
  const sameDocsLead =
    openRows.length > 1 &&
    openRows.every((row) => row.owner === "docs" && row.factor.signal === null);
  const caption: string[] = [];
  if (attention) caption.push(`${attention} need${attention === 1 ? "s" : ""} attention`);
  if (tracked) caption.push(`${tracked} tracked, not on you`);
  if (checking) caption.push(`${checking} checking`);
  caption.push(`${done} of ${total} verified`);
  return {
    attention,
    caption,
    checking,
    complete: total > 0 && done === total,
    done,
    pct: total ? Math.round((done / total) * 100) : 0,
    pctChecking: total ? Math.round((checking / total) * 100) : 0,
    sameDocsLead,
    total,
    tracked,
  };
}

export function sortedUtilizationAccounts(accounts: readonly UtilizationAccountV1[]): UtilizationAccountV1[] {
  return [...accounts].sort((a, b) => (b.utilizationPct ?? -1) - (a.utilizationPct ?? -1));
}

/** "Aug 15" style, UTC so a server timestamp reads the same in every browser. */
export function shortDate(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

/** Strip the engine's confirmation suffixes so a list of missing documents reads as nouns. */
export function documentNoun(factor: FactorV1): string {
  return factor.title
    .toLowerCase()
    .replace(/ is (confirmed for funding readiness|confirmed|present|at least one month)$/, "")
    .replace(/ information$/, "");
}
