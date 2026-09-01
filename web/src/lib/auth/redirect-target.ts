import "server-only";

/**
 * An unvalidated `next=` parameter is an open redirect. Accept only a relative
 * path beginning with a single `/`: anything starting `//` is a
 * protocol-relative URL to another host, and anything carrying a scheme or a
 * backslash is either an absolute URL or a browser-normalisation trick. When
 * the value fails, the caller falls back to the signed-in role's home path.
 */
export function safeNextPath(candidate: string | null): string | null {
  if (candidate === null) {
    return null;
  }

  const value = candidate.trim();

  if (!value.startsWith("/")) {
    return null;
  }

  if (value.startsWith("//")) {
    return null;
  }

  if (value.includes("\\")) {
    return null;
  }

  // A scheme cannot appear in a path-only value; ":" before the first "/" or
  // "?" is the shape "javascript:" and "https:" both take.
  if (/^\/[^/?#]*:/.test(value)) {
    return null;
  }

  return value;
}

/**
 * A redirect whose `Location` stays a relative path.
 *
 * `NextResponse.redirect()` needs an absolute URL, and the obvious way to build
 * one is `new URL(path, request.nextUrl)` — which is wrong behind a proxy.
 * Measured on this stack with `next start -p 3012`: `request.nextUrl` reports
 * `http://localhost:3012` no matter what `Host` the caller sent, and Next 16
 * honours `x-forwarded-proto` but ignores `x-forwarded-host`, so the scheme
 * follows the proxy while the host does not. Every absolute redirect built that
 * way would send the browser to the origin's internal name rather than the one
 * the user typed.
 *
 * A relative `Location` is legal (RFC 9110 section 10.2.2) and the browser
 * resolves it against the request URL, so the question never arises. Callers
 * must pass a path that already went through `safeNextPath` or is a literal
 * from the role map — this function does not re-validate.
 */
export function sameOriginRedirect(path: string, status = 303): Response {
  return new Response(null, { headers: { Location: path }, status });
}
