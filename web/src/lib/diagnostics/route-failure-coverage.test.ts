// R5B-03 / R5B-04 / R5B-05 / R5C-07 — the class test for the route diagnostics seam.
//
// Round 5's finding was that 20 of 22 defects survived a fully green suite because the test asserted
// the reproduction instead of the property. A test that lists the mappers this lane happened to fix
// is exactly that mistake: it would stay green forever while the ninety-first catch site is added
// next to it. So both halves below derive their subject at test time.
//
// **The static half** enumerates `src/app/api/**/route.ts` from disk, decides from the source which
// of them can answer a caller with a 5xx it did not name, and walks the import graph to prove each
// one reaches `@/lib/diagnostics/route-failure`. Reachability is transitive across `src/lib`, so a
// route that calls a shared mapper is covered by the mapper. Add a route tomorrow with a bare catch
// that returns 500 and no path to the seam, and this fails without anybody editing a list.
//
// **The behavioural half** derives the mapper catalog the same way — every `src/lib` module that
// imports the seam — and requires each one to have a probe here that throws `R5_SENTINEL` at it.
// Registering a new mapper without a probe fails the equality assertion, so the catalog cannot drift
// away from the behaviour it claims.
//
// The negative assertion is the two-rails half: the record a probe produces must not contain the
// thrown message, and must not contain any of a set of planted provider and bureau payload values.
// The log stream is bound by the derived-only rail exactly as storage is.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  ROUTE_FAILURE_EVENT,
  type RouteFailureRecord,
  recordRouteFailure,
  setRouteFailureSink,
} from "./route-failure.ts";

const SRC = path.resolve(import.meta.dirname, "..", "..");
const SEAM = "@/lib/diagnostics/route-failure";

function walk(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, match));
    else if (match(entry.name)) out.push(full);
  }
  return out;
}

/** Every `@/…` and relative specifier a module imports, static or dynamic. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((hit) => hit[1]);
}

/** `@/lib/x/y` for a file under `src`, so specifiers and files share one vocabulary. */
function moduleId(file: string): string {
  return `@/${path.relative(SRC, file).replace(/\\/g, "/").replace(/\.tsx?$/, "")}`;
}

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith("@/")) return specifier.replace(/\.tsx?$/, "");
  if (!specifier.startsWith(".")) return null;
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  return `@/${path.relative(SRC, resolved).replace(/\\/g, "/").replace(/\.tsx?$/, "")}`;
}

const LIB_FILES = walk(path.join(SRC, "lib"), (name) =>
  /\.tsx?$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx"));

/**
 * The `src/lib` modules that reach the seam, computed to a fixpoint so a mapper that reaches it
 * through a sibling (`tenancy/route-utils` through `tenancy/errors`) counts as covered.
 */
function seamReachingLibModules(): Set<string> {
  const imports = new Map<string, string[]>();
  for (const file of LIB_FILES) {
    imports.set(
      moduleId(file),
      specifiers(readFileSync(file, "utf8"))
        .map((specifier) => resolveSpecifier(specifier, file))
        .filter((id): id is string => id !== null),
    );
  }
  const reaching = new Set<string>([SEAM]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [id, deps] of imports) {
      if (reaching.has(id)) continue;
      if (deps.some((dep) => reaching.has(dep))) {
        reaching.add(id);
        changed = true;
      }
    }
  }
  return reaching;
}

const SEAM_MODULES = seamReachingLibModules();

/**
 * The direct importers of the seam — the mapper catalog the behavioural half must cover. A module
 * that only reaches the seam through a sibling is that sibling's responsibility, not its own.
 */
const DIRECT_SEAM_MODULES = new Set(
  LIB_FILES
    .filter((file) => specifiers(readFileSync(file, "utf8")).some((s) =>
      resolveSpecifier(s, file) === SEAM))
    .map(moduleId),
);

