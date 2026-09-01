import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { BankDetailPayload, BankListRow } from "@/lib/vault/types";

import { GET as listBanks } from "./route.ts";
import { GET as readBank } from "./[ref]/route.ts";

// No server, no database, no environment variable. `FEATURE_VAULT` is unset
// here exactly as it is unset in a fresh clone and on the deployment today, so
// these cases run the committed default rather than a contrived one.

const ROUTE_FILES = ["./route.ts", "./[ref]/route.ts"] as const;

function sourceOf(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

function detailContext(ref = "bluevine") {
  return { params: Promise.resolve({ ref }) };
}

const HANDLERS: readonly [string, () => Promise<Response>][] = [
  ["GET /api/banks", () => listBanks(new Request("https://mf.test/api/banks"))],
  [
    "GET /api/banks/[ref]",
    () => readBank(new Request("https://mf.test/api/banks/bluevine"), detailContext()),
  ],
];

describe("the lender routes with FEATURE_VAULT off", () => {
  for (const [name, call] of HANDLERS) {
    it(`${name} refuses with the one shared disabled answer`, async () => {
      const response = await call();
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "vault_disabled",
        message: "The lender database is not enabled.",
      });
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    });
  }

  it("answers without ever loading anything that could reach a database", () => {
    // Asserted by source position rather than by timing, because a passing
    // request cannot tell "the flag was off" apart from "the database was
    // fast". Every import that can reach Postgres is dynamic and sits inside a
    // handler, after the flag check has already returned.
    for (const file of ROUTE_FILES) {
      const source = sourceOf(file);
      // Multi-line aware: a reformatted import block is still a static import,
      // and a single-line regex would quietly stop seeing it — which would make
      // this assertion pass by not looking rather than by holding.
      const staticImports = [...source.matchAll(/^import\b[\s\S]*?from "([^"]+)";$/gm)].map(
        (match) => match[1],
      );
      assert.ok(staticImports.length > 0, `${file}: the import scan matched nothing`);
      assert.deepEqual(
        staticImports.sort(),
        ["@/lib/env", "@/lib/vault/http"],
        `${file} imports more than the flag reader and the response shapes at module scope`,
      );

      const flagIndex = source.indexOf('featureFlag("FEATURE_VAULT")');
      assert.ok(flagIndex > 0, `${file} does not read its own flag`);
      // Dynamic imports are the only place `import` is followed by a paren.
      const firstDynamicImport = source.indexOf('import("');
      assert.ok(firstDynamicImport > flagIndex, `${file} loads a service before checking the flag`);
    }
  });

  it("gates on its own flag and no other", () => {
    for (const file of ROUTE_FILES) {
      const flags = [...sourceOf(file).matchAll(/featureFlag\("([A-Z_]+)"\)/g)].map(
        (match) => match[1],
      );
      assert.deepEqual([...new Set(flags)], ["FEATURE_VAULT"], file);
    }
  });

  it("reaches the catalog through the library's public entry point only", () => {
    // `web/src/lib/vault/` is lane D's directory and `@/lib/vault` is the one
    // door into it; a route reaching past the index would couple the HTTP layer
    // to a driver or a repository.
    for (const file of ROUTE_FILES) {
      const source = sourceOf(file);
      const reaches = [...source.matchAll(/import\("(@\/lib\/vault[^"]*)"\)/g)].map(
        (match) => match[1],
      );
      assert.deepEqual([...new Set(reaches)], ["@/lib/vault"], file);
    }
  });
});

describe("request shape, checked before anything is loaded", () => {
  it("refuses a lender handle that is not a lender handle", async () => {
    // The flag check comes first, so this cannot be exercised through the
    // handler until the flag flips. What is assertable now is that the guard
    // exists and mirrors the column's own shape check, so a 400 beats a 23514.
    const { isBankRef } = await import("@/lib/vault/http");
    assert.equal(isBankRef("bluevine"), true);
    assert.equal(isBankRef("us-bank"), true);
    assert.equal(isBankRef("Bad Ref"), false);
    assert.equal(isBankRef("../secrets"), false);
    assert.equal(isBankRef(""), false);
    assert.equal(isBankRef(null), false);
  });
});

// --- The flag-on arms -------------------------------------------------------
//
// Both routes take their session and catalog seams as an optional last
// parameter, the position `enrollment-routes.test.ts` uses for the same
// purpose. Without it there is no way to exercise anything past the flag check
// without a database and a session, which is how both routes shipped with no
// flag-on coverage at all.

const WINDOW = {
  outcomes: 4,
  approvals: 3,
  approvalRate: 75,
  fundedCount: 3,
  fundedAmount: 120_000,
  averageFundedAmount: 40_000,
};

const BANK: BankListRow = {
  bankRef: "example-bank",
  name: "Example Bank",
  products: ["Term loan"],
  bureauPulls: "Experian business",
  qualificationSummary: "Current business records",
  heatLevel: "hot",
  lastOutcomeAt: "2026-08-01",
  windows: { d30: WINDOW, d60: WINDOW, d90: WINDOW, d183: WINDOW, d365: WINDOW },
};

