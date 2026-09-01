"use client";

// The composer.
//
// This is the part of a messaging product people notice only when it is wrong, so the decisions
// are worth writing down.
//
// **The send key is chosen per recipient, not once globally.** `sendOn` has no default, because a
// default is how the wrong one ships to the surface nobody re-checked. The consumer thread sends
// on Enter: it is a chat, the messages are short, and every chat product a client has ever used
// behaves that way. The operator composer sends on the modifier, because those replies are long
// and they go to somebody's client, and a stray Enter firing a half-written reply at a client is a
// real harm rather than a papercut — Plain and Superhuman both make the deliberate chord the send
// for that reason. Either way the choice is stated in a hint under the field, because a send key
// you discover by losing a draft is not a send key.
//
// On touch neither applies: there is no Shift and no modifier, the return key is the only way to
// write a paragraph, so it writes one and the button sends.
//
// **A framed AI draft has no keyboard path to Send at all.** Contract §2 rule 1 says an
// AI-assisted message reaches a consumer only by a human act, and a reflex is not an act. So the
// frame replaces the textarea rather than sitting above it: while a draft is framed there is no
// text field to press a key in, and the only ways out are Edit, which turns it into ordinary
// composer text and therefore into a human message, or the Send button reached by pointer or by
// deliberately focusing it. This is structural rather than a guard clause, because a guard clause
// is one refactor away from being wrong.
//
// **A failed send is a chip in the thread, not a toast.** Toasts are gone before the person has
// finished reading, and a message that "failed" in a toast that has expired is a message the
// person believes they sent. The failure lives on the message (`<MessageBubble>` renders it) and
// this component's job is to hand the text back if the caller asks for it.
//
// **The draft belongs to the thread, not to the component.** Keyed in `localStorage` by the
// thread, restored on mount, cleared on a successful send. Switching threads to check something
// and coming back must not eat a half-written reply.
//
// **Slash commands are a listbox, not a native menu.** `/note`, `/draft`, `/close` in operator
// contexts, filtered as you type, driven with the arrow keys, dismissed with Escape, and — this
// is the part that matters — a command the caller did not offer simply is not there. No disabled
// rows with tooltips explaining why the thing you just typed does nothing.
//
// **Growth is measured, not guessed.** `field-sizing: content` would do this in CSS but is not
// everywhere yet, so the height comes from `scrollHeight` against an explicit cap. Past the cap
// the textarea scrolls rather than eating the thread.

import { LoaderCircle, Paperclip, Send, Sparkles } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { MessageAttachment, MessageAttachments } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  clearDraft,
  readDraft,
  serverDraftSnapshot,
  subscribeToDraftStore,
  writeDraft,
} from "./drafts";
import { sendHint, sendsOnKey, type SendOn } from "./send-key";
import { composerValue, type ComposerEdit } from "./composer-value";
import type { ChatAttachment } from "./types";

/** Roughly nine lines. Past that the composer scrolls instead of pushing the thread off-screen. */
const MAX_TEXTAREA_PX = 216;

/**
 * Which ground the composer is sitting on.
 *
 * Added for the consumer assistant panel, which is Deep Navy because contract R3 makes the
 * assistant's identity visual before it is verbal — a reader has to be able to tell at a glance
 * that they are not talking to a person. A light input dropped into that panel reads as a form
 * pasted onto it rather than part of it.
 *
 * `<ThinkingOrb ground="navy">` already took this shape for the same reason, so this is the same
 * vocabulary rather than a second one, and `light` is the default so nothing already mounted moves.
 * Only shared tokens are used on either branch: this component is mounted by three surfaces and
 * `design-rails.test.ts` fails it for reaching into any one surface's palette.
 */
export type ComposerGround = "light" | "navy";

