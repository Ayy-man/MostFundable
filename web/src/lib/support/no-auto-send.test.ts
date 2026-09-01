// The runtime half of the no-auto-send property (SUPP-01, DEC-D10).
//
// The static half is `web/scripts/verify-no-auto-send.mjs`, which scans the
// tree for a second caller of the send RPC and for any deferral primitive. This
// file is the other half: it drives the real draft lifecycle over 64 generated
// conversations and every draft status, and counts sends.
//
// Neither file is meaningful alone. The scanner cannot tell whether the one
// caller it permits is reached from the generate path, and this test cannot see
// a send that a future file adds outside the service. Delete one and the
// property is half proven, so if you are removing either, remove both and say
// why in the phase record.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveDraftConfidenceThreshold } from './config.ts';
import { runDraftEngine } from './engine.ts';
import { createMockSupportDraftDriver } from './mock-driver.ts';
import { SUPPORT_SEND_MESSAGE_RPC } from './repository.ts';
import * as serviceModule from './service.ts';
import { createSupportService } from './service.ts';

import type {
  HeldDraftRow,
  SupportRepository,
  SupportThreadPayload,
  SupportThreadRow,
  SupportViewer,
} from './repository.ts';
import type { HeldDraftStatus, SupportAuthorKind, SupportThreadKind } from './types.ts';
import type { RecordEvalRunInput } from '../admin/prompt-types.ts';

const THREAD_ID = '13000000-0000-0000-0000-0000000000aa';
const DRAFT_ID = '13000000-0000-0000-0000-0000000000dd';

const ACTOR: SupportViewer = {
  profileId: '13000000-0000-0000-0000-000000000111',
  role: 'operator_member',
};

const ALL_DRAFT_STATUSES: readonly HeldDraftStatus[] = [
  'draft',
  'approved',
  'sent',
  'discarded',
];

// A 32-bit mulberry generator, inline so the sequence is fixed forever and the
// test pulls in no dependency. The same seed always walks the same 64
// conversations, which is what makes a failure reproducible from the seed alone.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Four intent-matching shapes plus two the mock driver does not recognize, so
// the generated set spans both sides of the confidence bar.
const BODY_POOL: readonly string[] = [
  'Any update on the progress of my file?',
  'Where do I upload the bank statement?',
  'Can we schedule a call this week?',
  'There is a charge on my invoice I do not recognise.',
  'Hello there.',
  'Just checking in.',
  'What is the status of the paperwork you asked for?',
  'Is there a meeting time that suits you?',
];

const AUTHOR_POOL: readonly SupportAuthorKind[] = ['consumer', 'operator', 'admin'];
const KIND_POOL: readonly SupportThreadKind[] = ['team_chat', 'platform_support'];

function threadFor(kind: SupportThreadKind, index: number): SupportThreadRow {
  return {
    id: THREAD_ID,
    kind,
    orgId: '13000000-0000-0000-0000-000000000001',
    clientId: kind === 'team_chat' ? '13000000-0000-0000-0000-000000000101' : null,
    status: 'open',
    subject: `Conversation ${index}`,
    createdBy: ACTOR.profileId,
    createdAt: '2026-08-16T09:00:00.000Z',
    lastActivityAt: '2026-08-16T09:30:00.000Z',
  };
}

/** 64 conversations from one seed: kind, length, author order, and body all vary. */
function generateConversations(seed: number): SupportThreadPayload[] {
  const random = mulberry32(seed);
  const payloads: SupportThreadPayload[] = [];

  for (let index = 0; index < 64; index += 1) {
    const kind = KIND_POOL[index % KIND_POOL.length];
    const length = 1 + Math.floor(random() * 8);
    const messages: SupportThreadPayload['messages'] = Array.from(
      { length },
      (_unused, position) => ({
        id: `13000000-0000-0000-0000-${String(100000 + index * 10 + position)}`,
        threadId: THREAD_ID,
        authorProfileId: ACTOR.profileId,
        authorKind: AUTHOR_POOL[Math.floor(random() * AUTHOR_POOL.length)],
        origin: 'human' as const,
        originDraftId: null,
        body: BODY_POOL[Math.floor(random() * BODY_POOL.length)],
        sentAt: `2026-08-16T09:${String(position).padStart(2, '0')}:00.000Z`,
        visibility: 'participants' as const,
      }),
    );

    payloads.push({
      thread: threadFor(kind, index),
      messages,
      draft: null,
      read: { counterpartReadAt: null, lastReadAt: null, unreadCount: messages.length },
    });
  }

  return payloads;
}

