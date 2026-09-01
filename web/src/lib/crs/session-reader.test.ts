import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSessionCallerReader } from './session-reader.ts';

import type { SessionProfile } from '../auth/session.ts';
import type { SessionCallerReaderDeps } from './session-reader.ts';

const HEADERS = { headers: new Headers() };

function profile(overrides: Partial<SessionProfile> = {}): SessionProfile {
  return {
    disabledAt: null,
    id: 'a1000000-0000-0000-0000-000000000013',
    manages: [],
    orgId: 'a0000000-0000-0000-0000-000000000001',
    orgMembership: 'current',
    orgRole: null,
    role: 'consumer',
    ...overrides,
  };
}

function reader(session: SessionProfile | null, clientIds: readonly string[], calls: string[] = []) {
  const deps: SessionCallerReaderDeps = {
    getSession: async () => session,
    listConsumerClientIds: async (input) => {
      calls.push(input.id);
      return clientIds;
    },
  };
  return createSessionCallerReader(async () => deps);
}

describe('session caller reader', () => {
  it('maps a consumer session to the client row that carries them', async () => {
    const calls: string[] = [];
    const clientId = await reader(profile(), ['a3000000-0000-0000-0000-000000000003'], calls)
      .resolveClientId(HEADERS);
    assert.equal(clientId, 'a3000000-0000-0000-0000-000000000003');
    assert.deepEqual(calls, ['a1000000-0000-0000-0000-000000000013']);
  });

  it('identifies nobody without a session', async () => {
    const calls: string[] = [];
    assert.equal(await reader(null, ['x'], calls).resolveClientId(HEADERS), null);
    assert.deepEqual(calls, [], 'no client lookup happens for an anonymous caller');
  });

  it('refuses every non-consumer role without a client lookup', async () => {
    for (const role of ['operator_member', 'platform_admin', 'affiliate'] as const) {
      const calls: string[] = [];
      assert.equal(await reader(profile({ role }), ['x'], calls).resolveClientId(HEADERS), null);
      assert.deepEqual(calls, []);
    }
  });

  it('a consumer with no client row is not identifiable', async () => {
    assert.equal(await reader(profile(), []).resolveClientId(HEADERS), null);
  });
});
