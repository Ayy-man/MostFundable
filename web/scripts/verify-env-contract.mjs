#!/usr/bin/env node
// verify-env-contract.mjs — proves the contract of `src/lib/env.ts` (UNBLK-09).
//
// `env.ts` is the one place five parallel lanes agree on how a driver is
// selected, so a silent change to its semantics would be a merge-day surprise
// in four lanes at once. This script is the check that makes such a change
// loud. It asserts the whole INTERFACES §10 contract: unset and blank selectors
// fall back, an explicit selector with a missing key throws, an unknown value
// throws, feature flags are off unless explicitly turned on, and the three
// public keys are read in the one shape Next.js will actually inline.
//
// **It is deliberately not part of the release gate.** The gate line in
// ROADMAP "Merge protocol" is unchanged, and keeping this script out of it
// means the script can never be the reason a merge is red — and that the
// release gate still runs no tests. It is a developer and executor check: run
// it after touching `env.ts`.
//
// No dependency is added. `typescript` is already a devDependency and this is
// exactly how the sibling `verify-feedback-fixtures.mjs` executes a `.ts`
// module, so there is one house pattern here rather than two. The cost of that
// pattern is that this script needs `node_modules`, unlike
// `verify-compliance-copy.mjs`, which imports `node:` built-ins only and runs
// from a bare checkout. That asymmetry is intentional.
//
// Run it from `web/`, the way the sibling script is run:
//
//   node scripts/verify-env-contract.mjs                 the env.ts contract
//   node scripts/verify-env-contract.mjs --env-example   the .env.example rules
//
// The `--env-example` mode is used by plan 00-03, not by 00-02. Exit codes:
// 0 clean · 1 a contract or file check failed · 2 the script was misused.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const projectRoot = process.cwd();

// Copied from `verify-feedback-fixtures.mjs`, unchanged, so both verifiers load
// TypeScript the same way. `localRequire` throwing on every unmapped specifier
// is what turns this into a structural check rather than an assertion: see the
// empty require map at the call site below.
function loadTypeScriptModule(filePath, requireMap = {}) {
  const source = fs.readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier in requireMap) return requireMap[specifier];
    throw new Error(`Unexpected runtime import in ${filePath}: ${specifier}`);
  };
  const evaluate = new Function(
    "exports",
    "require",
    "module",
    "__filename",
    "__dirname",
    output,
  );
  evaluate(
    moduleRecord.exports,
    localRequire,
    moduleRecord,
    filePath,
    path.dirname(filePath),
  );
  return moduleRecord.exports;
}

let assertions = 0;

const eq = (actual, expected, message) => {
  assert.equal(actual, expected, message);
  assertions += 1;
};
const ok = (value, message) => {
  assert.ok(value, message);
  assertions += 1;
};
const deep = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
};

const ENV_PATH = path.join(projectRoot, "src/lib/env.ts");
const ENV_SOURCE = fs.readFileSync(ENV_PATH, "utf8");

// The empty require map is the point of the whole design. `localRequire` throws
// on any specifier at all, so a clean load here is proof that `env.ts` pulled
// in nothing — no `next/*`, no `server-only`, no schema library — and proof
// that it has no top-level side effect that throws. The assertion is the
// *absence* of a failure on the next line, which is not obvious from reading
// it, hence this comment.
//
// A runtime load cannot see a type-only import, because the transpiler erases
// it before this script gets the output, so the source-level checks further
// down close that gap. Between the two, "imports nothing" is fully covered.
const env = loadTypeScriptModule(ENV_PATH, {});

for (const name of [
  "DRIVERS",
  "resolveDriver",
  "featureFlag",
  "MisconfiguredDriverError",
  "publicEnv",
  "FEATURE_FLAG_NAMES",
]) {
  ok(env[name] !== undefined, `env.ts must export ${name}`);
}

