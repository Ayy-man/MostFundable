create unique index orgs_one_platform_intake_idx
on public.orgs ((brand ->> 'platform_intake'))
where brand @> '{"platform_intake": true}'::jsonb;

create table public.consumer_referrals (
  id uuid primary key default extensions.gen_random_uuid(),
  consumer_id uuid not null references public.profiles(id),
  source_client_id uuid not null,
  source_org_id uuid not null references public.orgs(id),
  platform_org_id uuid not null references public.orgs(id),
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  clicked_at timestamptz,
  converted_at timestamptz,
  converted_client_id uuid,
  constraint consumer_referrals_token_hash_length
    check (octet_length(token_hash) = 32),
  constraint consumer_referrals_distinct_orgs
    check (source_org_id <> platform_org_id),
  constraint consumer_referrals_conversion_pair
    check ((converted_client_id is null) = (converted_at is null)),
  constraint consumer_referrals_source_client_fk
    foreign key (source_client_id, source_org_id)
    references public.clients(id, org_id),
  constraint consumer_referrals_converted_client_fk
    foreign key (converted_client_id, platform_org_id)
    references public.clients(id, org_id)
);

create index consumer_referrals_consumer_created_idx
  on public.consumer_referrals(consumer_id, created_at desc);
create index consumer_referrals_converted_client_idx
  on public.consumer_referrals(converted_client_id)
  where converted_client_id is not null;

alter table public.consumer_referrals enable row level security;
alter table public.consumer_referrals force row level security;

revoke all on table public.consumer_referrals from public, anon, authenticated;
grant select on table public.consumer_referrals to authenticated;
grant select, insert, update, delete on table public.consumer_referrals to service_role;

create policy consumer_referrals_select_own
on public.consumer_referrals
for select
to authenticated
using (
  consumer_id = (select auth.uid())
  or exists (
    select 1
    from public.clients as converted_client
    where converted_client.id = converted_client_id
      and converted_client.consumer_profile_id = (select auth.uid())
  )
);

create function public.referral_create(
  p_consumer_id uuid,
  p_source_client_id uuid,
  p_platform_org_id uuid,
  p_token_hash bytea
)
returns table (
  referral_id uuid,
  source_org_id uuid,
  platform_org_id uuid,
  created_at timestamptz,
  clicked_at timestamptz,
  converted_at timestamptz,
  converted_client_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_client public.clients%rowtype;
  created_referral public.consumer_referrals%rowtype;
begin
  if octet_length(p_token_hash) <> 32 then
    raise exception 'invalid referral token digest' using errcode = '22023';
  end if;

  select client.* into source_client
  from public.clients as client
  where client.id = p_source_client_id
    and client.consumer_profile_id = p_consumer_id;

  if not found then
    raise exception 'referral source is invalid' using errcode = '42501';
  end if;

  if source_client.org_id = p_platform_org_id
    or not exists (
      select 1
      from public.orgs as organization
      where organization.id = p_platform_org_id
        and organization.brand @> '{"platform_intake": true}'::jsonb
    ) then
    raise exception 'referral destination is invalid' using errcode = '42501';
  end if;

  insert into public.consumer_referrals (
    consumer_id,
    source_client_id,
    source_org_id,
    platform_org_id,
    token_hash
  ) values (
    p_consumer_id,
    source_client.id,
    source_client.org_id,
    p_platform_org_id,
    p_token_hash
  )
  returning * into created_referral;

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
    source_client.org_id,
    source_client.id,
    p_consumer_id,
    'referral.created',
    'consumer_referral',
    created_referral.id,
    created_referral.created_at,
    '{}'::jsonb
  );

  return query select
    created_referral.id,
    created_referral.source_org_id,
    created_referral.platform_org_id,
    created_referral.created_at,
    created_referral.clicked_at,
    created_referral.converted_at,
    created_referral.converted_client_id;
end;
$$;

create function public.referral_mark_clicked(p_token_hash bytea)
returns table (
  referral_id uuid,
  source_org_id uuid,
  platform_org_id uuid,
  created_at timestamptz,
  clicked_at timestamptz,
  converted_at timestamptz,
  converted_client_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  referral public.consumer_referrals%rowtype;
begin
  select candidate.* into referral
  from public.consumer_referrals as candidate
  join public.orgs as destination
    on destination.id = candidate.platform_org_id
   and destination.brand @> '{"platform_intake": true}'::jsonb
  where candidate.token_hash = p_token_hash
  for update of candidate;

  if not found then
    raise exception 'referral not found' using errcode = 'P0002';
  end if;

  if referral.clicked_at is null then
    update public.consumer_referrals
    set clicked_at = clock_timestamp()
    where id = referral.id
    returning * into referral;

    insert into public.audit_log (
      org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
    ) values (
      referral.source_org_id,
      referral.source_client_id,
      null,
      'referral.clicked',
      'consumer_referral',
      referral.id,
      referral.clicked_at,
      '{}'::jsonb
    );
  end if;

  return query select
    referral.id,
    referral.source_org_id,
    referral.platform_org_id,
    referral.created_at,
    referral.clicked_at,
    referral.converted_at,
    referral.converted_client_id;
end;
$$;

create function public.referral_mark_converted(
  p_token_hash bytea,
  p_converted_client_id uuid,
  p_actor_id uuid
)
returns table (
  referral_id uuid,
  status text,
  source_org_id uuid,
  platform_org_id uuid,
  created_at timestamptz,
  clicked_at timestamptz,
  converted_at timestamptz,
  converted_client_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  referral public.consumer_referrals%rowtype;
begin
  select candidate.* into referral
  from public.consumer_referrals as candidate
  where candidate.token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'referral not found' using errcode = 'P0002';
  end if;

  if referral.clicked_at is null then
    raise exception 'referral has not been clicked' using errcode = '22023';
  end if;

  if referral.converted_at is not null then
    if referral.converted_client_id <> p_converted_client_id then
      raise exception 'referral already converted' using errcode = '23505';
    end if;

    return query select
      referral.id,
      'already_converted'::text,
      referral.source_org_id,
      referral.platform_org_id,
      referral.created_at,
      referral.clicked_at,
      referral.converted_at,
      referral.converted_client_id;
    return;
  end if;

  if not exists (
    select 1
    from public.clients as converted_client
    where converted_client.id = p_converted_client_id
      and converted_client.org_id = referral.platform_org_id
      and converted_client.consumer_profile_id = p_actor_id
  ) then
    raise exception 'conversion identity is invalid' using errcode = '42501';
  end if;

  update public.consumer_referrals
  set
    converted_at = clock_timestamp(),
    converted_client_id = p_converted_client_id
  where id = referral.id
  returning * into referral;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    referral.platform_org_id,
    referral.converted_client_id,
    p_actor_id,
    'referral.converted',
    'consumer_referral',
    referral.id,
    referral.converted_at,
    '{}'::jsonb
  );

  return query select
    referral.id,
    'converted'::text,
    referral.source_org_id,
    referral.platform_org_id,
    referral.created_at,
    referral.clicked_at,
    referral.converted_at,
    referral.converted_client_id;
end;
$$;

revoke all on function public.referral_create(uuid, uuid, uuid, bytea)
  from public, anon, authenticated;
revoke all on function public.referral_mark_clicked(bytea)
  from public, anon, authenticated;
revoke all on function public.referral_mark_converted(bytea, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.referral_create(uuid, uuid, uuid, bytea)
  to service_role;
grant execute on function public.referral_mark_clicked(bytea)
  to service_role;
grant execute on function public.referral_mark_converted(bytea, uuid, uuid)
  to service_role;
