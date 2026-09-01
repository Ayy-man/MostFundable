"use client";

// The operator AI assistant view.
//
// What used to be here, and what F-08 was about: a live knowledge-assistant panel, and under it a
// dark navy hero plus a panel reading "Visual shell only. No assistant service or chat logic runs
// in this demo" above a disabled input reading "Assistant connection is not enabled" — a page that
// told the reader twice that the product did not work, directly below a panel answering their
// questions. `main` deleted the dead half while lane 1b's extraction was in flight; this lane
// replaces the working half too, because a one-shot question box that forgets every answer is not
// the workspace the design brief specifies.
//
// This file is now a mount and a greeting read, and that is the whole of it. Everything else is
// `<AssistantWorkspace>`, shared with the platform-admin scope so the two views cannot drift into
// two products.
//
// **The greeting's second sentence comes from the tracker book**, through the same hook the rest of
// the operator surface reads it with, so the count in "2 clients in your book need a look today"
// is the count the Clients view would show and not a number invented for a greeting. `health` is
// the server's own judgement; nothing is recomputed here.

import { BrainCircuit } from "lucide-react";

import { CompactHeader } from "@/components/operator/chrome";
import { useTrackerClients } from "@/lib/tracker/realtime.client";

import { activeCount, attentionCount } from "./greeting";
import { AssistantWorkspace } from "./workspace";

import type { GreetingRead } from "./greeting";

export interface OperatorAssistantProps {
  readonly compact?: boolean;
  /**
   * The signed-in operator's display name, for the greeting. Absent greets without a name, which
   * is the right answer on the fixture shell.
   */
  readonly viewerName?: string | null;
}

export function OperatorAssistant({ compact = false, viewerName }: OperatorAssistantProps) {
  const book = useTrackerClients({ active: true, audience: "operator" });

  const greeting: GreetingRead = book.loading
    ? { status: "loading" }
    : book.error
      ? { status: "unavailable" }
      : book.enabled !== true
        ? // The tracker rail is off in this environment. That is a stated absence, not an outage,
          // and saying "could not be read" about it would be the wrong sentence.
          { status: "absent" }
        : {
            clients: activeCount(book.clients),
            needAttention: attentionCount(book.clients),
            status: "operator",
          };

  return (
    <div className="space-y-5">
      {compact ? null : <CompactHeader icon={BrainCircuit} title="AI assistant" />}
      <AssistantWorkspace compact={compact} greeting={greeting} scope="operator" viewerName={viewerName} />
    </div>
  );
}
