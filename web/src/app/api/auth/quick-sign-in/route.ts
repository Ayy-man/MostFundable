import { revalidatePath } from "next/cache";
import { type NextRequest } from "next/server";

import { isAuthError } from "@/lib/auth/errors";
import { safeNextPath, sameOriginRedirect } from "@/lib/auth/redirect-target";
import { activeProfileRole } from "@/lib/auth/route-guard";
import { surfacePathFor } from "@/lib/auth/roles";
import { DEMO_CONSUMER_PERSONA_EMAILS, DEMO_PROFILE_EMAILS } from "@/lib/demo/demo-session";
import { type DemoRole } from "@/lib/demo/types";
import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";
import { featureFlag } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Sign in one of the four seeded demo accounts by role, for the development
 * phase. The button says "Operator"; the password never leaves the server.
 *
 * Three deliberate properties:
 *
 * 1. **Two flags, not one.** `FEATURE_REAL_AUTH` gates authentication at all and
 *    `FEATURE_DEMO_QUICK_SIGN_IN` gates this convenience on top of it, so the
 *    real sign-in form can ship without the buttons following it.
 * 2. **The credential is server-only.** The client posts a role name. The
 *    address comes from `DEMO_PROFILE_EMAILS`, which the demo-session suite
 *    re-derives from `supabase/seed.sql`, and the password comes from
 *    `DEMO_QUICK_SIGN_IN_PASSWORD` in the server environment. Nothing about the
 *    credential is inlined into the browser bundle.
 * 3. **It grants exactly what the seeded account has.** There is no privilege
 *    shortcut here: the request goes through the same `signInWithPassword` and
 *    the same profile-role lookup as the form, so a disabled or missing account
 *    fails the same way. What it does remove is the need to know the password —
 *    which is why the flag is off by default and why the accounts must stay
 *    demo-only.
 */
const GENERIC_FAILURE = "Those sign-in details were not accepted.";

const ROLES: readonly DemoRole[] = ["admin", "affiliate", "consumer", "operator"];

function readRole(value: unknown): DemoRole | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const { role } = value as Record<string, unknown>;

  // Compared against the closed role list rather than used as a key, so a
  // request cannot reach into the address map with an arbitrary string.
  return ROLES.find((candidate) => candidate === role) ?? null;
}

/**
 * An optional seeded consumer to sign in as instead of the role's default.
 * Honoured only for the consumer role and only by exact match against the closed
 * persona list; anything else is ignored rather than rejected, so an unknown
 * value degrades to the default account instead of leaking which ones exist.
 */
function readPersonaEmail(value: unknown, role: DemoRole): string | null {
  if (role !== "consumer" || typeof value !== "object" || value === null) return null;
  const { persona } = value as Record<string, unknown>;
  return DEMO_CONSUMER_PERSONA_EMAILS.find((candidate) => candidate === persona) ?? null;
}

export async function POST(request: NextRequest): Promise<Response> {
  // Read lazily and inside the handler, matching the sign-in route: nothing here
  // may throw at import time on a missing env, because the app has to build and
  // boot with no environment at all.
  if (!featureFlag("FEATURE_REAL_AUTH") || !featureFlag("FEATURE_DEMO_QUICK_SIGN_IN")) {
    return new Response(null, { status: 404 });
  }

  const password = process.env.DEMO_QUICK_SIGN_IN_PASSWORD;

  // An unset password disables the buttons rather than signing anyone in with a
  // blank one. The page checks the same condition before rendering them, so this
  // is the fail-closed half of a decision made in two places on purpose.
  if (typeof password !== "string" || password === "") {
    return new Response(null, { status: 404 });
  }

  try {
    let parsed: unknown;

    try {
      parsed = await request.json();
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const role = readRole(parsed);

    if (role === null) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: readPersonaEmail(parsed, role) ?? DEMO_PROFILE_EMAILS[role],
      password,
    });

    if (error || !data.user) {
      console.error("quick sign-in rejected", { code: error?.code, role });
      return Response.json({ error: GENERIC_FAILURE }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, disabled_at")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) {
      const correlationId = recordRouteFailure({
        cause: profileError,
        code: "profile_lookup_failed",
        status: 500,
        surface: "api.auth.quick_sign_in",
      });
      return Response.json(
        withCorrelationId({ error: GENERIC_FAILURE }, correlationId),
        { status: 500 },
      );
    }

    // The destination comes from the profile row's role, exactly as the form
    // route does — never from the posted role, which only chose the account.
    const resolved = activeProfileRole(profile);

    if (resolved === null) {
      await supabase.auth.signOut();
      return Response.json({ error: GENERIC_FAILURE }, { status: 401 });
    }

    const requested = safeNextPath(request.nextUrl.searchParams.get("next"));
    const destination = requested ?? surfacePathFor(resolved);

    revalidatePath("/", "layout");

    return sameOriginRedirect(destination);
  } catch (error) {
    if (isAuthError(error)) {
      return Response.json({ error: error.code }, { status: error.status });
    }

    throw error;
  }
}
