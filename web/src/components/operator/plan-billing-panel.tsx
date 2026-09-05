"use client";

// plan-billing-panel.tsx — the operator's own platform subscription, read from
// `/api/billing/subscription` and nowhere else.
//
// Every value on this panel comes from the billing record the route returns.
// It carries a plan name, a membership rung, the provider's subscription
// status, the billed seat quantity, the included seat allowance, the client
// meter, the period end and any pending seat sync. It does not carry a card,
// an invoice or an amount, so none of those are drawn here; the hosted portal
// is where they live.

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Panel, StatusPill } from "@/components/demo/shared";
import { Button } from "@/components/ui/button";
import {
  loadPlatformBilling,
  openPlatformBillingPortal,
  platformBillingProvider,
  PlatformBillingActionError,
  startPlatformCheckout,
  type PlatformBillingRead,
  type PlatformBillingState,
} from "@/lib/operator/platform-billing.client";

type PanelRead = PlatformBillingRead | { readonly state: "loading" };

const MEMBERSHIP_LABEL: Record<NonNullable<PlatformBillingState["membership"]>, { label: string; tone: "danger" | "info" | "neutral" | "success" | "warning" }> = {
  current: { label: "Current", tone: "success" },
  deactivated: { label: "Deactivated", tone: "danger" },
  grace: { label: "Grace period", tone: "warning" },
  past_due: { label: "Past due", tone: "warning" },
  trial: { label: "Trial", tone: "info" },
};

const STATUS_LABEL: Record<NonNullable<PlatformBillingState["status"]>, string> = {
  active: "Active",
  canceled: "Canceled",
  incomplete: "Incomplete",
  incomplete_expired: "Incomplete, expired",
  past_due: "Past due",
  paused: "Paused",
  trialing: "Trialing",
  unpaid: "Unpaid",
};

function displayDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function periodRow(billing: PlatformBillingState): { label: string; value: string } | null {
  if (billing.graceUntil) return { label: "Grace period until", value: displayDate(billing.graceUntil) };
  if (!billing.currentPeriodEnd) return null;
  if (billing.cancelAtPeriodEnd) return { label: "Ends on", value: displayDate(billing.currentPeriodEnd) };
  if (billing.membership === "trial" || billing.status === "trialing") {
    return { label: "Trial ends", value: displayDate(billing.currentPeriodEnd) };
  }
  return { label: "Renews on", value: displayDate(billing.currentPeriodEnd) };
}

function seatsValue(billing: PlatformBillingState): string {
  const included = billing.seatsIncluded === null ? "no included allowance set" : `${billing.seatsIncluded} included`;
  return `${billing.seatQuantity} billed · ${included}`;
}

function ReadNotice({ read }: { read: Exclude<PanelRead, { state: "loading" | "ready" }> }) {
  const message = read.state === "disabled"
    ? "Platform billing is not turned on for this deployment, so no plan is shown."
    : read.state === "session_required"
      ? "Sign in again to view this workspace's plan."
      : read.state === "forbidden"
        ? "Only workspace owners and admins can view billing. Nothing is shown for this account."
        : read.state === "deactivated"
          ? "This workspace is deactivated. Billing cannot be viewed or changed from here."
          : read.state === "no_record"
            ? "No billing record was found for this workspace."
            : "The plan could not be loaded right now.";
  return (
    <p className="text-sm text-muted-foreground" role={read.state === "unavailable" ? "alert" : "status"}>
      {message}
    </p>
  );
}

export function PlanBillingPanel({ enabled = true }: { enabled?: boolean }) {
  const [read, setRead] = useState<PanelRead>({ state: "loading" });
  const [reloadVersion, setReloadVersion] = useState(0);
  const [pending, setPending] = useState<"checkout" | "portal" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setRead({ state: "loading" });
    });
    void loadPlatformBilling().then((next) => {
      if (active) setRead(next);
    });
    return () => {
      active = false;
    };
  }, [enabled, reloadVersion]);

  async function navigateTo(kind: "checkout" | "portal") {
    setPending(kind);
    setProblem(null);
    try {
      const url = kind === "checkout"
        ? await startPlatformCheckout()
        : await openPlatformBillingPortal();
      window.location.assign(url);
    } catch (error) {
      setProblem(error instanceof PlatformBillingActionError
        ? error.message
        : kind === "checkout"
          ? "The checkout could not be opened."
          : "The billing portal could not be opened.");
      setPending(null);
    }
  }

  if (!enabled) {
    return (
      <Panel title="Plan &amp; billing">
        <p className="text-sm text-muted-foreground" role="status">
          This workspace&rsquo;s plan is not readable from this screen, so nothing is shown.
        </p>
      </Panel>
    );
  }

  if (read.state === "loading") {
    return (
      <Panel title="Plan &amp; billing">
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircle aria-hidden className="size-4 animate-spin" /> Loading this workspace&rsquo;s plan.
        </p>
      </Panel>
    );
  }

  if (read.state !== "ready") {
    return (
      <Panel title="Plan &amp; billing">
        <div className="space-y-3">
          <ReadNotice read={read} />
          {read.state === "unavailable" ? (
            <Button onClick={() => setReloadVersion((value) => value + 1)} size="sm" variant="outline">
              Try again
            </Button>
          ) : null}
        </div>
      </Panel>
    );
  }

  const { billing } = read;
  const hasSubscription = billing.subscriptionRef !== null;
  const provider = platformBillingProvider(billing);
  const membership = billing.membership ? MEMBERSHIP_LABEL[billing.membership] : null;
  const period = periodRow(billing);
  const statusValue = billing.status
    ? STATUS_LABEL[billing.status]
    : hasSubscription
      ? "Reported by the provider in a state this screen does not name"
      : "No subscription";

  return (
    <Panel
      title="Plan &amp; billing"
      trailing={membership ? <StatusPill tone={membership.tone}>{membership.label}</StatusPill> : null}
    >
      <div className="space-y-4 text-sm">
        <Row label="Plan" value={billing.plan ?? "No plan set"} />
        <Row label="Subscription" value={statusValue} />
        <Row label="Seats" value={seatsValue(billing)} />
        {billing.seatSync ? (
          <p className="text-xs leading-5 text-muted-foreground" role="status">
            A seat change to {billing.seatSync.desiredQuantity} is waiting to sync with the billing provider
            ({billing.seatSync.status}, {billing.seatSync.attempts} {billing.seatSync.attempts === 1 ? "attempt" : "attempts"}).
          </p>
        ) : null}
        <Row label="Active clients" value={billing.clientMeter.label} />
        {period ? <Row label={period.label} value={period.value} /> : null}
        {hasSubscription ? null : (
          <p className="text-muted-foreground" role="status">
            No subscription has been started for this workspace.
          </p>
        )}
        <p className="text-xs leading-5 text-muted-foreground">
          Payment method, invoices and amounts are not part of this record. They are shown in the billing portal.
        </p>
        {provider === "mock" ? (
          <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground" role="status">
            This deployment is running the mock billing driver, so these buttons open a placeholder page and no card is reached.
          </p>
        ) : null}
        {problem ? (
          <p className="text-sm text-destructive" role="alert">{problem}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {hasSubscription ? (
            <Button disabled={pending !== null} onClick={() => void navigateTo("portal")} variant="outline">
              {pending === "portal" ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
              Manage billing
            </Button>
          ) : (
            <Button disabled={pending !== null} onClick={() => void navigateTo("checkout")}>
              {pending === "checkout" ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
              Start subscription
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