// A second transcription of the frozen INTERFACES §10 table. Two independent
// copies is the whole point: an edit to one without an interface ask fails
// here instead of surfacing in whichever lane happens to boot first.
const EXPECTED_DRIVER_TABLE = {
  crs: {
    selector: "CRS_DRIVER",
    values: ["mock", "sandbox"],
    fallback: "mock",
    requires: {
      sandbox: [
        "CRS_BASE_URL",
        "CRS_API_KEY",
        "CRS_SECRET",
      ],
    },
  },
  billing: {
    selector: "BILLING_DRIVER",
    values: ["mock", "stripe"],
    fallback: "mock",
    requires: {
      stripe: [
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "CONSUMER_MONITORING_PRICE_REF",
        "STRIPE_PRICE_OPERATOR_BASE",
        "STRIPE_PRICE_OPERATOR_SEAT",
      ],
    },
  },
  idv: {
    selector: "IDV_DRIVER",
    values: ["mock", "crs"],
    fallback: "mock",
    requires: {
      crs: ["CRS_DRIVER", "CRS_BASE_URL", "CRS_API_KEY", "CRS_SECRET"],
    },
  },
  ai: {
    selector: "AI_DRIVER",
    values: ["mock", "openrouter"],
    fallback: "mock",
    requires: { openrouter: ["OPENROUTER_API_KEY"] },
  },
  vault: {
    selector: "VAULT_DRIVER",
    values: ["fixture", "supabase"],
    fallback: "fixture",
    requires: { supabase: ["VAULT_SUPABASE_URL", "VAULT_SERVICE_KEY"] },
  },
  credit_report_parser: {
    selector: "CREDIT_REPORT_PARSER_DRIVER",
    values: ["fixture", "unavailable"],
    fallback: "fixture",
    requires: {},
  },
  email: {
    selector: "EMAIL_DRIVER",
    values: ["mock", "resend"],
    fallback: "mock",
    requires: { resend: ["RESEND_API_KEY", "EMAIL_FROM_ADDRESS"] },
  },
};

// Every key the fully configured form of each real driver needs, so the
// normalization and no-auto-upgrade checks below can select a driver without
// tripping the R4C-03/R4C-06 inbound-half requirements.
const COMPLETE_DRIVER_KEYS = {
  crs: {
    CRS_BASE_URL: "u",
    CRS_API_KEY: "k",
    CRS_SECRET: "s",
  },
  billing: {
    STRIPE_SECRET_KEY: "sk",
    STRIPE_WEBHOOK_SECRET: "whsec",
    CONSUMER_MONITORING_PRICE_REF: "price_monitoring",
    STRIPE_PRICE_OPERATOR_BASE: "price_base",
    STRIPE_PRICE_OPERATOR_SEAT: "price_seat",
  },
  email: { RESEND_API_KEY: "re", EMAIL_FROM_ADDRESS: "from" },
};

const SELECTOR_NAMES = Object.values(EXPECTED_DRIVER_TABLE).map(
  (spec) => spec.selector,
);

