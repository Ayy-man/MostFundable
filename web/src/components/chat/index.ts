// The shared chat foundation. Lanes 2, 3 and 4 import from here and nowhere deeper.
//
// One entry point, so the four views cannot each acquire a private variant of a message bubble.
// The AI Elements underneath (`components/ai-elements/`) are an implementation detail of these
// components; a surface that needs one directly should ask rather than reach past this file,
// because the tokens and the accessibility floor are applied here.

export {
  Composer,
  type ComposerCommand,
  type ComposerDraft,
  type ComposerGround,
  type ComposerProps,
} from "./composer";
export { clearDraft, draftKey, readDraft, writeDraft } from "./drafts";
export { EventCard, type EventCardProps } from "./event-card";
export { groupThreadItems, type ThreadBlock } from "./grouping";
export {
  DayDivider,
  MessageBubble,
  MessageGroup,
  MessageThread,
  MessageTime,
  type MessageBubbleProps,
  type MessageGroupProps,
  type MessageThreadProps,
  type TimelineThreadOptions,
} from "./message-thread";
// The conversation timeline. Re-exported through this one door like everything else here, so the two
// surfaces that render event rows cannot each reach a different depth of the module.
export {
  FIXTURE_NEW_SINCE,
  TIMELINE_CATALOG,
  groupTimeline,
  primaryTarget,
  requestDocument,
  resolveRow,
  reviewDocument,
  timelineDenseFixture,
  timelineFixture,
  timelineThreadItems,
  timelineFreshFixture,
  timelineSparseFixture,
  timelineUpdatedFixture,
  titleText,
  type TimelineActionHandlers,
  type TimelineBlock,
  type TimelineFilter,
  type TimelineRow,
  type TimelineTarget,
} from "./timeline";
export {
  PaneSkeletonBar,
  PaneSkeletonRows,
  PaneSkeletonThread,
  PaneState,
  type PaneAction,
  type PaneFallback,
  type PaneStateProps,
} from "./pane-state";
export { sendHint, sendsOnKey, type SendKeyEvent, type SendOn } from "./send-key";
export {
  ShortcutOverlay,
  useChatShortcuts,
  type ChatShortcutOptions,
  type ShortcutOverlayProps,
} from "./shortcut-overlay";
export {
  CHAT_SHORTCUTS,
  isTypingTarget,
  matchShortcut,
  shortcutGroups,
  type ChatShortcut,
  type ShortcutEvent,
  type ShortcutId,
} from "./shortcuts";
export {
  DRIFT_AMPLITUDE,
  orbActivity,
  orbDots,
  orbMotion,
  ThinkingOrb,
  type OrbActivity,
  type OrbDot,
  type OrbJobStatus,
  type OrbMotion,
  type OrbSource,
  type OrbState,
  type ThinkingOrbProps,
} from "./thinking-orb";
export {
  THREAD_STATUS_TABS,
  ThreadList,
  ThreadListEmpty,
  ThreadListFilters,
  ThreadListItem,
  ThreadListSkeleton,
  type ThreadListEmptyProps,
  type ThreadListFiltersProps,
  type ThreadListItemProps,
  type ThreadListProps,
} from "./thread-list";
export {
  absoluteTime,
  crossesDay,
  dayLabel,
  GROUPING_WINDOW_MS,
  parseTimestamp,
  relativeTime,
  withinGroupingWindow,
} from "./time";
export type {
  ChatAttachment,
  ChatAuthor,
  ChatAuthorKind,
  ChatClientStage,
  ChatConnectionStatus,
  ChatDeliveryState,
  ChatEvent,
  ChatEventKind,
  ChatMessage,
  ChatMessageOrigin,
  ChatMessageVisibility,
  ChatSendFailure,
  ChatThreadItem,
  ChatThreadStatus,
  ChatThreadSummary,
  PaneStatus,
} from "./types";
