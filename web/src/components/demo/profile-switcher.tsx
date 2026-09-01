"use client";

import { Check } from "lucide-react";

import {
  DEMO_ROLES,
  type DemoRoleIdentity,
} from "@/components/demo/demo-chrome";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DEMO_PROFILE_EMAILS } from "@/lib/demo/demo-session";
import type { DemoRole } from "@/lib/demo/types";
import { cn } from "@/lib/utils";

const roleOrder: DemoRole[] = ["consumer", "operator", "admin", "affiliate"];

/**
 * Under real auth the switcher does not move between fixture personas — it
 * signs in the seeded account for the chosen role (see use-role-switch). The
 * cards must say so: showing "Maya Okafor · Okafor Design Co" over a button
 * that signs in newcomer@northbridge.example labels a real account with an
 * invented person. The identity line comes from the same DEMO_PROFILE_EMAILS
 * map the sign-in buttons and the quick-sign-in route read, so the label and
 * the account it signs in cannot drift apart.
 */
function seededIdentity(role: DemoRole): DemoRoleIdentity {
  const email = DEMO_PROFILE_EMAILS[role];
  return {
    detail: "seeded account",
    initials: email.slice(0, 2).toUpperCase(),
    name: email,
  };
}

export function ProfileSwitcher({
  activeRole,
  identityOverrides,
  onOpenChange,
  onSelect,
  open,
  seededIdentities = false,
}: {
  activeRole: DemoRole;
  identityOverrides?: Partial<Record<DemoRole, DemoRoleIdentity>>;
  onOpenChange: (open: boolean) => void;
  onSelect: (role: DemoRole) => void;
  open: boolean;
  seededIdentities?: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[min(44rem,calc(100dvh-2rem))] max-w-2xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-5 py-5 pr-12 sm:px-6">
          <DialogTitle className="text-lg font-semibold">
            Switch demo role
          </DialogTitle>
          <DialogDescription>
            {seededIdentities
              ? "Each card signs in the seeded account for that role and opens its workspace."
              : "Move between the four sample workspaces. Each role keeps its demo progress until the page reloads."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-2 overflow-y-auto p-3 sm:grid-cols-2 sm:p-4">
          {roleOrder.map((roleId) => {
            const profile = DEMO_ROLES[roleId];
            const override =
              identityOverrides?.[roleId] ??
              (seededIdentities ? seededIdentity(roleId) : undefined);
            const name = override?.name ?? profile.name;
            const initials = override?.initials ?? profile.initials;
            const detail = override?.detail ?? profile.organization;
            const active = activeRole === roleId;
            const Icon = profile.icon;

            return (
              <button
                aria-label={`${profile.label}: ${name}, ${detail}. ${active ? "Current role." : "Switch to this role."}`}
                aria-pressed={active}
                className={cn(
                  "group relative min-h-40 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary-ink bg-primary/5"
                    : "border-border bg-card hover:bg-muted/50",
                )}
                key={roleId}
                onClick={() => onSelect(roleId)}
                type="button"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "grid size-10 place-items-center rounded-lg",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground group-hover:text-foreground",
                      )}
                    >
                      <Icon aria-hidden className="size-4" />
                    </span>
                    <span className="grid size-8 place-items-center rounded-full border border-border bg-card text-[0.65rem] font-semibold text-foreground">
                      {initials}
                    </span>
                  </div>
                  {active ? (
                    <span className="flex min-h-6 items-center gap-1 rounded-full bg-primary px-2 text-[0.62rem] font-semibold text-primary-foreground">
                      <Check aria-hidden className="size-3" /> Current
                    </span>
                  ) : null}
                </div>
                <p className="mt-4 text-sm font-semibold">{profile.label}</p>
                <p className="mt-0.5 text-xs font-medium text-primary-ink">
                  {name} · {detail}
                </p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {profile.description}
                </p>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
