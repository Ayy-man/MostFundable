import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SupportError } from './errors.ts';
import { SUPPORT_SEND_MESSAGE_RPC, createSupportRepository } from './repository.ts';

import type { SupportRepositoryOptions, SupportViewer } from './repository.ts';
import type { SupportDraftDecision } from './types.ts';

const THREAD_ID = '13000000-0000-0000-0000-0000000000aa';
const DRAFT_ID = '13000000-0000-0000-0000-0000000000dd';
const ACTOR_ID = '13000000-0000-0000-0000-000000000111';

const OPERATOR: SupportViewer = { profileId: ACTOR_ID, role: 'operator_member' };
const CONSUMER: SupportViewer = {
  profileId: '13000000-0000-0000-0000-000000000113',
  role: 'consumer',
};
const AFFILIATE: SupportViewer = {
  profileId: '13000000-0000-0000-0000-000000000114',
  role: 'affiliate',
};

const DECISION: SupportDraftDecision = {
  body: 'Your file is with the team and I will follow up here.',
  confidence: 0.86,
  confidenceThreshold: 0.7,
  supervisorApproved: true,
  guardrailFlags: [],
  driver: 'mock',
  model: 'support-draft-mock-v1',
  promptKey: 'support-draft',
  promptVersion: 1,
  status: 'approved',
  reasonCode: 'gates_passed',
};

const THREAD_ROW = {
  id: THREAD_ID,
  kind: 'team_chat',
  org_id: '13000000-0000-0000-0000-000000000001',
  client_id: '13000000-0000-0000-0000-000000000101',
  status: 'open',
  subject: 'Client team chat',
  created_by: ACTOR_ID,
  created_at: '2026-08-16T10:00:00.000Z',
  last_activity_at: '2026-08-16T10:05:00.000Z',
};

const MESSAGE_ROW = {
  id: '13000000-0000-0000-0000-0000000000e1',
  thread_id: THREAD_ID,
  author_profile_id: ACTOR_ID,
  author_kind: 'operator',
  origin: 'human',
  origin_draft_id: null,
  body: 'Thanks, I have logged your question for the team.',
  sent_at: '2026-08-16T10:05:00.000Z',
  visibility: 'participants',
};

/** One row of `support_list_thread_digest`, in the column names it answers with. */
const DIGEST_ROW = {
  thread_id: THREAD_ID,
  last_read_at: '2026-08-16T10:02:00.000Z',
  unread_count: 2,
  last_message_preview: 'Thanks, I have logged your question for the team.',
  counterpart_read_at: '2026-08-16T10:07:00.000Z',
  participant_message_count: 3,
  internal_message_count: 1,
  last_participant_message_preview: 'Thanks, I have logged your question for the team.',
  last_internal_message_preview: 'Check the signed agreement before replying.',
};

const DRAFT_ROW = {
  id: DRAFT_ID,
  thread_id: THREAD_ID,
  body: DECISION.body,
  confidence: '0.860',
  confidence_threshold: '0.700',
  supervisor_approved: true,
  guardrail_flags: [],
  status: 'approved',
  driver: 'mock',
  model: 'support-draft-mock-v1',
  prompt_key: 'support-draft',
  prompt_version: 1,
  created_at: '2026-08-16T10:04:00.000Z',
  sent_by: null,
  sent_at: null,
  sent_message_id: null,
  discarded_by: null,
  discarded_at: null,
};

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function fakes(
  responses: {
    rpc?: unknown;
    rpcError?: unknown;
    byName?: Record<string, unknown>;
  } = {},
): {
  options: SupportRepositoryOptions;
  rpcCalls: RpcCall[];
} {
  const rpcCalls: RpcCall[] = [];

  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      const named = responses.byName?.[name];
      return Promise.resolve({
        data: named !== undefined ? named : (responses.rpc ?? null),
        error: responses.rpcError ?? null,
      });
    },
  };

  return { options: { createAdmin: () => admin as never }, rpcCalls };
}

/** The RPC names a call log holds, in order. */
function names(rpcCalls: RpcCall[]): string[] {
  return rpcCalls.map((call) => call.name);
}

