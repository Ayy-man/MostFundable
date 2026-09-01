// What differs between the two assistant workspaces, and nothing else.
//
// One shell, two scopes (design brief §3–4). The grounding, the greeting and the suggestions
// differ; the grammar, the states and the answer shape do not. Keeping the difference in one table rather than
// in two components is what stops the two views drifting into two products, which is the failure
// the brief exists to prevent.
//
// **Every suggestion is a question the grounding can actually answer**, and that is a
// harder constraint than it sounds. `buildOperatorGrounding` gives the model one document per
// tracker client carrying `{ stage, readiness, openActionCount, monitoring, goalCents }`, one per
// application carrying `{ bankRef, operatorStatus, consumerStatus, amountCents }`, and one per
// lender carrying the vault document. `buildAdminGrounding` gives two platform-figure documents
// and one per operator tenant carrying `{ clients, plan, membership, startedAt, fundingReadyDays,
// fundedYtdCents, fundedAllTimeCents, fundedOutcomes }`. Nothing else is in the model's context.
//
// So two of the brief's suggested questions are deliberately not here. "Missing documents" has no
// document inventory behind it and "changed this week" has no change timestamps — both would be
// offered in the empty state and then answer "there is not enough visible workspace context",
// every time, for every operator. A suggestion that reliably fails is worse than no suggestion, and
// the brief's own rule about one naming a fixture date is the same rule one step further on. The
// replacements read fields that exist: open actions, stage, monitoring, application status.
//
// The other absence is "draft a check-in". Drafting a reply to a client is the held-draft workflow
// and it lives in the operator Inbox's copilot rail, behind a human send. Offering it from a
// workspace that has no thread selected and no send control would point at a control that is not
// on this screen.
//
// **Four suggestions, one treatment, and the text is the question.** The first build had five short
// pills and three cards of two different sizes — two systems doing one job, and a reader had to
// work out whether the difference meant anything. It did not. DESIGN.md bans the pill cluster and
// the identical card grid in the same sentence, which rules out both the way out of it, so this is
// a list: one row per question, the same affordance on each, the full question as its own label.
// A short label over a long question also meant the words somebody pressed were not the words that
// got asked, which is a small dishonesty the list does not have.

import type { AssistantScope } from "@/lib/assistant/types";

/** A one-tap question. What it prints is what it asks. */
export interface AssistantSuggestion {
  readonly question: string;
}

export interface AssistantScopeProfile {
  readonly scope: AssistantScope;
  /** The view's own heading. */
  readonly title: string;
  /** One line under the greeting saying what this assistant reads. Provenance, per DESIGN.md. */
  readonly grounding: string;
  readonly placeholder: string;
  /** The composer's accessible name. */
  readonly composerLabel: string;
  readonly suggestions: readonly AssistantSuggestion[];
  /** `FEATURE_KB` off. A named absence rather than a blank pane. */
  readonly disabled: { readonly title: string; readonly description: string };
}

const OPERATOR: AssistantScopeProfile = {
  composerLabel: "Ask the workspace assistant",
  disabled: {
    description: "The workspace assistant is switched off for this environment, so no question can be answered here.",
    title: "The assistant is not connected",
  },
  grounding: "Answers read the clients, applications and lender records your session can already see.",
  placeholder: "Ask about a client, an application, or a lender",
  scope: "operator",
  suggestions: [
    { question: "Which clients are closest to funding, and what is their verified readiness?" },
    { question: "Which clients have the most open actions right now?" },
    { question: "Where does each open application stand with its lender?" },
    { question: "Which clients do not have active credit monitoring?" },
  ],
  title: "AI assistant",
};

const ADMIN: AssistantScopeProfile = {
  composerLabel: "Ask the platform assistant",
  disabled: {
    description: "The platform assistant is switched off for this environment, so no question can be answered here.",
    title: "The assistant is not connected",
  },
  grounding: "Answers read the operator roster and the recorded platform figures. No consumer record is in scope.",
  placeholder: "Ask about operators, plans, or recorded platform figures",
  scope: "admin",
  suggestions: [
    { question: "Which operator workspaces have the most clients?" },
    { question: "Which operators have recorded the most funded volume?" },
    { question: "Which operators take the longest to get a client funding-ready?" },
    { question: "How many operators and consumers are recorded on the platform?" },
  ],
  title: "AI chat",
};

/**
 * Keyed by scope, so a third scope added to the union is a compile error here rather than a
 * workspace that renders with no suggestions.
 */
export const SCOPE_PROFILES: Readonly<Record<AssistantScope, AssistantScopeProfile>> = {
  admin: ADMIN,
  operator: OPERATOR,
};

export function scopeProfile(scope: AssistantScope): AssistantScopeProfile {
  return SCOPE_PROFILES[scope];
}
