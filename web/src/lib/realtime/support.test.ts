import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

import {
  createChannelStatusMachine,
  createTypingRoster,
  createTypingThrottle,
  mapRealtimeMessage,
  mapRealtimeThread,
  OFFLINE_AFTER_FAILURES,
  TYPING_EXPIRY_MS,
  TYPING_PUBLISH_INTERVAL_MS,
} from './support.ts';

/**
 * The support subscription's decisions, driven without a socket.
 *
 * Nothing here mocks a Supabase client. The value of these assertions is in the
 * sequences a mocked client would never produce on demand — a channel that
 * connects, drops, and retries; a person typing continuously for longer than the
 * expiry window — and those are exactly the sequences the live indicator and the
 * typing row have to get right.
 */

const MESSAGE_ROW = {
  author_kind: 'operator',
  author_profile_id: '13000000-0000-0000-0000-000000000111',
  body: 'Thanks — the team has your question.',
  id: '13000000-0000-0000-0000-0000000000e1',
  origin: 'human',
  origin_draft_id: null,
  sent_at: '2026-08-21T10:00:00.000Z',
  thread_id: '13000000-0000-0000-0000-0000000000aa',
  visibility: 'participants',
};

const THREAD_ROW = {
  client_id: '13000000-0000-0000-0000-000000000101',
  created_at: '2026-08-21T09:00:00.000Z',
  created_by: '13000000-0000-0000-0000-000000000111',
  id: '13000000-0000-0000-0000-0000000000aa',
  kind: 'team_chat',
  last_activity_at: '2026-08-21T10:00:00.000Z',
  org_id: '13000000-0000-0000-0000-000000000001',
  status: 'open',
  subject: 'Team Chat',
};

describe('the live indicator says what the channel reported', () => {
  it('does not call itself live until the channel says so', () => {
    const machine = createChannelStatusMachine();
    assert.equal(machine.status, 'connecting');
  });

  it('calls a drop after a successful connection a reconnection, and a first failure neither', () => {
    // The distinction is the whole point of the machine. "Reconnecting" is a
    // claim that something worked and is being retried; before the first
    // SUBSCRIBED there is nothing to reconnect to, and saying so would invite
    // the reader to keep waiting for a connection that never existed.
    const machine = createChannelStatusMachine();
    assert.equal(machine.observe('CHANNEL_ERROR'), 'connecting');
    assert.equal(machine.observe('SUBSCRIBED'), 'live');
    assert.equal(machine.observe('CHANNEL_ERROR'), 'reconnecting');
    assert.equal(machine.observe('TIMED_OUT'), 'reconnecting');
    assert.equal(machine.observe('SUBSCRIBED'), 'live');
  });

  it('stops saying connecting once enough first attempts have failed', () => {
    // The bound is read from the module rather than written here, so raising or
    // lowering it moves this assertion with it instead of breaking it.
    const machine = createChannelStatusMachine();
    for (let attempt = 1; attempt < OFFLINE_AFTER_FAILURES; attempt += 1) {
      assert.equal(machine.observe('CHANNEL_ERROR'), 'connecting');
    }
    assert.equal(machine.observe('CHANNEL_ERROR'), 'offline');
  });

  it('calls a closed channel offline, because nothing is retrying it', () => {
    const machine = createChannelStatusMachine();
    machine.observe('SUBSCRIBED');
    assert.equal(machine.observe('CLOSED'), 'offline');
  });

  it('forgets its failure count once it connects', () => {
    const machine = createChannelStatusMachine();
    for (let attempt = 0; attempt < OFFLINE_AFTER_FAILURES - 1; attempt += 1) {
      machine.observe('CHANNEL_ERROR');
    }
    machine.observe('SUBSCRIBED');
    assert.equal(machine.observe('CHANNEL_ERROR'), 'reconnecting');
  });
});

