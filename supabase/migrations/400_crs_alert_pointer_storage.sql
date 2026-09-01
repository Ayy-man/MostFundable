-- CRS Phase 1: pointer-only credit-alert storage approved 2026-08-31.
-- Full alert content remains at CRS and is fetched live. Provider ids are either HMAC'd or
-- AES-GCM encrypted before this boundary; the encrypted alert id is scrubbed after 90 days.

begin;

create table public.crs_alert_pointers (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  monitoring_event_id uuid not null unique references public.monitoring_events(id) on delete cascade,
  provider_hook_key text not null unique,
  provider_alert_key text not null,
  alert_id_ciphertext text,
  alert_id_iv text,
  alert_id_tag text,
  key_version smallint not null,
  occurred_at timestamptz not null,
  alert_reported_at timestamptz not null,
  received_at timestamptz not null,
  expires_at timestamptz not null,
  delivered_at timestamptz,
  read_at timestamptz,
  expired_at timestamptz,
  constraint crs_alert_pointers_hook_key_shape check (
    provider_hook_key ~ '^[0-9a-f]{64}$'
  ),
  constraint crs_alert_pointers_alert_key_shape check (
    provider_alert_key ~ '^[0-9a-f]{64}$'
  ),
  constraint crs_alert_pointers_key_version_check check (key_version > 0),
  constraint crs_alert_pointers_retention_check check (
    expires_at = received_at + interval '90 days'
  ),
  constraint crs_alert_pointers_cipher_lifecycle_check check (
    (
      expired_at is null
      and alert_id_ciphertext is not null
      and alert_id_iv is not null
      and alert_id_tag is not null
    )
    or (
      expired_at is not null
      and alert_id_ciphertext is null
      and alert_id_iv is null
      and alert_id_tag is null
    )
  )
);

create index crs_alert_pointers_client_occurred_idx
  on public.crs_alert_pointers(client_id, occurred_at desc);
create index crs_alert_pointers_alert_key_idx
  on public.crs_alert_pointers(provider_alert_key);
create index crs_alert_pointers_active_expiry_idx
  on public.crs_alert_pointers(expires_at, id)
  where expired_at is null;

alter table public.crs_alert_pointers enable row level security;
alter table public.crs_alert_pointers force row level security;

revoke all on table public.crs_alert_pointers from public, anon, authenticated, service_role;
grant select, insert on table public.crs_alert_pointers to service_role;
revoke delete, truncate on table public.crs_alert_pointers
  from public, anon, authenticated, service_role;

-- Migration 374 derives the erasure boundary from the live catalog. Every later table that
-- qualifies must carry the same ALWAYS statement guard, even when TRUNCATE is already revoked,
-- so a future SECURITY DEFINER writer cannot erase the pointer ledger wholesale.
create trigger crs_alert_pointers_no_truncate
before truncate on public.crs_alert_pointers
for each statement execute function public.append_only_guard();
alter table public.crs_alert_pointers
  enable always trigger crs_alert_pointers_no_truncate;

create or replace function public.scrub_expired_crs_alert_pointers(
  p_now timestamptz,
  p_limit integer default 500
) returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_rows integer := 0;
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = '22023', message = 'CRS_ALERT_POINTER_PURGE_INPUT_INVALID';
  end if;

  with due as (
    select pointer.id
    from public.crs_alert_pointers as pointer
    where pointer.expired_at is null
      and pointer.expires_at <= p_now
    order by pointer.expires_at, pointer.id
    for update skip locked
    limit p_limit
  )
  update public.crs_alert_pointers as pointer
  set alert_id_ciphertext = null,
      alert_id_iv = null,
      alert_id_tag = null,
      expired_at = p_now
  from due
  where pointer.id = due.id;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$fn$;

revoke all on function public.scrub_expired_crs_alert_pointers(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.scrub_expired_crs_alert_pointers(timestamptz, integer)
  to service_role;

comment on table public.crs_alert_pointers is
  'Encrypted CRS alert lookup pointers only. Full bureau alert detail is never persisted.';
comment on column public.crs_alert_pointers.provider_hook_key is
  'HMAC-SHA256 of CRS webhook id; raw hook id is never stored.';
comment on column public.crs_alert_pointers.provider_alert_key is
  'HMAC-SHA256 of CRS alert id for lookup; raw alert id is never stored.';

commit;
