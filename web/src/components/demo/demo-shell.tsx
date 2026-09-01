"use client";

import { useState } from "react";
import { Menu, Sparkles } from "lucide-react";

import { DemoRoleTrigger } from "@/components/demo/demo-chrome";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { DemoShellProps, NavSection } from "@/lib/demo/types";
import { cn } from "@/lib/utils";

function Navigation({
  activeView,
  onNavigate,
  sections,
}: Pick<DemoShellProps, "activeView" | "onNavigate" | "sections">) {
  return (
    <nav
      aria-label="Primary navigation"
      className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-4"
    >
      {sections.map((section: NavSection, sectionIndex) => (
        <div className="space-y-1" key={section.label ?? sectionIndex}>
          {section.label ? (
            <p className="px-3 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {section.label}
            </p>
          ) : null}
          {section.items.map((item) => {
            const active = activeView === item.id;
            const Icon = item.icon;

            return (
              <button
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[0.86rem] font-medium text-sidebar-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
                key={item.id}
                data-motion-axis="vertical"
                data-motion-nav-item
                onClick={() => onNavigate(item.id)}
                type="button"
              >
                <Icon aria-hidden className="size-[1.05rem] shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.badge !== undefined ? (
                  <span className="min-w-5 rounded-full bg-background/80 px-1.5 py-0.5 text-center text-[0.68rem] font-semibold text-muted-foreground tabular-nums">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Brand({ brand, eyebrow }: Pick<DemoShellProps, "brand" | "eyebrow">) {
  return (
    <div className="flex h-[4.5rem] items-center gap-3 border-b border-sidebar-border px-5">
      <span className="grid size-8 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
        <Sparkles aria-hidden className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[0.95rem] font-semibold tracking-[-0.01em] text-sidebar-foreground">
          {brand}
        </p>
        {eyebrow ? (
          <p className="truncate text-[0.7rem] text-muted-foreground">{eyebrow}</p>
        ) : null}
      </div>
    </div>
  );
}

export function DemoShell({
  activeView,
  brand,
  children,
  currentRole,
  eyebrow,
  footer,
  initials,
  onNavigate,
  onOpenProfiles,
  profileName,
  roleLabel,
  sections,
  theme = "workspace",
}: DemoShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const contentId = `${currentRole}-demo-content`;

  return (
    <div
      className="min-h-[calc(100dvh-var(--demo-banner-height))] bg-background text-foreground"
      data-demo-theme={theme}
    >
      <a
        className="fixed left-3 top-[calc(var(--demo-banner-height)+0.75rem)] z-[70] -translate-y-24 rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-background shadow-lg transition-transform focus:translate-y-0"
        href={`#${contentId}`}
      >
        Skip to content
      </a>
      <aside className="fixed bottom-0 left-0 top-[var(--demo-banner-height)] z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Brand brand={brand} eyebrow={eyebrow} />
        <Navigation
          activeView={activeView}
          onNavigate={onNavigate}
          sections={sections}
        />
        {footer}
        <DemoRoleTrigger
          className="m-3 w-auto border-sidebar-border bg-background/70 shadow-none hover:bg-background"
          currentRole={currentRole}
          identity={{ detail: roleLabel, initials, name: profileName }}
          onOpen={onOpenProfiles}
        />
      </aside>

      <header className="sticky top-[var(--demo-banner-height)] z-20 flex h-16 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur lg:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles aria-hidden className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{brand}</p>
            <p className="truncate text-[0.68rem] text-muted-foreground">
              {roleLabel}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <DemoRoleTrigger
            currentRole={currentRole}
            identity={{ detail: roleLabel, initials, name: profileName }}
            onOpen={onOpenProfiles}
            variant="compact"
          />
          <Sheet onOpenChange={setMobileOpen} open={mobileOpen}>
            <SheetTrigger
              render={
                <Button
                  aria-label="Open navigation"
                  size="icon-lg"
                  variant="ghost"
                />
              }
            >
              <Menu aria-hidden />
            </SheetTrigger>
            <SheetContent
              className="w-[19rem] gap-0 bg-sidebar p-0"
              side="left"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
                <SheetDescription>Choose an area of the demo.</SheetDescription>
              </SheetHeader>
              <Brand brand={brand} eyebrow={eyebrow} />
              <Navigation
                activeView={activeView}
                onNavigate={(view) => {
                  onNavigate(view);
                  setMobileOpen(false);
                }}
                sections={sections}
              />
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main
        className="min-h-[calc(100dvh-var(--demo-banner-height)-4rem)] lg:min-h-[calc(100dvh-var(--demo-banner-height))] lg:pl-60"
        id={contentId}
      >
        {/* pb reserves room for the floating support control so it never
            covers a page action at the bottom of the scroll range. */}
        <div
          className="mx-auto w-full max-w-[96rem] px-4 pb-28 pt-5 sm:px-6 sm:pt-7 xl:px-10 xl:pt-9"
          data-motion-page
          key={activeView}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