describe('support repository writes', () => {
  it('opens a thread through one RPC with the exact argument names', async () => {
    const fake = fakes({ rpc: THREAD_ROW });
    const repository = createSupportRepository(fake.options);

    const thread = await repository.openThread({
      kind: 'team_chat',
      orgId: '13000000-0000-0000-0000-000000000001',
      clientId: '13000000-0000-0000-0000-000000000101',
      subject: 'Client team chat',
      actorProfileId: ACTOR_ID,
    });

    assert.equal(fake.rpcCalls.length, 1);
    assert.equal(fake.rpcCalls[0].name, 'support_open_thread');
    assert.deepEqual(Object.keys(fake.rpcCalls[0].args).sort(), [
      'p_actor_profile_id',
      'p_client_id',
      'p_kind',
      'p_org_id',
      'p_subject',
    ]);
    assert.equal(thread.id, THREAD_ID);
    assert.equal(thread.lastActivityAt, THREAD_ROW.last_activity_at);
  });

  it('records a draft with every persisted column and no extras', async () => {
    const fake = fakes({ rpc: DRAFT_ROW });
    const repository = createSupportRepository(fake.options);

    const draft = await repository.recordDraft({
      threadId: THREAD_ID,
      actorProfileId: ACTOR_ID,
      decision: DECISION,
    });

    assert.equal(fake.rpcCalls.length, 1);
    assert.equal(fake.rpcCalls[0].name, 'support_record_draft');
    assert.deepEqual(Object.keys(fake.rpcCalls[0].args).sort(), [
      'p_actor_profile_id',
      'p_body',
      'p_confidence',
      'p_confidence_threshold',
      'p_driver',
      'p_guardrail_flags',
      'p_model',
      'p_prompt_key',
      'p_prompt_version',
      'p_supervisor_approved',
      'p_thread_id',
    ]);
    // The reason code stays out of the row: it is audit metadata, and the
    // status the RPC derives from the same three gates is what persists.
    assert.equal('p_reason_code' in fake.rpcCalls[0].args, false);
    assert.equal(draft.confidence, 0.86);
    assert.equal(draft.confidenceThreshold, 0.7);
    assert.deepEqual(draft.guardrailFlags, []);
  });

  it('discards and moves status through their own single RPCs', async () => {
    const discardFake = fakes({ rpc: { ...DRAFT_ROW, status: 'discarded', discarded_by: ACTOR_ID, discarded_at: '2026-08-16T10:06:00.000Z' } });
    await createSupportRepository(discardFake.options).discardDraft(DRAFT_ID, ACTOR_ID);
    assert.deepEqual(discardFake.rpcCalls, [
      {
        name: 'support_discard_draft',
        args: { p_draft_id: DRAFT_ID, p_actor_profile_id: ACTOR_ID },
      },
    ]);

    const statusFake = fakes({ rpc: { ...THREAD_ROW, status: 'pending' } });
    await createSupportRepository(statusFake.options).setThreadStatus(
      THREAD_ID,
      'pending',
      ACTOR_ID,
    );
    assert.deepEqual(statusFake.rpcCalls, [
      {
        name: 'support_set_thread_status',
        args: { p_thread_id: THREAD_ID, p_status: 'pending', p_actor_profile_id: ACTOR_ID },
      },
    ]);
  });

  it('passes the actor straight through the send seam', async () => {
    const fake = fakes({ rpc: MESSAGE_ROW });
    const repository = createSupportRepository(fake.options);

    await repository.sendMessage({
      threadId: THREAD_ID,
      actorProfileId: ACTOR_ID,
      authorKind: 'operator',
      body: MESSAGE_ROW.body,
    });

    assert.deepEqual(fake.rpcCalls, [
      {
        name: SUPPORT_SEND_MESSAGE_RPC,
        args: {
          p_thread_id: THREAD_ID,
          p_actor_profile_id: ACTOR_ID,
          p_author_kind: 'operator',
          p_body: MESSAGE_ROW.body,
          p_draft_id: null,
          // Sent explicitly rather than left to the RPC's default, so that the
          // one call site naming the send seam always says who the message is
          // for. An omitted argument would be the same value today and a
          // silent question the day the default changes.
          p_visibility: 'participants',
        },
      },
    ]);
  });

  it('carries the visibility a caller asked for, and defaults it to the client-facing value', async () => {
    // Watched failing before the repository forwarded `visibility`: the note
    // arrived at the RPC as `participants` and was written into the thread the
    // client reads.
    const fake = fakes({ rpc: { ...MESSAGE_ROW, visibility: 'internal' } });
    const repository = createSupportRepository(fake.options);

    const note = await repository.sendMessage({
      threadId: THREAD_ID,
      actorProfileId: ACTOR_ID,
      authorKind: 'operator',
      body: 'Team note: confirm the filing date before replying.',
      visibility: 'internal',
    });

    assert.equal(note.visibility, 'internal');
    assert.equal(fake.rpcCalls[0]?.args.p_visibility, 'internal');
  });

  it('carries a draft id when one is named and null when it is not', async () => {
    const fake = fakes({ rpc: { ...MESSAGE_ROW, origin: 'ai_assisted', origin_draft_id: DRAFT_ID } });
    const message = await createSupportRepository(fake.options).sendMessage({
      threadId: THREAD_ID,
      actorProfileId: ACTOR_ID,
      authorKind: 'operator',
      body: MESSAGE_ROW.body,
      draftId: DRAFT_ID,
    });

    assert.equal(fake.rpcCalls[0].args.p_draft_id, DRAFT_ID);
    assert.equal(message.origin, 'ai_assisted');
    assert.equal(message.originDraftId, DRAFT_ID);
  });

  it('refuses at the type level to send without an actor, and invents none at runtime', async () => {
    const fake = fakes({ rpc: MESSAGE_ROW });
    const repository = createSupportRepository(fake.options);

    await repository.sendMessage(
      // @ts-expect-error actorProfileId is required: a send with no named human does not typecheck.
      {
        threadId: THREAD_ID,
        authorKind: 'operator',
        body: MESSAGE_ROW.body,
      },
    );

    // Two halves to one property. The compile-time half is the directive above:
    // `npm run typecheck` fails the moment that line stops being an error,
    // which is what makes a caller unable to omit the human. The runtime half
    // is this assertion — nothing here substitutes a service identity or a
    // fallback id, so the RPC receives no actor and migration 101 answers
    // SUPPORT_ACTOR_REQUIRED rather than sending on somebody's behalf.
    assert.equal(fake.rpcCalls[0].args.p_actor_profile_id, undefined);
  });

  it('turns a database refusal into a SupportError and never a raw row', async () => {
    const fake = fakes({ rpcError: { code: 'P0001', message: 'SUPPORT_FORBIDDEN' } });
    const repository = createSupportRepository(fake.options);

    await assert.rejects(
      () =>
        repository.sendMessage({
          threadId: THREAD_ID,
          actorProfileId: ACTOR_ID,
          authorKind: 'operator',
          body: MESSAGE_ROW.body,
        }),
      (error: unknown) => error instanceof SupportError && error.code === 'SUPPORT_FORBIDDEN',
    );
  });

  it('writes nothing except through an RPC', async () => {
    const fake = fakes({ rpc: THREAD_ROW });
    const repository = createSupportRepository(fake.options);

    await repository.openThread({
      kind: 'platform_support',
      orgId: '13000000-0000-0000-0000-000000000001',
      clientId: null,
      subject: 'Operator question one',
      actorProfileId: ACTOR_ID,
    });
    await repository.setThreadStatus(THREAD_ID, 'resolved', ACTOR_ID);

    // The admin client this repository holds exposes `rpc` and nothing else,
    // so there is no `.from(...)` insert, update, upsert, or delete path to
    // take even by accident — every write below is an RPC by construction.
    assert.equal(fake.rpcCalls.length, 2);
    assert.deepEqual(names(fake.rpcCalls), ['support_open_thread', 'support_set_thread_status']);
  });
});

