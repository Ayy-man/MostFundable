import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { QuickSignIn } from "@/app/sign-in/quick-sign-in";
import { SignInForm } from "@/app/sign-in/sign-in-form";
import { surfacePathFor } from "@/lib/auth/roles";
import { demoQuickSignInEnabled } from "@/lib/demo/quick-sign-in";
import { getSession } from "@/lib/auth/session";
import { featureFlag } from "@/lib/env";

export const metadata: Metadata = {
  title: "Sign in | MostFundable",
  description: "Sign in to the MostFundable funding readiness workspace.",
};

// CONVENTIONS.md limits default exports to two files; every route segment's
// page.tsx needs one, and the rule bends for pages only.
export default async function SignInPage() {
  // FIRST statement, nothing awaited above it. Reading process.env does not
  // make a route dynamic; reaching a dynamic API does, and this early return is
  // what keeps the flag-off path away from cookies() (AUTH-03).
  if (!featureFlag("FEATURE_REAL_AUTH")) {
    redirect("/");
  }

  // The same decision the route handler makes: the flags on and a password
  // actually present. Rendering the buttons when the server cannot use them
  // would offer a control that always fails. Derived in one place because the
  // four surface pages ask the same question to decide whether to offer the
  // role switcher.
  const quickSignIn = demoQuickSignInEnabled();

  const session = await getSession();

  if (session) {
    redirect(surfacePathFor(session.role));
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm"
        data-motion-route
      >
        <h1 className="text-lg font-semibold text-foreground">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Use the address your workspace was set up with.
        </p>
        <div className="mt-6">
          <SignInForm />
        </div>
        {quickSignIn ? (
          <div className="mt-6 border-t border-border pt-5">
            <QuickSignIn />
          </div>
        ) : null}
      </div>
    </main>
  );
}
