import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCrsAlertPointerCodec } from './alert-pointer.ts';
import {
  drainAnalysisQueue,
  enqueueAnalysisRun,
} from '../analysis/worker.ts';
import { createInMemoryAnalysisRepository } from '../analysis/repository.ts';
import { createMockAdapter } from './mock/driver.ts';
import {
  createFixedClock,
  createInMemoryMemberRefResolver,
  createInMemoryMonitoringEventStore,
} from './ports.ts';
import { handleCrsWebhook } from './webhook-handler.ts';
import { enqueueAnalysisFanOut, prepareWebhookAcknowledgement, scheduleAnalysisFanOut } from './wiring.ts';

import type { AnalysisFanOutDependencies } from './wiring.ts';
import type { CrsAdapter, CrsMemberRef } from './types.ts';
import type { CrsWebhookConfig } from './webhook.ts';
import type { WebhookFanOutItem } from './webhook-handler.ts';

const CLIENT_ID = '55000000-0000-4000-8000-000000000101';
const EVENT_ID_ONE = '55000000-0000-4000-8000-000000000201';
const EVENT_ID_TWO = '55000000-0000-4000-8000-000000000202';
const WORKER_ID = '55000000-0000-4000-8000-000000000901';
const MEMBER_REF = 'mock_clean_000001' as CrsMemberRef;
const INSTANT = '2026-08-16T03:00:00.000Z';
const ENABLED = { FEATURE_ANALYSIS: 'true' };
const POINTER_CODEC = createCrsAlertPointerCodec('not-a-real-pointer-secret-at-least-32-bytes');

const WEBHOOK_CONFIG: CrsWebhookConfig = {
  basicUser: 'not-a-real-user',
  basicPass: 'not-a-real-pass',
  hmacSecret: null,
  hmacHeader: 'x-crs-signature',
  sourceIps: [],
};

function item(id: string, eventType = 'ACCALERT'): WebhookFanOutItem {
  return {
    clientId: CLIENT_ID,
    monitoringEventId: id,
    event: {
      eventType,
      occurredAt: '2025-08-16T00:00:00.000Z',
      memberRef: MEMBER_REF,
    },
  };
}

function fakeDependencies() {
  const enqueued: unknown[] = [];
  const drained: unknown[] = [];
  const deps: AnalysisFanOutDependencies = {
    env: ENABLED,
    async enqueue(input) {
      enqueued.push({ ...input });
    },
    async drain(input) {
      drained.push({ ...input });
      return { claimed: 0, succeeded: 0, failed: 0 };
    },
    getWorkerId: () => WORKER_ID,
    async notifyCrsAlert() {},
  };
  return { deps, enqueued, drained };
}

function runtimeDependencies() {
  const clock = createFixedClock(INSTANT);
  const repository = createInMemoryAnalysisRepository({
    clock,
    enrollments: { [CLIENT_ID]: MEMBER_REF },
  });
  const adapter = createMockAdapter({ clock, webhookConfig: WEBHOOK_CONFIG });
  let pulls = 0;
  const countedAdapter: CrsAdapter = {
    ...adapter,
    async softPull(_memberRef, reportCodes) {
      pulls += 1;
      return adapter.softPull(MEMBER_REF, reportCodes);
    },
  };
  const deps: AnalysisFanOutDependencies = {
    env: ENABLED,
    enqueue: (input) => enqueueAnalysisRun(input, { env: ENABLED, repository }),
    drain: (input) => drainAnalysisQueue(input, {
      env: ENABLED,
      repository,
      getAdapter: () => countedAdapter,
    }),
    getWorkerId: () => WORKER_ID,
    async notifyCrsAlert() {},
  };
  return { deps, repository, pulls: () => pulls };
}

