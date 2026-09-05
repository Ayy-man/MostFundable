import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMockAdapter } from '../crs/mock/driver.ts';
import { createFixedClock } from '../crs/ports.ts';
import { createMockPlanDriver } from '../llm/mock-driver.ts';
import { createMockNarrativeDriver, deriveMockNarrative } from '../llm/narrative/driver.ts';
import { tinyPack } from '../llm/narrative/__fixtures__/packs.ts';
import { createInMemoryAnalysisRepository } from './repository.ts';
import { drainAnalysisQueue, enqueueAnalysisRun } from './worker.ts';

import type { CrsMemberRef, CrsPersona } from '../crs/types.ts';
import type { CrsWebhookConfig } from '../crs/webhook.ts';
import type { NarrativeDriver } from '../llm/narrative/driver.ts';
import type { AnalysisRepository, AnalysisStageTracker } from './ports.ts';
import type { InMemoryAnalysisRepository } from './repository.ts';

const CLIENT_ID = '55000000-0000-4000-8000-000000000101';
const ENROLLMENT_ID = '55000000-0000-4000-8000-000000000201';
const WORKER_ID = '55000000-0000-4000-8000-000000000901';
const INSTANT = '2026-09-05T02:00:00.000Z';
const ENABLED = { FEATURE_ANALYSIS: 'true' };

const WEBHOOK_CONFIG: CrsWebhookConfig = {
  basicUser: null,
  basicPass: null,
  hmacSecret: null,
  hmacHeader: 'x-crs-signature',
  sourceIps: [],
};

const tracker: AnalysisStageTracker = { async recordAnalysisCompleted() {} };

function repositoryFor(persona: CrsPersona): InMemoryAnalysisRepository {
  return createInMemoryAnalysisRepository({
    clock: { now: () => createFixedClock(INSTANT).now() },
    enrollments: { [CLIENT_ID]: `mock_${persona}_000001` as CrsMemberRef },
  });
}

function adapter(persona: CrsPersona) {
  const inner = createMockAdapter({ clock: createFixedClock(INSTANT), webhookConfig: WEBHOOK_CONFIG });
  return {
    ...inner,
    async softPull(_ref: CrsMemberRef, reportCodes: readonly string[]) {
      return inner.softPull(`mock_${persona}_000001` as CrsMemberRef, reportCodes as never);
    },
  };
}

interface RunOptions {
  persona?: CrsPersona;
  narrativeDriver?: NarrativeDriver;
  buildFactsPack?: () => never | ReturnType<typeof tinyPack>;
  repository?: AnalysisRepository;
}

async function runOneJob(repository: InMemoryAnalysisRepository, options: RunOptions = {}) {
  await enqueueAnalysisRun(
    { clientId: CLIENT_ID, sourceKind: 'enrollment', sourceId: ENROLLMENT_ID, trigger: 'scheduled' },
    { env: ENABLED, repository },
  );
  return drainAnalysisQueue(
    { maxJobs: 1, workerId: WORKER_ID },
    {
      env: ENABLED,
      repository: options.repository ?? repository,
      tracker,
      getAdapter: () => adapter(options.persona ?? 'clean') as never,
      getDriver: createMockPlanDriver,
      getNarrativeDriver: () => options.narrativeDriver ?? createMockNarrativeDriver(),
      buildFactsPack: options.buildFactsPack ?? (() => tinyPack()),
    },
  );
}

describe('analysis worker narrative attachment', () => {
  it('writes the narrative after the plan is persisted', async () => {
    const repository = repositoryFor('clean');
    const result = await runOneJob(repository);
    assert.equal(result.succeeded, 1);
    const run = repository.readRuns()[0];
    const narrative = repository.readNarrative(run.analysisRunId) as { verdict: string } | null;
    assert.notEqual(narrative, null, 'the narrative reached the repository');
    assert.ok(narrative?.verdict.length ?? 0 > 0);
  });

  it('completes the job when the facts pack cannot be built', async () => {
    // The placeholder in `narrative/facts.ts` behaves exactly like this until the rules half lands.
    const repository = repositoryFor('clean');
    const result = await runOneJob(repository, {
      buildFactsPack: () => { throw new Error('FACTS_PACK_NOT_IMPLEMENTED'); },
    });
    assert.equal(result.succeeded, 1, 'the analysis is not the narrative');
    assert.equal(result.failed, 0);
    assert.equal(repository.readNarrative(repository.readRuns()[0].analysisRunId), null);
  });

  it('completes the job when the model never produces an approved narrative', async () => {
    const repository = repositoryFor('clean');
    const refusing: NarrativeDriver = {
      driver: 'mock',
      model: 'refusing',
      async write(pack) {
        // Grounded in nothing: the checker rejects it twice and the engine gives up.
        return { ...deriveMockNarrative(pack, 1), verdict: 'Near Ready. 4321 items to fix.' };
      },
    };
    const result = await runOneJob(repository, { narrativeDriver: refusing });
    assert.equal(result.succeeded, 1);
    assert.equal(repository.readNarrative(repository.readRuns()[0].analysisRunId), null);
  });

  it('completes the job when the driver throws', async () => {
    const repository = repositoryFor('clean');
    const throwing: NarrativeDriver = {
      driver: 'openrouter',
      model: 'unreachable',
      async write() { throw new Error('OPENROUTER_TIMEOUT'); },
    };
    const result = await runOneJob(repository, { narrativeDriver: throwing });
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 0);
  });

  it('completes the job when the narrative write itself fails', async () => {
    const repository = repositoryFor('clean');
    const failing: AnalysisRepository = {
      ...repository,
      async attachNarrative() { throw new Error('ANALYSIS_REPOSITORY_NARRATIVE_FAILED'); },
    };
    const result = await runOneJob(repository, { repository: failing });
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 0);
  });

  it('does not attempt a narrative when the pull was a no-hit', async () => {
    const repository = repositoryFor('no_hit');
    let built = 0;
    const result = await runOneJob(repository, {
      persona: 'no_hit',
      buildFactsPack: () => { built += 1; return tinyPack(); },
    });
    assert.equal(result.succeeded, 1);
    assert.equal(built, 0, 'nothing to narrate, so nothing is built');
  });
});
