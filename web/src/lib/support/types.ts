// The support vocabulary, mirroring migration 100's five enums exactly.
//
// These are union types rather than TypeScript `enum`s, which the repo bans
// (`verify-source-gates.mjs`). Each union is the same closed set the database
// carries, so a value that cannot be inserted also cannot be typed.

import type { SupervisorVerdict } from '../llm/types.ts';
import type { ResolvedPrompt } from '../admin/prompt-types.ts';

export type { SupervisorVerdict };

export type SupportThreadKind = 'team_chat' | 'platform_support';
export type SupportThreadStatus = 'open' | 'pending' | 'resolved';

/**
 * The three authors a message can have, all of them people.
 *
 * There is no value here for an automated author, and that is the point: the
 * database enum has the same three labels, so an AI-authored message is not
 * expressible in either direction. Widening this pair is Phase 16's explicit
 * act, in one migration and one type, both reviewable.
 */
export type SupportAuthorKind = 'consumer' | 'operator' | 'admin';

export type SupportMessageOrigin = 'human' | 'ai_assisted';

/**
 * Who a message is written for.
 *
 * `internal` is an operator-only note that lives in the same thread the client
 * reads. It is not private because a query filters it out — migration 385 puts
 * the rule in `support_messages_select` and in the read RPC, both calling one
 * predicate — so this type describes a row's state rather than creating it.
 */
export type SupportMessageVisibility = 'participants' | 'internal';

/**
 * Where a person's attention stopped in a thread, and what they have not seen.
 *
 * `unreadCount` is derived by `support_list_thread_digest` from the messages
 * themselves and is never stored, never sent from a browser, and never computed
 * in TypeScript. A badge can therefore only be wrong in the way the messages
 * are wrong.
 */
export interface SupportThreadRead {
  /** Last message the signed-in profile has seen in this thread, or null if never opened. */
  readonly lastReadAt: string | null;
  /** Messages after lastReadAt that this profile did not write. Never negative. */
  readonly unreadCount: number;
  /**
   * The greatest watermark held by the OTHER side of this thread, or null.
   *
   * Derived by `support_list_thread_digest` under migration 393, inside the same security
   * definer function that re-checks the actor. It is an instant and nothing else: a `max()`
   * across the counterpart side, so it says "somebody over there has seen up to here" and names
   * nobody. Null means the derivation could not say, which is three different situations in the
   * database and one answer on a screen.
   *
   * This is what makes a read receipt possible; `lastReadAt` above never could, because it is
   * where the reader's own attention stopped.
   */
  readonly counterpartReadAt: string | null;
}
export type HeldDraftStatus = 'draft' | 'approved' | 'sent' | 'discarded';
export type SupportDraftDriverName = 'mock' | 'openrouter';

/** The most recent messages a draft driver is allowed to see. */
export const SUPPORT_DRAFT_CONTEXT_MESSAGE_LIMIT = 12;

export interface SupportDraftContextMessage {
  readonly authorKind: SupportAuthorKind;
  readonly body: string;
}

/**
 * Everything a draft driver receives, and nothing else.
 *
 * This type is a boundary, not a convenience. It carries no profile id, no
 * email, no personal or business name, no client id, no org id, and no
 * bureau-derived value — DEC-D4's derived-only discipline applied to the
 * messaging rail. Adding an identity field here would hand it to whatever
 * provider the `ai` selector resolves, so a field is added only by widening
 * this type on purpose.
 */
export interface SupportDraftContext {
  readonly threadKind: SupportThreadKind;
  readonly threadSubject: string;
  /** Oldest first, capped at SUPPORT_DRAFT_CONTEXT_MESSAGE_LIMIT. */
  readonly recentMessages: readonly SupportDraftContextMessage[];
}

export interface SupportDraftCandidate {
  readonly body: string;
  readonly confidence: number;
  readonly model: string;
}

/**
 * Why a draft landed where it did. Resolved in precedence order by
 * `runDraftEngine`, and written to the audit row as `reason_code`.
 */
export type SupportDraftReasonCode =
  | 'gates_passed'
  | 'supervisor_rejected'
  | 'guardrail_flagged'
  | 'confidence_below_threshold';

/**
 * The engine's verdict, shaped to become one `public.held_drafts` row.
 *
 * `confidenceThreshold` is carried rather than looked up later because the row
 * records the bar that applied at generation time. When a config table lands
 * (IA-13-03), historical rows still show the bar they were actually judged
 * against instead of today's.
 */
export interface SupportDraftDecision {
  readonly body: string;
  readonly confidence: number;
  readonly confidenceThreshold: number;
  readonly supervisorApproved: boolean;
  readonly guardrailFlags: readonly string[];
  readonly driver: SupportDraftDriverName;
  readonly model: string;
  readonly promptKey: string;
  readonly promptVersion: number;
  readonly status: Extract<HeldDraftStatus, 'draft' | 'approved'>;
  readonly reasonCode: SupportDraftReasonCode;
}

/**
 * The support draft driver interface.
 *
 * `PlanDriver` cannot be reused: `generateCandidate(features: DerivedFeatures):
 * Promise<FundingReadinessPlanV1>` is plan-shaped on both sides and cannot
 * express a reply draft. `SupervisorVerdict` is imported from lane C rather
 * than redeclared, because `{ approved, codes }` is exactly right and forking a
 * shared vocabulary over two fields would be worse than the coupling.
 */
export interface SupportDraftDriver {
  readonly driver: SupportDraftDriverName;
  readonly model: string;
  generateDraft(context: SupportDraftContext, prompt?: ResolvedPrompt): Promise<SupportDraftCandidate>;
  superviseDraft(
    context: SupportDraftContext,
    candidate: SupportDraftCandidate,
    prompt?: ResolvedPrompt,
  ): Promise<SupervisorVerdict>;
}
