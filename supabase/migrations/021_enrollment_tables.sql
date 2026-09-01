begin;

create table if not exists public.esignatures (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  document_kind text not null,
  text_version text not null,
  signer_name text not null,
  typed_signature text not null,
  signed_at timestamptz not null default pg_catalog.now(),
  ip inet,
  user_agent text,
  client_draft_id uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint esignatures_document_kind_valid
    check (document_kind in ('enrollment_agreement')),
  constraint esignatures_signature_present
    check (length(btrim(typed_signature)) > 0)
);

-- Restrict preserves the retained agreement artifact if a client row is removed.
create unique index if not exists uniq_esignature_draft
  on public.esignatures (client_draft_id);
create index if not exists idx_esignatures_client
  on public.esignatures (client_id);

create table if not exists public.consent_revocations (
  id uuid primary key default extensions.gen_random_uuid(),
  consent_id uuid not null references public.consents(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  kind text not null,
  revoked_at timestamptz not null default pg_catalog.now(),
  revoked_by uuid references public.profiles(id),
  reason text,
  constraint consent_revocations_kind_valid
    check (kind in ('monitoring', 'analysis'))
);

create unique index if not exists uniq_revocation_per_consent
  on public.consent_revocations (consent_id);
create index if not exists idx_consent_revocations_client
  on public.consent_revocations (client_id, kind);

create table if not exists public.idv_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  member_ref text,
  driver text not null,
  kind text not null default 'sms',
  state text not null default 'pending',
  attempts_used integer not null default 0,
  max_attempts integer not null,
  expires_at timestamptz,
  outcome text,
  locked_until timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint idv_sessions_driver_valid check (driver in ('mock', 'crs')),
  constraint idv_sessions_kind_valid check (kind in ('sms', 'quiz')),
  constraint idv_sessions_state_valid
    check (state in ('pending', 'sms_sent', 'retry', 'quiz', 'passed', 'locked')),
  constraint idv_sessions_outcome_valid
    check (outcome is null or outcome in ('pass', 'retry', 'locked')),
  constraint idv_sessions_locked_needs_until
    check (state <> 'locked' or locked_until is not null),
  constraint idv_sessions_attempts_bounded
    check (attempts_used >= 0 and max_attempts > 0 and attempts_used <= max_attempts)
);

-- member_ref is an opaque routing key and never provider content.
create unique index if not exists uniq_idv_session_per_enrollment
  on public.idv_sessions (enrollment_id);
create index if not exists idx_idv_sessions_client
  on public.idv_sessions (client_id);

do $$
declare
  t text;
begin
  foreach t in array array['esignatures', 'consent_revocations'] loop
    if not exists (
      select 1 from pg_trigger
      where tgname = t || '_append_only'
        and tgrelid = ('public.' || t)::regclass
    ) then
      execute format(
        'create trigger %I before update or delete on public.%I '
        'for each row execute function public.append_only_guard()',
        t || '_append_only',
        t
      );
    end if;
    if not exists (
      select 1 from pg_trigger
      where tgname = t || '_no_truncate'
        and tgrelid = ('public.' || t)::regclass
    ) then
      execute format(
        'create trigger %I before truncate on public.%I '
        'for each statement execute function public.append_only_guard()',
        t || '_no_truncate',
        t
      );
    end if;
    execute format(
      'alter table public.%I enable always trigger %I',
      t,
      t || '_append_only'
    );
    execute format(
      'alter table public.%I enable always trigger %I',
      t,
      t || '_no_truncate'
    );
    execute format(
      'revoke update, delete, truncate on public.%I '
      'from anon, authenticated, service_role, public',
      t
    );
  end loop;
end
$$;

alter table public.esignatures enable row level security;
alter table public.esignatures force row level security;
create policy esignatures_select_platform_admin on public.esignatures
  for select to authenticated
  using ((select private.auth_app_role()) = 'platform_admin');
create policy esignatures_select_consumer on public.esignatures
  for select to authenticated
  using (
    exists (
      select 1 from public.clients c
      where c.id = esignatures.client_id
        and c.consumer_profile_id = (select auth.uid())
    )
  );
