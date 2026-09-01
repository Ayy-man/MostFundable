"use client";

// The durable client side-peek's data model (skeleton-map §0.2, the five-tab
// client peek).
//
// Clicking a client on the tracker opened nothing, and wiring the click alone
// would not have fixed it: `openClient()` resolves its id against the fixture
// `DEMO_CLIENTS` array, so a durable client UUID matched no row and the sheet
// stayed shut. The fixture drawer could not be reused either — its plan steps,
// fee ledger and application history are fixture literals, and rendering them
// under a real client's name is a worse failure than a drawer that does not
// open.
//
// So the peek reads the tracker row the surface already has. Every field below
// names a `TrackerClient` property or an `OrgReceivable` the fees rail
// returned; a field whose source is null renders an em dash and a note saying
// what is missing, never a zero and never a number borrowed from a fixture.
// The two tab notes at the bottom cover what this workspace has no operator
// route for at all: `/api/plan` does not exist, and no surface reads
// `/api/applications` while FEATURE_APPLICATIONS is off.

import { formatDemoMoney } from "@/lib/demo/feedback-fixtures";
import type { OrgReceivable } from "@/lib/fees/types";
import {
  parseObservedCreditScores,
  type OperatorCreditScoresRead,
} from "@/lib/operator/credit-scores.client";
import { trackerStageTimer } from "@/lib/tracker/timer";
import { TRACKER_STAGE_LABELS, type TrackerClient, type TrackerHealth } from "@/lib/tracker/types";

export interface TrackerDetailField {
  readonly label: string;
  /** Why the value is missing. Present exactly when `value` is null. */
  readonly note?: string;
  /** null renders as an em dash — the workspace has no value for this field. */
  readonly value: string | null;
}

export type TrackerFeesSource =
  | { readonly state: "disabled" }
  | { readonly state: "failed" }
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly receivable: OrgReceivable | null };

/** No operator route reads a client's plan steps, so the tab says so rather
 * than borrowing the fixture's. */
export const TRACKER_PLAN_STEPS_NOTE =
  "The step-by-step plan is not available on this workspace surface. The readiness figures above are what the tracker records.";

/** FEATURE_APPLICATIONS is off and no surface reads it, so there is no
 * per-application history to show beside the recorded funded amount. */
export const TRACKER_APPLICATIONS_NOTE =
  "Individual lender applications are not available for this workspace. The recorded funded amount above is what the tracker holds.";

export const TRACKER_FEES_DISABLED_NOTE =
  "Fee records are not enabled for this workspace.";

const HEALTH_TONES: Readonly<Record<TrackerHealth, "danger" | "success" | "warning">> = {
  amber: "warning",
  green: "success",
  red: "danger",
};

export function trackerHealthTone(health: TrackerHealth) {
  return HEALTH_TONES[health];
}

function sentenceCase(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

/**
 * UTC, with the year, for the same reason the tracker table is UTC: the
 * timestamp is the one the database recorded, and shifting it per viewer makes
 * two operators disagree about when a stage changed. The year stays visible
 * because a workspace can hold clients from more than one calendar year.
 */
export function formatTrackerDate(timestamp: string) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(parsed));
}

function dateField(label: string, timestamp: string | null, note: string): TrackerDetailField {
  const formatted = timestamp === null ? null : formatTrackerDate(timestamp);
  return formatted === null ? { label, note, value: null } : { label, value: formatted };
}

function moneyField(label: string, cents: number | null, note: string): TrackerDetailField {
  return cents === null
    ? { label, note, value: null }
    : { label, value: formatDemoMoney(cents / 100) };
}

export function trackerOverviewFields(
  client: TrackerClient,
  now: Date,
): readonly TrackerDetailField[] {
  const timer = trackerStageTimer(client.stage, client.stageEnteredAt, now);
  return [
    {
      label: "Business",
      ...(client.businessName === null
        ? { note: "No business name recorded", value: null }
        : { value: client.businessName }),
    },
    { label: "Stage", value: TRACKER_STAGE_LABELS[client.stage] },
    dateField("Entered stage", client.stageEnteredAt, "Not recorded"),
    {
      label: "Stage timing",
      ...(timer === null
        ? { note: "This stage has no target length", value: null }
        : {
            value: `Day ${timer.elapsedDays} of ${timer.targetDays} · ${timer.remainingDays} days remaining`,
          }),
    },
    {
      label: "Team member",
      ...(client.assignedToName === null
        ? { note: "Unassigned", value: null }
        : { value: client.assignedToName }),
    },
    dateField("Client since", client.startedAt, "Not recorded"),
    moneyField("Funding goal", client.goalCents, "No goal recorded"),
    { label: "Workspace status", value: sentenceCase(client.status) },
    dateField("Last activity", client.lastActivityAt, "Not recorded"),
  ];
}

