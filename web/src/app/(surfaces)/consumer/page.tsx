import { redirect } from "next/navigation";

import { readSessionDisplayIdentity } from "@/lib/auth/display-identity.server";
import { AuthError } from "@/lib/auth/errors";
import { SIGN_IN_PATH, surfacePathFor } from "@/lib/auth/roles";
import { getSession, requireRole } from "@/lib/auth/session";
import { demoQuickSignInEnabled } from "@/lib/demo/quick-sign-in";
import { featureFlag } from "@/lib/env";
import { paidRefreshPurchasesReady } from "@/lib/pricing/paid-refresh-availability";
import { resolveReferralAvailability } from "@/lib/referrals";
import { readConsumerTeamChat } from "@/lib/support";
import { timelineFlagEnabled } from "@/components/chat/timeline/flag";

import { ConsumerSurfaceClient } from "./surface-client";
import { ConsumerPendingPage } from "./pending";
import { resolveConsumerApplicationContext } from "./application-context.server";

const SURFACE_ROLE = "consumer" as const;

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
export default async function ConsumerPage() {
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

  const applicationContext = await resolveConsumerApplicationContext(session);
  if (applicationContext === null) return <ConsumerPendingPage />;
  const paidRefreshEnabled = featureFlag("FEATURE_PAID_REFRESH") && paidRefreshPurchasesReady();
  const referralsEnabled = await resolveReferralAvailability();
  // The consumer's own operator, read from their profile's org under their own
  // RLS, so a white-label client stops seeing the fixture operator's brand in
  // their header. null (read failure) leaves the fixture brand in place.
  const sessionIdentity = await readSessionDisplayIdentity(session);
  // The team chat, read here rather than by the browser. The client bootstrap it
  // replaces made three sequential requests -- list, open, read -- and took
  // 3,536ms measured against production to arrive at a conversation the page
  // could have been rendered with. `null` means the read could not answer and
  // the client path takes over, which is what it is still there for.
  const teamChat = await readConsumerTeamChat(session);
  // The conversation timeline. Read here rather than in the view for the reason every flag is:
  // the name is unprefixed, so a client component asking for it gets `false` and cannot tell that
  // apart from the flag being off.
  const timelineEnabled = timelineFlagEnabled();
  return <ConsumerSurfaceClient applicationContext={applicationContext} paidRefreshEnabled={paidRefreshEnabled} quickSignIn={demoQuickSignInEnabled()} realAuth referralsEnabled={referralsEnabled} sessionIdentity={sessionIdentity ?? undefined} teamChat={teamChat} timelineEnabled={timelineEnabled} />;
}