/** The frame, the field, the hint and the locked notice, per ground — read once so they cannot drift. */
const GROUND = {
  light: {
    frame: "border-[var(--surface-border)] bg-card focus-within:border-[var(--primary-ink)]",
    hint: "text-muted-foreground",
    locked: "border-[var(--border)] bg-[var(--background)]",
    text: "text-foreground placeholder:text-muted-foreground",
  },
  navy: {
    frame:
      "border-[color-mix(in_srgb,var(--background),transparent_82%)] bg-[color-mix(in_srgb,var(--assistant-ground),var(--background)_9%)] focus-within:border-[var(--accent-on-dark)]",
    hint: "text-[color-mix(in_srgb,var(--background),var(--assistant-ground)_32%)]",
    locked:
      "border-[color-mix(in_srgb,var(--background),transparent_82%)] bg-[color-mix(in_srgb,var(--assistant-ground),var(--background)_6%)]",
    text: "text-[var(--background)] placeholder:text-[color-mix(in_srgb,var(--background),var(--assistant-ground)_38%)]",
  },
} as const;

/**
 * Whether this is a touch pointer, read the same way the drafts store is read.
 *
 * Not `matchMedia` during render: the server has no `window`, so that is either a hydration
 * mismatch or a `setState` in an effect. The server answer is `false` — a desktop keyboard — which
 * is the safe way round, because the worst case is a hint that corrects itself on hydration rather
 * than a send key that does not work.
 */
const COARSE = "(pointer: coarse)";
function subscribeToPointer(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const query = window.matchMedia(COARSE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function coarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia(COARSE).matches;
}
function serverPointer(): boolean {
  return false;
}

/**
 * A held AI draft, framed for review.
 *
 * This is the product's differentiator made visible, so it carries its own evidence: the
 * confidence in words with the basis for it, the sources with human labels, and — when the
 * supervisor gate held it — the reason, stated plainly.
 */
export interface ComposerDraft {
  /** What the engine proposed. Rendered inside the frame, never in a text field. */
  readonly body: string;
  /** Confidence in words with its basis: "high confidence · based on 3 sources". Never a bare number. */
  readonly confidence: string;
  /** Human labels. A source chip that shows an id is a raw identifier on screen. */
  readonly sources?: readonly { readonly label: string; readonly onOpen?: () => void }[];
  /** Why the supervisor held it, when it did: "held: compliance language". */
  readonly holdReason?: string;
  /** Drops the frame and puts the body in the composer, which makes it a human message. */
  readonly onEdit: () => void;
  /** The human act. Pointer, or a deliberately focused button. Never a bare keypress. */
  readonly onSend: () => void;
  readonly onDiscard: () => void;
}

/**
 * The two things a composer in this product can be.
 *
 * Kept as a named union rather than a boolean because a third tone is a real possibility and a
 * `note?: boolean` would have to be replaced rather than extended when it arrives.
 */
export type ComposerTone = "default" | "note";

/**
 * Ground and tone, and which of them owns what.
 *
 * They arrived from two lanes at once and both wrote the field's border and the hint's ink, so on
 * a navy ground with a note tone the winner would have been CSS source order rather than anybody's
 * decision. Unreachable today, because the only surface with a navy composer is the consumer
 * assistant and it has no internal notes — but "unreachable" is a fact about this week's routes,
 * not a property of the component, and a rule that resolves by accident is one somebody has to
 * rediscover the first time it does not.
 *
 * The split, which is the one lane 2 proposed: **ground is whose surface this is** and owns the
 * field's background, its resting and focus border, and the hint's ink; **tone is what this
 * message is** and owns nothing but an accent on top. So `default` contributes the empty string on
 * both grounds — the common case leaves the ground's frame exactly as the ground drew it — and
 * `note` overrides only the two colours that carry the warning, in the variant that reads on the
 * ground it is sitting on. Every (ground, tone) pair has one written answer, which is what makes
 * this a decision rather than an ordering.
 */
const TONE_ACCENT: Record<ComposerGround, Record<ComposerTone, { frame: string; hint: string }>> = {
  light: {
    default: { frame: "", hint: "" },
    note: {
      frame: "border-[var(--warning-border)] focus-within:border-[var(--warning-ink)]",
      hint: "text-[var(--warning-ink)]",
    },
  },
  navy: {
    default: { frame: "", hint: "" },
    // The warning tokens are tuned for light surfaces, so the navy accent is mixed toward the
    // panel's own background the way the rest of `GROUND.navy` is, rather than reusing an ink that
    // would sit at roughly two-to-one against this ground.
    note: {
      frame:
        "border-[color-mix(in_srgb,var(--warning-ink),var(--background)_45%)] focus-within:border-[color-mix(in_srgb,var(--warning-ink),var(--background)_25%)]",
      hint: "text-[color-mix(in_srgb,var(--warning-ink),var(--background)_35%)]",
    },
  },
};

export interface ComposerCommand {
  /** What the person types, without the slash. */
  readonly name: string;
  /** One line saying what it does. Rendered beside the name. */
  readonly hint: string;
  readonly onRun: () => void;
}

export interface ComposerProps {
  /** @opaque Keys the saved draft. Never rendered. */
  readonly threadRef: string;
  /**
   * Which key sends. No default: the two composers in this product disagree, and the disagreement
   * is the point (contract §4).
   */
  readonly sendOn: SendOn;
  readonly placeholder?: string;
  /**
   * Sends. Resolving `false` leaves the text in the box — the caller is telling us the message
   * did not go, and clearing the composer on a failure is how a person loses a reply.
   */
  readonly onSend: (body: string, attachments: readonly ChatAttachment[]) => Promise<boolean> | boolean;
  readonly attachments?: readonly ChatAttachment[];
  readonly onAttach?: (files: FileList) => void;
  readonly onRemoveAttachment?: (ref: string) => void;
  /** Operator contexts pass these; consumer contexts pass none and the menu never appears. */
  readonly commands?: readonly ComposerCommand[];
  /**
   * Why nothing can be sent, when nothing can be. Present means every send control goes away and
   * the reason is stated — a resolved thread refuses in the database, and letting the refusal come
   * back as a generic failure teaches the operator that sending is broken.
   */
  readonly lockedReason?: string | null;
  /** A note tab, a visibility toggle, a model chip — whatever the surface puts on the left. */
  readonly toolbar?: ReactNode;
  /**
   * A held AI draft. While this is present the composer *is* the frame — the textarea is gone,
   * which is what makes "no bare keypress can send an AI draft" a fact about the DOM rather than a
   * rule somebody has to remember.
   */
  readonly draft?: ComposerDraft | null;
  /**
   * What this composer is for, expressed in colour.
   *
   * `note` is the internal-note tone: the field takes the amber border and the hint and banner
   * take the amber ink, so a note reads as a different act from a reply before a word is typed.
   * The field's own ground deliberately does not change — a tinted input sitting on a tinted band
   * stops looking like somewhere you can write.
   *
   * Optional with a default, so every existing call site keeps exactly the composer it had. The
   * alternative the operator Inbox was about to use — a descendant selector reaching in at
   * `bg-card` from the surface — works until somebody changes a wrapper here and then fails with
   * no error at all.
   */
  readonly tone?: ComposerTone;
  /** Rendered above the input: a reply-to line, a note-visibility notice. */
  readonly banner?: ReactNode;
  readonly busy?: boolean;
  readonly className?: string;
  readonly label?: string;
  /** `light` unless the surface is the assistant's navy panel. See `ComposerGround`. */
  readonly ground?: ComposerGround;
  /**
   * Text put into the field from outside: a suggestion chip, an example prompt, a draft the
   * operator chose to edit.
   *
   * It fills and focuses, and it never sends. That distinction is the reason this is a prop rather
   * than the caller writing through `writeDraft`: a chip that sent on one click would be a message
   * to somebody's funding team that nobody read back, and `writeDraft` is the wrong channel
   * anyway — it is a no-op when `localStorage` throws, so the chips would quietly stop working in
   * a private window while everything else kept running.
   *
   * `token` is what makes it repeatable. Pressing the same chip twice is a real thing people do
   * after clearing the box, and a bare string prop would compare equal and do nothing the second
   * time. The caller bumps the token; the value may be identical.
   */
  readonly insert?: { readonly value: string; readonly token: number } | null;
}

export function Composer({
  attachments = [],
  banner,
  draft = null,
  busy = false,
  className,
  commands = [],
  ground = "light",
  insert = null,
  label = "Write a message",
  lockedReason = null,
  onAttach,
  onRemoveAttachment,
  onSend,
  placeholder = "Write a message",
  sendOn,
  threadRef,
  tone = "default",
  toolbar,
}: ComposerProps) {
  // `token` is which insert this edit was made against — see `composer-value.ts`.
  const [edited, setEdited] = useState<ComposerEdit | null>(null);
  const [sending, setSending] = useState(false);
  const [activeCommand, setActiveCommand] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const coarse = useSyncExternalStore(subscribeToPointer, coarsePointer, serverPointer);
  const locked = lockedReason !== null;
  const disabled = locked || busy || sending;

  /**
   * The saved draft, read through the store rather than in an effect.
   *
   * `localStorage` does not exist on the server, so reading it during render would either produce
   * a hydration mismatch or force a `setState` inside an effect — React's own lint rule refuses
   * the second and the first is a real bug. `useSyncExternalStore` is the hook for exactly this:
   * the server snapshot is empty, the client snapshot is what was saved, and React handles the
   * handover. The snapshot is cached per thread because the hook may call it several times in one
   * render and a fresh `localStorage` read each time would look like a changing store.
   */
  const snapshotRef = useRef<{ ref: string; value: string } | null>(null);
  const getSnapshot = useCallback(() => {
    if (snapshotRef.current?.ref !== threadRef) {
      snapshotRef.current = { ref: threadRef, value: readDraft(threadRef) };
    }
    return snapshotRef.current.value;
  }, [threadRef]);
  const saved = useSyncExternalStore(subscribeToDraftStore, getSnapshot, serverDraftSnapshot);

  // What is in the box, derived rather than assigned — the rule itself is in `composer-value.ts`,
  // where it can be driven, because it is the one part of this component with orderings that can
  // be got wrong quietly. `insert` therefore needs no effect and cannot fight a keystroke.
  const insertToken = insert?.token ?? null;
  const value = composerValue(edited, threadRef, insert, saved);

  function put(next: string) {
    setEdited({ ref: threadRef, token: insertToken, value: next });
    writeDraft(threadRef, next);
    snapshotRef.current = { ref: threadRef, value: next };
  }

  const grow = useCallback(() => {
    const node = textareaRef.current;
    if (node === null) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_TEXTAREA_PX)}px`;
    node.style.overflowY = node.scrollHeight > MAX_TEXTAREA_PX ? "auto" : "hidden";
  }, []);

  useEffect(grow, [grow, value]);

  // Focus follows an insert. A chip that fills a box the person then has to go and click into
  // costs a step rather than saving one. Only the focus is an effect: the text itself is derived
  // above, so nothing here sets state and nothing can race a keystroke.
  useEffect(() => {
    if (insertToken === null) return;
    textareaRef.current?.focus();
  }, [insertToken]);

  const matches =
    value.startsWith("/") && !value.includes(" ")
      ? commands.filter((command) => command.name.startsWith(value.slice(1).toLowerCase()))
      : [];
  const menuOpen = matches.length > 0 && !locked;

  function change(event: ChangeEvent<HTMLTextAreaElement>) {
    put(event.target.value);
    setActiveCommand(0);
  }

  function runCommand(command: ComposerCommand) {
    put("");
    clearDraft(threadRef);
    command.onRun();
    textareaRef.current?.focus();
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const body = value.trim();
    if (body === "" || disabled) return;
    setSending(true);
    // The text stays put until the caller confirms it went. A composer that empties optimistically
    // and a send that fails is a reply nobody can recover.
    const sent = await onSend(body, attachments);
    setSending(false);
    if (sent === false) return;
    put("");
    clearDraft(threadRef);
    textareaRef.current?.focus();
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveCommand((current) => (current + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveCommand((current) => (current - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        put("");
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        runCommand(matches[activeCommand] ?? matches[0]);
        return;
      }
    }

    // The decision lives in `send-key.ts`, where a test can drive it and where the hint reads it
    // too. Keeping it here would make the one rule with a named cost the one rule nothing checks.
    if (!sendsOnKey(event, sendOn, coarse)) return;
    event.preventDefault();
    void submit();
  }

  // A framed draft replaces the composer rather than sitting above it.
  //
  // That is the whole mechanism behind "no bare keypress can send an AI draft": there is no
  // textarea on screen to press a key in. `Edit` puts the body into the composer as ordinary text,
  // at which point it is the operator's message and the ordinary send rules apply — which is the
  // honest model, because a draft somebody edited and sent is a human message.
  //
  // **A locked conversation still shows its draft.** Nothing discards a held draft when a
  // conversation is resolved, so `resolved` + `held draft` is a state the durable path reaches on
  // its own; the view this component replaced rendered it and said "Kept for reference". Guarding
  // the whole frame on `!locked` made the draft vanish instead, which reads as the suggestion
  // having been lost. It stays, without any of its controls, and says why underneath.
  if (draft) {
    return (
      <div
        className={cn(
          "flex flex-col gap-3 rounded-[10px] border bg-[color-mix(in_srgb,var(--warning),transparent_92%)] px-4 py-3",
          "border-[var(--warning-border)]",
          className,
        )}
        // A region rather than a status: it is a thing to act on, not an announcement, and it
        // holds its own controls.
        aria-label="AI draft, awaiting your review"
        role="region"
      >
        <p className="flex items-center gap-2 text-xs font-semibold text-[var(--warning-ink)]">
          <Sparkles aria-hidden className="size-3.5" />
          AI draft &mdash; review before sending
        </p>

        <p className="text-[0.9375rem] leading-[1.5] whitespace-pre-wrap text-foreground">
          {draft.body}
        </p>

        {/* Confidence in words with its basis. A bare percentage next to a reply about somebody's
            funding reads as a promise, which is the thing this product may never make. */}
        <p className="text-xs text-[var(--warning-ink)]">{draft.confidence}</p>

        {draft.holdReason ? (
          <p className="text-xs text-[var(--warning-ink)]">{draft.holdReason}</p>
        ) : null}

        {/*
          Locked: the draft is here to be read, and it says so before the reader gets as far as
          the controls that are not there. Every control that would change or send it is gone
          rather than disabled — a disabled Send on a conversation nothing can be sent on invites
          the person to keep pressing it and learn that sending is broken.
        */}
        {locked ? (
          <p className="text-xs leading-5 text-[var(--warning-ink)]" role="status">
            {/* The reason says it better than a generic sentence, and only one of them should be
                on screen: two sentences that both mean "you cannot send" read as padding. */}
            This draft is kept for reference.{" "}
            {lockedReason ?? "Nothing can be sent on this conversation as it stands."}
          </p>
        ) : null}

        {draft.sources && draft.sources.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {draft.sources.map((source) => (
              <li key={source.label}>
                {source.onOpen ? (
                  <button
                    className="inline-flex min-h-11 items-center rounded-full border border-[var(--border)] bg-card px-3 text-xs font-medium text-foreground transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] hover:border-[var(--primary-ink)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={source.onOpen}
                    type="button"
                  >
                    {source.label}
                  </button>
                ) : (
                  <span className="inline-flex min-h-11 items-center rounded-full border border-[var(--border)] bg-card px-3 text-xs font-medium text-muted-foreground">
                    {source.label}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {locked ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Send is a button and nothing else. No `onKeyDown` anywhere in this frame, no shortcut,
            no form wrapper whose implicit submission a stray Enter could reach. Activating a
            focused button with Enter is a person choosing this control; a reflex in a text field
            is not.
          */}
          <Button className="min-h-11" onClick={draft.onSend} size="lg" type="button">
            <Send aria-hidden className="size-3.5" />
            Send
          </Button>
          <Button
            className="min-h-11"
            onClick={draft.onEdit}
            size="lg"
            type="button"
            variant="outline"
          >
            Edit
          </Button>
          <Button
            className="min-h-11"
            onClick={draft.onDiscard}
            size="lg"
            type="button"
            variant="ghost"
          >
            Discard
          </Button>
        </div>
        )}
      </div>
    );
  }

  if (locked) {
    // The locked notice follows the ground too. It used to be light unconditionally, which put a
    // white card inside the assistant's navy panel every time the knowledge base was unreachable —
    // the loudest thing on the surface saying the quietest thing on it.
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-[10px] border border-dashed px-4 py-3",
          GROUND[ground].locked,
          className,
        )}
        role="status"
      >
        <p className={cn("text-xs leading-5", GROUND[ground].hint)}>{lockedReason}</p>
      </div>
    );
  }

  return (
    <form className={cn("space-y-2", className)} onSubmit={submit}>
      {banner}

      {attachments.length > 0 ? (
        <MessageAttachments>
          {attachments.map((attachment) => (
            <MessageAttachment
              data={{
                filename: attachment.filename,
                mediaType: attachment.mediaType,
                type: "file",
                url: attachment.url,
              }}
              key={attachment.ref}
              onRemove={onRemoveAttachment ? () => onRemoveAttachment(attachment.ref) : undefined}
            />
          ))}
        </MessageAttachments>
      ) : null}

      <div className="relative">
        {menuOpen ? (
          <ul
            className="absolute bottom-[calc(100%+0.5rem)] left-0 z-20 w-full max-w-sm overflow-hidden rounded-[10px] border border-[var(--surface-border)] bg-popover shadow-[0_8px_24px_color-mix(in_srgb,var(--assistant-ground),transparent_86%)]"
            id={listboxId}
            role="listbox"
          >
            {matches.map((command, index) => (
              <li
                aria-selected={index === activeCommand}
                id={`${listboxId}-option-${index}`}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 px-3 text-sm",
                  index === activeCommand
                    ? "bg-[var(--accent)] text-foreground"
                    : "text-muted-foreground",
                )}
                key={command.name}
                onMouseDown={(event) => {
                  event.preventDefault();
                  runCommand(command);
                }}
                onMouseEnter={() => setActiveCommand(index)}
                role="option"
              >
                <span className="font-medium text-[var(--primary-ink)]">/{command.name}</span>
                <span className="min-w-0 truncate text-xs">{command.hint}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div
          className={cn(
            "flex items-end gap-2 rounded-[10px] border px-2 py-2 transition-colors",
            GROUND[ground].frame,
            "focus-within:ring-3 focus-within:ring-ring/50",
            // Ground first, accent second, and the accent is empty on `default` — so the common
            // case leaves the ground's own frame untouched rather than winning a race with it.
            TONE_ACCENT[ground][tone].frame,
          )}
        >
          {onAttach ? (
            <>
              <input
                className="sr-only"
                onChange={(event) => {
                  if (event.target.files) onAttach(event.target.files);
                  event.target.value = "";
                }}
                ref={fileRef}
                type="file"
              />
              <Button
                aria-label="Attach a file"
                className="shrink-0"
                disabled={disabled}
                onClick={() => fileRef.current?.click()}
                size="icon-lg"
                type="button"
                variant="ghost"
              >
                <Paperclip aria-hidden className="size-4" />
              </Button>
            </>
          ) : null}

          <label className="sr-only" htmlFor={`${listboxId}-input`}>
            {label}
          </label>
          {/* ARIA only while the menu exists. A message box is a textbox; it becomes a combobox
              for as long as it is offering commands, and stops claiming to be one the moment it
              is not — a permanent `aria-expanded="false"` on a textarea is a lie a screen reader
              reads out on every message. */}
          <textarea
            aria-activedescendant={menuOpen ? `${listboxId}-option-${activeCommand}` : undefined}
            aria-autocomplete={menuOpen ? "list" : undefined}
            aria-controls={menuOpen ? listboxId : undefined}
            aria-expanded={menuOpen ? true : undefined}
            role={menuOpen ? "combobox" : undefined}
            className={cn(
              "min-h-11 w-full flex-1 resize-none border-0 bg-transparent px-1 py-2.5 text-[0.9375rem] leading-[1.5] outline-none disabled:opacity-50 [field-sizing:fixed]",
              GROUND[ground].text,
            )}
            disabled={disabled}
            id={`${listboxId}-input`}
            onChange={change}
            onKeyDown={keyDown}
            placeholder={placeholder}
            ref={textareaRef}
            rows={1}
            value={value}
          />

          <Button
            aria-label="Send"
            className="shrink-0"
            disabled={disabled || value.trim() === ""}
            size="icon-lg"
            type="submit"
          >
            {sending || busy ? (
              <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Send aria-hidden className="size-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {toolbar}
        {/* The hint sits with the field, in the smallest metadata size, and says the same thing
            the handler does because both read `sendOn`. */}
        <p className={cn("ml-auto text-xs", GROUND[ground].hint, TONE_ACCENT[ground][tone].hint)}>
          {sendHint(sendOn, coarse)}
        </p>
      </div>
    </form>
  );
}
