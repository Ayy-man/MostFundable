"use client";

import { useState, type ReactNode } from "react";
import {
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  UsersRound,
} from "lucide-react";

import { DemoRoleTrigger } from "@/components/demo/demo-chrome";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type ConsumerNavItem = {
  id: string;
  label: string;
  shortLabel?: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

type ConsumerShellProps = {
  activeView: string;
  children: ReactNode;
  notificationCount: number;
  onNavigate: (view: string) => void;
  onOpenProfiles: () => void;
  operatorName: string;
  platformItems: ConsumerNavItem[];
  profileInitials: string;
  profileName: string;
  profileOrganization: string;
  /**
   * True only where `/api/auth/sign-out` will answer: the route 404s with
   * FEATURE_REAL_AUTH off, and the fixture shell has no session to end, so the
   * default renders the demo role trigger exactly as before.
   */
  signOutAvailable?: boolean;
  workspaceItems: ConsumerNavItem[];
};

function NavButton({
  active,
  badge,
  collapsed = false,
  item,
  onClick,
}: {
  active: boolean;
  badge?: number;
  collapsed?: boolean;
  item: ConsumerNavItem;
  onClick: () => void;
}) {
  const Icon = item.icon;

  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md px-3 text-left text-[0.84rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--consumer-accent-ink)]",
        collapsed && "relative justify-center px-0",
        active
          ? "bg-[var(--consumer-accent-tint)] text-[var(--consumer-accent-ink)]"
          : "text-[var(--consumer-muted)] hover:bg-muted/70 hover:text-foreground",
      )}
      data-motion-axis="vertical"
      data-motion-nav-item
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      type="button"
    >
      <Icon aria-hidden className={cn("size-4 shrink-0", active && "stroke-[2.2]")} />
      <span className={cn("min-w-0 flex-1 truncate whitespace-nowrap", collapsed && "sr-only")}>{item.label}</span>
      {badge ? (
        <span className={cn("shrink-0 rounded-full bg-[var(--consumer-negative)] px-2 py-0.5 text-[0.65rem] font-bold text-[var(--consumer-canvas)] tabular-nums", collapsed && "absolute right-0 top-0 min-w-4 px-1 text-center leading-4")}>
          {badge}
        </span>
      ) : (
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", collapsed && "hidden", active ? "bg-[var(--consumer-accent-ink)]" : "bg-transparent")}
        />
      )}
    </button>
  );
}

/**
 * The square brand tile in the rail shows the operator's initials, taken from
 * the first and last word of its name so "Apex Funding Partners" reads "AP".
 * Exported because the queued-analysis view renders the same tile outside this
 * shell; deriving it in both places from the one operator name is what keeps a
 * real operator's tile from disagreeing with the name printed beside it.
 */
export function operatorBrandInitials(operatorName: string): string {
  const words = operatorName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (
    words.length > 1
      ? `${words[0][0]}${words[words.length - 1][0]}`
      : words[0].slice(0, 2)
  ).toUpperCase();
}

/**
 * The signed-in consumer's way out.
 *
 * Until this existed the consumer surface had no sign-out control anywhere: the
 * only avatar opened the demo role switcher, which is not rendered at all once
 * quick sign-in is off, so a real client could reach the workspace and had no
 * way to leave it. The one sign-out implementation in the codebase is the
 * pending page's — a plain form POST to `/api/auth/sign-out`, which clears the
 * chunked auth cookies through Supabase's own client and redirects to sign-in —
 * and this is that same form, so there is still exactly one way a session ends.
 *
 * It replaces the role trigger rather than sitting beside it, so the avatar
 * stays a single control: role switching moves into the menu, where it is also
 * the item that can honestly be dropped when the switcher is unavailable.
 * `data-demo-role-trigger` rides along because the demo shell's focus handling
 * queries for it — the demo shell never renders this branch, but a selector that
 * silently matches nothing is how the next lane inherits a mystery.
 */