describe("route failure diagnostics — derived coverage over the route catalog", () => {
  test("every route that can answer 5xx for a cause it did not name reaches the seam", () => {
    const routes = walk(path.join(SRC, "app", "api"), (name) => name === "route.ts");
    assert.ok(routes.length > 50, "the route catalog must be read from disk, not assumed");

    const uncovered: string[] = [];
    let inScope = 0;
    for (const file of routes) {
      const source = readFileSync(file, "utf8");
      const catches = /\bcatch\s*[({]/.test(source);
      const fivexx = /\b(?:500|502|503|504)\b/.test(source);
      const ids = specifiers(source)
        .map((specifier) => resolveSpecifier(specifier, file))
        .filter((id): id is string => id !== null);
      const usesMapper = ids.some((id) => SEAM_MODULES.has(id));
      // In scope when the file both catches and can emit a 5xx of its own, or when it delegates its
      // failures to a module that already owns a 5xx answer.
      if (!catches || !(fivexx || usesMapper)) continue;
      inScope += 1;
      if (!usesMapper) uncovered.push(path.relative(SRC, file));
    }

    assert.ok(inScope >= 40, `expected the derived in-scope set to be substantial, got ${inScope}`);
    assert.deepEqual(
      uncovered,
      [],
      "these routes can answer 5xx for an unnamed cause without reaching the diagnostics seam",
    );
  });
});

type Probe = {
  /** Fire the mapper's unknown-cause arm with `cause`, and return the body it answers with. */
  run(cause: unknown): Promise<unknown>;
  /**
   * `"mapper"` (the default) is an HTTP error mapper: it turns an unrecognised cause into a 5xx and
   * grows the body by a correlation id so the caller's failure and the log line can be joined.
   *
   * `"degraded"` is the shape the AI answer paths have, and pretending otherwise would make the
   * record lie. They answer **200** carrying a degraded result — `status: "unavailable"` — because a
   * model that declines is not a server error, and the caller is given no correlation id because the
   * body is an answer rather than an error envelope. What still has to hold, and is what these
   * probes exist to prove, is that exactly one record is written, that it names the surface, and
   * that it carries no content from the thrown value. Joining is done from the log line alone.
   */
  kind?: "mapper" | "degraded";
};

// The last token stands in for a secret without being shaped like one. `verify-source-gates.mjs`
// bans credential-shaped literals repo-wide and has no allow-list, which is the right design — so a
// canary must not wear the shape it is standing in for. Nothing is lost: every assertion below is a
// substring check, so the sentinel needs to be distinctive, not credential-shaped.
const SENTINEL_MESSAGE = "R5_SENTINEL bureau row 812 for casey@example.test PLANTED_SECRET_TOKEN";

async function bodyOf(response: Response | Promise<Response>): Promise<unknown> {
  return (await response).json();
}

/**
 * One probe per direct importer of the seam. Keyed by module id so the assertion below can compare
 * this catalog against the one derived from disk — a new mapper without a probe fails the run.
 */
const PROBES: Readonly<Record<string, Probe>> = {
  "@/lib/affiliates/http": {
    async run(cause) {
      const { affiliateFailure } = await import("@/lib/affiliates/http");
      return bodyOf(affiliateFailure(cause));
    },
  },
  "@/lib/ancillary/http": {
    async run(cause) {
      const { failure } = await import("@/lib/ancillary/http");
      return bodyOf(failure(cause));
    },
  },
  "@/lib/applications/http": {
    async run(cause) {
      const { failureResponse } = await import("@/lib/applications/http");
      return bodyOf(failureResponse(cause));
    },
  },
  "@/lib/billing/http": {
    async run(cause) {
      const { billingErrorFor } = await import("@/lib/billing/http");
      return bodyOf(billingErrorFor(cause));
    },
  },
  "@/lib/enrollment/email-availability": {
    async run(cause) {
      // This mapper is deep service code, not a boundary: it throws rather than answering. The
      // probe therefore drives it the way the enroll route does — let it throw, then map through
      // `toHttpResponse` — which is exactly the path whose correlation id must survive.
      const [{ createEmailAvailabilityReader }, { toHttpResponse }] = await Promise.all([
        import("@/lib/enrollment/email-availability"),
        import("@/lib/enrollment/errors"),
      ]);
      const reader = createEmailAvailabilityReader({ rpc: async () => ({ data: null, error: cause }) });
      const thrown = await reader
        .registeredElsewhere({ actorId: "a1000000-0000-0000-0000-000000000011", email: "probe@example.test" })
        .then(() => null)
        .catch((error: unknown) => error);
      return bodyOf(toHttpResponse(thrown));
    },
  },
  "@/lib/enrollment/errors": {
    async run(cause) {
      const { toHttpResponse } = await import("@/lib/enrollment/errors");
      return bodyOf(toHttpResponse(cause));
    },
  },
  "@/lib/pricing/http": {
    async run(cause) {
      const { mapPaidRefreshFailure } = await import("@/lib/pricing/http");
      return bodyOf(mapPaidRefreshFailure(cause));
    },
  },
  "@/lib/privacy/http": {
    async run(cause) {
      const { handleAdminPrivacyRequests } = await import("@/lib/privacy/http");
      return bodyOf(handleAdminPrivacyRequests({
        list: async () => { throw cause; },
        requireAdmin: async () => ({ id: "admin-probe", role: "platform_admin" }),
      }));
    },
  },
  "@/lib/operator/client-notes-http.server": {
    async run(cause) {
      const { handleClientNotesCollection } = await import("@/lib/operator/client-notes-http.server");
      return bodyOf(handleClientNotesCollection(
        new Request("https://app.example.test/api/clients/00000000-0000-4000-8000-000000000001/notes"),
        "00000000-0000-4000-8000-000000000001",
        {
          assertRead: async () => {},
          assertWrite: async () => {},
          isSameOrigin: () => true,
          requireOperator: async () => ({ id: "operator-probe", orgId: "org-probe" }),
          service: { list: async () => { throw cause; } },
        } as never,
      ));
    },
  },
  "@/lib/support/errors": {
    async run(cause) {
      const { toHttpResponse } = await import("@/lib/support/errors");
      return toHttpResponse(cause).body;
    },
  },
  "@/lib/tenancy/errors": {
    async run(cause) {
      const { tenantErrorResponse } = await import("@/lib/tenancy/errors");
      return bodyOf(tenantErrorResponse(cause));
    },
  },
  // Phase 8, 2026-08-19: the BANK VAULT read model's mapper. Added here because
  // the assertion below derives the expected set from disk — a new importer of
  // the seam with no probe is a mapper nobody has proved records its cause.
  // The chat + AI rebuild, 2026-08-22. These two are not HTTP mappers — they are
  // the AI answer paths, which never reached the seam at all. A `catch { return
  // null; }` in `runGroundedChat` is why a production outage that made every
  // supervised answer in the product return "unavailable" was invisible from the
  // logs: the surface, the transport and the gate all produced the same empty
  // result and none of them said which had refused. Their probes call the real
  // path with a transport that throws, which is the shape the outage had.
  "@/lib/kb/chat-driver": {
    kind: "degraded",
    async run(cause) {
      const { runGroundedChat } = await import("@/lib/kb/chat-driver");
      const answer = await runGroundedChat({
        question: "probe",
        documents: [{ id: "d1", title: "t", label: "Knowledge article · t", url: "https://example.test/d1", content: "c", metadata: {} }],
        transport: { driver: "openrouter", model: "probe", complete: async () => { throw cause; } },
        prompt: { key: "consumer-kb-answer", version: 1, system: "probe" },
      });
      // A refusal is the whole point: the record is the observable, not the value.
      return { answer };
    },
  },
  // Lane 4a, 2026-08-22. The platform-scoped answer path, added with
  // `lib/kb/admin-answer.ts` (F-08). `degraded` for the same reason its two
  // neighbours are: four cross-tenant reads run before a token is generated, and
  // a failure in any of them is indistinguishable from a model refusal at the
  // surface, so the record is the only thing that says which refused.
  "@/lib/kb/admin-answer": {
    kind: "degraded",
    async run(cause) {
      const { createAdminKbAnswer } = await import("@/lib/kb/admin-answer");
      return createAdminKbAnswer(
        "probe",
        { id: "00000000-0000-0000-0000-000000000000", role: "platform_admin", orgId: null } as never,
        {
          readCounts: async () => { throw cause; },
          readFundedVolume: async () => { throw cause; },
          readPlatformMrrCents: async () => { throw cause; },
          readTenants: async () => { throw cause; },
          today: () => "2026-08-22",
          transport: () => ({ driver: "mock", model: "probe", complete: async () => ({}) }),
        } as never,
      );
    },
  },
  "@/lib/kb/operator": {
    kind: "degraded",
    async run(cause) {
      const { createOperatorKbAnswer } = await import("@/lib/kb/operator");
      return createOperatorKbAnswer(
        { mode: "answer", question: "probe" },
        { id: "00000000-0000-0000-0000-000000000000", role: "operator_member", orgId: "00000000-0000-0000-0000-000000000000" } as never,
        {
          listTrackerClients: async () => { throw cause; },
          listApplications: async () => [],
          listBankRetrievalDocuments: async () => [],
          transport: () => ({ driver: "mock", model: "probe", complete: async () => ({}) }),
          generateDraft: async () => { throw cause; },
        } as never,
      );
    },
  },
  // The chat + AI rebuild, 2026-08-22. The consumer page's server-side team chat
  // read. It is `degraded` for the same reason the AI paths are: a failure here
  // is a page that still renders, handing the work back to the client bootstrap
  // it exists to replace — a slower first paint, not a server error. Without the
  // record the only symptom is that the fast path stopped being fast, which is
  // indistinguishable from a slow database.
  "@/lib/support/team-chat.server": {
    kind: "degraded",
    async run(cause) {
      const { readConsumerTeamChat } = await import("@/lib/support/team-chat.server");
      return readConsumerTeamChat(
        { disabledAt: null, id: "consumer-1", manages: [], orgId: "org-1", orgMembership: null, orgRole: null, role: "consumer" },
        {
          assertWritable: async () => {},
          featureEnabled: () => true,
          open: async () => { throw cause; },
        } as never,
      );
    },
  },
  // The KB retrieval driver. `degraded` because that is the whole point of the
  // arm: when the scoring provider fails, retrieval falls back to the hash
  // ranking and the consumer still gets an answer path, so a 500 would be a lie
  // and a silent fallback would make "the semantic arm is switched on" and "the
  // semantic arm has been failing every request for a week" look identical.
  "@/lib/kb/retrieval": {
    kind: "degraded",
    async run(cause) {
      const { createKbRetrieval } = await import("@/lib/kb/retrieval");
      const match = { id: "row:probe", sourceArticleId: "probe", title: "Probe", body: "Probe body.", sourceUrl: "https://kb.example.test/probe", metadata: {}, similarity: 0.5 };
      return createKbRetrieval({
        env: { KB_EMBEDDING_DRIVER: "llm_score", OPENROUTER_API_KEY: "configured" },
        index: { async search() { return [match]; } },
        transport: () => { throw cause; },
      }).retrieve("probe", 6);
    },
  },
  "@/lib/vault/http": {
    async run(cause) {
      const { failureResponse } = await import("@/lib/vault/http");
      return bodyOf(failureResponse(cause));
    },
  },
};

describe("route failure diagnostics — every mapper records an unrecognised cause", () => {
  test("the probe catalog is exactly the set of modules that import the seam", () => {
    assert.deepEqual(
      Object.keys(PROBES).sort(),
      [...DIRECT_SEAM_MODULES].sort(),
      "a module that imports the diagnostics seam must have a probe here, and vice versa",
    );
  });

  for (const [id, probe] of Object.entries(PROBES)) {
    test(`${id} records exactly one cause and echoes its correlation id`, async () => {
      const records: RouteFailureRecord[] = [];
      const restore = setRouteFailureSink((record) => records.push(record));
      let body: unknown;
      try {
        body = await probe.run(new Error(SENTINEL_MESSAGE));
      } finally {
        restore();
      }

      assert.equal(records.length, 1, "an unrecognised cause must produce exactly one record");
      const record = records[0];
      assert.equal(record.event, ROUTE_FAILURE_EVENT);
      assert.equal(record.causeKind, "error");
      assert.equal(record.causeName, "Error");
      assert.ok(record.surface.length > 0, "the record must name the surface that answered");

      if (probe.kind === "degraded") {
        assert.equal(record.status, 200, "a degraded answer is not a server failure and must not claim to be");
      } else {
        assert.ok(record.status >= 500, "an unrecognised cause is a server failure");
        const echoed = (body as { correlationId?: unknown }).correlationId;
        assert.equal(
          echoed,
          record.correlationId,
          "the response body must carry the same correlation id as the record",
        );
      }

      // Two rails: the log stream may carry a classification and identifiers, never content.
      //
      // `correlationId` and `at` are excluded from the substring scan and checked for shape
      // instead, because the seam mints them itself and neither can carry a thrown value — one is
      // `crypto.randomUUID()`, the other a clock reading. Scanning them was a false positive with a
      // measurable rate: `812` is the only planted string made entirely of hex characters, and a
      // random UUID contains it 0.58% of the time (11,676 of 2,000,000 sampled), so a run of
      // thirteen probes failed about one time in twelve. `at`'s millisecond field adds to that
      // whenever it reads `.812`. It cost a morning to chase, and an assertion on the compliance
      // rail that reds by chance is worse than no assertion, because the habit it teaches is to
      // rerun until green — which is exactly how a real leak would get waved through.
      //
      // The shape checks are what keeps the exclusion honest: if the seam ever put a thrown value
      // where an identifier belongs, these fail rather than the scan quietly skipping it.
      assert.match(
        record.correlationId,
        /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|rf-[0-9a-z]+-[0-9a-z]+)$/,
        "the correlation id must be a minted identifier, never derived from the cause",
      );
      assert.equal(
        Number.isNaN(Date.parse(record.at)),
        false,
        "`at` must be a clock reading, never derived from the cause",
      );
      // Omitted by key rather than by destructuring a rest object, so nothing here is an
      // enumeration of the record's fields that could go stale as the record gains them.
      const MINTED_BY_THE_SEAM = new Set(["correlationId", "at"]);
      const serialized = JSON.stringify(record, (key, value) =>
        MINTED_BY_THE_SEAM.has(key) ? undefined : value,
      );
      for (const planted of ["R5_SENTINEL", "bureau", "812", "casey@example.test", "PLANTED_SECRET_TOKEN"]) {
        assert.equal(
          serialized.includes(planted),
          false,
          `the record must not carry '${planted}' from the thrown value`,
        );
      }
    });
  }

  test("a named refusal keeps its byte-identical body and records nothing", async () => {
    const { billingErrorFor } = await import("@/lib/billing/http");
    const { SupportError, toHttpResponse } = await import("@/lib/support/errors");

    const records: RouteFailureRecord[] = [];
    const restore = setRouteFailureSink((record) => records.push(record));
    let billing: unknown;
    let support: unknown;
    try {
      billing = await bodyOf(billingErrorFor({ name: "AuthError", status: 403 }));
      support = toHttpResponse(new SupportError("SUPPORT_UNAVAILABLE")).body;
    } finally {
      restore();
    }

    assert.deepEqual(records, [], "a decision the product made is not a failure to record");
    assert.equal((billing as { correlationId?: unknown }).correlationId, undefined);
    assert.deepEqual(support, { error: "SUPPORT_UNAVAILABLE" });
  });

  test("the record carries a cause code only when it is an identifier", () => {
    const records: RouteFailureRecord[] = [];
    const restore = setRouteFailureSink((record) => records.push(record));
    try {
      recordRouteFailure({
        cause: Object.assign(new Error("statement timeout at reserve_paid_refresh_pull"), {
          code: "57014",
        }),
        code: "paid_refresh_unavailable",
        status: 500,
        surface: "probe.identifier",
      });
      recordRouteFailure({
        cause: Object.assign(new Error("x"), { code: "duplicate key value violates \"clients_pkey\"" }),
        code: "failed",
        status: 500,
        surface: "probe.sentence",
      });
    } finally {
      restore();
    }

    assert.equal(records[0].causeCode, "57014", "a SQLSTATE is an identifier and is worth keeping");
    assert.equal(
      records[1].causeCode,
      null,
      "anything that is not a bare identifier is dropped rather than truncated",
    );
  });
});
