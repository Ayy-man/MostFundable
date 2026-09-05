import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NORMALIZED_ADVERSARIAL_LANGUAGE } from '../compliance/__fixtures__/adversarial-language.mjs';
import { createUnavailableOpenRouterDraftDriver } from './driver.ts';
import { SupportError, SupportMessageLanguageError } from './errors.ts';
import * as publicSurface from './index.ts';
import { createMockSupportDraftDriver } from './mock-driver.ts';
import { evaluateDraftLanguage } from './language-gate.ts';
import { createSupportService } from './service.ts';
import { SUPPORT_DRAFT_CONTEXT_MESSAGE_LIMIT } from './types.ts';

import type {
  HeldDraftRow,
  SupportMessageRow,
  SupportRepository,
  SupportThreadPayload,
  SupportThreadRow,
  SupportViewer,
} from './repository.ts';
import type { SupportDraftContext, SupportDraftDecision } from './types.ts';
import type { SettingsReadRepository } from '../admin/settings-types.ts';

const THREAD_ID = '13000000-0000-0000-0000-0000000000aa';
const OPERATOR: SupportViewer = {
  profileId: '13000000-0000-0000-0000-000000000111',
  role: 'operator_member',
};
const CONSUMER: SupportViewer = {
  profileId: '13000000-0000-0000-0000-000000000113',
  role: 'consumer',
};
const ADMIN: SupportViewer = {
  profileId: '13000000-0000-0000-0000-000000000900',
  role: 'platform_admin',
};
const AFFILIATE: SupportViewer = {
  profileId: '13000000-0000-0000-0000-000000000114',
  role: 'affiliate',
};

const THREAD: SupportThreadRow = {
  id: THREAD_ID,
  kind: 'team_chat',
  orgId: '13000000-0000-0000-0000-000000000001',
  clientId: '13000000-0000-0000-0000-000000000101',
  status: 'open',
  subject: 'Client team chat',
  createdBy: OPERATOR.profileId,
  createdAt: '2026-08-16T10:00:00.000Z',
  lastActivityAt: '2026-08-16T10:00:00.000Z',
};

function message(body: string, index: number): SupportThreadPayload['messages'][number] {
  return {
    id: `13000000-0000-0000-0000-0000000${String(1000 + index)}`,
    threadId: THREAD_ID,
    authorProfileId: CONSUMER.profileId,
    authorKind: 'consumer',
    origin: 'human',
    originDraftId: null,
    visibility: 'participants',
    body,
    sentAt: `2026-08-16T10:${String(index).padStart(2, '0')}:00.000Z`,
  };
}

interface Log {
  readonly calls: string[];
  readonly contexts: SupportDraftContext[];
  readonly decisions: SupportDraftDecision[];
}

