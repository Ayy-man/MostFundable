import { NextResponse, type NextRequest } from "next/server";

import { createServerClientWithCookies } from "@/lib/supabase/server";
import { providerSessionDecision, type ProfileSessionState } from "@/lib/auth/route-guard";

export type SessionUpdate = {
  hasSession: boolean;
  response: NextResponse;
  responseHeaders: Headers;
};

export async function updateSession(
  request: NextRequest,
): Promise<SessionUpdate> {
  let responseHeaders = new Headers();
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClientWithCookies({
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet, headers) {
      cookiesToSet.forEach(({ name, value }) => {
        request.cookies.set(name, value);
      });
      supabaseResponse = NextResponse.next({ request });
      cookiesToSet.forEach(({ name, options, value }) => {
        supabaseResponse.cookies.set(name, value, options);
      });
      responseHeaders = new Headers(headers);
      Object.entries(headers).forEach(([key, value]) => {
        supabaseResponse.headers.set(key, value);
      });
    },
  });

  // Do not run code between createServerClientWithCookies and
  // supabase.auth.getClaims(). A change here can cause intermittent sign-outs.

  // IMPORTANT: Keep the response object produced above. It carries refreshed
  // session cookies and the cache headers supplied with them.
  const { data } = await supabase.auth.getClaims();
  const providerUserId = data?.claims.sub;
  let profileState: ProfileSessionState = "missing";

  if (providerUserId) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("disabled_at")
      .eq("id", providerUserId)
      .maybeSingle();
    profileState = error
      ? "unavailable"
      : profile?.disabled_at === null
        ? "active"
        : profile
          ? "disabled"
          : "missing";
  }

  const decision = providerSessionDecision(Boolean(providerUserId), profileState);
  if (decision.clear) await supabase.auth.signOut();

  return {
    hasSession: decision.hasSession,
    response: supabaseResponse,
    responseHeaders,
  };
}
