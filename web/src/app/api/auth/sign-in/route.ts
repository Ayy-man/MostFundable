import { revalidatePath } from "next/cache";
import { type NextRequest } from "next/server";

import { isAuthError } from "@/lib/auth/errors";
import { safeNextPath, sameOriginRedirect } from "@/lib/auth/redirect-target";
import { activeProfileRole } from "@/lib/auth/route-guard";
import { surfacePathFor } from "@/lib/auth/roles";
import { recordRouteFailure, withCorrelationId } from "@/lib/diagnostics/route-failure";
import { featureFlag } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * One message for a wrong password and for an account that does not exist.
 * Distinguishing them turns this endpoint into an account-existence oracle
 * (ASVS V7); the distinguishing detail goes to the log instead.
 */
const GENERIC_FAILURE = "Those sign-in details were not accepted.";

type SignInBody = { email: string; password: string };

function readBody(value: unknown): SignInBody | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const { email, password } = value as Record<string, unknown>;

  if (typeof email !== "string" || typeof password !== "string") {
    return null;
  }

  if (email.trim() === "" || password === "") {
    return null;
  }

  return { email: email.trim(), password };
}

export async function POST(request: NextRequest): Promise<Response> {
  // Read lazily and inside the handler: nothing here may throw at import time
  // on a missing key, because the app has to build and boot with no env at all.
  if (!featureFlag("FEATURE_REAL_AUTH")) {
    return new Response(null, { status: 404 });
  }

  try {
    let parsed: unknown;

    try {
      parsed = await request.json();
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const body = readBody(parsed);

    if (body === null) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const supabase = await createClient();
    // GoTrue answers with JSON and sets no cookie of its own. The session
    // cookie exists only because @supabase/ssr writes it through the cookie
    // adapter while this handler is in the chain.
    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });

    if (error || !data.user) {
      console.error("sign-in rejected", { code: error?.code });
      return Response.json({ error: GENERIC_FAILURE }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, disabled_at")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) {
      // The caller keeps the deliberately undifferentiated sentence — a sign-in response must not
      // reveal whether the account exists — and gains only the correlation id. R5B-04.
      const correlationId = recordRouteFailure({
        cause: profileError,
        code: "profile_lookup_failed",
        status: 500,
        surface: "api.auth.sign_in",
      });
      return Response.json(
        withCorrelationId({ error: GENERIC_FAILURE }, correlationId),
        { status: 500 },
      );
    }

    const role = activeProfileRole(profile);
    if (role === null) {
      await supabase.auth.signOut();
      return Response.json({ error: GENERIC_FAILURE }, { status: 401 });
    }

    // The destination comes from the role map keyed on the profile row, never
    // from the request and never from user_metadata (D-25).
    const requested = safeNextPath(request.nextUrl.searchParams.get("next"));
    const destination = requested ?? surfacePathFor(role);

    // Without this the root layout can serve a shell cached for the signed-out
    // request that preceded it.
    revalidatePath("/", "layout");

    return sameOriginRedirect(destination);
  } catch (error) {
    if (isAuthError(error)) {
      return Response.json({ error: error.code }, { status: error.status });
    }

    throw error;
  }
}
