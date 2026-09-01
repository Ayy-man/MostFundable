"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Check,
  CircleDollarSign,
  Copy,
  Link2,
  Send,
  Users,
} from "lucide-react";

import { operatorBrandInitials } from "@/components/consumer/consumer-shell";
import { DemoRoleTrigger } from "@/components/demo/demo-chrome";
import { useFeedbackSession } from "@/components/demo/feedback-session";
import {
  MetricStrip,
  PageHeader,
  Panel,
  StatusPill,
} from "@/components/demo/shared";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DEMO_CLIENTS,
  deriveClientFundedAmount,
  formatDemoMoney,
  type DemoClient,
} from "@/lib/demo/feedback-fixtures";
import {
  FUNDING_STAGES,
  type AffiliatePaymentStatus,
  type AffiliateShare,
  type FundingStage,
  type SurfaceProps,
} from "@/lib/demo/types";
import type {
  AffiliatePaymentStatus as LivePaymentStatus,
  AffiliatePortal,
  AffiliatePortalRow,
} from "@/lib/affiliates/types";
import {
  displayInitials,
  type SessionDisplayIdentity,
} from "@/lib/auth/display-identity";
import { cn } from "@/lib/utils";

type PortalView = "dashboard" | "leads" | "commissions" | "resources";
type LeadFilter = "Referrals" | "Active" | "In pipeline" | "Graduated";
type AffiliateLead = {
  attribution: "Apex team share" | "Rachel referral link";
  client: DemoClient;
  fundedAmount: number;
  share: AffiliateShare;
};

const AFFILIATE_ID = "aff-summit";
const REFERRAL_LINK =
  "https://apply.apexfundingpartners.com/r/rachel-chen";

const portalViews: ReadonlyArray<{
  icon: typeof BarChart3;
  id: PortalView;
  label: string;
}> = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "leads", label: "Leads", icon: Users },
  { id: "commissions", label: "Commissions", icon: CircleDollarSign },
  { id: "resources", label: "Resources", icon: BookOpen },
];

const leadFilters: LeadFilter[] = [
  "Referrals",
  "Active",
  "In pipeline",
  "Graduated",
];

const resourceLibrary = [
  {
    id: "intro",
    title: "Funding-readiness introduction",
    type: "Conversation guide",
    updated: "Updated Jul 18",
    summary:
      "Explain how Apex helps business owners organize verified information and prepare a sequenced funding plan.",
    body:
      "Apex Funding Partners helps business owners understand their current profile, complete the next practical actions, and follow an operator-reviewed funding sequence.",
  },
  {
    id: "follow-up",
    title: "Referral follow-up checklist",
    type: "Checklist",
    updated: "Updated Jul 15",
    summary:
      "A short follow-up sequence for a lead who has received your referral link.",
    body:
      "Confirm that the lead received the link, ask whether they completed enrollment, and direct account or technical questions to the Apex team.",
  },
  {
    id: "boundaries",
    title: "What the affiliate portal shows",
    type: "Portal guide",
    updated: "Updated Jul 11",
    summary:
      "A plain-language guide to progress, funding records, expected commission, and private client data.",
    body:
      "You can see the lead's stage, funding recorded by the team, the expected commission set by Apex, and its off-platform payment status. Detailed client records remain private.",
  },
] as const;

const paymentLabels: Record<AffiliatePaymentStatus, string> = {
  "not-ready": "Not ready",
  pending: "Pending",
  submitted: "Submitted",
  paid: "Paid",
};

function paymentTone(
  status: AffiliatePaymentStatus,
): "info" | "neutral" | "success" | "warning" {
  if (status === "paid") return "success";
  if (status === "submitted") return "info";
  if (status === "pending") return "warning";
  return "neutral";
}

function isInPipeline(stage: FundingStage) {
  return ["Optimization", "Ready", "Applying"].includes(stage);
}

function matchesLeadFilter(lead: AffiliateLead, filter: LeadFilter) {
  if (filter === "Referrals") return true;
  if (filter === "Graduated") return lead.client.stage === "Graduate";
  if (filter === "In pipeline") return isInPipeline(lead.client.stage);
  return lead.client.stage !== "Graduate";
}

function formatSharedDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function ReferralIdentity({ lead }: { lead: AffiliateLead }) {
  const initials = lead.client.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-[0.68rem] font-semibold text-muted-foreground">
        {initials}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">
          {lead.client.name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {lead.client.business}
        </span>
      </span>
    </div>
  );
}

function StageTrack({ stage }: { stage: FundingStage }) {
  const activeIndex = FUNDING_STAGES.indexOf(stage);

  return (
    <div
      aria-label={`Stage: ${stage}`}
      className="flex min-w-40 items-center gap-2.5"
    >
      <div aria-hidden className="flex flex-1 gap-1">
        {FUNDING_STAGES.map((item, index) => (
          <span
            className={cn(
              "h-1.5 flex-1 rounded-full",
              index < activeIndex
                ? "bg-[color-mix(in_srgb,var(--consumer-positive),transparent_65%)]"
                : index === activeIndex
                  ? "bg-primary"
                  : "bg-muted",
            )}
            key={item}
          />
        ))}
      </div>
      <span className="text-xs font-medium">{stage}</span>
    </div>
  );
}

function PaymentStatus({ status }: { status: AffiliatePaymentStatus }) {
  return (
    <StatusPill tone={paymentTone(status)}>
      {paymentLabels[status]}
    </StatusPill>
  );
}

function ShareLink({
  copied,
  onCopy,
}: {
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-primary/20 bg-primary/8 p-4 sm:flex-row sm:items-center sm:p-5">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary-ink">
        <Link2 aria-hidden className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-primary-ink">
          Rachel&apos;s Apex referral link
        </p>
        <p className="mt-1 truncate text-sm font-semibold text-foreground sm:text-base">
          apply.apexfundingpartners.com/r/rachel-chen
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Signups through this link are attributed to your affiliate account.
        </p>
      </div>
      <Button className="w-full sm:w-auto" onClick={onCopy}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Copied" : "Copy referral link"}
      </Button>
    </section>
  );
}

