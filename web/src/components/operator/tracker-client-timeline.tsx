"use client";

import { useEffect, useMemo, useState } from "react";

import {
  expandTransitions,
  resolveRow,
  titleText,
} from "@/components/chat/timeline";
import {
  readSupportInbox,
  readSupportThread,
} from "@/lib/operator/support-inbox.client";
import type { TimelineEvent } from "@/lib/timeline/types";

type TimelineState =
  | { state: "loading" }
  | { state: "unavailable" }
  | { events: readonly TimelineEvent[]; readFailed: boolean; state: "ready" };

function eventDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function TrackerClientTimeline({
  clientId,
  enabled,
}: {
  clientId: string;
  enabled: boolean;
}) {
  const [read, setRead] = useState<TimelineState>({ state: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setRead({ state: "loading" });
    });

    void readSupportInbox().then(async (inbox) => {
      if (!active) return;
      if (inbox.state !== "ready") {
        setRead({ state: "unavailable" });
        return;
      }
      const thread = inbox.threads
        .filter((row) => row.kind === "team_chat" && row.clientId === clientId)
        .sort(
          (left, right) =>
            new Date(right.lastActivityAt).getTime()
            - new Date(left.lastActivityAt).getTime(),
        )[0];
      if (!thread) {
        setRead({ events: [], readFailed: false, state: "ready" });
        return;
      }
      const detail = await readSupportThread(thread.id);
      if (!active) return;
      if (detail.state !== "ready" || detail.timeline === undefined) {
        setRead({ state: "unavailable" });
        return;
      }
      setRead({
        events: detail.timeline.events,
        readFailed: detail.timeline.readFailed === true,
        state: "ready",
      });
    });

    return () => {
      active = false;
    };
  }, [clientId, enabled]);

  const rows = useMemo(() => {
    if (read.state !== "ready") return [];
    return expandTransitions(
      read.events.filter((event) => event.kind !== "stage_changed"),
      "operator",
    )
      .map((event) => ({ event, view: resolveRow(event, "operator") }))
      .filter((entry) => entry.view !== null)
      .sort(
        (left, right) =>
          new Date(right.event.at).getTime() - new Date(left.event.at).getTime(),
      );
  }, [read]);

  if (!enabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Conversation updates are not enabled for this workspace.
      </p>
    );
  }
  if (read.state === "loading") {
    return <p className="text-sm text-muted-foreground">Loading client updates…</p>;
  }
  if (read.state === "unavailable") {
    return (
      <p className="text-sm text-muted-foreground">
        Conversation updates are unavailable. Stage history remains visible above.
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No conversation updates are recorded for this client.
      </p>
    );
  }

  return (
    <div>
      {read.readFailed ? (
        <p className="mb-3 text-xs text-destructive" role="alert">
          Some client updates could not be loaded.
        </p>
      ) : null}
      <ol className="divide-y divide-border border-y border-border">
        {rows.map(({ event, view }) => {
          if (view === null) return null;
          return (
            <li className="grid gap-1 py-3 text-sm sm:grid-cols-[9rem_1fr]" key={event.ref}>
              <time className="font-mono text-xs text-muted-foreground tabular-nums" dateTime={event.at}>
                {eventDate(event.at)}
              </time>
              <div>
                <p className="font-medium">{titleText(view.title)}</p>
                {view.layout === "band" && view.body ? (
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{view.body}</p>
                ) : null}
                {view.operatorOnly ? (
                  <p className="mt-1 text-[0.68rem] font-medium text-muted-foreground">Team only</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
