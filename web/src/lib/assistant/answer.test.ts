import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { answerForScope } from './answer.ts';
import { ASSISTANT_STAGES, AssistantError, assistantErrorStatus } from './types.ts';

import type { Application } from '../applications/types.ts';
import type { SessionProfile } from '../auth/session.ts';
import type { ChatRequest, ChatTransport } from '../llm/chat-transport.ts';
import type { AdminKbDependencies } from '../kb/admin-answer.ts';
import type { OperatorKbDependencies } from '../kb/operator.ts';
import type { HeldDraftRow } from '../support/repository.ts';
import type { TrackerClient } from '../tracker/types.ts';
import type { AssistantStage } from './types.ts';

const BANK_REF = 'first-national-holdings';

function session(): SessionProfile {
  return { disabledAt: null, id: 'operator-1', manages: [], orgId: 'org-1', orgMembership: null, orgRole: 'owner', role: 'operator_member' };
}

function client(): TrackerClient {
  return {
    analysisAt: null, analysisPending: null, archivedAt: null, archivedById: null, assignedToId: null,
    assignedToName: null, businessName: null, consumerProfileId: null, displayName: 'Rivera Logistics',
    estimatedCompletionAt: null, fundingApprovedCents: null, goalCents: 100_000, health: 'green',
    history: [], id: 'client-a', lastActivityAt: '2026-08-16T00:00:00Z', matchesUnlockedOverride: false,
    monitoring: 'active', nextRefreshAt: null, openActionCount: 2, readiness: 70, stage: 'applying',
    stageEnteredAt: '2026-08-16T00:00:00Z', startedAt: '2026-08-01T00:00:00Z', status: 'active',
  };
}

function application(): Application {
  return {
    amountCents: 10_000, bankRef: BANK_REF, clientId: 'client-a', consumerStatus: 'pending',
    createdAt: '2026-08-16T00:00:00Z', id: 'application-a', operatorStatus: 'todo',
    updatedAt: '2026-08-16T00:00:00Z', visibility: 'inherit',
  };
}

/**
 * The grounding reads, faked; the pipeline itself is real.
 *
 * `answerForScope` is left to call `createOperatorKbAnswer` for real, so the
 * stage lines below are produced by the same `runGroundedChat` the operator KB
 * route runs. A test that stubbed the pipeline would be asserting the order of
 * two calls it made itself.
 */
function grounding(): Omit<OperatorKbDependencies, 'transport' | 'onProgress'> {
  return {
    async generateDraft() { return {} as HeldDraftRow; },
    async listApplications() { return [application()]; },
    async listBankRetrievalDocuments() { return []; },
    async listTrackerClients() { return [client()]; },
  };
}

interface Recorder {
  readonly stages: AssistantStage[];
  readonly operations: string[];
  readonly stagesAtDispatch: AssistantStage[][];
}

function recordingTransport(
  respond: (request: ChatRequest, documents: Array<{ id: string; title: string }>) => unknown,
): { transport: () => ChatTransport; recorder: Recorder } {
  const recorder: Recorder = { operations: [], stages: [], stagesAtDispatch: [] };
  const transport: ChatTransport = {
    async complete(request) {
      recorder.operations.push(request.operation);
      // The stage list as it stands the instant the request is dispatched. This
      // is what proves a stage names work that is starting rather than work that
      // is over.
      recorder.stagesAtDispatch.push([...recorder.stages]);
      const parsed = JSON.parse(request.messages[1]?.content ?? '{}') as { documents?: Array<{ id: string; title: string }> };
      return respond(request, parsed.documents ?? []);
    },
    driver: 'mock',
    model: 'mock',
  };
  return { recorder, transport: () => transport };
}

/**
 * The candidate, cited by the handle the request carried.
 *
 * Since F-05 the model is shown opaque per-request handles rather than
 * `tracker:<uuid>`, so echoing back what arrived is the only way this stays an
 * echo rather than a transcription of a handle format.
 */
