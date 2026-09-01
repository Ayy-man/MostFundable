import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { GET as listOutcomes } from "./route.ts";
import { GET as readOutcome } from "./[id]/route.ts";
import { POST as reviewOutcome } from "./[id]/review/route.ts";

// No server, no database, no credential. `FEATURE_APPLICATIONS` is unset here
// exactly as it is unset in a fresh clone and in production today, so every
// case below runs the committed default rather than a contrived one.

const OUTCOME_ID = "ee000000-0000-0000-0000-000000000101";
const CLIENT_ID = "ee000000-0000-0000-0000-000000000102";

// Both repository gates are plain text scans rather than AST passes, so a test
// that spelled the banned tokens out would be its own first finding. These two
// are assembled from fragments for that reason and no other.
const ERASURE_NOUN = new RegExp(`${"remov"}als?`, "i");
const DELIVERY_VERB = new RegExp(`${"sync"}ed`, "i");

const ROUTE_FILES = [
  "./route.ts",
  "./[id]/route.ts",
  "./[id]/review/route.ts",
] as const;

const DELIVERED_STRING = "Sent to the funding brain.";

function sourceOf(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

function itemContext() {
  return { params: Promise.resolve({ id: OUTCOME_ID }) };
}

function reviewRequest(body: unknown): Request {
  return new Request(`https://mf.test/api/outcomes/${OUTCOME_ID}/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const HANDLERS: readonly [string, () => Promise<Response>][] = [
  [
    "GET /api/outcomes",
    () =>
      listOutcomes(
        new Request(`https://mf.test/api/outcomes?clientId=${CLIENT_ID}`),
      ),
  ],
  [
    "GET /api/outcomes/[id]",
    () =>
      readOutcome(
        new Request(`https://mf.test/api/outcomes/${OUTCOME_ID}`),
        itemContext(),
      ),
  ],
  [
    "POST /api/outcomes/[id]/review",
    () => reviewOutcome(reviewRequest({ decision: "approved" }), itemContext()),
  ],
];

test("every outcomes handler answers 503 applications_disabled with the flag off", async () => {
  for (const [name, call] of HANDLERS) {
    const response = await call();

    assert.equal(response.status, 503, `${name} must be 503 with the flag off`);
    assert.equal(
      response.headers.get("Cache-Control"),
      "private, no-store",
      `${name} must not be cached`,
    );
    assert.deepEqual(await response.json(), {
      error: "applications_disabled",
      message: "Applications are disabled.",
    });
  }

  assert.equal(HANDLERS.length, 3, "all three outcomes handlers are covered");
});

test("the flag-off return precedes every dynamic import, in every handler", () => {
  let handlersChecked = 0;

  for (const file of ROUTE_FILES) {
    const source = sourceOf(file);
    // Split on the handler boundary so the assertion is per handler rather than
    // per file: a whole-file check passes trivially the moment one file exports
    // two handlers, because the first handler's imports sit above the second
    // handler's flag check.
    const chunks = source.split(/export async function /).slice(1);
    assert.ok(chunks.length > 0, `${file} exports no handler`);

    for (const chunk of chunks) {
      handlersChecked += 1;
      const disabled = chunk.indexOf("disabledResponse()");
      const firstImport = chunk.indexOf("await import(");

      assert.notEqual(disabled, -1, `${file} handler has no flag-off branch`);
      assert.match(chunk, /featureFlag\("FEATURE_APPLICATIONS"\)/);
      if (firstImport !== -1) {
        assert.ok(
          disabled < firstImport,
          `${file}: the 503 must be returned before anything is imported`,
        );
      }
    }
  }

  assert.equal(handlersChecked, 3, "all three files and all three handlers");
});

test("the three query forms are mutually exclusive", async () => {
  // These need the flag on, because the 503 is returned before the query is
  // read at all. Setting it for the duration of this case is the only place in
  // the file that touches the environment, and it is restored either way.
  const previous = process.env.FEATURE_APPLICATIONS;
  process.env.FEATURE_APPLICATIONS = "true";

  try {
    const cases: readonly [string, string][] = [
      ["none", "https://mf.test/api/outcomes"],
      ["two", `https://mf.test/api/outcomes?clientId=${CLIENT_ID}&review=pending`],
      ["all three", `https://mf.test/api/outcomes?clientId=${CLIENT_ID}&review=pending&bankRef=alpha`],
      ["a repeated form", `https://mf.test/api/outcomes?clientId=${CLIENT_ID}&clientId=${CLIENT_ID}`],
      ["an unknown filter", "https://mf.test/api/outcomes?scope=all"],
    ];

    for (const [label, url] of cases) {
      const response = await listOutcomes(new Request(url));
      assert.equal(response.status, 400, `${label} must be a 400`);
      const body = (await response.json()) as { error: string };
      assert.equal(body.error, "invalid_request", label);
    }

    // A malformed value inside a valid form is still a 400, and it never
    // reaches the session or the database to find that out.
    for (const url of [
      "https://mf.test/api/outcomes?clientId=not-a-uuid",
      "https://mf.test/api/outcomes?review=approved",
      "https://mf.test/api/outcomes?bankRef=Not%20A%20Handle",
    ]) {
      assert.equal((await listOutcomes(new Request(url))).status, 400, url);
    }
  } finally {
    if (previous === undefined) delete process.env.FEATURE_APPLICATIONS;
    else process.env.FEATURE_APPLICATIONS = previous;
  }
});

