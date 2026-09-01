import type { OrgRole } from "@/lib/auth/session";

/**
 * What the surface shell needs to name the signed-in account instead of the
 * fixture persona. Read server-side (display-identity.server.ts) and passed
 * across the boundary as a plain prop, the same way PublishedBrand travels —
 * absent means REAL_AUTH is off or the read failed, and the fixture identity
 * stays, which is exactly what the fixture shell should show.
 */
export type SessionDisplayIdentity = {
  name: string;
  orgName: string | null;
  orgRole: OrgRole | null;
};

/** "Avery Northbridge Demo" → "AN"; single-word names repeat their initial. */
export function displayInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "?";
  const second = words.length > 1 ? (words[1][0] ?? first) : first;
  return `${first}${second}`.toUpperCase();
}

/** "prep_specialist" → "Prep specialist" — the sentence case the surface's team roster already uses. */
export function orgRoleLabel(orgRole: OrgRole): string {
  const words = orgRole.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The sidebar detail line: "Owner · Northbridge Funding Group", degrading gracefully when a part is missing. */
export function displayRoleLine(identity: SessionDisplayIdentity): string {
  const parts = [
    identity.orgRole === null ? null : orgRoleLabel(identity.orgRole),
    identity.orgName,
  ].filter((part): part is string => part !== null);
  return parts.join(" · ") || "Operator";
}
