// The Inbox's fixture conversations, and the support sheet's fixture suggestions.
//
// Lifted out of `surfaces/operator.tsx` byte for byte. `SUPPORT_SEED` is re-exported to the
// surface because the Platform support sheet still reads it; `INBOX_SEED` has no reader outside
// this directory. Both are fixtures, and neither is reachable once `FEATURE_SUPPORT` returns
// threads — contract rail 5 is what keeps it that way.

// The Inbox rows carry an age rather than a printed time. The list, the thread and the rail all
// render timestamps through the chat foundation's own grammar now, which needs a real instant —
// "Today, 1:12 PM" parses to nothing and renders as a blank. `fixtureSentAt` anchors the offsets
// to the current UTC day so a demo walked at any hour reads correctly, and so the value is the
// same on both sides of a server render for every hour but the one that crosses midnight.
export function fixtureSentAt(dayOffset: number, minuteOfDay: number): string {
  const anchor = new Date();
  anchor.setUTCHours(0, 0, 0, 0);
  return new Date(
    anchor.getTime() + dayOffset * 24 * 60 * 60_000 + minuteOfDay * 60_000,
  ).toISOString();
}

// Fixture suggestions remain attached to one support conversation and never acquire an automatic
// send path. `taskId` is retained as fixture provenance, not as a completion side effect.
export const SUPPORT_SEED = [
  {
    clientId: "c2",
    draft:
      "I can help with the funding-readiness actions that are within your control: bring the bakery card below the 29% target and keep new applications paused.",
    id: "s1",
    kind: "Guardrail hold",
    question:
      "Can you help change a negative report item before we apply for the loan?",
    reason:
      "The request falls outside funding-readiness guidance, so a person must decide what reaches the client.",
    taskId: "task-1",
    time: "Today, 9:12 AM",
  },
  {
    clientId: "c7",
    draft:
      "Wait for the Aug 1 update. Applying before the new account appears in the analysis adds uncertainty to the sequence.",
    id: "s2",
    kind: "Low confidence",
    question:
      "My vendor account posted early. Should I apply now or wait for the next update?",
    reason: "Confidence is below the human-review threshold.",
    taskId: undefined,
    time: "Yesterday, 4:40 PM",
  },
] as const;

export const INBOX_SEED = [
  {
    // Priya's out-of-scope question is held in Support, so the Inbox carries the
    // in-scope exchange that precedes it; without it she has no thread at all.
    clientId: "c2",
    dayOffset: 0,
    id: "m0",
    message: "Utilization on the bakery card is down to 31%. Am I close enough?",
    minuteOfDay: 535,
    suggestion:
      "You are close. Bring the bakery card under the 29% target before the next scheduled update, and keep new applications paused until then.",
    unread: false,
  },
  {
    clientId: "c5",
    dayOffset: 0,
    id: "m1",
    message: "I made the Chase Ink payment. Anything else before the next update?",
    minuteOfDay: 792,
    suggestion:
      "Thanks for the update. Keep the confirmation for your records, and I will review it after the next scheduled source update.",
    unread: true,
  },
  {
    clientId: "c4",
    dayOffset: 0,
    id: "m2",
    message: "US Bank asked for three bank statements. Is that expected now?",
    minuteOfDay: 580,
    suggestion:
      "That request fits the current application packet. Upload the statements in Files, and I will confirm the packet before you continue.",
    unread: true,
  },
  {
    clientId: "c6",
    dayOffset: -1,
    id: "m3",
    message: "I am ready to start. Which application is first?",
    minuteOfDay: 1005,
    suggestion:
      "Bluevine is first in the confirmed sequence. Open the Funding tab to review the current status before submitting.",
    unread: false,
  },
] as const;