create policy esignatures_select_operator on public.esignatures
  for select to authenticated
  using (
    (select private.auth_app_role()) = 'operator_member'
    and (select private.can_access_client(client_id))
  );

alter table public.consent_revocations enable row level security;
alter table public.consent_revocations force row level security;
create policy consent_revocations_select_platform_admin on public.consent_revocations
  for select to authenticated
  using ((select private.auth_app_role()) = 'platform_admin');
create policy consent_revocations_select_consumer on public.consent_revocations
  for select to authenticated
  using (
    exists (
      select 1 from public.clients c
      where c.id = consent_revocations.client_id
        and c.consumer_profile_id = (select auth.uid())
    )
  );
create policy consent_revocations_select_operator on public.consent_revocations
  for select to authenticated
  using (
    (select private.auth_app_role()) = 'operator_member'
    and (select private.can_access_client(client_id))
  );

alter table public.idv_sessions enable row level security;
alter table public.idv_sessions force row level security;
create policy idv_sessions_select_platform_admin on public.idv_sessions
  for select to authenticated
  using ((select private.auth_app_role()) = 'platform_admin');
create policy idv_sessions_select_consumer on public.idv_sessions
  for select to authenticated
  using (
    exists (
      select 1 from public.clients c
      where c.id = idv_sessions.client_id
        and c.consumer_profile_id = (select auth.uid())
    )
  );
create policy idv_sessions_select_operator on public.idv_sessions
  for select to authenticated
  using (
    (select private.auth_app_role()) = 'operator_member'
    and (select private.can_access_client(client_id))
  );

revoke all on table public.esignatures from anon, authenticated;
revoke all on table public.consent_revocations from anon, authenticated;
revoke all on table public.idv_sessions from anon, authenticated;
grant select on table public.esignatures to authenticated, service_role;
grant select on table public.consent_revocations to authenticated, service_role;
grant select on table public.idv_sessions to authenticated, service_role;

-- No browser write policies exist. Affiliates match no read policy, which is
-- the deliberate deny-by-absence rule for these enrollment artifacts.

-- Metadata is limited to states, versions, counts, timestamps and driver names.
-- Payment details and bureau-derived content never enter this audit function.
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
  elsif tg_table_name = 'consent_revocations' then
    v_action := 'consent.revoke';
    v_subject_type := 'consent';
    v_subject_id := new.consent_id;
    v_client_id := new.client_id;
    v_meta := jsonb_build_object('status', new.kind);
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
  elsif tg_table_name = 'idv_sessions' then
    if tg_op = 'INSERT' then
      v_action := 'enrollment.idv_started';
    elsif old.state is distinct from new.state then
      v_action := case new.state
        when 'passed' then 'enrollment.idv_pass'
        when 'locked' then 'enrollment.idv_locked'
        when 'retry' then 'enrollment.idv_retry'
        when 'quiz' then 'enrollment.idv_quiz'
        else null
      end;
      if v_action is null then return new; end if;
    else
      return new;
    end if;
    v_subject_type := 'enrollment';
    v_subject_id := new.enrollment_id;
    v_client_id := new.client_id;
    v_meta := jsonb_build_object(
      'status', new.state,
      'count', new.attempts_used,
      'driver', new.driver
    );
  elsif tg_table_name = 'consumer_subscriptions' then
    if tg_op = 'INSERT' then
      v_action := 'billing.setup_intent_recorded';
    elsif old.status is distinct from new.status then
      v_action := case new.status
        when 'active' then 'billing.subscription_started'
        when 'cancelled' then 'billing.subscription_cancelled'
        else null
      end;
      if v_action is null then return new; end if;
    else
      return new;
    end if;
    v_subject_type := 'consumer_subscription';
    v_subject_id := new.id;
    v_client_id := new.client_id;
    v_meta := jsonb_build_object(
      'driver', new.provider,
      'status', new.status
    );
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

