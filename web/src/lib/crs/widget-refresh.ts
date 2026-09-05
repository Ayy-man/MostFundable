// web/src/lib/crs/widget-refresh.ts — the one place that decides when to go back for a token.
//
// A preauth token lives 30 seconds and is single use, so "shortly before expiresAt" is a small
// number and getting it wrong in either direction is visible: too late and the widget authenticates
// with a dead token, too eager and the browser hammers an endpoint that mints against the provider.
// The arithmetic is here, as a pure function of an injected clock, so both boundaries are asserted
// in `widget-refresh.test.ts` instead of being inferred from a `setTimeout` inside a component.
//
// This takes an `expiresAt` string and nothing else. It never sees the token itself.

/** How far ahead of expiry to fetch the next token. Enough for a round trip on a slow connection. */
export const CRS_PREAUTH_REFRESH_LEAD_MS = 8_000;

/** The floor. A token that is expired, nearly expired or malformed is refetched soon, not instantly. */
export const CRS_PREAUTH_REFRESH_MIN_DELAY_MS = 1_000;

/**
 * Milliseconds until the browser should fetch the next preauth token.
 *
 * An `expiresAt` that does not parse answers the floor rather than `NaN` or `Infinity`: the same
 * rule `isPreauthTokenExpired` follows, where a malformed timestamp reads as unusable-now, because
 * the failure mode of the other reading is a widget that waits forever for a refresh that never
 * comes and gives no sign of why.
 */
export function nextPreauthRefreshDelayMs(token: { expiresAt: string }, now: Date): number {
  const expiresAtMs = Date.parse(token.expiresAt);
  if (Number.isNaN(expiresAtMs)) return CRS_PREAUTH_REFRESH_MIN_DELAY_MS;

  const lead = expiresAtMs - now.getTime() - CRS_PREAUTH_REFRESH_LEAD_MS;
  return Math.max(CRS_PREAUTH_REFRESH_MIN_DELAY_MS, lead);
}