const DETAIL: BankDetailPayload = {
  ...BANK,
  channel: { type: "online", value: "https://example.test/apply" },
  checking: { required: true, depositAmountCents: 100_000, seasoning: "About 3 months" },
  relationshipManager: { required: false, tip: "Expect a call." },
  applicationQuestions: [{ id: "q", label: "Q", responseBasis: "Use the current records." }],
  sourceUpdatedAt: "2026-07-20",
};

function withFlag<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.FEATURE_VAULT;
  process.env.FEATURE_VAULT = "1";
  return run().finally(() => {
    if (previous === undefined) delete process.env.FEATURE_VAULT;
    else process.env.FEATURE_VAULT = previous;
  });
}

class Refused extends Error {
  readonly status: number;
  constructor(status: number) {
    super("refused");
    this.status = status;
  }
}

describe("the lender routes with FEATURE_VAULT on", () => {
  it("passes the catalog through under the roles the Bank Vault is for", async () => {
    const asked: string[][] = [];
    const response = await withFlag(() =>
      listBanks(new Request("https://mf.test/api/banks"), undefined, {
        async listBanks() {
          return [BANK];
        },
        async requireRole(...roles) {
          asked.push([...roles]);
          return {};
        },
      }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { banks: [BANK] });
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    // The Bank Vault is an operator surface; a consumer reaches lender
    // information through their plan and an affiliate's portal is five columns.
    assert.deepEqual(asked, [["operator_member", "platform_admin"]]);
  });

  it("checks the role before it reads anything", async () => {
    let read = 0;
    const response = await withFlag(() =>
      listBanks(new Request("https://mf.test/api/banks"), undefined, {
        async listBanks() {
          read += 1;
          return [BANK];
        },
        async requireRole() {
          throw new Refused(403);
        },
      }),
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "role_forbidden",
      message: "This account cannot browse lenders.",
    });
    assert.equal(read, 0, "the catalog was read for a caller the route then refused");
  });

  it("answers 401 for no session rather than an empty catalog", async () => {
    const response = await withFlag(() =>
      listBanks(new Request("https://mf.test/api/banks"), undefined, {
        async listBanks() {
          return [];
        },
        async requireRole() {
          throw new Refused(401);
        },
      }),
    );
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "session_required");
  });

  it("refuses a query parameter, before the role check and the read", async () => {
    let touched = 0;
    const response = await withFlag(() =>
      listBanks(new Request("https://mf.test/api/banks?q=chase"), undefined, {
        async listBanks() {
          touched += 1;
          return [];
        },
        async requireRole() {
          touched += 1;
          return {};
        },
      }),
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "invalid_request",
      message: "The lender list takes no parameters.",
    });
    assert.equal(touched, 0);
  });

  it("returns one lender's four §6 blocks", async () => {
    const response = await withFlag(() =>
      readBank(new Request("https://mf.test/api/banks/example-bank"), detailContext("example-bank"), {
        async readBank(ref) {
          assert.equal(ref, "example-bank");
          return DETAIL;
        },
        async requireRole() {
          return {};
        },
      }),
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as { bank: BankDetailPayload };
    // Derived from the payload the route was handed, so a mapper quietly
    // dropping one of §6's blocks fails here rather than rendering an empty
    // panel.
    assert.deepEqual(Object.keys(body.bank).sort(), Object.keys(DETAIL).sort());
    assert.deepEqual(body.bank.channel, DETAIL.channel);
    assert.deepEqual(body.bank.checking, DETAIL.checking);
    assert.deepEqual(body.bank.relationshipManager, DETAIL.relationshipManager);
    assert.deepEqual(body.bank.applicationQuestions, DETAIL.applicationQuestions);
  });

  it("answers 404 for an unpublished lender, not 200 with a null body", async () => {
    // `readBank` returns null for absent and for unpublished alike — the
    // catalog is the same for every caller, so there is nothing here for a
    // distinction to protect. What matters is that the caller cannot mistake
    // "no such lender" for "a lender with nothing recorded".
    const response = await withFlag(() =>
      readBank(new Request("https://mf.test/api/banks/retired-bank"), detailContext("retired-bank"), {
        async readBank() {
          return null;
        },
        async requireRole() {
          return {};
        },
      }),
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "not_found",
      message: "That lender is not in the database.",
    });
  });

  it("refuses a malformed handle before the role check and the read", async () => {
    let touched = 0;
    const response = await withFlag(() =>
      readBank(new Request("https://mf.test/api/banks/..%2Fsecrets"), detailContext("../secrets"), {
        async readBank() {
          touched += 1;
          return null;
        },
        async requireRole() {
          touched += 1;
          return {};
        },
      }),
    );

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_request");
    assert.equal(touched, 0);
  });

  it("never puts a driver or Postgres message on the wire", async () => {
    const response = await withFlag(() =>
      listBanks(new Request("https://mf.test/api/banks"), undefined, {
        async listBanks() {
          throw new Error('relation "public.banks_cache" does not exist');
        },
        async requireRole() {
          return {};
        },
      }),
    );

    assert.equal(response.status, 500);
    const serialized = JSON.stringify(await response.json());
    assert.equal(serialized.includes("banks_cache"), false);
    assert.equal(serialized.includes("does not exist"), false);
  });
});
