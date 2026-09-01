-- 417_fee_agreement_void_lifecycle.test.sql
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(6);

insert into public.orgs (id, name, slug)
values ('00000000-0000-0000-0000-000000004161', 'Fee void lifecycle org', 'fee-void-lifecycle-org');

insert into auth.users (id, email, raw_app_meta_data)
values ('00000000-0000-0000-0000-000000004162', 'fee-void-admin@test.example', jsonb_build_object('app_role', 'platform_admin'));

insert into public.profiles (id, role, full_name, email)
values (
  '00000000-0000-0000-0000-000000004162',
  'platform_admin',
  'Fee Void Platform Admin',
  'fee-void-admin@test.example'
)
on conflict (id) do update
set role = excluded.role,
    full_name = excluded.full_name,
    email = excluded.email;

insert into public.clients (id, org_id, display_name)
values ('00000000-0000-0000-0000-000000004163', '00000000-0000-0000-0000-000000004161', 'Fee Void Client');

insert into public.org_flags (
  org_id, upfront_fee_approved, legal_signoff_ref, approved_by, approved_at
) values (
  '00000000-0000-0000-0000-000000004161', true, 'TEST-LGL-417',
  '00000000-0000-0000-0000-000000004162', now()
);

select lives_ok(
  $$
    insert into public.fee_agreements (
      client_id, org_id, model, pct, upfront_cents, success_cents,
      trigger_cents, custom_total_cents, status, source
    ) values (
      '00000000-0000-0000-0000-000000004163',
      '00000000-0000-0000-0000-000000004161',
      'package', null, 150000, 250000, null, null, 'active', 'platform_admin'
    )
  $$,
  'an approved gated agreement can be active before approval is withdrawn'
);

update public.org_flags
set upfront_fee_approved = false,
    legal_signoff_ref = null,
    approved_by = null,
    approved_at = null
where org_id = '00000000-0000-0000-0000-000000004161';

select lives_ok(
  $$
    update public.fee_agreements
    set status = 'void'
    where client_id = '00000000-0000-0000-0000-000000004163'
  $$,
  'the agreement can still be voided after approval is withdrawn'
);

select is(
  (select status::text from public.fee_agreements where client_id = '00000000-0000-0000-0000-000000004163'),
  'void',
  'the withdrawn status is stored'
);

select is(
  (select total_cents from public.fee_ledger where client_id = '00000000-0000-0000-0000-000000004163'),
  0::bigint,
  'voiding recomputes the amount due to zero'
);

select throws_ok(
  $$
    update public.fee_agreements
    set status = 'active'
    where client_id = '00000000-0000-0000-0000-000000004163'
  $$,
  'PT403',
  'legal_gate',
  'reactivating the gated agreement checks the withdrawn approval again'
);

select throws_ok(
  $$
    insert into public.org_fee_defaults (
      org_id, model, pct, upfront_cents, success_cents,
      trigger_cents, custom_total_cents, updated_by
    ) values (
      '00000000-0000-0000-0000-000000004161',
      'package', null, 150000, 250000, null, null,
      '00000000-0000-0000-0000-000000004162'
    )
  $$,
  'PT403',
  'legal_gate',
  'the void exception does not weaken the workspace-default gate'
);

select * from finish();
rollback;
