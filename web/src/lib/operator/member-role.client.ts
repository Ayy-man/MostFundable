"use client";

import type { OperatorMemberRole, OperatorMemberRoleUpdate } from "@/lib/tenancy/member-role";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function updateOperatorTeamMemberRole(
  memberId: string,
  orgRole: OperatorMemberRole,
  fetcher: Fetcher = fetch,
): Promise<OperatorMemberRoleUpdate> {
  if (!UUID.test(memberId)) throw new Error("The member identifier is invalid.");
  const response = await fetcher(`/api/invites/members/${encodeURIComponent(memberId)}/role`, {
    body: JSON.stringify({ orgRole }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
  const payload = await response.json().catch(() => null) as { member?: unknown } | null;
  if (!response.ok) {
    throw new Error(response.status === 409
      ? "Assign another active owner before changing this role."
      : response.status === 403
        ? "Only workspace owners and admins can change member roles."
        : "The member role could not be changed.");
  }
  const member = payload?.member as Partial<OperatorMemberRoleUpdate> | undefined;
  if (!member || member.profileId !== memberId || typeof member.orgId !== "string"
    || member.orgRole !== orgRole || typeof member.applied !== "boolean") {
    throw new Error("The member role response was invalid.");
  }
  return member as OperatorMemberRoleUpdate;
}
