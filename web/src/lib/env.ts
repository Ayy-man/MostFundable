// env.ts — integration-owned shared plumbing for driver selection, feature
// flags and public environment access. Every lane imports it; no lane owns it.
//
// INTERFACES §5.1 allocates the service directories — `crs/`, `analysis/` and
// `llm/` to lane C, `enrollment/`, `billing/` and `idv/` to lane B, `vault/` to
// lane D, `auth/` to lane A — so this file is deliberately top-level instead.
// What the five lanes have to agree on is the *resolution semantics*, not the
// drivers themselves; each lane still writes its own drivers in its own
// directory.
//
// Two properties this file is required to hold, and why each one matters:
//
//   1. It imports nothing. Not `next/*`, not `server-only`, not a schema
//      library. That keeps the module runnable outside a Next build, which is
//      what lets `web/scripts/verify-env-contract.mjs` execute it with an empty
//      require map — any import this file ever gained would fail that script,
//      so the rule is proven structurally rather than asserted in a comment.
//
//   2. It has no top-level statement with a side effect and never throws when
//      imported (LANE-TERMINAL-BRIEF §5). There is no `const CRS =
//      resolveDriver("crs")` in here. A service module makes that call during
//      its own module evaluation, and *that* is what "throws at boot" means in
//      INTERFACES §10 — reachable only through an explicit, wrong selector.
//      With no environment set at all, which is CI, a fresh clone and Vercel
//      today, every service resolves to its fallback and nothing throws.
//
// The DRIVERS table below is the frozen INTERFACES §10 table transcribed as
// data. It lives here once so that five parallel lanes cannot each write their
// own `process.env.X_DRIVER === "sandbox"` comparison and quietly disagree
// about the answer until merge day. Changing a row, adding a driver or adding a
// selector is an interface ask (INTERFACES §1), not an edit.

/**
 * The shape every reader accepts. Injecting the source rather than reaching for
 * `process.env` inside the function body is what makes this module testable
 * with plain object literals: no environment mutation, no module-cache tricks,
 * no ordering hazards between assertions.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * The frozen INTERFACES §10 driver table.
 *
 * `requires` is a per-driver list rather than the single sentinel key §10's
 * "Default when the key is absent" column names. That column names the key that
 * signals intent; it is not the complete requirement. A sandbox CRS driver
 * needs a base URL as well as an API key, and the VAULT supabase driver needs
 * both its URL and its service key, so every entry in the list has to be
 * present and non-blank before the driver can be selected.
 *
 * R4C-03/R4C-06 fixed what "complete requirement" means, because the earlier
 * lists held only the *outbound* half. A driver has an inbound half too, and a
 * configuration that creates subscriptions while every inbound webhook is
 * rejected for a missing signing secret is a gate defect rather than a
 * deployment mistake: the money moves and nothing settles. So the rule this
 * table now enforces is that a list names every value the driver's own code
 * treats as mandatory — the credentials it calls out with, the credentials it
 * authenticates callbacks with, and the provider-side references it cannot
 * substitute a placeholder for. The three price references are in the Stripe
 * list for that last reason: `pricing/resolver.ts` falls back to
 * `mock_price_…` strings that only the mock driver can honour, so a real Stripe
 * deployment without them fails on its first `subscriptions.create`.
 *
 * Values a driver genuinely treats as optional stay out. CRS's HMAC secret and
 * source-IP allowlist each skip their own check when unset (`crs/webhook.ts`),
 * and `CRS_CLOSE_MEMBER_PATH` is an endpoint CRS has never published, so
 * requiring it would make the sandbox arm unbootable over a capability the
 * provider does not offer.
 *
 * The CRS IDV arm requires the CRS selector and outbound credentials as one
 * configuration unit. This prevents `IDV_DRIVER=crs` from silently binding to
 * the default mock CRS adapter when the provider selector was never flipped.
 */
export const DRIVERS = {
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
} as const;

