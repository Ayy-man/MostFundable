-- R2C-07 — give every observed operator seat target its own provider operation.

begin;

alter table public.operator_seat_sync_outbox
  add column if not exists generation uuid;

update public.operator_seat_sync_outbox
set generation = pg_catalog.gen_random_uuid()
where generation is null;

alter table public.operator_seat_sync_outbox
  alter column generation set default pg_catalog.gen_random_uuid(),
  alter column generation set not null;

create or replace function private.operator_seat_outbox_enqueue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_org_id uuid;
  v_count integer;
  v_included integer;
begin
  for v_org_id in
    select distinct affected.org_id
    from (
      select new.org_id as org_id
      union all
      select old.org_id as org_id
    ) as affected
    where affected.org_id is not null
  loop
    if not exists (
      select 1 from public.operator_subscriptions as subscription
      where subscription.org_id = v_org_id
    ) then
      continue;
    end if;

    select pg_catalog.count(*)::integer into v_count
    from public.profiles as member_profile
    where member_profile.org_id = v_org_id
      and member_profile.role = 'operator_member'
      and member_profile.disabled_at is null;

    select organization.seats_included into v_included
    from public.orgs as organization where organization.id = v_org_id;

    insert into public.operator_seat_sync_outbox (
      org_id, desired_quantity, generation, status, attempts, last_error_code,
      enqueued_at, processed_at
    ) values (
      v_org_id, greatest(0, v_count - coalesce(v_included, 0)),
      pg_catalog.gen_random_uuid(), 'pending', 0, null, pg_catalog.now(), null
    )
    on conflict (org_id) do update
    set desired_quantity = excluded.desired_quantity,
        generation = excluded.generation,
        status = 'pending', attempts = 0, last_error_code = null,
        enqueued_at = excluded.enqueued_at, processed_at = null;
  end loop;
  return null;
end;
$fn$;

create or replace function public.operator_billing_set_seat_quantity(
  p_org_id uuid,
  p_quantity integer,
  p_generation uuid,
  p_source text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_desired_quantity integer;
  v_generation uuid;
  v_status text;
begin
  if not exists (
    select 1 from public.operator_subscriptions as subscription
    where subscription.org_id = p_org_id
  ) then
    return pg_catalog.jsonb_build_object(
      'applied', false, 'reason_code', 'no_subscription',
      'seat_quantity', null, 'outbox_status', null
    );
  end if;

  select outbox.desired_quantity, outbox.generation, outbox.status
  into v_desired_quantity, v_generation, v_status
  from public.operator_seat_sync_outbox as outbox
  where outbox.org_id = p_org_id
  for update;

  if v_generation is null then
    return pg_catalog.jsonb_build_object(
      'applied', false, 'reason_code', 'no_outbox_row',
      'seat_quantity', null, 'outbox_status', null
    );
  end if;

  if v_generation <> p_generation or v_desired_quantity <> p_quantity then
    return pg_catalog.jsonb_build_object(
      'applied', false, 'reason_code', 'superseded',
      'seat_quantity', null, 'outbox_status', v_status
    );
  end if;

  if v_status <> 'pending' then
    return pg_catalog.jsonb_build_object(
      'applied', false, 'reason_code', 'not_pending',
      'seat_quantity', null, 'outbox_status', v_status
    );
  end if;

  update public.operator_subscriptions
  set seat_quantity = p_quantity,
      updated_at = pg_catalog.now()
  where org_id = p_org_id;

  if not found then
    return pg_catalog.jsonb_build_object(
      'applied', false, 'reason_code', 'no_subscription',
      'seat_quantity', null, 'outbox_status', v_status
    );
  end if;

  update public.operator_seat_sync_outbox
  set status = 'synced',
      last_error_code = null,
      processed_at = pg_catalog.now()
  where org_id = p_org_id
    and generation = p_generation;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id,
    occurred_at, meta
  ) values (
    p_org_id, null, null, 'billing.seat_quantity_change', 'org', p_org_id,
    pg_catalog.now(),
    pg_catalog.jsonb_build_object(
      'count', p_quantity,
      'source', coalesce(p_source, 'route')
    )
  );

  return pg_catalog.jsonb_build_object(
    'applied', true, 'reason_code', 'applied',
    'seat_quantity', p_quantity, 'outbox_status', 'synced'
  );
end;
$fn$;

create or replace function public.operator_seat_sync_record_failure(
  p_org_id uuid,
  p_generation uuid,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_attempts integer;
  v_generation uuid;
  v_status text;
begin
  select outbox.attempts, outbox.generation, outbox.status
  into v_attempts, v_generation, v_status
  from public.operator_seat_sync_outbox as outbox
  where outbox.org_id = p_org_id
  for update;

  if v_generation is null then
    return pg_catalog.jsonb_build_object(
      'applied', false, 'reason_code', 'no_outbox_row',
      'attempts', null, 'status', null
    );
  end if;

  if v_generation <> p_generation then
    return pg_catalog.jsonb_build_object(
      'applied', false, 'reason_code', 'superseded',
      'attempts', v_attempts, 'status', v_status
    );
  end if;

  if v_status <> 'pending' then
    return pg_catalog.jsonb_build_object(
      'applied', false, 'reason_code', 'not_pending',
      'attempts', v_attempts, 'status', v_status
    );
  end if;

  update public.operator_seat_sync_outbox
  set attempts = attempts + 1,
      last_error_code = pg_catalog.left(nullif(p_error_code, ''), 64)
  where org_id = p_org_id
    and generation = p_generation;

  return pg_catalog.jsonb_build_object(
    'applied', true, 'reason_code', 'recorded',
    'attempts', v_attempts + 1, 'status', 'pending'
  );
end;
$fn$;

revoke all on function public.operator_billing_set_seat_quantity(uuid, integer, uuid, text)
  from public, anon, authenticated;
grant execute on function public.operator_billing_set_seat_quantity(uuid, integer, uuid, text)
  to service_role;

revoke all on function public.operator_seat_sync_record_failure(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.operator_seat_sync_record_failure(uuid, uuid, text)
  to service_role;

drop function if exists public.operator_billing_set_seat_quantity(uuid, integer, text);
drop function if exists public.operator_seat_sync_record_failure(uuid, text);

commit;