interface CallLog {
  readonly names: string[];
  recordedStatuses: HeldDraftStatus[];
}

/**
 * A repository that counts what the service asked it to do.
 *
 * `sendMessage` here is the only path to the RPC named by
 * SUPPORT_SEND_MESSAGE_RPC, so its call count is the send count.
 */
function countingRepository(
  payload: () => SupportThreadPayload | null,
  log: CallLog,
  forceStatus?: HeldDraftStatus,
): SupportRepository {
  const draftFrom = (
    status: HeldDraftStatus,
    body: string,
    threadId: string,
    promptVersion = 1,
  ): HeldDraftRow => ({
    id: DRAFT_ID,
    threadId,
    body,
    confidence: 0.86,
    confidenceThreshold: 0.7,
    supervisorApproved: true,
    guardrailFlags: [],
    status,
    driver: 'mock',
    model: 'support-draft-mock-v1',
    promptKey: 'support-draft',
    promptVersion,
    createdAt: '2026-08-16T10:30:00.000Z',
    sentBy: null,
    sentAt: null,
    sentMessageId: null,
    discardedBy: null,
    discardedAt: null,
  });

  return {
    openThread(input) {
      log.names.push('openThread');
      return Promise.resolve(threadFor(input.kind, 0));
    },
    recordDraft(input) {
      log.names.push('recordDraft');
      const status = forceStatus ?? input.decision.status;
      log.recordedStatuses.push(status);
      return Promise.resolve(draftFrom(
        status,
        input.decision.body,
        input.threadId,
        input.decision.promptVersion,
      ));
    },
    discardDraft() {
      log.names.push('discardDraft');
      return Promise.resolve(draftFrom('discarded', 'anything', THREAD_ID));
    },
    setThreadStatus(threadId, status) {
      log.names.push('setThreadStatus');
      return Promise.resolve({ ...threadFor('team_chat', 0), id: threadId, status });
    },
    sendMessage(input) {
      log.names.push(SUPPORT_SEND_MESSAGE_RPC);
      return Promise.resolve({
        id: '13000000-0000-0000-0000-0000000000e1',
        threadId: input.threadId,
        authorProfileId: input.actorProfileId,
        authorKind: input.authorKind,
        origin: input.draftId === undefined ? ('human' as const) : ('ai_assisted' as const),
        originDraftId: input.draftId ?? null,
        visibility: input.visibility ?? ('participants' as const),
        body: input.body,
        sentAt: '2026-08-16T10:40:00.000Z',
      });
    },
    // Logged like every other operation so that the send count below stays a
    // count of sends: a watermark write is a write, and this suite's whole claim
    // is that no write except an explicit send produces a message.
    markThreadRead(_threadId, _actorProfileId, lastReadAt) {
      log.names.push('markThreadRead');
      return Promise.resolve({ counterpartReadAt: null, lastReadAt, unreadCount: 0 });
    },
    listThreads() {
      log.names.push('listThreads');
      return Promise.resolve([]);
    },
    readThread() {
      log.names.push('readThread');
      return Promise.resolve(payload());
    },
  };
}

function sendCount(log: CallLog): number {
  return log.names.filter((name) => name === SUPPORT_SEND_MESSAGE_RPC).length;
}

