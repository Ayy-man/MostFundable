"use client";

// AI Elements `sources`, restyled — the provenance row under an answer.
//
// This is the component the plan's "every claim traceable" line actually cashes out to, and two
// of the changes here are rails rather than taste.
//
// A source is a human label. The registry's `<Source>` is an anchor with a title, which is right
// for a web citation and wrong for "the client Priya Raman" or "the bank Bluevine" — those open a
// peek inside the product and have no URL. So `<Source>` renders as a button when it is given an
// `onOpen` and as an anchor when it is given an `href`, and it will not render an id in either
// case: `ref` handles are opaque and never reach the DOM (contract §3.4, rail 3).
//
// And the count is spelled out. "Used 3 sources" collapses to "3" in the registry's default; a
// number with no noun beside it is the kind of thing that reads fine to the person who wrote it
// and to nobody else.

import { BookOpen, Building2, ChevronDown, FileText, Gauge, UserRound } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/** The five things an answer can cite. Mirrors `AssistantSource["kind"]` in contract §3.4. */
export type SourceKind = "client" | "bank" | "article" | "operator" | "metric";

const SOURCE_ICON: Readonly<Record<SourceKind, typeof BookOpen>> = {
  article: BookOpen,
  bank: Building2,
  client: UserRound,
  metric: Gauge,
  operator: Building2,
};

const SOURCE_NOUN: Readonly<Record<SourceKind, string>> = {
  article: "Article",
  bank: "Bank",
  client: "Client",
  metric: "Metric",
  operator: "Workspace",
};

export type SourcesProps = ComponentProps<typeof Collapsible>;

export const Sources = ({ className, ...props }: SourcesProps) => (
  <Collapsible className={cn("not-prose text-xs", className)} {...props} />
);

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
};

export const SourcesTrigger = ({ className, count, children, ...props }: SourcesTriggerProps) => (
  <CollapsibleTrigger
    className={cn(
      "text-[var(--primary-ink)] hover:text-[var(--foreground)]",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        <FileText aria-hidden className="size-3.5" />
        <span className="font-medium">
          {/* Tabular, so a row of answers does not shuffle its own labels sideways. */}
          <span className="tabular-nums">{count}</span> {count === 1 ? "source" : "sources"}
        </span>
        <ChevronDown
          aria-hidden
          className="size-3.5 transition-transform duration-[var(--acc-expand)] ease-[var(--acc-ease)] group-data-[panel-open]/collapsible-trigger:rotate-180"
        />
      </>
    )}
  </CollapsibleTrigger>
);

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export const SourcesContent = ({ className, children, ...props }: SourcesContentProps) => (
  <CollapsibleContent className={className} {...props}>
    <div className="flex flex-wrap gap-2 pt-3">{children}</div>
  </CollapsibleContent>
);

type SourceCommon = {
  /** The human label. A name, a title, a metric — never an identifier. */
  readonly title: string;
  readonly kind?: SourceKind;
  readonly children?: ReactNode;
  readonly className?: string;
};

/**
 * Three shapes, because a citation has three honest fates and only two of them are controls.
 *
 * The third is the one that gets forgotten. A knowledge article cited by the assistant has no page
 * to open — the fixture host serves nothing, and even in production an internal article is not a
 * URL — so the chip is a label and nothing more. Without this member the caller's only way to
 * render it is `onOpen={() => {}}`, which is a dead control: it looks pressable, it takes focus,
 * it announces as a button, and pressing it does nothing. That is the specific thing contract §7
 * bans, and a props union is a better place to stop it than a review.
 */
export type SourceProps = SourceCommon &
  (
    | { href: string; onOpen?: never }
    /** Opens a peek inside the product. The opaque handle stays in the caller's closure. */
    | { href?: never; onOpen: () => void }
    /** Cited, with nowhere to go. Renders as a label: not focusable, not announced as a control. */
    | { href?: never; onOpen?: never }
  );

const CHIP_BASE =
  "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]";

/** Openable: reads as a control, because it is one. */
const CHIP =
  CHIP_BASE +
  " border-[var(--surface-border)] bg-card text-foreground " +
  "hover:border-[var(--primary-ink)] hover:text-[var(--primary-ink)] " +
  "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Cited, with nowhere to go: quieter, and deliberately without a hover or a focus treatment.
 *
 * Looking un-pressable is the whole job. A chip that lifts on hover and then does nothing is a
 * worse answer than a chip that never invited the press.
 */
const CHIP_STATIC =
  CHIP_BASE + " border-dashed border-[var(--border)] bg-transparent text-muted-foreground";

export const Source = ({ className, kind = "article", title, children, ...rest }: SourceProps) => {
  const Icon = SOURCE_ICON[kind];
  const inner = children ?? (
    <>
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{title}</span>
    </>
  );
  // The kind is announced, not only drawn: colour and glyph are never the only channel.
  const label = `${SOURCE_NOUN[kind]}: ${title}`;

  if ("href" in rest && rest.href !== undefined) {
    return (
      <a
        aria-label={label}
        className={cn(CHIP, className)}
        href={rest.href}
        rel="noreferrer"
        target="_blank"
      >
        {inner}
      </a>
    );
  }

  if (rest.onOpen !== undefined) {
    return (
      <button aria-label={label} className={cn(CHIP, className)} onClick={rest.onOpen} type="button">
        {inner}
      </button>
    );
  }

  // Neither a link nor a control. It still carries its kind in the accessible name, so a screen
  // reader hears "Article: How lenders read a business file" rather than a bare title with no
  // indication of what it is or why it cannot be opened.
  return (
    <span aria-label={label} className={cn(CHIP_STATIC, className)} role="note">
      {inner}
    </span>
  );
};
