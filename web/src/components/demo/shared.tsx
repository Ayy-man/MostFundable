import type { ReactNode } from "react";
import { ArrowUpRight, Check, Clock3, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export function PageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  title: ReactNode;
}) {
  // #207 freezes page headers at title plus optional actions. These inputs stay
  // accepted so existing callers do not require a conflict-prone mechanical edit.
  void description;
  void eyebrow;
  return (
    <header className="mb-6 flex flex-col gap-4 border-b border-border pb-6 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <h1 className="text-balance text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-[2rem]">
          {title}
        </h1>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function Panel({
  children,
  className,
  description,
  title,
  trailing,
}: {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  title?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card text-card-foreground shadow-[var(--consumer-surface-shadow)]",
        className,
      )}
    >
      {title || description || trailing ? (
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
          <div>
            {title ? (
              <h2 className="text-sm font-semibold tracking-[-0.01em]">{title}</h2>
            ) : null}
            {description ? (
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {description}
              </div>
            ) : null}
          </div>
          {trailing ? <div className="shrink-0">{trailing}</div> : null}
        </div>
      ) : null}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function MetricStrip({
  items,
}: {
  items: Array<{ change?: string; label: string; value: ReactNode }>;
}) {
  return (
    <dl className="grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item, index) => (
        <div
          className={cn(
            "px-4 py-4 sm:px-5",
            index > 0 && "border-t border-border sm:border-l sm:border-t-0",
            index === 2 &&
              "sm:border-l-0 sm:border-t xl:border-l xl:border-t-0",
          )}
          key={item.label}
        >
          <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {item.label}
          </dt>
          <dd className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-[-0.03em] tabular-nums">
              {item.value}
            </span>
            {item.change ? (
              <span className="text-xs font-medium text-primary-ink">{item.change}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const statusStyles = {
  danger: "border-destructive/20 bg-destructive/10 text-destructive",
  info: "border-primary/20 bg-primary/10 text-primary-ink",
  neutral: "border-border bg-muted text-muted-foreground",
  success:
    "border-[color-mix(in_srgb,var(--consumer-positive),transparent_74%)] bg-[color-mix(in_srgb,var(--consumer-positive),transparent_92%)] text-[var(--consumer-positive)]",
  warning:
    "border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_68%)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_55%)] text-[var(--consumer-warning-ink)]",
} as const;

export function StatusPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof statusStyles;
}) {
  return (
    <Badge
      className={cn(
        "rounded-full px-2 py-0.5 text-[0.68rem] font-semibold",
        statusStyles[tone],
      )}
      variant="outline"
    >
      {children}
    </Badge>
  );
}

export function ReadinessBar({
  label,
  value,
}: {
  label?: string;
  value: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4 text-xs">
        <span className="text-muted-foreground">{label ?? "Readiness"}</span>
        <span className="font-semibold tabular-nums">{value}%</span>
      </div>
      <Progress aria-label={label ?? "Readiness"} value={value} />
    </div>
  );
}

export function EmptyState({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div
      className="flex min-h-60 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/25 px-6 py-12 text-center"
      data-motion-state
    >
      <span className="mb-4 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Info aria-hidden className="size-4" />
      </span>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ActionRow({
  action,
  description,
  state = "pending",
  title,
}: {
  action?: ReactNode;
  description: string;
  state?: "complete" | "pending" | "active";
  title: string;
}) {
  const StateIcon =
    state === "complete" ? Check : state === "active" ? ArrowUpRight : Clock3;

  return (
    <div className="flex items-start gap-3 border-b border-border py-4 first:pt-0 last:border-0 last:pb-0">
      <span
        className={cn(
          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full",
          state === "complete"
            ? "bg-[color-mix(in_srgb,var(--consumer-positive),transparent_88%)] text-[var(--consumer-positive)]"
            : state === "active"
              ? "bg-primary/10 text-primary-ink"
              : "bg-muted text-muted-foreground",
        )}
      >
        <StateIcon aria-hidden className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      {action ??
        (state === "active" ? (
          <Button size="sm" variant="outline">
            Open
          </Button>
        ) : null)}
    </div>
  );
}