describe('support repository reads', () => {
  it('lists threads through migration 102 with no viewer filter of its own', async () => {
    const fake = fakes({
      byName: {
        support_list_threads: [THREAD_ROW],
        support_list_thread_digest: [DIGEST_ROW],
      },
    });
    const threads = await createSupportRepository(fake.options).listThreads(OPERATOR);

    assert.equal(threads.length, 1);
    // The badge is whatever the digest said. Nothing in this file counts
    // messages, and the expectation is read off DIGEST_ROW rather than written
    // out, so a repository that started deriving its own number would fail here
    // instead of quietly agreeing with a literal.
    assert.equal(threads[0]?.read.unreadCount, DIGEST_ROW.unread_count);
    assert.equal(threads[0]?.read.lastReadAt, DIGEST_ROW.last_read_at);
    // Migration 393's column, read off the row rather than written out. The two watermarks are
    // deliberately different instants in DIGEST_ROW, so a mapping that reached for `last_read_at`
    // and called it the counterpart's fails here rather than agreeing with itself.
    assert.equal(threads[0]?.read.counterpartReadAt, DIGEST_ROW.counterpart_read_at);
    assert.notEqual(DIGEST_ROW.counterpart_read_at, DIGEST_ROW.last_read_at);
    assert.equal(threads[0]?.lastMessagePreview, DIGEST_ROW.last_message_preview);
    assert.equal(threads[0]?.participantMessageCount, DIGEST_ROW.participant_message_count);
    assert.equal(threads[0]?.internalMessageCount, DIGEST_ROW.internal_message_count);
    assert.equal(threads[0]?.lastParticipantMessagePreview, DIGEST_ROW.last_participant_message_preview);
    assert.equal(threads[0]?.lastInternalMessagePreview, DIGEST_ROW.last_internal_message_preview);
    // The actor goes to the database and the visibility rule stays there. If
    // this list ever grew an `.eq('org_id', …)` alongside it, the rule would
    // have two definitions and only one of them would be tested in SQL.
    assert.deepEqual(fake.rpcCalls.map((call) => call.args), [
      { p_actor_profile_id: OPERATOR.profileId, p_limit: 100 },
      { p_actor_profile_id: OPERATOR.profileId, p_limit: 100, p_thread_id: null },
    ]);
    assert.deepEqual(names(fake.rpcCalls).sort(), [
      'support_list_thread_digest',
      'support_list_threads',
    ]);
  });

  it('keeps a thread in the list when the digest says nothing about it', async () => {
    // Watched failing against a draft of the repository that merged the two
    // reads with an inner join: the thread disappeared entirely rather than
    // losing its badge, which is the G-HOST-14 failure — an outage rendering as
    // "no conversations" — in miniature.
    const fake = fakes({
      byName: { support_list_threads: [THREAD_ROW], support_list_thread_digest: [] },
    });
    const threads = await createSupportRepository(fake.options).listThreads(OPERATOR);

    assert.equal(threads.length, 1);
    assert.equal(threads[0]?.read.unreadCount, 0);
    // "Cannot say", not "not read": a digest that answered for nothing has said nothing about
    // whose attention reached where, and a receipt derived from that would be invented.
    assert.equal(threads[0]?.read.counterpartReadAt, null);
    assert.equal(threads[0]?.lastMessagePreview, null);
  });

  it('never reports a negative unread count, whatever the digest returned', async () => {
    // Watched failing against a repository that passed `unread_count` through
    // with `Number()` alone. A badge is the one number in this phase that is
    // rendered as text with no further check, so it is floored here.
    const fake = fakes({
      byName: {
        support_list_threads: [THREAD_ROW],
        support_list_thread_digest: [{ ...DIGEST_ROW, unread_count: -4 }],
      },
    });
    const threads = await createSupportRepository(fake.options).listThreads(OPERATOR);
    assert.equal(threads[0]?.read.unreadCount, 0);
  });

  it('issues no query at all for a role that can hold no thread', async () => {
    const fake = fakes({ byName: { support_list_threads: [THREAD_ROW] } });
    const repository = createSupportRepository(fake.options);

    assert.deepEqual(await repository.listThreads(AFFILIATE), []);
    assert.equal(await repository.readThread(THREAD_ID, AFFILIATE), null);
    assert.equal(fake.rpcCalls.length, 0);
  });

  it('returns the draft inline, scoped to the one thread', async () => {
    const fake = fakes({
      byName: {
        support_read_thread: [THREAD_ROW],
        support_list_messages: [MESSAGE_ROW],
        support_list_thread_digest: [DIGEST_ROW],
        support_read_open_draft: [DRAFT_ROW],
      },
    });

    const payload = await createSupportRepository(fake.options).readThread(THREAD_ID, OPERATOR);

    assert.notEqual(payload, null);
    assert.equal(payload?.thread.id, THREAD_ID);
    assert.equal(payload?.messages.length, 1);
    assert.equal(payload?.draft?.id, DRAFT_ID);

    assert.deepEqual(names(fake.rpcCalls).sort(), [
      'support_list_messages',
      'support_list_thread_digest',
      'support_read_open_draft',
      'support_read_thread',
    ]);
    const draftCall = fake.rpcCalls.find((call) => call.name === 'support_read_open_draft');
    assert.deepEqual(draftCall?.args, {
      p_actor_profile_id: OPERATOR.profileId,
      p_thread_id: THREAD_ID,
    });
  });

  it('never queries drafts for a viewer the policy denies them to', async () => {
    const fake = fakes({
      byName: {
        support_read_thread: [THREAD_ROW],
        support_list_messages: [MESSAGE_ROW],
        support_list_thread_digest: [DIGEST_ROW],
      },
    });

    const payload = await createSupportRepository(fake.options).readThread(THREAD_ID, CONSUMER);

    assert.equal(payload?.draft, null);
    // Two refusals, not one: this assertion is the TypeScript half, and
    // migration 102's `support_read_open_draft` re-checks the staff role in
    // SQL so a caller that bypassed this file still gets nothing.
    assert.equal(names(fake.rpcCalls).includes('support_read_open_draft'), false);
  });

  it('adds the tenant-scoped timeline to an enabled thread payload', async () => {
    const fake = fakes({
      byName: {
        support_read_thread: [THREAD_ROW],
        support_list_messages: [MESSAGE_ROW],
        support_list_thread_digest: [DIGEST_ROW],
        support_read_open_draft: [],
      },
    });
    const timelineCalls: unknown[] = [];
    const repository = createSupportRepository({
      ...fake.options,
      timelineEnabled: () => true,
      readTimeline: async (args) => {
        timelineCalls.push(args);
        return { events: [] };
      },
    });

    const payload = await repository.readThread(THREAD_ID, OPERATOR);

    assert.deepEqual(payload?.timeline, { events: [] });
    assert.deepEqual(timelineCalls, [{
      audience: 'operator',
      clientId: THREAD_ROW.client_id,
      viewer: OPERATOR,
    }]);
  });

  it('returns null rather than confirming that a thread it cannot see exists', async () => {
    const fake = fakes({ byName: { support_read_thread: [] } });
    const payload = await createSupportRepository(fake.options).readThread(THREAD_ID, OPERATOR);
    assert.equal(payload, null);
    assert.equal(names(fake.rpcCalls).includes('support_list_messages'), false);
  });

  it('answers with a null draft when the thread has none open', async () => {
    const fake = fakes({
      byName: {
        support_read_thread: [THREAD_ROW],
        support_list_messages: [],
        support_list_thread_digest: [],
        support_read_open_draft: [],
      },
    });
    const payload = await createSupportRepository(fake.options).readThread(THREAD_ID, OPERATOR);
    assert.equal(payload?.draft, null);
    assert.deepEqual(payload?.messages, []);
  });

  it('exposes no way to read drafts across threads', () => {
    const repository = createSupportRepository(fakes().options);
    const names = Object.keys(repository).sort();
    assert.deepEqual(names, [
      'discardDraft',
      'listThreads',
      'markThreadRead',
      'openThread',
      'readThread',
      'recordDraft',
      'sendMessage',
      'setThreadStatus',
    ]);
    for (const name of names) {
      assert.equal(/^list.*draft/i.test(name), false, name);
    }
  });
});
