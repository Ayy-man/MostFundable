/**
 * What the consumer Team Chat is handed, and the shapes it builds from it.
 *
 * The one prop worth arguing about is `teamChat`, which has three meanings and not two.
 *
 *   `undefined`   nothing read it. Only `components/demo/demo-app.tsx` mounts `<ConsumerSurface>`
 *                 without it, and that mount is the fixture shell behind the demo-environment bar.
 *                 This is the only branch that may render a written conversation nobody sent.
 *   `null`        the server tried and had nothing to hand over — see `readConsumerTeamChat`'s
 *                 header. A transient failure, a session that is not a consumer, a tenancy
 *                 refusal. The client bootstrap takes over, which is what it is still there for,
 *                 and first paint shows a skeleton rather than an error.
 *   a snapshot    `disabled` or `ready`, both durable answers.
 *
 * `optional` is forced by that first case rather than chosen: `demo-app.tsx` belongs to no lane in
 * this operation and cannot be edited to pass the prop, so the type has to admit its absence.
 * `mount.test.ts` beside this file is what stops that becoming a hole under real auth —
 * it reads the real-auth page and its client and asserts the value is passed there, so `undefined`
 * stays unreachable on the surface where rail 5 applies.
 */

import type { ConsumerTeamChatSnapshot } from "@/lib/support";
import type { TimelineRead } from "@/lib/timeline/types";

export interface ConsumerTeamChatProps {
  /** Whether analysis authorization is live. Decides which fixture conversation the demo shows. */
  readonly analysisActive: boolean;
  /** Whether the consumer has cancelled. Same, and it changes what the rail may claim. */
  readonly canceled: boolean;
  /** The surface's toast. Used for send outcomes, never for anything a pane can say itself. */
  readonly notify: (message: string) => void;
  /**
   * The operator's brand, resolved by the surface from the signed-in consumer's own org.
   *
   * Passed rather than re-derived. `ConsumerSurface` already computes this and a previous defect
   * came from a second opinion about it reaching a signed-in client under a stranger's name; two
   * expressions for one white-label fact is how that happens again.
   */
  readonly operatorName: string;
  /** See the header. Three meanings, and `undefined` is one of them. */
  readonly teamChat?: ConsumerTeamChatSnapshot | null;
  /**
   * `FEATURE_TIMELINE`, resolved on the server and passed down. Off is the shipped thread.
   */
  readonly timelineEnabled?: boolean;
  /**
   * The thread's events, when the read path has them.
   *
   * Absent is not "no events" dressed up as an empty list — it is the read path not returning them
   * yet, and the difference matters: a durable thread renders its real messages and no event rows
   * rather than inventing any. Nothing in this view may put a system row in a signed-in client's
   * thread that no producer wrote, which is the same rail that keeps fixture *messages* out of it.
   */
  readonly timeline?: TimelineRead;
  /**
   * How this view opens another one, supplied by the surface that owns the view state.
   *
   * A timeline band's deep link is a navigation, not an href — the consumer surface is a single page.
   * When it is absent the timeline is not rendered at all, because a band whose one action does
   * nothing is worse than a band with no action.
   */
  readonly navigate?: (view: "optimization" | "documents") => void;
}

/**
 * The client's own snapshot, as the context rail and the suggestion chips read it.
 *
 * Every field is durable or absent. There is no member here that a fixture can fill, which is the
 * point: the defect being fixed is a suggestion chip that named a refresh date nothing held, and
 * the way to make that unrepresentable is to give the chips no source but this.
 */
export interface ConsumerClientSnapshot {
  /** The six-stage taxonomy label, resolved through `TRACKER_STAGE_LABELS`. */
  readonly stageLabel: string;
  /** Verified readiness, or null when no analysis has completed. */
  readonly readiness: number | null;
  /** When the readiness above was observed. Null means there is no snapshot to date. */
  readonly analysisAt: string | null;
  /** A run in flight right now, straight off the job row. Null when nothing is running. */
  readonly analysisPending: "queued" | "running" | null;
  readonly openActionCount: number | null;
  readonly nextRefreshAt: string | null;
  readonly monitoring: "active" | "paused" | "pending";
  /** The team member this client is assigned to, when one is. A name, never an id. */
  readonly assignedToName: string | null;
}

/** What the rail read can be. `disabled` is the tracker flag being off, not an empty workspace. */
export type ConsumerClientSnapshotResult =
  | { readonly state: "disabled" }
  | { readonly state: "none" }
  | { readonly state: "ready"; readonly snapshot: ConsumerClientSnapshot };
