// web/src/lib/crs/widget-config.ts — what the browser needs before it can embed the widget.
//
// The widget's Direct API model needs two things from our side that the preauth token endpoint
// deliberately does not carry: the host to load the iframe from, and the `WIDGET_CONFIGS` payload
// the parent sends in reply to `INIT_CONFIG`. `token.ts` documents that its 200 body is exactly
// three fields and that nothing may be added to it, so this travels on its own small route
// instead — the same shape `/api/billing/config` and `/api/trainings/config` already use.
//
// Nothing here is a secret. The customer host key is a public identifier by construction: the
// spec's own Server Start embed puts it in an iframe `src` (`/api/users/start?key={hostKey}`), so
// every integrator's markup carries it. It is still served only to a signed-in consumer, because
// there is no reason to publish our account's identifier to anonymous callers.
//
// Nothing here reads `process.env` directly and nothing logs.

import {
  CRS_WIDGET_DEFAULT_VIEW,
  buildCrsWidgetUrl,
  resolveCrsWidgetOrigin,
  type CrsWidgetView,
} from './widget.ts';

/**
 * The `WIDGET_CONFIGS` fields we set, plus where to load the frame from. Field names and defaults
 * are the ones the client spec's PostMessage reference publishes (fetched 2026-09-05).
 */
export interface CrsWidgetEmbedConfig {
  /** The iframe `src`. No token, no query string — see `widget.ts`. */
  widgetUrl: string;
  /** The exact origin to `postMessage` to, and the only origin whose messages we act on. */
  widgetOrigin: string;
  /** `key` — our customer host key (UUID). */
  hostKey: string;
  /** `flags` — the feature bitmask deciding which UI sections render. */
  flags: string;
  /** `redirectView` — must agree with the entry path `widgetUrl` loaded. */
  redirectView: CrsWidgetView;
}

type WidgetConfigEnv = { readonly [key: string]: string | undefined };

/**
 * The spec publishes `flags` as a bitmask string defaulting to `'0'` and does NOT publish what the
 * individual bits mean — its worked example passes `'65535'`, every bit set. We do not adopt that
 * example as a default. This repository forbids the Score Up and Optimal Path endpoints outright
 * (`CRS_FORBIDDEN_SCORE_PROJECTION_ENDPOINTS`), and a bitmask whose bits nobody here can name
 * could switch those sections on inside the frame where no server-side gate of ours applies. So
 * the value stays the provider's documented default until somebody configures a mask they can
 * account for bit by bit, through `CRS_WIDGET_FLAGS`.
 *
 * UNVERIFIED: the bit meanings. CRS publishes no feature-flags table on the client spec.
 */
export const CRS_WIDGET_DEFAULT_FLAGS = '0';

/**
 * Build the embed config, or answer `null` when this deployment is not configured to embed.
 *
 * `null` is the "render nothing, leave the existing panel alone" answer, and the only thing that
 * produces it is a missing host key. Without a host key the widget's `WIDGET_CONFIGS` reply is
 * incomplete and the frame hangs at a blank screen forever, so an unconfigured deployment showing
 * no widget at all is strictly better than one showing a dead iframe above a working panel.
 */
export function buildCrsWidgetEmbedConfig(env: WidgetConfigEnv): CrsWidgetEmbedConfig | null {
  const hostKey = env.CRS_WIDGET_HOST_KEY?.trim();
  if (!hostKey) return null;

  return {
    widgetUrl: buildCrsWidgetUrl({ env, view: CRS_WIDGET_DEFAULT_VIEW }),
    widgetOrigin: resolveCrsWidgetOrigin(env),
    hostKey,
    flags: env.CRS_WIDGET_FLAGS?.trim() || CRS_WIDGET_DEFAULT_FLAGS,
    redirectView: CRS_WIDGET_DEFAULT_VIEW,
  };
}
