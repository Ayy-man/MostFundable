"use client";

import * as React from "react";
import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * One on-brand replacement for every native `<select>` across the four surfaces.
 *
 * Why a wrapper and not `<select>`: a native select paints the operating
 * system's own menu, so the open list ignores every token in `DESIGN.md` — the
 * macOS panel is grey with a purple selection highlight, which reads as a
 * different product the moment a user opens the bank picker. It also cannot
 * filter, which the catalog-length pickers need.
 *
 * Why Base UI's `Combobox` and not the shadcn `ui/select.tsx` this repo
 * generated: that file is scaffolding no surface had adopted, and Base UI's
 * `Select` has no filtering at all. `Combobox` covers both jobs from one
 * primitive — its `Trigger` carries `useTypeahead` when the list has no search
 * input, and it grows a real filter box when the list is long — so every call
 * site shares one component, one style sheet and one keyboard contract rather
 * than branching on two primitives that would drift apart.
 *
 * ARIA follows the pattern each shape actually is, which is why it differs
 * between the two: with a filter box Base UI makes the trigger
 * `role="combobox"` / `aria-haspopup="dialog"` over a searchbox-plus-listbox
 * popup; without one the trigger stays a button with `aria-haspopup="listbox"`,
 * which is the correct name for a button that opens a listbox. Both carry
 * `aria-expanded`, `aria-controls`, and `aria-activedescendant` while
 * navigating, and options carry `role="option"` with `aria-selected`.
 */

/** A single choice. Plain strings are accepted at the call site and normalised. */
export type BrandSelectOption = {
  value: string;
  label: string;
  /**
   * Renders the option and refuses to commit it. This deliberately does not
   * mirror `<option disabled>`: a native select skips disabled options during
   * keyboard navigation, so a keyboard user never learns the option exists or
   * why it is unavailable. Here the row stays reachable, carries
   * `aria-disabled="true"`, and refuses Enter and pointer alike — which is what
   * makes a label like "· pending legal review" worth writing, because the
   * reason now actually reaches the person who tried to pick it.
   */
  disabled?: boolean;
  /** Optional second line for options whose meaning needs the extra clause. */
  description?: string;
};

/**
 * Lists at or above this length get a filter box. Below it the popup stays a
 * plain listbox and the trigger's typeahead is the faster way to jump — a
 * search field over three options is noise, not affordance.
 */
const SEARCHABLE_OPTION_THRESHOLD = 8;

function normaliseOption(option: string | BrandSelectOption): BrandSelectOption {
  return typeof option === "string" ? { label: option, value: option } : option;
}

export type BrandSelectProps = {
  /**
   * Accessible name. Required unless the call site points a real `<label
   * htmlFor>` at `id` — a wrapping `<label>` stops naming the control once the
   * `<select>` becomes a button, so most converted sites pass this explicitly.
   */
  ariaLabel?: string;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  emptyMessage?: string;
  id?: string;
  onValueChange: (value: string) => void;
  options: readonly (string | BrandSelectOption)[];
  placeholder?: string;
  /** Overrides the length heuristic when a call site knows better. */
  searchable?: boolean;
  searchPlaceholder?: string;
  size?: "default" | "sm";
  title?: string;
  value: string;
};

