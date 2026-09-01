create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.org_role as enum (
  'owner',
  'admin',
  'prep_specialist',
  'funding_specialist',
  'commando',
  'manager'
);

create type public.client_stage as enum (
  'onboarding',
  'optimization',
  'ready',
  'applying',
  'funded',
  'graduate'
);

create type public.app_role as enum (
  'platform_admin',
  'operator_member',
  'consumer',
  'affiliate'
);

create type public.org_plan as enum ('trial', 'pro', 'agency');
create type public.org_membership as enum ('trial', 'current', 'past_due', 'grace', 'deactivated');
create type public.assignment_mode as enum ('manual', 'round_robin');
create type public.affiliate_payment_status as enum ('not_ready', 'pending', 'submitted', 'paid');

create table public.orgs (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  slug text not null unique,
  brand jsonb not null default '{}'::jsonb,
  plan public.org_plan not null default 'trial',
  seats_included integer not null default 5,
  seat_price_cents integer not null default 2900,
  base_price_cents integer not null default 49700,
  membership public.org_membership not null default 'trial',
  monitoring_split_pct numeric(5, 2),
  default_client_goal_cents bigint not null default 10000000,
  team_sees_all_clients boolean not null default true,
  assignment_mode public.assignment_mode not null default 'manual',
  created_at timestamptz not null default now(),
  constraint orgs_seats_included_nonnegative check (seats_included >= 0),
  constraint orgs_seat_price_nonnegative check (seat_price_cents >= 0),
  constraint orgs_base_price_nonnegative check (base_price_cents >= 0),
  constraint orgs_default_goal_positive check (default_client_goal_cents > 0),
  constraint orgs_monitoring_split_range check (
    monitoring_split_pct is null
    or monitoring_split_pct between 0 and 100
  )
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null,
  org_id uuid references public.orgs(id),
  org_role public.org_role,
  manages uuid[] not null default '{}'::uuid[],
  full_name text not null,
  email text not null,
  phone text,
  created_at timestamptz not null default now(),
  constraint profiles_id_org_unique unique (id, org_id),
  constraint profiles_role_shape_check check (
    (role = 'platform_admin' and org_id is null and org_role is null)
    or (role = 'operator_member' and org_id is not null and org_role is not null)
    or (role in ('consumer', 'affiliate') and org_id is not null and org_role is null)
  )
);

create table public.affiliates (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  profile_id uuid unique,
  name text not null,
  referral_slug text not null unique,
  constraint affiliates_id_org_unique unique (id, org_id),
  constraint affiliates_profile_org_fk
    foreign key (profile_id, org_id)
    references public.profiles(id, org_id)
);

create table public.clients (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  consumer_profile_id uuid unique,
  business_name text,
  display_name text not null,
  stage public.client_stage not null default 'onboarding',
  assigned_to uuid,
  affiliate_id uuid,
  goal_cents bigint,
  started_at date not null default current_date,
  stage_entered_at timestamptz not null default now(),
  matches_unlocked_override boolean not null default false,
  funded_amount_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  constraint clients_id_org_unique unique (id, org_id),
  constraint clients_goal_nonnegative check (goal_cents is null or goal_cents >= 0),
  constraint clients_funded_amount_nonnegative check (funded_amount_cents >= 0),
  constraint clients_consumer_org_fk
    foreign key (consumer_profile_id, org_id)
    references public.profiles(id, org_id),
  constraint clients_assignee_org_fk
    foreign key (assigned_to, org_id)
    references public.profiles(id, org_id),
  constraint clients_affiliate_org_fk
    foreign key (affiliate_id, org_id)
    references public.affiliates(id, org_id)
);

create table public.affiliate_client_shares (
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  expected_commission_cents bigint,
  payment_status public.affiliate_payment_status not null default 'not_ready',
  primary key (affiliate_id, client_id),
  constraint affiliate_shares_commission_nonnegative check (
    expected_commission_cents is null
    or expected_commission_cents >= 0
  )
);