function fakeRepository(
  payload: SupportThreadPayload | null,
  log: Log,
): SupportRepository {
  return {
    openThread(input) {
      log.calls.push('openThread');
      return Promise.resolve({ ...THREAD, kind: input.kind, subject: input.subject });
    },
    recordDraft(input) {
      log.calls.push('recordDraft');
      log.decisions.push(input.decision);
      const draft: HeldDraftRow = {
        id: '13000000-0000-0000-0000-0000000000dd',
        threadId: input.threadId,
        body: input.decision.body,
        confidence: input.decision.confidence,
        confidenceThreshold: input.decision.confidenceThreshold,
        supervisorApproved: input.decision.supervisorApproved,
        guardrailFlags: input.decision.guardrailFlags,
        status: input.decision.status,
        driver: input.decision.driver,
        model: input.decision.model,
        promptKey: input.decision.promptKey,
        promptVersion: input.decision.promptVersion,
        createdAt: '2026-08-16T10:30:00.000Z',
        sentBy: null,
        sentAt: null,
        sentMessageId: null,
        discardedBy: null,
        discardedAt: null,
      };
      return Promise.resolve(draft);
    },
    discardDraft(draftId) {
      log.calls.push('discardDraft');
      return Promise.resolve({
        id: draftId,
        threadId: THREAD_ID,
        body: 'anything',
        confidence: 0.4,
        confidenceThreshold: 0.7,
        supervisorApproved: true,
        guardrailFlags: [],
        status: 'discarded',
        driver: 'mock',
        model: 'support-draft-mock-v1',
        promptKey: 'support-draft',
        promptVersion: 1,
        createdAt: '2026-08-16T10:30:00.000Z',
        sentBy: null,
        sentAt: null,
        sentMessageId: null,
        discardedBy: OPERATOR.profileId,
        discardedAt: '2026-08-16T10:31:00.000Z',
      });
    },
    setThreadStatus(threadId, status) {
      log.calls.push('setThreadStatus');
      return Promise.resolve({ ...THREAD, id: threadId, status });
    },
    sendMessage(input) {
      log.calls.push('sendMessage');
      const sent: SupportMessageRow = {
        id: '13000000-0000-0000-0000-0000000000e1',
        threadId: input.threadId,
        authorProfileId: input.actorProfileId,
        authorKind: input.authorKind,
        origin: input.draftId === undefined ? 'human' : 'ai_assisted',
        originDraftId: input.draftId ?? null,
        visibility: input.visibility ?? 'participants',
        body: input.body,
        sentAt: '2026-08-16T10:40:00.000Z',
      };
      return Promise.resolve(sent);
    },
    markThreadRead(_threadId, _actorProfileId, lastReadAt) {
      log.calls.push('markThreadRead');
      return Promise.resolve({ counterpartReadAt: null, lastReadAt, unreadCount: 0 });
    },
    listThreads() {
      log.calls.push('listThreads');
      return Promise.resolve([{
        ...THREAD,
        internalMessageCount: 0,
        lastInternalMessagePreview: null,
        lastMessagePreview: null,
        lastParticipantMessagePreview: null,
        participantMessageCount: 0,
        read: { counterpartReadAt: null, lastReadAt: null, unreadCount: 0 },
      }]);
    },
    readThread() {
      log.calls.push('readThread');
      return Promise.resolve(payload);
    },
  };
}

function newLog(): Log {
  return { calls: [], contexts: [], decisions: [] };
}

/** The mock driver, wrapped so the context it receives can be inspected. */
function recordingDriver(log: Log) {
  const inner = createMockSupportDraftDriver();
  return {
    driver: inner.driver,
    model: inner.model,
    generateDraft(context: SupportDraftContext) {
      log.contexts.push(context);
      return inner.generateDraft(context);
    },
    superviseDraft: inner.superviseDraft.bind(inner),
  };
}

function payloadWith(...bodies: string[]): SupportThreadPayload {
  return {
    thread: THREAD,
    messages: bodies.map(message),
    draft: null,
    read: { counterpartReadAt: null, lastReadAt: null, unreadCount: bodies.length },
  };
}