export function trackerPlanFields(
  client: TrackerClient,
  creditScores: OperatorCreditScoresRead,
): readonly TrackerDetailField[] {
  const creditScoreField: TrackerDetailField = (() => {
    const scores = creditScores.state === "ready"
      ? parseObservedCreditScores(creditScores.scores)
      : null;
    if (scores !== null) {
      const labels = { EQF: "Equifax", EXP: "Experian", TUC: "TransUnion" } as const;
      const ordered = [...scores].sort(
        (left, right) => ["EQF", "EXP", "TUC"].indexOf(left.bureau) - ["EQF", "EXP", "TUC"].indexOf(right.bureau),
      );
      return {
        label: "Credit Score",
        value: ordered.map((entry) => `${labels[entry.bureau]} ${entry.score}`).join(" · "),
      };
    }
    let note: string;
    if (creditScores.state === "unavailable") {
      note = creditScores.reason === "monitoring_inactive"
        ? "Credit monitoring permission is not active"
        : creditScores.reason === "not_enrolled"
          ? "No CRS enrollment is recorded"
          : "CRS has no current score for this client";
    } else if (creditScores.state === "failed" || creditScores.state === "ready") {
      note = "Current CRS scores are unavailable right now";
    } else {
      note = "Loading current CRS scores";
    }
    return { label: "Credit Score", note, value: null };
  })();

  return [
    {
      label: "Readiness score",
      ...(client.readiness === null
        ? { note: "No completed analysis", value: null }
        : { value: `${client.readiness} of 100` }),
    },
    {
      label: "Remaining steps",
      ...(client.openActionCount === null
        ? { note: "No completed analysis", value: null }
        : { value: String(client.openActionCount) }),
    },
    dateField("Last analysis", client.analysisAt, "No completed analysis"),
    dateField("Next refresh", client.nextRefreshAt, "None scheduled"),
    dateField(
      "Estimated completion",
      client.estimatedCompletionAt,
      "No estimate recorded",
    ),
    creditScoreField,
    { label: "Credit monitoring", value: sentenceCase(client.monitoring) },
  ];
}

export function trackerFundingFields(
  client: TrackerClient,
): readonly TrackerDetailField[] {
  return [
    moneyField(
      "Funding approved",
      client.fundingApprovedCents,
      "No recorded funded outcome",
    ),
    moneyField("Funding goal", client.goalCents, "No goal recorded"),
    {
      label: "Lender matches",
      value: client.matchesUnlockedOverride
        ? "Unlocked by the workspace"
        : "Follows the readiness rule",
    },
  ];
}

export function trackerFeesFields(
  source: TrackerFeesSource,
): readonly TrackerDetailField[] {
  if (source.state !== "ready" || source.receivable === null) {
    const note =
      source.state === "disabled"
        ? TRACKER_FEES_DISABLED_NOTE
        : source.state === "loading"
          ? "Loading fee records"
          : source.state === "failed"
            ? "Fee records are unavailable right now"
            : "No fee agreement recorded for this client";
    return [
      { label: "Arrangement", note, value: null },
      { label: "Agreement status", note, value: null },
      { label: "Total", note, value: null },
      { label: "Paid", note, value: null },
      { label: "Balance", note, value: null },
      { label: "Last payment", note, value: null },
    ];
  }
  const receivable = source.receivable;
  return [
    {
      label: "Arrangement",
      ...(receivable.model === null
        ? { note: "No arrangement recorded", value: null }
        : { value: sentenceCase(receivable.model) }),
    },
    {
      label: "Agreement status",
      ...(receivable.status === null
        ? { note: "No agreement recorded", value: null }
        : { value: sentenceCase(receivable.status) }),
    },
    moneyField("Total", receivable.totalCents, "Not recorded"),
    moneyField("Paid", receivable.paidCents, "Not recorded"),
    moneyField("Balance", receivable.balanceCents, "Not recorded"),
    dateField("Last payment", receivable.lastPaymentOn, "No payment recorded"),
  ];
}

export interface TrackerActivityEntry {
  readonly at: string;
  readonly key: string;
  readonly text: string;
}

/** The stage transitions the tracker recorded, newest first. */
export function trackerActivityEntries(
  client: TrackerClient,
): readonly TrackerActivityEntry[] {
  return [...client.history]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .map((entry, index) => ({
      at: entry.at,
      key: `${entry.at}-${entry.to}-${index}`,
      text: entry.from === null
        ? `Started in ${TRACKER_STAGE_LABELS[entry.to]}`
        : `${TRACKER_STAGE_LABELS[entry.from]} → ${TRACKER_STAGE_LABELS[entry.to]}`,
    }));
}
