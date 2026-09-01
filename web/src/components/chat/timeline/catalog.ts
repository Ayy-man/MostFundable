/**
 * The catalog: kind → layout → copy → facts → status → actions, for two audiences.
 *
 * Every timeline row on either surface is produced here and nowhere else. That is the property
 * worth protecting: a new kind is one entry in this table, the renderers do not change, and no
 * surface gets to form its own opinion about what a stage move says to a client. It is a direct
 * port of the approved mockup's `CATALOG`
 * (`docs/plans/2026-08-24-conversation-timeline-mockup.html`), and the copy is byte-for-byte what
 * that mockup rendered — it went through four roast rounds and the 27-rule compliance battery, so a
 * reworded sentence here is an unreviewed sentence, not an improvement.
 *
 * Three rules are structural rather than stylistic.
 *
 * **A title is segments, not markup.** The mockup emphasised a stage name with `<b>`. A React port
 * that kept the string would need `dangerouslySetInnerHTML`, so the emphasis is data:
 * `["Your stage moved to ", { strong: "Optimization" }]`. `titleText` flattens it, which is also
 * what lets a test compare a rendered title against the mockup's text.
 *
 * **A destination is a typed target, never a URL.** All four surfaces are single pages with
 * internal views, so "Open Optimization" is a navigation the host performs, not an href. The
 * catalog says where; the host says how. An action whose host cannot honour it is not rendered as a
 * control that does nothing — `<TimelineEventBand>` requires the handler.
 *
 * **The consumer projection is decided twice, on purpose.** The reader in `lib/timeline/` never
 * sends a consumer an operator-only kind or an unreleased outcome, and `operatorOnly` /
 * `consumerHidden` here refuse to render one anyway. The server rule is the one that matters; this
 * one is what makes a fixture, a test, or a future caller unable to leak by accident.
 */

import type {
  ActionEvent,
  AnalysisCompletedEvent,
  ApplicationOutcomeEvent,
  AssignmentEvent,
  ConsentRevokedEvent,
  DocumentFiledEvent,
  DocumentRequestedEvent,
  EnrollmentMilestoneEvent,
  FeePaymentEvent,
  RefreshBlockedEvent,
  RefreshEvent,
  StageChangedEvent,
  SubscriptionEvent,
  ThreadOpenedEvent,
  ThreadStatusEvent,
  TimelineAudience,
  TimelineEvent,
  TimelineKind,
} from "@/lib/timeline/types";

import {
  capitalize,
  openActionSentence,
  timelineDate,
  timelineMoney,
  timelineTime,
} from "./format";

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

/**
 * A transition row: the moment a band's state changed, written as a reference back to it.
 *
 * Synthesized by `expandTransitions`, never read from a table, which is why it is not in the
 * contract. A state change is two facts — the origin band keeps its opening title and carries the
 * final status, and the moment it changed is its own row at the real instant. Without the second
 * row, "the statement I sent this morning" has no antecedent anywhere in the thread and the change
 * appears to have happened under an earlier day divider.
 */
export interface TimelineTransitionRow {
  readonly kind: "transition";
  /** @opaque React identity. Never rendered. */
  readonly ref: string;
  readonly at: string;
  readonly title: string;
  /** Inherited from the origin kind, so a transition reads as belonging to it. */
  readonly noun: string;
  readonly glyph: TimelineGlyph;
  readonly filterAs: TimelineFilterId;
}

/** What a thread renders: a contract event, or a transition synthesized from one. */
export type TimelineRow = TimelineEvent | TimelineTransitionRow;

/** The catalog's own keys: every kind, plus the two rows no table produces. */
export type TimelineCatalogKey = TimelineKind | "transition" | "document_line";

// ---------------------------------------------------------------------------------------------
// The pieces a spec returns
// ---------------------------------------------------------------------------------------------

export type TimelineLayout = "line" | "band";

/** The operator's filter chips. `null` on a kind that is never filtered out on its own. */
export type TimelineFilterId = "analysis" | "documents" | "stage" | "billing";

