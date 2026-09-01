// The conversation timeline. One entry point, for the same reason `components/chat/index.ts` is
// one entry point: two surfaces render these rows and neither of them gets a private opinion about
// what a stage move says to a client.
//
// Everything that decides anything is a plain module — the catalog, the transition expansion, the
// primary target, the render plan. The `.tsx` files draw what those decided and nothing else.

export {
  TIMELINE_CATALOG,
  effectiveSpec,
  filterFor,
  glyphFor,
  isPrimaryEligible,
  nounFor,
  specFor,
  titleText,
  type TimelineAction,
  type TimelineCardSpec,
  type TimelineCatalogKey,
  type TimelineFact,
  type TimelineFilterId,
  type TimelineGlyph,
  type TimelineLayout,
  type TimelineMarker,
  type TimelineRow,
  type TimelineStatus,
  type TimelineTarget,
  type TimelineTitle,
  type TimelineTransitionRow,
} from "./catalog";
export { TimelineNewSinceDivider, TimelineReadFailedLine } from "./dividers";
export { TimelineEventBand, type TimelineActionHandlers } from "./event-band";
export { TimelineEventFold } from "./event-fold";
export { TimelineEventLine } from "./event-line";
export { TimelineEventRun } from "./event-run";
export { expandTransitions } from "./expand-transitions";
export {
  FIXTURE_BRAND,
  FIXTURE_EVENTS,
  FIXTURE_NEW_SINCE,
  timelineDenseFixture,
  timelineFixture,
  timelineFreshFixture,
  timelineSparseFixture,
  timelineUpdatedFixture,
  type TimelineFixtureOptions,
} from "./fixture";
export {
  capitalize,
  isDateOnly,
  openActionSentence,
  timelineDate,
  timelineMoney,
  timelineTime,
} from "./format";
export { TIMELINE_GLYPHS } from "./glyphs";
export { timelineThreadItems } from "./items";
export { TIMELINE_FLAG, timelineFlagEnabled } from "./flag";
export {
  groupTimeline,
  type TimelineBandEntry,
  type TimelineBlock,
  type TimelineFilter,
  type TimelineGroupOptions,
  type TimelineLineEntry,
  type TimelineThreadPlan,
} from "./group";
export { primaryTarget } from "./primary-target";
export { resolveRow, type ResolvedBand, type ResolvedLine, type ResolvedRow } from "./resolve";
export { requestDocument, reviewDocument, type TimelineRequestResult } from "./requests";
