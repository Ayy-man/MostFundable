"use client"

// Disclosure, on Base UI like the other nineteen primitives here.
//
// The AI Elements registry ships `sources`, `task` and `reasoning` against the shadcn Collapsible,
// which is Radix. This repository is not on Radix, and adding `@radix-ui/react-collapsible`
// alongside `@base-ui/react` would give us two disclosure implementations with different data
// attributes, different focus behaviour and different animation hooks — the kind of split that
// only ever gets discovered by a keyboard user. Base UI's Collapsible has the same shape, so the
// registry components keep their markup and change their import.
//
// The panel animates its own height through `--collapsible-panel-height`, which Base UI measures,
// rather than a max-height guess. The shared accordion tokens and reduced-motion path live in
// `globals.css`, so every disclosure uses the same timing contract.

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"

import { cn } from "@/lib/utils"

function Collapsible({ className, ...props }: CollapsiblePrimitive.Root.Props) {
  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      className={cn("t-acc group/collapsible", className)}
      {...props}
    />
  )
}

function CollapsibleTrigger({
  className,
  ...props
}: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        // `data-panel-open` lands on the trigger, not the root, so the group that a chevron
        // inside it reads has to be here.
        "group/collapsible-trigger inline-flex min-h-11 items-center gap-2 rounded-lg text-left outline-none",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function CollapsibleContent({
  className,
  ...props
}: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn(
        "t-acc-panel h-[var(--collapsible-panel-height)] overflow-hidden text-sm",
        "data-starting-style:h-0 data-ending-style:h-0",
        className
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger }
