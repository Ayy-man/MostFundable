"use client";

// AI Elements `message`, trimmed and restyled.
//
// Three things were dropped, each for a reason that is about this product rather than taste.
//
// `MessageResponse` rendered model output through `streamdown`, a streaming markdown renderer.
// There is no token streaming here and there must not be (contract R1): the answer routes run
// candidate → compliance scan → citation check → supervisor review and return a whole answer, so
// there is nothing to stream, and a markdown renderer over model output is a new HTML-injection
// surface bought for a feature we do not have. Answers render as text.
//
// The branch machinery — previous/next/`3 of 5` over regenerated responses — went with it. Nothing
// in this product regenerates an answer into alternatives, and it was the only reason the file
// needed the `button-group` primitive.
//
// And `UIMessage["role"]` / `FileUIPart` now come from `./types`, because the `ai` package is
// deliberately not installed. See that file for why.
//
// What the restyle changed: the assistant is not a bubble. A bubble on both sides makes a machine
// look like a participant, which is the confusion R3 exists to prevent — so the assistant is flat
// text under a Deep Navy identity mark, and only the person gets a filled surface. Nothing here
// uses green as a background for text, because Electric Green fails contrast on light and is
// reserved for actions.

import { Paperclip, X } from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { AttachmentPart, ChatRole } from "./types";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: ChatRole;
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full flex-col gap-2",
      from === "user" ? "is-user items-end" : "is-assistant items-start",
      className,
    )}
    data-from={from}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-[min(100%,36rem)] flex-col gap-2 text-sm leading-6 break-words",
      // The person's own words sit on a surface. The assistant's do not: a machine that looks
      // like it is speaking in a bubble reads as a member of the team.
      "group-[.is-user]:rounded-[10px] group-[.is-user]:border group-[.is-user]:border-[var(--surface-border)] group-[.is-user]:bg-[var(--surface-raised)] group-[.is-user]:px-4 group-[.is-user]:py-3",
      "group-[.is-user]:text-foreground group-[.is-assistant]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageIdentityProps = ComponentProps<"span"> & {
  /** A human label. Never an id — rail 3. */
  label: string;
};

/**
 * The assistant's mark: Deep Navy, the one ground in this system that means "not a person".
 *
 * It carries the label as text rather than only as a tooltip, because "who said this" is the
 * question the whole R3 ruling turns on and it must not depend on hovering.
 */
export const MessageIdentity = ({ className, label, children, ...props }: MessageIdentityProps) => (
  <span
    className={cn(
      "inline-flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground",
      className,
    )}
    {...props}
  >
    <span
      aria-hidden
      className="grid size-5 shrink-0 place-items-center rounded-md bg-[var(--assistant-ground)] text-[var(--accent-on-dark)]"
    >
      {children}
    </span>
    {label}
  </span>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({ className, children, ...props }: MessageActionsProps) => (
  <div
    className={cn(
      "flex items-center gap-1 opacity-0 transition-opacity duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)] group-hover:opacity-100 focus-within:opacity-100",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label ?? tooltip}</span>
    </Button>
  );

  if (!tooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
};

export type MessageAttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: AttachmentPart;
  onRemove?: () => void;
};

export function MessageAttachment({ data, className, onRemove, ...props }: MessageAttachmentProps) {
  const filename = data.filename ?? "";
  const isImage = Boolean(data.mediaType?.startsWith("image/") && data.url);
  // A file with no name still gets a name, because "Attachment" is a better label than an empty
  // one and the alternative anybody reaches for is the id.
  const attachmentLabel = filename || (isImage ? "Image" : "Attachment");

  return (
    <div
      className={cn(
        "group/attachment relative flex min-h-11 items-center gap-2 overflow-hidden rounded-lg border border-[var(--surface-border)] bg-card p-1.5 pr-2",
        className,
      )}
      {...props}
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- a blob URL the browser just made
        <img alt={attachmentLabel} className="size-8 shrink-0 rounded-md object-cover" src={data.url} />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <Paperclip aria-hidden className="size-3.5" />
        </span>
      )}
      <span className="min-w-0 truncate text-xs font-medium text-foreground">{attachmentLabel}</span>
      {onRemove ? (
        <Button
          aria-label={`Remove ${attachmentLabel}`}
          className="ml-1 shrink-0"
          onClick={onRemove}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <X aria-hidden className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

export type MessageAttachmentsProps = ComponentProps<"div">;

export function MessageAttachments({ children, className, ...props }: MessageAttachmentsProps) {
  if (!children) return null;
  return (
    <div className={cn("flex w-fit flex-wrap items-start gap-2", className)} {...props}>
      {children}
    </div>
  );
}

export type MessageToolbarProps = ComponentProps<"div">;

export const MessageToolbar = ({ className, children, ...props }: MessageToolbarProps) => (
  <div className={cn("flex w-full items-center justify-between gap-4", className)} {...props}>
    {children}
  </div>
);