create index profiles_org_id_idx on public.profiles(org_id);
create index profiles_role_idx on public.profiles(role);
create index profiles_org_role_idx on public.profiles(org_role);
create index affiliates_org_id_idx on public.affiliates(org_id);
create index affiliates_profile_id_idx on public.affiliates(profile_id);
create index clients_org_id_idx on public.clients(org_id);
create index clients_consumer_profile_id_idx on public.clients(consumer_profile_id);
create index clients_assigned_to_idx on public.clients(assigned_to);
create index clients_affiliate_id_idx on public.clients(affiliate_id);
create index clients_stage_idx on public.clients(stage);
create index affiliate_client_shares_client_id_idx on public.affiliate_client_shares(client_id);
create index affiliate_client_shares_affiliate_id_idx on public.affiliate_client_shares(affiliate_id);

create function private.validate_affiliate_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.profile_id is not null and not exists (
    select 1
    from public.profiles as profile
    where profile.id = new.profile_id
      and profile.org_id = new.org_id
      and profile.role = 'affiliate'
  ) then
    raise exception 'affiliate profile must have the affiliate application role';
  end if;

  return new;
end;
$$;

create trigger affiliates_validate_profile
before insert or update of profile_id, org_id on public.affiliates
for each row execute function private.validate_affiliate_profile();

create function private.validate_client_profile_roles()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.consumer_profile_id is not null and not exists (
    select 1
    from public.profiles as profile
    where profile.id = new.consumer_profile_id
      and profile.org_id = new.org_id
      and profile.role = 'consumer'
  ) then
    raise exception 'consumer profile must have the consumer application role';
  end if;

  if new.assigned_to is not null and not exists (
    select 1
    from public.profiles as profile
    where profile.id = new.assigned_to
      and profile.org_id = new.org_id
      and profile.role = 'operator_member'
  ) then
    raise exception 'client assignee must have the operator member application role';
  end if;

  return new;
end;
$$;

create trigger clients_validate_profile_roles
before insert or update of consumer_profile_id, assigned_to, org_id on public.clients
for each row execute function private.validate_client_profile_roles();

create function private.validate_affiliate_client_share()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.affiliates as affiliate
    join public.clients as client on client.id = new.client_id
    where affiliate.id = new.affiliate_id
      and affiliate.org_id = client.org_id
  ) then
    raise exception 'affiliate and client must belong to the same organization';
  end if;

  return new;
end;
$$;

create trigger affiliate_client_shares_validate_org
before insert or update of affiliate_id, client_id on public.affiliate_client_shares
for each row execute function private.validate_affiliate_client_share();

revoke all on function private.validate_affiliate_profile() from public;
revoke all on function private.validate_client_profile_roles() from public;
revoke all on function private.validate_affiliate_client_share() from public;

create function private.auth_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id
  from public.profiles as profile
  where profile.id = (select auth.uid())
$$;

create function private.auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.org_id
  from public.profiles as profile
  where profile.id = (select auth.uid())
$$;

create function private.auth_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles as profile
  where profile.id = (select auth.uid())
$$;

create function private.auth_org_role()
returns public.org_role
language sql
stable
security definer
set search_path = ''
as $$
  select profile.org_role
  from public.profiles as profile
  where profile.id = (select auth.uid())
$$;

create function private.can_access_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when profile.role = 'platform_admin' then true
        when profile.role = 'consumer' then client.consumer_profile_id = profile.id
        when profile.role = 'operator_member' and client.org_id = profile.org_id then
          organization.team_sees_all_clients
          or client.assigned_to = profile.id
          or profile.org_role in ('owner', 'admin', 'commando')
          or (
            profile.org_role = 'manager'
            and exists (
              select 1
              from public.profiles as managed_profile
              where managed_profile.id = client.assigned_to
                and managed_profile.org_id = profile.org_id
                and managed_profile.role = 'operator_member'
                and managed_profile.id = any(profile.manages)
            )
          )
        else false
      end
      from public.clients as client
      join public.orgs as organization on organization.id = client.org_id
      join public.profiles as profile on profile.id = (select auth.uid())
      where client.id = p_client_id
    ),
    false
  )
