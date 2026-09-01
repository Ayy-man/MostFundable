"use client";

import { useEffect, useState } from "react";

import {
  DemoEnvironmentBar,
  type DemoRoleIdentity,
} from "@/components/demo/demo-chrome";
import { FeedbackSessionProvider } from "@/components/demo/feedback-session";
import { DemoLaunchSkeleton } from "@/components/demo/demo-launch-skeleton";
import { ProfileSwitcher } from "@/components/demo/profile-switcher";
import { AdminSurface } from "@/components/surfaces/admin";
import { AffiliateSurface } from "@/components/surfaces/affiliate";
import { ConsumerSurface } from "@/components/surfaces/consumer";
import { OperatorSurface } from "@/components/surfaces/operator";
import {
  DEMO_PROFILE_IDENTITIES,
  demoInitials,
  writeDemoSessionCookie,
} from "@/lib/demo/demo-session";
import { DEMO_CLIENTS } from "@/lib/demo/feedback-fixtures";
import {
  READY_PROFILE_COMPLETION,
  type ConsumerApplicationContext,
  type DemoRole,
} from "@/lib/demo/types";

const DEFAULT_CONSUMER_CONTEXT: ConsumerApplicationContext = {
  clientId: "c5",
  readiness: 62,
};

// The seeded identity behind each demo role, so the chrome names the same person
// `getSession()` resolves from the demo cookie. The consumer entry is merged
// under the surface-reported identity below: the consumer surface owns that slot
// (it swaps when an operator previews a client) and this phase does not
// restructure it.
const SEEDED_IDENTITIES = {
  admin: {
    detail: DEMO_PROFILE_IDENTITIES.admin.organization,
    initials: demoInitials(DEMO_PROFILE_IDENTITIES.admin.name),
    name: DEMO_PROFILE_IDENTITIES.admin.name,
    organization: DEMO_PROFILE_IDENTITIES.admin.organization,
  },
  affiliate: {
    detail: DEMO_PROFILE_IDENTITIES.affiliate.organization,
    initials: demoInitials(DEMO_PROFILE_IDENTITIES.affiliate.name),
    name: DEMO_PROFILE_IDENTITIES.affiliate.name,
    organization: DEMO_PROFILE_IDENTITIES.affiliate.organization,
  },
  operator: {
    detail: DEMO_PROFILE_IDENTITIES.operator.organization,
    initials: demoInitials(DEMO_PROFILE_IDENTITIES.operator.name),
    name: DEMO_PROFILE_IDENTITIES.operator.name,
    organization: DEMO_PROFILE_IDENTITIES.operator.organization,
  },
} satisfies Partial<Record<DemoRole, DemoRoleIdentity>>;

export function DemoApp() {
  // The initializer, not an effect, for the same reason `activateRole` writes
  // synchronously: the initial surface fetches before any effect of ours runs.
  // The write is idempotent, so a double invocation under strict mode is inert.
  const [activeRole, setActiveRole] = useState<DemoRole>(() => {
    writeDemoSessionCookie("consumer");
    return "consumer";
  });
  const [opening, setOpening] = useState(true);
  const [profileSwitcherOpen, setProfileSwitcherOpen] = useState(false);
  const [visitedRoles, setVisitedRoles] = useState<Set<DemoRole>>(() =>
    new Set(["consumer"]),
  );
  const [consumerIdentity, setConsumerIdentity] = useState<DemoRoleIdentity>({
    initials: "MO",
    name: "Maya Okafor",
  });
  const [consumerContext, setConsumerContext] =
    useState<ConsumerApplicationContext>(DEFAULT_CONSUMER_CONTEXT);
  const openProfiles = () => setProfileSwitcherOpen(true);

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const openingTimer = window.setTimeout(
      () => setOpening(false),
      reducedMotion ? 0 : 340,
    );

    return () => window.clearTimeout(openingTimer);
  }, []);

  function activateRole(role: DemoRole) {
    // Written synchronously, not in an effect: a surface's own data effect
    // commits before this component's would, so an effect here loses the race
    // and the first request of a freshly selected role 401s.
    writeDemoSessionCookie(role);
    setVisitedRoles((current) => {
      if (current.has(role)) return current;
      const next = new Set(current);
      next.add(role);
      return next;
    });
    setActiveRole(role);
    setProfileSwitcherOpen(false);

    window.requestAnimationFrame(() => {
      window.scrollTo({ behavior: "auto", top: 0 });
      window.requestAnimationFrame(() => {
        const triggers = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            `[data-demo-role-trigger="${role}"]`,
          ),
        );
        triggers
          .find((trigger) => trigger.getClientRects().length > 0)
          ?.focus({ preventScroll: true });
      });
    });
  }

  function selectRole(role: DemoRole) {
    if (role === "consumer") {
      setConsumerContext(DEFAULT_CONSUMER_CONTEXT);
    }
    activateRole(role);
  }

  function previewConsumerApplications(clientId: string) {
    setConsumerContext({
      clientId,
      entryView: "matches",
      readiness:
        DEMO_CLIENTS.find((client) => client.clientId === clientId)
          ?.profileCompletion ?? READY_PROFILE_COMPLETION,
    });
    activateRole("consumer");
  }

  return (
    <FeedbackSessionProvider>
      <div
        className="min-h-dvh [--demo-banner-height:2.75rem] sm:[--demo-banner-height:2.25rem]"
        data-app-opening={opening ? "true" : undefined}
      >
        <DemoEnvironmentBar />
        <div className="pt-[var(--demo-banner-height)]">
          <div
            aria-hidden={activeRole !== "consumer"}
            data-motion-role={activeRole === "consumer" ? "active" : "inactive"}
            hidden={activeRole !== "consumer"}
          >
            <ConsumerSurface
              applicationContext={consumerContext}
              key={`${consumerContext.clientId}-${consumerContext.entryView ?? "default"}`}
              onOpenProfiles={openProfiles}
              onProfileIdentityChange={setConsumerIdentity}
            />
          </div>
          {visitedRoles.has("operator") ? (
            <div
              aria-hidden={activeRole !== "operator"}
              data-motion-role={activeRole === "operator" ? "active" : "inactive"}
              hidden={activeRole !== "operator"}
            >
              <OperatorSurface
                onOpenProfiles={openProfiles}
                onPreviewConsumerApplications={previewConsumerApplications}
              />
            </div>
          ) : null}
          {visitedRoles.has("admin") ? (
            <div
              aria-hidden={activeRole !== "admin"}
              data-motion-role={activeRole === "admin" ? "active" : "inactive"}
              hidden={activeRole !== "admin"}
            >
              <AdminSurface onOpenProfiles={openProfiles} />
            </div>
          ) : null}
          {visitedRoles.has("affiliate") ? (
            <div
              aria-hidden={activeRole !== "affiliate"}
              data-motion-role={activeRole === "affiliate" ? "active" : "inactive"}
              hidden={activeRole !== "affiliate"}
            >
              <AffiliateSurface onOpenProfiles={openProfiles} />
            </div>
          ) : null}
        </div>
        {opening ? <DemoLaunchSkeleton /> : null}
        <ProfileSwitcher
          activeRole={activeRole}
          identityOverrides={{ ...SEEDED_IDENTITIES, consumer: consumerIdentity }}
          onOpenChange={setProfileSwitcherOpen}
          onSelect={selectRole}
          open={profileSwitcherOpen}
        />
      </div>
    </FeedbackSessionProvider>
  );
}