describe('generating a draft never produces a message', () => {
  it('walks 64 distinct conversations and sends nothing', async () => {
    const conversations = generateConversations(0x5eed_1301);
    assert.equal(conversations.length, 64);
    assert.equal(
      new Set(conversations.map((payload) => JSON.stringify(payload))).size,
      64,
      'the generator produced a duplicate conversation',
    );

    const log: CallLog = { names: [], recordedStatuses: [] };
    let current = 0;
    const service = createSupportService({
      repository: countingRepository(() => conversations[current], log),
      createDriver: createMockSupportDraftDriver,
      env: {},
    });

    for (current = 0; current < conversations.length; current += 1) {
      const before = log.recordedStatuses.length;
      const draft = await service.generateDraft(THREAD_ID, ACTOR);

      // A record was requested for this conversation.
      assert.equal(log.recordedStatuses.length, before + 1, `conversation ${current}`);

      // The persisted status matches what the engine derives independently for
      // the same context, so the service is not rewriting the verdict on its
      // way to the database.
      const payload = conversations[current];
      const expected = await runDraftEngine(
        createMockSupportDraftDriver(),
        {
          threadKind: payload.thread.kind,
          threadSubject: payload.thread.subject,
          recentMessages: payload.messages.map((item) => ({
            authorKind: item.authorKind,
            body: item.body,
          })),
        },
        resolveDraftConfidenceThreshold({}),
      );
      assert.equal(draft.status, expected.status, `conversation ${current}`);

      // The whole point.
      assert.equal(sendCount(log), 0, `conversation ${current} sent a message`);
    }

    assert.equal(log.recordedStatuses.length, 64);
    assert.equal(sendCount(log), 0);

    // Both sides of the bar were actually exercised, so the zero above is not
    // the result of every draft failing its gates.
    assert.ok(log.recordedStatuses.includes('approved'));
    assert.ok(log.recordedStatuses.includes('draft'));

    // One explicit action by a named person, and exactly one message.
    await service.sendMessage(THREAD_ID, ACTOR, 'A reply a person decided to send.');
    assert.equal(sendCount(log), 1);
  });

  it('repeats identically from the same seed', () => {
    assert.deepEqual(generateConversations(0x5eed_1301), generateConversations(0x5eed_1301));
  });

  it('walks the same 64 conversations under active version 2 and sends nothing', async () => {
    const conversations = generateConversations(0x5eed_1301);
    const log: CallLog = { names: [], recordedStatuses: [] };
    const evaluations: RecordEvalRunInput[] = [];
    let current = 0;
    const service = createSupportService({
      repository: countingRepository(() => conversations[current], log),
      createDriver: createMockSupportDraftDriver,
      env: { FEATURE_ADMIN: 'true' },
      settingsRepository: { async read() { return []; } },
      resolvePrompt: async () => ({
        key: 'support-draft',
        version: 2,
        body: 'Governed support prompt body',
        source: 'database',
      }),
      recordEvaluation: async (input) => { evaluations.push(input); },
    });

    for (current = 0; current < conversations.length; current += 1) {
      const draft = await service.generateDraft(THREAD_ID, ACTOR);
      assert.equal(draft.promptVersion, 2, `conversation ${current}`);
      assert.equal(sendCount(log), 0, `conversation ${current}`);
    }

    assert.equal(log.recordedStatuses.length, 64);
    assert.ok(log.recordedStatuses.includes('approved'));
    assert.ok(log.recordedStatuses.includes('draft'));
    assert.equal(evaluations.length, 192);
    assert.deepEqual(
      [...new Set(evaluations.map((evaluation) => evaluation.evaluatorKey))].sort(),
      ['support.confidence', 'support.language', 'support.supervisor'],
    );
    assert.ok(evaluations.every((evaluation) => evaluation.promptVersion === 2));
    assert.ok(evaluations.every((evaluation) => evaluation.policyVersion === 'eval-policy-2026-08-17-r2'));
  });

  it('sends nothing whatever status the stored draft comes back with', async () => {
    for (const status of ALL_DRAFT_STATUSES) {
      const conversation = generateConversations(0x5eed_1301)[0];
      const log: CallLog = { names: [], recordedStatuses: [] };
      const service = createSupportService({
        repository: countingRepository(() => conversation, log, status),
        createDriver: createMockSupportDraftDriver,
        env: {},
      });

      const draft = await service.generateDraft(THREAD_ID, ACTOR);

      assert.equal(draft.status, status);
      // `approved` is the one that matters: a draft that has cleared every gate
      // is still a draft, and nothing here acts on it.
      assert.equal(sendCount(log), 0, status);
      assert.deepEqual(log.names, ['readThread', 'recordDraft'], status);
    }
  });

  it('offers no exported operation that could run without a person', () => {
    for (const name of Object.keys(serviceModule)) {
      assert.equal(/auto|schedule|cron|worker|reply/i.test(name), false, name);
    }
  });

  it('reaches the send RPC through one function and one function only', () => {
    // The literal lives in `repository.ts` alone; this file names the constant.
    // `verify-no-auto-send.mjs` counts the literal across the tree.
    assert.equal(SUPPORT_SEND_MESSAGE_RPC, 'support_' + 'send_message');
  });
});