revoke all on function public.enrollment_audit() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'consent_revocations_audit'
      and tgrelid = 'public.consent_revocations'::regclass
  ) then
    create trigger consent_revocations_audit
      after insert on public.consent_revocations
      for each row execute function public.enrollment_audit();
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'idv_sessions_audit_insert'
      and tgrelid = 'public.idv_sessions'::regclass
  ) then
    create trigger idv_sessions_audit_insert
      after insert on public.idv_sessions
      for each row execute function public.enrollment_audit();
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'idv_sessions_audit_update'
      and tgrelid = 'public.idv_sessions'::regclass
  ) then
    create trigger idv_sessions_audit_update
      after update of state on public.idv_sessions
      for each row execute function public.enrollment_audit();
  end if;
end
$$;

-- ENRL-08 ownership: agreement_signed and monitoring_connected are called in
-- this phase. onboarding_call_completed belongs to the operator caller in ask-7;
-- docs_uploaded belongs to the upload caller in ask-8. All four use this one path.
create or replace function public.enrollment_record_milestone(
  p_client_id uuid,
  p_kind text,
  p_actor_id uuid
) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  insert into public.enrollment_milestones (
    client_id,
    kind,
    completed_at,
    completed_by
  ) values (
    p_client_id,
    p_kind::public.enrollment_milestone_kind,
    pg_catalog.now(),
    p_actor_id
  )
  on conflict (client_id, kind) do nothing;
end;
$fn$;

revoke all on function public.enrollment_record_milestone(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.enrollment_record_milestone(uuid,text,uuid)
  to service_role;

-- Withdrawal is append-only and resolves the latest still-authorized grant.
create or replace function public.enrollment_revoke_consent(
  p_client_id uuid,
  p_kind text,
  p_actor_id uuid
) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_consent_id uuid;
begin
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);

  select consent.id into v_consent_id
  from public.consents as consent
  where consent.client_id = p_client_id
    and consent.kind = p_kind::public.consent_kind
    and consent.action = 'granted'
    and not exists (
      select 1
      from public.consent_revocations as revocation
      where revocation.consent_id = consent.id
    )
  order by consent.signed_at desc, consent.created_at desc, consent.id desc
  limit 1;

  if v_consent_id is null then
    return;
  end if;

  insert into public.consent_revocations (
    consent_id,
    client_id,
    kind,
    revoked_by
  ) values (
    v_consent_id,
    p_client_id,
    p_kind,
    p_actor_id
  )
  on conflict (consent_id) do nothing;
end;
$fn$;

revoke all on function public.enrollment_revoke_consent(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.enrollment_revoke_consent(uuid,text,uuid)
  to service_role;

-- TX-A: agreement, enrollment, two consents and first milestone are atomic.
create or replace function public.enrollment_begin(
  p_client_id uuid,
  p_actor_id uuid,
  p_draft_id uuid,
  p_signer_name text,
  p_typed_signature text,
  p_agreement_version text,
  p_monitoring_version text,
  p_analysis_version text,
  p_ip inet,
  p_user_agent text
) returns table (enrollment_id uuid, esignature_id uuid)
language plpgsql security definer set search_path = '' as $fn$
declare
  v_enrollment_id uuid;
  v_esig_id uuid;
  v_signed_at timestamptz := pg_catalog.now();
begin
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);

  insert into public.esignatures (
    client_id,
    document_kind,
    text_version,
    signer_name,
    typed_signature,
    signed_at,
    ip,
    user_agent,
    client_draft_id
  ) values (
    p_client_id,
    'enrollment_agreement',
    p_agreement_version,
    p_signer_name,
    p_typed_signature,
    v_signed_at,
    p_ip,
    p_user_agent,
    p_draft_id
  )
  on conflict (client_draft_id) do nothing
  returning id into v_esig_id;

  if v_esig_id is null then
    select e.id into v_esig_id
    from public.esignatures e
    where e.client_draft_id = p_draft_id;

    select e.id into v_enrollment_id
    from public.enrollments e
    where e.esig_doc_id = v_esig_id::text;

    if v_enrollment_id is not null then
      return query select v_enrollment_id, v_esig_id;
      return;
    end if;
  end if;

  insert into public.consents (
    client_id,
    kind,
    text_version,
    signed_at,
    ip,
    esig_ref
  ) values
    (
      p_client_id,
      'monitoring',
      p_monitoring_version,
      v_signed_at,
      p_ip,
      v_esig_id::text
    ),
    (
      p_client_id,
      'analysis',
      p_analysis_version,
      v_signed_at,
      p_ip,
      v_esig_id::text
    )
  on conflict (client_id, kind, esig_ref)
    where esig_ref is not null do nothing;

  insert into public.enrollments (
    client_id,
    status,
    esig_doc_id,
    monitoring_consent_at,
    analysis_consent_at
  ) values (
    p_client_id,
    'enrolled',
    v_esig_id::text,
    v_signed_at,
    v_signed_at
  ) returning id into v_enrollment_id;

  perform public.enrollment_record_milestone(
    p_client_id,
    'agreement_signed',
    p_actor_id
  );

  return query select v_enrollment_id, v_esig_id;
