"use client";

import { ArrowUpRight, BookOpen, Info, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { isAtBottom, nextScrollTop } from "./pane-pinning";

import type { AssistantPageContext } from "./page-context";

const MIN_WIDTH = 380;
const MAX_WIDTH = 620;
const OPEN_EVENT = "mostfundable:assistant:open";

/**
 * The header's own look, with no horizontal padding in it.
 *
 * Split from the gutter below because the two answer to different authorities: this half is
 * design, and the other half is a measurement of the close button that sits on top of it.
 */
const HEADER_BASE_CLASS =
  "border-b border-[color-mix(in_srgb,var(--background),transparent_88%)] bg-[var(--assistant-ground)] py-3";

/**
 * The horizontal padding, and why the right side is stated once per breakpoint.
 *
 * `SheetContent` paints its own close button at `top-3 right-3 size-11` — absolutely positioned,
 * outside this header's flow, and therefore invisible to it. Everything the header lays out on its
 * right edge has to be kept clear of that 56px square by padding, which is what `pr-14` is for.
 *
 * The bug this shape exists to prevent: the class list used to read `px-4 py-3 pr-14 sm:px-5`, and
 * `sm:px-5` is a later utility for the same property in the same variant, so at every viewport at
 * or above `sm` it won 20px over the 56px and the padding vanished. The visible result was the
 * privacy-and-scope control sitting *under* the close button — `elementFromPoint` at its centre
 * returned the close button, so the only way to reach the privacy note was to close the panel.
 *
 * So: no shorthand `px-*` in any variant that also needs the gutter. Each side is named on its own,
 * and `assistantHeaderGutterRem` derives what that comes to for the regression to check.
 */
const HEADER_GUTTER_CLASS = "pl-4 pr-14 sm:pl-5 sm:pr-14";

/**
 * Where the launcher itself sits: the bottom-right corner, on every surface, at every width.
 *
 * Named rather than inlined because a second component has to be able to stay out of its way, and
 * the height is stated here (`min-h-12`) so that clearance can be computed from these two strings
 * instead of guessed.
 */
const LAUNCHER_PLACEMENT_CLASS = "fixed bottom-[4.7rem] right-4 z-40 min-h-12 lg:bottom-6 lg:right-6";

/**
 * Where a surface's own floating action goes, now that the launcher owns the bottom-right corner.
 *
 * Same lane, stacked above — deliberately not "beside". The two surfaces that have a floating
 * action were each trying to sit next to the launcher with a hand-measured horizontal offset
 * (`lg:right-[9.5rem]` on the consumer's Team Chat, `lg:right-[9rem]` on the operator's Platform
 * support), and both were wrong, because the launcher is a text pill whose width is content and
 * therefore not a number either of them can know. Measured signed-in against production at
 * 856b839: Team Chat overlapped the launcher by 4x44px at 1440x900, and Platform support by
 * 12x48px — while at 390x844 the operator's `bottom-[5rem]` put Platform support at 716-764
 * against a launcher at 721-769, so the launcher covered 99 of its 168px and the control read as
 * "Platf" with `elementFromPoint` at its centre returning the launcher.
 *
 * Stacking removes the coupling rather than re-tuning it: both share the launcher's right edge, so
 * the launcher's width stops being a number anyone has to track. The consumer surface was already
 * doing exactly this below `lg`, which is why only its desktop arm collided.
 */
export const ASSISTANT_LAUNCHER_ADJACENT_CLASS =
  "fixed bottom-[8.4rem] right-4 z-30 lg:bottom-[5.75rem] lg:right-6";


/**
 * Open the panel for a scope, optionally with a question already in its box.
 *
 * `seed` fills the composer and nothing else. It is never sent: a caller elsewhere in the product
 * cannot know that the reader wanted this exact question asked, only that it is the likeliest
 * thing they were about to type, so the send stays theirs. That is the same contract the Team Chat
 * chips held before they were removed, and it is why the seed travels as a composer insert rather
 * than as an argument to `ask`.
 */
export function openGlobalAssistant(
  scope: "consumer" | "operator" | "admin",
  seed?: string,
) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { scope, seed } }));
}

