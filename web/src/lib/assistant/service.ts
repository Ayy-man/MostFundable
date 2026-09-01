import 'server-only';

// The five assistant operations, orchestrated.
//
// The one worth reading is `answerTurn`. It writes the person's question before
// it asks anything, so a question that produced no answer still appears in the
// history with nothing under it — visibly unanswered, which is what happened.
// The alternative, writing both turns at the end, would make a failed question
// disappear and leave the person unsure whether they had asked it.
//
// Nothing here defers work. There is no retry loop, no timer, and no queue: an
// answer is produced inside the request that asked for it, or it is not
// produced. That is the same discipline `lib/support/service.ts` keeps, for the
// same reason.

import { answerForScope } from './answer.ts';
import { createAssistantRepository } from './repository.ts';
import { AssistantError, toAssistantError } from './types.ts';

import type { SessionProfile } from '../auth/session.ts';
import type { AssistantAnswerDependencies } from './answer.ts';
import type { AssistantRepository } from './repository.ts';
import type {
  AssistantConversation,
  AssistantProgressEvent,
  AssistantScope,
  AssistantTurn,
} from './types.ts';

export const QUESTION_MIN_LENGTH = 1;
export const QUESTION_MAX_LENGTH = 800;

export interface AssistantAnswerResult {
  readonly turn: AssistantTurn;
  readonly conversation: AssistantConversation;
}

export interface AssistantServiceDeps {
  readonly repository?: AssistantRepository;
  readonly answer?: typeof answerForScope;
}

export interface AssistantService {
  listConversations(session: SessionProfile): Promise<readonly AssistantConversation[]>;
  openConversation(scope: AssistantScope, session: SessionProfile): Promise<AssistantConversation>;
  readConversation(
    conversationId: string,
    session: SessionProfile,
  ): Promise<{ conversation: AssistantConversation; turns: readonly AssistantTurn[] } | null>;
  deleteConversation(conversationId: string, session: SessionProfile): Promise<void>;
  answerTurn(
    conversationId: string,
    question: string,
    session: SessionProfile,
    onProgress: (event: AssistantProgressEvent) => void,
  ): Promise<AssistantAnswerResult>;
}

export function createAssistantService(deps: AssistantServiceDeps = {}): AssistantService {
  const repository = deps.repository ?? createAssistantRepository();
  const answer = deps.answer ?? answerForScope;

  return {
    listConversations(session) {
      return repository.listConversations(session.id);
    },

    openConversation(scope, session) {
      return repository.openConversation(scope, session.id);
    },

    async readConversation(conversationId, session) {
      const [conversation] = await repository.listConversations(session.id, conversationId);
      // A conversation the actor cannot see and one that does not exist answer
      // identically, so the response cannot be used to probe for ids.
      if (conversation === undefined) return null;
      const turns = await repository.listTurns(conversationId, session.id);
      return { conversation, turns };
    },

    deleteConversation(conversationId, session) {
      return repository.deleteConversation(conversationId, session.id);
    },

    async answerTurn(conversationId, question, session, onProgress) {
      const trimmed = question.trim();
      if (trimmed.length < QUESTION_MIN_LENGTH || trimmed.length > QUESTION_MAX_LENGTH) {
        throw new AssistantError('ASSISTANT_REQUEST_INVALID');
      }

      const [conversation] = await repository.listConversations(session.id, conversationId);
      if (conversation === undefined) throw new AssistantError('ASSISTANT_NOT_FOUND');

      // The question is stored first, and this is also what re-checks the actor:
      // `assistant_append_turn` refuses a conversation the actor cannot reach,
      // so a caller who got past the read above still cannot write.
      await repository.appendTurn({
        actorProfileId: session.id,
        body: trimmed,
        conversationId,
        role: 'user',
      });

      let produced;
      try {
        produced = await answer(conversation.scope, trimmed, session, {
          onProgress,
        } satisfies AssistantAnswerDependencies);
      } catch (error) {
        // No assistant turn is written. The question stays in the history with
        // nothing under it, which is the state the conversation is actually in.
        throw toAssistantError(error);
      }

      const turn = await repository.appendTurn({
        actorProfileId: session.id,
        body: produced.body,
        conversationId,
        role: 'assistant',
        sources: produced.sources,
      });

      // Re-read rather than patched: the first question rewrites the title and
      // every turn moves `last_activity_at`, both inside the RPC, so the row we
      // held before the write is already stale.
      const [refreshed] = await repository.listConversations(session.id, conversationId);
      return { conversation: refreshed ?? conversation, turn };
    },
  };
}

const defaultService = createAssistantService();

export function listConversations(
  session: SessionProfile,
): Promise<readonly AssistantConversation[]> {
  return defaultService.listConversations(session);
}

export function openConversation(
  scope: AssistantScope,
  session: SessionProfile,
): Promise<AssistantConversation> {
  return defaultService.openConversation(scope, session);
}

export function readConversation(
  conversationId: string,
  session: SessionProfile,
): Promise<{ conversation: AssistantConversation; turns: readonly AssistantTurn[] } | null> {
  return defaultService.readConversation(conversationId, session);
}

export function deleteConversation(
  conversationId: string,
  session: SessionProfile,
): Promise<void> {
  return defaultService.deleteConversation(conversationId, session);
}

export function answerTurn(
  conversationId: string,
  question: string,
  session: SessionProfile,
  onProgress: (event: AssistantProgressEvent) => void,
): Promise<AssistantAnswerResult> {
  return defaultService.answerTurn(conversationId, question, session, onProgress);
}