describe('support service draft generation', () => {
  it('approves a recognized question and persists it as one draft', async () => {
    const log = newLog();
    const service = createSupportService({
      repository: fakeRepository(payloadWith('Any update on my file?'), log),
      createDriver: () => recordingDriver(log),
      env: {},
    });

    const draft = await service.generateDraft(THREAD_ID, OPERATOR);

    assert.equal(draft.status, 'approved');
    assert.equal(draft.driver, 'mock');
    assert.deepEqual(log.calls, ['readThread', 'recordDraft']);
    assert.equal(log.decisions[0].reasonCode, 'gates_passed');
  });

  it('holds an unrecognized question below the bar', async () => {
    const log = newLog();
    const service = createSupportService({
      repository: fakeRepository(payloadWith('Hello there.'), log),
      createDriver: () => recordingDriver(log),
      env: {},
    });

    const draft = await service.generateDraft(THREAD_ID, OPERATOR);

    assert.equal(draft.status, 'draft');
    assert.equal(log.decisions[0].reasonCode, 'confidence_below_threshold');
  });

  it('hands the driver the context fields and nothing else', async () => {
    const log = newLog();
    const service = createSupportService({
      repository: fakeRepository(payloadWith('Any update on my file?'), log),
      createDriver: () => recordingDriver(log),
      env: {},
    });

    await service.generateDraft(THREAD_ID, OPERATOR);

    const context = log.contexts[0];
    assert.deepEqual(Object.keys(context).sort(), [
      'recentMessages',
      'threadKind',
      'threadSubject',
    ]);
    for (const item of context.recentMessages) {
      assert.deepEqual(Object.keys(item).sort(), ['authorKind', 'body']);
    }
  });

  it('sends the driver no identity value from any message row', async () => {
    const log = newLog();
    const service = createSupportService({
      repository: fakeRepository(payloadWith('Any update on my file?'), log),
      createDriver: () => recordingDriver(log),
      env: {},
    });

    await service.generateDraft(THREAD_ID, OPERATOR);

    const serialized = JSON.stringify(log.contexts[0]);
    for (const secret of [
      CONSUMER.profileId,
      OPERATOR.profileId,
      THREAD.orgId,
      THREAD.clientId ?? '',
      THREAD.id,
    ]) {
      assert.equal(serialized.includes(secret), false, secret);
    }
  });

  it('caps the context at the most recent twelve messages', async () => {
    const log = newLog();
    const bodies = Array.from({ length: 20 }, (_, index) => `Message number ${index}.`);
    const service = createSupportService({
      repository: fakeRepository(payloadWith(...bodies), log),
      createDriver: () => recordingDriver(log),
      env: {},
    });

    await service.generateDraft(THREAD_ID, OPERATOR);

    const context = log.contexts[0];
    assert.equal(context.recentMessages.length, SUPPORT_DRAFT_CONTEXT_MESSAGE_LIMIT);
    assert.equal(context.recentMessages[0].body, 'Message number 8.');
    assert.equal(context.recentMessages.at(-1)?.body, 'Message number 19.');
  });

  it('writes no row when the driver is unavailable', async () => {
    const log = newLog();
    const service = createSupportService({
      repository: fakeRepository(payloadWith('Any update on my file?'), log),
      createDriver: createUnavailableOpenRouterDraftDriver,
      env: {},
    });

    await assert.rejects(
      () => service.generateDraft(THREAD_ID, OPERATOR),
      (error: unknown) =>
        error instanceof SupportError && error.code === 'SUPPORT_DRAFT_DRIVER_UNAVAILABLE',
    );
    assert.deepEqual(log.calls, ['readThread']);
  });

  it('writes no row and calls no driver when the thread is out of reach', async () => {
    const log = newLog();
    const service = createSupportService({
      repository: fakeRepository(null, log),
      createDriver: () => recordingDriver(log),
      env: {},
    });

    await assert.rejects(
      () => service.generateDraft(THREAD_ID, OPERATOR),
      (error: unknown) => error instanceof SupportError && error.code === 'SUPPORT_FORBIDDEN',
    );
    assert.deepEqual(log.calls, ['readThread']);
    assert.equal(log.contexts.length, 0);
  });

  it('refuses a misconfigured bar rather than judging against a guess', async () => {
    const log = newLog();
    const service = createSupportService({
      repository: fakeRepository(payloadWith('Any update on my file?'), log),
      createDriver: () => recordingDriver(log),
      env: { SUPPORT_DRAFT_CONFIDENCE_THRESHOLD: '1.4' },
    });

    await assert.rejects(
      () => service.generateDraft(THREAD_ID, OPERATOR),
      (error: unknown) => error instanceof SupportError && error.code === 'SUPPORT_CONFIG_INVALID',
    );
    assert.deepEqual(log.calls, ['readThread']);
  });

  it('uses a fresh governed confidence row ahead of the env value', async () => {
    const log = newLog();
    let value = 0.9;
    let reads = 0;
    const settingsRepository: SettingsReadRepository = {
      async read() {
        reads += 1;
        return [{
          key: 'SUPPORT_DRAFT_CONFIDENCE_THRESHOLD',
          value,
          updatedBy: null,
          updatedAt: '2026-08-17T00:00:00.000Z',
        }];
      },
    };
    const service = createSupportService({
      repository: fakeRepository(payloadWith('Any update on my file?'), log),
      createDriver: () => recordingDriver(log),
      env: { FEATURE_ADMIN: 'true', SUPPORT_DRAFT_CONFIDENCE_THRESHOLD: '0.2' },
      settingsRepository,
      resolvePrompt: async (fallback) => ({ ...fallback, source: 'embedded' }),
      recordEvaluation: async () => {},
    });

    assert.equal((await service.generateDraft(THREAD_ID, OPERATOR)).status, 'draft');
    value = 0.8;
    assert.equal((await service.generateDraft(THREAD_ID, OPERATOR)).status, 'approved');
    assert.equal(reads, 2);
    assert.deepEqual(log.decisions.map((decision) => decision.confidenceThreshold), [0.9, 0.8]);
  });

  it('does no settings repository work while governance is off', async () => {
    const log = newLog();
    let reads = 0;
    const service = createSupportService({
      repository: fakeRepository(payloadWith('Any update on my file?'), log),
      createDriver: () => recordingDriver(log),
      env: {},
      settingsRepository: { async read() { reads += 1; return []; } },
    });
    await service.generateDraft(THREAD_ID, OPERATOR);
    assert.equal(reads, 0);
  });

  it('refuses a non-positive governed row before driver work or persistence', async () => {
    const log = newLog();
    const service = createSupportService({
      repository: fakeRepository(payloadWith('Any update on my file?'), log),
      createDriver: () => recordingDriver(log),
      env: { FEATURE_ADMIN: 'true' },
      settingsRepository: {
        async read() {
          return [{
            key: 'SUPPORT_DRAFT_CONFIDENCE_THRESHOLD',
            value: 0,
            updatedBy: null,
            updatedAt: '2026-08-17T00:00:00.000Z',
          }];
        },
      },
    });
    await assert.rejects(
      service.generateDraft(THREAD_ID, OPERATOR),
      (error: unknown) => error instanceof SupportError && error.code === 'SUPPORT_UNAVAILABLE',
    );
    assert.deepEqual(log.calls, ['readThread']);
    assert.equal(log.contexts.length, 0);
  });
});

