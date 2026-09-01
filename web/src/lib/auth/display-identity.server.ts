import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { SessionProfile } from "@/lib/auth/session";
import type { SessionDisplayIdentity } from "@/lib/auth/display-identity";

/**
 * Self-reads under the session's own RLS (profiles self-select is granted to
 * `authenticated`, and both organization reads below carry their own predicate),
 * so this never widens what the caller could already see. `null` — no row, no
 * full_name, or a read error — leaves the surface on its fixture identity rather
 * than rendering a blank header; a wrong-but-visible name is the defect this
 * exists to fix, not one it should reintroduce.
 */
export async function readSessionDisplayIdentity(
  session: SessionProfile,
): Promise<SessionDisplayIdentity | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, orgs!profiles_org_id_fkey(name)")
    .eq("id", session.id)
    .maybeSingle();
  if (error || !data || data.full_name.trim() === "") return null;
  const organization = Array.isArray(data.orgs) ? data.orgs[0] : data.orgs;
  return {
    name: data.full_name,
    orgName: organization?.name ?? await readBrandProjectionOrgName(supabase),
    orgRole: session.orgRole,
  };
}

/**
 * The embed above answers for operators and platform admins only. R2A-12
 * (migration 276) took `public.orgs` away from consumers and affiliates
 * entirely — the commercial row carries plan and pricing — and left them
 * `public.org_brand_view`, a five-column identity-and-brand projection filtered
 * to the caller's own organization, which R4A-03 (migration 352) then walled for
 * an affiliate of a deactivated tenant. So for those two roles the embed returns
 * a null organization rather than an error, and without this second read the
 * consumer and affiliate headers silently fall back to the fixture operator's
 * brand — which on a white-label product is the leak, not the fallback.
 *
 * The projection is the sanctioned path, not a way around the restriction: it is
 * owner-context by design and self-filters to `private.auth_org_id()`, so the
 * caller learns nothing it was not already granted.
 */
async function readBrandProjectionOrgName(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("org_brand_view")
    .select("name")
    .maybeSingle();
  if (error || !data) return null;
  return data.name;
}