/** The services §10 puts behind a driver interface. */
export type ServiceKey = keyof typeof DRIVERS;

/**
 * The driver names legal for one service. Deriving this from the `as const`
 * table is what gives a lane exhaustiveness checking on `switch (driver)` and a
 * type error — rather than a runtime surprise — when someone invents a sixth
 * driver without filing the interface ask.
 */
export type DriverName<S extends ServiceKey> =
  (typeof DRIVERS)[S]["values"][number];

/**
 * The widened row shape, so the resolver can walk the table generically.
 *
 * Exported because §10's table is frozen and a service that is *not* in it
 * still has to select the same way. A module outside this file declares its own
 * one-row table of this shape and hands it to `resolveDriverFromSpec` below;
 * what it must never do is borrow another service's selector, which is exactly
 * the defect the KB source carried from Phase 16 to Phase 8 (docs/GAPS.md
 * G-KB-01). Sharing the resolution *semantics* is the point of this file;
 * sharing a `*_DRIVER` variable between two services is a bug, because flipping
 * one service's driver then silently reconfigures the other.
 */
export type DriverSpec = {
  readonly selector: string;
  readonly values: readonly string[];
  readonly fallback: string;
  readonly requires: Readonly<Record<string, readonly string[] | undefined>>;
};

/**
 * Thrown when an explicit selector cannot be honoured.
 *
 * Messages name environment **keys** and driver names taken from the table
 * above. They never interpolate a value read out of the environment source:
 * "expected CRS_API_KEY, got …" is the reflexive phrasing and it would put a
 * credential into a Vercel build log. A driver name is safe to echo because it
 * comes from `DRIVERS`, not from the caller's environment.
 */
export class MisconfiguredDriverError extends Error {
  readonly service: string;
  readonly selector: string;
  readonly missingKeys: readonly string[];

  constructor(
    message: string,
    service: string,
    selector: string,
    missingKeys: readonly string[] = [],
  ) {
    super(message);
    this.name = "MisconfiguredDriverError";
    this.service = service;
    this.selector = selector;
    this.missingKeys = missingKeys;
  }
}

/**
 * True when a value is absent for our purposes.
 *
 * Blank counts as absent, and that is load-bearing rather than tidy-minded:
 * `.env.example` ships blank values, so a developer who copies it to
 * `.env.local` has every selector set to the empty string. If blank counted as
 * set, a fresh clone would fail on every driver before it rendered a page.
 */
function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

/**
 * Resolve the driver for one service.
 *
 * - Selector unset, empty or whitespace-only → the table fallback. That holds
 *   even when the driver's keys happen to be present, because the swap-in path
 *   in DEC-OWN-CREDLESS step 4 is explicitly "flip the driver env". Upgrading
 *   automatically would let a key dropped into Vercel switch a live driver on
 *   production `main` with no code change and nothing in the plan of record
 *   saying it happened.
 * - Selector naming a valid driver whose required keys are all present → that
 *   driver.
 * - Selector naming a valid driver with any required key missing or blank →
 *   throws, naming every missing key at once. One boot, one complete fix.
 * - Selector naming a value not in the table → throws, listing the legal
 *   values. A typo like `CRS_DRIVER=sandox` degrading silently to mock is
 *   exactly the hidden misconfiguration §10's throw rule exists to surface.
 *
 * Casing and surrounding whitespace are normalized, because `.env` files pick
 * up trailing spaces easily and every §10 value is lowercase.
 *
 * There is no memoization here. §10's "chosen once at module load" is satisfied
 * by the calling service module holding the result in a module-level `const`;
 * a cache in this file would make the function order-dependent and hostile to
 * testing.
 */
export function resolveDriver<S extends ServiceKey>(
  service: S,
  env: EnvSource = process.env,
): DriverName<S> {
  return resolveDriverFromSpec(service, DRIVERS[service], env) as DriverName<S>;
}

