import { BookOpen, ClipboardCheck, Gauge, HelpCircle, Landmark, ShieldCheck } from "lucide-react";
import { assistantContextIsSafe } from "@/lib/assistant/context";

export { ASSISTANT_CONTEXT_DENY_LIST } from "@/lib/assistant/context";

import type { LucideIcon } from "lucide-react";

export interface AssistantPageContext {
  readonly route: string;
  readonly entityRef: string;
  readonly label: string;
  readonly suggestions: readonly AssistantContextAction[];
}

export interface AssistantContextAction {
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

const GENERAL: readonly AssistantContextAction[] = [
  { title: "What should I focus on next?", description: "Use the published guidance for this part of the journey.", icon: Gauge },
  { title: "Explain how readiness works", description: "Walk through the process in plain language.", icon: BookOpen },
  { title: "What can I prepare now?", description: "Find the records and actions that are useful at this stage.", icon: ClipboardCheck },
  { title: "What can this assistant answer?", description: "See which topics are covered by the knowledge base.", icon: HelpCircle },
];

const CONSUMER_ACTIONS: Readonly<Record<string, readonly AssistantContextAction[]>> = {
  optimization: [
    { title: "Explain this action", description: "Break down the current optimization step and why it matters.", icon: Gauge },
    { title: "How do I mark progress?", description: "Explain what to record and what still needs verification.", icon: ClipboardCheck },
    ...GENERAL.slice(1, 3),
  ],
  credit: [
    { title: "What changed in my last snapshot?", description: "Explain how to read changes without sending monitoring data to the assistant.", icon: ShieldCheck },
    { title: "How should I read this page?", description: "Explain the monitoring terms shown here.", icon: BookOpen },
    ...GENERAL.slice(0, 2),
  ],
  plan: [
    { title: "What should I do before applying?", description: "Use the funding-readiness guidance for this stage.", icon: Landmark },
    { title: "Explain my funding sequence", description: "Describe how preparation and applications fit together.", icon: ClipboardCheck },
    ...GENERAL.slice(0, 2),
  ],
};

const LABELS: Readonly<Record<string, string>> = {
  dashboard: "Overview",
  optimization: "Optimization",
  plan: "Your Funding",
  matches: "Funding Matches",
  credit: "Credit Monitoring",
  documents: "Onboarding and Documents",
  agreements: "Permissions",
  coach: "Team Chat",
  learning: "Trainings",
  notifications: "Notifications",
  settings: "Account and Billing",
  onboarding: "Enrollment",
};

export function consumerAssistantContext(view: string, clientRef: string): AssistantPageContext {
  return {
    entityRef: clientRef,
    label: LABELS[view] ?? "Consumer workspace",
    route: view,
    suggestions: CONSUMER_ACTIONS[view] ?? GENERAL,
  };
}

export function scopedAssistantContext(scope: "operator" | "admin", view: string): AssistantPageContext {
  return {
    entityRef: scope,
    label: scope === "admin" ? "Platform workspace" : "Operator workspace",
    route: view,
    suggestions: GENERAL,
  };
}

export function assistantContextPayload(context: AssistantPageContext): { readonly route: string; readonly entityRef: string } {
  const payload = { entityRef: context.entityRef, route: context.route };
  if (!assistantContextIsSafe(payload)) throw new Error("ASSISTANT_CONTEXT_BLOCKED");
  return payload;
}