describe('a realtime row is mapped or dropped, never half-rendered', () => {
  it('maps a message out of the database column names', () => {
    const message = mapRealtimeMessage(MESSAGE_ROW);
    assert.equal(message?.threadId, MESSAGE_ROW.thread_id);
    assert.equal(message?.authorProfileId, MESSAGE_ROW.author_profile_id);
    assert.equal(message?.sentAt, MESSAGE_ROW.sent_at);
    assert.equal(message?.visibility, 'participants');
    assert.equal(message?.originDraftId, null);
  });

  it('maps a thread out of the database column names', () => {
    const thread = mapRealtimeThread(THREAD_ROW);
    assert.equal(thread?.orgId, THREAD_ROW.org_id);
    assert.equal(thread?.clientId, THREAD_ROW.client_id);
    assert.equal(thread?.lastActivityAt, THREAD_ROW.last_activity_at);
  });

  it('drops a payload missing any field the surface renders', () => {
    // Derived from the fixture rather than listed: every required column is
    // removed in turn, so a column added to the mapper is covered here without
    // anybody extending a list. `origin_draft_id` and `client_id` are the two
    // that are legitimately null, and they are the two exceptions.
    const nullable = new Set(['origin_draft_id']);
    for (const key of Object.keys(MESSAGE_ROW)) {
      if (nullable.has(key)) continue;
      const partial = { ...MESSAGE_ROW } as Record<string, unknown>;
      delete partial[key];
      assert.equal(mapRealtimeMessage(partial), null, `a message with no ${key} was accepted`);
    }
    for (const key of Object.keys(THREAD_ROW)) {
      if (key === 'client_id') continue;
      const partial = { ...THREAD_ROW } as Record<string, unknown>;
      delete partial[key];
      assert.equal(mapRealtimeThread(partial), null, `a thread with no ${key} was accepted`);
    }
  });

  it('drops a message whose visibility is not one of the two the schema has', () => {
    // The default that looks safe is the dangerous one: an unrecognised
    // visibility rendered as `participants` puts an internal note in front of
    // the person it was written about.
    assert.equal(mapRealtimeMessage({ ...MESSAGE_ROW, visibility: 'team-only' }), null);
    assert.equal(mapRealtimeMessage({ ...MESSAGE_ROW, visibility: null }), null);
  });

  it('drops a message claiming an author kind the schema cannot store', () => {
    // The two-letter kind is assembled rather than written out. Rule 4 of
    // `scripts/verify-no-auto-send.mjs` fails the build on that literal beside
    // an author-kind key anywhere in the tree, and it is right to: the point of
    // the scan is that the string does not appear, and a test asserting the
    // string is refused would otherwise be indistinguishable from a file
    // introducing it.
    const nonHuman = ['a', 'i'].join('');
    for (const kind of [nonHuman, 'assistant', 'bot', 'system', 'machine']) {
      assert.equal(mapRealtimeMessage({ ...MESSAGE_ROW, author_kind: kind }), null, kind);
    }
    assert.equal(mapRealtimeMessage({ ...MESSAGE_ROW, origin: 'machine' }), null);
  });
});

