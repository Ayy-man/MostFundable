import { revalidatePath } from "next/cache";
import { type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { isAuthError } from "@/lib/auth/errors";
import { safeNextPath, sameOriginRedirect } from "@/lib/auth/redirect-target";
import { activeProfileRole } from "@/lib/auth/route-guard";
import {
  RESET_PASSWORD_PATH,
  SIGN_IN_PATH,
  surfacePathFor,
} from "@/lib/auth/roles";
import { featureFlag } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * The link carries `token_hash`, and the exchange happens here on the server.
 * The older callback shape puts the address and `type=magiclink` in the query
 * string, which leaks the address into referrers and access logs, and the
 * default template puts the session in a URL fragment, which a server never
 * receives at all — the browser strips it before the request is sent. Emitting
 * `token_hash` from the email template is integration's config obligation
 * (G-02-02); consuming it is this file's.
 */
const OTP_TYPES: readonly EmailOtpType[] = [
  "email",
  "email_change",
  "invite",
  "magiclink",
  "recovery",
  "signup",
];

function readOtpType(value: string | null): EmailOtpType | null {
  if (value === null) {
    return null;
  }

  return OTP_TYPES.find((candidate) => candidate === value) ?? null;
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!featureFlag("FEATURE_REAL_AUTH")) {
    return new Response(null, { status: 404 });
  }

  // One marker for an expired link, a spent link, a forged one and a
  // malformed one, so the redirect target cannot be read as a probe result.
  const failure = `${SIGN_IN_PATH}?error=link_invalid`;

  try {
    const tokenHash = request.nextUrl.searchParams.get("token_hash");
    const otpType = readOtpType(request.nextUrl.searchParams.get("type"));

    if (!tokenHash || otpType === null) {
      return sameOriginRedirect(failure);
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });

    if (error || !data.user) {
      // One outcome for an expired link, a spent link and a forged one.
      console.error("confirm rejected", { code: error?.code });
      return sameOriginRedirect(failure);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, disabled_at")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) {
      console.error("confirm profile lookup failed", {
        code: profileError.code,
      });
      return sameOriginRedirect(failure);
    }
    const role = activeProfileRole(profile);
    if (role === null) {
      await supabase.auth.signOut();
      return sameOriginRedirect(failure);
    }

    // The destination comes from the profile row through the single-sourced
    // role map, never from user metadata and never from the link (D-25).
    const requested = safeNextPath(request.nextUrl.searchParams.get("next"));
    // A recovery OTP creates a short-lived authenticated session whose only
    // useful destination is the password form. Sending it to a role surface
    // would make the email look successful while leaving the password
    // unchanged, which was the missing half of account recovery.
    const destination =
      otpType === "recovery"
        ? RESET_PASSWORD_PATH
        : requested ?? surfacePathFor(role);

    revalidatePath("/", "layout");

    return sameOriginRedirect(destination);
  } catch (error) {
    if (isAuthError(error)) {
      return Response.json({ error: error.code }, { status: error.status });
    }

    throw error;
  }
}