test("the pending queue is admin-only in source, not filtered to empty", () => {
  const source = sourceOf("./route.ts");
  const queueBranch = source.slice(source.indexOf('if (form === "review")'));

  // A role comparison returning 403, and no list call above it. An empty 200 is
  // a different and misleading answer: it says the queue is empty rather than
  // that this caller may not see it (T-11-31).
  const guard = queueBranch.indexOf('session.role !== "platform_admin"');
  const read = queueBranch.indexOf("listPendingReviews()");
  assert.notEqual(guard, -1, "the queue branch has no platform_admin check");
  assert.notEqual(read, -1, "the queue branch never reads the queue");
  assert.ok(guard < read, "the queue is read before the role is checked");
  assert.match(queueBranch.slice(guard), /return roleForbidden\(\)/);
});

test("the delivered string is reachable only from a delivered outbox state", () => {
  const source = sourceOf("./[id]/review/route.ts");
  const occurrences = source.split(DELIVERED_STRING).length - 1;
  assert.equal(occurrences, 1, "the delivery claim appears in exactly one place");

  const at = source.indexOf(DELIVERED_STRING);
  const guarding = source.slice(Math.max(0, at - 400), at);
  const lastCheck = guarding.lastIndexOf('outboxState === "');
  assert.notEqual(lastCheck, -1, "the delivery claim has no outbox-state guard");
  assert.match(
    guarding.slice(lastCheck),
    /^outboxState === "delivered"/,
    "the delivery claim must sit under the delivered state and no other",
  );

  // The recorded branch reuses the approved constant rather than retyping it,
  // so the string cannot drift from the one the pre-flight checked.
  assert.match(source, /return WRITEBACK_RECORDED_LABEL;/);
});

test("no outcomes route overstates delivery or names the banned noun", () => {
  for (const file of ROUTE_FILES) {
    const source = sourceOf(file);

    assert.equal(
      DELIVERY_VERB.test(source),
      false,
      `${file} claims a sync that the fixture driver never performs`,
    );
    assert.equal(ERASURE_NOUN.test(source), false, `${file} names the banned noun`);
    // The flag reader is the only environment reach, and it lives in env.ts.
    assert.equal(
      /process\s*\.\s*env/.test(source),
      false,
      `${file} must not read the ambient environment`,
    );
    assert.equal(/export const dynamic/.test(source), false, file);
    assert.equal(/new Response\(/.test(source), false, file);
  }
});

test("the review body allow-list is exactly the decision", () => {
  const source = sourceOf("./[id]/review/route.ts");

  assert.match(source, /const REVIEW_KEYS = \["decision"\] as const;/);
  // The actor is the session's. A body that could name it would let one admin
  // record a correction under another's id.
  for (const forbidden of [
    "body.actorProfileId",
    "body.reviewedBy",
    "body.outcomeId",
    "body.state",
  ]) {
    assert.equal(source.includes(forbidden), false, `review route reads ${forbidden}`);
  }
  assert.match(source, /actorProfileId: session\.id/);
});

test("every dynamic handler awaits its params promise", () => {
  for (const file of ROUTE_FILES.slice(1)) {
    for (const chunk of sourceOf(file).split(/export async function /).slice(1)) {
      assert.match(
        chunk,
        /const \{ id \} = await context\.params;/,
        `${file}: params is a Promise in this Next line`,
      );
    }
  }
});

test("the pending queue is a query parameter, not a static sibling", () => {
  // Re-adding `reviews/` alongside `[id]/` would make this surface depend on a
  // precedence rule neither `route.md` nor `dynamic-routes.md` states
  // (pre-flight P-03, G-11-01). Failing here sends the next contributor to that
  // note rather than to a debugging session.
  assert.equal(
    existsSync(new URL("./reviews", import.meta.url)),
    false,
    "the admin queue is GET /api/outcomes?review=pending",
  );
  assert.match(sourceOf("./route.ts"), /review=pending/);
});
