import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TRACKER_STAGES } from "@/lib/tracker/types";

import { clientsNavBadge, durableClientCount } from "./nav-badges";

// The counts below are never written down. `TRACKER_STAGES` supplies the size
// of the book so that the expected badge is whatever the read actually holds —
// the literal `4` in `navSections` is the exact rot this guards against, and a
// test that asserted `6` would rot the same way the moment the seed changed.
function bookOf(size: number) {
  return Array.from({ length: size }, (_, index) => ({ id: `client-${index}` }));
}

const wholeBook = bookOf(TRACKER_STAGES.length);

describe("operator sidebar client count", () => {
  it("counts the durable book only once a completed read holds it", () => {
    assert.equal(
      durableClientCount({
        clients: wholeBook,
        enabled: true,
        error: false,
        loading: false,
      }),
      wholeBook.length,
    );
  });

  it("has no count while the read is in flight, failed, or off", () => {
    for (const read of [
      { clients: wholeBook, enabled: true, error: false, loading: true },
      { clients: wholeBook, enabled: true, error: true, loading: false },
      { clients: [], enabled: null, error: false, loading: false },
      { clients: [], enabled: false, error: false, loading: false },
    ]) {
      assert.equal(durableClientCount(read), null);
    }
  });

  it("never reports zero from the hook's inactive state", () => {
    // The hook resets to `enabled: null` with an empty list whenever the
    // tracker is not the active view. Counting that would put a confident 0 on
    // the badge from every other page.
    const inactive = { clients: [], enabled: null, error: false, loading: false };
    assert.equal(durableClientCount(inactive), null);
    assert.equal(
      clientsNavBadge({
        fixtureCount: wholeBook.length,
        lastDurableCount: durableClientCount(inactive),
        trackerEnabled: true,
      }),
      undefined,
    );
  });

  it("shows the durable count, not the fixture count, when the tracker is on", () => {
    const fixtureCount = wholeBook.length + 2;
    assert.equal(
      clientsNavBadge({
        fixtureCount,
        lastDurableCount: durableClientCount({
          clients: wholeBook,
          enabled: true,
          error: false,
          loading: false,
        }),
        trackerEnabled: true,
      }),
      wholeBook.length,
    );
  });

  it("falls back to the fixture book only when the tracker is off", () => {
    const fixtureCount = wholeBook.length + 2;
    assert.equal(
      clientsNavBadge({
        fixtureCount,
        lastDurableCount: null,
        trackerEnabled: false,
      }),
      fixtureCount,
    );
  });
});