export function BrandSelect({
  ariaLabel,
  className,
  contentClassName,
  disabled = false,
  emptyMessage = "No matches",
  id,
  onValueChange,
  options,
  placeholder = "Select",
  searchable,
  searchPlaceholder = "Filter options",
  size = "default",
  title,
  value,
}: BrandSelectProps) {
  const items = React.useMemo(() => options.map(normaliseOption), [options]);

  // Typeahead, the filter and the trigger's rendered value all read labels, so
  // the lookup is built once rather than re-scanned on every keystroke.
  const optionByValue = React.useMemo(() => {
    const map = new Map<string, BrandSelectOption>();
    for (const item of items) map.set(item.value, item);
    return map;
  }, [items]);

  const itemValues = React.useMemo(() => items.map((item) => item.value), [items]);

  const itemToStringLabel = React.useCallback(
    (itemValue: string) => optionByValue.get(itemValue)?.label ?? itemValue,
    [optionByValue],
  );

  const withSearch = searchable ?? items.length >= SEARCHABLE_OPTION_THRESHOLD;

  return (
    <Combobox.Root
      disabled={disabled}
      itemToStringLabel={itemToStringLabel}
      items={itemValues}
      onValueChange={(next) => {
        // Base UI hands back `null` when a selection is cleared. None of these
        // controls are clearable, so a null is a no-op rather than a state
        // reset that would blank a filter the user never touched.
        if (typeof next === "string") onValueChange(next);
      }}
      value={value}
    >
      <Combobox.Trigger
        aria-label={ariaLabel}
        className={cn(
          // The default 44px height holds the DESIGN.md touch-target floor;
          // `sm` is for controls that already sit inside a dense table row.
          "flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm text-foreground",
          "hover:bg-muted focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-60",
          size === "sm" ? "min-h-9 px-2 text-xs" : "min-h-11",
          className,
        )}
        id={id}
        title={title}
      >
        <span className="min-w-0 flex-1 truncate">
          {optionByValue.get(value)?.label ?? placeholder}
        </span>
        <ChevronDownIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      </Combobox.Trigger>

      <Combobox.Portal>
        <Combobox.Positioner
          align="start"
          className="isolate z-50 outline-none"
          // 12px keeps the popup clear of the viewport edge at 390px, so a long
          // bank name wraps inside the popup instead of widening the page.
          collisionPadding={12}
          side="bottom"
          sideOffset={6}
        >
          <Combobox.Popup
            data-slot="brand-select-content"
            className={cn(
              "t-dropdown overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md",
              // Base UI reports the trigger width as `--anchor-width`. Using it
              // as a minimum rather than a fixed width lets a long label set the
              // popup width on desktop, while `--available-width` (viewport
              // minus `collisionPadding`) caps it so 390px never scrolls
              // sideways.
              "max-h-(--available-height) min-w-(--anchor-width) max-w-(--available-width)",
              contentClassName,
            )}
          >
            {withSearch ? (
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <SearchIcon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <Combobox.Input
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder={searchPlaceholder}
                />
              </div>
            ) : null}

            <Combobox.Empty className="px-3 py-3 text-sm text-muted-foreground">
              {emptyMessage}
            </Combobox.Empty>

            <Combobox.List className="max-h-72 overflow-y-auto overscroll-contain p-1">
              {(itemValue: string) => {
                const option = optionByValue.get(itemValue);
                if (!option) return null;
                return (
                  <Combobox.Item
                    className={cn(
                      "relative flex cursor-default items-start gap-2 rounded-md border-l-2 border-l-transparent py-2 pl-2.5 pr-9 text-sm text-foreground outline-none select-none",
                      // Highlight is the keyboard/pointer cursor; selection is
                      // the committed value. Keeping them separate lets a user
                      // arrow past their current choice and still see which one
                      // is theirs.
                      "data-highlighted:bg-muted",
                      // Electric Green marks the committed row as a hairline
                      // beside dark ink — the only use DESIGN.md allows it on a
                      // light surface. The tint and the check carry the state
                      // too, so colour is never the only signal.
                      "data-selected:border-l-primary data-selected:bg-accent data-selected:font-medium data-selected:text-accent-foreground",
                      "data-disabled:pointer-events-none data-disabled:opacity-50",
                    )}
                    disabled={option.disabled}
                    key={option.value}
                    value={option.value}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block break-words">{option.label}</span>
                      {option.description ? (
                        <span className="mt-0.5 block break-words text-xs font-normal text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                    <Combobox.ItemIndicator
                      className="absolute right-3 top-2.5 text-primary-ink"
                      render={<span />}
                    >
                      <CheckIcon aria-hidden className="size-4" />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                );
              }}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
