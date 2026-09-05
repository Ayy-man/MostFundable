// web/src/lib/crs/widget-refresh.test.ts — when the browser goes back for a fresh preauth token.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CRS_PREAUTH_REFRESH_LEAD_MS,
  CRS_PREAUTH_REFRESH_MIN_DELAY_MS,
  nextPreauthRefreshDelayMs,
} from './widget-refresh.ts';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

describe('nextPreauthRefreshDelayMs', () => {
  it('schedules the lead time before expiry', () => {
    const delay = nextPreauthRefreshDelayMs({ expiresAt: at(30_000) }, NOW);
    assert.equal(delay, 30_000 - CRS_PREAUTH_REFRESH_LEAD_MS);
  });

  it('never schedules in the past for a token that has already expired', () => {
    for (const offset of [0, -1, -60_000]) {
      assert.equal(
        nextPreauthRefreshDelayMs({ expiresAt: at(offset) }, NOW),
        CRS_PREAUTH_REFRESH_MIN_DELAY_MS,
        String(offset),
      );
    }
  });

  it('floors at the minimum delay rather than busy-looping the endpoint', () => {
    const delay = nextPreauthRefreshDelayMs({ expiresAt: at(CRS_PREAUTH_REFRESH_LEAD_MS + 1) }, NOW);
    assert.equal(delay, CRS_PREAUTH_REFRESH_MIN_DELAY_MS);
  });

  it('treats an unparseable expiry as immediate rather than as never', () => {
    assert.equal(
      nextPreauthRefreshDelayMs({ expiresAt: 'not-a-timestamp' }, NOW),
      CRS_PREAUTH_REFRESH_MIN_DELAY_MS,
    );
  });

  it('leaves a usable margin on the spec 30-second preauth lifetime', () => {
    const delay = nextPreauthRefreshDelayMs({ expiresAt: at(30_000) }, NOW);
    assert.ok(delay > 0 && delay < 30_000, String(delay));
  });

  it('is monotonic in the remaining lifetime', () => {
    const shorter = nextPreauthRefreshDelayMs({ expiresAt: at(20_000) }, NOW);
    const longer = nextPreauthRefreshDelayMs({ expiresAt: at(40_000) }, NOW);
    assert.ok(longer > shorter);
  });
});
