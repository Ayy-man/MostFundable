/**
 * The inbox keyboard vocabulary, in one table.
 *
 * Borrowed from Plain rather than invented. An operator fluent in this category already has these
 * in their fingers, and a bespoke set would be the "reinventing standard affordances for flavour"
 * failure — the cost of being different here is paid by the person doing the work, every day,
 * forever, and it buys nothing.
 *
 * It lives in the foundation rather than in the inbox lane for one reason: the `?` overlay has to
 * be generated from the same table the handler binds. A help screen maintained separately from the
 * bindings drifts within a release, and then it is worse than no help screen, because a person who
 * has been told a key exists and finds it does nothing stops trusting the whole set.
 *
 * The matcher is here, away from React, so it can be tested. The hook and the overlay are in
 * `shortcuts.tsx`.
 */

export type ShortcutId =
  | "next"
  | "previous"
  | "open"
  | "reply"
  | "note"
  | "resolve"
  | "status"
  | "search"
  | "back"
  | "help";

export interface ChatShortcut {
  readonly id: ShortcutId;
  /** As typed. Rendered in the overlay exactly as it appears here. */
  readonly key: string;
  /** What it does, in the product's words. This is the overlay's text. */
  readonly label: string;
  /** Grouped in the overlay so the list reads as three short sets rather than one long one. */
  readonly group: "Moving around" | "Acting on a conversation" | "Everywhere";
}

export const CHAT_SHORTCUTS: readonly ChatShortcut[] = [
  { group: "Moving around", id: "next", key: "j", label: "Next conversation" },
  { group: "Moving around", id: "previous", key: "k", label: "Previous conversation" },
  { group: "Moving around", id: "open", key: "Enter", label: "Open the selected conversation" },
  { group: "Acting on a conversation", id: "reply", key: "r", label: "Reply" },
  { group: "Acting on a conversation", id: "note", key: "n", label: "Start an internal note" },
  { group: "Acting on a conversation", id: "resolve", key: "e", label: "Resolve" },
  { group: "Acting on a conversation", id: "status", key: "s", label: "Change the status" },
  { group: "Everywhere", id: "search", key: "/", label: "Search conversations" },
  { group: "Everywhere", id: "back", key: "Escape", label: "Back to the list" },
  { group: "Everywhere", id: "help", key: "?", label: "Show this list" },
];

/** The shape the matcher needs. A real `KeyboardEvent` satisfies it; so does a plain object. */
export interface ShortcutEvent {
  readonly key: string;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

/**
 * Whether the person is typing rather than driving the list.
 *
 * Without this, `n` in the middle of a reply starts an internal note and eats the word. Escape is
 * the exception, because leaving a field is exactly what a person expects it to do.
 */
export function isTypingTarget(target: unknown): boolean {
  if (target === null || typeof target !== "object") return false;
  const node = target as { tagName?: unknown; isContentEditable?: unknown };
  if (node.isContentEditable === true) return true;
  const tag = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
  return tag === "input" || tag === "textarea" || tag === "select";
}

/**
 * Which shortcut this keystroke is, if any.
 *
 * `null` for anything carrying a system modifier: ⌘K, Ctrl+R and friends belong to the browser and
 * the OS, and a single-letter shortcut that swallows them is the kind of bug that gets an app
 * uninstalled. Shift is allowed through because `?` is a shifted key on most layouts.
 */
export function matchShortcut(event: ShortcutEvent, typing: boolean): ShortcutId | null {
  if (event.altKey === true || event.ctrlKey === true || event.metaKey === true) return null;

  const found = CHAT_SHORTCUTS.find(
    (shortcut) => shortcut.key.toLowerCase() === event.key.toLowerCase(),
  );
  if (found === undefined) return null;

  // While a field has focus the only key that still belongs to the surface is the one whose whole
  // job is to leave the field.
  if (typing && found.id !== "back") return null;
  return found.id;
}

/** The overlay's sections, derived from the table so it cannot list a key nothing binds. */
export function shortcutGroups(): { group: ChatShortcut["group"]; shortcuts: ChatShortcut[] }[] {
  const order: ChatShortcut["group"][] = [
    "Moving around",
    "Acting on a conversation",
    "Everywhere",
  ];
  return order.map((group) => ({
    group,
    shortcuts: CHAT_SHORTCUTS.filter((shortcut) => shortcut.group === group),
  }));
}