function verifyEnvContract() {
  deep(
    env.DRIVERS,
    EXPECTED_DRIVER_TABLE,
    "DRIVERS has drifted from the frozen INTERFACES §10 table",
  );

  // --- source-level rules -------------------------------------------------
  ok(
    !/^\s*import\s/m.test(ENV_SOURCE),
    "env.ts must not import anything, type-only imports included",
  );
  ok(
    !/^\s*(?:const|let|var)\s+\w+\s*=\s*resolveDriver/m.test(ENV_SOURCE),
    "env.ts must not resolve a driver at its own module load",
  );
  ok(
    !/process\.env\[/.test(ENV_SOURCE),
    "env.ts must never read process.env through a computed key — Next.js only inlines literal member expressions",
  );
  ok(
    /as const/.test(ENV_SOURCE),
    "the DRIVERS table must be `as const` so lanes get exhaustiveness checking",
  );

  // --- resolveDriver: unset and blank fall back ---------------------------
  for (const [service, spec] of Object.entries(EXPECTED_DRIVER_TABLE)) {
    eq(
      env.resolveDriver(service, {}),
      spec.fallback,
      `${service} must fall back to ${spec.fallback} when its selector is unset`,
    );
    for (const blank of ["", " ", "\t", "   \n "]) {
      eq(
        env.resolveDriver(service, { [spec.selector]: blank }),
        spec.fallback,
        `${spec.selector} set to a blank value must count as unset`,
      );
    }
  }

  // --- resolveDriver: normalization ---------------------------------------
  const crsSandboxKeys = COMPLETE_DRIVER_KEYS.crs;
  for (const spelling of ["sandbox", "SANDBOX", "  sandbox  ", "SandBox"]) {
    eq(
      env.resolveDriver("crs", { CRS_DRIVER: spelling, ...crsSandboxKeys }),
      "sandbox",
      "casing and surrounding whitespace must be normalized",
    );
  }
  eq(
    env.resolveDriver("vault", {
      VAULT_DRIVER: "supabase",
      VAULT_SUPABASE_URL: "u",
      VAULT_SERVICE_KEY: "k",
    }),
    "supabase",
    "a fully configured explicit selector must be honoured",
  );
  eq(
    env.resolveDriver("crs", { CRS_DRIVER: "mock" }),
    "mock",
    "explicitly naming a driver with no required keys must not throw",
  );
  eq(
    env.resolveDriver("credit_report_parser", {
      CREDIT_REPORT_PARSER_DRIVER: "unavailable",
    }),
    "unavailable",
    "the explicit unavailable parser arm must be honoured",
  );

  // --- resolveDriver: R2, a present key never auto-upgrades ---------------
  // Under the other reading, dropping a key into Vercel would switch a live
  // driver on production `main` with no code change and nothing in the plan of
  // record saying it happened. DEC-OWN-CREDLESS step 4 makes the swap-in an
  // explicit "flip the driver env".
  eq(
    env.resolveDriver("billing", { ...COMPLETE_DRIVER_KEYS.billing }),
    "mock",
    "a present key must not upgrade an unset BILLING_DRIVER",
  );
  eq(
    env.resolveDriver("crs", { ...COMPLETE_DRIVER_KEYS.crs }),
    "mock",
    "a present key must not upgrade an unset CRS_DRIVER",
  );
  eq(
    env.resolveDriver("vault", {
      VAULT_SUPABASE_URL: "u",
      VAULT_SERVICE_KEY: "k",
    }),
    "fixture",
    "a present key must not upgrade an unset VAULT_DRIVER",
  );

  // --- resolveDriver: the throwing cases ----------------------------------
  // `names` must all appear in the message, `absent` must not appear at all.
  // Everything in `absent` is a value that was handed to `resolveDriver`
  // through the environment source, so this is the check that keeps a
  // credential out of a Vercel build log.
  const throwsNaming = (run, { names = [], absent = [] }, description) => {
    let caught;
    try {
      run();
    } catch (error) {
      caught = error;
    }
    ok(
      caught instanceof env.MisconfiguredDriverError,
      `${description} must throw MisconfiguredDriverError`,
    );
    ok(caught instanceof Error, `${description} must throw an Error subclass`);
    for (const name of names) {
      ok(
        caught.message.includes(name),
        `${description} must name ${name} in its message`,
      );
    }
    for (const value of absent) {
      ok(
        !caught.message.includes(value),
        `${description} must not echo a value read from the environment`,
      );
    }
    return caught;
  };

  const bothMissing = throwsNaming(
    () => env.resolveDriver("crs", { CRS_DRIVER: "sandbox" }),
    { names: ["CRS_DRIVER", "sandbox", "CRS_BASE_URL", "CRS_API_KEY", "CRS_SECRET"] },
    "CRS_DRIVER=sandbox with credentials absent",
  );
  deep(
    [...bothMissing.missingKeys].sort(),
    [
      "CRS_API_KEY",
      "CRS_BASE_URL",
      "CRS_SECRET",
    ],
    "the error must carry every missing key, not the first one",
  );

  // --- R4C-03/R4C-06: each driver declares the values it needs at construction -----
  // The CRS webhook route remains independently fail-closed without Basic credentials; coupling
  // those portal-configured inbound values to outbound client boot would prevent sandbox API use.
  // The Stripe adapter rejects every event without a signing secret and every
  // `subscriptions.create` without a real price id, and the Resend factory
  // throws without a from address — so selection has to fail at preflight.
  const missingOnly = (run, expected, description) => {
    const caught = throwsNaming(run, { names: expected }, description);
    deep(
      [...caught.missingKeys].sort(),
      [...expected].sort(),
      `${description} must carry exactly the missing keys`,
    );
  };
  missingOnly(
    () => env.resolveDriver("crs", { CRS_DRIVER: "sandbox", CRS_BASE_URL: "u", CRS_API_KEY: "k" }),
    ["CRS_SECRET"],
    "CRS_DRIVER=sandbox without the API secret",
  );
  missingOnly(
    () => env.resolveDriver("billing", {
      BILLING_DRIVER: "stripe",
      STRIPE_SECRET_KEY: "sk",
      CONSUMER_MONITORING_PRICE_REF: "price_monitoring",
      STRIPE_PRICE_OPERATOR_BASE: "price_base",
      STRIPE_PRICE_OPERATOR_SEAT: "price_seat",
    }),
    ["STRIPE_WEBHOOK_SECRET"],
    "BILLING_DRIVER=stripe without the inbound signing secret",
  );
  missingOnly(
    () => env.resolveDriver("billing", {
      BILLING_DRIVER: "stripe",
      STRIPE_SECRET_KEY: "sk",
      STRIPE_WEBHOOK_SECRET: "whsec",
    }),
    [
      "CONSUMER_MONITORING_PRICE_REF",
      "STRIPE_PRICE_OPERATOR_BASE",
      "STRIPE_PRICE_OPERATOR_SEAT",
    ],
    "BILLING_DRIVER=stripe without provider price references",
  );
  missingOnly(
    () => env.resolveDriver("email", {
      EMAIL_DRIVER: "resend",
      RESEND_API_KEY: "re",
    }),
    ["EMAIL_FROM_ADDRESS"],
    "EMAIL_DRIVER=resend without a from address",
  );
  missingOnly(
    () => env.resolveDriver("email", {
      EMAIL_DRIVER: "resend",
      EMAIL_FROM_ADDRESS: "from",
    }),
    ["RESEND_API_KEY"],
    "EMAIL_DRIVER=resend without an API key",
  );

  // The positive arm of the same property: a complete configuration selects.
  eq(
    env.resolveDriver("crs", { CRS_DRIVER: "sandbox", ...COMPLETE_DRIVER_KEYS.crs }),
    "sandbox",
    "a complete sandbox CRS configuration must still select",
  );
  eq(
    env.resolveDriver("billing", {
      BILLING_DRIVER: "stripe",
      ...COMPLETE_DRIVER_KEYS.billing,
    }),
    "stripe",
    "a complete Stripe configuration must still select",
  );
  eq(
    env.resolveDriver("email", { EMAIL_DRIVER: "resend", ...COMPLETE_DRIVER_KEYS.email }),
    "resend",
    "a complete Resend configuration must still select",
  );

  // A value that looks like a credential, to prove the no-echo rule on the
  // path where the value came out of the environment source.
  const SENTINEL = "sentinel-secret-must-not-appear-in-any-message";
  throwsNaming(
    () =>
      env.resolveDriver("vault", {
        VAULT_DRIVER: "supabase",
        VAULT_SUPABASE_URL: SENTINEL,
      }),
    {
      names: ["VAULT_SERVICE_KEY"],
      absent: [SENTINEL, "VAULT_SUPABASE_URL"],
    },
    "VAULT_DRIVER=supabase with only the URL set",
  );
  throwsNaming(
    () =>
      env.resolveDriver("crs", {
        ...COMPLETE_DRIVER_KEYS.crs,
        CRS_DRIVER: "sandbox",
        CRS_API_KEY: "   ",
      }),
    { names: ["CRS_API_KEY"], absent: ["CRS_BASE_URL"] },
    "a blank required key",
  );
  throwsNaming(
    () => env.resolveDriver("crs", { CRS_DRIVER: "sandox" }),
    { names: ["CRS_DRIVER", "mock", "sandbox"], absent: ["sandox"] },
    "a typo'd CRS_DRIVER",
  );
  throwsNaming(
    () => env.resolveDriver("crs", { CRS_DRIVER: SENTINEL }),
    { names: ["mock", "sandbox"], absent: [SENTINEL] },
    "an unknown CRS_DRIVER value that looks like a credential",
  );
  eq(
    env.resolveDriver("idv", {
      IDV_DRIVER: "crs",
      CRS_DRIVER: "sandbox",
      ...COMPLETE_DRIVER_KEYS.crs,
    }),
    "crs",
    "IDV_DRIVER selects the implemented CRS adapter only from a complete CRS configuration",
  );
  throwsNaming(
    () => env.resolveDriver("idv", { IDV_DRIVER: "someprovider" }),
    { names: ["IDV_DRIVER", "mock", "crs"], absent: ["someprovider"] },
    "IDV_DRIVER naming a provider nobody has added to the table",
  );
  throwsNaming(
    () => env.resolveDriver("idv", { IDV_DRIVER: "crs" }),
    { names: ["CRS_DRIVER", "CRS_BASE_URL", "CRS_API_KEY", "CRS_SECRET"] },
    "IDV_DRIVER=crs without a complete CRS configuration",
  );
  throwsNaming(
    () => env.resolveDriver("billing", { BILLING_DRIVER: "stripe" }),
    { names: ["BILLING_DRIVER", "stripe", "STRIPE_SECRET_KEY"] },
    "BILLING_DRIVER=stripe with no key",
  );
  throwsNaming(
    () => env.resolveDriver("ai", { AI_DRIVER: "openrouter" }),
    { names: ["AI_DRIVER", "openrouter", "OPENROUTER_API_KEY"] },
    "AI_DRIVER=openrouter with no key",
  );
  throwsNaming(
    () => env.resolveDriver("credit_report_parser", {
      CREDIT_REPORT_PARSER_DRIVER: "unknown-parser",
    }),
    {
      names: ["CREDIT_REPORT_PARSER_DRIVER", "fixture", "unavailable"],
      absent: ["unknown-parser"],
    },
    "an unknown credit report parser",
  );
  throwsNaming(
    () => env.resolveDriver("email", { EMAIL_DRIVER: "resend" }),
    { names: ["EMAIL_DRIVER", "resend", "RESEND_API_KEY"] },
    "EMAIL_DRIVER=resend with no key",
  );
  throwsNaming(
    () => env.resolveDriver("email", { EMAIL_DRIVER: "unsupported" }),
    { names: ["EMAIL_DRIVER", "mock", "resend"], absent: ["unsupported"] },
    "an unknown email driver",
  );

  // --- featureFlag --------------------------------------------------------
  deep(
    [...env.FEATURE_FLAG_NAMES],
    [
      "FEATURE_REAL_AUTH",
      "FEATURE_ENROLLMENT",
      "FEATURE_ANALYSIS",
      "FEATURE_TRACKER",
      "FEATURE_BILLING",
      "FEATURE_VAULT",
      "FEATURE_SUPPORT",
      "FEATURE_APPLICATIONS",
      "FEATURE_FEES",
      "FEATURE_REFERRALS",
      "FEATURE_REVENUE",
      "FEATURE_KB",
      "FEATURE_ANCILLARY",
      "FEATURE_PAID_REFRESH",
      "FEATURE_CONSOLE_OPS",
      "FEATURE_EMAIL",
      "FEATURE_AFFILIATES",
      "FEATURE_ADMIN",
      "FEATURE_TENANCY",
      "FEATURE_BILLING_OPS",
      "FEATURE_TIMELINE",
      "FEATURE_DEMO_QUICK_SIGN_IN",
    ],
    "the registered flags must be present, unprefixed",
  );

  for (const flag of env.FEATURE_FLAG_NAMES) {
    eq(env.featureFlag(flag, {}), false, `${flag} must be off when unset`);
  }
  for (const value of [
    "",
    "   ",
    "0",
    "false",
    "FALSE",
    "off",
    "no",
    "banana",
    "2",
    "true1",
    "truthy",
    "onward",
  ]) {
    eq(
      env.featureFlag("FEATURE_ENROLLMENT", { FEATURE_ENROLLMENT: value }),
      false,
      `only an explicitly truthy value may turn a flag on (${JSON.stringify(value)})`,
    );
  }
  eq(
    env.featureFlag("FEATURE_CONSOLE_OPS", { FEATURE_CONSOLE_OPS: "true" }),
    true,
    "FEATURE_CONSOLE_OPS accepts an explicitly truthy token",
  );
  for (const value of [undefined, "", "   ", "0", "false", "off", "banana"]) {
    eq(
      env.featureFlag("FEATURE_AFFILIATES", { FEATURE_AFFILIATES: value }),
      false,
      `FEATURE_AFFILIATES must remain off for ${JSON.stringify(value)}`,
    );
  }
  for (const value of [
    "1",
    "true",
    "TRUE",
    " true ",
    "on",
    "ON",
    "yes",
    "Yes",
    "  YES",
  ]) {
    eq(
      env.featureFlag("FEATURE_ENROLLMENT", { FEATURE_ENROLLMENT: value }),
      true,
      `${JSON.stringify(value)} must turn a flag on`,
    );
  }
  for (const value of ["1", "true", "on", "yes"]) {
    eq(
      env.featureFlag("FEATURE_AFFILIATES", { FEATURE_AFFILIATES: value }),
      true,
      `FEATURE_AFFILIATES must turn on for ${JSON.stringify(value)}`,
    );
  }
  for (const value of [undefined, "", "   ", "0", "false", "off", "banana"]) {
    eq(
      env.featureFlag("FEATURE_BILLING_OPS", { FEATURE_BILLING_OPS: value }),
      false,
      `FEATURE_BILLING_OPS must remain off for ${JSON.stringify(value)}`,
    );
  }
  for (const value of ["1", "true", "on", "yes"]) {
    eq(
      env.featureFlag("FEATURE_BILLING_OPS", { FEATURE_BILLING_OPS: value }),
      true,
      `FEATURE_BILLING_OPS must turn on for ${JSON.stringify(value)}`,
    );
  }

  // The browser branch. `window` is the only way into it, and the flag is
  // documented server-side, so the check is that it warns and still answers
  // false rather than throwing — LANE-TERMINAL-BRIEF §5 forbids the throw.
  // Both globals are restored in `finally` so nothing leaks into later
  // assertions; the environment source is still injected, never mutated.
  const warnings = [];
  const realConsoleError = console.error;
  let browserResult;
  try {
    globalThis.window = {};
    console.error = (message) => warnings.push(message);
    browserResult = env.featureFlag("FEATURE_TRACKER", {
      FEATURE_TRACKER: "true",
    });
  } finally {
    console.error = realConsoleError;
    delete globalThis.window;
  }
  eq(warnings.length, 1, "a browser-side flag read must warn exactly once");
  ok(
    typeof browserResult === "boolean",
    "a browser-side flag read must answer, not throw",
  );

  // --- publicEnv ----------------------------------------------------------
  // Next.js inlines `process.env.SOME_LITERAL_NAME` and nothing else, so the
  // assertion is on the shape of the source, not only on the return value:
  // a refactor into the generic reader would keep returning undefined here in
  // Node and start returning undefined in the browser too.
  const PUBLIC_ACCESSORS = {
    supabaseUrl: "process.env.NEXT_PUBLIC_SUPABASE_URL",
    supabaseAnonKey: "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY",
    stripePublishableKey: "process.env.NEXT_PUBLIC_STRIPE_PK",
  };
  deep(
    Object.keys(env.publicEnv).sort(),
    Object.keys(PUBLIC_ACCESSORS).sort(),
    "publicEnv must expose exactly the three genuinely public keys",
  );
  for (const [accessor, expression] of Object.entries(PUBLIC_ACCESSORS)) {
    const body = String(env.publicEnv[accessor]);
    ok(
      body.includes(expression),
      `publicEnv.${accessor} must read the literal ${expression}`,
    );
    ok(
      !/process\.env\[/.test(body),
      `publicEnv.${accessor} must not use a computed key`,
    );
    assert.doesNotThrow(
      () => env.publicEnv[accessor](),
      `publicEnv.${accessor} must not throw when the key is absent`,
    );
    assertions += 1;
  }
  ok(
    !/NEXT_PUBLIC_SUPABASE_SERVICE/.test(ENV_SOURCE),
    "the service-role key is never NEXT_PUBLIC (INTERFACES §3)",
  );

  // --- the default parameter ----------------------------------------------
  // `process.env` as a default argument is a global reference evaluated at call
  // time, not an import and not a top-level side effect. Skipped rather than
  // failed when the ambient shell already sets one of these, so the script
  // stays honest on a developer machine with a populated `.env`.
  const ambientSelectors = SELECTOR_NAMES.filter(
    (name) => process.env[name] !== undefined,
  );
  if (ambientSelectors.length === 0) {
    eq(
      env.resolveDriver("crs"),
      "mock",
      "resolveDriver must read process.env by default",
    );
  }
  if (process.env.FEATURE_TRACKER === undefined) {
    eq(
      env.featureFlag("FEATURE_TRACKER"),
      false,
      "featureFlag must read process.env by default",
    );
  }

  console.log(
    `env contract passed — ${assertions} assertions over ${ENV_PATH.replace(`${projectRoot}/`, "")}`,
  );
  if (ambientSelectors.length > 0) {
    console.log(
      `note: skipped the default-argument checks, the shell already sets ${ambientSelectors.join(", ")}`,
    );
  }
}

// Every key `.env.example` has to carry, minus the twenty flags and the five
// selectors, which are read out of `env.ts` so there is one source for them.
// The inventory is BACKEND-SPEC §10 plus the existing build key; see
// `.planning/phases/00-day-1-unblocks/00-RESEARCH.md` §9 for the per-key notes.
const REQUIRED_BASE_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "FEES_E2E_OWNER_PASSWORD",
  "FEES_E2E_ADMIN_PASSWORD",
  "REFERRAL_PLATFORM_ORG_ID",
  "REFERRAL_INTAKE_ORIGIN",
  "VAULT_SUPABASE_URL",
  "VAULT_SERVICE_KEY",
  "CRS_BASE_URL",
  "CRS_API_KEY",
  "CRS_SECRET",
  "CRS_WEBHOOK_BASIC_USER",
  "CRS_WEBHOOK_BASIC_PASS",
  "CRS_WEBHOOK_HMAC_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_STATEMENT_DESCRIPTOR",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PK",
  "STRIPE_PRICE_CONSUMER_MONITORING",
  // R4C-03: the reference the consumer subscription actually resolves through.
  // `STRIPE_PRICE_CONSUMER_MONITORING` above is the §10 wildcard spelling and
  // nothing reads it; `pricing/resolver.ts` reads this one, so it is the name
  // `requires.stripe` declares and the name `.env.example` has to carry.
  "CONSUMER_MONITORING_PRICE_REF",
  "STRIPE_PRICE_OPERATOR_BASE",
  "STRIPE_PRICE_OPERATOR_SEAT",
  // Phase 10 (S2.1). All three optional at runtime and read lazily by
  // web/src/lib/billing/config.ts; required here as *names* so the documented
  // resolution order stays discoverable from .env.example rather than only
  // from the module that reads it.
  "OPERATOR_BASE_PRICE_CENTS",
  "OPERATOR_SEAT_PRICE_CENTS",
  "OPERATOR_GRACE_DAYS",
  "DEFAULT_ORG_SLUG",
  "TRIAL_DAYS",
  "FORCE_PULL_PRICE_CENTS",
  "MONITORING_SPLIT_PCT",
  "SAAS_REFERRAL_BASE",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
  "OPENROUTER_SUPERVISOR_MODEL",
  "APP_ENV",
  "PLATFORM_TRAININGS_URL",
  "TRAINING_ATTESTATION_TEXT",
  "NORTHWEST_PARTNER_URL",
  "RESEND_API_KEY",
  "EMAIL_FROM_ADDRESS",
  "SHADCNBLOCKS_API_KEY",
  // 41236de bumped EXPECTED_KEY_COUNT 70→72 for the quick-sign-in pair but only
  // added the flag; the password name was the missing 72nd entry all along.
  "DEMO_QUICK_SIGN_IN_PASSWORD",
];

const EXPECTED_KEY_COUNT = 72;

// Used by plan 00-03, which is what rewrites `.env.example`. Running it before
// then reports the file as it stands today, which is one line with a value on
// it — that is correct behaviour, not a bug in this mode.
function verifyEnvExample() {
  const examplePath = path.join(projectRoot, ".env.example");
  const problems = [];

  if (!fs.existsSync(examplePath)) {
    console.error(`.env.example is missing at ${examplePath}`);
    process.exit(1);
  }

  const required = [
    ...REQUIRED_BASE_KEYS,
    ...env.FEATURE_FLAG_NAMES,
    ...SELECTOR_NAMES,
  ];
  const unique = [...new Set(required)];
  if (unique.length !== EXPECTED_KEY_COUNT) {
    problems.push(
      `the required inventory holds ${unique.length} names, expected ${EXPECTED_KEY_COUNT} — BACKEND-SPEC §10 or INTERFACES §10 has changed and this script has not`,
    );
  }

  const lines = fs.readFileSync(examplePath, "utf8").split("\n");
  const present = new Set();

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;

    const named = /^([A-Z][A-Z0-9_]*)=/.exec(trimmed);
    if (!named) {
      problems.push(
        `line ${lineNumber}: not a comment, not blank, and not a \`NAME=\` line`,
      );
      return;
    }

    present.add(named[1]);
    // The value is never echoed. `.env.example` is committed, and a name plus a
    // line number is everything a reader needs to fix it.
    if (!/^[A-Z][A-Z0-9_]*=$/.test(trimmed)) {
      problems.push(
        `line ${lineNumber}: ${named[1]} carries a value — .env.example is key names only`,
      );
    }
  });

  for (const key of unique) {
    if (!present.has(key)) problems.push(`missing key: ${key}`);
  }

  if (problems.length > 0) {
    console.error(`.env.example contract failed — ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(
    `.env.example contract passed — ${unique.length} required key names present, every line a bare NAME=`,
  );
}

const mode = process.argv[2];

if (mode === undefined) {
  verifyEnvContract();
} else if (mode === "--env-example") {
  verifyEnvExample();
} else {
  console.error(
    "usage: node scripts/verify-env-contract.mjs [--env-example]  (run from web/)",
  );
  process.exit(2);
}
