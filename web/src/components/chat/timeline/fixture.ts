/**
 * The approved mockup's thread, as data.
 *
 * Two jobs, and they are the same job. Until the read path returns `timeline` on the thread payload
 * this is what the wiring builds against, so the surfaces are exercised in the shape they will run
 * in rather than in a shape invented for a demo. And it is what `timeline.states.test.ts` renders,
 * so every assertion about folding, projection and the one filled action is made against the fixture
 * the mockup was roasted on rather than against a minimal case written to pass.
 *
 * Every date, amount and sentence is the mockup's. The persona reconciles with the seed — Devon Derog
 * Demo at Lighthouse Ledger Fictional Works, Optimization stage, assigned to Priya at Northbridge
 * Funding Group — and the dense thread is a *second* client on purpose, so Devon's history exists
 * once and a test cannot accidentally assert against two versions of it.
 *
 * Nothing here is a bureau value, and nothing here implies data collected before consent or a charge
 * before enrollment: the enrollment milestones precede the first charge date, which is the ordering
 * the seed rules require of every surface.
 */

import type { TimelineEvent } from "@/lib/timeline/types";

import type { ChatMessage, ChatThreadItem } from "../types";
import { capitalize } from "./format";
import { timelineThreadItems } from "./items";

const CLIENT = "Devon";

/** The brand a consumer reads a team message under. Never a guessed person (`thread-model.ts`). */
export const FIXTURE_BRAND = "Northbridge Funding Group";

export interface TimelineFixtureOptions {
  readonly audience: "consumer" | "operator";
  /** The workspace brand, as the surface already resolved it. */
  readonly brandName?: string;
}

interface FixtureMessage {
  readonly at: string;
  readonly from: "consumer" | "operator";
  readonly name: string;
  readonly body: string;
  readonly internal?: boolean;
  readonly read?: boolean;
}

function messageItem(
  message: FixtureMessage,
  index: number,
  { audience, brandName = FIXTURE_BRAND }: TimelineFixtureOptions,
): ChatThreadItem[] {
  // An internal note never leaves the operator side. RLS is what enforces that in the product; the
  // fixture refuses it too, so a fixture cannot be the thing that shows a client a team note.
  if (message.internal && audience === "consumer") return [];
  const own = message.from === audience;
  const name = own ? "You" : audience === "consumer" ? brandName : message.name;
  return [
    {
      message: {
        author: {
          kind: message.from,
          name,
          ...(own ? {} : { roleLabel: audience === "consumer" ? "All Team" : "Client" }),
        },
        body: message.body,
        delivery: own && message.read ? "read" : "delivered",
        origin: "human",
        ref: `fixture-message-${index}`,
        sentAt: message.at,
        visibility: message.internal ? "internal" : "participants",
      } satisfies ChatMessage,
      type: "message",
    },
  ];
}

const MESSAGES: readonly FixtureMessage[] = [
  {
    at: "2026-08-01T09:06:00Z",
    body: "Morning Devon. Your optimization checklist is up on your Today view now. Work through it in whatever order suits you, and ask me here if any item is unclear.",
    from: "operator",
    name: "Priya",
  },
  {
    at: "2026-08-15T10:12:00Z",
    body: "Got it. What is the utilization one asking for exactly?",
    from: "consumer",
    name: "Devon",
    read: true,
  },
  {
    at: "2026-08-15T10:30:00Z",
    body: "Keep each revolving balance under 30% of its limit before the next analysis runs. The card explains which accounts count.",
    from: "operator",
    name: "Priya",
  },
  {
    at: "2026-08-15T10:31:00Z",
    body: "Devon asked about the two older accounts. Keeping the reply to what the checklist itself says and taking the rest to the plan review on Thursday.",
    from: "operator",
    internal: true,
    name: "Priya",
  },
  {
    at: "2026-08-22T09:19:00Z",
    body: "Did the new analysis pick up the statement I sent this morning?",
    from: "consumer",
    name: "Devon",
    read: true,
  },
  {
    at: "2026-08-22T09:24:00Z",
    body: "Yes. Utilization is verified now and the business profile item is the only one still open. I will look at the statement today.",
    from: "operator",
    name: "Priya",
    read: true,
  },
  {
    at: "2026-08-24T14:12:00Z",
    body: "Anything else you need from me before Thursday?",
    from: "consumer",
    name: "Devon",
  },
];

