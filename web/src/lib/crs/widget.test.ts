// web/src/lib/crs/widget.test.ts — the widget embed URL, pinned against the client spec.
//
// The one assertion that matters most here is the negative one: no preauth token, and nothing
// else consumer-identifying, ever appears in the URL. The Direct API integration model hands the
// token to the widget over `postMessage` in reply to `AUTH_REQUIRED`, so a token in the `src`
// attribute would be a token in the browser history, in the referrer chain and in any proxy log
// on the path — for no benefit, since the widget does not read one from there.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CRS_SPEC_HOSTS } from './spec-catalog.ts';
import {
  CRS_WIDGET_ENTRY_PATHS,
  buildCrsWidgetUrl,
  resolveCrsWidgetOrigin,
} from './widget.ts';

const DEV_API = CRS_SPEC_HOSTS.development.api;
const DEV_WIDGET = CRS_SPEC_HOSTS.development.widget;
const PROD_WIDGET = CRS_SPEC_HOSTS.production.widget;

describe('resolveCrsWidgetOrigin', () => {
  it('picks the development widget host when CRS_BASE_URL is the development API host', () => {
    assert.equal(resolveCrsWidgetOrigin({ CRS_BASE_URL: DEV_API }), DEV_WIDGET);
  });

  it('matches the development host by origin, not by the exact string', () => {
    for (const value of [`${DEV_API}/`, `${DEV_API}/direct/login`, new URL(DEV_API).origin]) {
      assert.equal(resolveCrsWidgetOrigin({ CRS_BASE_URL: value }), DEV_WIDGET, value);
    }
  });

  it('picks production for the production API host', () => {
    assert.equal(resolveCrsWidgetOrigin({ CRS_BASE_URL: CRS_SPEC_HOSTS.production.api }), PROD_WIDGET);
  });

  it('picks production for an absent, blank or unparseable CRS_BASE_URL', () => {
    for (const CRS_BASE_URL of [undefined, '', '   ', 'not-a-url', '/api']) {
      assert.equal(resolveCrsWidgetOrigin({ CRS_BASE_URL }), PROD_WIDGET, String(CRS_BASE_URL));
    }
  });

  it('never returns a host outside the two the spec publishes', () => {
    const allowed = new Set([DEV_WIDGET, PROD_WIDGET]);
    for (const CRS_BASE_URL of [DEV_API, 'https://evil.example.com/api', undefined]) {
      assert.ok(allowed.has(resolveCrsWidgetOrigin({ CRS_BASE_URL })));
    }
  });
});

describe('CRS_WIDGET_ENTRY_PATHS', () => {
  it('pins the three entry points the client spec publishes', () => {
    assert.deepEqual({ ...CRS_WIDGET_ENTRY_PATHS }, {
      'all-in-one': '/login-aio',
      dashboard: '/login-direct',
      'tile-view': '/login-tile',
    });
  });
});

describe('buildCrsWidgetUrl', () => {
  it('defaults to the all-in-one entry point on the resolved host', () => {
    assert.equal(buildCrsWidgetUrl({ env: { CRS_BASE_URL: DEV_API } }), `${DEV_WIDGET}/login-aio`);
  });

  it('honours each published view', () => {
    for (const [view, path] of Object.entries(CRS_WIDGET_ENTRY_PATHS)) {
      assert.equal(
        buildCrsWidgetUrl({ env: { CRS_BASE_URL: DEV_API }, view: view as keyof typeof CRS_WIDGET_ENTRY_PATHS }),
        `${DEV_WIDGET}${path}`,
      );
    }
  });

  it('falls back to the production host when CRS_BASE_URL is unset', () => {
    assert.equal(buildCrsWidgetUrl({ env: {} }), `${PROD_WIDGET}/login-aio`);
  });

  it('carries no query string and no fragment at all', () => {
    const url = new URL(buildCrsWidgetUrl({ env: { CRS_BASE_URL: DEV_API } }));
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
  });

  it('is always https', () => {
    for (const CRS_BASE_URL of [DEV_API, undefined, 'http://efx-dev.stitchcredit.com/api']) {
      assert.equal(new URL(buildCrsWidgetUrl({ env: { CRS_BASE_URL } })).protocol, 'https:');
    }
  });

  it('is a pure function of its argument — the same env gives the same URL', () => {
    const env = { CRS_BASE_URL: DEV_API };
    assert.equal(buildCrsWidgetUrl({ env }), buildCrsWidgetUrl({ env }));
  });
});