$$;

revoke all on function private.auth_profile_id() from public;
revoke all on function private.auth_org_id() from public;
revoke all on function private.auth_app_role() from public;
revoke all on function private.auth_org_role() from public;
revoke all on function private.can_access_client(uuid) from public;
grant execute on function private.auth_profile_id() to authenticated;
grant execute on function private.auth_org_id() to authenticated;
grant execute on function private.auth_app_role() to authenticated;
grant execute on function private.auth_org_role() to authenticated;
grant execute on function private.can_access_client(uuid) to authenticated;

alter table public.orgs enable row level security;
alter table public.orgs force row level security;
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.affiliates enable row level security;
alter table public.affiliates force row level security;
alter table public.clients enable row level security;
alter table public.clients force row level security;
alter table public.affiliate_client_shares enable row level security;
alter table public.affiliate_client_shares force row level security;

revoke all on table public.orgs from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.affiliates from anon, authenticated;
revoke all on table public.clients from anon, authenticated;
revoke all on table public.affiliate_client_shares from anon, authenticated;

grant select, insert, update, delete on table public.orgs to authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.affiliates to authenticated;
grant select, insert, update, delete on table public.clients to authenticated;
grant select, insert, update, delete on table public.affiliate_client_shares to authenticated;

create policy orgs_select_authenticated
on public.orgs
for select
to authenticated
using (
  (select private.auth_app_role()) = 'platform_admin'
  or id = (select private.auth_org_id())
);

create policy orgs_platform_write
on public.orgs
for all
to authenticated
using ((select private.auth_app_role()) = 'platform_admin')
with check ((select private.auth_app_role()) = 'platform_admin');

create policy orgs_operator_update
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

create policy profiles_select_authenticated
on public.profiles
for select
to authenticated
using (
  (select private.auth_app_role()) = 'platform_admin'
  or id = (select private.auth_profile_id())
  or (
    (select private.auth_app_role()) = 'operator_member'
    and org_id = (select private.auth_org_id())
  )
);

create policy profiles_platform_write
on public.profiles
for all
to authenticated
using ((select private.auth_app_role()) = 'platform_admin')
with check ((select private.auth_app_role()) = 'platform_admin');

create policy profiles_operator_insert
on public.profiles
for insert
to authenticated
with check (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.auth_org_role()) in ('owner', 'admin')
  and org_id = (select private.auth_org_id())
  and role <> 'platform_admin'
);

create policy profiles_operator_update
on public.profiles
for update
to authenticated
using (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.auth_org_role()) in ('owner', 'admin')
  and org_id = (select private.auth_org_id())
)
with check (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.auth_org_role()) in ('owner', 'admin')
  and org_id = (select private.auth_org_id())
  and role <> 'platform_admin'
);

create policy profiles_operator_delete
on public.profiles
for delete
to authenticated
using (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.auth_org_role()) in ('owner', 'admin')
  and org_id = (select private.auth_org_id())
  and role <> 'platform_admin'
);

create policy affiliates_select_authenticated
on public.affiliates
for select
to authenticated
using (
  (select private.auth_app_role()) = 'platform_admin'
  or (
    (select private.auth_app_role()) = 'operator_member'
    and org_id = (select private.auth_org_id())
  )
  or (
    (select private.auth_app_role()) = 'affiliate'
    and profile_id = (select private.auth_profile_id())
  )
);

create policy affiliates_platform_write
on public.affiliates
for all
to authenticated
using ((select private.auth_app_role()) = 'platform_admin')
with check ((select private.auth_app_role()) = 'platform_admin');

create policy affiliates_operator_insert
on public.affiliates
for insert
to authenticated
with check (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.auth_org_role()) in ('owner', 'admin')
  and org_id = (select private.auth_org_id())
);