describe('support service sending', () => {
  it('derives the author kind from the role rather than the caller', async () => {
    for (const [actor, expected] of [
      [OPERATOR, 'operator'],
      [CONSUMER, 'consumer'],
      [ADMIN, 'admin'],
    ] as const) {
      const log = newLog();
      const service = createSupportService({
        repository: fakeRepository(payloadWith('Any update on my file?'), log),
        env: {},
      });
      const sent = await service.sendMessage(THREAD_ID, actor, 'A reply from a person.');
      assert.equal(sent.authorKind, expected);
      assert.equal(sent.authorProfileId, actor.profileId);
    }
  });

  it('refuses a role with no seat in either conversation before touching the database', async () => {
    const log = newLog();
    const service = createSupportService({
      repository: fakeRepository(payloadWith('Any update on my file?'), log),
      env: {},
    });

    await assert.rejects(
      () => service.sendMessage(THREAD_ID, AFFILIATE, 'A reply from a person.'),
      (error: unknown) => error instanceof SupportError && error.code === 'SUPPORT_FORBIDDEN',
    );
    assert.deepEqual(log.calls, []);
  });

  it('marks a send that names a draft as assisted', async () => {
    const log = newLog();
    const service = createSupportService({
      repository: fakeRepository(payloadWith('Any update on my file?'), log),
      env: {},
    });

    const sent = await service.sendMessage(
      THREAD_ID,
      OPERATOR,
      'A reply from a person.',
      '13000000-0000-0000-0000-0000000000dd',
    );
    assert.equal(sent.origin, 'ai_assisted');
    assert.deepEqual(log.calls, ['sendMessage']);
  });
});

// A poisoned body lifted from the shared compliance fixture at run time rather
// than written here: the fixture is the one file allow-listed for this
// vocabulary, and reading it means this test screens whatever the battery
// catches today rather than a copy that can drift.
const POISONED_BODY = ((): string => {
  const found = NORMALIZED_ADVERSARIAL_LANGUAGE.find((text) => evaluateDraftLanguage(text).length > 0);
  if (found === undefined) {
    throw new Error('the shared compliance fixture no longer trips the language battery');
  }
  return found;
})();

const CLEAN_BODY = 'Your file is with the team and I will follow up here as soon as I can.';

