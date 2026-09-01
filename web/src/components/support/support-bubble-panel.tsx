"use client";

// The flag-on body of the operator support bubble.
//
// It fetches the bootstrap on open, lists the threads the session can see, and hands the selected
// one to `SupportThreadView`. What it deliberately does not have: a held-replies tab, a
// cross-thread list of drafts, and a badge counting them. #192 removed that panel, and the way to
// keep it removed is for there to be no place to put it — there is one draft, it belongs to one
// thread, and it is visible only while that thread is open.
//
// Every failure here degrades to a message rather than a broken pane, because this renders inside
// a Sheet on a page that is working fine and a thrown error would take the surrounding surface
// with it.

import { useCallback, useEffect, useState } from "react";

import {
  SupportThreadView,
  type SupportThreadViewDraft,
  type SupportThreadViewMessage,
} from "@/components/support/support-thread-view";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ThreadSummary {
  readonly id: string;
  readonly kind: "team_chat" | "platform_support";
  readonly subject: string;
  readonly status: "open" | "pending" | "resolved";
  readonly lastActivityAt: string;
}

interface ThreadPayload {
  readonly thread: ThreadSummary;
  readonly messages: readonly SupportThreadViewMessage[];
  readonly draft: SupportThreadViewDraft | null;
}

export interface SupportBubblePanelProps {
  /** Staff sessions can ask for a suggestion; a consumer session never sees one. */
  readonly canDraft?: boolean;
}

const KIND_LABEL: Readonly<Record<ThreadSummary["kind"], string>> = {
  platform_support: "Platform support",
  team_chat: "Client thread",
};

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Pure fetch helpers, outside the component, so the effects below hold no state logic. */
async function fetchThreads(): Promise<ThreadSummary[]> {
  try {
    const response = await fetch("/api/support/threads", { cache: "no-store" });
    const body = (await readJson(response)) as { threads?: ThreadSummary[] } | null;
    return Array.isArray(body?.threads) ? body.threads : [];
  } catch {
    return [];
  }
}

async function fetchThread(
  threadId: string,
): Promise<{ payload: ThreadPayload | null; problem: string | null }> {
  try {
    const response = await fetch(`/api/support/threads/${threadId}`, { cache: "no-store" });
    if (!response.ok) {
      return { payload: null, problem: "That conversation could not be opened." };
    }
    return { payload: (await readJson(response)) as ThreadPayload | null, problem: null };
  } catch {
    return { payload: null, problem: "That conversation could not be opened." };
  }
}

export function SupportBubblePanel({ canDraft = true }: SupportBubblePanelProps) {
  const [threads, setThreads] = useState<readonly ThreadSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payload, setPayload] = useState<ThreadPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Bumped after every write; both effects depend on it, so one counter is the whole refresh
  // mechanism and there is no second copy of the fetch logic living in the action handler.
  const [reloadToken, setReloadToken] = useState(0);



  // Both effects do their state writes after an await and behind a cancelled flag, so a Sheet
  // closed mid-request does not write into an unmounted panel and the lint rule against
  // synchronous setState in an effect body is satisfied honestly rather than suppressed.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await fetchThreads();
      if (cancelled) return;
      setThreads(list);
      setSelectedId((current) => current ?? list[0]?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    if (selectedId === null) return undefined;
    let cancelled = false;
    void (async () => {
      const next = await fetchThread(selectedId);
      if (cancelled) return;
      setPayload(next.payload);
      setProblem(next.problem);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, selectedId]);

  /**
   * One place where every write goes out and the thread comes back.
   *
   * Re-reading after each action rather than patching local state is deliberate: the draft's
   * status, the message list, and whether a draft is open at all are all decided by the database,
   * and a local guess about any of them would eventually disagree with what the RPC actually did.
   */
  const act = useCallback(
    async (request: () => Promise<Response>, failure: string) => {
      if (selectedId === null || busy) return;
      setBusy(true);
      setProblem(null);
      try {
        const response = await request();
        if (!response.ok) setProblem(failure);
      } catch {
        setProblem(failure);
      } finally {
        setBusy(false);
        setReloadToken((current) => current + 1);
      }
    },
    [busy, selectedId],
  );

  /**
   * Start a thread with the platform team.
   *
   * The only kind this surface can open. A `team_chat` belongs to one client and is opened from
   * the client's side, so there is deliberately no client picker here — a picker would be a
   * second place in the product that decides which clients an operator may write to.
   */
  const startPlatformThread = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch("/api/support/threads", {
        body: JSON.stringify({ kind: "platform_support", subject: "Question for the platform team" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) setProblem("That thread could not be started.");
    } catch {
      setProblem("That thread could not be started.");
    } finally {
      setBusy(false);
      setReloadToken((current) => current + 1);
    }
  }, [busy]);

  const post = (body: { body: string; draftId?: string }) =>
    act(
      () =>
        fetch(`/api/support/threads/${selectedId}/messages`, {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      "That message was not sent. Nothing was posted to the thread.",
    );

  const generate = () =>
    act(
      () => fetch(`/api/support/threads/${selectedId}/draft`, { method: "POST" }),
      "No suggestion could be prepared just now.",
    );

  const discard = () =>
    act(
      () => fetch(`/api/support/threads/${selectedId}/draft`, { method: "DELETE" }),
      "That suggestion could not be discarded.",
    );

  if (threads.length === 0) {
    return (
      <div className="space-y-3 p-5">
        <p className="text-sm text-muted-foreground">
          No conversations yet. A client thread appears here as soon as one of your clients writes
          in, and you can start a thread with the platform team whenever you need one.
        </p>
        <Button disabled={busy} onClick={() => void startPlatformThread()} size="sm" type="button">
          Ask the platform team
        </Button>
        {problem === null ? null : (
          <p className="text-xs text-muted-foreground">{problem}</p>
        )}
      </div>
    );
  }

  return (
    <div className="grid min-h-[28rem] grid-cols-1 gap-0 sm:grid-cols-[14rem_minmax(0,1fr)]">
      <div className="flex flex-col border-b border-border sm:border-b-0 sm:border-r">
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Button
                className={cn(
                  "h-auto w-full justify-start whitespace-normal px-3 py-2 text-left",
                  thread.id === selectedId ? "bg-muted" : null,
                )}
                onClick={() => setSelectedId(thread.id)}
                type="button"
                variant="ghost"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">{thread.subject}</span>
                  <span className="text-[0.66rem] text-muted-foreground">
                    {KIND_LABEL[thread.kind]} · {thread.status}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
        <div className="border-t border-border p-2">
          <Button
            className="w-full"
            disabled={busy}
            onClick={() => void startPlatformThread()}
            size="sm"
            type="button"
            variant="outline"
          >
            Ask the platform team
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-col p-4">
        {problem === null ? null : (
          <p className="mb-3 rounded-[10px] border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {problem}
          </p>
        )}
        {payload === null ? (
          <p className="text-sm text-muted-foreground">Opening the conversation.</p>
        ) : (
          <SupportThreadView
            busy={busy}
            canDraft={canDraft}
            draft={payload.draft}
            messages={payload.messages}
            onDiscard={discard}
            onGenerate={generate}
            onSend={(body, draftId) => post(draftId === undefined ? { body } : { body, draftId })}
            subject={payload.thread.subject}
          />
        )}
      </div>
    </div>
  );
}
