/**
 * The demo shell's identity selector.
 *
 * `getSession()` resolves a demo profile from the `x-mf-demo-profile-id` header
 * **or** the `mf_demo_profile_id` cookie. The e2e suites send the header; nothing
 * in the application wrote the cookie, so with `FEATURE_TRACKER` or
 * `FEATURE_ENROLLMENT` on, a browser reaching any flag-on surface got a 401 and
 * rendered its error state. This module closes that gap.
 *
 * What this is not: a credential. The cookie names a seeded demo profile and is
 * forgeable in exactly the way the existing header is. The access boundary is
 * `FEATURE_REAL_AUTH` plus row-level security, and this whole mechanism is
 * removed when that flag flips (07-CONTEXT D-06, threat T-07-05).
 *
 * Deliberately import-free at runtime and side-effect-free at module scope, so it
 * stays importable from a server component and unit-testable with no harness.
 */
import type { DemoRole } from "@/lib/demo/types";

export const DEMO_SESSION_COOKIE = "mf_demo_profile_id";

/**
 * Role to seeded `public.profiles.id`, from `supabase/seed.sql`. The consumer
 * slot is the un-enrolled newcomer (`a1…-0014`, client `a3…-0004` in Onboarding
 * with no consents, enrollment, run or plan), which is what makes the enrollment
 * beat repeatable after `npm run demo:reset`: `enrollments.client_id` is unique,
 * so an already-enrolled consumer — every persona seeded with a plan — answers
 * 409 to `POST /api/enroll`. The `thin_file` persona held this slot until
 * 2026-08-17 (GAPS G-3B-10); its seeded enrollment made the beat impossible.
 *
 * `demo-session.test.ts` asserts every UUID here appears in the seed, so a seed
 * that renumbers a profile fails the suite instead of the demo.
 */
export const DEMO_PROFILE_IDS: Readonly<Record<DemoRole, string>> = Object.freeze({
  admin: "00000000-0000-0000-0000-000000000001",
  affiliate: "a1000000-0000-0000-0000-000000000003",
  consumer: "a1000000-0000-0000-0000-000000000014",
  operator: "a1000000-0000-0000-0000-000000000001",
});

/**
 * The seeded display name and organisation behind each profile above, so the demo
 * chrome names the same person the API resolves. The platform admin has no org
 * row (`profiles.org_id` is null for it), so its detail names the platform.
 */
export const DEMO_PROFILE_IDENTITIES: Readonly<
  Record<DemoRole, { name: string; organization: string }>
> = Object.freeze({
  admin: { name: "Parker Platform Demo", organization: "MostFundable" },
  affiliate: { name: "Alex Affiliate Demo", organization: "Northbridge Funding Group" },
  consumer: { name: "Jordan Newcomer Demo", organization: "Northbridge Funding Group" },
  operator: { name: "Avery Northbridge Demo", organization: "Northbridge Funding Group" },
});

/**
 * The seeded sign-in address behind each profile above. These exist so the
 * `/sign-in` quick-sign-in buttons name an account rather than transcribing one:
 * `demo-session.test.ts` re-derives each address from `supabase/seed.sql` by
 * looking up the role's profile id in the seed's own `(id, email)` pairs, so a
 * seed that renumbers or renames an account fails the suite instead of shipping
 * a button that cannot sign in.
 */
export const DEMO_PROFILE_EMAILS: Readonly<Record<DemoRole, string>> = Object.freeze({
  admin: "admin@platform.example",
  affiliate: "affiliate@northbridge.example",
  consumer: "newcomer@northbridge.example",
  operator: "owner@northbridge.example",
});

/**
 * The seeded consumer accounts the quick-sign-in shortcut may pick between.
 *
 * `DEMO_PROFILE_EMAILS.consumer` is the newcomer, which is the right first
 * impression but the wrong account for checking a plan: it has no analysis.
 * These are the other seeded Northbridge consumers (`supabase/seed.sql`), each
 * a different readiness picture, and the route accepts one of them only by
 * exact match against this closed list — never a free-form address.
 */
export const DEMO_CONSUMER_PERSONA_EMAILS: readonly string[] = Object.freeze([
  "clean@northbridge.example",
  "derog@northbridge.example",
  "thin-file@northbridge.example",
  "newcomer@northbridge.example",
]);

/** The seeded sign-in address a demo role resolves to. */
export function demoProfileEmail(role: DemoRole): string {
  return DEMO_PROFILE_EMAILS[role];
}

/** The seeded profile id a demo role resolves to. */
export function demoProfileId(role: DemoRole): string {
  return DEMO_PROFILE_IDS[role];
}

/** Two-letter initials for a seeded display name, matching the chrome's own shape. */
export function demoInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Write the role's seeded profile id into the cookie `getSession()` reads.
 *
 * No `Secure` attribute: the local demo arm is plain HTTP on 127.0.0.1, and a
 * `Secure` cookie would silently never be set there, which is the failure mode
 * this module exists to prevent. Returns early with no side effect when there is
 * no `document`, so a server context can import the module safely.
 */
export function writeDemoSessionCookie(role: DemoRole): void {
  if (typeof document === "undefined") return;
  document.cookie = `${DEMO_SESSION_COOKIE}=${demoProfileId(role)}; path=/; SameSite=Lax`;
}
