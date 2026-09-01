import { redirect } from "next/navigation";

import { readSessionDisplayIdentity } from "@/lib/auth/display-identity.server";
import { AuthError } from "@/lib/auth/errors";
import { SIGN_IN_PATH, surfacePathFor } from "@/lib/auth/roles";
import { getSession, requireRole } from "@/lib/auth/session";
import { demoQuickSignInEnabled } from "@/lib/demo/quick-sign-in";
import { featureFlag } from "@/lib/env";

import { AffiliateSurfaceClient } from "./surface-client";

const SURFACE_ROLE = "affiliate" as const;

/**
 * CONVENTIONS.md allows default exports in exactly two files and asks for no
 * others. A route segment's page is the one exception the App Router forces:
 * Next resolves the segment by its default export, so all five pages in this
 * lane carry one. Nothing else here does.
 *
 * Order matters. The flag check is the first statement because reading
 * process.env does not make a route dynamic while reaching cookies() does, and
 * getSession() reaches cookies(). Anything awaited above the branch flips this
 * route — and, in page.tsx, the AUTH-03 baseline — from prerendered to dynamic
 * silently.
 *
 * requireRole() is the gate rather than a second opinion on the proxy's. The
 * proxy authenticates and matches path shapes; it cannot know the caller's role
 * without a database read on every <Link> prefetch, or without trusting
 * user_metadata, which the account can rewrite. Both layers run, and the one
 * that decides role is this one (AUTH-05, T-02-04).
 *
 * Its two refusals become navigations rather than an error page. A browser
 * navigation has no useful 401 body to render, so an unauthenticated caller
 * goes to sign-in and a caller holding another role goes to their own surface
 * — never a 403, which would confirm this route exists (D-53, T-02-27). The
 * 401/403 mapping belongs to the API routes, where the caller is code.
 */
export default async function AffiliatePage() {
  if (!featureFlag("FEATURE_REAL_AUTH")) {
    redirect("/");
  }

  let session;
  try {
    session = await requireRole(SURFACE_ROLE);
  } catch (error) {
    if (!(error instanceof AuthError)) {
      throw error;
    }

    const session = await getSession();

    redirect(session ? surfacePathFor(session.role) : SIGN_IN_PATH);
  }

  // The affiliate's own operator, read from their profile's organization under
  // their own RLS, so a Northbridge affiliate stops being shown the fixture
  // operator's brand while looking at their real referral data. null (read
  // failure, or a deactivated tenant walled out of the brand projection) leaves
  // the fixture brand in place.
  const sessionIdentity = await readSessionDisplayIdentity(session);

  return (
    <AffiliateSurfaceClient
      quickSignIn={demoQuickSignInEnabled()}
      affiliatesEnabled={featureFlag("FEATURE_AFFILIATES")}
      realAuth
      sessionIdentity={sessionIdentity ?? undefined}
    />
  );
}