/** Icon names, resolved to components in `glyphs.tsx`. A name so the catalog stays a data file. */
export type TimelineGlyph =
  | "gauge"
  | "stage"
  | "doc"
  | "list"
  | "refresh"
  | "card"
  | "bank"
  | "person"
  | "flag"
  | "shield"
  | "chat";

/** A title, with emphasis carried as data rather than as markup. */
export type TimelineTitle = readonly (string | { readonly strong: string })[];

export function titleText(title: TimelineTitle): string {
  return title.map((part) => (typeof part === "string" ? part : part.strong)).join("");
}

export interface TimelineFact {
  readonly label: string;
  readonly value: string;
}

/** DESIGN.md's marker grammar, verbatim. Every marker keeps a word beside it. */
export type TimelineMarker = "verified" | "reported" | "verifying" | "paused" | "todo";

export interface TimelineStatus {
  readonly marker: TimelineMarker;
  readonly label: string;
}

/** Where a deep link goes. The host maps it to its own navigation. */
export type TimelineTarget =
  | {
      readonly kind: "consumer-view";
      readonly view: "optimization" | "documents";
      /** The plan item to open, when the link is about one. A shipped item title. */
      readonly item?: string;
    }
  | {
      readonly kind: "operator-client";
      readonly section: "plan" | "document" | "fees" | "applications" | "plan-caps";
      readonly item?: string;
    };

/**
 * What a row can offer, and the four things one can be.
 *
 * `style: "primary"` marks an action as *eligible* for the one filled green control in the thread;
 * `primaryTarget` decides which single band actually gets it. Everything else is an outline or a
 * quiet link, which is what keeps Electric Green an accent instead of a field.
 */
export type TimelineAction =
  | {
      readonly intent: "open";
      readonly style: "primary" | "quiet";
      readonly label: string;
      readonly target: TimelineTarget;
    }
  | { readonly intent: "request-document"; readonly style: "primary"; readonly label: string }
  | {
      readonly intent: "review";
      readonly label: string;
      readonly done: boolean;
      /**
       * `document_uploads.id`, the subject of the POST.
       *
       * On the action rather than left for the host to dig out of the row: the catalog is what knows
       * which of a kind's fields is the document, and a host narrowing the union itself is a second
       * opinion about that. A `document_requested` with nothing uploaded yet has no subject, so it
       * offers no review action at all rather than one that would POST to nowhere.
       */
      readonly uploadId: string;
    }
  | {
      readonly intent: "draft-reminder";
      readonly style: "quiet";
      readonly label: string;
      /** Offered to the operator in the composer. Nothing sends until they send it. */
      readonly body: string;
    };

export function isPrimaryEligible(action: TimelineAction): boolean {
  if (action.intent === "review") return !action.done;
  return action.style === "primary";
}

export interface TimelineCopy {
  readonly title: TimelineTitle;
  readonly body?: string;
}

// ---------------------------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------------------------

export interface TimelineCardSpec<Row> {
  readonly layout: TimelineLayout;
  readonly glyph: TimelineGlyph | null;
  /** The eyebrow and the screen-reader prefix. Never carried by the icon alone. */
  readonly noun: string | null;
  readonly filter: TimelineFilterId | null;
  /** Never folds into a run: it must be findable without expanding anything. */
  readonly sticky?: boolean;
  /** Adjacent same-kind bands fold into one band with a count. */
  readonly foldable?: boolean;
  /** Rendered on the utility rail with a lock. The consumer reader never emits one. */
  readonly operatorOnly?: boolean;
  /** The consumer reads this kind as a different, lower-weight entry. */
  readonly consumerAs?: TimelineCatalogKey;
  /** The release gate, in the catalog rather than in the caller. */
  readonly consumerHidden?: (row: Row) => boolean;
  /** Needs a durable history this product does not have yet (an approved change order). */
  readonly newTable?: boolean;
  readonly copy: (row: Row, audience: TimelineAudience) => TimelineCopy;
  readonly facts?: (row: Row, audience: TimelineAudience) => readonly TimelineFact[];
  readonly status?: (row: Row, audience: TimelineAudience) => TimelineStatus;
  readonly actions?: (row: Row, audience: TimelineAudience) => readonly TimelineAction[];
  /** How a fold of this kind summarises what it holds. Required when `foldable`. */
  readonly foldCopy?: (rows: readonly Row[]) => { readonly title: string; readonly body: string };
}

