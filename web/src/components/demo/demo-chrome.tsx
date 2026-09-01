"use client";

import {
  Building2,
  ChevronsUpDown,
  FlaskConical,
  Landmark,
  ShieldCheck,
  Users,
} from "lucide-react";

import type { DemoRole } from "@/lib/demo/types";
import { cn } from "@/lib/utils";

export type DemoRoleIdentity = {
  detail?: string;
  initials?: string;
  name?: string;
  organization?: string;
};

export const DEMO_ROLES = {
  consumer: {
    description:
      "Track readiness, complete the plan, and prepare a funding application.",
    icon: Landmark,
    initials: "MO",
    label: "Consumer",
    name: "Maya Okafor",
    organization: "Okafor Design Co",
  },
  operator: {
    description:
      "Manage clients, supervision, documents, fees, and team operations.",
    icon: Users,
    initials: "AR",
    label: "Operator",
    name: "Alec Rivera",
    organization: "Apex Funding Partners",
  },
  admin: {
    description:
      "Operate workspaces, intelligence, evaluators, prompts, and platform health.",
    icon: ShieldCheck,
    initials: "AR",
    label: "Platform admin",
    name: "Alec Rivera",
    organization: "MostFundable",
  },
  affiliate: {
    description:
      "Follow referrals and see progress without exposing private credit data.",
    icon: Building2,
    initials: "RC",
    label: "Affiliate",
    name: "Rachel Chen",
    organization: "Consumer referrals",
  },
} satisfies Record<
  DemoRole,
  {
    description: string;
    icon: typeof Building2;
    initials: string;
    label: string;
    name: string;
    organization: string;
  }
>;

/**
 * The one sentence the bar is allowed to say, user-approved verbatim on
 * 2026-08-22. Every variant below composes exactly this string or a prefix of
 * it, and the module exports it so a test can derive its assertion from the
 * constant instead of transcribing the copy.
 *
 * Why the earlier wording had to go: the bar used to branch on `realAuth` and
 * tell a signed-in operator reading durable rows that every action beyond
 * sign-in was a local simulation reaching nothing outside the browser, and
 * that whatever they changed would be gone after a refresh. With nineteen
 * flags on, both are false -- the tracker, the KB assistant, Brand Studio and
 * the bank vault all round-trip to Supabase and persist. What is still
 * simulated is narrow and nameable (payments run on the Stripe mock, credit
 * pulls on the CRS mock), so the bar names those two and stops asserting
 * anything about the rest of the page.
 *
 * `realAuth` stays on the signature because four route wrappers pass it, but it
 * no longer selects copy: the sentence is true on both sides of the flag, and a
 * disclosure that changes with a flag is a disclosure nobody can verify.
 */
export const DEMO_ENVIRONMENT_NOTICE =
  "Demo environment · illustrative data · payments and credit checks are simulated.";

/** The lead clause, bolded on both variants; the rest follows the separator. */
const DEMO_ENVIRONMENT_NOTICE_LEAD = "Demo environment";
const DEMO_ENVIRONMENT_NOTICE_REST = DEMO_ENVIRONMENT_NOTICE.slice(
  DEMO_ENVIRONMENT_NOTICE_LEAD.length + " · ".length,
);
/**
 * The narrow variant splits the same sentence across two lines rather than
 * writing a second, shorter claim: a truncated variant that shortens can drift
 * into contradicting the full one, and a split cannot.
 */
const DEMO_ENVIRONMENT_NOTICE_NARROW_LEAD = "Demo environment · illustrative data";
const DEMO_ENVIRONMENT_NOTICE_NARROW_REST = "Payments and credit checks are simulated.";

