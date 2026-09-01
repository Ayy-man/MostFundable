// web/src/lib/crs/wiring.ts — the single composition root for Phase 4 runtime ports.
//
// The route handlers and the CRS domain functions keep the same ports.

import {
  drainAnalysisQueue,
  enqueueAnalysisRun,
  getAnalysisWorkerId,
} from '../analysis/worker.ts';
import { featureFlag } from '../env.ts';
import { enqueueCrsAlertNotification } from '../ancillary/notifications.ts';
import {
  systemClock,
} from './ports.ts';
import {
  createSupabaseMemberRefResolver,
  createSupabaseMonitoringEventStore,
} from './supabase-ports.ts';
import { createSessionCallerReader } from './session-reader.ts';

import type { DrainAnalysisQueueResult, EnqueueAnalysisRunInput } from '../analysis/worker.ts';
import type { EnvSource } from '../env.ts';
import type { Clock, MemberRefResolver, MonitoringEventStore } from './ports.ts';
import type { CallerSessionReader } from './token.ts';
import type { WebhookFanOutItem } from './webhook-handler.ts';

export interface CrsRuntimePorts {
  store: MonitoringEventStore;
  resolver: MemberRefResolver;
  session: CallerSessionReader;
  clock: Clock;
  enqueueFanOut(items: readonly WebhookFanOutItem[]): Promise<void>;
  scheduleFanOut(items: readonly WebhookFanOutItem[]): Promise<void>;
}

let runtimePorts: CrsRuntimePorts | null = null;

const MAX_ALERT_DRAIN_JOBS = 25;

export interface AnalysisFanOutDependencies {
  env: EnvSource;
  enqueue(input: EnqueueAnalysisRunInput): Promise<unknown>;
  drain(input: { maxJobs: number; workerId: string }): Promise<DrainAnalysisQueueResult>;
  getWorkerId(): string;
  notifyCrsAlert(input: { clientId: string; monitoringEventId: string; eventType: string }): Promise<unknown>;
}

const productionFanOutDependencies: AnalysisFanOutDependencies = {
  env: process.env,
  enqueue: enqueueAnalysisRun,
  drain: drainAnalysisQueue,
  getWorkerId: getAnalysisWorkerId,
  notifyCrsAlert: enqueueCrsAlertNotification,
};

export async function scheduleAnalysisFanOut(
  items: readonly WebhookFanOutItem[],
  deps: AnalysisFanOutDependencies = productionFanOutDependencies,
): Promise<void> {
  if (items.length === 0) return;

  await Promise.all(items.filter((item) => item.event.eventType === 'ACCALERT').map(async (item) => {
    try {
      await deps.notifyCrsAlert({ clientId: item.clientId, monitoringEventId: item.monitoringEventId, eventType: item.event.eventType });
    } catch {
      console.error('CRS_ALERT_NOTIFICATION_PRODUCER_FAILED');
    }
  }));

  if (!featureFlag('FEATURE_ANALYSIS', deps.env)) return;

  await Promise.all(
    items.map((item) =>
      deps.enqueue({
        clientId: item.clientId,
        sourceKind: 'monitoring_event',
        sourceId: item.monitoringEventId,
        trigger: 'alert',
      }),
    ),
  );

  await deps.drain({
    maxJobs: Math.min(items.length, MAX_ALERT_DRAIN_JOBS),
    workerId: deps.getWorkerId(),
  });
}

export async function enqueueAnalysisFanOut(
  items: readonly WebhookFanOutItem[],
  deps: Pick<AnalysisFanOutDependencies, 'env' | 'enqueue'> = productionFanOutDependencies,
): Promise<void> {
  if (!featureFlag('FEATURE_ANALYSIS', deps.env)) return;
  await Promise.all(items.map((item) => deps.enqueue({
    clientId: item.clientId,
    sourceKind: 'monitoring_event',
    sourceId: item.monitoringEventId,
    trigger: 'alert',
  })));
}

export async function prepareWebhookAcknowledgement(
  result: import('./webhook-handler.ts').CrsWebhookHandlerResult,
  enqueue: (items: readonly WebhookFanOutItem[]) => Promise<void>,
): Promise<import('./webhook-handler.ts').CrsWebhookHandlerResult> {
  if (result.status !== 200 || result.fanOut.length === 0) return result;
  try {
    await enqueue(result.fanOut);
    return result;
  } catch {
    return { body: [], fanOut: [], status: 503 };
  }
}

export function getCrsRuntimePorts(): CrsRuntimePorts {
  if (runtimePorts === null) {
    runtimePorts = {
      store: createSupabaseMonitoringEventStore(),
      resolver: createSupabaseMemberRefResolver(),
      // Wired to the merged session layer on 2026-08-17 (integrator, GAPS G-3B-09); the Phase-4
      // unauthenticated reader stays in token.ts for the unit suites only.
      session: createSessionCallerReader(),
      clock: systemClock,
      enqueueFanOut: enqueueAnalysisFanOut,
      scheduleFanOut: scheduleAnalysisFanOut,
    };
  }

  return runtimePorts;
}
