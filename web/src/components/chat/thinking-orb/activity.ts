/**
 * The only way to get an orb on screen.
 *
 * An orb says the machine is thinking. That claim is either true or the interface is lying, and
 * the way it usually turns into a lie is boring: someone renders one over a `GET`, or hardcodes
 * "Reviewing against policy" next to a spinner on a timer, and now a wait that is a network round
 * trip is dressed up as deliberation.
 *
 * So `<ThinkingOrb>` does not take a label. It takes an `OrbActivity`, and an `OrbActivity` can
 * only be produced by `orbActivity()` from one of the five sources the contract allows — the type
 * is branded, so a string literal or an object literal will not typecheck no matter how it is
 * shaped. And `orbActivity()` returns `null` whenever the source is not actually working, which
 * makes the honest thing (render nothing) the path of least resistance and the dishonest thing
 * (an orb over a finished job) unreachable rather than discouraged.
 *
 * A data fetch gets `PaneState` with a skeleton. That is not a lesser treatment; it is the true
 * one.
 */

import type { OrbState } from "./geometry";

declare const truthful: unique symbol;

/**
 * A live claim that some named work is in flight, with the words to say so.
 *
 * Branded on purpose. The brand is not exported and cannot be constructed, so this type is
 * reachable only through `orbActivity`.
 */
export interface OrbActivity {
  readonly [truthful]: true;
  /** What to tell the reader, and what a screen reader announces. */
  readonly label: string;
  readonly state: OrbState;
}

/** A run the platform actually tracks. Matches the job vocabulary the API returns. */
export type OrbJobStatus = "queued" | "running" | "complete" | "failed" | "canceled";

/**
 * The five places an orb is allowed, each carrying the live state that justifies it.
 *
 * Every member requires the caller to hand over something that changes on its own. There is no
 * member that takes only a label, because that member is the one that would get used everywhere.
 */
export type OrbSource =
  /** The assistant's server stage stream. Open means a stage is genuinely arriving. */
  | { readonly kind: "assistant"; readonly stage: string | null; readonly streamOpen: boolean }
  /** The supervisor check, which is a different wait and says so. */
  | { readonly kind: "supervisor"; readonly checking: boolean }
  /** Held-draft generation, while `POST …/draft` is out. */
  | { readonly kind: "held_draft"; readonly inFlight: boolean }
  /** The consumer analysis run, straight off the job row. */
  | { readonly kind: "analysis"; readonly status: OrbJobStatus }
  /** The paid refresh job, straight off the job row. */
  | { readonly kind: "paid_refresh"; readonly status: OrbJobStatus };

function activity(state: OrbState, label: string): OrbActivity {
  return { label, state } as OrbActivity;
}

/**
 * An activity, or `null` when nothing is happening.
 *
 * `null` is the common answer and the caller renders nothing. Every branch that returns an
 * activity is reading a value the caller could not have made up.
 */
export function orbActivity(source: OrbSource): OrbActivity | null {
  switch (source.kind) {
    case "assistant":
      if (!source.streamOpen) return null;
      // The stage text comes off the stream. Without one the orb still tells the truth, just less
      // of it — never a fixed sentence standing in for a stage that never arrived.
      return activity("running", source.stage ?? "Working on your answer");
    case "supervisor":
      // Allowed only while the call is genuinely out, which is the whole reason this wording is
      // safe to show at all.
      return source.checking ? activity("reviewing", "Reviewing against policy") : null;
    case "held_draft":
      return source.inFlight ? activity("running", "Drafting a reply for your review") : null;
    case "analysis":
      if (source.status === "queued") return activity("queued", "Your review is queued");
      if (source.status === "running") return activity("running", "Reviewing your report");
      return null;
    case "paid_refresh":
      return source.status === "running" ? activity("running", "Refreshing your report") : null;
  }
}