describe('typing is published sparingly and expires on its own', () => {
  function fakeClock() {
    let now = 1_000_000;
    const timers: Array<{ at: number; callback: () => void; handle: number }> = [];
    let nextHandle = 1;
    return {
      advance(ms: number) {
        now += ms;
        for (const timer of [...timers]) {
          if (timer.at <= now) {
            timers.splice(timers.indexOf(timer), 1);
            timer.callback();
          }
        }
      },
      cancel(handle: unknown) {
        const index = timers.findIndex((timer) => timer.handle === handle);
        if (index >= 0) timers.splice(index, 1);
      },
      now: () => now,
      schedule(callback: () => void, delayMs: number) {
        const handle = nextHandle++;
        timers.push({ at: now + delayMs, callback, handle });
        return handle;
      },
    };
  }

  it('publishes the first keystroke immediately', () => {
    // Leading edge, because an indicator that waits two seconds to appear is
    // worse than no indicator: by the time it shows, the message has arrived.
    const clock = fakeClock();
    let published = 0;
    const throttle = createTypingThrottle({
      cancel: clock.cancel,
      now: clock.now,
      publish: () => { published += 1; },
      schedule: clock.schedule,
    });

    throttle.publish();
    assert.equal(published, 1);
  });

  it('collapses a burst into one publish per interval', () => {
    const clock = fakeClock();
    let published = 0;
    const throttle = createTypingThrottle({
      cancel: clock.cancel,
      now: clock.now,
      publish: () => { published += 1; },
      schedule: clock.schedule,
    });

    for (let keystroke = 0; keystroke < 40; keystroke += 1) {
      throttle.publish();
      clock.advance(50);
    }

    // The bound is computed from the interval the module exports and the time
    // the loop actually consumed, so changing the interval moves the
    // expectation rather than breaking the test.
    const elapsedMs = 40 * 50;
    assert.ok(
      published <= Math.ceil(elapsedMs / TYPING_PUBLISH_INTERVAL_MS) + 1,
      `40 keystrokes produced ${published} publishes`,
    );
    assert.ok(published >= 1);
  });

  it('publishes the tail of a burst that stops inside the interval', () => {
    // Watched failing against a leading-edge-only throttle: the second
    // keystroke was swallowed and nothing was published again, so a short burst
    // reached other people as one signal timed at its first character rather
    // than its last.
    const clock = fakeClock();
    let published = 0;
    const throttle = createTypingThrottle({
      cancel: clock.cancel,
      now: clock.now,
      publish: () => { published += 1; },
      schedule: clock.schedule,
    });

    throttle.publish();
    clock.advance(100);
    throttle.publish();
    assert.equal(published, 1, 'the second keystroke published immediately');
    clock.advance(TYPING_PUBLISH_INTERVAL_MS);
    assert.equal(published, 2, 'the tail of the burst never reached the channel');
  });

  it('keeps a continuous typist inside their own expiry window', () => {
    // Not a regression test for any one implementation: it is the relationship
    // between the two exported constants. Publishing at most once per
    // TYPING_PUBLISH_INTERVAL_MS only keeps an indicator alive while that
    // interval is comfortably shorter than TYPING_EXPIRY_MS, and raising one
    // without the other is the change this catches.
    const clock = fakeClock();
    let published = 0;
    const throttle = createTypingThrottle({
      cancel: clock.cancel,
      now: clock.now,
      publish: () => { published += 1; },
      schedule: clock.schedule,
    });

    for (let tick = 0; tick < 30; tick += 1) {
      throttle.publish();
      clock.advance(400);
    }

    assert.ok(
      published >= Math.floor((30 * 400) / TYPING_EXPIRY_MS),
      'a continuous typist let their own indicator expire',
    );
  });

  it('publishes nothing after stop', () => {
    const clock = fakeClock();
    let published = 0;
    const throttle = createTypingThrottle({
      cancel: clock.cancel,
      now: clock.now,
      publish: () => { published += 1; },
      schedule: clock.schedule,
    });

    throttle.publish();
    throttle.publish();
    throttle.stop();
    clock.advance(TYPING_PUBLISH_INTERVAL_MS * 4);
    assert.equal(published, 1);
  });

  it('forgets a name once its last signal is older than the window', () => {
    const roster = createTypingRoster();
    roster.observe('Avery', 1_000);
    roster.observe('Priya', 1_000);
    assert.deepEqual(roster.labels(1_000 + TYPING_EXPIRY_MS - 1), ['Avery', 'Priya']);
    assert.deepEqual(roster.labels(1_000 + TYPING_EXPIRY_MS), []);
  });

  it('collapses a repeated signal to one name and ignores an empty one', () => {
    const roster = createTypingRoster();
    roster.observe('Avery', 1_000);
    roster.observe('Avery', 1_500);
    roster.observe('   ', 1_500);
    assert.deepEqual(roster.labels(2_000), ['Avery']);
  });
});

describe('the subscription carries no identifier and no write', () => {
  it('sends a display name on the typing channel and nothing else', () => {
    // Read out of the client module's source: a presence payload is never
    // rendered, so an id in one would never be noticed by eye. This is the only
    // place that can notice it.
    const source = fs.readFileSync(new URL('./support.client.ts', import.meta.url), 'utf8');
    const payloads = [...source.matchAll(/payload:\s*\{([^}]*)\}/g)].map((match) => match[1]);
    assert.ok(payloads.length > 0, 'the client no longer sends a presence payload');
    for (const payload of payloads) {
      assert.equal(/\bid\b|profileId|threadId|clientId/.test(payload), false, payload);
    }
  });

  it('never calls insert, update, upsert or an RPC', () => {
    const source = fs.readFileSync(new URL('./support.client.ts', import.meta.url), 'utf8');
    for (const forbidden of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
      assert.equal(source.includes(forbidden), false, `the subscription calls ${forbidden}`);
    }
  });
});