function ConsumerAccountMenu({
  className,
  onOpenProfiles,
  profileInitials,
  profileName,
  profileOrganization,
}: {
  className?: string;
  onOpenProfiles: () => void;
  profileInitials: string;
  profileName: string;
  profileOrganization: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${profileName}`}
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        data-demo-role-trigger="consumer"
        title="Account"
      >
        <span className="grid size-8 place-items-center rounded-full bg-primary text-[0.66rem] font-semibold text-primary-foreground">
          {profileInitials}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/*
          The group wrapper is required, not decoration: `Menu.GroupLabel`
          throws "MenuGroupContext is missing" outside `Menu.Group`, and in a
          production build that surfaces only as an opaque coded error.
        */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="min-w-0">
            <span className="block truncate">{profileName}</span>
            <span className="block truncate text-[0.7rem] font-normal text-muted-foreground">
              {profileOrganization}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenProfiles}>
          <UsersRound aria-hidden /> Switch demo role
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/*
          A real form submission, not a fetch: the route answers with a redirect
          to sign-in, and letting the browser follow it is what makes the next
          request go out with the cleared cookies rather than the stale ones.
        */}
        <form action="/api/auth/sign-out" method="post">
          <DropdownMenuItem className="w-full" render={<button type="submit" />}>
            <LogOut aria-hidden /> Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ConsumerShell({
  activeView,
  children,
  notificationCount,
  onNavigate,
  onOpenProfiles,
  operatorName,
  platformItems,
  profileInitials,
  profileName,
  profileOrganization,
  signOutAvailable = false,
  workspaceItems,
}: ConsumerShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const operatorInitials = operatorBrandInitials(operatorName);
  const primaryMobile = workspaceItems.filter((item) =>
    ["dashboard", "optimization", "plan", "credit"].includes(item.id),
  );
  const moreWorkspaceItems = workspaceItems.filter(
    (item) => !primaryMobile.some((primary) => primary.id === item.id),
  );

  const navigate = (view: string) => {
    setMoreOpen(false);
    onNavigate(view);
  };

  return (
    <div
      className="min-h-[calc(100dvh-var(--demo-banner-height))] bg-background text-foreground"
      data-demo-theme="consumer"
    >
      <a
        className="fixed left-3 top-[calc(var(--demo-banner-height)+0.75rem)] z-[90] -translate-y-24 rounded-md bg-foreground px-3 py-2 text-sm font-semibold text-background shadow-lg transition-transform focus:translate-y-0"
        href="#consumer-content"
      >
        Skip to content
      </a>

      <aside
        className={cn(
          "fixed bottom-0 left-0 top-[var(--demo-banner-height)] z-40 hidden border-r border-[var(--consumer-border)] bg-card transition-[width] duration-200 lg:flex lg:flex-col",
          sidebarCollapsed ? "w-[4.5rem]" : "w-[17rem]",
        )}
      >
        <div className={cn("flex h-16 shrink-0 items-center gap-3 border-b border-[var(--consumer-border)] px-3", sidebarCollapsed && "justify-center px-2")}>
          <button
            aria-label="Go to Overview"
            className="grid size-10 shrink-0 place-items-center rounded-md bg-[var(--consumer-brand-tile)] text-sm font-bold text-[var(--consumer-accent)] transition-colors hover:bg-[var(--consumer-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--consumer-accent-ink)]"
            onClick={() => navigate("dashboard")}
            title="Overview"
            type="button"
          >
            {operatorInitials}
          </button>
          {sidebarCollapsed ? null : (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.9rem] font-bold leading-tight tracking-[-0.025em] text-foreground">{operatorName}</p>
              <p className="truncate text-[0.68rem] text-muted-foreground">{profileName}</p>
            </div>
          )}
          {sidebarCollapsed ? null : (
            <Button
              aria-label="Collapse sidebar"
              className="size-10 shrink-0 text-muted-foreground"
              onClick={() => setSidebarCollapsed(true)}
              size="icon"
              title="Collapse sidebar"
              variant="ghost"
            >
              <PanelLeftClose aria-hidden />
            </Button>
          )}
        </div>

        {sidebarCollapsed ? (
          <Button
            aria-label="Expand sidebar"
            className="mx-auto mt-3 size-11 shrink-0 text-muted-foreground"
            onClick={() => setSidebarCollapsed(false)}
            size="icon-lg"
            title="Expand sidebar"
            variant="ghost"
          >
            <PanelLeftOpen aria-hidden />
          </Button>
        ) : null}

        <nav
          aria-label="Consumer navigation"
          className={cn("min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4", sidebarCollapsed && "px-2")}
        >
          {sidebarCollapsed ? null : (
            <p className="px-3 pb-2 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Workspace
            </p>
          )}
          {workspaceItems.map((item) => (
            <NavButton
              active={activeView === item.id}
              collapsed={sidebarCollapsed}
              item={item}
              key={item.id}
              onClick={() => navigate(item.id)}
            />
          ))}
          {sidebarCollapsed ? (
            <div className="mx-auto my-3 h-px w-7 bg-[var(--consumer-border)]" />
          ) : (
            <p className="px-3 pb-2 pt-5 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Platform
            </p>
          )}
          {platformItems.map((item) => (
            <NavButton
              active={activeView === item.id}
              badge={item.id === "notifications" ? notificationCount : undefined}
              collapsed={sidebarCollapsed}
              item={item}
              key={item.id}
              onClick={() => navigate(item.id)}
            />
          ))}
        </nav>

        <div className={cn("flex items-center border-t border-[var(--consumer-border)] p-3", sidebarCollapsed && "justify-center p-2 py-3")}>
          {signOutAvailable ? (
            <ConsumerAccountMenu
              className="border-[var(--consumer-border)] shadow-none hover:bg-muted focus-visible:ring-[var(--consumer-accent-ink)]"
              onOpenProfiles={onOpenProfiles}
              profileInitials={profileInitials}
              profileName={profileName}
              profileOrganization={profileOrganization}
            />
          ) : (
            <DemoRoleTrigger
              className="border-[var(--consumer-border)] shadow-none hover:bg-muted focus-visible:ring-[var(--consumer-accent-ink)]"
              currentRole="consumer"
              identity={{ initials: profileInitials, name: profileName, organization: profileOrganization }}
              onOpen={onOpenProfiles}
              variant="compact"
            />
          )}
          {sidebarCollapsed ? null : (
            <span className="ml-3 text-xs text-muted-foreground">Account and workspace</span>
          )}
          <span className="sr-only" role="status">Workspace connected</span>
          <span aria-hidden className={cn("ml-auto inline-block size-2 rounded-full bg-[var(--consumer-connected)]", sidebarCollapsed && "hidden")} />
        </div>
      </aside>

      {/*
        No header bar at any width (#167, re-raised 2026-08-29 and 08-31): below
        lg the workspace and client names sat directly above the greeting that
        already carries them. The bar's other jobs move, they do not vanish —
        sign-out and the demo-role switch into the More sheet below, the unread
        signal onto the More tab.
      */}

      <main
        className={cn(
          "min-h-[calc(100dvh-var(--demo-banner-height))] pb-36 transition-[margin] duration-200 lg:pb-24",
          sidebarCollapsed ? "lg:ml-[4.5rem]" : "lg:ml-[17rem]",
        )}
        id="consumer-content"
      >
        <div
          className="mx-auto w-full max-w-[86rem] px-4 py-5 sm:px-6 sm:py-7 xl:px-8 xl:py-8"
          data-app-opening-surface
          data-motion-page
          key={activeView}
        >
          {children}
        </div>
      </main>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--consumer-border)] bg-card px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 shadow-[0_-4px_18px_color-mix(in_srgb,var(--consumer-brand-tile),transparent_90%)] lg:hidden"
      >
        {primaryMobile.map((item) => {
          const Icon = item.icon;
          const active = activeView === item.id;
          return (
            <button
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-md text-[0.65rem] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--consumer-accent-ink)]",
                active
                  ? "text-[var(--consumer-accent-ink)]"
                  : "text-muted-foreground",
              )}
              data-motion-axis="horizontal"
              data-motion-nav-item
              key={item.id}
              onClick={() => navigate(item.id)}
              type="button"
            >
              <Icon aria-hidden className="size-[1.1rem]" />
              {item.shortLabel ?? item.label}
            </button>
          );
        })}
        <button
          aria-current={
            [...moreWorkspaceItems, ...platformItems].some(
              (item) => item.id === activeView,
            )
              ? "page"
              : undefined
          }
          aria-expanded={moreOpen}
          className={cn(
            "relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-md text-[0.65rem] font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--consumer-accent-ink)]",
            [...moreWorkspaceItems, ...platformItems].some(
              (item) => item.id === activeView,
            ) && "text-[var(--consumer-accent-ink)]",
          )}
          data-motion-axis="horizontal"
          data-motion-nav-item
          onClick={() => setMoreOpen(true)}
          type="button"
        >
          <MoreHorizontal aria-hidden className="size-[1.1rem]" />
          More
          {/*
            The removed header's bell was the only always-visible unread signal
            below lg; the count itself still renders on the Notifications row
            inside the sheet.
          */}
          {notificationCount > 0 ? (
            <>
              <span aria-hidden className="absolute right-[calc(50%-1.35rem)] top-2 size-2 rounded-full bg-[var(--consumer-negative)]" />
              <span className="sr-only">{notificationCount} unread notifications</span>
            </>
          ) : null}
        </button>
      </nav>

      <Sheet onOpenChange={setMoreOpen} open={moreOpen}>
        <SheetContent
          className="max-h-[82dvh] overflow-hidden rounded-t-xl bg-popover p-0"
          side="bottom"
        >
          <SheetHeader className="shrink-0 border-b border-[var(--consumer-border)] px-5 py-4 text-left">
            <SheetTitle>More</SheetTitle>
            <SheetDescription>Open another area of your workspace.</SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 gap-1 overflow-y-auto overscroll-contain px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            {moreWorkspaceItems.map((item) => (
              <NavButton
                active={activeView === item.id}
                item={item}
                key={item.id}
                onClick={() => navigate(item.id)}
              />
            ))}
            {moreWorkspaceItems.length ? (
              <div className="my-1 h-px bg-[var(--consumer-border)]" />
            ) : null}
            <p className="px-3 pb-1 pt-2 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Platform
            </p>
            {platformItems.map((item) => (
              <NavButton
                active={activeView === item.id}
                badge={item.id === "notifications" ? notificationCount : undefined}
                item={item}
                key={item.id}
                onClick={() => navigate(item.id)}
              />
            ))}
            {/*
              The removed header bar (#167) carried the only sub-lg account
              controls. Plain rows rather than the avatar dropdown: a nested
              menu inside a bottom sheet stacks two portals at the same layer,
              and a row is what everything else in this sheet already is.
              Sign-out is the same form POST as everywhere else, so there is
              still exactly one way a session ends.
            */}
            <div className="my-1 h-px bg-[var(--consumer-border)]" />
            <p className="px-3 pb-1 pt-2 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Account
            </p>
            <p className="min-w-0 px-3 pb-1 text-[0.8rem]">
              <span className="block truncate font-medium">{profileName}</span>
              <span className="block truncate text-[0.7rem] text-muted-foreground">{profileOrganization}</span>
            </p>
            <button
              className="group flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md px-3 text-left text-[0.84rem] font-medium text-[var(--consumer-muted)] transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--consumer-accent-ink)]"
              onClick={() => {
                setMoreOpen(false);
                onOpenProfiles();
              }}
              type="button"
            >
              <UsersRound aria-hidden className="size-4 shrink-0" /> Switch demo role
            </button>
            {signOutAvailable ? (
              <form action="/api/auth/sign-out" method="post">
                <button
                  className="group flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md px-3 text-left text-[0.84rem] font-medium text-[var(--consumer-muted)] transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--consumer-accent-ink)]"
                  type="submit"
                >
                  <LogOut aria-hidden className="size-4 shrink-0" /> Sign out
                </button>
              </form>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