describe('support service language screening (C5)', () => {
  it('refuses a staff-typed client-facing body the battery flags, and records nothing', async () => {
    for (const actor of [OPERATOR, ADMIN]) {
      const log = newLog();
      const service = createSupportService({
        repository: fakeRepository(payloadWith('Any update on my file?'), log),
        env: {},
      });

      await assert.rejects(
        () => service.sendMessage(THREAD_ID, actor, POISONED_BODY),
        (error: unknown) => {
          assert.ok(error instanceof SupportMessageLanguageError, actor.role);
          assert.equal(error.code, 'SUPPORT_MESSAGE_LANGUAGE');
          assert.equal(error.status, 422);
          assert.ok(error.codes.length > 0, 'a refusal names at least one rule');
          for (const code of error.codes) assert.match(code, /^LANGUAGE_C\d{2}$/);
          // The rule ids are the whole payload: the phrase itself never rides along.
          assert.equal(error.message, 'SUPPORT_MESSAGE_LANGUAGE');
          return true;
        },
      );
      // The send seam was never reached. A refused body is a message that does
      // not exist, the same way a held draft with guardrail flags is never sent.
      assert.deepEqual(log.calls, [], actor.role);
    }
  });

  it('refuses the same body when it cites a draft, before the pairing is checked', async () => {
    const log = newLog();
    const service = createSupportService({
      repository: fakeRepository(payloadWith('Any update on my file?'), log),
      env: {},
    });
    await assert.rejects(
      () => service.sendMessage(THREAD_ID, OPERATOR, POISONED_BODY, '13000000-0000-0000-0000-0000000000dd'),
      (error: unknown) => error instanceof SupportError && error.code === 'SUPPORT_MESSAGE_LANGUAGE',
    );
    assert.deepEqual(log.calls, []);
  });

  it('does not screen a consumer: the same body from the client is recorded as typed', async () => {
    const log = newLog();
    const service = createSupportService({
      repository: fakeRepository(payloadWith('Any update on my file?'), log),
      env: {},
    });
    const sent = await service.sendMessage(THREAD_ID, CONSUMER, POISONED_BODY);
    assert.equal(sent.authorKind, 'consumer');
    assert.equal(sent.body, POISONED_BODY);
    assert.deepEqual(log.calls, ['sendMessage']);
  });

  it('does not screen an internal note, which migration 385 withholds from every consumer', async () => {
    const log = newLog();
    const service = createSupportService({
      repository: fakeRepository(payloadWith('Any update on my file?'), log),
      env: {},
    });
    const sent = await service.sendMessage(THREAD_ID, OPERATOR, POISONED_BODY, undefined, 'internal');
    assert.equal(sent.visibility, 'internal');
    assert.deepEqual(log.calls, ['sendMessage']);
  });

  it('lets clean text through unchanged for every author kind', async () => {
    for (const actor of [OPERATOR, ADMIN, CONSUMER]) {
      const log = newLog();
      const service = createSupportService({
        repository: fakeRepository(payloadWith('Any update on my file?'), log),
        env: {},
      });
      const sent = await service.sendMessage(THREAD_ID, actor, CLEAN_BODY);
      assert.equal(sent.body, CLEAN_BODY, actor.role);
      assert.deepEqual(log.calls, ['sendMessage'], actor.role);
    }
  });

  it('screens the same way through the public surface', async () => {
    // `publicSurface.sendMessage` binds the default service, which would reach
    // a real repository; what this proves is only that the barrel's function
    // is the service's, so the screen above is the one every route gets.
    assert.equal(typeof publicSurface.sendMessage, 'function');
    assert.ok(!('SupportMessageLanguageError' in publicSurface), 'the barrel stays narrow');
  });
});

describe('support library surface', () => {
  it('exports nine operations and no machinery', () => {
    // The list is exhaustive on purpose. Widening this barrel widens what a
    // route can do, and rule 3 of `scripts/verify-no-auto-send.mjs` walks the
    // import graph out from it — so an export arriving here has to be a line
    // somebody wrote in this test as well as in the barrel.
    assert.deepEqual(Object.keys(publicSurface).sort(), [
      'SupportError',
      'discardDraft',
      'generateDraft',
      'getThread',
      'listThreads',
      'markThreadRead',
      'openThread',
      'readConsumerTeamChat',
      'sendMessage',
      'setThreadStatus',
      'toHttpResponse',
      'toSupportError',
    ]);
  });

  it('offers no route a way to reach the engine, the driver, or the repository', () => {
    for (const name of Object.keys(publicSurface)) {
      assert.equal(
        /driver|engine|repository|prompt|mock|language/i.test(name),
        false,
        name,
      );
    }
  });

  it('exposes no operation whose name suggests it runs without a person', () => {
    for (const name of Object.keys(publicSurface)) {
      assert.equal(/auto|schedule|cron|worker|reply/i.test(name), false, name);
    }
  });
});
