// The deterministic support draft driver.
//
// It is the default with an empty environment (DEC-OWN-CREDLESS), which is what
// lets every proof in this phase run with no provider account and no key. There
// is no randomness, no clock read, and no network call anywhere below: the same
// context produces a byte-identical candidate every time.
//
// The `fallback` intent returns 0.40, below the 0.7 default bar. That is
// deliberate rather than incidental — it is how SUPP-04's negative path gets
// exercised in CI: an unrecognized question yields a draft a person can read
// and nobody can send, with no key involved.

import { serializeContext } from './prompt.ts';
import { createMockChatTransport } from '../llm/mock-chat-transport.ts';

import type {
  SupervisorVerdict,
  SupportAuthorKind,
  SupportDraftCandidate,
  SupportDraftContext,
  SupportDraftContextMessage,
  SupportDraftDriver,
  SupportThreadKind,
} from './types.ts';

export const MOCK_SUPPORT_DRAFT_MODEL = 'support-draft-mock-v1';

const MATCHED_INTENT_CONFIDENCE = 0.86;
const FALLBACK_INTENT_CONFIDENCE = 0.4;

const SUPERVISOR_MAX_BODY_LENGTH = 600;

export type SupportDraftIntent =
  | 'status_update'
  | 'document_request'
  | 'scheduling'
  | 'billing_question'
  | 'fallback';

/**
 * Who writes the draft, by thread kind. `team_chat` is the client contact
 * talking to their account team, so the operator drafts; `platform_support` is
 * an operator talking to the platform team, so the admin drafts. The inbound
 * message the driver classifies is the most recent one from the other side.
 */
const DRAFTING_SIDE: Readonly<Record<SupportThreadKind, SupportAuthorKind>> = Object.freeze({
  team_chat: 'operator',
  platform_support: 'admin',
});

/**
 * The frozen intent table, matched in declaration order so a body mentioning
 * two topics always resolves the same way.
 */
const INTENT_RULES: readonly {
  readonly intent: Exclude<SupportDraftIntent, 'fallback'>;
  readonly patterns: readonly RegExp[];
}[] = Object.freeze([
  {
    intent: 'status_update',
    patterns: [/\bstatus\b/i, /\bupdate\b/i, /\bprogress\b/i, /\bwhere\s+(are|do)\s+we\b/i],
  },
  {
    intent: 'document_request',
    patterns: [/\bdocument/i, /\bupload/i, /\bstatement/i, /\bpaperwork\b/i, /\battach/i],
  },
  {
    intent: 'scheduling',
    patterns: [/\bschedul/i, /\bcalendar\b/i, /\bmeeting\b/i, /\bavailab/i, /\bcall\b/i],
  },
  {
    intent: 'billing_question',
    patterns: [/\bbilling\b/i, /\binvoice\b/i, /\bcharge/i, /\bpayment\b/i, /\bsubscription\b/i],
  },
]);

/**
 * One template per intent. Every string here is written to pass
 * `verify-compliance-copy.mjs` on the first run — none of them is allow-listed,
 * and none carries a figure, so the supervisor's grounding check cannot trip on
 * the driver's own output.
 */
const INTENT_TEMPLATES: Readonly<Record<SupportDraftIntent, string>> = Object.freeze({
  status_update:
    'Thanks for checking in. Your file is with the team and we are working ' +
    'through the current step. I will follow up here as soon as the next one ' +
    'is done, and you can always ask me where things stand.',
  document_request:
    'Happy to help with that. You can add the file from the documents area of ' +
    'your account, and it lands with us straight away. If anything will not ' +
    'upload, tell me what you are seeing and I will sort it out from this end.',
  scheduling:
    'Glad to set up a time. Send me a couple of windows that suit you and I ' +
    'will confirm one back here, along with who from the team will join.',
  billing_question:
    'Thanks for raising it. I can walk through what is on your account and ' +
    'where each line comes from. Tell me which entry you are asking about and ' +
    'I will explain it, or get it corrected if it is wrong.',
  fallback:
    'Thanks for writing in. I want to make sure I answer the right question, ' +
    'so could you tell me a little more about what you need? I will pick this ' +
    'up as soon as you reply.',
});

function inboundMessage(
  context: SupportDraftContext,
): SupportDraftContextMessage | undefined {
  const draftingSide = DRAFTING_SIDE[context.threadKind];
  for (let index = context.recentMessages.length - 1; index >= 0; index -= 1) {
    const message = context.recentMessages[index];
    if (message.authorKind !== draftingSide) return message;
  }
  return context.recentMessages[context.recentMessages.length - 1];
}

export function classifyIntent(context: SupportDraftContext): SupportDraftIntent {
  const message = inboundMessage(context);
  if (message === undefined) return 'fallback';

  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(message.body))) return rule.intent;
  }
  return 'fallback';
}

function digitRuns(value: string): string[] {
  return value.match(/\d+/g) ?? [];
}

export function createMockSupportDraftDriver(): SupportDraftDriver {
  const transport = createMockChatTransport((request) => {
    const payload = JSON.parse(request.messages.at(-1)?.content ?? '{}') as {
      context?: SupportDraftContext;
      candidate?: SupportDraftCandidate;
    };
    const context = payload.context;
    if (context === undefined) throw new Error('SUPPORT_MOCK_CONTEXT_INVALID');
    if (request.operation === 'support.candidate') {
      const intent = classifyIntent(context);
      return {
        body: INTENT_TEMPLATES[intent],
        confidence: intent === 'fallback' ? FALLBACK_INTENT_CONFIDENCE : MATCHED_INTENT_CONFIDENCE,
        model: MOCK_SUPPORT_DRAFT_MODEL,
      };
    }
    if (request.operation === 'support.supervisor' && payload.candidate !== undefined) {
      const candidate = payload.candidate;
      const codes: string[] = [];
      const serialized = serializeContext(context);
      const grounded = new Set(digitRuns(serialized));
      if (digitRuns(candidate.body).some((run) => !grounded.has(run))) codes.push('UNGROUNDED_NUMBER');
      if (candidate.body.length > SUPERVISOR_MAX_BODY_LENGTH) codes.push('LENGTH');
      if (candidate.body.includes('http://') || candidate.body.includes('https://')) codes.push('UNGROUNDED_LINK');
      return { approved: codes.length === 0, codes };
    }
    throw new Error('SUPPORT_MOCK_OPERATION_INVALID');
  }, MOCK_SUPPORT_DRAFT_MODEL);

  return {
    driver: 'mock',
    model: MOCK_SUPPORT_DRAFT_MODEL,

    async generateDraft(context: SupportDraftContext): Promise<SupportDraftCandidate> {
      return await transport.complete({
        operation: 'support.candidate',
        schemaName: 'support_mock_candidate_v1',
        schema: {},
        maxTokens: 512,
        messages: [{ role: 'user', content: JSON.stringify({ context }) }],
      }) as SupportDraftCandidate;
    },

    async superviseDraft(
      context: SupportDraftContext,
      candidate: SupportDraftCandidate,
    ): Promise<SupervisorVerdict> {
      return await transport.complete({
        operation: 'support.supervisor',
        schemaName: 'support_mock_supervisor_v1',
        schema: {},
        maxTokens: 256,
        messages: [{ role: 'user', content: JSON.stringify({ context, candidate }) }],
      }) as SupervisorVerdict;
    },
  };
}
