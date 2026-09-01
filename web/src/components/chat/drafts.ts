/**
 * Per-thread composer drafts, kept in `localStorage`.
 *
 * The behaviour this buys is small and the absence of it is infuriating: switching threads to
 * check something and coming back to an empty box eats a half-written reply, every time, and the
 * person who lost it has no way to know it was ever going to happen.
 *
 * Three constraints shaped the implementation.
 *
 * A draft is not a message. It never leaves the browser, it is not synced, and it is cleared the
 * moment a send succeeds — so it cannot become a shadow copy of something a person thought they
 * had sent.
 *
 * Every access is wrapped. `localStorage` throws rather than returning null in a Safari private
 * window and under some enterprise policies, and a composer that cannot render because storage is
 * disabled is a worse outcome than a composer that forgets.
 *
 * And the key is namespaced and hashed. A thread's opaque handle is not something to leave sitting
 * in a storage key that anything on the origin can enumerate, so what is stored is a short digest
 * of it. That also keeps the key a fixed length whatever the caller passes.
 */

const PREFIX = "mf.chat.draft.";
/** Not security. A stable short key from an opaque handle, so nothing enumerable is left lying around. */
function digest(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function draftKey(threadRef: string): string {
  return `${PREFIX}${digest(threadRef)}`;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const store = window.localStorage;
    // Touch it: the throw happens on access, not on the property read.
    const probe = `${PREFIX}probe`;
    store.setItem(probe, "1");
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

export function readDraft(threadRef: string): string {
  try {
    return storage()?.getItem(draftKey(threadRef)) ?? "";
  } catch {
    return "";
  }
}

/** Writing an empty draft clears it, so an emptied composer does not leave a row behind. */
export function writeDraft(threadRef: string, value: string): void {
  try {
    const store = storage();
    if (store === null) return;
    if (value.trim() === "") store.removeItem(draftKey(threadRef));
    else store.setItem(draftKey(threadRef), value);
  } catch {
    // A full or disabled store is not a reason to break the composer.
  }
}

export function clearDraft(threadRef: string): void {
  writeDraft(threadRef, "");
}

/**
 * `useSyncExternalStore` needs a subscribe function, and there is nothing to subscribe to.
 *
 * A draft is written by exactly one composer, in one tab, and nothing else in the app reads it.
 * The store is used anyway because it is the one hook that reads browser-only state without a
 * hydration mismatch and without a `setState` inside an effect: the server snapshot is the empty
 * string, the client snapshot is what is stored, and React reconciles the two itself. The repo
 * already uses this shape — `subscribeToNothing` in both surface files — for the same reason.
 */
export function subscribeToDraftStore(): () => void {
  return () => {};
}

/** The server never has a draft. Declared rather than inlined so the intent is legible. */
export function serverDraftSnapshot(): string {
  return "";
}
