-- 011_auth_policies.sql — lane A (Phase 2), migration range 010-019.
--
-- The policy set Phase 2's routes depend on: the self-read that lets
-- getSession() see its own row, the organization read that makes the settings
-- write visible to its own WHERE clause, the owner/admin settings write, the
-- one-time self-bootstrap correction, and the audit insert.
--
-- THERE IS NO ROLLBACK COMMAND HERE. The fix for a problem in this file is a
-- NEW forward migration in the 010-019 range. Never edit this file once it is
-- merged, and never `supabase db reset` from a lane worktree — one shared local
-- stack serves every lane and a reset destroys every other lane's state.
--
-- Two rules govern every block below.
--
-- FIRST: Postgres has no `create policy if not exists`, so each create sits
-- inside a `do $$ … pg_policies … $$` existence guard. Running this file twice
-- leaves exactly one of each policy.
--
-- SECOND: the guards test for an EQUIVALENT policy rather than for this file's
-- own policy name. INTERFACES §5.1 gives `profiles` and `orgs` to Phase 1 and
-- the Phase 2 policy set to this range, and nothing settles which side the
-- self-read lands on (D-51). Phase 1 in fact shipped
-- `profiles_select_authenticated`, `orgs_select_authenticated` and
-- `orgs_operator_update`, all outcome-equivalent to what this file would add,
-- so a name-keyed guard would stack a second permissive policy on top of a
-- working one for no benefit. A capability-keyed guard leaves them alone.
--
-- No `drop policy` appears anywhere in this file. Dropping and recreating an
-- object another lane shipped is how a lane silently disarms someone else's
-- boundary, and drop-then-create is a destructive change to integration's table
-- even when the replacement is identical.
--
-- Every helper call is wrapped `(select private.auth_…())` so the planner
-- hoists it into an initplan and evaluates it once per statement rather than
-- once per row. The helpers are Phase 1's, in the `private` schema — BACKEND-SPEC
-- §1.2 writes them unqualified and the plan assumed `public`, but duplicating
-- them under a second schema would create two sources of truth for the same
-- authorization question. They are `stable security definer set search_path = ''`
-- already, and `execute` is granted to `authenticated`.


-- ---------------------------------------------------------------------------
-- profiles: the self-read getSession() depends on.
-- ---------------------------------------------------------------------------
--
-- Without it the profiles read returns EMPTY rather than erroring, so
-- getSession() would report every authenticated caller as having no session
-- and nothing anywhere would log a reason.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and cmd = 'SELECT'
      and roles @> array['authenticated']::name[]
  ) then
    create policy profiles_self_read_lane_a
    on public.profiles
    for select
    to authenticated
    using (id = (select private.auth_profile_id()));
  end if;
end
$$;


-- ---------------------------------------------------------------------------
-- profiles: the one-time self-bootstrap correction.
-- ---------------------------------------------------------------------------
--
-- POST /api/auth/bootstrap corrects the trigger's fallback row through the
-- ORDINARY server client, so RLS has to permit that write or the corrector half
-- of AUTH-04 cannot exist. Phase 1 ships no self-update policy at all: a
-- consumer can read their row and cannot touch it.
--
-- The scope is deliberately tiny, because the input the corrector reads —
-- raw_user_meta_data — is writable by the user it describes, so a broad
-- self-update policy would be a self-elevation path.
--   USING      restricts the write to the caller's OWN row, and only while it is
--              still in the unbootstrapped state the trigger leaves behind
--              (null organization, fallback role). A row that has been
--              bootstrapped once can never be rewritten through this policy.
--   WITH CHECK restricts the result to consumer or affiliate with a null
--              org_role, so no metadata value can turn this into an
--              operator_member or a platform_admin.
-- Binding oneself to an organization as a consumer remains possible and is
-- checked again at the route layer; a consumer sees only the client rows whose
-- consumer_profile_id is their own, so the organization binding alone conveys
-- no other tenant's data.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_self_bootstrap_update_lane_a'
  ) then
    create policy profiles_self_bootstrap_update_lane_a
    on public.profiles
    for update
    to authenticated
    using (
      id = (select private.auth_profile_id())
      and org_id is null
      and role = 'consumer'
    )
    with check (
      id = (select private.auth_profile_id())
      and role in ('consumer', 'affiliate')
      and org_role is null
    );
  end if;