/**
 * The resolution itself, against any table of the `DriverSpec` shape.
 *
 * `resolveDriver` is this function bound to the frozen §10 table. A service
 * that §10 does not carry — the KB source is the one today — declares its own
 * table next to its own driver code and calls in here, so it gets identical
 * semantics (blank is unset, no auto-upgrade from a present key, an unknown
 * value throws, a missing required key names every missing key at once) without
 * an edit to a table two files transcribe and an interface ask governs.
 */
export function resolveDriverFromSpec<S extends DriverSpec>(
  service: string,
  spec: S,
  env: EnvSource = process.env,
): S["values"][number] {
  const raw = env[spec.selector];

  if (isBlank(raw)) {
    return spec.fallback;
  }

  const normalized = (raw as string).trim().toLowerCase();

  // Take the name back out of the table rather than reusing the normalized
  // input, so everything interpolated below provably comes from DRIVERS.
  const selected = spec.values.find((value) => value === normalized);

  if (selected === undefined) {
    throw new MisconfiguredDriverError(
      `${spec.selector} is set to a value that is not in the ${service} driver table. ` +
        `Valid values: ${spec.values.join(", ")}. ` +
        `Clear ${spec.selector} to fall back to ${spec.fallback}.`,
      service,
      spec.selector,
    );
  }

  const required = spec.requires[selected] ?? [];
  const missing = required.filter((key) => isBlank(env[key]));

  if (missing.length > 0) {
    const plural = missing.length === 1 ? "key is" : "keys are";
    throw new MisconfiguredDriverError(
      `${spec.selector} selects the ${selected} driver, but its required ` +
        `environment ${plural} not set: ${missing.join(", ")}. ` +
        `Set ${missing.length === 1 ? "it" : "them"}, or clear ${spec.selector} ` +
        `to fall back to ${spec.fallback}.`,
      service,
      spec.selector,
      missing,
    );
  }

  return selected;
}

/**
 * The feature flags from BACKEND-SPEC §10 and INTERFACES §6, unprefixed
 * exactly as both documents write them, so five lanes read one set of names.
 *
 * INTERFACES §6 maps them to lanes: `FEATURE_REAL_AUTH` is lane A,
 * `FEATURE_ENROLLMENT` is lane B, `FEATURE_ANALYSIS` is lane C, `FEATURE_VAULT`
 * is lane D, `FEATURE_TRACKER` is integration, and `FEATURE_BILLING` plus
 * `FEATURE_SUPPORT` belong to Sprint 2, as do `FEATURE_APPLICATIONS` (Phase 11's
 * applications and outcomes surface), `FEATURE_FEES` (Phase 12's fee models),
 * `FEATURE_REFERRALS` (Phase 15's consumer link), `FEATURE_REVENUE`
 * (Phase 14's revenue ledgers), and `FEATURE_KB` (Phase 16's KB assistant).
 * `FEATURE_ANCILLARY` (Phase 17), `FEATURE_PAID_REFRESH` (Phase 18), and
 * `FEATURE_CONSOLE_OPS` (Phase 22).
 * `FEATURE_AFFILIATES` (Phase 24).
 * `FEATURE_ADMIN` (Phase 23 governance).
 * `FEATURE_TENANCY` (Phase 20).
 * `FEATURE_BILLING_OPS` (Phase 21).
 * `FEATURE_TIMELINE` enables durable conversation timeline reads and its two
 * operator write endpoints.
 * `FEATURE_DEMO_QUICK_SIGN_IN` is the only flag here that gates a convenience
 * rather than a product slice: with it on, `/sign-in` offers one button per demo
 * role that signs that role's seeded account in. It requires `FEATURE_REAL_AUTH`
 * as well, and it is off by default because anyone who can reach the page with it
 * on can sign in as the platform admin.
 * A lane reads only its own
 * flag, and only the integration terminal ever flips one on.
 */
export const FEATURE_FLAG_NAMES = [
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
] as const;

