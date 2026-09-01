// web/src/lib/crs/constants.test.ts — pins the CRS constants other plans' behaviour depends on.
//
// The point is not that these numbers are interesting; it is that a later edit to a TTL or an
// event-type list fails here loudly instead of silently changing a token lifetime or making the
// receiver drop an event type it no longer recognises. The active monitoring contract is derived
// from the CRS client spec catalog dated 2026-08-27.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as constants from './constants.ts';
import { CRS_SPEC_WEBHOOK_EVENT_TYPES } from './spec-catalog.ts';
import {
  CRS_BUREAU_CODES,
  CRS_PREAUTH_TOKEN_TTL_SECONDS,
  CRS_REPORT_CODE_BY_BUREAU,
  CRS_USER_SESSION_TOKEN_TTL_SECONDS,
  CRS_WEBHOOK_BASIC_PASSWORD_MAX_LENGTH,
  CRS_WEBHOOK_EVENT_TYPES,
} from './constants.ts';

describe('CRS token validity times', () => {
  it('pins the preauth token TTL at 30 seconds', () => {
    assert.equal(CRS_PREAUTH_TOKEN_TTL_SECONDS, 30);
  });

  it('pins the user session token TTL at 15 minutes', () => {
    assert.equal(CRS_USER_SESSION_TOKEN_TTL_SECONDS, 900);
  });
});

describe('CRS bureaus and report codes', () => {
  it('lists exactly the three bureaus in published order', () => {
    assert.deepEqual([...CRS_BUREAU_CODES], ['EQF', 'EXP', 'TUC']);
  });

  it('maps each bureau to its JSON report code', () => {
    assert.deepEqual({ ...CRS_REPORT_CODE_BY_BUREAU }, {
      EQF: 'EQF1001',
      EXP: 'EXP1001',
      TUC: 'TUC3002',
    });
  });
});

describe('CRS webhook constants', () => {
  it('carries the complete dated spec catalog in order', () => {
    assert.deepEqual([...CRS_WEBHOOK_EVENT_TYPES], [...CRS_SPEC_WEBHOOK_EVENT_TYPES]);
  });

  it('caps the Basic-auth endpoint password at 15 characters', () => {
    assert.equal(CRS_WEBHOOK_BASIC_PASSWORD_MAX_LENGTH, 15);
  });
});

describe('no default base URL was smuggled in', () => {
  it('exports no BASE_URL-named string, because environment selects the dated dev or production host', () => {
    // `CRS_BASE_URL` is required from env with no fallback, so production cannot inherit the
    // development API host and development cannot drift onto production.
    const offenders = Object.entries(constants).filter(
      ([name, value]) => name.includes('BASE_URL') && typeof value === 'string',
    );
    assert.deepEqual(offenders, []);
  });

  it('holds no http:// literal anywhere in its exported values', () => {
    const insecure = (Object.values(constants) as unknown[])
      .filter((value): value is string => typeof value === 'string')
      .filter((value) => value.startsWith('http://'));
    assert.deepEqual(insecure, []);
  });
});