end
$$;


-- ---------------------------------------------------------------------------
-- orgs: the read that makes the settings write visible.
-- ---------------------------------------------------------------------------
--
-- An UPDATE policy with no SELECT policy is the phase's quietest failure: the
-- WHERE clause cannot see the row, Postgres reports `UPDATE 0`, PostgREST
-- reports success, and PATCH /api/org/settings returns 200 having changed
-- nothing. Both policies ship together or neither is trustworthy.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'orgs'
      and cmd = 'SELECT'
      and roles @> array['authenticated']::name[]
  ) then
    create policy orgs_self_read_lane_a
    on public.orgs
    for select
    to authenticated
    using (
      (select private.auth_app_role()) = 'platform_admin'
      or id = (select private.auth_org_id())
    );
  end if;
end
$$;


-- ---------------------------------------------------------------------------
-- orgs: the owner/admin settings write.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'orgs'
      and cmd in ('UPDATE', 'ALL')
      and roles @> array['authenticated']::name[]
  ) then
    create policy orgs_settings_update_lane_a
    on public.orgs
    for update
    to authenticated
    using (
      (select private.auth_app_role()) = 'operator_member'
      and (select private.auth_org_role()) in ('owner', 'admin')
      and id = (select private.auth_org_id())
    )
    with check (
      (select private.auth_app_role()) = 'operator_member'
      and (select private.auth_org_role()) in ('owner', 'admin')
      and id = (select private.auth_org_id())
    );
  end if;
end
$$;


-- ---------------------------------------------------------------------------
-- audit_log: the insert AUTH-07's attribution requirement needs.
-- ---------------------------------------------------------------------------
--
-- Phase 1 shipped `audit_log_select_authenticated` and granted `select` only,
-- so an authenticated caller can read audit rows and cannot write one. The
-- settings route is forbidden the service-role client, because that client
-- would bypass the very policy AUTH-07 exists to demonstrate, so without this
-- policy and its grant the mutation would be unattributable.
--
-- Scope: the actor must be the caller, and the row must be one this caller
-- could already read. Client-anchored audit rows are left to the lanes that own
-- those flows.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_log'
      and cmd in ('INSERT', 'ALL')
      and roles @> array['authenticated']::name[]
  ) then
    create policy audit_log_actor_insert_lane_a
    on public.audit_log
    for insert
    to authenticated
    with check (
      actor_profile_id = (select private.auth_profile_id())
      and (
        (select private.auth_app_role()) = 'platform_admin'
        or (
          client_id is null
          and (select private.auth_app_role()) = 'operator_member'
          and org_id = (select private.auth_org_id())
        )
      )
    );
  end if;
end
$$;


-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
--
-- Mandatory, not optional. `auto_expose_new_tables` defaults off, so
-- `authenticated` holds no implicit privilege and a table with perfect policies
-- still returns empty — or, for a write, raises 42501 — over the Data API.
-- Recorded as G-02-06 in docs/GAPS.md.
--
-- Phase 1 already granted select/insert/update/delete on public.profiles and
-- public.orgs to `authenticated` and select on public.audit_log. Re-granting is
-- idempotent and states the dependency where a reader will look for it; the
-- insert on audit_log is the one privilege this phase actually adds.
grant select, update on table public.profiles to authenticated;
grant select, update on table public.orgs to authenticated;
grant select, insert on table public.audit_log to authenticated;


-- ---------------------------------------------------------------------------
-- Indexes.
-- ---------------------------------------------------------------------------
--
-- Every column the policies above filter on is already indexed by Phase 1:
-- profiles.id and orgs.id are primary keys, profiles.org_id has
-- profiles_org_id_idx, profiles.org_role has profiles_org_role_idx, and
-- audit_log has audit_log_org_occurred_at_idx and audit_log_actor_profile_id_idx.
--
-- The one path with no supporting index is the pair this phase introduces —
-- the audit insert predicate reads org_id and actor_profile_id together, and
-- the settings verification counts an organization's rows by actor.
create index if not exists audit_log_org_actor_idx
on public.audit_log (org_id, actor_profile_id);