/** One of the registered §10 flag names. */
export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number];

/**
 * The closed set of values that can turn a flag on. Everything outside it —
 * unset, blank, `0`, `false`, `off`, arbitrary junk — reads as off, which makes
 * OFF the structural default rather than a convention. BACKEND-SPEC §10 states
 * "OFF on `main`" in prose with nothing enforcing it; this list is the
 * enforcement. An absent Vercel variable cannot read as on, and neither can a
 * blank value copied out of `.env.example`.
 */
const TRUTHY_FLAG_VALUES: readonly string[] = ["1", "true", "on", "yes"];

/**
 * Read one feature flag. **Server-side.**
 *
 * All registered names are unprefixed, which means Next.js does not inline them into
 * the browser bundle, so a client component calling this gets `false`
 * unconditionally — indistinguishable from the flag genuinely being off. Read
 * the flag in a server component or route handler and pass the result down.
 *
 * The mechanism for exposing a flag to the client is an **open interface ask
 * carried to Phase 2**, filed by plan 00-06. It is pending, not decided against
 * — do not work around it by inventing a second, prefixed set of names.
 *
 * The browser call announces itself through `console.error` rather than a
 * throw, because LANE-TERMINAL-BRIEF §5 requires that nothing here throws and
 * because a silent `false` is the failure that costs a lane half a day.
 */
export function featureFlag(
  key: FeatureFlagName,
  env: EnvSource = process.env,
): boolean {
  if (typeof window !== "undefined") {
    console.error(
      `featureFlag(${key}) was called in the browser, where it always returns ` +
        `false: the flag is server-side only and its name is not inlined into ` +
        `the client bundle. Read it in a server component or route handler and ` +
        `pass the result down. Exposing flags to the client is an open ` +
        `interface ask carried to Phase 2.`,
    );
  }

  const raw = env[key];

  if (isBlank(raw)) {
    return false;
  }

  return TRUTHY_FLAG_VALUES.includes((raw as string).trim().toLowerCase());
}

// The three genuinely public keys, and the reason each one is written out
// longhand instead of going through the generic reader above.
//
// Next.js inlines an environment variable into the browser bundle only when the
// reference is a *literal* member expression on a `NEXT_PUBLIC_`-prefixed name.
// The official docs give two counter-examples explicitly: indexing the
// environment with a variable key, and reading through a local alias bound to
// the environment object. Both are exactly what a generic `readEnv(key: string)`
// helper does. Routing these three through the resolver would return `undefined`
// in the browser, silently, with no build error and no runtime warning:
// https://nextjs.org/docs/app/guides/environment-variables
//
// The prose above deliberately describes those two shapes instead of spelling
// them out, because `verify-env-contract.mjs` bans the computed-key form across
// the whole of this file — comments included, so nobody can copy one out of a
// comment into the code below it.
//
// So "tidy these up into the generic reader" is a refactor that looks correct,
// passes typecheck, passes the build, and breaks the browser. Do not do it.
//
// Keeping the list to exactly three entries is also the control that keeps
// server credentials out of the browser bundle (INTERFACES §3): the
// service-role key is never prefixed and is not here, so adding a fourth
// accessor is a visible diff a reviewer will see rather than a dynamic lookup
// nobody notices.
//
// The anon key has one canonical spelling, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
// with no dual acceptance. BACKEND-SPEC §10 writes it unprefixed, and the
// unprefixed name cannot reach the browser at all, so accepting both would work
// on the server and fail in the browser — a config that half-boots is harder to
// diagnose than one that does not boot. Plan 00-06 files the §10 amendment.

/** Lazy readers for the three keys that are meant to reach the browser. */
export const publicEnv = {
  supabaseUrl: (): string | undefined => process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: (): string | undefined =>
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  stripePublishableKey: (): string | undefined =>
    process.env.NEXT_PUBLIC_STRIPE_PK,
} as const;
