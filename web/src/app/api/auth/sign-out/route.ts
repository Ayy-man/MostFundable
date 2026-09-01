import { revalidatePath } from "next/cache";

import { isAuthError } from "@/lib/auth/errors";
import { sameOriginRedirect } from "@/lib/auth/redirect-target";
import { SIGN_IN_PATH } from "@/lib/auth/roles";
import { featureFlag } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  if (!featureFlag("FEATURE_REAL_AUTH")) {
    return new Response(null, { status: 404 });
  }

  try {
    const supabase = await createClient();

    // Sign out through the same library that wrote the cookie. Auth cookies
    // chunk at 3180 percent-encoded bytes into name.0, name.1, …, so a
    // hand-rolled clearer misses a chunk exactly as often as a hand-rolled
    // reader misreads one, and the symptom is a half-cleared session rather
    // than an error.
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("sign-out failed", { code: error.code });
    }

    revalidatePath("/", "layout");

    return sameOriginRedirect(SIGN_IN_PATH);
  } catch (error) {
    if (isAuthError(error)) {
      return Response.json({ error: error.code }, { status: error.status });
    }

    throw error;
  }
}
