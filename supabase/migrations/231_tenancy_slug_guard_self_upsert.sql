-- 231_tenancy_slug_guard_self_upsert.sql — an org keeps its own slug through an upsert.
--
-- `insert … on conflict (id) do update` fires the BEFORE INSERT trigger on the proposed
-- row before Postgres resolves the conflict, so the seed's platform-intake org read its
-- own slug as reserved (170) and every `demo:seed` on an already-seeded database failed
-- with TENANT_SLUG_RESERVED. A clean `db reset` never saw it because no row existed yet.
-- The reservation now excludes the row's own id: another org still cannot take a
-- platform-intake slug or a static reserved word, and the same org keeps the slug it
-- already owns. The one-argument form stays for callers that have no org in hand.

begin;

create or replace function private.tenancy_slug_reserved(p_slug text, p_exclude_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_slug = any(array['www', 'admin', 'app', 'api', 'mail', 'platform', 'help', 'status', 'docs'])
    or exists (
      select 1
      from public.orgs as organization
      where organization.brand @> '{"platform_intake": true}'::jsonb
        and organization.slug = p_slug
        and organization.id is distinct from p_exclude_org_id
    )
$$;

revoke all on function private.tenancy_slug_reserved(text, uuid) from public;

create or replace function private.tenancy_slug_reserved(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.tenancy_slug_reserved(p_slug, null::uuid)
$$;

revoke all on function private.tenancy_slug_reserved(text) from public;

create or replace function private.tenancy_guard_org_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE'
    and new.slug is not distinct from old.slug
  then
    return new;
  end if;

  if private.tenancy_slug_reserved(new.slug, new.id) then
    raise exception using errcode = '23514', message = 'TENANT_SLUG_RESERVED';
  end if;

  if tg_op = 'UPDATE'
    and old.brand_published_at is not null
    and coalesce(pg_catalog.current_setting('app.tenancy_slug_rename', true), 'off') <> 'on'
  then
    raise exception using errcode = '42501', message = 'TENANT_SLUG_PUBLISHED';
  end if;

  return new;
end;
$fn$;

revoke all on function private.tenancy_guard_org_slug() from public;

commit;
