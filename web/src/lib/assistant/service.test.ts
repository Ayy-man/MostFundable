import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeAnswerBody } from '../kb/answer-body.ts';
import {
  createAssistantService,
  QUESTION_MAX_LENGTH,
  QUESTION_MIN_LENGTH,
} from './service.ts';
import { AssistantError } from './types.ts';

import type { SessionProfile } from '../auth/session.ts';
import type { AppendTurnInput, AssistantRepository } from './repository.ts';
import type { AssistantAnswer } from './answer.ts';
import type { AssistantServiceDeps } from './service.ts';
import type { AssistantConversation, AssistantTurn } from './types.ts';

function session(): SessionProfile {
  return { disabledAt: null, id: 'operator-1', manages: [], orgId: 'org-1', orgMembership: null, orgRole: 'owner', role: 'operator_member' };
}

interface Fake {
  readonly repository: AssistantRepository;
  /** Every repository call and every answer attempt, in the order they happened. */
  readonly log: string[];
  readonly turns: AppendTurnInput[];
  activity: number;
}

function fakeRepository(): Fake {
  const fake: Fake = { activity: 0, log: [], repository: undefined as unknown as AssistantRepository, turns: [] };
  const conversation = (): AssistantConversation => ({
    createdAt: '2026-08-22T00:00:00Z',
    id: 'conversation-1',
    lastActivityAt: `2026-08-22T00:0${fake.activity}:00Z`,
    messageCount: fake.turns.length,
    scope: 'operator',
    title: fake.turns.length === 0 ? 'New conversation' : fake.turns[0]!.body.slice(0, 40),
  });

  const repository: AssistantRepository = {
    async appendTurn(input) {
      fake.log.push(`appendTurn:${input.role}`);
      fake.turns.push(input);
      fake.activity += 1;
      // The parts are decoded here for the same reason the real repository
      // decodes them at the row boundary: a fake that filled them in by hand
      // would let the service pass against a shape the repository never
      // produces.
      const decoded = decodeAnswerBody(input.body);
      return {
        body: input.body,
        bullets: decoded.bullets,
        createdAt: '2026-08-22T00:01:00Z',
        headline: decoded.headline,
        id: `turn-${fake.turns.length}`,
        role: input.role,
        sources: input.sources ?? [],
      } satisfies AssistantTurn;
    },
    async deleteConversation() { fake.log.push('deleteConversation'); },
    async listConversations(_actorProfileId, conversationId) {
      fake.log.push(conversationId === undefined || conversationId === null ? 'listConversations' : 'readConversation');
      return [conversation()];
    },
    async listTurns() { fake.log.push('listTurns'); return []; },
    async openConversation() { fake.log.push('openConversation'); return conversation(); },
  };

  return { ...fake, repository };
}

function answering(body: string): AssistantServiceDeps['answer'] {
  return async () => ({ body, sources: [] } satisfies AssistantAnswer);
}

describe('assistant service', () => {
  it('stores the question before it asks anything', async () => {
    // A question that reached the model has to be in the history whatever the
    // model does, so that a person who asked and got nothing can see that they
    // asked. Watched failing with the user turn moved below the `answer` call:
    // the log then reads answer, appendTurn:user, appendTurn:assistant.
    const fake = fakeRepository();
    const order: string[] = [];
    const service = createAssistantService({
      answer: async () => { order.push(...fake.log, 'answer'); return { body: 'Answered.', sources: [] }; },
      repository: fake.repository,
    });

    await service.answerTurn('conversation-1', 'Where does this client stand?', session(), () => {});

    assert.equal(order.includes('appendTurn:user'), true);
    assert.equal(order.at(-1), 'answer');
    assert.deepEqual(fake.log, ['readConversation', 'appendTurn:user', 'appendTurn:assistant', 'readConversation']);
  });

  it('leaves a failed question standing with nothing under it', async () => {
    // Watched failing against the same reordering: with both writes below the
    // `answer` call, a failed answer writes nothing and the question vanishes.
    const fake = fakeRepository();
    const service = createAssistantService({
      answer: async () => { throw new AssistantError('ASSISTANT_ANSWER_UNAVAILABLE'); },
      repository: fake.repository,
    });

    await assert.rejects(
      service.answerTurn('conversation-1', 'Where does this client stand?', session(), () => {}),
      (error: unknown) => error instanceof AssistantError && error.code === 'ASSISTANT_ANSWER_UNAVAILABLE',
    );

    assert.deepEqual(fake.turns.map((input) => input.role), ['user']);
  });

  it('returns the conversation as it stands after the write, not before', async () => {
    // The first question rewrites the title and every turn moves
    // `last_activity_at`, both inside the RPC. Returning the row read before the
    // write would hand the surface a conversation still called "New
    // conversation" and make the sidebar look a turn behind.
    const fake = fakeRepository();
    const service = createAssistantService({
      answer: answering('Answered.'),
      repository: fake.repository,
    });

    const before = (await fake.repository.listConversations(session().id, 'conversation-1'))[0]!;
    const result = await service.answerTurn('conversation-1', 'Where does this client stand?', session(), () => {});

    assert.notEqual(result.conversation.title, before.title);
    assert.notEqual(result.conversation.lastActivityAt, before.lastActivityAt);
  });

  it('refuses a question outside the length the module publishes', async () => {
    // The bounds come from the exported constants rather than from numbers typed
    // here, so a widened limit moves the test with it instead of leaving it
    // asserting a limit the module no longer has.
    const fake = fakeRepository();
    const service = createAssistantService({ answer: answering('Answered.'), repository: fake.repository });

    for (const question of ['   '.repeat(QUESTION_MIN_LENGTH), 'a'.repeat(QUESTION_MAX_LENGTH + 1)]) {
      await assert.rejects(
        service.answerTurn('conversation-1', question, session(), () => {}),
        (error: unknown) => error instanceof AssistantError && error.code === 'ASSISTANT_REQUEST_INVALID',
      );
    }

    assert.deepEqual(fake.turns, []);
  });

  it('answers a conversation it cannot see the same way as one that does not exist', async () => {
    // Both are `null` from `readConversation` and `ASSISTANT_NOT_FOUND` from
    // `answerTurn`, so neither response can be used to find out which ids exist.
    const fake = fakeRepository();
    const empty: AssistantRepository = { ...fake.repository, async listConversations() { return []; } };
    const service = createAssistantService({ answer: answering('Answered.'), repository: empty });

    assert.equal(await service.readConversation('conversation-9', session()), null);
    await assert.rejects(
      service.answerTurn('conversation-9', 'Where does this client stand?', session(), () => {}),
      (error: unknown) => error instanceof AssistantError && error.code === 'ASSISTANT_NOT_FOUND',
    );
  });

  it('never reads the turns of a conversation the actor could not list', async () => {
    const fake = fakeRepository();
    const empty: AssistantRepository = { ...fake.repository, async listConversations() { fake.log.push('readConversation'); return []; } };
    const service = createAssistantService({ answer: answering('Answered.'), repository: empty });

    await service.readConversation('conversation-9', session());

    assert.equal(fake.log.includes('listTurns'), false);
  });
});
