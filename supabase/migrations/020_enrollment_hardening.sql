-- Lane B. Hardens Phase 1 enrollment tables additively.
begin;

create or replace function public.append_only_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  raise exception using
    errcode = '42501',
    message = format('%I is append-only', tg_table_name),
    detail = format('attempted %s', tg_op),
    hint = 'withdraw an authorization by inserting a consent_revocations row';
end;
$fn$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'consents_append_only'
      and tgrelid = 'public.consents'::regclass
  ) then
    create trigger consents_append_only
      before update or delete on public.consents
      for each row execute function public.append_only_guard();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'consents_no_truncate'
      and tgrelid = 'public.consents'::regclass
  ) then
    create trigger consents_no_truncate
      before truncate on public.consents
      for each statement execute function public.append_only_guard();
  end if;
end
$$;

alter table public.consents enable always trigger consents_append_only;
alter table public.consents enable always trigger consents_no_truncate;

revoke update, delete, truncate on public.consents
  from anon, authenticated, public;

-- The conflict target must repeat this predicate when used by an INSERT.
create unique index if not exists uniq_consent_per_esig_kind
  on public.consents (client_id, kind, esig_ref)
  where esig_ref is not null;

-- Constraints are installed NOT VALID so every new row is checked immediately.
-- Validation notices keep one stale shared-stack fixture from blocking four lanes;
-- integration can repair the old row and validate the named constraint later.
do $$
declare
  v_typname text;
begin
  select t.typname into v_typname
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
   where a.attrelid = 'public.consents'::regclass
     and a.attname = 'kind'
     and a.attnum > 0
     and not a.attisdropped;

  if v_typname in ('text', 'varchar', 'bpchar')
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.consents'::regclass
         and conname = 'consents_kind_valid'
     ) then
    alter table public.consents
      add constraint consents_kind_valid
      check (kind is not null and kind in ('monitoring', 'analysis')) not valid;
    begin
      alter table public.consents validate constraint consents_kind_valid;
    exception when check_violation then
      raise notice 'consents_kind_valid on public.consents remains NOT VALID because an existing row failed it';
    end;
  elsif v_typname not in ('text', 'varchar', 'bpchar') then
    raise notice 'consents.kind uses %, so its type already owns the taxonomy', v_typname;
  end if;
end
$$;

do $$
declare
  v_typname text;
begin
  select t.typname into v_typname
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
   where a.attrelid = 'public.enrollments'::regclass
     and a.attname = 'status'
     and a.attnum > 0
     and not a.attisdropped;

  if v_typname in ('text', 'varchar', 'bpchar')
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.enrollments'::regclass
         and conname = 'enrollments_status_valid'
     ) then
    alter table public.enrollments
      add constraint enrollments_status_valid
      check (
        status is not null
        and status in ('enrolled', 'parked', 'active', 'cancelled')
      ) not valid;
    begin
      alter table public.enrollments validate constraint enrollments_status_valid;
    exception when check_violation then
      raise notice 'enrollments_status_valid on public.enrollments remains NOT VALID because an existing row failed it';
    end;
  elsif v_typname not in ('text', 'varchar', 'bpchar') then
    raise notice 'enrollments.status uses %, so its type already owns the taxonomy', v_typname;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.enrollments'::regclass
      and conname = 'enrollments_parked_requires_until'
  ) then
    alter table public.enrollments
      add constraint enrollments_parked_requires_until
      check (
        status is not null
        and (status::text <> 'parked' or parked_until is not null)
      ) not valid;
    begin
      alter table public.enrollments
        validate constraint enrollments_parked_requires_until;
    exception when check_violation then
      raise notice 'enrollments_parked_requires_until on public.enrollments remains NOT VALID because an existing row failed it';
    end;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from public.enrollment_milestones
    group by client_id, kind
    having count(*) > 1
  ) then
    raise exception
      'enrollment_milestones has duplicate client and kind rows; resolve them before adding uniq_milestone_client_kind';
  end if;
end
$$;

create unique index if not exists uniq_milestone_client_kind
  on public.enrollment_milestones (client_id, kind);

do $$
declare
  v_typname text;
