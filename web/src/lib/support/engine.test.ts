import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { NORMALIZED_ADVERSARIAL_LANGUAGE } from '../compliance/__fixtures__/adversarial-language.mjs';

import { runDraftEngine } from './engine.ts';
import { evaluateDraftLanguage } from './language-gate.ts';
import { SUPPORT_DRAFT_PROMPT_V1 } from './prompt.ts';

import type {
  SupervisorVerdict,
  SupportDraftCandidate,
  SupportDraftContext,
  SupportDraftDriver,
} from './types.ts';
import type { RecordEvalRunInput, ResolvedPrompt } from '../admin/prompt-types.ts';

const CONTEXT: SupportDraftContext = {
  threadKind: 'team_chat',
  threadSubject: 'Team chat',
  recentMessages: [{ authorKind: 'consumer', body: 'Any update on my file?' }],
};

const CLEAN_BODY = 'Your file is with the team and I will follow up here as soon as I can.';

// A poisoned string lifted from the shared compliance fixture at run time.
//
// It is read rather than written out, for two reasons that pull the same way:
// the fixture is the only file in the tree allow-listed for this vocabulary, so
// a literal here would fail `verify-compliance-copy.mjs` and the fix would be a
// seventh allow-list entry; and reading it means this test exercises whatever
// lane C's battery actually catches today rather than a copy that can drift.
const POISONED_BODY = ((): string => {
  const fixture: unknown = JSON.parse(
    readFileSync(
      new URL('../llm/__fixtures__/compliance/poisoned-plan.json', import.meta.url),
      'utf8',
    ),
  );

  const walk = (value: unknown): string | undefined => {
    if (typeof value === 'string') {
      return evaluateDraftLanguage(value).length > 0 ? value : undefined;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) {
        const found = walk(item);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };

  const found = walk(fixture);
  if (found === undefined) {
    throw new Error('the shared compliance fixture no longer trips the language battery');
  }
  return found;
})();

interface StubOptions {
  readonly body?: string;
  readonly confidence: number;
  readonly supervisorApproved: boolean;
}

function stubDriver(options: StubOptions): SupportDraftDriver & { calls: () => number } {
  let calls = 0;
  return {
    driver: 'mock',
    model: 'stub-model-v1',
    calls: () => calls,
    async generateDraft(): Promise<SupportDraftCandidate> {
      calls += 1;
      return {
        body: options.body ?? CLEAN_BODY,
        confidence: options.confidence,
        model: 'stub-model-v1',
      };
    },
    async superviseDraft(): Promise<SupervisorVerdict> {
      return options.supervisorApproved
        ? { approved: true, codes: [] }
        : { approved: false, codes: ['UNGROUNDED_NUMBER'] };
    },
  };
}

describe('support draft engine', () => {
  // The full 2x2x2 matrix over the three gates, with the reason code resolved
  // in precedence order: supervisor, then language, then confidence.
  it('walks every gate combination with an exact reason code', async () => {
    const cases: readonly {
      supervisorApproved: boolean;
      clean: boolean;
      aboveBar: boolean;
      status: 'draft' | 'approved';
      reasonCode: string;
    }[] = [
      { supervisorApproved: true, clean: true, aboveBar: true, status: 'approved', reasonCode: 'gates_passed' },
      { supervisorApproved: true, clean: true, aboveBar: false, status: 'draft', reasonCode: 'confidence_below_threshold' },
      { supervisorApproved: true, clean: false, aboveBar: true, status: 'draft', reasonCode: 'guardrail_flagged' },
      { supervisorApproved: true, clean: false, aboveBar: false, status: 'draft', reasonCode: 'guardrail_flagged' },
      { supervisorApproved: false, clean: true, aboveBar: true, status: 'draft', reasonCode: 'supervisor_rejected' },
      { supervisorApproved: false, clean: true, aboveBar: false, status: 'draft', reasonCode: 'supervisor_rejected' },
      { supervisorApproved: false, clean: false, aboveBar: true, status: 'draft', reasonCode: 'supervisor_rejected' },
      { supervisorApproved: false, clean: false, aboveBar: false, status: 'draft', reasonCode: 'supervisor_rejected' },
    ];

    assert.equal(cases.length, 8);

    for (const testCase of cases) {
      const decision = await runDraftEngine(
        stubDriver({
          body: testCase.clean ? CLEAN_BODY : POISONED_BODY,
          confidence: testCase.aboveBar ? 0.9 : 0.4,
          supervisorApproved: testCase.supervisorApproved,
        }),
        CONTEXT,
        0.7,
      );

      const label = JSON.stringify(testCase);
      assert.equal(decision.status, testCase.status, label);
      assert.equal(decision.reasonCode, testCase.reasonCode, label);
      assert.equal(decision.supervisorApproved, testCase.supervisorApproved, label);
      assert.equal(decision.guardrailFlags.length === 0, testCase.clean, label);
    }
  });

  it('approves at exactly the bar', async () => {
    const decision = await runDraftEngine(
      stubDriver({ confidence: 0.7, supervisorApproved: true }),
      CONTEXT,
      0.7,
    );
    assert.equal(decision.status, 'approved');
    assert.equal(decision.reasonCode, 'gates_passed');
  });

  it('refuses one increment below the bar', async () => {
    const decision = await runDraftEngine(
      stubDriver({ confidence: 0.699, supervisorApproved: true }),
      CONTEXT,
      0.7,
    );
    assert.equal(decision.status, 'draft');
    assert.equal(decision.reasonCode, 'confidence_below_threshold');
  });

  it('flags a poisoned body with a canonical code and keeps it unsendable', async () => {
    const decision = await runDraftEngine(
      stubDriver({ body: POISONED_BODY, confidence: 0.99, supervisorApproved: true }),
      CONTEXT,
      0.7,
    );
    assert.equal(decision.status, 'draft');
    assert.equal(decision.reasonCode, 'guardrail_flagged');
    assert.ok(decision.guardrailFlags.length > 0);
    for (const code of decision.guardrailFlags) assert.match(code, /^LANGUAGE_C\d{2}$/);
  });

  it('holds each new adversarial form at the complete draft boundary', async () => {
    for (const candidate of NORMALIZED_ADVERSARIAL_LANGUAGE) {
      const decision = await runDraftEngine(
        stubDriver({ body: candidate, confidence: 0.99, supervisorApproved: true }),
        CONTEXT,
        0.7,
      );
      assert.equal(decision.status, 'draft');
      assert.equal(decision.reasonCode, 'guardrail_flagged');
    }
  });

  it('carries the row fields the persisted draft needs', async () => {
    const decision = await runDraftEngine(
      stubDriver({ confidence: 0.88, supervisorApproved: true }),
      CONTEXT,
      0.65,
    );
    assert.equal(decision.body, CLEAN_BODY);
    assert.equal(decision.confidence, 0.88);
    assert.equal(decision.confidenceThreshold, 0.65);
    assert.equal(decision.driver, 'mock');
    assert.equal(decision.model, 'stub-model-v1');
    assert.equal(decision.promptKey, SUPPORT_DRAFT_PROMPT_V1.key);
    assert.equal(decision.promptVersion, SUPPORT_DRAFT_PROMPT_V1.version);
  });

  // No retry loop, unlike runPlanEngine. A rejected draft is a persisted
  // artifact a person reads; regenerating it silently would hide the rejection.
  it('calls the driver exactly once, even when the draft is rejected', async () => {
    const driver = stubDriver({ confidence: 0.1, supervisorApproved: false });
    await runDraftEngine(driver, CONTEXT, 0.7);
    assert.equal(driver.calls(), 1);
  });

  it('persists nothing and needs no database client', () => {
    assert.equal(runDraftEngine.length, 3);
  });

  it('propagates one governed version and records all three mandatory gates', async () => {
    const prompt: ResolvedPrompt = Object.freeze({
      key: 'support-draft',
      version: 2,
      body: 'Governed support prompt body',
      source: 'database',
    });
    const base = stubDriver({ confidence: 0.88, supervisorApproved: true });
    const seen: ResolvedPrompt[] = [];
    const records: RecordEvalRunInput[] = [];
    const driver: SupportDraftDriver = {
      driver: base.driver,
      model: base.model,
      async generateDraft(context, supplied) {
        assert.ok(supplied);
        seen.push(supplied);
        return base.generateDraft(context, supplied);
      },
      async superviseDraft(context, candidate, supplied) {
        assert.ok(supplied);
        seen.push(supplied);
        return base.superviseDraft(context, candidate, supplied);
      },
    };

    const decision = await runDraftEngine(driver, CONTEXT, 0.7, {
      env: { FEATURE_ADMIN: 'true' },
      resolvePrompt: async () => prompt,
      recordEvaluation: async (input) => { records.push(input); },
    });

    assert.equal(decision.promptVersion, 2);
    assert.deepEqual(seen, [prompt, prompt]);
    assert.deepEqual(records.map((record) => [record.evaluatorKey, record.passed]), [
      ['support.supervisor', true],
      ['support.language', true],
      ['support.confidence', true],
    ]);
    assert.ok(records.every((record) => record.promptVersion === 2));
    assert.ok(records.every((record) => record.policyVersion === 'eval-policy-2026-08-17-r2'));
    assert.ok(records.every((record) => record.driver === 'mock' && record.model === 'stub-model-v1'));
    assert.ok(records.every((record) => record.eligible === false && /^sha256:[0-9a-f]{64}$/.test(record.referenceDatasetHash)));
  });

  it('uses embedded v1 with no governance calls while the flag is off', async () => {
    let calls = 0;
    const decision = await runDraftEngine(
      stubDriver({ confidence: 0.88, supervisorApproved: true }),
      CONTEXT,
      0.7,
      {
        env: {},
        resolvePrompt: async () => { calls += 1; throw new Error('unexpected prompt read'); },
        recordEvaluation: async () => { calls += 1; },
      },
    );
    assert.equal(calls, 0);
    assert.equal(decision.promptVersion, 1);
  });

  it('fails closed when a governed gate result cannot be persisted', async () => {
    const prompt: ResolvedPrompt = Object.freeze({
      key: 'support-draft', version: 2, body: 'Governed support prompt body', source: 'database',
    });
    await assert.rejects(
      runDraftEngine(stubDriver({ confidence: 0.88, supervisorApproved: true }), CONTEXT, 0.7, {
        env: { FEATURE_ADMIN: 'true' },
        resolvePrompt: async () => prompt,
        recordEvaluation: async () => { throw new Error('ADMIN_EVAL_WRITE_FAILED'); },
      }),
      { message: 'ADMIN_EVAL_WRITE_FAILED' },
    );
  });
});
