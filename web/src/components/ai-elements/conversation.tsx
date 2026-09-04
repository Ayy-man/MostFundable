"use client";

// AI Elements `conversation`, restyled.
//
// Kept for one reason worth naming: `use-stick-to-bottom` solves scroll anchoring properly. A
// thread that grows while you are reading history must not yank you to the bottom, and a thread
// you are already at the bottom of must follow the new message without a jump — the naive
// `scrollTop = scrollHeight` version gets the first case wrong every time, and gets the second
// wrong whenever a message reflows after an image or a card resolves.
//
// What changed from the registry version: the scroll button is a real target (44px, ours are
// 24px minimum under WCAG 2.5.8 and 44px for anything a thumb reaches for), it carries a label
// instead of an icon alone, it sits on a lifted card surface rather than a translucent one, and
// it announces the thing it does. The empty state defers to `<PaneState>` in `components/chat`;
// this one stays for the cases that only need a line.

import { ArrowDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useCallback, useEffect } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

import { Button } from "@/components/ui/button";
import { CHAT_SCROLL_BEHAVIOR } from "@/components/chat/scroll-behavior";
import { cn } from "@/lib/utils";

/**
 * Re-anchor when the *window* shrinks, which the library does not watch.
 *
 * `use-stick-to-bottom` observes the content column and re-sticks when it grows. Nothing observes
 * the scroll element itself, so a thread that is correctly parked at its bottom is stranded the
 * moment a sibling appears beneath it and takes height away: the content did not change, no resize
 * fires, and a scrollTop that meant "the bottom" against the old window now means "most of the way
 * down" against the new one.
 *
 * That is not hypothetical. In the consumer Team Chat the suggested-questions row renders from the
 * client's durable snapshot, so it arrives after first paint, below the thread, inside a pane capped
 * to the viewport. Measured at 390x844: the thread's window went 359..663 to 359..522 and its
 * scrollTop stayed at the value that had been the bottom, leaving the team's reply 142px below the
 * fold with the client's own question the last thing visible.
 *
 * `escapedFromLock` is the whole of the caution here, and it is the library's own notion of "this
 * person took control by scrolling up" — the reader who went back through history keeps their place,
 * and only a view that had not been moved by hand is re-anchored. Growth is left entirely alone,
 * since that is the case the library already handles well.
 */
function ReanchorOnWindowShrink() {
  const { scrollRef, scrollToBottom, state } = useStickToBottomContext();

  useEffect(() => {
    const node = scrollRef.current;
    if (node === null) return;

    let previous = node.clientHeight;
    const observer = new ResizeObserver(() => {
      const height = node.clientHeight;
      const shrank = height < previous;
      previous = height;
      if (!shrank || state.escapedFromLock) return;
      void scrollToBottom({ animation: "instant", preserveScrollPosition: false });
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [scrollRef, scrollToBottom, state]);

  return null;
}

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ children, className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex min-h-0 flex-1 flex-col overflow-y-hidden", className)}
    initial={CHAT_SCROLL_BEHAVIOR.initial}
    resize={CHAT_SCROLL_BEHAVIOR.resize}
    role="log"
    {...props}
  >
    {(context) => (
      <>
        {/* Inside the provider, so it can reach the scroll element; renders nothing. The function
            form is used rather than plain children because the library's own API allows either and
            a caller passing a render function must keep working. */}
        <ReanchorOnWindowShrink />
        {typeof children === "function" ? children(context) : children}
      </>
    )}
  </StickToBottom>
);

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

/**
 * The message column, capped rather than full-bleed.
 *
 * 44rem is the contract's cap (§4). A 1500px pane with edge-to-edge bubbles is the single most
 * reliable way to make a chat look unfinished, and it is also just hard to read: a line of body
 * text past about 80 characters loses the reader on the return sweep.
 */
export const ConversationContent = ({ className, ...props }: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("mx-auto flex w-full max-w-[44rem] flex-col gap-5 px-4 py-5 sm:px-6", className)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description,
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 px-6 py-10 text-center",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon ? (
          <span className="grid size-10 place-items-center rounded-xl bg-[var(--accent)] text-[var(--primary-ink)]">
            {icon}
          </span>
        ) : null}
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {description ? (
            <p className="mx-auto max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button> & {
  /** What the button says. A count belongs here when the caller knows one. */
  label?: string;
};

export const ConversationScrollButton = ({
  className,
  label = "Jump to latest",
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const handleScrollToBottom = useCallback(() => {
    void scrollToBottom();
  }, [scrollToBottom]);

  if (isAtBottom) return null;

  return (
    <Button
      className={cn(
        "absolute bottom-4 left-1/2 min-h-11 -translate-x-1/2 gap-1.5 rounded-full border-[var(--surface-border)] bg-card px-4 text-xs font-medium shadow-[var(--surface-shadow)]",
        className,
      )}
      onClick={handleScrollToBottom}
      size="lg"
      type="button"
      variant="outline"
      {...props}
    >
      <ArrowDown aria-hidden className="size-3.5" />
      {label}
    </Button>
  );
};