end;
$fn$;

revoke all on function public.enrollment_begin(
  uuid,uuid,uuid,text,text,text,text,text,inet,text
) from public, anon, authenticated;
grant execute on function public.enrollment_begin(
  uuid,uuid,uuid,text,text,text,text,text,inet,text
) to service_role;

-- TX-C: provider routing and the durable attempt counter begin together.
create or replace function public.enrollment_idv_started(
  p_enrollment_id uuid,
  p_client_id uuid,
  p_actor_id uuid,
  p_driver text,
  p_kind text,
  p_max_attempts integer,
  p_member_ref text
) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);

  update public.enrollments
  set crs_member_ref = p_member_ref
  where id = p_enrollment_id and client_id = p_client_id;

  insert into public.idv_sessions (
    enrollment_id,
    client_id,
    member_ref,
    driver,
    kind,
    state,
    max_attempts
  ) values (
    p_enrollment_id,
    p_client_id,
    p_member_ref,
    p_driver,
    p_kind,
    'sms_sent',
    p_max_attempts
  )
  on conflict (enrollment_id) do nothing;
end;
$fn$;

revoke all on function public.enrollment_idv_started(
  uuid,uuid,uuid,text,text,integer,text
) from public, anon, authenticated;
grant execute on function public.enrollment_idv_started(
  uuid,uuid,uuid,text,text,integer,text
) to service_role;

-- TX-D: IDV outcome, enrollment state and pass milestone settle together.
create or replace function public.enrollment_idv_settled(
  p_enrollment_id uuid,
  p_actor_id uuid,
  p_outcome text,
  p_next_state text,
  p_parked_until timestamptz,
  p_locked_until timestamptz
) returns void
language plpgsql security definer set search_path = '' as $fn$
declare
  v_current_state text;
  v_client_id uuid;
begin
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);

  select s.state, s.client_id into v_current_state, v_client_id
  from public.idv_sessions s
  where s.enrollment_id = p_enrollment_id
  for no key update;

  if v_current_state is null or v_current_state in ('passed', 'locked') then
    return;
  end if;

  update public.idv_sessions
  set state = p_next_state,
      outcome = p_outcome,
      attempts_used = attempts_used + case
        when p_next_state in ('retry', 'locked') then 1
        else 0
      end,
      locked_until = p_locked_until,
      updated_at = pg_catalog.now()
  where enrollment_id = p_enrollment_id;

  if p_next_state = 'passed' then
    update public.enrollments
    set status = 'active', parked_until = null
    where id = p_enrollment_id;
    perform public.enrollment_record_milestone(
      v_client_id,
      'monitoring_connected',
      p_actor_id
    );
  elsif p_next_state = 'locked' then
    update public.enrollments
    set status = 'parked', parked_until = p_parked_until
    where id = p_enrollment_id;
  end if;
end;
$fn$;

revoke all on function public.enrollment_idv_settled(
  uuid,uuid,text,text,timestamptz,timestamptz
) from public, anon, authenticated;
grant execute on function public.enrollment_idv_settled(
  uuid,uuid,text,text,timestamptz,timestamptz
) to service_role;

commit;
