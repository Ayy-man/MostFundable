import { NextResponse, type NextRequest } from "next/server";

import { isAuthError } from "@/lib/auth/errors";
import { safeNextPath } from "@/lib/auth/redirect-target";
import { featureFlag } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * The same body for a known address and an unknown one. This endpoint is
 * unauthenticated by design, so a response that distinguished the two would
 * hand anyone a list of who holds an account here.
 */
const ACCEPTED = { status: "accepted" } as const;

function readEmail(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const { email } = value as Record<string, unknown>;

  if (typeof email !== "string" || email.trim() === "") {
    return null;
  }

  return email.trim();
}

export async function POST(request: NextRequest): Promise<Response> {
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

    const email = readEmail(parsed);

    if (email === null) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    const callback = new URL("/api/auth/confirm", request.nextUrl);

    if (next !== null) {
      callback.searchParams.set("next", next);
    }

    const supabase = await createClient();
    // shouldCreateUser stays false: accounts here are provisioned, and a link
    // request must never be a signup path. GoTrue answers an unknown address
    // with an error, which we swallow into the same response as a known one.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callback.toString(),
        shouldCreateUser: false,
      },
    });

    if (error) {
      console.error("magic-link request rejected", { code: error.code });
    }

    return NextResponse.json(ACCEPTED, { status: 202 });
  } catch (error) {
    if (isAuthError(error)) {
      return Response.json({ error: error.code }, { status: error.status });
    }

    throw error;
  }
}
