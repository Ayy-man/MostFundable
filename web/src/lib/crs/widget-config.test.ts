// web/src/lib/crs/widget-config.test.ts — the embed config the browser is handed.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CRS_SPEC_HOSTS } from './spec-catalog.ts';
import { CRS_WIDGET_DEFAULT_FLAGS, buildCrsWidgetEmbedConfig } from './widget-config.ts';

const DEV_API = CRS_SPEC_HOSTS.development.api;
const HOST_KEY = 'e4f403ca-e089-40ff-a840-88f7bb4fe949';

describe('buildCrsWidgetEmbedConfig', () => {
  it('answers null when no host key is configured, so nothing renders', () => {
    for (const CRS_WIDGET_HOST_KEY of [undefined, '', '   ']) {
      assert.equal(buildCrsWidgetEmbedConfig({ CRS_BASE_URL: DEV_API, CRS_WIDGET_HOST_KEY }), null);
    }
  });

  it('builds the development entry point and origin from CRS_BASE_URL', () => {
    assert.deepEqual(
      buildCrsWidgetEmbedConfig({ CRS_BASE_URL: DEV_API, CRS_WIDGET_HOST_KEY: HOST_KEY }),
      {
        widgetUrl: `${CRS_SPEC_HOSTS.development.widget}/login-aio`,
        widgetOrigin: CRS_SPEC_HOSTS.development.widget,
        hostKey: HOST_KEY,
        flags: CRS_WIDGET_DEFAULT_FLAGS,
        redirectView: 'all-in-one',
      },
    );
  });

  it('keeps the redirectView in agreement with the entry path it built', () => {
    const config = buildCrsWidgetEmbedConfig({ CRS_WIDGET_HOST_KEY: HOST_KEY });
    assert.ok(config !== null);
    assert.equal(config.redirectView, 'all-in-one');
    assert.ok(config.widgetUrl.endsWith('/login-aio'));
    assert.ok(config.widgetUrl.startsWith(config.widgetOrigin));
  });

  it('defaults flags to the provider default rather than the spec example bitmask', () => {
    assert.equal(CRS_WIDGET_DEFAULT_FLAGS, '0');
    const config = buildCrsWidgetEmbedConfig({ CRS_WIDGET_HOST_KEY: HOST_KEY, CRS_WIDGET_FLAGS: '  ' });
    assert.equal(config?.flags, '0');
  });

  it('honours a configured flags bitmask', () => {
    const config = buildCrsWidgetEmbedConfig({ CRS_WIDGET_HOST_KEY: HOST_KEY, CRS_WIDGET_FLAGS: '1029' });
    assert.equal(config?.flags, '1029');
  });

  it('trims the host key so a stray newline in an env file does not reach the widget', () => {
    const config = buildCrsWidgetEmbedConfig({ CRS_WIDGET_HOST_KEY: `\n${HOST_KEY} ` });
    assert.equal(config?.hostKey, HOST_KEY);
  });

  it('carries no token field of any kind', () => {
    const config = buildCrsWidgetEmbedConfig({ CRS_WIDGET_HOST_KEY: HOST_KEY });
    assert.ok(config !== null);
    for (const key of Object.keys(config)) {
      assert.ok(!key.toLowerCase().includes('token'), key);
    }
  });
});
