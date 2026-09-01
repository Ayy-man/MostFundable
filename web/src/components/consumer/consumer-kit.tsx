import type { ReactNode } from "react";
import {
  Check,
  Clock3,
  Info,
  LoaderCircle,
  LockKeyhole,
  Pause,
  ReceiptText,
  TriangleAlert,
} from "lucide-react";

import { cn } from "@/lib/utils";

export function ConsumerPageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  title: string;
}) {
  // #207 freezes page headers at title plus optional actions while preserving
  // the caller contract for this frontend freeze.
  void description;
  void eyebrow;
  return (
    <header className="mb-5 flex flex-col gap-4 border-b border-[var(--consumer-border)] pb-5 sm:mb-6 sm:flex-row sm:items-end sm:justify-between sm:pb-6">
      <div className="max-w-3xl">
        <h1
          className="text-[1.65rem] font-semibold leading-tight tracking-[-0.035em] text-foreground outline-none sm:text-[1.9rem]"
          id="consumer-view-heading"
          tabIndex={-1}
        >
          {title}
        </h1>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function WorkspaceSection({
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
        "overflow-hidden rounded-[10px] border border-[var(--consumer-surface-border)] bg-card text-card-foreground shadow-[var(--consumer-surface-shadow)]",
        className,
      )}
    >
      {title || description || trailing ? (
        <div className="flex min-h-14 items-start justify-between gap-4 border-b border-[var(--consumer-border)] px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-[0.86rem] font-semibold tracking-[-0.015em]">
                {title}
              </h2>
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

const statusStyles = {
  danger:
    "border-[color-mix(in_srgb,var(--consumer-negative),transparent_72%)] bg-[color-mix(in_srgb,var(--consumer-negative),transparent_92%)] text-[var(--consumer-negative)]",
  info: "border-[color-mix(in_srgb,var(--consumer-accent-ink),transparent_52%)] bg-[var(--consumer-accent-tint)] text-[var(--consumer-accent-ink)]",
  neutral: "border-[var(--consumer-border)] bg-[var(--consumer-canvas)] text-muted-foreground",
  success:
    "border-[color-mix(in_srgb,var(--consumer-positive),transparent_74%)] bg-[color-mix(in_srgb,var(--consumer-positive),transparent_92%)] text-[var(--consumer-positive)]",
  warning:
    "border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_68%)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_62%)] text-[var(--consumer-warning-ink)]",
} as const;

const statusIcons = {
  danger: TriangleAlert,
  info: Info,
  neutral: Clock3,
  success: Check,
  warning: TriangleAlert,
};

export function StatusTag({
  children,
  className,
  icon,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  tone?: keyof typeof statusStyles;
}) {
  const Icon = statusIcons[tone];
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.67rem] font-semibold leading-4",
        statusStyles[tone],
        className,
      )}
    >
      {icon === false ? null : icon ?? <Icon aria-hidden className="size-3" />}
      {children}
    </span>
  );
}

export function SourceStamp({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-[0.68rem] leading-5 text-muted-foreground",
        className,
      )}
    >
      <Info aria-hidden className="size-3.5 shrink-0" />
      {children}
    </p>
  );
}

export function MetricRow({
  items,
}: {
  items: Array<{
    detail?: ReactNode;
    label: string;
    tone?: "default" | "positive" | "negative";
    value: ReactNode;
  }>;
}) {
  return (
    <dl className="grid overflow-hidden rounded-[10px] border border-[var(--consumer-surface-border)] bg-card shadow-[var(--consumer-surface-shadow)] sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item, index) => (
        <div
          className={cn(
            "min-h-24 px-4 py-4 sm:px-5",
            index > 0 && "border-t border-[var(--consumer-border)] sm:border-l sm:border-t-0",
            index === 2 &&
              "sm:border-l-0 sm:border-t xl:border-l xl:border-t-0",
          )}
          key={item.label}
        >
          <dt className="text-[0.67rem] font-medium text-muted-foreground">
            {item.label}
          </dt>
          <dd
            className={cn(
              "mt-1.5 text-2xl font-semibold tracking-[-0.025em] tabular-nums",
              item.tone === "positive" && "text-[var(--consumer-positive)]",
              item.tone === "negative" && "text-[var(--consumer-negative)]",
            )}
          >
            {item.value}
          </dd>
          {item.detail ? (
            <div className="mt-1 text-[0.68rem] text-muted-foreground">
              {item.detail}
            </div>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

export function LabeledProgress({
  label,
  target,
  value,
}: {
  label: string;
  target?: number;
  value: number;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">{value}%</span>
      </div>
      <div
        aria-label={`${label}, ${value} percent${target ? `, target ${target} percent` : ""}`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={value}
        className="relative h-1.5 overflow-visible rounded-full bg-[var(--consumer-border)]"
        role="progressbar"
      >
        <span
          className="block h-full rounded-full bg-[var(--consumer-accent-ink)]"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
        {target ? (
          <span
            aria-hidden
            className="absolute top-[-3px] h-3 w-px bg-foreground/70"
            style={{ left: `${target}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}

export type ConsumerState =
  | "active"
  | "locked"
  | "paused"
  | "reported"
  | "todo"
  | "verifying"
  | "verified";

export function StateMarker({
  size = "md",
  state,
}: {
  size?: "md" | "sm";
  state: ConsumerState;
}) {
  const Icon =
    state === "verified"
      ? Check
      : state === "verifying"
        ? LoaderCircle
        : state === "locked"
          ? LockKeyhole
          : state === "paused"
            ? Pause
            : state === "reported"
              ? ReceiptText
              : Clock3;

  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full border",
        size === "sm" ? "size-6" : "size-8",
        state === "verified" &&
          "border-[var(--consumer-positive)] bg-[var(--consumer-positive)] text-[var(--consumer-canvas)]",
        (state === "active" || state === "reported") &&
          "border-[var(--consumer-accent-ink)] bg-[var(--consumer-accent-tint)] text-[var(--consumer-accent-ink)]",
        state === "verifying" &&
          "border-dashed border-[var(--consumer-accent-ink)] bg-[var(--consumer-accent-tint)] text-[var(--consumer-accent-ink)]",
        state === "paused" &&
          "border-dashed border-[var(--consumer-muted)] bg-[var(--consumer-canvas)] text-[var(--consumer-muted)]",
        (state === "locked" || state === "todo") &&
          "border-[var(--consumer-border)] bg-card text-muted-foreground",
      )}
    >
      <Icon
        className={cn(
          size === "sm" ? "size-3" : "size-3.5",
          state === "verifying" && "animate-spin motion-reduce:animate-none",
        )}
      />
    </span>
  );
}
