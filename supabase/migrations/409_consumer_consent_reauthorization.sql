-- A revoked consumer permission can be granted again only through a new,
-- immutable signature. The old grant, its revocation, and the new grant all
-- remain in the evidence ledger; latest-event authorization decides which one
-- is effective.

begin;

alter table public.esignatures
  drop constraint if exists esignatures_document_kind_valid;
alter table public.esignatures
  add constraint esignatures_document_kind_valid
  check (document_kind in ('enrollment_agreement', 'monitoring', 'analysis'))
  not valid;
alter table public.esignatures
  validate constraint esignatures_document_kind_valid;

create or replace function public.enrollment_reauthorize_consent(
  p_enrollment_id uuid,
  p_actor_id uuid,
  p_kind text,
  p_draft_id uuid,
  p_signer_name text,
  p_typed_signature text,
  p_text_version text,
  p_ip inet,
  p_user_agent text
) returns table (
  consent_id uuid,
  signed_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor_role public.app_role;
  v_actor_disabled_at timestamptz;
  v_actor_full_name text;
  v_client_id uuid;
  v_consumer_profile_id uuid;
  v_enrollment_status public.enrollment_status;
  v_existing_esignature public.esignatures%rowtype;
  v_existing_consent_id uuid;
  v_existing_signed_at timestamptz;
  v_latest_authorized boolean;
  v_esignature_id uuid;
  v_signed_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_kind is null or p_kind not in ('monitoring', 'analysis') then
    raise exception using errcode = '22023', message = 'CONSENT_KIND_INVALID';
  end if;
  if p_draft_id is null
    or p_actor_id is null
    or p_enrollment_id is null
    or p_ip is null
    or length(btrim(coalesce(p_signer_name, ''))) not between 1 and 200
    or length(btrim(coalesce(p_typed_signature, ''))) not between 1 and 200
    or length(btrim(coalesce(p_text_version, ''))) not between 1 and 255
    or length(coalesce(p_user_agent, '')) > 512
  then
    raise exception using errcode = '22023', message = 'CONSENT_SIGNATURE_INVALID';
  end if;

  perform pg_catalog.set_config('app.actor_id', p_actor_id::text, true);

  select enrollment.client_id,
         enrollment.status,
         client.consumer_profile_id,
         profile.role,
         profile.disabled_at,
         profile.full_name
  into v_client_id,
       v_enrollment_status,
       v_consumer_profile_id,
       v_actor_role,
       v_actor_disabled_at,
       v_actor_full_name
  from public.enrollments as enrollment
  join public.clients as client on client.id = enrollment.client_id
  left join public.profiles as profile on profile.id = p_actor_id
  where enrollment.id = p_enrollment_id
  for update of enrollment, client;

  if v_client_id is null then
    raise exception using errcode = 'P0002', message = 'ENROLLMENT_NOT_FOUND';
  end if;
  if v_actor_role is distinct from 'consumer'::public.app_role
    or v_actor_disabled_at is not null
    or v_consumer_profile_id is distinct from p_actor_id
  then
    raise exception using errcode = '42501', message = 'CONSENT_ACTOR_FORBIDDEN';
  end if;
  if v_enrollment_status = 'cancelled' then
    raise exception using errcode = '23514', message = 'ENROLLMENT_CANCELLED';
  end if;
  if btrim(p_signer_name) is distinct from btrim(v_actor_full_name)
    or lower(btrim(p_typed_signature)) is distinct from lower(btrim(v_actor_full_name))
  then
    raise exception using errcode = '22023', message = 'CONSENT_SIGNATURE_MISMATCH';
  end if;

  -- A retry with the same draft returns the original signed grant. Reusing a
  -- draft for different evidence is a conflict, so idempotency cannot become a
  -- way to swap the legal text, signer, or permission after the fact.
  select * into v_existing_esignature
  from public.esignatures as esignature
  where esignature.client_draft_id = p_draft_id;

  if found then
    if v_existing_esignature.client_id is distinct from v_client_id
      or v_existing_esignature.document_kind is distinct from p_kind
      or v_existing_esignature.text_version is distinct from p_text_version
      or v_existing_esignature.signer_name is distinct from btrim(p_signer_name)
      or v_existing_esignature.typed_signature is distinct from btrim(p_typed_signature)
    then
      raise exception using errcode = '23505', message = 'CONSENT_DRAFT_CONFLICT';
    end if;

    select consent.id, consent.signed_at
    into v_existing_consent_id, v_existing_signed_at
    from public.consents as consent
    where consent.client_id = v_client_id
      and consent.kind = p_kind::public.consent_kind
      and consent.action = 'granted'
      and consent.text_version = p_text_version
      and consent.esig_ref = v_existing_esignature.id::text
    limit 1;

    if v_existing_consent_id is null then
      raise exception using errcode = '23505', message = 'CONSENT_DRAFT_INCOMPLETE';
    end if;

    return query select v_existing_consent_id, v_existing_signed_at, true;
    return;
  end if;

  select event.authorized
  into v_latest_authorized
  from (
    select consent.signed_at as occurred_at,
           true as authorized,
           consent.id
    from public.consents as consent
    where consent.client_id = v_client_id
      and consent.kind = p_kind::public.consent_kind
      and consent.action = 'granted'
    union all
    select revocation.revoked_at,
           false,
           revocation.id
    from public.consent_revocations as revocation
    where revocation.client_id = v_client_id
      and revocation.kind = p_kind
  ) as event
  order by event.occurred_at desc, event.authorized asc, event.id desc
  limit 1;

  if v_latest_authorized is null then
    raise exception using errcode = '23514', message = 'CONSENT_NEVER_GRANTED';
  end if;
  if v_latest_authorized then
    raise exception using errcode = '23505', message = 'CONSENT_ALREADY_AUTHORIZED';
  end if;

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
    v_client_id,
    p_kind,
    p_text_version,
    btrim(p_signer_name),
    btrim(p_typed_signature),
    v_signed_at,
    p_ip,
    nullif(p_user_agent, ''),
    p_draft_id
  )
  returning id into v_esignature_id;

  insert into public.consents (
    client_id,
    kind,
    action,
    text_version,
    signed_at,
    ip,
    esig_ref
  ) values (
    v_client_id,
    p_kind::public.consent_kind,
    'granted',
    p_text_version,
    v_signed_at,
    p_ip,
    v_esignature_id::text
  )
  returning id into v_existing_consent_id;

  return query select v_existing_consent_id, v_signed_at, false;
end;
$fn$;

revoke all on function public.enrollment_reauthorize_consent(
  uuid, uuid, text, uuid, text, text, text, inet, text
) from public, anon, authenticated;
grant execute on function public.enrollment_reauthorize_consent(
  uuid, uuid, text, uuid, text, text, text, inet, text
) to service_role;

commit;