/**
 * The seed carried by the most recent open request for a scope, in the shape `<Composer>` takes.
 *
 * A hook rather than a prop on `GlobalAssistantCompanion`, because the composer is built by the
 * scope's own companion — the panel is handed a finished node and has no way to reach inside it.
 * The token increments on every request so that opening the panel twice from the same link fills
 * the box twice, which is the property `composer-value.ts` uses to tell an insert from an edit.
 */
export function useAssistantOpenSeed(
  scope: "consumer" | "operator" | "admin",
): { readonly token: number; readonly value: string } | null {
  const [seed, setSeed] = useState<{ token: number; value: string } | null>(null);
  const handle = useCallback(
    (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      if (event.detail?.scope !== scope) return;
      const value = event.detail?.seed;
      if (typeof value !== "string" || value.length === 0) return;
      setSeed((current) => ({ token: (current?.token ?? 0) + 1, value }));
    },
    [scope],
  );
  useEffect(() => {
    window.addEventListener(OPEN_EVENT, handle);
    return () => window.removeEventListener(OPEN_EVENT, handle);
  }, [handle]);
  return seed;
}

export interface GlobalAssistantCompanionProps {
  readonly children: ReactNode;
  readonly composer?: ReactNode;
  readonly context: AssistantPageContext;
  readonly empty: boolean;
  readonly onSuggestion: (question: string) => void;
  readonly scope: "consumer" | "operator" | "admin";
}

function storageKey(scope: string, field: "open" | "width") {
  return `mostfundable:assistant:${scope}:${field}`;
}