begin
  select t.typname into v_typname
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
   where a.attrelid = 'public.enrollment_milestones'::regclass
     and a.attname = 'kind'
     and a.attnum > 0
     and not a.attisdropped;

  if v_typname in ('text', 'varchar', 'bpchar')
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.enrollment_milestones'::regclass
         and conname = 'enrollment_milestones_kind_valid'
     ) then
    alter table public.enrollment_milestones
      add constraint enrollment_milestones_kind_valid
      check (
        kind is not null
        and kind in (
          'agreement_signed',
          'docs_uploaded',
          'monitoring_connected',
          'onboarding_call_completed'
        )
      ) not valid;
    begin
      alter table public.enrollment_milestones
        validate constraint enrollment_milestones_kind_valid;
    exception when check_violation then
      raise notice 'enrollment_milestones_kind_valid on public.enrollment_milestones remains NOT VALID because an existing row failed it';
    end;
  elsif v_typname not in ('text', 'varchar', 'bpchar') then
    raise notice 'enrollment_milestones.kind uses %, so its type already owns the taxonomy', v_typname;
  end if;
end
$$;

-- One shared audit function is replaced in full by migrations 021 and 022 as
-- their tables arrive. Triggers own transitions with rows; the TypeScript audit
-- helper is reserved for rejected attempts and unresolved events with no row.
-- Audit metadata contains state names, versions, counts, timestamps and driver
-- names only. Payment instrument details and bureau-derived content never enter it.
-- Action vocabulary:
-- consent.create, consent.revoke
-- enrollment.create, enrollment.idv_started, enrollment.idv_retry
-- enrollment.idv_quiz, enrollment.idv_pass, enrollment.idv_locked
-- enrollment.park, enrollment.activate, enrollment.cancel
-- billing.setup_intent_recorded, billing.subscription_started
-- billing.subscription_cancelled, milestone.complete
create or replace function public.enrollment_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_action text;
  v_subject_type text;
  v_subject_id uuid;
  v_client_id uuid;
  v_org_id uuid;
  v_meta jsonb;
begin
  if tg_table_name = 'consents' then
    v_action := 'consent.create';
    v_subject_type := 'consent';
    v_subject_id := new.id;
    v_client_id := new.client_id;
    v_meta := jsonb_build_object(
      'status', new.kind,
      'version', new.text_version
    );
  elsif tg_table_name = 'enrollments' then
    if tg_op = 'INSERT' then
      v_action := 'enrollment.create';
      v_meta := jsonb_build_object('to_state', new.status::text);
    elsif old.status is distinct from new.status then
      v_action := case new.status::text
        when 'active' then 'enrollment.activate'
        when 'parked' then 'enrollment.park'
        when 'cancelled' then 'enrollment.cancel'
        else null
      end;
      if v_action is null then return new; end if;
      v_meta := jsonb_build_object(
        'from_state', old.status::text,
        'to_state', new.status::text
      );
    else
      return new;
    end if;
    v_subject_type := 'enrollment';
    v_subject_id := new.id;
    v_client_id := new.client_id;
  elsif tg_table_name = 'enrollment_milestones' then
    v_action := 'milestone.complete';
    v_subject_type := 'enrollment_milestone';
    v_subject_id := new.client_id;
    v_client_id := new.client_id;
    v_meta := jsonb_build_object('status', new.kind);
  end if;

  select client.org_id into v_org_id
  from public.clients as client
  where client.id = v_client_id;

  insert into public.audit_log (
    org_id,
    client_id,
    actor_profile_id,
    action,
    subject_type,
    subject_id,
    occurred_at,
    meta
  ) values (
    v_org_id,
    v_client_id,
    v_actor,
    v_action,
    v_subject_type,
    v_subject_id,
    pg_catalog.now(),
    v_meta
  );
  return new;
end;
$fn$;

revoke all on function public.append_only_guard() from public, anon, authenticated;
revoke all on function public.enrollment_audit() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'consents_audit'
      and tgrelid = 'public.consents'::regclass
  ) then
    create trigger consents_audit
      after insert on public.consents
      for each row execute function public.enrollment_audit();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'enrollments_audit'
      and tgrelid = 'public.enrollments'::regclass
  ) then
    create trigger enrollments_audit
      after insert or update on public.enrollments
      for each row execute function public.enrollment_audit();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'enrollment_milestones_audit'
      and tgrelid = 'public.enrollment_milestones'::regclass
  ) then
    create trigger enrollment_milestones_audit
      after insert on public.enrollment_milestones
      for each row execute function public.enrollment_audit();
  end if;
end
$$;

commit;
