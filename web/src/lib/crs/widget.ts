// web/src/lib/crs/widget.ts — where the bureau's monitoring widget is embedded from.
//
// VERIFIED against the CRS client spec, "Widget › Embed the widget", fetched 2026-09-05 from
// https://crsintegration.redocly.app/client-spec/widget/embed-the-widget. Three facts from that
// page drive everything below.
//
// 1. The widget is an IFRAME, never a script tag. The page publishes exactly two widget hosts —
//    production `https://wgt.stitchcredit.com` and development `https://efx-dev.stitchcredit.com`
//    — and both already live in `spec-catalog.ts`, so this module derives its hosts from there
//    rather than repeating the literals.
//
// 2. Under the Direct API integration model — the one we are on, because our server creates the
//    member through `/direct/user-reg` and mints preauth tokens itself — THE TOKEN IS NOT IN THE
//    URL. The iframe loads "hung" at a bare entry point, posts `INIT_CONFIG` to the parent, and
//    the parent replies with `WIDGET_CONFIGS`; the widget then posts `AUTH_REQUIRED` and the
//    parent replies with a `PREAUTH` message carrying the token. So `buildCrsWidgetUrl` takes no
//    token and there is a test asserting the built URL has no query string at all. A token in the
//    `src` attribute would sit in browser history, in the referrer chain and in every proxy log on
//    the path, and the widget would ignore it anyway.
//
//    The spec does publish a query-parameter form, but it is for the STANDALONE components
//    (`/score`, `/report`, `/monitor`, …) and its `standAloneToken` parameter is a *user access
//    token*, the thing you get from `GET /users/preauth-token/{preauthToken}` — not the preauth
//    token `GET /api/monitoring/token` returns. We do not mint user access tokens in the browser's
//    direction, so that form is not available to us and is deliberately not implemented here.
//
// 3. The `redirectView` the parent sends in `WIDGET_CONFIGS` has to agree with the entry path the
//    iframe loaded, so the two are kept in one table below instead of in two places that can drift.
//
// Nothing here reads `process.env` directly; every environment-dependent answer is a pure function
// of an `env` argument, so the whole matrix is drivable from literal objects in `widget.test.ts`.
// Nothing here logs, and no consumer identifier or token is ever an input to any of it.

import { CRS_SPEC_HOSTS } from './spec-catalog.ts';

/** The layout the widget renders after authentication. The key is the `redirectView` value. */
export type CrsWidgetView = 'all-in-one' | 'dashboard' | 'tile-view';

/**
 * The three entry points, keyed by the `redirectView` string the parent must send back in
 * `WIDGET_CONFIGS`. Everything else — events, configuration, the token handshake — is identical
 * between them, so the choice is purely a layout one.
 */
export const CRS_WIDGET_ENTRY_PATHS: Readonly<Record<CrsWidgetView, string>> = {
  'all-in-one': '/login-aio',
  dashboard: '/login-direct',
  'tile-view': '/login-tile',
} as const;

/** The view we embed on the consumer's My Credit panel. */
export const CRS_WIDGET_DEFAULT_VIEW: CrsWidgetView = 'all-in-one';

type WidgetEnv = { CRS_BASE_URL?: string | undefined };

/**
 * Which widget host this deployment talks to.
 *
 * The rule is the one the task states and the spec supports: development when `CRS_BASE_URL` names
 * the development API host, production otherwise. The comparison is on ORIGIN, so the trailing
 * `/api`, a trailing slash or a deeper path all still match — a string equality check here would
 * quietly send a correctly-configured development deployment at the production widget.
 *
 * Every unclassifiable value — absent, blank, relative, malformed, or some third host entirely —
 * answers production. Production is the safe default because the development widget serves
 * development bureau data: a misconfiguration that fell through to development would render
 * synthetic scores to a real consumer as if they were theirs. The return value is always one of
 * the two hosts the spec publishes and never anything derived from the input.
 */
export function resolveCrsWidgetOrigin(env: WidgetEnv): string {
  const configured = env.CRS_BASE_URL?.trim();
  if (!configured) return CRS_SPEC_HOSTS.production.widget;

  let origin: string;
  try {
    origin = new URL(configured).origin;
  } catch {
    return CRS_SPEC_HOSTS.production.widget;
  }

  return origin === new URL(CRS_SPEC_HOSTS.development.api).origin
    ? CRS_SPEC_HOSTS.development.widget
    : CRS_SPEC_HOSTS.production.widget;
}

/**
 * The `src` for the widget iframe. No token, no member handle, no client id, no query string —
 * see fact 2 in the file header, and `widget.test.ts` asserts the absence rather than trusting it.
 */
export function buildCrsWidgetUrl(input: { env: WidgetEnv; view?: CrsWidgetView }): string {
  const view = input.view ?? CRS_WIDGET_DEFAULT_VIEW;
  return `${resolveCrsWidgetOrigin(input.env)}${CRS_WIDGET_ENTRY_PATHS[view]}`;
}
