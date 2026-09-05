begin;
set local search_path = public, extensions;

select plan(15);

select has_table('public', 'consumer_paid_invoice_evidence', 'paid invoice evidence table exists');
select has_trigger('public', 'consumer_paid_invoice_evidence', 'consumer_paid_invoice_evidence_prevent_change', 'paid invoice evidence is append-only');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.consumer_paid_invoice_evidence'::regclass), 'paid invoice evidence RLS is enabled and forced');
select ok(not has_table_privilege('authenticated', 'public.consumer_paid_invoice_evidence', 'insert'), 'authenticated cannot write paid invoice evidence');
select ok(not has_table_privilege('service_role', 'public.consumer_paid_invoice_evidence', 'insert'), 'service role writes paid invoice evidence only through the RPC');
select ok(has_function_privilege('service_role', 'public.billing_record_paid_invoice_evidence(text,text,text,bigint,text,timestamptz,timestamptz,timestamptz)', 'execute'), 'service role reaches paid invoice evidence RPC');

insert into public.orgs(id, name, slug) values
  ('43800000-0000-4000-8000-000000000001', 'Invoice evidence org', 'paid-invoice-evidence');
insert into public.clients(id, org_id, display_name) values
  ('43800000-0000-4000-8000-000000000002', '43800000-0000-4000-8000-000000000001', 'Invoice evidence client');
insert into public.consents(id, client_id, kind, text_version, signed_at, ip, esig_ref) values
  ('43800000-0000-4000-8000-000000000010', '43800000-0000-4000-8000-000000000002', 'monitoring', 'v1', '2026-08-01', '127.0.0.1', 'invoice-evidence'),
  ('43800000-0000-4000-8000-000000000011', '43800000-0000-4000-8000-000000000002', 'analysis', 'v1', '2026-08-01', '127.0.0.1', 'invoice-evidence');
insert into public.enrollments(id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id) values
  ('43800000-0000-4000-8000-000000000003', '43800000-0000-4000-8000-000000000002', 'active', '2026-08-01', '2026-08-01', 'invoice-evidence');
insert into public.consumer_subscriptions(
  client_id, enrollment_id, provider, customer_ref, payment_method_ref, subscription_ref,
  price_ref, price_cents, currency, status, idempotency_key
) values (
  '43800000-0000-4000-8000-000000000002', '43800000-0000-4000-8000-000000000003',
  'stripe', 'cus_438', 'pm_438', 'sub_438', 'price_438', 4900, 'usd', 'active', 'enroll:438'
);
insert into public.stripe_webhook_events(event_id, event_type) values
  ('evt_438_paid', 'invoice.paid'),
  ('evt_438_outside', 'invoice.paid'),
  ('evt_438_operator', 'invoice.paid'),
  ('evt_438_wrong', 'invoice.payment_failed');

select throws_ok(
  $$select public.billing_record_paid_invoice_evidence('evt_438_wrong','in_wrong','sub_438',4900,'usd','2026-08-01','2026-09-01','2026-08-15')$$,
  '22023', 'PAID_INVOICE_EVIDENCE_INVALID', 'non-paid webhook events cannot become revenue evidence'
);
select is(
  (public.billing_record_paid_invoice_evidence('evt_438_paid','in_438','sub_438',4900,'usd','2026-08-01','2026-09-01','2026-08-15')->>'reason_code'),
  'recorded', 'a paid consumer invoice records once'
);
select results_eq(
  $$select provider_invoice_ref, subscription_ref, amount_paid_cents, currency, period_start::date, period_end::date, paid_at::date
    from public.consumer_paid_invoice_evidence where provider_invoice_ref = 'in_438'$$,
  $$values ('in_438'::text, 'sub_438'::text, 4900::bigint, 'usd'::text, '2026-08-01'::date, '2026-09-01'::date, '2026-08-15'::date)$$,
  'the retained receipt has only the invoice facts needed for accrual'
);
select is(
  (public.billing_record_paid_invoice_evidence('evt_438_paid','in_438','sub_438',4900,'usd','2026-08-01','2026-09-01','2026-08-15')->>'reason_code'),
  'duplicate', 'provider invoice identity makes redelivery idempotent'
);
select is(
  (public.billing_record_paid_invoice_evidence('evt_438_operator','in_operator_438','sub_not_consumer',4900,'usd','2026-08-01','2026-09-01','2026-08-15')->>'reason_code'),
  'ignored', 'a verified non-consumer invoice does not enter consumer revenue'
);
select is(
  (public.billing_record_paid_invoice_evidence('evt_438_outside','in_outside_438','sub_438',4900,'usd','2026-07-01','2026-08-01','2026-07-31')->>'reason_code'),
  'recorded', 'an older paid invoice is retained for its own month'
);
select results_eq(
  $$select (consumer_subscriptions->0->>'paid_invoice_amount_cents')::bigint,
      (consumer_subscriptions->0->>'paid_invoice_count')::integer
    from public.revenue_read_accrual_inputs('43800000-0000-4000-8000-000000000001', '2026-08-01')$$,
  $$values (4900::bigint, 1::integer)$$,
  'accrual input sums only paid invoices inside the requested month'
);
select is(
  (select count(*)::integer from public.consumer_paid_invoice_evidence where subscription_ref = 'sub_438'),
  2, 'replay adds no duplicate evidence row'
);
select throws_ok(
  $$update public.consumer_paid_invoice_evidence set amount_paid_cents = 0 where provider_invoice_ref = 'in_438'$$,
  'P0001', 'consumer_paid_invoice_evidence rows are append-only', 'paid invoice evidence cannot change after receipt'
);

select * from finish();
rollback;