function grounded(request: ChatRequest, documents: Array<{ id: string; title: string }>): unknown {
  if (!request.operation.endsWith('.candidate')) return { approved: true };
  return {
    bullets: ['Readiness is 70 and two actions are open.'],
    citations: [{ id: documents[0]!.id }],
    headline: 'The cited workspace information supports this answer.',
  };
}

function adminSession(): SessionProfile {
  return { disabledAt: null, id: 'admin-1', manages: [], orgId: null, orgMembership: null, orgRole: null, role: 'platform_admin' };
}

/** The platform reads, faked; `createAdminKbAnswer` and the pipeline are real. */
function adminGrounding(): Omit<AdminKbDependencies, 'transport' | 'onProgress'> {
  return {
    async readCounts() { return { analyses: 12, consumers: 40, operators: 3 }; },
    async readFundedVolume() { return { monthly: [{ amountCents: 500_000, label: '2026-07' }], weekly: [] }; },
    async readPlatformMrrCents() { return 250_000; },
    async readTenants() {
      return [{
        clients: 9, fundedAllTimeCents: 900_000, fundedOutcomes: 3, fundedYtdCents: 500_000,
        fundingReadyDays: 21, id: 'org-1', membership: 'active', name: 'Northbridge Capital',
        plan: 'growth', slug: 'northbridge', startedAt: '2026-01-04',
      }];
    },
    today: () => '2026-08-22',
  };
}