/** The mockup's `EVENTS`, in its order. `ref` is this module's own handle and is never rendered. */
export const FIXTURE_EVENTS: readonly TimelineEvent[] = [
  { at: "2026-08-01T09:05:00Z", client: CLIENT, kind: "thread_opened", ref: "fx-opened" },
  {
    at: "2026-08-01T09:40:00Z",
    client: CLIENT,
    kind: "enrollment_milestone",
    milestone: "idv",
    ref: "fx-idv",
  },
  {
    at: "2026-08-01T09:41:00Z",
    client: CLIENT,
    firstChargeOn: "2026-08-01",
    kind: "enrollment_milestone",
    milestone: "active",
    ref: "fx-active",
  },
  {
    at: "2026-08-15T09:00:00Z",
    client: CLIENT,
    kind: "analysis_completed",
    open: 2,
    readiness: 84,
    ref: "fx-analysis-1",
    superseded: true,
    trigger: "scheduled",
  },
  {
    actor: "Priya",
    at: "2026-08-15T09:03:00Z",
    client: CLIENT,
    from: "Onboarding",
    kind: "stage_changed",
    ref: "fx-stage",
    to: "Optimization",
  },
  {
    at: "2026-08-15T09:00:30Z",
    blocking: true,
    client: CLIENT,
    kind: "action",
    ref: "fx-action",
    reportedAt: "2026-08-19T11:00:00Z",
    state: "verified",
    title: "Utilization under 30%",
    verifiedAt: "2026-08-22T09:01:00Z",
  },
  {
    actor: "Priya",
    at: "2026-08-20T15:10:00Z",
    client: CLIENT,
    fulfilledAt: "2026-08-22T08:58:00Z",
    kind: "document_requested",
    name: "Bank statement",
    named: "a bank statement",
    ref: "fx-requested",
    requestId: "fx-request-1",
    uploadId: "fx-upload-1",
    why: "The last three months, so the business profile item can be verified.",
  },
  {
    actor: "Avery",
    amountCents: 50000,
    at: "2026-08-20T16:00:00Z",
    balanceCents: 150000,
    client: CLIENT,
    kind: "fee_payment",
    method: "ACH",
    receivedOn: "2026-08-20",
    ref: "fx-payment",
  },
  {
    at: "2026-08-22T09:01:00Z",
    client: CLIENT,
    kind: "analysis_completed",
    open: 1,
    prev: 84,
    prevAt: "2026-08-15T09:00:00Z",
    readiness: 92,
    ref: "fx-analysis-2",
    trigger: "scheduled",
  },
  {
    actor: "Avery",
    at: "2026-08-23T13:00:00Z",
    client: CLIENT,
    from: "Avery",
    kind: "assignment",
    operatorOnly: true,
    ref: "fx-assignment",
    to: "Priya",
  },
  {
    at: "2026-08-23T13:20:00Z",
    client: CLIENT,
    kind: "refresh_blocked",
    lastReadiness: 92,
    lastRunAt: "2026-08-22T09:01:00Z",
    operatorOnly: true,
    ref: "fx-blocked",
    resetsOn: "2026-09-01",
  },
];

/** When the operator last read this thread, for the new-since divider. The mockup's value. */
export const FIXTURE_NEW_SINCE = "2026-08-23T00:00:00Z";

function eventItem(event: TimelineEvent): ChatThreadItem {
  return timelineThreadItems([event])[0];
}

/** The duo thread from section 1 of the mockup: seven messages and eleven events. */
export function timelineFixture(options: TimelineFixtureOptions): ChatThreadItem[] {
  return [
    ...MESSAGES.flatMap((message, index) => messageItem(message, index, options)),
    ...FIXTURE_EVENTS.map(eventItem),
  ];
}