/** The row type each catalog key is authored against. */
type RowFor<Key extends TimelineCatalogKey> = Key extends "transition"
  ? TimelineTransitionRow
  : Key extends "document_line"
    ? DocumentFiledEvent
    : Extract<TimelineEvent, { kind: Key }>;

export type TimelineCatalog = {
  readonly [Key in TimelineCatalogKey]: TimelineCardSpec<RowFor<Key>>;
};

// ---------------------------------------------------------------------------------------------
// Small helpers the copy shares
// ---------------------------------------------------------------------------------------------

const by = (actor: string | undefined, joiner = " by ") => (actor ? `${joiner}${actor}` : "");

/** The amount, and only on a funded outcome. A declined outcome never carries one. */
const outcomeAmount = (row: ApplicationOutcomeEvent) =>
  row.kindWord === "funded" && row.amountCents !== undefined
    ? ` ${timelineMoney(row.amountCents)}`
    : "";

// ---------------------------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------------------------

export const TIMELINE_CATALOG: TimelineCatalog = {
  thread_opened: {
    filter: "stage",
    glyph: "chat",
    layout: "line",
    noun: "Conversation",
    copy: (row: ThreadOpenedEvent, audience) => ({
      title: [
        audience === "consumer"
          ? "Conversation started with your team"
          : `Conversation started with ${row.client}`,
      ],
    }),
  },

  thread_status: {
    filter: "stage",
    glyph: "chat",
    layout: "line",
    noun: "Conversation",
    sticky: true,
    copy: (row: ThreadStatusEvent, audience) => ({
      title: [
        audience === "consumer"
          ? row.to === "resolved"
            ? "Marked resolved by your team"
            : "Conversation reopened"
          : row.to === "resolved"
            ? `Marked resolved${by(row.actor)}`
            : `Reopened${by(row.actor)}`,
      ],
    }),
  },

  stage_changed: {
    filter: "stage",
    glyph: "stage",
    layout: "line",
    noun: "Stage",
    sticky: true,
    copy: (row: StageChangedEvent, audience) => ({
      title:
        audience === "consumer"
          ? ["Your stage moved to ", { strong: row.to }]
          : [`${row.client} moved to `, { strong: row.to }, by(row.actor, " · by ")],
    }),
  },

  enrollment_milestone: {
    filter: "stage",
    glyph: "shield",
    layout: "line",
    noun: "Enrollment",
    sticky: true,
    copy: (row: EnrollmentMilestoneEvent, audience) => {
      const charge = row.firstChargeOn
        ? ` · first charge dated ${timelineDate(row.firstChargeOn)}`
        : "";
      const consumer: Readonly<Record<EnrollmentMilestoneEvent["milestone"], string>> = {
        active: `Enrollment active${charge}`,
        consents: "Both authorizations signed",
        esign: "Agreement e-signed",
        idv: "Identity verified",
      };
      const operator: Readonly<Record<EnrollmentMilestoneEvent["milestone"], string>> = {
        active: `Enrollment active for ${row.client}${charge}`,
        consents: `${row.client} signed both authorizations`,
        esign: `${row.client} e-signed the agreement`,
        idv: `Identity verified for ${row.client}`,
      };
      return { title: [(audience === "consumer" ? consumer : operator)[row.milestone]] };
    },
  },

  subscription: {
    filter: "billing",
    glyph: "card",
    layout: "line",
    noun: "Subscription",
    sticky: true,
    copy: (row: SubscriptionEvent, audience) => {
      const ends = row.endsOn ? timelineDate(row.endsOn) : null;
      if (row.state === "cancelled") {
        return {
          title: [
            audience === "consumer"
              ? `Subscription cancelled${ends ? ` · access through ${ends}` : ""} · your payment records are kept`
              : `${row.client} cancelled${ends ? ` · access ends ${ends}` : ""}`,
          ],
        };
      }
      return {
        title: [
          audience === "consumer"
            ? "Monthly subscription active"
            : `Subscription active for ${row.client}`,
        ],
      };
    },
  },

  consent_revoked: {
    filter: "stage",
    glyph: "flag",
    layout: "line",
    noun: "Authorization",
    sticky: true,
    copy: (row: ConsentRevokedEvent, audience) => ({
      title: [
        audience === "consumer"
          ? `You withdrew the ${row.which} authorization · the other one is unchanged`
          : `${row.client} withdrew the ${row.which} authorization`,
      ],
    }),
  },

  assignment: {
    filter: "stage",
    glyph: "person",
    layout: "line",
    newTable: true,
    noun: "Assignment",
    operatorOnly: true,
    sticky: true,
    copy: (row: AssignmentEvent) => ({
      title: [
        "Assigned to ",
        { strong: row.to },
        row.from ? ` · was ${row.from}` : "",
        by(row.actor, " · by "),
      ],
    }),
  },

  /** Synthesized. Glyph, noun and filter are inherited from the origin kind, so they come off the row. */
  transition: {
    filter: null,
    glyph: null,
    layout: "line",
    noun: null,
    copy: (row: TimelineTransitionRow) => ({ title: [row.title] }),
  },

  /** What the consumer reads instead of `document_filed`: a line, with no review state on it. */
  document_line: {
    filter: "documents",
    glyph: "doc",
    layout: "line",
    noun: "Document",
    copy: (row: DocumentFiledEvent) => ({
      title: [`${row.name} received · your team can see it now`],
    }),
  },

  analysis_completed: {
    filter: "analysis",
    glyph: "gauge",
    layout: "band",
    noun: "Analysis",
    copy: (row: AnalysisCompletedEvent, audience) => {
      if (audience === "consumer") {
        const actionSummary = row.open === undefined
          ? "Open actions were not recorded with this analysis."
          : row.open === 0
            ? `Nothing was waiting on you as of ${timelineDate(row.at)}. Your next scheduled analysis is on your Today view.`
            : `${row.open === 1 ? "One action was" : `${row.open} actions were`} open in Optimization as of ${timelineDate(row.at)}.${
                row.superseded ? " A newer analysis is below." : " The plan explains each one."
              }`;
        return {
          body: actionSummary,
          title: ["Your analysis finished"],
        };
      }
      const previous =
        row.prev !== undefined && row.prev !== null && row.prevAt
          ? `Recorded readiness ${row.readiness}. The previous run, on ${timelineDate(row.prevAt)}, recorded ${row.prev}. `
          : "";
      return {
        body: `${previous}${openActionSentence(row.open, row.at)} Trigger: ${row.trigger}.`,
        title: [`Analysis finished for ${row.client}`],
      };
    },
    facts: (row: AnalysisCompletedEvent, audience) =>
      audience === "consumer"
        ? [
            { label: "Readiness", value: `${row.readiness} · ${timelineDate(row.at)}` },
            {
              label: "Open actions",
              value: row.open === undefined ? "Not recorded with this analysis" : `${row.open} · ${timelineDate(row.at)}`,
            },
          ]
        : [
            { label: "Readiness", value: `${row.readiness} · ${timelineDate(row.at)}` },
            {
              label: "Previous",
              value:
                row.prev === undefined || row.prev === null || !row.prevAt
                  ? "none"
                  : `${row.prev} · ${timelineDate(row.prevAt)}`,
            },
          ],
    // A superseded run drops its actions: only the newest analysis links out, so a screenshot of an
    // old band cannot send somebody to a plan that has moved on since.
    actions: (row: AnalysisCompletedEvent, audience) =>
      row.superseded
        ? []
        : audience === "consumer"
          ? [
              {
                intent: "open",
                label: "Open Optimization",
                style: "primary",
                target: { kind: "consumer-view", view: "optimization" },
              },
            ]
          : [
              { intent: "request-document", label: "Request a document", style: "primary" },
              {
                intent: "open",
                label: "Open plan",
                style: "quiet",
                target: { kind: "operator-client", section: "plan" },
              },
            ],
  },

  action: {
    filter: "analysis",
    glyph: "list",
    layout: "band",
    noun: "Action",
    copy: (row: ActionEvent, audience) => ({
      body:
        row.state === "verified"
          ? `Confirmed by the ${row.verifiedAt ? timelineDate(row.verifiedAt) : timelineDate(row.at)} analysis.`
          : row.state === "reported"
            ? audience === "consumer"
              ? "You reported it done. The next analysis will check it."
              : "Reported by the client. Nothing to do until the next analysis runs."
            : audience === "consumer"
              ? `Added by the ${timelineDate(row.at)} analysis.`
              : `Added by the ${timelineDate(row.at)} analysis. ${row.blocking ? "Blocking for Ready." : "Not blocking."}`,
      title: [
        audience === "consumer"
          ? `New action: ${row.title}`
          : `New action for ${row.client}: ${row.title}`,
      ],
    }),
    status: (row: ActionEvent) =>
      row.state === "verified"
        ? {
            label: `Verified ${row.verifiedAt ? timelineDate(row.verifiedAt) : timelineDate(row.at)}`,
            marker: "verified",
          }
        : row.state === "reported"
          ? {
              label: `Reported ${row.reportedAt ? timelineDate(row.reportedAt) : timelineDate(row.at)}`,
              marker: "reported",
            }
          : { label: "To do", marker: "todo" },
    actions: (row: ActionEvent, audience) =>
      row.state === "verified"
        ? []
        : audience === "consumer"
          ? [
              {
                intent: "open",
                label: "Open action",
                style: "primary",
                target: { item: row.title, kind: "consumer-view", view: "optimization" },
              },
            ]
          : [
              {
                intent: "open",
                label: "Open item",
                style: "quiet",
                target: { item: row.title, kind: "operator-client", section: "plan" },
              },
            ],
  },

  document_filed: {
    consumerAs: "document_line",
    filter: "documents",
    foldable: true,
    glyph: "doc",
    layout: "band",
    noun: "Document",
    copy: (row: DocumentFiledEvent) => ({
      body: row.reviewedBy ? `Reviewed by ${row.reviewedBy}.` : "Not yet reviewed.",
      title: [`${row.client} filed ${row.named}`],
    }),
    facts: (row: DocumentFiledEvent) => [{ label: "Section", value: row.section }],
    actions: (row: DocumentFiledEvent) => [
      {
        done: row.reviewedBy !== undefined,
        intent: "review",
        label: "Mark reviewed",
        uploadId: row.uploadId,
      },
      {
        intent: "open",
        label: "Open document",
        style: "quiet",
        target: { item: row.uploadId, kind: "operator-client", section: "document" },
      },
    ],
    foldCopy: (rows: readonly DocumentFiledEvent[]) => ({
      body: `${rows.map((row) => row.name).join(", ")} · ${rows.filter((row) => !row.reviewedBy).length} not yet reviewed.`,
      title: `${rows.length} documents filed`,
    }),
  },

  document_requested: {
    filter: "documents",
    glyph: "doc",
    layout: "band",
    newTable: true,
    noun: "Document",
    copy: (row: DocumentRequestedEvent, audience) =>
      audience === "consumer"
        ? { body: row.why, title: [`Your team asked for ${row.named}`] }
        : { body: `By ${row.actor}. ${row.why}`, title: [`${row.name} requested`] },
    status: (row: DocumentRequestedEvent, audience) =>
      row.fulfilledAt
        ? { label: `Sent ${timelineDate(row.fulfilledAt)}`, marker: "verified" }
        : {
            label: audience === "consumer" ? "Waiting on you" : `Waiting on ${row.client}`,
            marker: "todo",
          },
    actions: (row: DocumentRequestedEvent, audience) => {
      if (row.fulfilledAt) {
        if (audience === "consumer") return [];
        // No upload id means the request is marked fulfilled but the file it was fulfilled with is
        // not identified — nothing to review and nothing to open, so neither is offered.
        if (row.uploadId === undefined) return [];
        return [
          {
            done: row.reviewedBy !== undefined,
            intent: "review",
            label: "Mark reviewed",
            uploadId: row.uploadId,
          },
          {
            intent: "open",
            label: "Open document",
            style: "quiet",
            target: { item: row.uploadId, kind: "operator-client", section: "document" },
          },
        ];
      }
      if (audience === "consumer") {
        return [
          {
            intent: "open",
            label: "Upload",
            style: "primary",
            target: { kind: "consumer-view", view: "documents" },
          },
        ];
      }
      return [
        {
          body: `When you have a minute, the ${row.name.toLowerCase()} from the ${timelineDate(row.at)} request is still needed.`,
          intent: "draft-reminder",
          label: "Draft a reminder",
          style: "quiet",
        },
      ];
    },
  },

  refresh: {
    filter: "analysis",
    glyph: "refresh",
    layout: "band",
    noun: "Refresh",
    copy: (row: RefreshEvent, audience) =>
      audience === "consumer"
        ? {
            body: row.completedAt
              ? "Your plan and readiness reflect the new pull."
              : "You will see the result here when it finishes.",
            title: ["Credit refresh purchased"],
          }
        : {
            body: row.completedAt
              ? `Analysis finished ${timelineTime(row.completedAt)}.`
              : "Analysis queued.",
            title: [`${row.client} purchased a refresh`],
          },
    facts: (row: RefreshEvent) =>
      row.completedAt && row.readiness !== undefined
        ? [
            { label: "Readiness", value: `${row.readiness} · ${timelineDate(row.completedAt)}` },
            { label: "Paid", value: timelineMoney(row.amountCents) },
          ]
        : [{ label: "Paid", value: timelineMoney(row.amountCents) }],
    status: (row: RefreshEvent) =>
      row.completedAt
        ? { label: `Complete ${timelineTime(row.completedAt)}`, marker: "verified" }
        : { label: "Analyzing", marker: "verifying" },
    actions: (row: RefreshEvent, audience) =>
      row.completedAt
        ? audience === "consumer"
          ? [
              {
                intent: "open",
                label: "Open Optimization",
                style: "primary",
                target: { kind: "consumer-view", view: "optimization" },
              },
            ]
          : [
              {
                intent: "open",
                label: "Open plan",
                style: "quiet",
                target: { kind: "operator-client", section: "plan" },
              },
            ]
        : [],
  },

  refresh_blocked: {
    filter: "analysis",
    glyph: "refresh",
    layout: "band",
    noun: "Refresh",
    operatorOnly: true,
    copy: (row: RefreshBlockedEvent) => ({
      body: `The plan's monthly refresh allowance is used. It resets ${timelineDate(row.resetsOn)}; the last completed analysis still stands.`,
      title: [`Refresh unavailable for ${row.client}`],
    }),
    facts: (row: RefreshBlockedEvent) => [
      {
        label: "Last readiness",
        value: `${row.lastReadiness} · ${timelineDate(row.lastRunAt)}`,
      },
    ],
    status: (row: RefreshBlockedEvent) => ({
      label: `Paused · resets ${timelineDate(row.resetsOn)}`,
      marker: "paused",
    }),
    // Never a dead end: the operator can see why the allowance is spent and when it resets.
    actions: () => [
      {
        intent: "open",
        label: "Open plan caps",
        style: "quiet",
        target: { kind: "operator-client", section: "plan-caps" },
      },
    ],
  },

  fee_payment: {
    filter: "billing",
    glyph: "bank",
    layout: "band",
    noun: "Payment",
    copy: (row: FeePaymentEvent, audience) =>
      audience === "consumer"
        ? {
            body: `Received ${timelineDate(row.receivedOn)} by ${row.method}.`,
            title: [`Payment received · ${timelineMoney(row.amountCents)}`],
          }
        : {
            body: `${row.method}, recorded by ${row.actor}.`,
            title: [
              `Payment received from ${row.client} · ${timelineMoney(row.amountCents)}`,
            ],
          },
    // The balance is an operator fact and the consumer projection has no field for it. Both halves
    // are enforced: the reader omits it, and this branch never asks for it.
    facts: (row: FeePaymentEvent, audience) =>
      audience === "consumer"
        ? [{ label: "Method", value: row.method }]
        : [
            { label: "Received", value: timelineDate(row.receivedOn) },
            ...(row.balanceCents === undefined
              ? []
              : [{ label: "Balance", value: timelineMoney(row.balanceCents) }]),
            { label: "Method", value: row.method },
          ],
    actions: (row: FeePaymentEvent, audience) =>
      audience === "consumer"
        ? []
        : [
            {
              intent: "open",
              label: "Open fees",
              style: "quiet",
              target: { kind: "operator-client", section: "fees" },
            },
          ],
  },

  application_outcome: {
    consumerHidden: (row: ApplicationOutcomeEvent) => !row.releasedOn,
    filter: "billing",
    glyph: "bank",
    layout: "band",
    noun: "Outcome",
    copy: (row: ApplicationOutcomeEvent, audience) => {
      const amount = outcomeAmount(row);
      return audience === "consumer"
        ? {
            body: `${row.bank}, decided ${timelineDate(row.decidedOn)}.`,
            title: [`Outcome recorded: ${row.kindWord}${amount}`],
          }
        : {
            body: `${row.bank} · ${row.kindWord}${amount} · decided ${timelineDate(row.decidedOn)}. ${
              row.releasedOn
                ? `Released to ${row.client} ${timelineDate(row.releasedOn)}.`
                : "Not yet reviewed; the client cannot see it."
            }`,
            title: [`Outcome recorded for ${row.client}`],
          };
    },
    facts: (row: ApplicationOutcomeEvent, audience) =>
      audience === "consumer"
        ? [{ label: "Lender", value: row.bank }]
        : [
            { label: "Lender", value: row.bank },
            { label: "Review", value: row.releasedOn ? "Reviewed" : "Not reviewed" },
          ],
    actions: (row: ApplicationOutcomeEvent, audience) =>
      audience === "consumer"
        ? []
        : row.releasedOn
          ? [
              {
                intent: "open",
                label: "Open application",
                style: "quiet",
                target: { item: row.bank, kind: "operator-client", section: "applications" },
              },
            ]
          : [
              {
                intent: "open",
                label: "Review outcome",
                style: "primary",
                target: { item: row.bank, kind: "operator-client", section: "applications" },
              },
            ],
  },
};

