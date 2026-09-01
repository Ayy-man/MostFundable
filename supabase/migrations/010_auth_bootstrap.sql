-- 010_auth_bootstrap.sql — lane A (Phase 2), migration range 010-019.
--
-- Profile bootstrap: the after-insert trigger on auth.users that guarantees a
-- public.profiles row exists for every registered user.
--
-- THERE IS NO ROLLBACK COMMAND HERE. The fix for a problem in this file is a
-- NEW forward migration in the 010-019 range. Never edit this file once it is
-- merged, and never `supabase db reset` from a lane worktree — one shared local
-- stack serves every lane and a reset destroys every other lane's state.
--
-- public.profiles has exactly two writers: this trigger, which is the
-- guarantor, and POST /api/auth/bootstrap, which is the corrector. That matters
-- because profiles.email carries no unique constraint while auth.users.email
-- does, so anything else inserting directly could leave two profile rows
-- sharing one address.


-- ---------------------------------------------------------------------------
-- Part 1: make the fallback profile shape representable.
-- ---------------------------------------------------------------------------
--
-- Phase 1's profiles_role_shape_check requires a consumer or affiliate to carry
-- a non-null org_id. A user created with no metadata — from Studio, from the
-- Admin API, from a magic-link signup, or from a password signup that sent none
-- — has no organization to name, so the narrowest fallback role the trigger can
-- choose is not representable and the insert would fail. A failing trigger
-- aborts GoTrue's auth.users insert, which means the user cannot register at
-- all, and that is the one outcome the bootstrap design forbids.
--
-- This widens the constraint by exactly one state: a consumer or affiliate may
-- hold a null org_id, which is the pre-bootstrap state the corrector route
-- resolves at first sign-in. Everything else is unchanged — a platform_admin
-- still must have neither org_id nor org_role, and an operator_member still
-- must have both.
--
-- Widening carries no authorization risk. Every tenancy policy scopes on
-- `org_id = (select private.auth_org_id())`, and a null org_id is equal to
-- nothing, so an unbound profile is the most restricted row the schema can
-- hold, not a less restricted one.
alter table public.profiles
  drop constraint if exists profiles_role_shape_check;

alter table public.profiles
  add constraint profiles_role_shape_check check (
    (role = 'platform_admin' and org_id is null and org_role is null)
    or (role = 'operator_member' and org_id is not null and org_role is not null)
    or (role in ('consumer', 'affiliate') and org_role is null)
  );


-- ---------------------------------------------------------------------------
-- Part 2: the bootstrap function.
-- ---------------------------------------------------------------------------
--
-- security definer because it writes public.profiles from inside GoTrue's own
-- insert transaction, where the acting role has no privilege on our tables.
--
-- set search_path = '' means EVERY reference below is schema-qualified —
-- public.profiles, public.orgs, public.app_role, public.org_role. An
-- unqualified name under an empty search path raises at CALL time rather than
-- at CREATE time, so it would ship green and break the first signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_app_role public.app_role;
  v_member_role public.org_role;
  v_org uuid;
  v_full_name text;
  v_email text;
begin
  -- Each cast gets its own handler. 'operator'::public.app_role raises 22P02,
  -- and the four legal app_role values (platform_admin, operator_member,
  -- consumer, affiliate) do not match the demo role names (admin, operator,
  -- consumer, affiliate), so a value copied from the demo fixtures lands here.
  begin
    v_app_role := (v_metadata ->> 'app_role')::public.app_role;
  exception
    when others then
      v_app_role := null;
  end;

  begin
    v_member_role := (v_metadata ->> 'org_role')::public.org_role;
  exception
    when others then
      v_member_role := null;
  end;

  begin
    v_org := (v_metadata ->> 'org_id')::uuid;
  exception
    when others then
      v_org := null;
  end;

  -- A well-formed uuid naming an organization that does not exist would raise a
  -- foreign key violation, so drop it here instead and let the corrector route
  -- rebind the row once the caller supplies a real organization.
  if v_org is not null
    and not exists (
      select 1 from public.orgs as organization where organization.id = v_org
    )
  then
    v_org := null;
  end if;

  -- The fallback role is consumer: the narrowest of the four. It grants nothing
  -- across organizations, its org_id stays null so every tenancy predicate is
  -- false for it, and requireOrgMember() refuses an operator with a null
  -- organization anyway. operator_member would create an unscoped operator and
  -- platform_admin would be indefensible.
  if v_app_role is null then
    v_app_role := 'consumer'::public.app_role;
  end if;

  -- Normalize to a shape profiles_role_shape_check accepts. Raising instead
  -- would abort the signup, and a user who cannot register is a worse outcome
  -- than a user whose row the corrector route has to fix.
  if v_app_role = 'platform_admin'::public.app_role then
    v_org := null;
    v_member_role := null;
  elsif v_app_role = 'operator_member'::public.app_role then
    if v_org is null or v_member_role is null then
      v_app_role := 'consumer'::public.app_role;
      v_org := null;
      v_member_role := null;
    end if;
  else
    v_member_role := null;
  end if;

  v_email := coalesce(new.email, '');
  v_full_name := coalesce(
    nullif(btrim(v_metadata ->> 'full_name'), ''),
    nullif(split_part(v_email, '@', 1), ''),
    'Member'
  );

  -- on conflict (id) do nothing makes the write idempotent against a re-run and
  -- against the corrector route having already created the row. It does NOT
  -- protect against a NOT NULL violation, which raises before the conflict is
  -- evaluated, which is why every fallback above is resolved first.
  insert into public.profiles (
    id,
    role,
    org_id,
    org_role,
    full_name,
    email
  )
  values (
    new.id,
    v_app_role,
    v_org,
    v_member_role,
    v_full_name,
    v_email
  )
  on conflict (id) do nothing;

  return new;
exception
  when others then
    -- DELIBERATELY BROAD, AND IT MUST STAY THAT WAY. This handler is the whole
    -- reason a signup cannot be blocked by a problem in this function. Supabase
    -- leads its own trigger documentation with the warning that a failing
    -- trigger aborts the auth.users insert, so tightening this into a specific
    -- exception list converts any unanticipated condition into a registration
    -- outage. The corrector route fixes a missing or wrong row at first
    -- sign-in; nothing fixes a user who was never created.
    return new;
end;
$$;

comment on function public.handle_new_user() is
  'Bootstrap guarantor: creates the public.profiles row for a new auth user and never raises, so registration cannot be blocked. POST /api/auth/bootstrap is the corrector.';

revoke all on function public.handle_new_user() from public;


-- ---------------------------------------------------------------------------
-- Part 3: the trigger.
-- ---------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
