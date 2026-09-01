"use client";

// The platform-admin AI chat view.
//
// The "before" this replaces was measured on production at 1440x900 and 390x844: the view rendered
// a composer and a suggested question, and **both controls stayed disabled with text typed into
// them** (F-14's correction — the two findings that survived the harness fix). Under it, a panel
// explaining that "Chat controls remain disabled. No message, model call, database query, or
// external request runs from this page." That is F-08's admin half, and it was inert for a reason
// one layer down: `answerForScope` threw `ASSISTANT_SCOPE_UNAVAILABLE` for this scope, so deleting
// the shell without an admin grounding module would have recreated the same defect with more code
// around it. Lane 4a built `lib/kb/admin-answer.ts`, so the shell can go and a question can be
// answered.
//
// **The grounding is platform-wide and it is not the operator's.** `buildAdminGrounding` reads the
// operator roster and the recorded platform figures — `lib/admin/platform.ts` and
// `lib/admin/overview.ts`, the same numbers this surface's own roster renders. Nothing in it reads
// a consumer record: it widens what a platform admin can *ask*, never what they can see.

import { PageHeader } from "@/components/demo/shared";
import { parseAdminTenants, useAdminResource } from "@/lib/admin/platform-client";

import { AssistantWorkspace } from "./workspace";

import type { GreetingRead } from "./greeting";

export interface AdminAssistantProps {
  readonly compact?: boolean;
  /** The signed-in administrator's display name, for the greeting. */
  readonly viewerName?: string | null;
}

/**
 * The workspace without a page header, so it can be mounted somewhere that already has one.
 *
 * There is exactly one other place a platform admin is offered a grounded question box: AI Brain's
 * Chat playground, which today mounts `<OperatorKbAssistant>` and reads `/api/kb/operator` — a
 * platform administrator receiving workspace-scoped grounding through the operator's route. That
 * is what this export is for. Building a second, one-shot admin panel instead would have meant a
 * second answer path to maintain and an orb with no stage stream behind it, which contract §6's
 * table does not allow; pointing both places at the same workspace costs nothing and removes the
 * operator route from the admin surface entirely.
 */
export function AdminAssistantWorkspace({ compact = false, viewerName }: AdminAssistantProps) {
  // The same four-state read the rest of the admin surface uses, which is what keeps a failed
  // roster read from rendering as a healthy platform with no operators on it (G-HOST-14).
  const { read } = useAdminResource("/api/admin/tenants", parseAdminTenants);

  const greeting: GreetingRead =
    read === "loading"
      ? { status: "loading" }
      : read === "failed"
        ? { status: "unavailable" }
        : read === null
          ? { status: "absent" }
          : {
              clients: read.reduce((total, tenant) => total + tenant.clients, 0),
              operators: read.length,
              status: "admin",
            };

  return <AssistantWorkspace compact={compact} greeting={greeting} scope="admin" viewerName={viewerName} />;
}

export function AdminAssistant({ viewerName }: AdminAssistantProps) {
  return (
    <div className="space-y-5">
      <PageHeader title="AI chat" />
      <AdminAssistantWorkspace viewerName={viewerName} />
    </div>
  );
}
