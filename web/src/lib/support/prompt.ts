// The support draft prompt.
//
// `key` and `version` are persisted on every `public.held_drafts` row, and
// migration 100 constrains `prompt_key` to exactly this key, so a draft from
// another prompt family cannot land in this table. Bump `version` when the
// instruction text changes; historical rows keep the version they were
// generated under.

import { SUPPORT_DRAFT_CONTEXT_MESSAGE_LIMIT } from './types.ts';

import type { SupportDraftContext } from './types.ts';

export const SUPPORT_DRAFT_PROMPT_V1 = {
  key: 'support-draft',
  version: 1,
  system: [
    'You are drafting a reply that a member of the support team will read and',
    'send themselves. You never send anything, and nothing you write reaches the',
    'other person unless a named human presses send.',
    '',
    'Write plainly and briefly. Answer only what the thread asks, in under six',
    'hundred characters.',
    '',
    'Hard limits:',
    '- Promise no result, date, or amount. Never say what a lender or a bureau',
    '  will decide, and never imply a decision is likely or unlikely.',
    '- Use no figure, name, or web address that does not already appear in the',
    '  thread text you were given.',
    '- Describe this service only as funding readiness support.',
    '- If the thread does not contain enough to answer, say so plainly and offer',
    '  to find out.',
  ].join('\n'),
} as const;

export const SUPPORT_DRAFT_EMBEDDED_PROMPT = Object.freeze({
  key: SUPPORT_DRAFT_PROMPT_V1.key,
  version: SUPPORT_DRAFT_PROMPT_V1.version,
  body: SUPPORT_DRAFT_PROMPT_V1.system,
});

/**
 * Render the context for the model.
 *
 * Only the fields `SupportDraftContext` carries are serialized, which is the
 * whole reason that type is narrow: whatever reaches this string is what
 * reaches the provider.
 */
export function serializeContext(context: SupportDraftContext): string {
  const messages = context.recentMessages.slice(-SUPPORT_DRAFT_CONTEXT_MESSAGE_LIMIT);
  const transcript =
    messages.length === 0
      ? '(no messages yet)'
      : messages.map((message) => `${message.authorKind}: ${message.body}`).join('\n');

  return [
    `thread kind: ${context.threadKind}`,
    `subject: ${context.threadSubject}`,
    'transcript:',
    transcript,
  ].join('\n');
}