// ---------------------------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------------------------

/**
 * The one place the per-kind authoring types are erased.
 *
 * Each entry above is written against its own event, which is what makes a typo in a payload field
 * a compile error rather than `undefined` in a sentence. Reading the table back out means a
 * function typed for one row is called with the union, so the cast lives here, once, rather than at
 * every call site — and `catalog.test.ts` walks every key with a matching row so the erasure is
 * checked at run time instead of trusted.
 */
export function specFor(key: TimelineCatalogKey): TimelineCardSpec<TimelineRow> {
  return TIMELINE_CATALOG[key] as unknown as TimelineCardSpec<TimelineRow>;
}

/** The spec a given audience actually reads a row through, or `null` when they never see it. */
export function effectiveSpec(
  row: TimelineRow,
  audience: TimelineAudience,
): TimelineCardSpec<TimelineRow> | null {
  const spec = specFor(row.kind);
  if (audience === "consumer") {
    if (spec.operatorOnly) return null;
    if (spec.consumerHidden?.(row)) return null;
    if (spec.consumerAs) return specFor(spec.consumerAs);
  }
  return spec;
}

/** The glyph a row renders with: its own when it carries one, otherwise its kind's. */
export function glyphFor(row: TimelineRow, spec: TimelineCardSpec<TimelineRow>): TimelineGlyph {
  if (row.kind === "transition") return row.glyph;
  return spec.glyph ?? "chat";
}

/** The noun a row renders with, and what a screen reader hears before its title. */
export function nounFor(row: TimelineRow, spec: TimelineCardSpec<TimelineRow>): string {
  if (row.kind === "transition") return row.noun;
  return spec.noun ?? "Update";
}

/** Which filter chip a row answers to. */
export function filterFor(
  row: TimelineRow,
  spec: TimelineCardSpec<TimelineRow>,
): TimelineFilterId | null {
  if (row.kind === "transition") return row.filterAs;
  return spec.filter;
}

export { capitalize };
