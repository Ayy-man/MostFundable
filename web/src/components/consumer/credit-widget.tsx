"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { nextPreauthRefreshDelayMs } from "@/lib/crs/widget-refresh";
import type { CrsWidgetEmbedConfig } from "@/lib/crs/widget-config";

/**
 * The bureau's monitoring widget, embedded above the durable credit reading.
 *
 * How the embed works, from the CRS client spec's "Widget › Embed the widget" page (fetched
 * 2026-09-05): under the Direct API integration model the iframe loads a bare entry point and then
 * hangs, waiting for two `postMessage` replies from this page. It posts `INIT_CONFIG` and we answer
 * `WIDGET_CONFIGS`; it posts `AUTH_REQUIRED` and we answer `PREAUTH` carrying a 30-second preauth
 * token, which it exchanges for a user access token internally. The token is NEVER a query
 * parameter in this model — the spec's only token-in-URL form is `standAloneToken` on the
 * standalone components, and that parameter wants a user access token, which is not what
 * `GET /api/monitoring/token` mints.
 *
 * What this component may and may not do with the token:
 *
 * - It lives in a ref, never in state. State is a render snapshot, and a render snapshot is a thing
 *   React devtools shows and an error boundary can serialise.
 * - It is never interpolated into JSX, never appended to a URL and never passed to a logger. There
 *   is no `console` call in this file at all, which `credit-widget.test.ts` asserts against the
 *   source text — the surest way not to leak a secret in a log line is to own no statement that
 *   could write one.
 * - It is posted to exactly one origin, the widget origin the server named, never to `'*'`.
 *
 * The three answers the token endpoint can give map straight onto what the consumer sees. 404 —
 * the analysis flag is off, or this consumer has not enrolled — renders nothing at all, so the
 * existing `/api/monitoring/reading` panel below stands alone exactly as it did before. 502 renders
 * one line saying live data is unavailable, above that same panel. 200 renders the frame.
 */