/** A fresh thread: the welcome message and the origin line, nothing else. */
export function timelineFreshFixture(options: TimelineFixtureOptions): ChatThreadItem[] {
  return [
    ...messageItem(
      {
        at: "2026-08-24T09:06:00Z",
        body: "Welcome, Taylor. This thread is where you and your team talk through your plan, so anything you want to ask can go here.",
        from: "operator",
        name: "Priya",
      },
      0,
      options,
    ),
    eventItem({
      at: "2026-08-24T09:05:00Z",
      client: "Taylor",
      kind: "thread_opened",
      ref: "fresh-opened",
    }),
  ];
}

/** One card between two messages: the sparse case. */
export function timelineSparseFixture(options: TimelineFixtureOptions): ChatThreadItem[] {
  return [
    ...messageItem(
      {
        at: "2026-08-20T15:00:00Z",
        body: "I need one more thing for the business profile item.",
        from: "operator",
        name: "Priya",
      },
      0,
      options,
    ),
    eventItem({
      actor: "Priya",
      at: "2026-08-20T15:10:00Z",
      client: CLIENT,
      kind: "document_requested",
      name: "Bank statement",
      named: "a bank statement",
      ref: "sparse-requested",
      requestId: "sparse-request-1",
      why: "The last three months, so the business profile item can be verified.",
    }),
    eventItem({
      at: "2026-08-20T15:11:00Z",
      blocking: false,
      client: CLIENT,
      kind: "action",
      ref: "sparse-action",
      state: "todo",
      title: "Business profile readiness",
    }),
  ];
}

/** The same thread with both states advanced, for the updated-in-place case. */
export function timelineUpdatedFixture(options: TimelineFixtureOptions): ChatThreadItem[] {
  return timelineSparseFixture(options).map((item) => {
    if (item.type !== "event" || item.timeline === undefined) return item;
    if (item.timeline.kind === "document_requested") {
      return eventItem({ ...item.timeline, fulfilledAt: "2026-08-22T08:58:00Z" });
    }
    if (item.timeline.kind === "action") {
      return eventItem({
        ...item.timeline,
        state: "verified",
        verifiedAt: "2026-08-22T09:01:00Z",
      });
    }
    return item;
  });
}

const DENSE_CLIENT = "Casey";
const DENSE_ITEMS = ["Utilization under 30%", "Business profile readiness", "Account mix readiness"];
const DENSE_DOCS = ["bank statement", "articles of organization", "lease agreement"];

const at = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 7, day, hour, minute)).toISOString();

/**
 * Ten days of a second client's history: the noise runs and folds exist to absorb.
 *
 * One coherent chain rather than random rows — stages advance once through the taxonomy, milestones
 * fire once, the Aug-18 paid refresh recorded 85 and the Aug-19 run names it as the previous run. A
 * dense fixture whose numbers contradict each other cannot be read to check anything.
 */
