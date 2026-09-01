"use client";

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import {
  ArrowRight,
  CornerDownLeft,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CommandIcon = ComponentType<{
  "aria-hidden"?: boolean;
  className?: string;
}>;

export type CommandPalettePage = {
  description?: string;
  icon?: CommandIcon;
  id: string;
  keywords?: string[];
  label: string;
};

export type CommandPaletteAction = {
  description: string;
  icon?: CommandIcon;
  id: string;
  keywords?: string[];
  label: string;
  onSelect: () => void;
};

/**
 * A record the current signed-in surface has already been authorized to read.
 *
 * Callers own the label, description, keywords and selection callback so this
 * role-neutral component never reaches across tenant or role boundaries. The
 * id is only a React key; database ids do not need to be passed here and are
 * never written into the option DOM id.
 */
export type CommandPaletteRecord = {
  description: string;
  icon?: CommandIcon;
  id: string;
  keywords?: string[];
  label: string;
  onSelect: () => void;
};

export type CommandPaletteProps = {
  actions?: CommandPaletteAction[];
  className?: string;
  onNavigate: (pageId: string) => void;
  pages: CommandPalettePage[];
  records?: CommandPaletteRecord[];
  triggerLabel?: string;
};

type CommandEntry = {
  description: string;
  group: "Pages" | "Quick actions" | "Records";
  icon: CommandIcon;
  id: string;
  key: string;
  keywords: string[];
  label: string;
  kind: "action" | "page" | "record";
  onSelect?: () => void;
};

export function CommandPalette({
  actions = [],
  className,
  onNavigate,
  pages,
  records = [],
  triggerLabel = "Search workspace pages",
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();

  const entries = useMemo<CommandEntry[]>(() => {
    const actionEntries = actions.map((action) => ({
      ...action,
      group: "Quick actions" as const,
      icon: action.icon ?? ArrowRight,
      key: `action:${action.id}`,
      keywords: action.keywords ?? [],
      kind: "action" as const,
    }));
    const pageEntries = pages.map((page) => ({
      description: page.description ?? "Open this workspace page.",
      group: "Pages" as const,
      icon: page.icon ?? ArrowRight,
      id: page.id,
      key: `page:${page.id}`,
      keywords: page.keywords ?? [],
      label: page.label,
      kind: "page" as const,
    }));
    const recordEntries = records.map((record) => ({
      ...record,
      group: "Records" as const,
      icon: record.icon ?? ArrowRight,
      key: `record:${record.id}`,
      keywords: record.keywords ?? [],
      kind: "record" as const,
    }));

    return [...actionEntries, ...recordEntries, ...pageEntries];
  }, [actions, pages, records]);

  const visibleEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return entries;

    return entries.filter((entry) =>
      [
        entry.label,
        entry.description,
        ...entry.keywords,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [entries, query]);

  useEffect(() => {
    function openFromKeyboard(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() === "k" &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey
      ) {
        event.preventDefault();
        setOpen(true);
      }
    }

    window.addEventListener("keydown", openFromKeyboard);
    return () => window.removeEventListener("keydown", openFromKeyboard);
  }, []);

  const safeActiveIndex = Math.min(
    activeIndex,
    Math.max(visibleEntries.length - 1, 0),
  );

  function closePalette() {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  function execute(entry: CommandEntry) {
    if (entry.kind === "page") {
      closePalette();
      onNavigate(entry.id);
      return;
    }

    closePalette();
    entry.onSelect?.();
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!visibleEntries.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % visibleEntries.length);
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        (current) =>
          (current - 1 + visibleEntries.length) % visibleEntries.length,
      );
    }

    if (event.key === "Enter") {
      event.preventDefault();
      execute(visibleEntries[safeActiveIndex] ?? visibleEntries[0]);
    }
  }

  let lastGroup: CommandEntry["group"] | null = null;

  return (
    <>
      <Button
        aria-haspopup="dialog"
        className={cn(
          "min-w-52 justify-start gap-2 text-muted-foreground",
          className,
        )}
        onClick={() => setOpen(true)}
        variant="outline"
      >
        <Search aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
        <span className="hidden items-center gap-1 sm:flex" aria-hidden>
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.62rem]">
            ⌘K
          </kbd>
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.62rem]">
            Ctrl K
          </kbd>
        </span>
      </Button>

      <Dialog
        onOpenChange={(nextOpen) => {
          if (nextOpen) setOpen(true);
          else closePalette();
        }}
        open={open}
      >
        <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] max-w-2xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-4 pb-4 pt-4 pr-14">
            <DialogTitle>
              {records.length
                ? actions.length
                  ? "Find a page, record, or action"
                  : "Find a page or record"
                : actions.length
                  ? "Find a page or action"
                  : "Find a workspace page"}
            </DialogTitle>
            <DialogDescription>
              {records.length
                ? actions.length
                  ? "Open a workspace page or authorized record, or run a quick action."
                  : "Open a workspace page or authorized record."
                : actions.length
                  ? "Open a workspace page or run a quick action."
                  : "Open a workspace page."}
            </DialogDescription>
          </DialogHeader>

          <div className="relative border-b border-border">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-activedescendant={
                visibleEntries.length
                  ? `${listId}-option-${safeActiveIndex}`
                  : undefined
              }
              aria-autocomplete="list"
              aria-controls={listId}
              aria-expanded="true"
              aria-label={
                records.length
                  ? actions.length
                    ? "Search workspace pages, records, and actions"
                    : "Search workspace pages and records"
                  : actions.length
                    ? "Search workspace pages and actions"
                  : "Search workspace pages"
              }
              autoFocus
              className="h-14 rounded-none border-0 bg-muted/25 pl-11 pr-4 text-base focus-visible:ring-0"
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleInputKeyDown}
              placeholder={
                records.length
                  ? actions.length
                    ? "Type a page, record, or action"
                    : "Type a page or record"
                  : actions.length
                    ? "Type a page or action"
                    : "Type a page"
              }
              role="combobox"
              value={query}
            />
          </div>

          <div
            aria-label="Available commands"
            className="max-h-[22rem] overflow-y-auto p-2"
            id={listId}
            role="listbox"
          >
            {visibleEntries.length ? (
              visibleEntries.map((entry, index) => {
                const groupChanged = entry.group !== lastGroup;
                lastGroup = entry.group;
                const Icon = entry.icon;
                const selected = index === safeActiveIndex;

                return (
                  <div key={entry.key}>
                    {groupChanged ? (
                      <p className="px-3 pb-1 pt-3 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground first:pt-1">
                        {entry.group}
                      </p>
                    ) : null}
                    <button
                      aria-selected={selected}
                      className={cn(
                        "flex min-h-14 w-full items-center gap-3 rounded-lg px-3 text-left outline-none transition-colors",
                        selected
                          ? "bg-primary/10 text-foreground"
                          : "text-foreground hover:bg-muted/70",
                      )}
                      id={`${listId}-option-${index}`}
                      onClick={() => execute(entry)}
                      onMouseMove={() => setActiveIndex(index)}
                      role="option"
                      type="button"
                    >
                      <span
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-lg border",
                          selected
                            ? "border-primary-ink bg-background text-primary-ink"
                            : "border-border bg-muted/45 text-muted-foreground",
                        )}
                      >
                        <Icon aria-hidden className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {entry.label}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {entry.description}
                        </span>
                      </span>
                      <ArrowRight
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-medium">No matching command</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {records.length
                    ? actions.length
                      ? "Try a page name, an authorized record, or a listed quick action."
                      : "Try a page name or an authorized record."
                    : actions.length
                      ? "Try a page name or one of the listed quick actions."
                      : "Try one of the page names in this workspace."}
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 border-t border-border bg-muted/35 px-4 py-2.5 text-[0.65rem] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono">
                ↑↓
              </kbd>
              Move
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-background px-1.5 py-0.5">
                <CornerDownLeft aria-hidden className="size-3" />
              </kbd>
              Open
            </span>
            <span className="ml-auto">Esc closes</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
