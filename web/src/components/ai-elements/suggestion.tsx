"use client";

// AI Elements `suggestion`, restyled — the chip rail above a composer.
//
// The registry version is a horizontal `ScrollArea` of outline buttons, which is the right shape.
// What changed is that the chips are targets rather than decorations: 44px tall, a visible focus
// ring at 3:1, and a rail that scrolls with the keyboard as well as with a trackpad. The `Button`
// `sm` size the registry picks is 28px, which is under the WCAG 2.5.8 floor before you even get to
// the mobile-first rule.
//
// Nothing here decides what a suggestion says. That matters: every one of these strings is
// user-facing copy that has to clear `verify-compliance-copy.mjs`, and a suggestion that promises
// an outcome is a compliance failure wearing a chip.

import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type SuggestionsProps = ComponentProps<typeof ScrollArea> & {
  /** What the rail is, for anyone not looking at it. */
  label?: string;
};

export const Suggestions = ({
  className,
  children,
  label = "Suggested questions",
  ...props
}: SuggestionsProps) => (
  <ScrollArea
    aria-label={label}
    className="w-full whitespace-nowrap"
    // A rail of chips is a list of shortcuts, not a landmark; `group` keeps it addressable
    // without claiming to be navigation.
    role="group"
    {...props}
  >
    <div className={cn("flex w-max flex-nowrap items-center gap-2 pb-2", className)}>{children}</div>
    <ScrollBar className="hidden" orientation="horizontal" />
  </ScrollArea>
);

export type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export const Suggestion = ({
  suggestion,
  onClick,
  className,
  variant = "outline",
  children,
  ...props
}: SuggestionProps) => (
  <Button
    className={cn(
      "min-h-11 rounded-full border-[var(--surface-border)] bg-card px-4 text-xs font-medium text-muted-foreground",
      "hover:border-[var(--primary-ink)] hover:bg-card hover:text-[var(--primary-ink)]",
      className,
    )}
    onClick={() => onClick?.(suggestion)}
    size="lg"
    type="button"
    variant={variant}
    {...props}
  >
    {children ?? suggestion}
  </Button>
);
