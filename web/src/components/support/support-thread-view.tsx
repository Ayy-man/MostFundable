"use client";

// One support thread: the conversation, and a composer with the draft inside it.
//
// The draft lives in the composer rather than in a panel of its own, and that is the whole of
// #192. A separate review surface is a queue, a queue has a length, a length wants clearing, and
// something that wants clearing eventually gets a "send all" button. There is no such surface
// here, and `verify-no-auto-send.mjs` rule 5 keeps a route from appearing that could host one.
//
// Two things this component will not do. It never offers a send action on a draft whose status is
// not `approved` — migration 101 would refuse it anyway, but a button that always fails is worse
// than no button. And it never edits a draft in place: an edited draft is a human message, sent
// without the pairing, because `held_drafts.body` is the audited record of what the model actually
// produced and a message marked `ai_assisted` has to match it byte for byte.

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { canSendHeldDraft, pairingFor } from "@/lib/support/draft-send";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface SupportThreadViewMessage {
  readonly id: string;
  readonly authorKind: "consumer" | "operator" | "admin";
  readonly origin: "human" | "ai_assisted";
  readonly body: string;
  readonly sentAt: string;
}

export interface SupportThreadViewDraft {
  readonly id: string;
  readonly body: string;
  readonly confidence: number;
  readonly confidenceThreshold: number;
  readonly guardrailFlags: readonly string[];
  readonly status: "draft" | "approved" | "sent" | "discarded";
}

export interface SupportThreadViewProps {
  readonly subject: string;
  readonly messages: readonly SupportThreadViewMessage[];
  readonly draft: SupportThreadViewDraft | null;
  readonly canDraft: boolean;
  readonly busy: boolean;
  readonly onSend: (body: string, draftId?: string) => void | Promise<void>;
  readonly onGenerate: () => void | Promise<void>;
  readonly onDiscard: () => void | Promise<void>;
  /**
   * What the composer says when it is empty. The operator Inbox writes under
   * the workspace's own brand, and the bubble does not, so the default is the
   * neutral one and the caller that has a brand passes it.
   */
  readonly composerPlaceholder?: string;
  /**
   * Why nothing can be sent, when nothing can be.
   *
   * A resolved thread refuses a send in the database (migration 101,
   * `SUPPORT_THREAD_CLOSED`). Leaving the composer live and letting the refusal
   * come back as a generic failure teaches the operator that sending is broken
   * rather than that the thread is closed, so the caller passes the reason and
   * every send control goes away behind it.
   */
  readonly lockedReason?: string | null;
}

const AUTHOR_LABEL: Readonly<Record<SupportThreadViewMessage["authorKind"], string>> = {
  admin: "Platform team",
  consumer: "Client",
  operator: "Your team",
};

function formatSent(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  });
}

