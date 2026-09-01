"use client";

// The hook that binds the vocabulary, and the overlay that teaches it.
//
// Both read `CHAT_SHORTCUTS`. That is the point of the split: the overlay cannot advertise a key
// the hook does not bind, and the hook cannot bind one the overlay does not show, because there is
// one table and neither of them owns it.
//
// A shortcut nobody can discover is a shortcut nobody uses, which is why `?` is in the table
// rather than being a special case beside it.

import { useCallback, useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { isTypingTarget, matchShortcut, shortcutGroups, type ShortcutId } from "./shortcuts";

export {
  CHAT_SHORTCUTS,
  isTypingTarget,
  matchShortcut,
  shortcutGroups,
  type ChatShortcut,
  type ShortcutEvent,
  type ShortcutId,
} from "./shortcuts";

export interface ChatShortcutOptions {
  /** Off while a dialog or sheet owns the keyboard. Defaults to on. */
  readonly enabled?: boolean;
}

/**
 * Binds the handlers a surface actually has.
 *
 * Only bound ids are handled, and an unbound key falls through untouched rather than being
 * swallowed with nothing to show for it — which is what makes it safe for the consumer thread to
 * use the same hook with two of the ten.
 *
 * `help` is bound here rather than by the caller, because the overlay it opens is this module's.
 */
export function useChatShortcuts(
  handlers: Partial<Record<ShortcutId, () => void>>,
  { enabled = true }: ChatShortcutOptions = {},
) {
  const [helpOpen, setHelpOpen] = useState(false);

  const closeHelp = useCallback(() => setHelpOpen(false), []);

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      const id = matchShortcut(event, isTypingTarget(event.target));
      if (id === null) return;

      if (id === "help") {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }

      const handler = handlers[id];
      // Unbound keys are left alone. Calling `preventDefault` for a shortcut this surface does not
      // have would break the browser's own use of the key and give nothing back.
      if (handler === undefined) return;
      event.preventDefault();
      handler();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, handlers]);

  return { closeHelp, helpOpen, setHelpOpen };
}

export interface ShortcutOverlayProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** The `?` screen. Every row comes out of the table; nothing here is typed twice. */
export function ShortcutOverlay({ onOpenChange, open }: ShortcutOverlayProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            These work anywhere in the inbox, except while you are typing in a field.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {shortcutGroups().map(({ group, shortcuts }) => (
            <section key={group}>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {group}
              </h3>
              <dl className="space-y-1">
                {shortcuts.map((shortcut) => (
                  <div
                    className="flex min-h-11 items-center justify-between gap-4 rounded-lg px-2"
                    key={shortcut.id}
                  >
                    <dt className="min-w-0 text-sm text-foreground">{shortcut.label}</dt>
                    <dd>
                      <kbd className="inline-flex min-w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs font-medium text-foreground">
                        {shortcut.key}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
