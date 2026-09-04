import type { ChatThreadSummary } from "./types";

export const EMPTY_THREAD_PREVIEW = "No messages yet";

/**
 * The preview slot reports message content only. A business name is useful row context, but it
 * must not occupy the slot that answers whether anybody has written in the thread.
 */
export function threadPreview(thread: Pick<ChatThreadSummary, "preview">): string {
  return thread.preview ?? EMPTY_THREAD_PREVIEW;
}
