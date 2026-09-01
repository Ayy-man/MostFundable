-- One immutable operator review record per company upload.

create table public.document_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  upload_id uuid not null unique references public.document_uploads(id) on delete cascade,
  reviewed_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_at timestamptz not null default now()
);

create index document_reviews_org_reviewed_idx
  on public.document_reviews(org_id, reviewed_at desc);

create function private.validate_document_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload record;
  v_reviewer record;
begin
  select upload.org_id, upload.kind, upload.lifecycle
    into v_upload
  from public.document_uploads as upload
  where upload.id = new.upload_id;

  select profile.org_id, profile.role
    into v_reviewer
  from public.profiles as profile
  where profile.id = new.reviewed_by and profile.disabled_at is null;

  if v_upload.org_id is distinct from new.org_id
    or v_upload.kind is distinct from 'company'::public.document_upload_kind
    or v_upload.lifecycle is distinct from 'stored'::public.document_upload_lifecycle
    or v_reviewer.org_id is distinct from new.org_id
    or v_reviewer.role is distinct from 'operator_member'::public.app_role
  then
    raise exception using errcode = '42501', message = 'DOCUMENT_REVIEW_SCOPE_INVALID';
  end if;

  return new;
end;
$$;

create trigger document_reviews_validate
before insert on public.document_reviews
for each row execute function private.validate_document_review();

create function private.audit_document_review_recorded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
begin
  select upload.client_id into v_client_id
  from public.document_uploads as upload
  where upload.id = new.upload_id;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    new.org_id,
    v_client_id,
    new.reviewed_by,
    'document_review.recorded',
    'document_review',
    new.id,
    new.reviewed_at,
    jsonb_build_object('status', 'reviewed')
  );
  return new;
end;
$$;

create trigger document_reviews_audit_recorded
after insert on public.document_reviews
for each row execute function private.audit_document_review_recorded();

create trigger document_reviews_immutable
before update or delete on public.document_reviews
for each row execute function private.prevent_row_change();

create trigger document_reviews_no_truncate
before truncate on public.document_reviews
for each statement execute function public.append_only_guard();
alter table public.document_reviews
  enable always trigger document_reviews_no_truncate;

alter table public.document_reviews enable row level security;
alter table public.document_reviews force row level security;

revoke all on table public.document_reviews from public, anon, authenticated;
grant select on table public.document_reviews to authenticated;
grant all on table public.document_reviews to service_role;
revoke truncate on table public.document_reviews from public, anon, authenticated, service_role;

create policy document_reviews_select_operator
on public.document_reviews
for select
to authenticated
using (
  (select private.auth_app_role()) in (
    'operator_member'::public.app_role,
    'platform_admin'::public.app_role
  )
  and exists (
    select 1
    from public.document_uploads as upload
    where upload.id = document_reviews.upload_id
      and (select private.can_access_client(upload.client_id))
  )
);

create policy document_reviews_service_all
on public.document_reviews
for all
to service_role
using (true)
with check (true);