function LeadTable({ leads }: { leads: AffiliateLead[] }) {
  return (
    <>
      <div className="hidden md:block">
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Attribution</TableHead>
              <TableHead className="text-right">Funding recorded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <TableRow key={lead.share.id}>
                <TableCell className="min-w-56">
                  <ReferralIdentity lead={lead} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {formatSharedDate(lead.share.sharedAt)}
                </TableCell>
                <TableCell>
                  <StageTrack stage={lead.client.stage} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {lead.attribution}
                </TableCell>
                <TableCell className="text-right text-sm font-semibold tabular-nums">
                  {formatDemoMoney(lead.fundedAmount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="divide-y divide-border md:hidden">
        {leads.map((lead) => (
          <article className="py-4 first:pt-0 last:pb-0" key={lead.share.id}>
            <ReferralIdentity lead={lead} />
            <dl className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-muted-foreground">Sent</dt>
                <dd className="mt-1 text-xs tabular-nums">
                  {formatSharedDate(lead.share.sharedAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Attribution</dt>
                <dd className="mt-1 text-xs font-medium">
                  {lead.attribution}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">
                  Funding recorded
                </dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums">
                  {formatDemoMoney(lead.fundedAmount)}
                </dd>
              </div>
            </dl>
            <div className="mt-4">
              <StageTrack stage={lead.client.stage} />
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function DashboardView({
  copied,
  leads,
  onCopy,
}: {
  copied: boolean;
  leads: AffiliateLead[];
  onCopy: () => void;
}) {
  const activeCount = leads.filter(
    (lead) => lead.client.stage !== "Graduate",
  ).length;
  const pipelineCount = leads.filter((lead) =>
    isInPipeline(lead.client.stage),
  ).length;
  const fundedTotal = leads.reduce(
    (total, lead) => total + lead.fundedAmount,
    0,
  );
  const linkCount = leads.filter(
    (lead) => lead.attribution === "Rachel referral link",
  ).length;

  return (
    <>
      <PageHeader
        description="Follow the business owners you sent to Apex and see the status of operator-managed commission records."
        eyebrow="Apex Funding Partners"
        title="Affiliate dashboard"
      />

      <ShareLink copied={copied} onCopy={onCopy} />

      <div className="mt-5">
        <MetricStrip
          items={[
            { label: "Sent leads", value: leads.length },
            { label: "Active", value: activeCount },
            { label: "In pipeline", value: pipelineCount },
            {
              label: "Funding recorded",
              value: formatDemoMoney(fundedTotal, { compact: true }),
            },
          ]}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <Panel
          description="Counts use the shared client stage recorded by the Apex team."
          title="Lead movement"
        >
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            {FUNDING_STAGES.map((stage) => {
              const count = leads.filter(
                (lead) => lead.client.stage === stage,
              ).length;
              return (
                <div
                  className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0 sm:[&:nth-last-child(-n+2)]:border-0 sm:[&:nth-last-child(-n+2)]:pb-0"
                  key={stage}
                >
                  <span className="text-sm text-muted-foreground">{stage}</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel
          description="Attribution is retained when the Apex team shares a client directly."
          title="Lead attribution"
        >
          <dl className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-muted-foreground">Referral link</dt>
              <dd className="text-sm font-semibold tabular-nums">
                {linkCount}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-muted-foreground">
                Apex team shares
              </dt>
              <dd className="text-sm font-semibold tabular-nums">
                {leads.length - linkCount}
              </dd>
            </div>
            <div className="border-t border-border pt-4">
              <p className="text-xs leading-5 text-muted-foreground">
                Detailed client records remain private. This portal shows
                stage, funding recorded, and commission tracking only.
              </p>
            </div>
          </dl>
        </Panel>
      </div>

      <Panel
        className="mt-5"
        description="The newest clients visible to your affiliate account."
        title="Recent sent leads"
      >
        <LeadTable leads={leads.slice(0, 4)} />
      </Panel>
    </>
  );
}

function LeadsView({
  filter,
  leads,
  onFilterChange,
}: {
  filter: LeadFilter;
  leads: AffiliateLead[];
  onFilterChange: (filter: LeadFilter) => void;
}) {
  const visibleLeads = leads.filter((lead) =>
    matchesLeadFilter(lead, filter),
  );

  return (
    <>
      <PageHeader
        description="Referral-link signups and clients shared by the Apex team appear in one stage-based view."
        eyebrow="Apex Funding Partners"
        title="Sent leads"
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div
          aria-label="Lead stage filter"
          className="grid w-full grid-cols-2 rounded-lg border border-border bg-background p-1 sm:inline-flex sm:w-auto"
        >
          {leadFilters.map((item) => (
            <Button
              aria-pressed={filter === item}
              className="w-full sm:w-auto"
              key={item}
              onClick={() => onFilterChange(item)}
              size="sm"
              variant={filter === item ? "secondary" : "ghost"}
            >
              {item}
            </Button>
          ))}
        </div>
        <p
          aria-live="polite"
          className="text-xs text-muted-foreground sm:ml-auto"
        >
          <span className="tabular-nums">{visibleLeads.length}</span> of{" "}
          {leads.length} sent leads
        </p>
      </div>

      <Panel
        description="Funding reflects outcomes recorded in the shared application tracker."
        title={`${filter} leads`}
      >
        {visibleLeads.length ? (
          <LeadTable leads={visibleLeads} />
        ) : (
          <div className="py-12 text-center">
            <Send
              aria-hidden
              className="mx-auto size-5 text-muted-foreground"
            />
            <p className="mt-3 text-sm font-semibold">
              No leads in this view
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              A client will appear here when their shared stage matches this
              filter.
            </p>
          </div>
        )}
        <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
          Onboarding → Optimization → Ready → Applying → Funded → Graduate
        </p>
      </Panel>
    </>
  );
}

function CommissionsView({ leads }: { leads: AffiliateLead[] }) {
  const expectedTotal = leads.reduce(
    (total, lead) => total + lead.share.expectedCommission,
    0,
  );
  const submittedTotal = leads
    .filter((lead) => lead.share.paymentStatus === "submitted")
    .reduce((total, lead) => total + lead.share.expectedCommission, 0);
  const paidTotal = leads
    .filter((lead) => lead.share.paymentStatus === "paid")
    .reduce((total, lead) => total + lead.share.expectedCommission, 0);

  return (
    <>
      <PageHeader
        description="Apex sets each expected amount and records the status here; payments are completed outside the platform."
        eyebrow="Apex Funding Partners"
        title="Commission tracking"
      />

      <MetricStrip
        items={[
          {
            label: "Expected total",
            value: formatDemoMoney(expectedTotal),
          },
          {
            label: "Pending review",
            value: leads.filter(
              (lead) => lead.share.paymentStatus === "pending",
            ).length,
          },
          {
            label: "Submitted",
            value: formatDemoMoney(submittedTotal),
          },
          { label: "Paid", value: formatDemoMoney(paidTotal) },
        ]}
      />

      <Panel
        className="mt-5"
        description="Expected commission is operator-set for each client. The platform does not calculate or send payouts."
        title="Commission records"
      >
        <div className="hidden md:block">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">
                  Funding recorded
                </TableHead>
                <TableHead className="text-right">
                  Expected commission
                </TableHead>
                <TableHead>Payment status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.share.id}>
                  <TableCell className="min-w-56">
                    <ReferralIdentity lead={lead} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {formatSharedDate(lead.client.startedAt)}
                  </TableCell>
                  <TableCell>
                    <StatusPill>{lead.client.stage}</StatusPill>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatDemoMoney(lead.fundedAmount)}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums">
                    {formatDemoMoney(lead.share.expectedCommission)}
                  </TableCell>
                  <TableCell>
                    <PaymentStatus status={lead.share.paymentStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="divide-y divide-border md:hidden">
          {leads.map((lead) => (
            <article className="py-4 first:pt-0 last:pb-0" key={lead.share.id}>
              <ReferralIdentity lead={lead} />
              <dl className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Started</dt>
                  <dd className="mt-1 text-xs tabular-nums">
                    {formatSharedDate(lead.client.startedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Funding recorded
                  </dt>
                  <dd className="mt-1 text-sm tabular-nums">
                    {formatDemoMoney(lead.fundedAmount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Expected commission
                  </dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums">
                    {formatDemoMoney(lead.share.expectedCommission)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Stage</dt>
                  <dd className="mt-1">
                    <StatusPill>{lead.client.stage}</StatusPill>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Payment status
                  </dt>
                  <dd className="mt-1">
                    <PaymentStatus status={lead.share.paymentStatus} />
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </Panel>
    </>
  );
}

function ResourcesView({
  copied,
  onCopy,
}: {
  copied: boolean;
  onCopy: () => void;
}) {
  const [selectedResourceId, setSelectedResourceId] = useState<
    (typeof resourceLibrary)[number]["id"]
  >(resourceLibrary[0].id);
  const selectedResource =
    resourceLibrary.find((resource) => resource.id === selectedResourceId) ??
    resourceLibrary[0];

  return (
    <>
      <PageHeader
        description="Operator-provided language and follow-up guidance for introducing a lead to Apex."
        eyebrow="Apex Funding Partners"
        title="Affiliate resources"
      />

      <ShareLink copied={copied} onCopy={onCopy} />

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.78fr_1.22fr]">
        <Panel
          description="Select a resource to read the current Apex version."
          title="Resource library"
        >
          <div className="space-y-2">
            {resourceLibrary.map((resource) => (
              <button
                aria-pressed={selectedResource.id === resource.id}
                className={cn(
                  "min-h-11 w-full rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  selectedResource.id === resource.id
                    ? "border-primary-ink bg-primary/8"
                    : "border-border bg-background hover:bg-muted/50",
                )}
                key={resource.id}
                onClick={() => setSelectedResourceId(resource.id)}
                type="button"
              >
                <span className="block text-sm font-semibold">
                  {resource.title}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {resource.type} · {resource.updated}
                </span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel
          description={`${selectedResource.type} · ${selectedResource.updated}`}
          title={selectedResource.title}
        >
          <p className="text-sm leading-6 text-muted-foreground">
            {selectedResource.summary}
          </p>
          <div className="mt-5 rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-sm leading-6">{selectedResource.body}</p>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Account, application, and technical questions go to the Apex team
            so the affiliate does not need access to private client records.
          </p>
        </Panel>
      </div>
    </>
  );
}

export type AffiliateLiveState =
  | { status: "loading" }
  | { status: "error" }
  /**
   * `FEATURE_AFFILIATES` is off and this is a real signed-in affiliate.
   *
   * The route used to pass `live: undefined` in that case, which is the fixture
   * shell's signal, so one flag being off handed a signed-in affiliate the whole
   * illustrative portal — a referral link at `apply.apexfundingpartners.com`,
   * another affiliate's lead book, and a resource library — as if it were their
   * account (G-R5-OWN-03). Distinct from `error`, because nothing failed and
   * saying it did would send them chasing an outage that is not there.
   */
  | { status: "disabled" }
  | { data: AffiliatePortal; status: "ready" };

type AffiliateSurfaceProps = SurfaceProps & {
  live?: AffiliateLiveState;
  sessionIdentity?: SessionDisplayIdentity;
};

const livePaymentLabels: Record<LivePaymentStatus, string> = {
  not_ready: "Not ready",
  pending: "Pending",
  submitted: "Submitted",
  paid: "Paid",
};

function formatPortalDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatPortalStage(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function livePaymentTone(status: LivePaymentStatus) {
  if (status === "paid") return "success" as const;
  if (status === "submitted") return "info" as const;
  if (status === "pending") return "warning" as const;
  return "neutral" as const;
}

function LivePortalTable({ rows }: { rows: AffiliatePortalRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center">
        <Send aria-hidden className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-3 text-sm font-semibold">No leads in this view</p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <Table className="min-w-[820px]">
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="text-right">Funding recorded</TableHead>
              <TableHead className="text-right">Expected commission</TableHead>
              <TableHead>Payment status</TableHead>
              <TableHead>Attention</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={`${row.startedAt}-${index}`}>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {formatPortalDate(row.startedAt)}
                </TableCell>
                <TableCell><StatusPill>{formatPortalStage(row.stage)}</StatusPill></TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {formatDemoMoney(row.fundedAmountCents / 100)}
                </TableCell>
                <TableCell className="text-right text-sm font-semibold tabular-nums">
                  {row.expectedCommissionCents === null
                    ? "—"
                    : formatDemoMoney(row.expectedCommissionCents / 100)}
                </TableCell>
                <TableCell>
                  <StatusPill tone={livePaymentTone(row.paymentStatus)}>
                    {livePaymentLabels[row.paymentStatus]}
                  </StatusPill>
                </TableCell>
                <TableCell>
                  {row.needsAttention ? <StatusPill tone="warning">Attention</StatusPill> : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="divide-y divide-border md:hidden">
        {rows.map((row, index) => (
          <article className="py-4 first:pt-0 last:pb-0" key={`${row.startedAt}-${index}`}>
            <div className="flex items-center justify-between gap-3">
              <StatusPill>{formatPortalStage(row.stage)}</StatusPill>
              {row.needsAttention ? <StatusPill tone="warning">Attention</StatusPill> : null}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-muted-foreground">Started</dt>
                <dd className="mt-1 text-xs tabular-nums">{formatPortalDate(row.startedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Funding recorded</dt>
                <dd className="mt-1 text-sm tabular-nums">{formatDemoMoney(row.fundedAmountCents / 100)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Expected commission</dt>
                <dd className="mt-1 text-sm font-semibold tabular-nums">
                  {row.expectedCommissionCents === null ? "—" : formatDemoMoney(row.expectedCommissionCents / 100)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Payment status</dt>
                <dd className="mt-1">
                  <StatusPill tone={livePaymentTone(row.paymentStatus)}>{livePaymentLabels[row.paymentStatus]}</StatusPill>
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}

function LiveAffiliateSurface({
  live,
  onOpenProfiles,
  sessionIdentity,
}: SurfaceProps & {
  live: AffiliateLiveState;
  sessionIdentity?: SessionDisplayIdentity;
}) {
  /**
   * This surface renders one affiliate's real referral rows, so the brand beside
   * them has to be the operator that affiliate actually works with. The name
   * comes from their profile's organization through the brand projection R2A-12
   * left them.
   *
   * There is no illustrative fallback here. `LiveAffiliateSurface` renders only
   * when `live !== undefined`, which is the durable route and never the
   * illustrative shell, so the fallback this used to carry was not a shell
   * default: it stamped one tenant's brand onto every affiliate whose profile
   * carried no organization, in the header, the initials tile, the page eyebrow
   * and the description sentence. Absent identity now renders the portal
   * unbranded -- "Affiliate portal" alone, with no initials tile -- because an
   * unbranded portal is merely plain, and a wrongly branded one is wrong.
   */
  const operatorName = sessionIdentity?.orgName ?? null;
  const metrics = live.status === "ready"
    ? [
        { label: "Sent leads", value: live.data.kpis.sentLeads },
        { label: "Active", value: live.data.kpis.active },
        { label: "In pipeline", value: live.data.kpis.inPipeline },
        {
          label: "Funding recorded",
          value: formatDemoMoney(live.data.kpis.fundingRecordedCents / 100, { compact: true }),
        },
      ]
    : [
        { label: "Sent leads", value: "—" },
        { label: "Active", value: "—" },
        { label: "In pipeline", value: "—" },
        { label: "Funding recorded", value: "—" },
      ];

  return (
    <div
      aria-busy={live.status === "loading"}
      className="min-h-[calc(100dvh-var(--demo-banner-height))] bg-background text-foreground"
      data-demo-theme="affiliate"
    >
      <header className="sticky top-[var(--demo-banner-height)] z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-[76rem] items-center gap-3 px-4 py-2 sm:px-6">
          <div className="flex min-h-11 min-w-0 items-center gap-2.5 px-1.5 py-1">
            {operatorName ? (
              <>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-[0.68rem] font-bold text-primary-foreground">{operatorBrandInitials(operatorName)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{operatorName}</span>
                  <span className="block truncate text-[0.68rem] text-muted-foreground">Affiliate portal</span>
                </span>
              </>
            ) : (
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">Affiliate portal</span>
              </span>
            )}
          </div>
          {/*
            Without an identity this trigger falls back to the illustrative
            affiliate persona, so a signed-in affiliate's own avatar showed
            somebody else's initials and somebody else's name. Passing the
            session identity keeps that roster off the durable path; an absent
            one leaves the trigger unlabelled by organization rather than
            borrowing a tenant's name (demo-chrome).
          */}
          <DemoRoleTrigger
            className="ml-auto"
            currentRole="affiliate"
            identity={
              sessionIdentity
                ? {
                    initials: displayInitials(sessionIdentity.name),
                    name: sessionIdentity.name,
                    organization: sessionIdentity.orgName ?? undefined,
                  }
                : undefined
            }
            onOpen={onOpenProfiles}
            variant="compact"
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[76rem] px-4 py-5 sm:px-6 sm:py-7">
        <PageHeader
          description={
            operatorName
              ? `Follow the business owners you sent to ${operatorName} and see the status of operator-managed commission records.`
              : "Follow the business owners you referred and see the status of operator-managed commission records."
          }
          eyebrow={operatorName ?? "Affiliate portal"}
          title="Affiliate dashboard"
        />
        <MetricStrip items={metrics} />
        <Panel
          className="mt-5"
          description="The newest clients visible to your affiliate account."
          title="Recent sent leads"
        >
          {live.status === "disabled" ? (
            <div className="py-12 text-center" role="status">
              <StatusPill tone="neutral">Referral records unavailable</StatusPill>
              <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
                The referral portal is not available in this workspace yet.
                Nothing failed, and this is not an empty portal — ask your
                operator for your current referral record.
              </p>
            </div>
          ) : live.status === "error" ? (
            /**
             * A bare "Unavailable" pill was indistinguishable from the empty
             * portal `LivePortalTable` renders for an affiliate with no leads
             * yet, so a failed read looked like "you have referred nobody" --
             * the one reading an affiliate is least able to check. This says
             * which of the two happened and how to recover, matching the
             * `adminReadReason` treatment on the admin surface.
             */
            <div className="py-12 text-center" role="alert">
              <StatusPill tone="warning">Referral records unavailable</StatusPill>
              <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
                Your referral records could not be loaded, so this is not an
                empty portal. Reload the page, and contact your operator if it
                keeps failing.
              </p>
            </div>
          ) : live.status === "ready" ? (
            <LivePortalTable rows={live.data.rows} />
          ) : (
            <div aria-hidden className="h-24 rounded-lg bg-muted" />
          )}
        </Panel>
      </main>
    </div>
  );
}

export function AffiliateSurface({ live, onOpenProfiles, sessionIdentity }: AffiliateSurfaceProps) {
  if (live !== undefined) {
    return <LiveAffiliateSurface live={live} onOpenProfiles={onOpenProfiles} sessionIdentity={sessionIdentity} />;
  }
  return <FixtureAffiliateSurface onOpenProfiles={onOpenProfiles} />;
}

function FixtureAffiliateSurface({ onOpenProfiles }: SurfaceProps) {
  const {
    affiliateShares,
    getClientFundedAmount: getTrackedClientFundedAmount,
  } = useFeedbackSession();
  const [activeView, setActiveView] = useState<PortalView>("dashboard");
  const [leadFilter, setLeadFilter] = useState<LeadFilter>("Referrals");
  const [copied, setCopied] = useState(false);

  const leads = useMemo(
    () =>
      affiliateShares
        .filter((share) => share.affiliateId === AFFILIATE_ID)
        .map((share): AffiliateLead | null => {
          const client = DEMO_CLIENTS.find(
            (candidate) => candidate.clientId === share.clientId,
          );
          if (!client) return null;
          return {
            share,
            client,
            fundedAmount: deriveClientFundedAmount(
              client.clientId,
              getTrackedClientFundedAmount(client.clientId),
            ),
            attribution:
              ["c1", "c3"].includes(client.clientId)
                ? "Rachel referral link"
                : "Apex team share",
          };
        })
        .filter((lead): lead is AffiliateLead => lead !== null)
        .sort((left, right) =>
          right.share.sharedAt.localeCompare(left.share.sharedAt),
        ),
    [affiliateShares, getTrackedClientFundedAmount],
  );

  async function copyReferralLink() {
    try {
      await navigator.clipboard.writeText(REFERRAL_LINK);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="min-h-[calc(100dvh-var(--demo-banner-height))] bg-background text-foreground"
      data-demo-theme="affiliate"
    >
      <header className="sticky top-[var(--demo-banner-height)] z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-[76rem] items-center gap-3 px-4 py-2 sm:px-6">
          <div className="flex min-h-11 min-w-0 items-center gap-2.5 px-1.5 py-1">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-[0.68rem] font-bold text-primary-foreground">
              AP
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                Apex Funding Partners
              </span>
              <span className="block truncate text-[0.68rem] text-muted-foreground">
                Affiliate portal
              </span>
            </span>
          </div>
          <DemoRoleTrigger
            className="ml-auto hidden w-auto border-0 bg-transparent shadow-none sm:flex"
            currentRole="affiliate"
            identity={{
              detail: "Summit Referral Network · Apex Funding Partners",
            }}
            onOpen={onOpenProfiles}
          />
          <DemoRoleTrigger
            className="ml-auto sm:hidden"
            currentRole="affiliate"
            onOpen={onOpenProfiles}
            variant="compact"
          />
        </div>
      </header>

      <nav
        aria-label="Affiliate portal"
        className="border-b border-border bg-card"
      >
        <div className="mx-auto flex w-full max-w-[76rem] overflow-x-auto px-4 sm:px-6">
          {portalViews.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex min-h-12 shrink-0 items-center gap-2 px-3 text-sm font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  isActive && "text-foreground",
                )}
                data-motion-axis="horizontal"
                data-motion-indicator="primary"
                data-motion-nav-item
                key={item.id}
                onClick={() => setActiveView(item.id)}
                type="button"
              >
                <Icon aria-hidden className="size-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      <main
        className="mx-auto w-full max-w-[76rem] px-4 py-5 sm:px-6 sm:py-7"
        data-motion-page
        key={activeView}
      >
        {activeView === "dashboard" ? (
          <DashboardView
            copied={copied}
            leads={leads}
            onCopy={copyReferralLink}
          />
        ) : null}
        {activeView === "leads" ? (
          <LeadsView
            filter={leadFilter}
            leads={leads}
            onFilterChange={setLeadFilter}
          />
        ) : null}
        {activeView === "commissions" ? (
          <CommissionsView leads={leads} />
        ) : null}
        {activeView === "resources" ? (
          <ResourcesView copied={copied} onCopy={copyReferralLink} />
        ) : null}
      </main>
    </div>
  );
}