export function DemoEnvironmentBar(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  { realAuth: _realAuth = false }: { realAuth?: boolean } = {},
) {
  return (
    <aside
      aria-label={DEMO_ENVIRONMENT_NOTICE}
      className="fixed inset-x-0 top-0 z-[45] flex h-[var(--demo-banner-height)] items-center border-b border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_60%)] bg-[color-mix(in_srgb,var(--consumer-warning),var(--consumer-canvas)_88%)] px-3 text-[var(--consumer-warning-ink)]"
      role="note"
    >
      <div className="mx-auto flex min-w-0 max-w-[96rem] flex-1 items-center justify-center gap-2 text-[0.66rem] sm:px-3 sm:text-[0.68rem] sm:leading-none">
        <FlaskConical aria-hidden className="size-3.5 shrink-0 text-[var(--consumer-warning)]" />
        <span className="min-w-0 leading-[1.15] sm:hidden">
          <strong className="block truncate font-semibold">
            {DEMO_ENVIRONMENT_NOTICE_NARROW_LEAD}
          </strong>
          <span className="mt-0.5 block truncate text-[var(--consumer-warning-ink)]">
            {DEMO_ENVIRONMENT_NOTICE_NARROW_REST}
          </span>
        </span>
        <span className="hidden min-w-0 items-center gap-2 sm:flex">
          <strong className="shrink-0 font-semibold uppercase tracking-[0.12em]">
            {DEMO_ENVIRONMENT_NOTICE_LEAD}
          </strong>
          <span aria-hidden className="text-[color-mix(in_srgb,var(--consumer-warning-ink),transparent_55%)]">
            ·
          </span>
          <span className="truncate">{DEMO_ENVIRONMENT_NOTICE_REST}</span>
        </span>
      </div>
    </aside>
  );
}

export function DemoRoleTrigger({
  className,
  currentRole,
  identity,
  onOpen,
  variant = "full",
}: {
  className?: string;
  currentRole: DemoRole;
  identity?: DemoRoleIdentity;
  onOpen: () => void;
  variant?: "compact" | "full";
}) {
  const role = DEMO_ROLES[currentRole];
  const initials = identity?.initials ?? role.initials;
  const name = identity?.name ?? role.name;
  /**
   * The organization does NOT fall back to the role default once a caller has
   * supplied an identity at all. An operator preview swaps the consumer
   * identity, so a role default would name the wrong business -- and on a
   * signed-in durable surface `demo-shell` passes `{detail, initials, name}`
   * with no organization, which used to make this trigger's accessible name
   * read "..., Apex Funding Partners" to an admin who has never heard of Apex.
   * Absent organization now means the label simply omits it: unbranded beats
   * wrongly branded. The role default survives only for `identity === undefined`,
   * which is the flags-OFF fixture shell, where the fixture business is the
   * right answer.
   */
  const organization = identity
    ? identity.organization
    : role.organization;
  const detail =
    identity?.detail ??
    (organization ? `${role.label} · ${organization}` : role.label);
  const accessibleName = organization
    ? `Switch demo role. Current role: ${role.label}, ${name}, ${organization}.`
    : `Switch demo role. Current role: ${role.label}, ${name}.`;

  if (variant === "compact") {
    return (
      <button
        aria-haspopup="dialog"
        aria-label={accessibleName}
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        data-demo-role-trigger={currentRole}
        onClick={onOpen}
        title={`Switch demo role — ${role.label}`}
        type="button"
      >
        <span className="grid size-8 place-items-center rounded-full bg-primary text-[0.66rem] font-semibold text-primary-foreground">
          {initials}
        </span>
      </button>
    );
  }

  return (
    <button
      aria-haspopup="dialog"
      aria-label={accessibleName}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 rounded-lg border border-border bg-card/75 px-3 text-left shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      data-demo-role-trigger={currentRole}
      onClick={onOpen}
      type="button"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-[0.68rem] font-semibold text-primary-foreground">
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-foreground">
          {name}
        </span>
        <span className="block truncate text-[0.66rem] text-muted-foreground">
          {detail}
        </span>
      </span>
      <ChevronsUpDown
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    </button>
  );
}
