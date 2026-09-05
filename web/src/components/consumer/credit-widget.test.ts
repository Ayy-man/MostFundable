// web/src/components/consumer/credit-widget.test.ts — the guards a rendering test cannot give.
//
// There is no DOM in this runner, so the component's behaviour is pinned two ways: its timing and
// URL arithmetic live in tested pure modules under `src/lib/crs/`, and the properties that are
// really about what the source may CONTAIN — no token in the markup, no token in a log line, the
// sandbox attributes present — are asserted against the source text here, the same way
// `trainings-view.test.ts` does. A component cannot log a token it has no statement to log it with.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/testing/strip-comments";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(HERE, "credit-widget.tsx");
const SOURCE = stripComments(fs.readFileSync(SOURCE_PATH, "utf8"));

describe("the credit widget source", () => {
  it("exists and is a client component", () => {
    assert.ok(SOURCE.trimStart().startsWith('"use client"'));
  });

  it("never logs anything at all", () => {
    for (const sink of ["console.", "recordRouteFailure", "reportError("]) {
      assert.ok(!SOURCE.includes(sink), sink);
    }
  });

  it("keeps the token out of React state and out of the markup", () => {
    // The token lives in a ref. `useState` on it would put it in a render snapshot, and any JSX
    // interpolation of it would put it on the screen and in the accessibility tree.
    assert.ok(!/useState[^\n]*token/i.test(SOURCE));
    assert.ok(!/\{[^{}\n]*\btoken\b[^{}\n]*\}\s*</i.test(SOURCE));
  });

  it("never puts the token in the iframe URL", () => {
    assert.ok(!/src=\{[^}]*token/i.test(SOURCE));
    assert.ok(!SOURCE.includes("standAloneToken"));
    assert.ok(!/searchParams\.set/.test(SOURCE));
  });

  it("reuses the established sandbox and referrer attributes", () => {
    assert.ok(SOURCE.includes('referrerPolicy="no-referrer"'));
    assert.ok(/sandbox="[^"]*allow-scripts[^"]*"/.test(SOURCE));
    assert.ok(/sandbox="[^"]*allow-same-origin[^"]*"/.test(SOURCE));
  });

  it("validates both the origin and the source window of every message it acts on", () => {
    assert.ok(SOURCE.includes("event.origin"));
    assert.ok(SOURCE.includes("event.source"));
  });

  it("posts to the widget origin, never to the '*' wildcard", () => {
    assert.ok(!/postMessage\([^)]*["']\*["']/.test(SOURCE));
  });

  it("renders nothing on 404 and one line on 502", () => {
    assert.ok(SOURCE.includes("404"));
    assert.ok(SOURCE.includes("Live credit data is unavailable right now"));
  });

  it("takes its refresh timing from the tested pure module rather than a literal", () => {
    assert.ok(SOURCE.includes("nextPreauthRefreshDelayMs"));
    assert.ok(!/setTimeout\([^,]+,\s*\d{4,}\)/.test(SOURCE));
  });

  it("reads both endpoints same-origin with no store", () => {
    assert.ok(SOURCE.includes("/api/monitoring/token"));
    assert.ok(SOURCE.includes("/api/monitoring/widget"));
    assert.ok(SOURCE.includes('credentials: "same-origin"'));
    assert.ok(SOURCE.includes('cache: "no-store"'));
  });
});
