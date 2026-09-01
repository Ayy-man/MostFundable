import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readConsumerTeamChat } from './team-chat.server.ts';

import type { SessionProfile } from '../auth/session.ts';
import type { ConsumerTeamChatDeps } from './team-chat.server.ts';
import type { HeldDraftRow, SupportThreadPayload, SupportThreadRow } from './repository.ts';

function session(overrides: Partial<SessionProfile> = {}): SessionProfile {
  return {
    disabledAt: null,
    id: 'consumer-1',
    manages: [],
    orgId: 'org-1',
    orgMembership: null,
    orgRole: null,
    role: 'consumer',
    ...overrides,
  };
}

function thread(): SupportThreadRow {
  return {
    clientId: 'client-1',
    createdAt: '2026-08-20T09:00:00Z',
    createdBy: 'operator-1',
    id: 'thread-1',
    kind: 'team_chat',
    lastActivityAt: '2026-08-20T09:00:00Z',
    orgId: 'org-1',
    status: 'open',
    subject: 'Team Chat',
  };
}

function payload(): SupportThreadPayload {
  return {
    // A held draft is present on purpose: the assertion below is that it does
    // not survive the boundary, and a fixture without one could not tell.
    draft: { body: 'An un-approved suggestion.', id: 'draft-1', status: 'draft' } as unknown as HeldDraftRow,
    messages: [
      {
        authorKind: 'operator',
        authorProfileId: 'operator-1',
        body: 'Welcome to Northbridge Funding Group.',
        id: 'message-1',
        originDraftId: null,
        origin: 'human',
        sentAt: '2026-08-20T09:00:00Z',
        threadId: 'thread-1',
        visibility: 'participants',
      },
    ],
    read: { counterpartReadAt: null, lastReadAt: null, unreadCount: 1 },
    timeline: { events: [] },
    thread: thread(),
  };
}

interface Recorder {
  readonly calls: string[];
  readonly openInputs: unknown[];
  readonly deps: ConsumerTeamChatDeps;
}

function recording(overrides: Partial<ConsumerTeamChatDeps> = {}): Recorder {
  const calls: string[] = [];
  const openInputs: unknown[] = [];
  return {
    calls,
    deps: {
      assertWritable: async () => { calls.push('assertWritable'); },
      featureEnabled: () => { calls.push('featureEnabled'); return true; },
      open: async (input) => { calls.push('open'); openInputs.push(input); return thread(); },
      read: async () => { calls.push('read'); return payload(); },
      ...overrides,
    },
    openInputs,
  };
}

describe('readConsumerTeamChat', () => {
  it('asks the database for nothing when the flag is off', async () => {
    // The whole point of moving this read to the server is that the page pays
    // for it on every consumer render. With the flag off the surface shows its
    // fixture conversation, so a round trip here would be a cost with no reader.
    const recorder = recording({ featureEnabled: () => false });

    const snapshot = await readConsumerTeamChat(session(), recorder.deps);

    assert.deepEqual(snapshot, { state: 'disabled' });
    assert.deepEqual(recorder.calls, []);
  });

  it('opens the thread without naming a client', async () => {
    // Migration 103 resolves the consumer's client from their own profile. The
    // browser never holds that id, and passing one from here would put an
    // identifier on a path that has managed without one since 103.
    const recorder = recording();

    await readConsumerTeamChat(session(), recorder.deps);

    assert.deepEqual(recorder.openInputs, [
      { clientId: null, kind: 'team_chat', orgId: 'org-1', subject: 'Team Chat' },
    ]);
  });

  it('checks the tenancy wall before it opens anything', async () => {
    // Opening a thread is a write, and the POST route it replaces answers to the
    // wall. A deactivated tenant must not gain new client-facing records just
    // because the request arrived as a page render instead of a fetch.
    const recorder = recording();

    await readConsumerTeamChat(session(), recorder.deps);

    assert.equal(recorder.calls.indexOf('assertWritable') < recorder.calls.indexOf('open'), true);
  });

  it('hands the work back to the client bootstrap when the wall refuses', async () => {
    const recorder = recording({
      assertWritable: async () => { throw new Error('TENANT_DEACTIVATED'); },
    });

    const snapshot = await readConsumerTeamChat(session(), recorder.deps);

    assert.equal(snapshot, null);
    assert.equal(recorder.calls.includes('open'), false);
  });

  it('never opens a consumer thread for somebody who is not the consumer', async () => {
    // Watched failing with the `session.role !== 'consumer'` guard removed: the
    // open then runs for every role. An operator or a platform admin can reach
    // this page in a redirect race.
    // `support_open_thread` would resolve no client for them and refuse, but
    // refusing here means the write is never attempted at all.
    for (const role of ['operator_member', 'platform_admin', 'affiliate'] as const) {
      const recorder = recording();
      const snapshot = await readConsumerTeamChat(session({ role }), recorder.deps);
      assert.equal(snapshot, null, role);
      assert.equal(recorder.calls.includes('open'), false, role);
    }
  });

  it('drops the held draft rather than passing it to a consumer surface', async () => {
    // Watched failing with the return rewritten as `{ ...payload, state:
    // 'ready' }`, which is the shape somebody reaches for first. Derived from
    // the payload rather than from a list written here: every key
    // the repository returns is checked, so a field added to
    // `SupportThreadPayload` tomorrow has to be considered rather than silently
    // forwarded to a client's browser.
    const recorder = recording();

    const snapshot = await readConsumerTeamChat(session(), recorder.deps);

    assert.equal(snapshot?.state, 'ready');
    const forwarded = new Set(Object.keys(snapshot as object));
    const returned = Object.keys(payload());
    assert.deepEqual(
      returned.filter((key) => !forwarded.has(key)),
      ['draft'],
      'exactly the held draft is withheld; anything else new must be decided on deliberately',
    );
  });

  it('answers null rather than throwing when the read fails', async () => {
    // This runs inside a page render. A thrown error here is a 500 on the whole
    // consumer surface over a chat panel, and the client bootstrap is still
    // there to try again.
    const recorder = recording({ read: async () => { throw new Error('SUPPORT_UNAVAILABLE'); } });

    assert.equal(await readConsumerTeamChat(session(), recorder.deps), null);
  });

  it('answers null when the thread reads back as invisible', async () => {
    const recorder = recording({ read: async () => null });

    assert.equal(await readConsumerTeamChat(session(), recorder.deps), null);
  });

  it('crosses the server boundary as plain JSON', async () => {
    // It travels as a prop from a server component, so anything React cannot
    // serialize -- a Date, a Map, a class instance -- fails at render time and
    // in no test but this one.
    const recorder = recording();

    const snapshot = await readConsumerTeamChat(session(), recorder.deps);

    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  });
});
