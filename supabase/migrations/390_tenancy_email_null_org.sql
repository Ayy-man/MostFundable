-- The cross-tenant email guard treated two org-less accounts as the same tenant.
--
-- `tenancy_email_registered_elsewhere` decides whether an email is already registered under a
-- *different* org, and `startEnrollment` refuses the enrollment when it answers true. The comparison
-- was `profile.org_id is distinct from actor.org_id`, and `is distinct from` treats two NULLs as
-- equal — so when both sides had no org, the guard concluded "same tenant" and let the enrollment
-- through. That is the wrong direction to be wrong in: it is the answer that opens the gate.
--
-- It is reachable, and not by an exotic route. `profiles.email` carries no unique index, so two
-- profiles can hold the same address. The `auth.users` bootstrap trigger defaults a new account to
-- `role = 'consumer'` and takes `org_id` from `app_metadata`, which is absent on an ordinary signup —
-- so **org-less consumer is the default state of a newly created user**, before any org assignment.
-- `profiles_role_shape_check` constrains `org_role` for consumers but says nothing about `org_id`,
-- and it *forces* `org_id is null` for every `platform_admin`. Two org-less rows sharing an address
-- is therefore representable by the schema and produced by the default signup path.
--
-- Measured on the pre-fix function: two org-less profiles sharing `shared@example.test` returned
-- **false** — not registered elsewhere — which is the bypass.
--
-- The fix treats an absent org as *not matching anything*, including another absent org, so the
-- guard fails closed. An actor with no org has no tenant to compare against, and "this address is
-- not in a different tenant" is not a claim that can be made safely on no information. Refusing is
-- both honest and actionable: the caller gets EMAIL_ALREADY_REGISTERED rather than a silent pass.
--
-- Only the both-null case changes. One-null already answered true; two non-null orgs, equal or
-- different, are untouched — so the ordinary path, where a consumer has an org, behaves exactly as
-- before. A lone org-less signup whose address matches no other profile still enrolls, because the
-- email predicate matches nothing and `exists` is false.
--
-- The sibling defect — actor id with *no* profile row at all, where the left join also yields a null
-- org — is dead under `FEATURE_REAL_AUTH`: `resolveRealSession` reads `profiles` with `maybeSingle()`
-- and returns null when the row is absent, so the route answers 401 long before this function runs.
-- It is nonetheless covered by the same predicate now, which is the point of fixing the class rather
-- than the instance.

begin;

create or replace function public.tenancy_email_registered_elsewhere(
  p_email text,
  p_actor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    left join public.profiles as actor on actor.id = p_actor_id
    where pg_catalog.lower(pg_catalog.btrim(profile.email)) = pg_catalog.lower(pg_catalog.btrim(p_email))
      and profile.id <> p_actor_id
      and (
        -- An unknown org on either side is not a match. `is distinct from` said two NULLs were the
        -- same tenant; they are two absences of an answer.
        profile.org_id is null
        or actor.org_id is null
        or profile.org_id <> actor.org_id
      )
  )
$$;

revoke all on function public.tenancy_email_registered_elsewhere(text, uuid)
  from public, anon, authenticated;
grant execute on function public.tenancy_email_registered_elsewhere(text, uuid)
  to service_role;

commit;