export function timelineDenseFixture(options: TimelineFixtureOptions): ChatThreadItem[] {
  const events: TimelineEvent[] = [
    { at: at(12, 9), client: DENSE_CLIENT, kind: "thread_opened", ref: "d-opened" },
    {
      at: at(12, 9),
      client: DENSE_CLIENT,
      kind: "enrollment_milestone",
      milestone: "consents",
      ref: "d-consents",
    },
    {
      at: at(12, 10),
      client: DENSE_CLIENT,
      kind: "enrollment_milestone",
      milestone: "esign",
      ref: "d-esign",
    },
    {
      at: at(12, 11),
      client: DENSE_CLIENT,
      kind: "enrollment_milestone",
      milestone: "idv",
      ref: "d-idv",
    },
    {
      at: at(12, 12),
      client: DENSE_CLIENT,
      firstChargeOn: "2026-08-12",
      kind: "enrollment_milestone",
      milestone: "active",
      ref: "d-active",
    },
  ];
  const messages: FixtureMessage[] = [
    {
      at: at(12, 9, 10),
      body: "Welcome aboard. Everything we need from you will show up here as it happens.",
      from: "operator",
      name: "Priya",
    },
  ];

  // The origins sit on day 12, the day the workspace was set up, and each one closes on a later day.
  // That is what produces the adjacent transition lines a run exists to absorb: the origin band stays
  // where it was opened, and every change is its own row at the instant it happened.
  for (let day = 13; day <= 21; day += 1) {
    const index = day - 13;
    events.push({
      at: at(12, 10, index),
      blocking: false,
      client: DENSE_CLIENT,
      kind: "action",
      ref: `d-action-${day}`,
      reportedAt: at(day - 1, 16),
      state: "verified",
      title: DENSE_ITEMS[index % 3],
      verifiedAt: at(day, 12),
    });
    events.push({
      actor: "Priya",
      at: at(12, 11, index),
      client: DENSE_CLIENT,
      fulfilledAt: at(day, 13),
      kind: "document_requested",
      name: capitalize(DENSE_DOCS[index % 3]),
      named: `${DENSE_DOCS[index % 3][0] === "a" ? "the " : "a "}${DENSE_DOCS[index % 3]}`,
      ref: `d-request-${day}`,
      requestId: `d-request-id-${day}`,
      reviewedBy: "Priya",
      uploadId: `d-request-upload-${day}`,
      why: "The last three months, so the business profile item can be verified.",
    });
  }

  for (let day = 13; day <= 21; day += 1) {
    const index = day - 13;
    const first = DENSE_DOCS[index % 3];
    const second = DENSE_DOCS[(index + 1) % 3];
    events.push({
      at: at(day, 9),
      client: DENSE_CLIENT,
      kind: "document_filed",
      name: capitalize(first),
      named: `${first[0] === "a" ? "the " : "a "}${first}`,
      ref: `d-doc-a-${day}`,
      section: "Business profile",
      uploadId: `d-upload-a-${day}`,
    });
    events.push({
      at: at(day, 9, 20),
      client: DENSE_CLIENT,
      kind: "document_filed",
      name: capitalize(second),
      named: `${second[0] === "a" ? "the " : "a "}${second}`,
      ref: `d-doc-b-${day}`,
      section: "Business profile",
      uploadId: `d-upload-b-${day}`,
      ...(index % 2 ? { reviewedBy: "Priya" } : {}),
    });
    messages.push({
      at: at(day, 10),
      body: index % 2 ? "Sent the next one over." : "Seen, thank you. I will confirm once the analysis runs.",
      from: index % 2 ? "consumer" : "operator",
      name: index % 2 ? DENSE_CLIENT : "Priya",
    });
    if (day % 3 === 1) {
      events.push({
        at: at(day, 14),
        client: DENSE_CLIENT,
        kind: "analysis_completed",
        open: 2,
        readiness: 80 + index,
        ref: `d-analysis-${day}`,
        trigger: "scheduled",
        ...(day === 19
          ? { prev: 85, prevAt: at(18, 11, 30) }
          : index
            ? { prev: 80 + index - 3, prevAt: at(day - 3, 14) }
            : {}),
      });
    }
  }

  events.push({
    amountCents: 2900,
    at: at(18, 11),
    client: DENSE_CLIENT,
    completedAt: at(18, 11, 30),
    kind: "refresh",
    readiness: 85,
    ref: "d-refresh",
  });
  events.push({
    actor: "Priya",
    at: at(21, 15),
    client: DENSE_CLIENT,
    from: "Optimization",
    kind: "stage_changed",
    ref: "d-stage",
    to: "Ready",
  });
  events.push({
    at: at(21, 15, 30),
    client: DENSE_CLIENT,
    kind: "subscription",
    ref: "d-subscription",
    state: "active",
  });
  events.push({
    at: at(21, 15, 40),
    client: DENSE_CLIENT,
    kind: "consent_revoked",
    ref: "d-consent",
    which: "monitoring",
  });
  events.push({
    actor: "Priya",
    at: at(21, 16),
    client: DENSE_CLIENT,
    kind: "thread_status",
    ref: "d-status",
    to: "resolved",
  });

  return [
    ...messages.flatMap((message, index) => messageItem(message, index, options)),
    ...events.map(eventItem),
  ];
}
