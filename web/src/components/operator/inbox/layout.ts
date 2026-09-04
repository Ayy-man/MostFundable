/**
 * The Inbox frame owns a viewport-relative height at every width. Its middle row may scroll; the
 * reply footer must remain inside the frame instead of following a long thread down the document.
 */
export const INBOX_FRAME_CLASS =
  "h-[calc(100dvh-var(--demo-banner-height,0px)-17rem)] min-h-[30rem] overflow-hidden lg:min-h-[34rem]";
