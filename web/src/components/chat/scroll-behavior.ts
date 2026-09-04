/**
 * Initial content is anchored before paint; later growth follows the reader smoothly.
 *
 * Keeping the two events separate prevents a newly opened durable thread from animating through
 * old messages while preserving the ordinary arrival motion for a message received after open.
 */
export const CHAT_SCROLL_BEHAVIOR = {
  initial: "instant",
  resize: "smooth",
} as const;
