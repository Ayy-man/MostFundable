"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DEMO_ROLES } from "@/components/demo/demo-chrome";
import { DEMO_PROFILE_EMAILS } from "@/lib/demo/demo-session";
import type { DemoRole } from "@/lib/demo/types";

const ROLES: DemoRole[] = ["consumer", "operator", "admin", "affiliate"];

/**
 * One button per demo role, for the development phase. The button posts a role
 * name; the server holds the password. The seeded address is shown so it is
 * obvious which account is being used, and the panel says plainly that these are
 * demo accounts — a sign-in shortcut nobody can see the reason for reads as a
 * back door.
 */
export function QuickSignIn() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<DemoRole | null>(null);

  async function signInAs(role: DemoRole) {
    if (pending !== null) {
      return;
    }

    setError(null);
    setPending(role);

    try {
      const response = await fetch("/api/auth/quick-sign-in", {
        body: JSON.stringify({ role }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (response.redirected) {
        window.location.assign(response.url);
        return;
      }

      setError("That demo account could not be signed in.");
    } catch {
      setError("Sign-in could not be completed. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-labelledby="quick-sign-in-heading" className="grid gap-3">
      <div>
        <h2
          className="text-xs font-semibold text-foreground"
          id="quick-sign-in-heading"
        >
          Demo accounts
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Development shortcut. Each button signs in the seeded account for that
          role.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {ROLES.map((role) => (
          <Button
            className="h-auto min-h-11 flex-col items-start gap-0.5 py-2 text-left"
            disabled={pending !== null}
            key={role}
            onClick={() => void signInAs(role)}
            type="button"
            variant="outline"
          >
            <span className="text-xs font-semibold">
              {pending === role ? "Signing in" : DEMO_ROLES[role].label}
            </span>
            <span className="w-full truncate text-[0.68rem] font-normal text-muted-foreground">
              {DEMO_PROFILE_EMAILS[role]}
            </span>
          </Button>
        ))}
      </div>
      {error === null ? null : (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