create policy affiliates_operator_update
on public.affiliates
for update
to authenticated
using (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.auth_org_role()) in ('owner', 'admin')
  and org_id = (select private.auth_org_id())
)
with check (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.auth_org_role()) in ('owner', 'admin')
  and org_id = (select private.auth_org_id())
);

create policy affiliates_operator_delete
on public.affiliates
for delete
to authenticated
using (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.auth_org_role()) in ('owner', 'admin')
  and org_id = (select private.auth_org_id())
);

create policy clients_select_authenticated
on public.clients
for select
to authenticated
using ((select private.can_access_client(id)));

create policy clients_platform_write
on public.clients
for all
to authenticated
using ((select private.auth_app_role()) = 'platform_admin')
with check ((select private.auth_app_role()) = 'platform_admin');

create policy clients_operator_insert
on public.clients
for insert
to authenticated
with check (
  (select private.auth_app_role()) = 'operator_member'
  and org_id = (select private.auth_org_id())
);

create policy clients_operator_update
on public.clients
for update
to authenticated
using (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.can_access_client(id))
)
with check (
  (select private.auth_app_role()) = 'operator_member'
  and org_id = (select private.auth_org_id())
);

create policy clients_operator_delete
on public.clients
for delete
to authenticated
using (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.can_access_client(id))
);

create policy affiliate_client_shares_select_authenticated
on public.affiliate_client_shares
for select
to authenticated
using (
  (select private.auth_app_role()) = 'platform_admin'
  or (
    (select private.auth_app_role()) = 'operator_member'
    and (select private.can_access_client(client_id))
  )
);

create policy affiliate_client_shares_platform_write
on public.affiliate_client_shares
for all
to authenticated
using ((select private.auth_app_role()) = 'platform_admin')
with check ((select private.auth_app_role()) = 'platform_admin');

create policy affiliate_client_shares_operator_insert
on public.affiliate_client_shares
for insert
to authenticated
with check (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.can_access_client(client_id))
  and exists (
    select 1
    from public.affiliates as affiliate
    where affiliate.id = affiliate_id
      and affiliate.org_id = (select private.auth_org_id())
  )
);

create policy affiliate_client_shares_operator_update
on public.affiliate_client_shares
for update
to authenticated
using (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.can_access_client(client_id))
)
with check (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.can_access_client(client_id))
  and exists (
    select 1
    from public.affiliates as affiliate
    where affiliate.id = affiliate_id
      and affiliate.org_id = (select private.auth_org_id())
  )
);

create policy affiliate_client_shares_operator_delete
on public.affiliate_client_shares
for delete
to authenticated
using (
  (select private.auth_app_role()) = 'operator_member'
  and (select private.can_access_client(client_id))
);

create view public.specialist_default_client_view
with (security_invoker = true)
as
select client.*
from public.clients as client
where (select private.auth_app_role()) = 'operator_member'
  and (
    (
      (select private.auth_org_role()) = 'prep_specialist'
      and client.stage in ('onboarding', 'optimization')
    )
    or (
      (select private.auth_org_role()) = 'funding_specialist'
      and client.stage in ('ready', 'applying', 'funded')
    )
    or (select private.auth_org_role()) in ('owner', 'admin', 'commando', 'manager')
  );

create view public.affiliate_client_view
with (security_barrier = true)
as
select
  client.started_at,
  client.stage,
  client.funded_amount_cents,
  share.expected_commission_cents,
  share.payment_status
from public.clients as client
join public.affiliate_client_shares as share on share.client_id = client.id
join public.affiliates as affiliate on affiliate.id = share.affiliate_id
where affiliate.profile_id = (select auth.uid());

comment on view public.affiliate_client_view is
  'Owner-context projection is required because the shared authenticated role must have no affiliate base-table path.';

revoke all on table public.specialist_default_client_view from anon, authenticated;
revoke all on table public.affiliate_client_view from anon, authenticated;
grant select on table public.specialist_default_client_view to authenticated;
grant select on table public.affiliate_client_view to authenticated;
