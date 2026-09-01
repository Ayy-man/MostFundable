/**
 * The written conversation the demo shell shows, and the one place in this view a message nobody
 * sent may appear.
 *
 * It is reachable from exactly one mount — `components/demo/demo-app.tsx`, which renders
 * `<ConsumerSurface>` with no `teamChat` at all — and that shell sits behind the persistent
 * demo-environment bar which says out loud that nothing here is a live operation. Under real auth
 * the page always passes the prop, so `undefined` never arrives and these lines are unreachable;
 * `mount.test.ts` is what holds that, by reading the real-auth page rather than trusting it.
 *
 * That distinction is why the flag-off case does **not** land here. `FEATURE_SUPPORT` being off
 * produces `{ state: 'disabled' }`, which only `page.tsx` can produce, and `page.tsx` returns early
 * unless `FEATURE_REAL_AUTH` — so a fixture conversation on that branch would be written messages
 * from a named advisor reaching a signed-in client, which is precisely what contract rail 5
 * forbids. It gets a stated `disabled` pane instead.
 *
 * The wording is Drop 7's, unchanged. The dates in it are the demo's own and are correct there,
 * because the demo's readiness history carries the same ones.
 */

import type { ChatMessage, ChatThreadItem } from "@/components/chat";

import { TEAM_ROLE_LABEL } from "./thread-model";

export interface FixtureConversationInput {
  readonly analysisActive: boolean;
  readonly canceled: boolean;
  readonly operatorName: string;
}

function opening({ analysisActive, canceled }: FixtureConversationInput): string {
  if (canceled) {
    return "I’ve preserved your last verified plan as a reference. Message us here if you need help understanding the closed account record.";
  }
  return analysisActive
    ? "Hi Maya — I reviewed the Jul 14 source snapshot. Your next step remains the Chase Ink balance target, and the next credit refresh is scheduled for Aug 13."
    : "Hi Maya — your last verified plan remains available. We’ll review any reported actions after analysis authorization resumes.";
}

/**
 * Fixed timestamps rather than `Date.now()`.
 *
 * A demo whose messages say "just now" every time the page loads is a demo that reshuffles under a
 * reviewer, and the day divider would move with the clock. These sit an hour apart on a fixed day,
 * which is what the rest of the demo's chronology is built from.
 */
const FIXTURE_SENT_AT = ["2026-08-13T15:04:00.000Z", "2026-08-13T15:06:00.000Z"] as const;

export function fixtureConversation(input: FixtureConversationInput): ChatThreadItem[] {
  const author: ChatMessage["author"] = {
    kind: "operator",
    name: input.operatorName,
    roleLabel: TEAM_ROLE_LABEL,
  };
  const bodies = [
    opening(input),
    "Every reply in this conversation is reviewed and sent by a member of your funding team.",
  ];
  return bodies.map((body, index) => ({
    message: {
      author,
      body,
      delivery: "delivered",
      origin: "human",
      ref: `fixture-${index}`,
      sentAt: FIXTURE_SENT_AT[index] ?? FIXTURE_SENT_AT[0],
      visibility: "participants",
    },
    type: "message",
  }));
}
