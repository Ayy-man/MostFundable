"use client";

import { useCallback, useEffect, useState } from "react";

import { DemoEnvironmentBar } from "@/components/demo/demo-chrome";
import { FeedbackSessionProvider } from "@/components/demo/feedback-session";
import { ProfileSwitcher } from "@/components/demo/profile-switcher";
import { useRoleSwitch } from "@/lib/demo/use-role-switch";
import {
  AffiliateSurface,
  type AffiliateLiveState,
} from "@/components/surfaces/affiliate";
import type { SessionDisplayIdentity } from "@/lib/auth/display-identity";

/**
 * `SurfaceProps` is `{ onOpenProfiles: () => void }` and a Server Component
 * cannot pass a function across the boundary, so every surface route needs a
 * thin client wrapper. This one reproduces the parts of `DemoApp`'s envelope
 * the affiliate surface actually needs and drops the rest.
 *
 * What must be here, and what breaks without it:
 *   - FeedbackSessionProvider. The surface calls `useFeedbackSession()`, which
 *     throws outside its provider, so the route 500s.
 *   - `--demo-banner-height`. Declared in one place in the whole codebase and
 *     read in twenty across eight files, in `top-[var(--demo-banner-height)]`
 *     and `min-h-[calc(100dvh-var(--demo-banner-height))]`. Undefined, each of
 *     those declarations is invalid at computed-value time, `top` falls back to
 *     `auto`, and every sticky header and the fixed sidebar quietly stop being
 *     positioned. Nothing errors; it just looks broken.
 *   - The `pt-[var(--demo-banner-height)]` container, so the surface clears the
 *     fixed bar.
 *   - `data-mf-surface`, unconditional in the SSR output, which is what the
 *     four-role walk asserts against instead of a copy string that can move
 *     behind a tab or be reworded.
 *
 * What is deliberately absent: a second tooltip provider, because layout.tsx
 * already wraps every route in one; the launch-animation attribute and its
 * skeleton, whose CSS simply does not apply while the attribute is missing; and
 * the scroll-and-focus dance that existed to manage an intra-SPA role switch a
 * route navigation now handles by itself.
 *
 * `sessionIdentity` travels as a plain prop for the same reason `PublishedBrand`
 * does on the operator route: it is read server-side under the caller's own RLS,
 * and absent means the fixture shell, where the fixture operator brand is right.
 *
 * `realAuth` arrives as a plain boolean prop because FEATURE_REAL_AUTH is
 * server-side only: `featureFlag()` inside a client component returns false
 * unconditionally, and a NEXT_PUBLIC_ twin would bake the value into the bundle
 * and turn a runtime switch into a redeploy (D-55).
 */
export function AffiliateSurfaceClient({
  affiliatesEnabled,
  quickSignIn,
  realAuth,
  sessionIdentity,
}: {
  affiliatesEnabled: boolean;
  quickSignIn: boolean;
  realAuth: boolean;
  sessionIdentity?: SessionDisplayIdentity;
}) {
  const [profileSwitcherOpen, setProfileSwitcherOpen] = useState(false);
  const [affiliateLiveState, setAffiliateLiveState] =
    useState<AffiliateLiveState>({ status: "loading" });
  const openProfiles = () => setProfileSwitcherOpen(true);
  const closeProfiles = useCallback(() => setProfileSwitcherOpen(false), []);
  const selectRole = useRoleSwitch({
    onSettled: closeProfiles,
    quickSignIn,
    realAuth,
  });

  useEffect(() => {
    if (!affiliatesEnabled) return;
    const controller = new AbortController();

    void fetch("/api/affiliates/me", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Affiliate portal request failed");
        const data = await response.json();
        if (!isAffiliatePortal(data)) throw new Error("Affiliate portal response was invalid");
        setAffiliateLiveState({ data, status: "ready" });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAffiliateLiveState({ status: "error" });
      });

    return () => controller.abort();
  }, [affiliatesEnabled]);

  return (
    <FeedbackSessionProvider seeded={!realAuth}>
      <div
        className="min-h-dvh [--demo-banner-height:2.75rem] sm:[--demo-banner-height:2.25rem]"
        data-mf-surface="affiliate"
        data-motion-route
      >
        <DemoEnvironmentBar realAuth={realAuth} />
        <div className="pt-[var(--demo-banner-height)]">
          <AffiliateSurface
            /**
             * `undefined` selects the illustrative portal, and that is only ever
             * right off the durable route. It used to be what a signed-in
             * affiliate got whenever FEATURE_AFFILIATES was off, which handed
             * them another affiliate's lead book and referral link as their own
             * (G-R5-OWN-03). Under real auth the flag being off is a `disabled`
             * live state, which the surface renders as the absence it is.
             */
            live={affiliatesEnabled ? affiliateLiveState : realAuth ? { status: "disabled" } : undefined}
            onOpenProfiles={openProfiles}
            sessionIdentity={sessionIdentity}
          />
        </div>
        {realAuth && !quickSignIn ? null : (
        <ProfileSwitcher
          seededIdentities
          activeRole="affiliate"
          onOpenChange={setProfileSwitcherOpen}
          onSelect={selectRole}
          open={profileSwitcherOpen}
        />
        )}
      </div>
    </FeedbackSessionProvider>
  );
}

function isAffiliatePortal(value: unknown): value is Extract<AffiliateLiveState, { status: "ready" }>["data"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!hasExactKeys(candidate, ["kpis", "rows"])) return false;
  if (typeof candidate.kpis !== "object" || candidate.kpis === null || !Array.isArray(candidate.rows)) return false;
  const kpis = candidate.kpis as Record<string, unknown>;
  if (!hasExactKeys(kpis, ["active", "fundingRecordedCents", "inPipeline", "sentLeads"])) return false;
  if (
    !["active", "fundingRecordedCents", "inPipeline", "sentLeads"].every(
      (key) => Number.isSafeInteger(kpis[key]) && (kpis[key] as number) >= 0,
    )
  ) return false;
  return candidate.rows.every((row) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return false;
    const record = row as Record<string, unknown>;
    if (!hasExactKeys(record, [
      "expectedCommissionCents",
      "fundedAmountCents",
      "needsAttention",
      "paymentStatus",
      "stage",
      "startedAt",
    ])) return false;
    return (
      typeof record.startedAt === "string" &&
      typeof record.stage === "string" &&
      Number.isSafeInteger(record.fundedAmountCents) &&
      (record.expectedCommissionCents === null || Number.isSafeInteger(record.expectedCommissionCents)) &&
      typeof record.paymentStatus === "string" &&
      typeof record.needsAttention === "boolean"
    );
  });
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
