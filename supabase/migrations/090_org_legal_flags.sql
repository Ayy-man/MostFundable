-- 090_org_legal_flags.sql
--
-- The legal gate's storage. `public.org_flags.upfront_fee_approved` is the
-- single authority for whether an organization may use the package or upfront
-- fee model, and DEC-D7 locks three conditions onto it: only a platform admin
-- may set it, only after written legal sign-off, and never by default. Each of
-- the three is a constraint, a policy or a trigger below rather than a comment,
-- because Log #106 is a standing request to make the upfront admin fee the
-- default and prose does not refuse a request.
--
-- This is a table and not a boolean on `public.orgs` for three reasons that
-- each hold on their own: INTERFACES §4 forbids adding a column to another
-- lane's table, Phase 10 is adding a column guard to `orgs` in a parallel
-- worktree this week, and a boolean has nowhere to record which sign-off
-- authorised it (12-CONTEXT D-03).
--
-- The gate that reads this flag is in migration 091. Nothing here enforces the
-- fee rule; this migration only makes the authority exist and be trustworthy.

create table public.org_flags (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  upfront_fee_approved boolean not null default false,
  legal_signoff_ref text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- DEC-D7's "after written legal sign-off", as a constraint. A boolean with no
  -- reference to the sign-off would record the permission and lose the evidence.
  constraint org_flags_upfront_requires_signoff check (
    upfront_fee_approved = false
    or (
      legal_signoff_ref is not null
      and approved_by is not null
      and approved_at is not null
    )
  ),
  constraint org_flags_signoff_ref_len check (
    legal_signoff_ref is null
    or length(legal_signoff_ref) between 1 and 200
  )
);

comment on table public.org_flags is
  'Per-organization legal flags. upfront_fee_approved is the DEC-D7 gate on the package and upfront fee models: platform-admin write only, sign-off attributed, false by default, and enforced by the trigger in migration 091 rather than by policy alone.';

comment on column public.org_flags.upfront_fee_approved is
  'False unless a platform admin has recorded a written legal sign-off. Never set by a seed, a migration default or an environment key.';

-- ---------------------------------------------------------------------------
-- Approver validation.
-- ---------------------------------------------------------------------------
--
-- The foreign key proves the profile exists. It cannot prove the profile was
-- allowed to approve, and that is the half DEC-D7 actually cares about.
--
-- This function also stamps `updated_at`. Phase 1 ships no reusable
-- touch-updated-at helper, and adding a generic one is how two lanes end up
-- creating the same function name in the same sprint, so the stamp lives in the
-- one BEFORE trigger this table already needs.
create function private.validate_org_flag_approver()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.approved_by is not null and not exists (
    select 1
    from public.profiles as approver
    where approver.id = new.approved_by
      and approver.role = 'platform_admin'
  ) then
    raise exception 'org flag approver must be a platform administrator'
      using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger org_flags_validate_approver
before insert or update on public.org_flags
for each row execute function private.validate_org_flag_approver();

-- ---------------------------------------------------------------------------
-- The audit row.
-- ---------------------------------------------------------------------------
--
-- Written by the trigger rather than by the RPC, for the same reason the gate
-- in 091 is a trigger rather than a policy: a writer that skips the RPC still
-- leaves the row.
--
-- `private.audit_meta_valid` is deliberately NOT extended. Its current version
-- (050_tracker_stage_engine.sql:34-48) already allows from_state, to_state and
-- source, and all three values here are short strings, which is what that
-- function requires of every non-count, non-field_names key. Three other lanes
-- rewrite that function this sprint; a four-way conflict costs more than a
-- prettier metadata payload would be worth.
--
-- `source` is 'org_flags' and not the name of any calling RPC, because this
-- trigger fires for writers that never went near the RPC and labelling those
-- rows with an RPC name would make the audit trail say something false.
create function private.org_flags_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_from boolean := coalesce(old.upfront_fee_approved, false);
begin
  -- UPDATE OF fires on assignment, not on change, so an update that re-writes
  -- the flag with the value it already had must not manufacture a row. An
  -- insert that lands on the default is not a change either — there was no
  -- approval before and there is none now.
  if tg_op = 'INSERT' and not new.upfront_fee_approved then
    return null;
  end if;

  if tg_op = 'UPDATE' and v_from is not distinct from new.upfront_fee_approved then
    return null;
  end if;

  insert into public.audit_log (
    org_id,
    client_id,
    actor_profile_id,
    action,
    subject_type,
    subject_id,
    meta
  ) values (
    new.org_id,
    null,
    private.auth_profile_id(),
    'org_flags.upfront_fee_approved.changed',
    'org_flags',
    new.org_id,
    jsonb_build_object(
      'from_state', v_from::text,
      'to_state', new.upfront_fee_approved::text,
      'source', 'org_flags'
    )
  );

  return null;
end;
$$;

create trigger org_flags_audit_changes
after insert or update of upfront_fee_approved on public.org_flags
for each row execute function private.org_flags_audit();

revoke all on function private.validate_org_flag_approver() from public;
revoke all on function private.org_flags_audit() from public;
grant execute on function private.validate_org_flag_approver() to authenticated;
grant execute on function private.org_flags_audit() to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security.
-- ---------------------------------------------------------------------------

alter table public.org_flags enable row level security;
alter table public.org_flags force row level security;

revoke all on table public.org_flags from anon, authenticated;
grant select, insert, update on table public.org_flags to authenticated;

-- `service_role` gets SELECT and nothing else, on purpose. The gate trigger in
-- 091 is security invoker, so when service_role writes a fee row the trigger
-- reads this table as service_role and needs the read privilege — without it
-- the write would fail with 42501 instead of the PT403 that criterion 1 is
-- about. Withholding INSERT and UPDATE means an admin-client route cannot open
-- the gate at all, which is strictly stronger than DEC-D7 asks for and costs
-- nothing: no code path in this phase writes flags as service_role.
grant select on table public.org_flags to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'org_flags'
      and policyname = 'org_flags_read'
  ) then
    -- An operator owner may see whether their own organization is gated, which
    -- is what the "Pending legal review" pill on the existing fees surface
    -- needs, and may not write it.
    create policy org_flags_read
    on public.org_flags
    for select
    to authenticated
    using (
      (select private.auth_app_role()) = 'platform_admin'
      or org_id = (select private.auth_org_id())
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'org_flags'
      and policyname = 'org_flags_platform_write'
  ) then
    create policy org_flags_platform_write
    on public.org_flags
    for all
    to authenticated
    using ((select private.auth_app_role()) = 'platform_admin')
    with check ((select private.auth_app_role()) = 'platform_admin');
  end if;
end
$$;

create index org_flags_approved_by_idx on public.org_flags (approved_by);
