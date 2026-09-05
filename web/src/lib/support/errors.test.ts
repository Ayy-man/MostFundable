import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { SupportConfigError } from './config.ts';
import { SupportDraftDriverUnavailableError } from './driver.ts';
import {
  SUPPORT_ERROR_CODES,
  SupportError,
  SupportMessageLanguageError,
  supportErrorStatus,
  toHttpResponse,
  toSupportError,
} from './errors.ts';

import type { SupportErrorCode } from './errors.ts';

// Every string the support migrations can raise, with the status it answers.
// The codes are checked against the migrations themselves below, so this table
// is a status map rather than an inventory: a raise added in SQL without a row
// here fails `covers every raise string the migrations contain`, and a refusal
// that reached a client as SUPPORT_UNAVAILABLE is one nobody can act on.
const RAISED_BY_THE_DATABASE: readonly [SupportErrorCode, number][] = [
  ['SUPPORT_ACTOR_REQUIRED', 401],
  ['SUPPORT_ACTOR_UNKNOWN', 401],
  ['SUPPORT_FORBIDDEN', 403],
  ['SUPPORT_DRAFT_NOT_FOUND', 404],
  ['SUPPORT_THREAD_CLOSED', 409],
  ['SUPPORT_DRAFT_EXISTS', 409],
  ['SUPPORT_DRAFT_NOT_OPEN', 409],
  ['SUPPORT_DRAFT_NOT_APPROVED', 422],
  ['SUPPORT_DRAFT_BODY_MISMATCH', 422],
  ['SUPPORT_THREAD_SCOPE_INVALID', 422],
  ['SUPPORT_AUTHOR_ROLE_MISMATCH', 500],
  ['SUPPORT_DRAFT_PAIRING_INVALID', 500],
  ['SUPPORT_NOTE_NOT_PERMITTED', 403],
  ['SUPPORT_NOTE_DRAFT_CONFLICT', 422],
];

/**
 * Every `SUPPORT_*` string the merged migrations raise, read at test time.
 *
 * Scanning beats listing: the point of this file is that the SQL and the
 * TypeScript agree about the refusal vocabulary, and a list written here would
 * only ever say what somebody remembered when they wrote it. The whole
 * directory is scanned rather than migrations 100 and 101 by name, because a
 * later migration that replaces an RPC whole is exactly where a new raise
 * appears: 103 did that to the thread opener and 385 to the send path, and the
 * two refusals 385 added are what broke the list this replaced.
 */
function raisedByMigrations(): ReadonlySet<string> {
  const directory = new URL('../../../../supabase/migrations/', import.meta.url);
  const raised = new Set<string>();
  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.sql')) continue;
    const sql = readFileSync(new URL(file, directory), 'utf8');
    for (const found of sql.matchAll(/message\s*=\s*'(SUPPORT_[A-Z_]+)'/g)) {
      raised.add(found[1]!);
    }
  }
  return raised;
}

// What PostgREST hands back for a `raise exception using errcode = 'P0001'`.
function postgrestError(message: string): Record<string, unknown> {
  return {
    code: 'P0001',
    details: 'a detail string the client must never see',
    hint: 'a hint string the client must never see',
    message,
  };
}