describe('scheduleAnalysisFanOut', () => {
  it('withholds every successful ack when the source-keyed enqueue fails', async () => {
    const result = await prepareWebhookAcknowledgement({
      body: [{ hook_id: 'hook-r2c10', status: true }],
      fanOut: [item(EVENT_ID_ONE)],
      status: 200,
    }, async () => { throw new Error('fixed enqueue failure'); });
    assert.deepEqual(result, { body: [], fanOut: [], status: 503 });
  });

  it('synchronously creates the source-keyed job before acknowledgement', async () => {
    const scenario = fakeDependencies();
    await enqueueAnalysisFanOut([item(EVENT_ID_ONE)], scenario.deps);
    assert.equal(scenario.enqueued.length, 1);
    assert.deepEqual(scenario.drained, []);
  });
  it('notifies only stored ACCALERT items independently of analysis', async () => {
    const scenario = fakeDependencies();
    scenario.deps.env = {};
    const notified: string[] = [];
    scenario.deps.notifyCrsAlert = async (input) => { notified.push(input.monitoringEventId); };
    await scheduleAnalysisFanOut([
      item(EVENT_ID_ONE, 'ACCALERT'), item(EVENT_ID_TWO, 'SCOREREF'),
      item('55000000-0000-4000-8000-000000000203', 'REPORTREF'),
      item('55000000-0000-4000-8000-000000000204', 'ACCNEW'),
      item('55000000-0000-4000-8000-000000000205', 'ACCCLOSED'),
    ], scenario.deps);
    assert.deepEqual(notified, [EVENT_ID_ONE]);
    assert.deepEqual(scenario.enqueued, []);
  });

  it('contains producer failure without suppressing analysis enqueue', async () => {
    const scenario = fakeDependencies();
    scenario.deps.notifyCrsAlert = async () => { throw new Error('fixed producer failure'); };
    const original = console.error; const lines: unknown[] = [];
    try {
      console.error = (...args) => { lines.push(args); };
      await scheduleAnalysisFanOut([item(EVENT_ID_ONE)], scenario.deps);
    } finally { console.error = original; }
    assert.equal(scenario.enqueued.length, 1);
    assert.deepEqual(lines, [['CRS_ALERT_NOTIFICATION_PRODUCER_FAILED']]);
  });

  it('uses each persisted monitoring id as the alert source and one bounded drain promise', async () => {
    const scenario = fakeDependencies();
    await scheduleAnalysisFanOut([item(EVENT_ID_ONE), item(EVENT_ID_TWO)], scenario.deps);
    assert.deepEqual(scenario.enqueued, [
      {
        clientId: CLIENT_ID,
        sourceKind: 'monitoring_event',
        sourceId: EVENT_ID_ONE,
        trigger: 'alert',
      },
      {
        clientId: CLIENT_ID,
        sourceKind: 'monitoring_event',
        sourceId: EVENT_ID_TWO,
        trigger: 'alert',
      },
    ]);
    assert.deepEqual(scenario.drained, [{ maxJobs: 2, workerId: WORKER_ID }]);
  });

  it('collapses the same fan-out item across independent callbacks', async () => {
    const scenario = runtimeDependencies();
    await scheduleAnalysisFanOut([item(EVENT_ID_ONE)], scenario.deps);
    await scheduleAnalysisFanOut([item(EVENT_ID_ONE)], scenario.deps);
    assert.equal(scenario.repository.readJobs().length, 1);
    assert.equal(scenario.repository.readRuns().length, 1);
    assert.equal(scenario.repository.readPlanCount(), 1);
    assert.equal(scenario.pulls(), 1);
  });

  it('collapses duplicate full webhook delivery from stored event through output', async () => {
    const scenario = runtimeDependencies();
    const store = createInMemoryMonitoringEventStore();
    const resolver = createInMemoryMemberRefResolver([{ clientId: CLIENT_ID, memberRef: MEMBER_REF }]);
    const rawBody = JSON.stringify([{
      id: 'not-a-real-provider-hook',
      type: 'ACCALERT',
      user_id: MEMBER_REF,
      time: 1755302400000,
      alert_id: '550e8400-e29b-41d4-a716-446655440003',
      alert_date: 1755302340000,
      alert_source: 'Equifax',
    }]);
    const input = {
      headers: new Headers({
        authorization: `Basic ${Buffer.from('not-a-real-user:not-a-real-pass').toString('base64')}`,
      }),
      rawBody,
      remoteAddress: null,
      config: WEBHOOK_CONFIG,
      store,
      resolver,
      clock: createFixedClock(INSTANT),
      pointerCodec: POINTER_CODEC,
    };

    const first = await handleCrsWebhook(input);
    const second = await handleCrsWebhook(input);
    assert.equal(first.fanOut[0].monitoringEventId, second.fanOut[0].monitoringEventId);
    await scheduleAnalysisFanOut(first.fanOut, scenario.deps);
    await scheduleAnalysisFanOut(second.fanOut, scenario.deps);
    assert.equal(store.readAll().length, 1);
    assert.equal(scenario.repository.readJobs().length, 1);
    assert.equal(scenario.repository.readRuns().length, 1);
    assert.equal(scenario.repository.readPlanCount(), 1);
  });

  it('keeps distinct persisted events as distinct queue and output identities', async () => {
    const scenario = runtimeDependencies();
    await scheduleAnalysisFanOut([item(EVENT_ID_ONE), item(EVENT_ID_TWO)], scenario.deps);
    assert.equal(scenario.repository.readJobs().length, 2);
    assert.equal(scenario.repository.readRuns().length, 2);
    assert.equal(scenario.repository.readPlanCount(), 2);
    assert.equal(scenario.pulls(), 2);
  });

  for (const env of [{}, { FEATURE_ANALYSIS: '' }]) {
    it(`stays inert when the flag is ${Object.keys(env).length === 0 ? 'absent' : 'blank'}`, async () => {
      const scenario = fakeDependencies();
      scenario.deps.env = env;
      await scheduleAnalysisFanOut([item(EVENT_ID_ONE)], scenario.deps);
      assert.deepEqual(scenario.enqueued, []);
      assert.deepEqual(scenario.drained, []);
    });
  }

  it('does not start a drain after enqueue failure', async () => {
    const scenario = fakeDependencies();
    scenario.deps.enqueue = async () => {
      throw new Error('fixed test failure');
    };
    await assert.rejects(scheduleAnalysisFanOut([item(EVENT_ID_ONE)], scenario.deps));
    assert.deepEqual(scenario.drained, []);
  });

  it('propagates drain interruption after the source-keyed enqueue completes', async () => {
    const scenario = fakeDependencies();
    scenario.deps.drain = async () => {
      throw new Error('fixed test interruption');
    };
    await assert.rejects(scheduleAnalysisFanOut([item(EVENT_ID_ONE)], scenario.deps));
    assert.equal(scenario.enqueued.length, 1);
  });
});
