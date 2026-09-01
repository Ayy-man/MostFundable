begin;

create or replace function public.affiliate_referral_valid(p_aff text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when p_aff is null or length(btrim(p_aff)) = 0 or length(btrim(p_aff)) > 255 then false
    else exists (
      select 1 from public.affiliates where referral_slug = btrim(p_aff)
    )
  end
$fn$;

revoke all on function public.affiliate_referral_valid(text) from public;
grant execute on function public.affiliate_referral_valid(text) to anon, authenticated;

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
  p_user_agent text,
  p_aff text
) returns table (enrollment_id uuid, esignature_id uuid)
language plpgsql security definer set search_path = '' as $fn$
declare
  v_affiliate_id uuid;
  v_enrollment_id uuid;
  v_esig_id uuid;
  v_signed_at timestamptz := pg_catalog.now();
begin
  perform set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);

  insert into public.esignatures (
    client_id, document_kind, text_version, signer_name, typed_signature,
    signed_at, ip, user_agent, client_draft_id
  ) values (
    p_client_id, 'enrollment_agreement', p_agreement_version, p_signer_name,
    p_typed_signature, v_signed_at, p_ip, p_user_agent, p_draft_id
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

  if p_aff is not null and length(btrim(p_aff)) between 1 and 255 then
    select affiliate.id into v_affiliate_id
    from public.affiliates as affiliate
    join public.clients as client on client.id = p_client_id
    where affiliate.referral_slug = btrim(p_aff)
      and affiliate.org_id = client.org_id;

    if v_affiliate_id is not null then
      update public.clients
      set affiliate_id = v_affiliate_id
      where id = p_client_id;

      insert into public.affiliate_client_shares (affiliate_id, client_id)
      values (v_affiliate_id, p_client_id)
      on conflict (affiliate_id, client_id) do nothing;
    end if;
  end if;

  insert into public.consents (
    client_id, kind, text_version, signed_at, ip, esig_ref
  ) values
    (p_client_id, 'monitoring', p_monitoring_version, v_signed_at, p_ip, v_esig_id::text),
    (p_client_id, 'analysis', p_analysis_version, v_signed_at, p_ip, v_esig_id::text)
  on conflict (client_id, kind, esig_ref)
    where esig_ref is not null and action = 'granted' do nothing;

  insert into public.enrollments (
    client_id, status, esig_doc_id, monitoring_consent_at, analysis_consent_at
  ) values (
    p_client_id, 'enrolled', v_esig_id::text, v_signed_at, v_signed_at
  ) returning id into v_enrollment_id;

  perform public.enrollment_record_milestone(
    p_client_id, 'agreement_signed', p_actor_id
  );

  return query select v_enrollment_id, v_esig_id;
end;
$fn$;

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
language sql security definer set search_path = '' as $fn$
  select * from public.enrollment_begin(
    p_client_id, p_actor_id, p_draft_id, p_signer_name, p_typed_signature,
    p_agreement_version, p_monitoring_version, p_analysis_version, p_ip,
    p_user_agent, null
  )
$fn$;

revoke all on function public.enrollment_begin(
  uuid,uuid,uuid,text,text,text,text,text,inet,text,text
) from public, anon, authenticated;
revoke all on function public.enrollment_begin(
  uuid,uuid,uuid,text,text,text,text,text,inet,text
) from public, anon, authenticated;
grant execute on function public.enrollment_begin(
  uuid,uuid,uuid,text,text,text,text,text,inet,text,text
) to service_role;
grant execute on function public.enrollment_begin(
  uuid,uuid,uuid,text,text,text,text,text,inet,text
) to service_role;

commit;
