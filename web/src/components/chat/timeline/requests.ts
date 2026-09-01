"use client";

// The two operator actions that change state from inside the thread.
//
// Both are the approved change orders: a document request lands as a band on both sides, and a
// review receipt is what turns "Not yet reviewed" into "Reviewed by Priya". Neither route exists on
// `main` yet — the backend lane owns `web/src/app/api/` — so both of these return `{ ok: false }`
// until it merges, and the band simply does not render an action whose handler a surface has not
// supplied. That is the honest failure mode: no control that can only fail.
//
// Written the way `lib/operator/support-inbox.client.ts` writes the same thing, and for its reasons:
// the fetcher is a parameter so nothing in here can call anything on its own, there is no timer, no
// retry and no queue, and the body carries only what the caller decided. A request nobody pressed is
// a message nobody sent, and this is the module where that would go wrong.

/** What either call reports. `code` is the route's own reason, when it gave one. */
export interface TimelineRequestResult {
  readonly ok: boolean;
  readonly code?: string;
}

async function post(
  path: string,
  body: Record<string, string>,
  fetcher: typeof fetch,
): Promise<TimelineRequestResult> {
  try {
    const response = await fetcher(path, {
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!response.ok) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Ask the client for a document.
 *
 * `why` is required by the shape rather than by a validator: a request with no reason on it is the
 * one the client reads as an unexplained demand, and the band has a sentence to print either way.
 */
export function requestDocument(
  input: { readonly threadId: string; readonly name: string; readonly why: string },
  fetcher: typeof fetch = fetch,
): Promise<TimelineRequestResult> {
  return post(
    "/api/uploads/requests",
    { name: input.name, threadId: input.threadId, why: input.why },
    fetcher,
  );
}

/** Record that a person on the team has looked at a filed document. */
export function reviewDocument(
  documentId: string,
  fetcher: typeof fetch = fetch,
): Promise<TimelineRequestResult> {
  return post(`/api/uploads/${encodeURIComponent(documentId)}/review`, {}, fetcher);
}