export function GlobalAssistantCompanion({
  children,
  composer,
  context,
  empty,
  onSuggestion,
  scope,
}: GlobalAssistantCompanionProps) {
  const [open, setOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  const [width, setWidth] = useState(480);
  const resize = useRef<{ startWidth: number; startX: number } | null>(null);
  const launcher = useRef<HTMLButtonElement | null>(null);
  const answers = useRef<HTMLDivElement | null>(null);
  const ContextIcon = context.suggestions[0]?.icon ?? BookOpen;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setOpen(window.localStorage.getItem(storageKey(scope, "open")) === "true");
      const stored = Number(window.localStorage.getItem(storageKey(scope, "width")));
      if (Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH) setWidth(stored);
      setRestored(true);
    });
    return () => {
      active = false;
    };
  }, [scope]);

  useEffect(() => {
    if (!restored) return;
    window.localStorage.setItem(storageKey(scope, "open"), String(open));
  }, [open, restored, scope]);

  useEffect(() => {
    if (!restored) return;
    window.localStorage.setItem(storageKey(scope, "width"), String(width));
  }, [restored, scope, width]);

  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, []);

  /**
   * Keep the newest turn in view, but only for a reader who was already at the newest turn.
   *
   * The defect: an answer that overflows the pane arrives with `scrollTop` still at 0, so the
   * reader sees the top of it and the cited-source row sits below the fold with nothing to say it
   * is there. Measured signed-in against production at 1440x900 — content 750px in a 664px pane,
   * `scrollTop` 0, the sources block spanning 643-832 against a window ending at 766, so 66 of its
   * 190px were shown and every source chip was off-screen.
   *
   * Pinned-only rather than always, because a reader who has scrolled up is reading, and yanking
   * them back down when the next stage lands is the more annoying half of this behaviour. The
   * pinned flag starts true, which is correct on the case that matters: before the first overflow
   * `scrollHeight === clientHeight`, so the pane is trivially at its own bottom.
   *
   * The empty state is excluded outright. It is centred rather than stacked and at 390x844 it
   * overflows its pane by a few pixels, so sticking it to the bottom would crop the illustration
   * off the top to reveal nothing.
   */
  useEffect(() => {
    const pane = answers.current;
    const content = pane?.firstElementChild;
    if (!open || empty || !pane || !content) return;
    let pinned = true;
    const track = () => {
      pinned = isAtBottom(pane);
    };
    const follow = () => {
      const top = nextScrollTop(pinned, pane);
      if (top !== null) pane.scrollTop = top;
    };
    pane.addEventListener("scroll", track, { passive: true });
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    follow();
    return () => {
      pane.removeEventListener("scroll", track);
      observer.disconnect();
    };
  }, [empty, open, scope]);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.scope === scope) setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, [scope]);

  return (
    <>
      <Button
        aria-keyshortcuts="Meta+/ Control+/"
        aria-label="Open AI assistant"
        className={cn(
          LAUNCHER_PLACEMENT_CLASS,
          "rounded-full border border-[color-mix(in_srgb,var(--accent-on-dark),transparent_30%)]",
          "bg-[var(--assistant-ground)] px-4 text-[var(--accent-on-dark)] shadow-[0_10px_28px_color-mix(in_srgb,var(--assistant-ground),transparent_70%)]",
          "hover:bg-[color-mix(in_srgb,var(--assistant-ground),var(--background)_8%)]",
          open && "pointer-events-none opacity-0",
        )}
        data-app-opening-floating-action
        onClick={() => setOpen(true)}
        ref={launcher}
      >
        <Sparkles aria-hidden className="size-4" /> Ask AI
        <span className="hidden rounded border border-[color-mix(in_srgb,var(--background),transparent_82%)] px-1.5 py-0.5 text-[0.65rem] text-[color-mix(in_srgb,var(--background),var(--assistant-ground)_28%)] sm:inline">⌘/</span>
      </Button>

      <Sheet onOpenChange={setOpen} open={open}>
        <SheetContent
          aria-label="AI assistant"
          className={cn(
            "w-full max-w-none gap-0 overflow-hidden border-l border-[var(--surface-border)] p-0",
            "bg-[var(--background)] text-foreground shadow-[0_0_40px_color-mix(in_srgb,var(--assistant-ground),transparent_84%)] data-[side=right]:w-full sm:data-[side=right]:max-w-none [&_[data-slot=sheet-close]]:text-[var(--background)]",
          )}
          finalFocus={launcher}
          overlayClassName="bg-transparent supports-backdrop-filter:[backdrop-filter:none]"
          side="right"
          style={{ width: `min(100vw, ${width}px)` }}
        >
          <div
            aria-label="Resize AI assistant"
            aria-orientation="vertical"
            aria-valuemax={MAX_WIDTH}
            aria-valuemin={MIN_WIDTH}
            aria-valuenow={width}
            className="absolute inset-y-0 left-0 z-20 hidden w-2 cursor-col-resize touch-none hover:bg-[color-mix(in_srgb,var(--accent-on-dark),transparent_80%)] sm:block"
            onPointerDown={(event) => {
              resize.current = { startWidth: width, startX: event.clientX };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (resize.current === null) return;
              setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, resize.current.startWidth + resize.current.startX - event.clientX)));
            }}
            onPointerUp={(event) => {
              resize.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const delta = event.key === "ArrowLeft" ? 20 : -20;
              setWidth((current) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, current + delta)));
            }}
            role="separator"
            tabIndex={0}
          />

          <SheetHeader className={cn(HEADER_BASE_CLASS, HEADER_GUTTER_CLASS)}>
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-[var(--accent-on-dark)] text-[var(--assistant-ground)]">
                <Sparkles aria-hidden className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-[var(--background)]">AI assistant</SheetTitle>
                <SheetDescription className="mt-0.5 truncate text-xs text-[color-mix(in_srgb,var(--background),var(--assistant-ground)_34%)]">Viewing {context.label}</SheetDescription>
              </div>
              <details className="group relative">
                <summary className="grid size-10 cursor-pointer list-none place-items-center rounded-lg text-[color-mix(in_srgb,var(--background),var(--assistant-ground)_30%)] hover:bg-[color-mix(in_srgb,var(--background),transparent_92%)] hover:text-[var(--background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-on-dark)]">
                  <Info aria-hidden className="size-4" />
                  <span className="sr-only">Assistant privacy and scope</span>
                </summary>
                <div className="absolute right-0 top-11 z-30 w-72 rounded-xl border border-[color-mix(in_srgb,var(--background),transparent_84%)] bg-[var(--assistant-ground)] p-3 text-xs leading-5 text-[color-mix(in_srgb,var(--background),var(--assistant-ground)_24%)] shadow-xl">
                  {scope === "consumer"
                    ? "Answers come from published knowledge and your own permitted workspace records. This is not your funding team. Questions are not copied into Team Chat, and consumer conversations are not saved to the account."
                    : "Answers come from published knowledge and permitted workspace records. This is an AI assistant, and conversations are saved to your assistant history."}
                </div>
              </details>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[0.68rem] text-[color-mix(in_srgb,var(--background),var(--assistant-ground)_34%)]">
              <span className="rounded-full border border-[color-mix(in_srgb,var(--background),transparent_84%)] px-2 py-1">
                {scope === "consumer" ? "Not your team · nothing saved" : "AI assistant · saved to history"}
              </span>
              <span className="truncate rounded-full border border-[color-mix(in_srgb,var(--background),transparent_84%)] px-2 py-1">{context.label}</span>
            </div>
          </SheetHeader>

          <div
            aria-live="polite"
            className={cn(
              "min-h-0 flex-1 overflow-y-auto bg-[var(--background)]",
              scope === "consumer" ? "px-4 py-5 sm:px-5" : "p-0",
            )}
            ref={answers}
          >
            {empty ? (
              <div className="flex min-h-full flex-col justify-center py-3">
                <div aria-hidden className="relative mx-auto h-24 w-28">
                  <span className="absolute left-0 top-3 grid size-16 -rotate-6 place-items-center rounded-[20px] bg-[var(--assistant-ground)] shadow-[0_10px_24px_color-mix(in_srgb,var(--assistant-ground),transparent_78%)]">
                    <Sparkles className="size-6 text-[var(--accent-on-dark)]" />
                  </span>
                  <span className="absolute bottom-1 right-0 grid size-14 rotate-6 place-items-center rounded-[18px] border border-[var(--surface-border)] bg-[var(--surface-raised)] shadow-[var(--surface-shadow)]">
                    <ContextIcon className="size-5 text-[var(--primary-ink)]" />
                  </span>
                  <span className="absolute right-3 top-0 size-3 rounded-full bg-[var(--accent-on-dark)] ring-4 ring-[var(--background)]" />
                </div>
                <div className="mx-auto mt-4 max-w-sm text-center">
                  <h2 className="text-xl font-semibold tracking-[-0.02em] text-foreground">What can I help with here?</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Choose a question about {context.label.toLowerCase()}, or ask your own below.</p>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-2.5">
                  {context.suggestions.slice(0, 4).map((action) => (
                    <button
                      className="group min-h-32 rounded-xl border border-[var(--surface-border)] bg-[var(--card)] p-3 text-left shadow-[var(--surface-shadow)] transition-[border-color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] hover:-translate-y-0.5 hover:border-[var(--primary-ink)] hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                      key={action.title}
                      onClick={() => onSuggestion(action.title)}
                      type="button"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="grid size-8 place-items-center rounded-lg bg-[var(--assistant-ground)] text-[var(--accent-on-dark)]">
                          <action.icon aria-hidden className="size-4" />
                        </span>
                        <ArrowUpRight aria-hidden className="size-3.5 text-muted-foreground transition-colors group-hover:text-[var(--primary-ink)]" />
                      </span>
                      <span className="mt-3 block text-sm font-medium leading-5 text-foreground">{action.title}</span>
                      <span className="mt-1 block text-xs leading-4 text-muted-foreground">{action.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : children}
          </div>

          {composer ? (
            <div className="border-t border-[var(--surface-border)] bg-[var(--card)] px-4 py-3 sm:px-5">
              {composer}
              <div className="mt-2 flex items-center justify-between gap-2 text-[0.65rem] text-muted-foreground">
                <span>Educational guidance · private to this panel</span>
                <span className="truncate">Context: {context.label}</span>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
