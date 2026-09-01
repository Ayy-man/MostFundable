// Draft persistence, driven against a real storage object and against a broken one.
//
// The broken one is the point. `localStorage` does not return null when it is unavailable — it
// throws, on access, in a Safari private window and under some enterprise policies — and a
// composer that cannot render because storage is disabled is a worse outcome than a composer that
// forgets. Every case below that ends in "does not throw" is that failure mode.
//
// Watched failing before it counted, one change at a time against this tree: removing the
// try/catch from `storage()` — the hostile-store case threw instead of returning ""; removing the
// empty-value branch from `writeDraft` — the clearing case left a row behind; returning the raw
// ref from `draftKey` — the key case failed.
//
// One honest gap, found by running these: removing `readDraft`'s own try/catch changes nothing,
// because `storage()` has already caught and returned null by then. It stays as defence for the
// case the probe cannot reach — a `getItem` that throws after a `setItem` succeeded, which is
// what a quota or policy change mid-session looks like — and no test here pins it.

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { clearDraft, draftKey, readDraft, writeDraft } from "./drafts.ts";

// Cast through `unknown` rather than intersecting with `typeof globalThis`: the DOM lib already
// declares `window` as present and non-optional, so an intersection cannot express the state this
// file spends most of its time in, which is a server with no window at all.
const target = globalThis as unknown as { window?: { localStorage: unknown } };

function useStore(store: unknown) {
  target.window = { localStorage: store };
}

function memoryStore() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    keys: () => [...map.keys()],
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

/** Throws on every operation, which is what a private window actually does. */
const hostileStore = {
  getItem() {
    throw new Error("storage disabled");
  },
  removeItem() {
    throw new Error("storage disabled");
  },
  setItem() {
    throw new Error("storage disabled");
  },
};

afterEach(() => {
  delete target.window;
});

describe("draft keys", () => {
  it("never puts the thread's own handle in the key", () => {
    // The handle is opaque and does not belong in a storage key that anything on the origin can
    // enumerate. Asserting against the handle itself rather than against a fixed expected string
    // means a change of digest still has to satisfy the property.
    const handle = "8f2c1d90-4a6b-4c31-9e02-77b1c4e0a3d5";
    const key = draftKey(handle);
    assert.equal(key.includes(handle), false, key);
    assert.ok(key.startsWith("mf.chat.draft."));
  });

  it("gives different threads different keys and one thread a stable key", () => {
    assert.notEqual(draftKey("thread-a"), draftKey("thread-b"));
    assert.equal(draftKey("thread-a"), draftKey("thread-a"));
  });
});

describe("with storage", () => {
  it("round-trips a draft per thread", () => {
    useStore(memoryStore());
    writeDraft("thread-a", "half a reply");
    writeDraft("thread-b", "something else");
    assert.equal(readDraft("thread-a"), "half a reply");
    assert.equal(readDraft("thread-b"), "something else");
  });

  it("returns an empty string for a thread nobody has written in", () => {
    useStore(memoryStore());
    assert.equal(readDraft("thread-untouched"), "");
  });

  it("removes the row rather than storing whitespace", () => {
    // An emptied composer must not leave a draft behind: the next read would restore blanks and
    // the row would sit in storage forever.
    const store = memoryStore();
    useStore(store);
    writeDraft("thread-a", "typed something");
    writeDraft("thread-a", "   ");
    assert.equal(readDraft("thread-a"), "");
    assert.equal(
      store.keys().some((key) => key === draftKey("thread-a")),
      false,
      "an emptied draft left a row behind",
    );
  });

  it("clears on demand", () => {
    useStore(memoryStore());
    writeDraft("thread-a", "sent this one");
    clearDraft("thread-a");
    assert.equal(readDraft("thread-a"), "");
  });
});

describe("without storage", () => {
  it("reads as empty and writes silently when every operation throws", () => {
    useStore(hostileStore);
    assert.equal(readDraft("thread-a"), "");
    assert.doesNotThrow(() => writeDraft("thread-a", "half a reply"));
    assert.doesNotThrow(() => clearDraft("thread-a"));
    assert.equal(readDraft("thread-a"), "");
  });

  it("reads as empty on the server, where there is no window at all", () => {
    delete target.window;
    assert.equal(readDraft("thread-a"), "");
    assert.doesNotThrow(() => writeDraft("thread-a", "half a reply"));
  });

  it("survives a store that accepts the probe and then refuses the write", () => {
    // The quota case: `setItem` works until it does not, and it throws when it does not.
    const map = new Map<string, string>();
    let probed = false;
    useStore({
      getItem: (key: string) => map.get(key) ?? null,
      removeItem: (key: string) => void map.delete(key),
      setItem: (key: string, value: string) => {
        if (!probed && key.endsWith("probe")) {
          probed = true;
          map.set(key, value);
          return;
        }
        throw new Error("quota exceeded");
      },
    });
    assert.doesNotThrow(() => writeDraft("thread-a", "half a reply"));
    assert.equal(readDraft("thread-a"), "");
  });
});
