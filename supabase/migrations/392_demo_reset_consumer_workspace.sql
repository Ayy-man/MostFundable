-- 392 — a demo consumer can start enrollment over without anything being erased.
--
-- The Milestone-2 walk ends on "Enrollment complete", and the deployed platform then has no way to
-- run that beat a second time: `enrollments.client_id` is UNIQUE (002), the enrollment resumes on
-- every load, and the recipe between takes has been `demo:reset` — which the hosted project cannot
-- run. Deleting the enrollment is not an option either: migrations 350 and 374 make enrollment
-- evidence non-erasable on purpose, and the consents, e-signature, subscription and IDV rows
-- hanging off it are exactly the evidence that boundary protects.
--
-- So a reset is a *rebinding*, not an erasure. The consumer's current client is archived through
-- the same lifecycle columns `set_client_status` (190) writes and its profile binding is released;
-- a fresh client is inserted for the same profile in the same organization, carrying the same
-- display name, business and goal, and the insert normalizer (316) starts it at Onboarding. Every
-- durable row of the old walkthrough — enrollment, consents, e-signature, subscription, IDV
-- session, milestones, plan, audit — stays attached to the archived client, where the operator
-- book still shows it. The new client has nothing, which is the pre-enrollment state.
--
-- Scope is deliberately narrow: `service_role` only (the route behind it is gated by
-- `FEATURE_DEMO_QUICK_SIGN_IN`, the same demo-phase flag as quick sign-in), and the function
-- refuses any profile that is not a consumer whose address is in the caller-supplied closed list,
-- which the route derives from `DEMO_CONSUMER_PERSONA_EMAILS`. A real consumer can never be reset
-- through it.

begin;

create or replace function public.demo_reset_consumer_workspace(
  p_profile_id uuid,
  p_allowed_emails text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_client public.clients%rowtype;
  v_new_client_id uuid;
  v_at timestamptz;
  v_previous_marker text := pg_catalog.current_setting('app.governed_client_write', true);
begin
  select profile.* into v_profile
  from public.profiles as profile
  where profile.id = p_profile_id;

  if v_profile.id is null
    or v_profile.role <> 'consumer'
    or p_allowed_emails is null
    or not (pg_catalog.lower(v_profile.email) = any (p_allowed_emails)) then
    raise exception using errcode = '42501', message = 'DEMO_RESET_FORBIDDEN';
  end if;

  select client.* into v_client
  from public.clients as client
  where client.consumer_profile_id = p_profile_id
  for update;

  if v_client.id is null then
    raise exception using errcode = 'P0002', message = 'CLIENT_NOT_FOUND';
  end if;

  v_at := pg_catalog.clock_timestamp();

  -- Archive and release the binding in one statement, under the governed-write marker the
  -- lifecycle columns' guard (242) demands, then put the marker back so the insert below is
  -- normalized to a fresh Onboarding row rather than trusted as governed.
  perform pg_catalog.set_config('app.governed_client_write', 'on', true);
  update public.clients
  set consumer_profile_id = null,
      status = 'archived',
      archived_at = v_at,
      archived_by = p_profile_id
  where id = v_client.id;
  perform pg_catalog.set_config('app.governed_client_write', coalesce(v_previous_marker, ''), true);

  insert into public.clients (
    org_id, consumer_profile_id, business_name, display_name, assigned_to, goal_cents
  ) values (
    v_client.org_id, p_profile_id, v_client.business_name, v_client.display_name,
    v_client.assigned_to, v_client.goal_cents
  )
  returning id into v_new_client_id;

  insert into public.audit_log (
    org_id, client_id, actor_profile_id, action, subject_type, subject_id, occurred_at, meta
  ) values (
    v_client.org_id, v_client.id, p_profile_id, 'client.demo_reset', 'client', v_client.id, v_at,
    pg_catalog.jsonb_build_object('from', v_client.id::text, 'to', v_new_client_id::text)
  );

  return v_new_client_id;
end;
$$;

revoke all on function public.demo_reset_consumer_workspace(uuid, text[])
  from public, anon, authenticated;
grant execute on function public.demo_reset_consumer_workspace(uuid, text[]) to service_role;

comment on function public.demo_reset_consumer_workspace(uuid, text[]) is
  'Demo-only: archives a seeded consumer''s client and binds the profile to a fresh Onboarding client so enrollment can be walked again. Erases nothing.';

commit;