describe('answerForScope stages', () => {
  it('reports every stage exactly once, in the pipeline order', async () => {
    const { recorder, transport } = recordingTransport(grounded);

    const answer = await answerForScope('operator', 'Where does this client stand?', session(), {
      onProgress: (progress) => recorder.stages.push(progress.stage),
      operatorDependencies: grounding(),
      resolveBankLabels: async () => new Map(),
      transport,
    });

    assert.deepEqual(recorder.stages, [...ASSISTANT_STAGES]);
    assert.equal(answer.body.length > 0, true);
  });

  it('emits one stage per unit of work rather than one per elapsed interval', async () => {
    // Watched failing with `instrumented` moved to report after its await and
    // to announce both stages together — the shape a reader gets if the stages
    // are treated as a script rather than as observations. The count is derived,
    // not written: one stage for the grounding read that
    // happens before any model call, plus one for each request the pipeline
    // actually dispatched. A stage emitted on a timer, or a stage emitted for a
    // call that never happened, breaks this equality without anyone having to
    // predict how many calls the pipeline makes.
    const { recorder, transport } = recordingTransport(grounded);

    await answerForScope('operator', 'Where does this client stand?', session(), {
      onProgress: (progress) => recorder.stages.push(progress.stage),
      operatorDependencies: grounding(),
      resolveBankLabels: async () => new Map(),
      transport,
    });

    assert.equal(recorder.stages.length, recorder.operations.length + 2);
    // Each dispatch already saw its own stage and nothing beyond it: one
    // `retrieving` plus one stage per call up to and including this one. That is
    // the difference between a stage naming work that is starting and a stage
    // naming work that has finished.
    recorder.stagesAtDispatch.forEach((snapshot, index) => {
      assert.equal(snapshot.length, index + 3);
    });
  });

  it('does not claim a review that never happened', async () => {
    // Watched failing against the same after-the-await variant. A candidate
    // citing a document the grounding set does not contain is
    // rejected by `citationsBelongTo` before the supervisor is asked. Emitting
    // `reviewing` anyway would put a line on screen for work the machine skipped.
    const { recorder, transport } = recordingTransport((request) =>
      request.operation.endsWith('.candidate')
        ? { bullets: [], citations: [{ id: 'doc-99' }], headline: 'Invented.' }
        : { approved: true },
    );

    await assert.rejects(
      answerForScope('operator', 'Where does this client stand?', session(), {
        onProgress: (progress) => recorder.stages.push(progress.stage),
        operatorDependencies: grounding(),
        resolveBankLabels: async () => new Map(),
        transport,
      }),
      (error: unknown) => error instanceof AssistantError && error.code === 'ASSISTANT_ANSWER_UNAVAILABLE',
    );

    assert.equal(recorder.stages.includes('reviewing'), false);
    assert.deepEqual(recorder.stages, ['searching', 'reading', 'composing']);
    assert.deepEqual(
      recorder.operations.map((operation) => operation.endsWith('.candidate')),
      [true, true],
      'a regenerated local refusal must not invent another visible pipeline stage',
    );
  });

  it('answers the admin scope through the same pipeline and the same stages', async () => {
    // F-08's other half. `lib/kb/admin-answer.ts` did not exist and this branch
    // threw `ASSISTANT_SCOPE_UNAVAILABLE`, so deleting the inert admin shell
    // would have replaced it with a workspace that says the same thing. The
    // stage list is compared against `ASSISTANT_STAGES` rather than a literal,
    // so the two scopes cannot drift into reporting different vocabularies.
    // Cites the operator document by its title rather than by position: the
    // platform builder orders its two metric documents first so the context
    // bound cannot drop them, and a positional pick here would silently become a
    // test about a metric chip the day that ordering changed again.
    const { recorder, transport } = recordingTransport((request, documents) => {
      if (!request.operation.endsWith('.candidate')) return { approved: true };
      const operator = documents.find((document) => document.title === 'Northbridge Capital');
      assert.ok(operator, 'the platform grounding named no operator');
      return { bullets: [], citations: [{ id: operator.id }], headline: 'Northbridge Capital grew fastest.' };
    });

    const answer = await answerForScope('admin', 'Which operator grew fastest?', adminSession(), {
      adminDependencies: adminGrounding(),
      onProgress: (progress) => recorder.stages.push(progress.stage),
      transport,
    });

    assert.deepEqual(recorder.stages, [...ASSISTANT_STAGES]);
    assert.equal(answer.body.length > 0, true);
    // The chip resolves to the operator the grounding named, by its human label.
    assert.deepEqual(answer.sources.map((source) => source.kind), ['operator']);
    assert.equal(answer.sources[0]!.label, 'Operator · Northbridge Capital');
  });

  it('builds no transport for a question it refuses without asking a model', async () => {
    // Watched failing against the version of `answerForScope` that constructed
    // the transport before the scope branch. It looks harmless and is not:
    // `createZdrChatTransport` throws when no key is configured, so every
    // refusal that never needed a model — the wrong role, an empty roster —
    // became a thrown provider error in any environment without a key, which is
    // most of them.
    let constructed = 0;

    await assert.rejects(
      answerForScope('admin', 'Which operator grew fastest?', session(), {
        adminDependencies: adminGrounding(),
        onProgress: () => {},
        transport: () => {
          constructed += 1;
          throw new Error('the transport must not be built for a refusal');
        },
      }),
      (error: unknown) => error instanceof AssistantError,
    );

    assert.equal(constructed, 0);
  });

  it('refuses a platform question from a session that is not platform staff', async () => {
    // The route gates on the role too. This is the second refusal, and it is the
    // one that matters: the admin grounding is cross-tenant by construction, so
    // a caller who reached the scope must not receive platform figures because
    // one gate upstream was edited.
    const { recorder, transport } = recordingTransport(grounded);

    await assert.rejects(
      answerForScope('admin', 'Which operator grew fastest?', session(), {
        adminDependencies: adminGrounding(),
        onProgress: (progress) => recorder.stages.push(progress.stage),
        transport,
      }),
      (error: unknown) => error instanceof AssistantError && error.code === 'ASSISTANT_ANSWER_UNAVAILABLE',
    );

    // Refused before any read ran, so no platform figure was even assembled.
    assert.deepEqual(recorder.operations, []);
    assert.equal(assistantErrorStatus('ASSISTANT_ANSWER_UNAVAILABLE'), 503);
  });

});
