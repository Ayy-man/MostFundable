-- R3C-01: recount the authoritative seat target at drain time.

create or replace function public.operator_seat_sync_prepare(p_org_id uuid)
returns table (
  org_id uuid,
  desired_quantity integer,
  generation uuid,
  status text,
  attempts integer
)
language plpgsql security definer set search_path = '' as $fn$
declare
  v_actual integer;
  v_desired integer;
  v_included integer;
  v_outbox public.operator_seat_sync_outbox%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('operator-seat:' || p_org_id::text, 0));
  if not exists (select 1 from public.operator_subscriptions subscription where subscription.org_id = p_org_id) then
    return;
  end if;

  select pg_catalog.count(*)::integer into v_actual
  from public.profiles profile
  where profile.org_id = p_org_id and profile.role = 'operator_member' and profile.disabled_at is null;
  select organization.seats_included into v_included from public.orgs organization where organization.id = p_org_id;
  v_desired := greatest(0, v_actual - coalesce(v_included, 0));

  select * into v_outbox from public.operator_seat_sync_outbox outbox
  where outbox.org_id = p_org_id for update;
  if v_outbox.org_id is null then
    insert into public.operator_seat_sync_outbox(
      org_id, desired_quantity, generation, status, attempts, last_error_code, enqueued_at, processed_at
    ) values (
      p_org_id, v_desired, pg_catalog.gen_random_uuid(), 'pending', 0, null, pg_catalog.now(), null
    ) returning * into strict v_outbox;
  elsif v_outbox.desired_quantity <> v_desired then
    update public.operator_seat_sync_outbox
    set desired_quantity = v_desired, generation = pg_catalog.gen_random_uuid(), status = 'pending',
        attempts = 0, last_error_code = null, enqueued_at = pg_catalog.now(), processed_at = null
    where operator_seat_sync_outbox.org_id = p_org_id returning * into strict v_outbox;
  end if;

  if v_outbox.status = 'pending' then
    return query select v_outbox.org_id, v_outbox.desired_quantity, v_outbox.generation,
      v_outbox.status, v_outbox.attempts;
  end if;
end;
$fn$;

revoke all on function public.operator_seat_sync_prepare(uuid) from public, anon, authenticated;
grant execute on function public.operator_seat_sync_prepare(uuid) to service_role;
