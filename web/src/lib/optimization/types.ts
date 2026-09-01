/**
 * The consumer Optimization view's read contract.
 *
 * Every field here is DERIVED. Nothing on this type can carry a bureau file, a balance, a
 * limit, an account age, or any other raw datum: the projection that builds it whitelists
 * columns by name rather than omitting the ones we happened to think of, so a new column on
 * `analysis_runs.derived` cannot reach a browser by default (see `map.ts`).
 */

/** What the consumer is told about one readiness factor. */
export type FactorStateV1 =
  /** The latest evidence satisfies this factor. */
  | "verified"
  /** The latest evidence does not satisfy it, and we can say why. */
  | "action-needed"
  /** The consumer told us something and it has not been re-derived yet. */
  | "checking"
  /** Nothing has been derived for this factor. Never rendered as a failure. */
  | "not-yet-checked";

/** The durable checklist state a factor is overlaid with, straight from `checklist_item_state`. */
export type ChecklistRowStateV1 = "todo" | "reported" | "verifying" | "verified";

export type ChecklistKindV1 = "personal_credit" | "business_setup";

export interface FactorChildV1 {
  readonly key: string;
  readonly accountRef: string;
  readonly title: string;
  readonly observedUtilizationPct: number;
  readonly state: FactorStateV1;
}

export interface FactorV1 {
  readonly key: string;
  readonly title: string;
  readonly state: FactorStateV1;
  readonly blocking: boolean;
  /**
   * A derived, non-raw explanation of the observation behind `state`, or null when nothing was
   * derived for this factor. Percentages, counts and months only; never a dollar balance.
   */
  readonly signal: string | null;
  readonly children: readonly FactorChildV1[];
  /** The durable checklist row overlaid onto this factor, or null when the client has none. */
  readonly reported: { readonly state: ChecklistRowStateV1; readonly at: string | null } | null;
}

export interface TrackV1 {
  readonly kind: ChecklistKindV1;
  readonly factors: readonly FactorV1[];
  readonly verifiedCount: number;
  readonly total: number;
  /**
   * A durable checklist row that covers this track as a whole rather than any single factor,
   * or null when the client has none.
   *
   * It exists because the business track has exactly one template behind it
   * (`business-profile-complete`) and eight factors in front of it. Overlaying that row onto each
   * factor would claim per-factor knowledge nobody has; dropping it would lose the fact that the
   * consumer reported the profile at all. So it is carried here, beside the factors, for a surface
   * to render as "you reported the business profile on <date>" and nothing more.
   */
  readonly rollup: { readonly state: ChecklistRowStateV1; readonly at: string | null } | null;
}

export interface UtilizationAccountV1 {
  readonly accountRef: string;
  readonly utilizationPct: number | null;
  readonly overTarget: boolean;
  readonly pointsOverTarget: number | null;
}

export interface UtilizationV1 {
  readonly overallPct: number | null;
  readonly target: 30;
  readonly accounts: readonly UtilizationAccountV1[];
}

export interface OptimizationAnalysisV1 {
  readonly ranAt: string | null;
  readonly trigger: string | null;
  readonly bureausPulled: readonly string[];
}

/**
 * Where the factor states came from.
 *
 * `plan` — a real `FundingReadinessPlanV1` body was stored and its own states are authoritative.
 * `derived-flags` — the stored body is the stub, so the states are re-derived from the latest
 * run's flags through the same engine seeds the plan generator uses.
 * `none` — there is no analysis run at all, so nothing has been checked.
 */
export type OptimizationProvenanceV1 = "plan" | "derived-flags" | "none";

/**
 * Whether the consumer may mark a factor reported, and the reason when they may not.
 *
 * `no-write-path` is the answer from before migration 391 existed and is kept in the union
 * deliberately: a deployment whose ledger stops short of 391 has no `report_checklist_item` to
 * call, and a surface that reads `enabled: true` there would render a control whose 404 the person
 * clicking it cannot interpret. `canceled` is the closed-account answer.
 *
 * Nothing emits `canceled` today, and that is a statement about the schema rather than an oversight:
 * `clients.status` is the enum `('active', 'archived')` (migration 190) and carries no cancelled
 * value, cancellation lives on `enrollments.status` and `consumer_subscriptions.status`
 * (migration 260), and this read never sees a client that is not `active` because
 * `resolveConsumerClientIds` filters on it. The variant is here so that wiring a cancelled
 * enrollment through is a change to one branch rather than a change to the contract.
 */
export type ReportingV1 =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: "no-write-path" | "canceled" };

export interface ConsumerOptimizationV1 {
  readonly schemaVersion: 1;
  readonly clientId: string;
  readonly readiness: number | null;
  readonly readinessLabel: string | null;
  readonly analysis: OptimizationAnalysisV1 | null;
  readonly provenance: OptimizationProvenanceV1;
  readonly tracks: { readonly personal: TrackV1; readonly business: TrackV1 };
  readonly utilization: UtilizationV1 | null;
  readonly estimatedCompletion: { readonly label: "TBD"; readonly days: null };
  /** Whether this consumer may report a factor, and when they may not, why. */
  readonly reporting: ReportingV1;
}