export function ConsumerCreditWidget(): React.JSX.Element | null {
  const [config, setConfig] = useState<CrsWidgetEmbedConfig | null>(null);
  const [state, setState] = useState<"loading" | "absent" | "ready" | "unavailable">("loading");

  // The live preauth token, and the timer that replaces it. Refs, not state: neither should cause
  // a render, and the token must not appear in one.
  const tokenRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const mountedRef = useRef(true);

  // The refresh timer has to call the very function it is armed inside, and a `useCallback` cannot
  // name itself. The indirection is a ref synchronised in an effect below, which is also the only
  // arrangement that survives a re-render replacing the callback while a timer is already pending.
  const loadTokenRef = useRef<(() => Promise<string | null>) | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  /**
   * Fetch one preauth token and arm the timer for the next one.
   *
   * Returns the token to the caller so the `AUTH_REQUIRED` handler can post the very token it just
   * fetched rather than racing the ref. The status mapping is the endpoint's own: 404 means there
   * is nothing to embed and we quietly disappear, anything else that is not 200 is the unavailable
   * line. A network throw lands on the same unavailable line, because from the consumer's side a
   * failed fetch and a 502 are the same fact.
   */
  const loadToken = useCallback(async (): Promise<string | null> => {
    let response: Response;
    try {
      response = await fetch("/api/monitoring/token", {
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch {
      if (mountedRef.current) setState("unavailable");
      return null;
    }

    if (response.status === 404) {
      if (mountedRef.current) setState("absent");
      return null;
    }
    if (!response.ok) {
      if (mountedRef.current) setState("unavailable");
      return null;
    }

    const body = await response.json().catch(() => null) as
      | { token?: unknown; expiresAt?: unknown }
      | null;
    if (
      body === null
      || typeof body.token !== "string" || body.token.length === 0
      || typeof body.expiresAt !== "string"
    ) {
      if (mountedRef.current) setState("unavailable");
      return null;
    }

    tokenRef.current = body.token;
    if (!mountedRef.current) return body.token;
    setState("ready");

    // Re-arm before this one dies. The delay is computed by a tested pure function so the two
    // boundaries that matter — an already-expired token and a malformed timestamp — are decided in
    // one place rather than by arithmetic buried in a `setTimeout` argument.
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void loadTokenRef.current?.();
    }, nextPreauthRefreshDelayMs({ expiresAt: body.expiresAt }, new Date()));

    return body.token;
  }, []);

  useEffect(() => {
    loadTokenRef.current = loadToken;
  }, [loadToken]);

  // Where to load the frame from, and the config payload it will ask for. 404 here — flag off, or
  // no host key configured — is the same "render nothing" answer as an unenrolled consumer.
  useEffect(() => {
    let active = true;
    void (async () => {
      let response: Response;
      try {
        response = await fetch("/api/monitoring/widget", {
          cache: "no-store",
          credentials: "same-origin",
        });
      } catch {
        if (active) setState("absent");
        return;
      }
      if (!response.ok) {
        if (active) setState("absent");
        return;
      }
      const body = await response.json().catch(() => null) as CrsWidgetEmbedConfig | null;
      if (!active) return;
      if (body === null || typeof body.widgetUrl !== "string" || typeof body.widgetOrigin !== "string") {
        setState("absent");
        return;
      }
      setConfig(body);
      void loadToken();
    })();
    return () => { active = false; };
  }, [loadToken]);

  // The handshake. Every message is checked twice before it is acted on: it must come from the
  // widget origin the server named, and from this exact frame's window. Either check alone leaves a
  // hole — any other frame on the page can claim an origin it does not have only if the browser is
  // broken, but a second widget-origin frame added later would otherwise drive this one's token.
  useEffect(() => {
    if (config === null) return;

    function onMessage(event: MessageEvent): void {
      if (config === null) return;
      if (event.origin !== config.widgetOrigin) return;
      const frameWindow = frameRef.current?.contentWindow ?? null;
      if (frameWindow === null || event.source !== frameWindow) return;

      const type = (event.data as { type?: unknown } | null)?.type;

      if (type === "INIT_CONFIG") {
        frameWindow.postMessage({
          type: "WIDGET_CONFIGS",
          data: {
            key: config.hostKey,
            flags: config.flags,
            redirectView: config.redirectView,
            popupModeForms: false,
            hideBackgroundImg: true,
            hideHeaderLogo: true,
          },
        }, config.widgetOrigin);
        return;
      }

      if (type === "AUTH_REQUIRED") {
        // Preauth tokens are single use, so the one held in the ref may already have been spent by
        // an earlier `AUTH_REQUIRED`. Take it, clear it, and fetch a replacement when it is gone.
        // The spec's own example answers `{ token: null }` on failure, which is what tells the
        // widget to stop waiting instead of hanging on a blank screen.
        const held = tokenRef.current;
        tokenRef.current = null;
        void (async () => {
          const value = held ?? await loadToken();
          const target = frameRef.current?.contentWindow;
          if (!target) return;
          target.postMessage({ type: "PREAUTH", token: value }, config.widgetOrigin);
        })();
        return;
      }

      if (type === "SERVICE_FAILURE") {
        setState("unavailable");
      }
    }

    window.addEventListener("message", onMessage, false);
    return () => { window.removeEventListener("message", onMessage, false); };
  }, [config, loadToken]);

  if (state === "loading" || state === "absent") return null;

  if (state === "unavailable" || config === null) {
    return (
      <p className="mb-4 text-[0.86rem] text-muted-foreground" role="status">
        Live credit data is unavailable right now.
      </p>
    );
  }

  return (
    <div className="mb-4 overflow-hidden rounded-[12px] border border-[var(--consumer-border)] bg-card shadow-[var(--consumer-surface-shadow)]">
      <iframe
        allowTransparency
        className="block h-[42rem] w-full border-0"
        ref={frameRef}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        src={config.widgetUrl}
        title="Live credit monitoring"
      />
    </div>
  );
}
