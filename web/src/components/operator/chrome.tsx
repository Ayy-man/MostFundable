"use client";

// The operator chrome the Inbox needs and the surface file still uses.
//
// They were declared inside `surfaces/operator.tsx` and the Inbox extraction had to reach them
// somehow. Exporting them back out of a 7,000-line surface would make the dependency circular —
// the surface imports the Inbox, the Inbox imports the surface — so they live here instead, in
// one small module both sides import. The bodies are unchanged.
//
// `ClientIdentity` takes a structural shape rather than the surface's `Client` type, which is
// derived from a fixture array and cannot leave that file. Every existing call site passes a
// `Client`, which satisfies it.

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/demo/shared";

export function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

// Fixture enums are lowercase tokens; nothing user-facing may render them raw.
export function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Durable rows carry full ISO timestamps, not the `YYYY-MM-DD` strings the
 * fixtures use, so `formatDate` above would produce an Invalid Date on them.
 * Fixed to UTC for the same reason the tracker table is: the timestamp is the
 * one the database recorded, and shifting it per viewer makes two operators
 * disagree about when a stage changed.
 */
export function formatDurableTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

export function CompactHeader({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: ReactNode;
  description?: string;
  icon: LucideIcon;
  title: string;
}) {
  // #207 keeps the existing signature local while suppressing decorative
  // title icons through the shared title-only page-header contract.
  void Icon;
  return (
    <PageHeader
      actions={action}
      description={description}
      title={title}
    />
  );
}

export function ClientIdentity({ client }: { client: { business: string; name: string } }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-[0.68rem] font-semibold text-muted-foreground">
        {initials(client.name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{client.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {client.business}
        </span>
      </span>
    </div>
  );
}
