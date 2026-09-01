/**
 * Whether the assistant's answer pane follows new content, and where it lands when it does.
 *
 * Split out of `global-companion.tsx` because the rule is the part worth checking and the DOM
 * plumbing is not. Two facts decide the behaviour and they are measured at different moments,
 * which is exactly what made the original defect invisible:
 *
 * - **Whether the reader is at the bottom** is a property of a *scroll position*, and it can only
 *   change when the reader scrolls. It is therefore sampled on the `scroll` event.
 * - **Whether there is new content** is a property of the *content box*, and it is sampled by a
 *   `ResizeObserver`.
 *
 * Reading the first at the moment the second fires is the trap: an answer that has just overflowed
 * its pane is, by definition, no longer "at the bottom" — the content grew underneath a scrollTop
 * that has not moved — so a follow gated on a fresh `isAtBottom` never fires on the one case it
 * exists for. The flag is latched from scrolling instead, and starts true because a pane whose
 * content has never overflowed is trivially at its own bottom.
 */

/** How far off the bottom still counts as at the bottom, in px. One line of slack, not zero. */
export const PINNED_SLACK = 24;

export interface PaneMetrics {
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly scrollTop: number;
}

/** Whether this scroll position is the pane's bottom, within `slack`. Sampled on scroll only. */
export function isAtBottom(pane: PaneMetrics, slack: number = PINNED_SLACK): boolean {
  return pane.scrollHeight - pane.scrollTop - pane.clientHeight <= slack;
}

/**
 * Where the pane should go now that its content has resized, or `null` to leave it alone.
 *
 * `pinned` is the latched flag, not a fresh measurement — see the note above.
 */
export function nextScrollTop(pinned: boolean, pane: PaneMetrics): number | null {
  return pinned ? pane.scrollHeight : null;
}
