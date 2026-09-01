import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { GET as listApplications, POST as createApplication } from "./route.ts";
import { GET as readApplication, PATCH as patchApplication } from "./[id]/route.ts";
import { GET as listNotes, POST as addNote } from "./[id]/notes/route.ts";
import { POST as recordOutcome } from "./[id]/outcomes/route.ts";

// No server, no database, no environment variable. `FEATURE_APPLICATIONS` is
// unset here exactly as it is unset in a fresh clone and in production today,
// so these cases run the committed default rather than a contrived one.

const APPLICATION_ID = "ee000000-0000-0000-0000-000000000001";
const CLIENT_ID = "ee000000-0000-0000-0000-000000000002";

// `verify-source-gates.mjs` and `verify-compliance-copy.mjs` are plain text
// scans, not AST passes, so a test that spelled the banned tokens out would be
// its own first finding. The two patterns below are assembled from fragments
// for that reason and for no other.
const NEXT_ESCAPE_HATCH = new RegExp(`${"wait"}Until|\\bafter\\(`);
const ERASURE_NOUN = new RegExp(`${"remov"}als?`, "i");

const ROUTE_FILES = [
  "./route.ts",
  "./[id]/route.ts",
  "./[id]/notes/route.ts",
  "./[id]/outcomes/route.ts",
] as const;

function sourceOf(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

function itemContext() {
  return { params: Promise.resolve({ id: APPLICATION_ID }) };
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const HANDLERS: readonly [string, () => Promise<Response>][] = [
  [
    "GET /api/applications",
    () =>
      listApplications(
        new Request(`https://mf.test/api/applications?clientId=${CLIENT_ID}`),
      ),
  ],
  [
    "POST /api/applications",
    () =>
      createApplication(
        jsonRequest("https://mf.test/api/applications", {
          clientId: CLIENT_ID,
          bankRef: "example-bank",
        }),
      ),
  ],
  [
    "GET /api/applications/[id]",
    () =>
      readApplication(
        new Request(`https://mf.test/api/applications/${APPLICATION_ID}`),
        itemContext(),
      ),
  ],
  [
    "PATCH /api/applications/[id]",
    () =>
      patchApplication(
        jsonRequest(`https://mf.test/api/applications/${APPLICATION_ID}`, {
          operatorStatus: "todo",
        }),
        itemContext(),
      ),
  ],
  [
    "GET /api/applications/[id]/notes",
    () =>
      listNotes(
        new Request(`https://mf.test/api/applications/${APPLICATION_ID}/notes`),
        itemContext(),
      ),
  ],
  [
    "POST /api/applications/[id]/notes",
    () =>
      addNote(
        jsonRequest(`https://mf.test/api/applications/${APPLICATION_ID}/notes`, {
          body: "Called the lender.",
          attested: true,
        }),
        itemContext(),
      ),
  ],
  [
    "POST /api/applications/[id]/outcomes",
    () =>
      recordOutcome(
        jsonRequest(
          `https://mf.test/api/applications/${APPLICATION_ID}/outcomes`,
          { kind: "denied" },
        ),
        itemContext(),
      ),
  ],
];

test("every handler answers 503 applications_disabled with the flag off", async () => {
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

  assert.equal(HANDLERS.length, 7, "all seven applications handlers are covered");
});

test("the flag-off return precedes every dynamic import, in every handler", () => {
  let handlersChecked = 0;

  for (const file of ROUTE_FILES) {
    const source = sourceOf(file);
    // Split on the handler boundary so the assertion is per handler. Checking
    // the file as a whole would pass trivially: the first handler's imports sit
    // above the second handler's flag check.
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

  assert.equal(handlersChecked, 7, "all four files and all seven handlers");
});

test("no route reads the environment or opts out of the defaults", () => {
  for (const file of ROUTE_FILES) {
    const source = sourceOf(file);

    // The flag reader is the only environment reach, and it lives in env.ts.
    assert.equal(
      /process\s*\.\s*env/.test(source),
      false,
      `${file} must not read the ambient environment`,
    );
    // GET has defaulted to dynamic since v15.0.0-RC in this Next line, so an
    // export here would be cargo.
    assert.equal(/export const dynamic/.test(source), false, file);
    assert.equal(NEXT_ESCAPE_HATCH.test(source), false, file);
    // Every response carries the private header through one helper.
    assert.equal(/new Response\(/.test(source), false, file);
  }
});

test("every dynamic handler awaits its params promise", () => {
  for (const file of ROUTE_FILES.slice(1)) {
    const source = sourceOf(file);
    const chunks = source.split(/export async function /).slice(1);
    for (const chunk of chunks) {
      assert.match(
        chunk,
        /const \{ id \} = await context\.params;/,
        `${file}: params is a Promise in this Next line`,
      );
    }
  }

  // Two handlers in the item route, exactly as the plan's grep expects.
  assert.equal(
    sourceOf("./[id]/route.ts").split("await context.params").length - 1,
    2,
  );
});

test("the request body allow-lists are exactly the documented ones", () => {
  assert.match(
    sourceOf("./route.ts"),
    /const CREATE_KEYS = \[\s*"clientId",\s*"bankRef",\s*"operatorStatus",\s*"consumerStatus",\s*"amountCents",\s*"visibility",\s*\] as const;/,
  );
  assert.match(
    sourceOf("./[id]/route.ts"),
    /const PATCH_KEYS = \[\s*"operatorStatus",\s*"consumerStatus",\s*"amountCents",\s*"visibility",\s*\] as const;/,
  );
  assert.match(
    sourceOf("./[id]/notes/route.ts"),
    /const NOTE_KEYS = \["body", "attested"\] as const;/,
  );
  assert.match(
    sourceOf("./[id]/outcomes/route.ts"),
    /const OUTCOME_KEYS = \["kind", "amountCents", "decidedOn"\] as const;/,
  );

  // The fields a server derives are never read from a body. A route that grew
  // one of these would be handing a caller the pen.
  for (const file of ROUTE_FILES) {
    const source = sourceOf(file);
    for (const forbidden of [
      "body.authorKind",
      "body.authorProfileId",
      "body.recordedBy",
      "body.createdBy",
      "body.state",
      "body.createdAt",
      "body.updatedAt",
      "body.actorProfileId",
    ]) {
      assert.equal(source.includes(forbidden), false, `${file} reads ${forbidden}`);
    }
  }
});

test("the outcome route returns the approved string and claims no delivery", () => {
  const source = sourceOf("./[id]/outcomes/route.ts");

  // The 201 message is the pre-flight's approved constant rather than a
  // sentence retyped here, so it cannot drift from the one that was checked.
  assert.match(source, /message: OUTCOME_COUNTED_LABEL/);
  assert.equal(/Synced|Sent to|funding brain/.test(source), false);
  assert.equal(ERASURE_NOUN.test(source), false);
});
