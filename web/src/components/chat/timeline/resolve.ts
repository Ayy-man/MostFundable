/**
 * One row, resolved through the catalog into exactly what a renderer draws.
 *
 * The split between this and the components is the point of the whole module. Everything that could
 * be wrong about a row — which audience sees it, what it says, which marker it wears, whether it
 * carries the one filled action — is decided here, in a plain function over plain data, and is
 * therefore testable without a DOM. What is left in the `.tsx` files is elements and tokens.
 *
 * `null` means this audience never sees this row: an operator-only kind on the consumer side, or an
 * outcome that has not been released. The reader in `lib/timeline/` already refuses to send either
 * one, and this refuses to draw it anyway.
 */

import type { TimelineAudience } from "@/lib/timeline/types";

import {
  effectiveSpec,
  filterFor,
  glyphFor,
  nounFor,
  type TimelineAction,
  type TimelineFact,
  type TimelineFilterId,
  type TimelineGlyph,
  type TimelineRow,
  type TimelineStatus,
  type TimelineTitle,
} from "./catalog";

/** What every resolved row carries, whichever layout it takes. */
interface ResolvedCommon {
  readonly noun: string;
  readonly glyph: TimelineGlyph;
  readonly title: TimelineTitle;
  readonly at: string;
  readonly filter: TimelineFilterId | null;
  /** True only on the operator side: the consumer never receives one of these at all. */
  readonly operatorOnly: boolean;
  /** Never folds into a run. */
  readonly sticky: boolean;
}

export interface ResolvedLine extends ResolvedCommon {
  readonly layout: "line";
}

export interface ResolvedBand extends ResolvedCommon {
  readonly layout: "band";
  readonly body?: string;
  readonly facts: readonly TimelineFact[];
  readonly status: TimelineStatus | null;
  readonly actions: readonly TimelineAction[];
  /** This is the one band in the thread whose eligible action is filled. */
  readonly primary: boolean;
  /** Adjacent same-kind bands may fold together. */
  readonly foldable: boolean;
}

export type ResolvedRow = ResolvedLine | ResolvedBand;

export function resolveRow(
  row: TimelineRow,
  audience: TimelineAudience,
  options: {
    readonly primary?: boolean;
    /**
     * Uploads a review has already been recorded for in this session.
     *
     * An overlay, not a source: the durable `reviewedBy` is what the catalog reads, and this only
     * covers the gap between a route answering `ok` and the next read returning the field. Applied
     * here rather than in the component so the plan — and therefore every test — sees the same
     * state the reader does.
     */
    readonly reviewedUploadIds?: readonly string[];
  } = {},
): ResolvedRow | null {
  const spec = effectiveSpec(row, audience);
  if (spec === null) return null;

  const operatorOnly = spec.operatorOnly === true && audience === "operator";
  const common: ResolvedCommon = {
    at: row.at,
    filter: filterFor(row, spec),
    glyph: glyphFor(row, spec),
    noun: nounFor(row, spec),
    operatorOnly,
    // Anything operator-only is sticky whether or not its entry says so: a row the client cannot
    // see is one the operator must be able to find without expanding a disclosure.
    sticky: spec.sticky === true || spec.operatorOnly === true,
    title: spec.copy(row, audience).title,
  };

  if (spec.layout === "line") return { ...common, layout: "line" };

  const copy = spec.copy(row, audience);
  const reviewed = new Set(options.reviewedUploadIds ?? []);
  return {
    ...common,
    ...(copy.body === undefined ? {} : { body: copy.body }),
    actions: (spec.actions?.(row, audience) ?? []).map((action) =>
      action.intent === "review" && reviewed.has(action.uploadId)
        ? { ...action, done: true }
        : action,
    ),
    facts: spec.facts?.(row, audience) ?? [],
    foldable: spec.foldable === true && audience === "operator",
    layout: "band",
    primary: options.primary === true,
    status: spec.status?.(row, audience) ?? null,
  };
}