export function SupportThreadView({
  busy,
  canDraft,
  composerPlaceholder = "Write a reply",
  draft,
  lockedReason = null,
  messages,
  onDiscard,
  onGenerate,
  onSend,
  subject,
}: SupportThreadViewProps) {
  const [input, setInput] = useState("");

  const locked = lockedReason !== null;
  // The rule itself lives in `lib/support/draft-send`, which the operator Inbox's composer calls
  // too. It was written out here first, above a comment saying a second copy would be a second
  // place to lose it; the second surface arrived, so it moved rather than being copied.
  const sendable = canSendHeldDraft(draft, { locked });

  async function submitTyped(event: FormEvent) {
    event.preventDefault();
    const body = input.trim();
    if (!body || busy || locked) return;
    // No draft id, and deliberately not even asked for: whatever is in this box is the person's
    // own message, even if they pasted the draft into it verbatim. The pairing is created by the
    // button below and by nothing else, which is what keeps the `ai_assisted` origin meaning "a
    // person reviewed this exact suggestion and pressed send on it".
    await onSend(body);
    setInput("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <p className="text-sm font-semibold text-foreground">{subject}</p>

      <div aria-live="polite" className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No messages yet. Anything you send here goes to the people on this thread.
          </p>
        ) : null}
        {messages.map((message) => (
          <div
            className={cn("flex", message.authorKind === "consumer" ? "justify-start" : "justify-end")}
            key={message.id}
          >
            <div
              className={cn(
                "max-w-[88%] rounded-[10px] px-4 py-3 text-sm leading-6",
                message.authorKind === "consumer"
                  ? "bg-muted text-foreground"
                  : "bg-primary/10 text-foreground",
              )}
            >
              <p className="mb-1 flex flex-wrap items-center gap-2 text-[0.68rem] font-semibold text-muted-foreground">
                <span>{AUTHOR_LABEL[message.authorKind]}</span>
                <span aria-hidden>·</span>
                <span className="font-normal">{formatSent(message.sentAt)}</span>
                {message.origin === "ai_assisted" ? (
                  <span className="rounded-full bg-background px-2 py-0.5 font-normal">
                    written with a suggestion, sent by a person
                  </span>
                ) : null}
              </p>
              {message.body}
            </div>
          </div>
        ))}
      </div>

      <form className="space-y-3 border-t border-border pt-4" onSubmit={submitTyped}>
        {canDraft && draft !== null ? (
          <div className="space-y-3 rounded-[10px] border border-border bg-muted/40 p-3">
            <p className="flex flex-wrap items-center gap-2 text-[0.68rem] font-semibold text-muted-foreground">
              <span>Suggested reply</span>
              <span aria-hidden>·</span>
              <span className="font-normal tabular-nums">
                confidence {draft.confidence.toFixed(2)} against a bar of{" "}
                {draft.confidenceThreshold.toFixed(2)}
              </span>
              {draft.guardrailFlags.length > 0 ? (
                <span className="font-normal">
                  · flagged: {draft.guardrailFlags.join(", ")}
                </span>
              ) : null}
            </p>

            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{draft.body}</p>

            {sendable ? (
              <p className="text-[0.66rem] text-muted-foreground">
                Nothing is sent until you press send. Change a word and it becomes your own message
                instead, without the suggestion attached.
              </p>
            ) : locked ? (
              <p className="text-[0.66rem] text-muted-foreground">
                Kept for reference. Nothing can be sent on this conversation as it stands.
              </p>
            ) : (
              <p className="text-[0.66rem] text-muted-foreground">
                This one did not clear its checks, so it cannot be sent as written. Read it, take
                what is useful, and write the reply yourself below.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {sendable ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void onSend(draft.body, pairingFor(draft.body, draft, { locked }) ?? undefined)
                  }
                  size="sm"
                  type="button"
                >
                  Send this reply
                </Button>
              ) : null}
              {locked ? null : (
                <Button
                  disabled={busy}
                  onClick={() => setInput(draft.body)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Copy into my reply
                </Button>
              )}
              {locked ? null : (
                <Button
                  disabled={busy}
                  onClick={() => void onDiscard()}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Discard and suggest again
                </Button>
              )}
            </div>
          </div>
        ) : null}

        <div className="flex gap-2">
          <Textarea
            aria-label="Write a reply"
            className="min-h-11 resize-none"
            disabled={locked}
            onChange={(event) => setInput(event.target.value)}
            placeholder={composerPlaceholder}
            value={input}
          />
          <Button className="self-end" disabled={busy || locked || !input.trim()} type="submit">
            Send
          </Button>
        </div>

        {locked ? (
          <p className="text-[0.66rem] text-muted-foreground" role="status">
            {lockedReason}
          </p>
        ) : null}

        {canDraft && draft === null && !locked ? (
          <Button
            disabled={busy}
            onClick={() => void onGenerate()}
            size="sm"
            type="button"
            variant="outline"
          >
            Suggest a reply
          </Button>
        ) : null}
      </form>
    </div>
  );
}
