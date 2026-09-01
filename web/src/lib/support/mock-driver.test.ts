import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MOCK_SUPPORT_DRAFT_MODEL, classifyIntent, createMockSupportDraftDriver } from './mock-driver.ts';

import type { SupportDraftContext, SupportThreadKind } from './types.ts';

function teamChat(...bodies: string[]): SupportDraftContext {
  return {
    threadKind: 'team_chat',
    threadSubject: 'Team chat',
    recentMessages: bodies.map((body) => ({ authorKind: 'consumer' as const, body })),
  };
}

function context(
  threadKind: SupportThreadKind,
  messages: readonly { authorKind: 'consumer' | 'operator' | 'admin'; body: string }[],
): SupportDraftContext {
  return { threadKind, threadSubject: 'Subject line', recentMessages: messages };
}

describe('mock support draft driver', () => {
  const driver = createMockSupportDraftDriver();

  it('reports its identity', () => {
    assert.equal(driver.driver, 'mock');
    assert.equal(driver.model, MOCK_SUPPORT_DRAFT_MODEL);
  });

  it('is deterministic across repeated calls with the same context', async () => {
    const input = teamChat('Any update on where we are with my file?');
    const first = await driver.generateDraft(input);
    const second = await driver.generateDraft(input);
    assert.deepEqual(first, second);
  });

  it('classifies each intent and returns its fixed confidence', async () => {
    const cases: readonly [string, string, number][] = [
      ['status_update', 'Any update on my file?', 0.86],
      ['document_request', 'Where do I upload the bank statement?', 0.86],
      ['scheduling', 'Can we schedule a call this week?', 0.86],
      ['billing_question', 'There is a charge on my invoice I do not recognise.', 0.86],
      ['fallback', 'Hello there.', 0.4],
    ];

    for (const [intent, body, confidence] of cases) {
      const input = teamChat(body);
      assert.equal(classifyIntent(input), intent, body);
      const candidate = await driver.generateDraft(input);
      assert.equal(candidate.confidence, confidence, body);
      assert.equal(candidate.model, MOCK_SUPPORT_DRAFT_MODEL);
      assert.ok(candidate.body.length > 0);
    }
  });

  // The fallback confidence is the reason SUPP-04's negative path runs in CI
  // with no key: an unrecognized question yields a draft a person can read and
  // nobody can send.
  it('puts an unrecognized question below the default bar', async () => {
    const candidate = await driver.generateDraft(teamChat('Hello there.'));
    assert.ok(candidate.confidence < 0.7);
  });

  it('classifies the last message from the other side, not the drafter', () => {
    assert.equal(
      classifyIntent(
        context('team_chat', [
          { authorKind: 'consumer', body: 'Can we schedule a call?' },
          { authorKind: 'operator', body: 'Any update on the invoice?' },
        ]),
      ),
      'scheduling',
    );

    assert.equal(
      classifyIntent(
        context('platform_support', [
          { authorKind: 'operator', body: 'Where do I upload the signed paperwork?' },
          { authorKind: 'admin', body: 'Can we schedule a call?' },
        ]),
      ),
      'document_request',
    );
  });

  it('falls back on an empty thread', () => {
    assert.equal(classifyIntent(context('team_chat', [])), 'fallback');
  });

  it('approves its own templates, which carry no figure and no address', async () => {
    for (const body of [
      'Any update on my file?',
      'Where do I upload the bank statement?',
      'Can we schedule a call this week?',
      'There is a charge on my invoice I do not recognise.',
      'Hello there.',
    ]) {
      const input = teamChat(body);
      const candidate = await driver.generateDraft(input);
      assert.deepEqual(await driver.superviseDraft(input, candidate), {
        approved: true,
        codes: [],
      });
    }
  });

  it('refuses a figure that is not in the thread', async () => {
    const input = teamChat('Any update on my file?');
    const verdict = await driver.superviseDraft(input, {
      body: 'Your file will be ready in 14 days.',
      confidence: 0.9,
      model: MOCK_SUPPORT_DRAFT_MODEL,
    });
    assert.deepEqual(verdict, { approved: false, codes: ['UNGROUNDED_NUMBER'] });
  });

  it('accepts a figure the thread already carries', async () => {
    const input = teamChat('I sent 3 statements last week, did they arrive?');
    const verdict = await driver.superviseDraft(input, {
      body: 'All 3 arrived and are with the team.',
      confidence: 0.9,
      model: MOCK_SUPPORT_DRAFT_MODEL,
    });
    assert.deepEqual(verdict, { approved: true, codes: [] });
  });

  it('refuses an over-long body', async () => {
    const input = teamChat('Any update on my file?');
    const verdict = await driver.superviseDraft(input, {
      body: 'x'.repeat(601),
      confidence: 0.9,
      model: MOCK_SUPPORT_DRAFT_MODEL,
    });
    assert.deepEqual(verdict, { approved: false, codes: ['LENGTH'] });
  });

  it('refuses a web address', async () => {
    const input = teamChat('Any update on my file?');
    const verdict = await driver.superviseDraft(input, {
      body: 'Have a look at https://example.test for the answer.',
      confidence: 0.9,
      model: MOCK_SUPPORT_DRAFT_MODEL,
    });
    assert.deepEqual(verdict, { approved: false, codes: ['UNGROUNDED_LINK'] });
  });

  it('reports every ground it refuses on at once', async () => {
    const input = teamChat('Any update on my file?');
    const verdict = await driver.superviseDraft(input, {
      body: `Ready in 14 days, see http://example.test ${'x'.repeat(601)}`,
      confidence: 0.9,
      model: MOCK_SUPPORT_DRAFT_MODEL,
    });
    assert.deepEqual(verdict, {
      approved: false,
      codes: ['UNGROUNDED_NUMBER', 'LENGTH', 'UNGROUNDED_LINK'],
    });
  });

  // Every code has to survive migration 100's held_drafts_flag_shape, which
  // accepts an upper-case identifier of two to sixty-four characters.
  it('emits codes the database will accept', async () => {
    const input = teamChat('Any update on my file?');
    const verdict = await driver.superviseDraft(input, {
      body: `Ready in 14 days, see http://example.test ${'x'.repeat(601)}`,
      confidence: 0.9,
      model: MOCK_SUPPORT_DRAFT_MODEL,
    });
    for (const code of verdict.codes) {
      assert.match(code, /^[A-Z][A-Z0-9_]{1,63}$/);
    }
  });
});