describe('support error mapping', () => {
  it('maps every database refusal to its code and status', () => {
    for (const [code, status] of RAISED_BY_THE_DATABASE) {
      const error = toSupportError(postgrestError(code));
      assert.equal(error.code, code, code);
      assert.equal(error.status, status, code);
      assert.ok(error instanceof SupportError, code);
    }
  });

  it('covers every raise string the migrations contain', () => {
    const raised = raisedByMigrations();
    assert.ok(raised.size >= 12, 'the migration scan found almost nothing; the raise syntax changed');

    // The SQL side and the status table have to name the same set, in both
    // directions: a raise with no row here loses its status, and a row here with
    // no raise is a refusal the database can no longer produce.
    assert.deepEqual(
      [...raised].sort(),
      RAISED_BY_THE_DATABASE.map(([code]) => code).sort(),
    );

    // Everything the database can raise, plus request validation, the driver,
    // the config error, the language refusal (C5), and the catch-all — the
    // five this lane raises itself.
    assert.equal(SUPPORT_ERROR_CODES.length, raised.size + 5);
    for (const code of raised) {
      assert.ok(SUPPORT_ERROR_CODES.includes(code as SupportErrorCode), code);
    }
  });

  it('recognizes the same strings thrown as plain errors', () => {
    for (const [code, status] of RAISED_BY_THE_DATABASE) {
      const error = toSupportError(new Error(code));
      assert.equal(error.code, code);
      assert.equal(error.status, status);
    }
  });

  it('recognizes the failures this lane raises itself by their code field', () => {
    assert.equal(
      toSupportError(new SupportDraftDriverUnavailableError()).code,
      'SUPPORT_DRAFT_DRIVER_UNAVAILABLE',
    );
    assert.equal(toSupportError(new SupportDraftDriverUnavailableError()).status, 503);
    assert.equal(
      toSupportError(new SupportConfigError('anything at all')).code,
      'SUPPORT_CONFIG_INVALID',
    );
    assert.equal(toSupportError(new SupportConfigError('anything at all')).status, 500);
  });

  it('passes an existing SupportError straight through', () => {
    const original = new SupportError('SUPPORT_FORBIDDEN');
    assert.equal(toSupportError(original), original);
  });

  it('collapses anything unrecognized into SUPPORT_UNAVAILABLE at 500', () => {
    for (const value of [
      new Error('duplicate key value violates unique constraint "held_drafts_pkey"'),
      postgrestError('permission denied for table support_messages'),
      { code: '23505', message: 'conflict' },
      'SUPPORT_MADE_UP_CODE',
      null,
      undefined,
      42,
      new TypeError('fetch failed'),
    ]) {
      const error = toSupportError(value);
      assert.equal(error.code, 'SUPPORT_UNAVAILABLE');
      assert.equal(error.status, 500);
    }
  });

  it('never lets an original message reach the response body', () => {
    const leaky = postgrestError(
      'duplicate key value violates unique constraint "held_drafts_one_open_per_thread"',
    );
    const response = toHttpResponse(leaky);
    const serialized = JSON.stringify(response.body);

    for (const token of [
      'duplicate',
      'unique',
      'constraint',
      'held_drafts',
      'thread',
      'detail',
      'hint',
      'P0001',
    ]) {
      assert.equal(serialized.includes(token), false, token);
    }
    // R5B-04: an unrecognized PostgREST refusal gains a correlation id and nothing else — the
    // message is still dropped on the floor, as every token asserted above proves.
    assert.deepEqual(Object.keys(response.body).sort(), ['correlationId', 'error']);
    assert.equal(response.body.error, 'SUPPORT_UNAVAILABLE');
  });

  it('answers a language refusal with the code and the rule ids, and nothing else', () => {
    const error = new SupportMessageLanguageError(['LANGUAGE_C01', 'LANGUAGE_C21']);
    assert.equal(error.code, 'SUPPORT_MESSAGE_LANGUAGE');
    assert.equal(error.status, 422);
    assert.equal(toSupportError(error), error);

    const response = toHttpResponse(error);
    assert.equal(response.status, 422);
    assert.deepEqual(Object.keys(response.body).sort(), ['codes', 'error']);
    assert.deepEqual(response.body, {
      codes: ['LANGUAGE_C01', 'LANGUAGE_C21'],
      error: 'SUPPORT_MESSAGE_LANGUAGE',
    });
    assert.ok(Object.isFrozen(error.codes), 'the rule list is not a mutable copy');
  });

  it('answers with exactly one key and nothing else', () => {
    for (const code of SUPPORT_ERROR_CODES) {
      const response = toHttpResponse(new SupportError(code));
      assert.deepEqual(Object.keys(response.body), ['error']);
      assert.equal(response.body.error, code);
      assert.equal(response.status, supportErrorStatus(code));
    }
  });

  it('gives a SupportError no message beyond its own code', () => {
    for (const code of SUPPORT_ERROR_CODES) {
      assert.equal(new SupportError(code).message, code);
    }
  });

  it('keeps every status inside the codes the routes can answer with', () => {
    for (const code of SUPPORT_ERROR_CODES) {
      assert.ok([400, 401, 403, 404, 409, 422, 500, 503].includes(supportErrorStatus(code)), code);
    }
  });
});
