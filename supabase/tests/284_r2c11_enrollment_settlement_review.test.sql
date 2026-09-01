begin;
set local search_path = public, extensions;

-- 2026-08-17 R2C-11: unexpected settlement outcomes stop in durable review.
select plan(13);

select has_column('public', 'consumer_subscriptions', 'review_code', 'subscription has durable review reason');
select has_column('public', 'consumer_subscriptions', 'provider_amount_cents', 'subscription retains provider amount');
select has_column('public', 'consumer_subscriptions', 'provider_currency', 'subscription retains provider currency');
select has_column('public', 'consumer_subscriptions', 'provider_status', 'subscription retains provider status');
select ok(
  has_function_privilege(
    'service_role',
    'public.enrollment_review_sub(uuid,uuid,text,integer,text,text,text)',
    'execute'
  ),
  'service role can persist the review state'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.enrollment_review_sub(uuid,uuid,text,integer,text,text,text)',
    'execute'
  ),
  'authenticated callers cannot write the review state'
);

insert into public.orgs(id, name, slug) values
  ('28400000-0000-4000-8000-000000000001', 'Settlement Review', 'r2c11-review');
insert into public.clients(id, org_id, display_name) values
  ('28400000-0000-4000-8000-000000000002', '28400000-0000-4000-8000-000000000001', 'Settlement Review Client');
insert into public.consents(
  id, client_id, kind, text_version, signed_at, ip, esig_ref
) values
  (
    '28400000-0000-4000-8000-000000000004',
    '28400000-0000-4000-8000-000000000002',
    'monitoring', 'monitoring-2026-08-17.1', '2026-08-17T00:00:00Z', '127.0.0.1', 'r2c11-review'
  ),
  (
    '28400000-0000-4000-8000-000000000005',
    '28400000-0000-4000-8000-000000000002',
    'analysis', 'analysis-2026-08-17.1', '2026-08-17T00:00:00Z', '127.0.0.1', 'r2c11-review'
  );
insert into public.enrollments(
  id, client_id, status, monitoring_consent_at, analysis_consent_at, esig_doc_id
) values (
  '28400000-0000-4000-8000-000000000003',
  '28400000-0000-4000-8000-000000000002',
  'active', '2026-08-17T00:00:00Z', '2026-08-17T00:00:00Z', 'r2c11-review'
);
insert into public.consumer_subscriptions(
  client_id, enrollment_id, provider, customer_ref, setup_intent_ref,
  payment_method_ref, price_ref, price_cents, status, idempotency_key
) values (
  '28400000-0000-4000-8000-000000000002',
  '28400000-0000-4000-8000-000000000003',
  'mock', 'cus_284', 'seti_284', 'pm_284', 'price_284', 4900,
  'authorized', 'enroll:284:subscription'
);

select lives_ok(
  $$select public.enrollment_review_sub(
    '28400000-0000-4000-8000-000000000003', null, 'sub_284',
    0, 'usd', 'active', 'provider_response_mismatch'
  )$$,
  'a zero-amount provider result enters durable review'
);
select is(
  (select status from public.consumer_subscriptions where enrollment_id = '28400000-0000-4000-8000-000000000003'),
  'review_required',
  'review status is durable'
);
select results_eq(
  $$select subscription_ref, provider_amount_cents, provider_currency, provider_status, review_code
    from public.consumer_subscriptions
    where enrollment_id = '28400000-0000-4000-8000-000000000003'$$,
  $$values ('sub_284'::text, 0, 'usd'::text, 'active'::text, 'provider_response_mismatch'::text)$$,
  'the exact provider outcome is retained with its provider reference'
);
select lives_ok(
  $$select public.enrollment_review_sub(
    '28400000-0000-4000-8000-000000000003', null, 'sub_284',
    0, 'usd', 'active', 'provider_response_mismatch'
  )$$,
  'review persistence is idempotent for the same provider result'
);
select throws_ok(
  $$select public.enrollment_review_sub(
    '28400000-0000-4000-8000-000000000003', null, 'sub_other',
    4900, 'usd', 'active', 'provider_response_mismatch'
  )$$,
  '23514',
  'ENROLLMENT_SUBSCRIPTION_REVIEW_BLOCKED',
  'a second provider reference cannot replace the reviewed result'
);
-- 2026-08-17 R3C-03: only an exact settled-reference replay is idempotent;
-- a different provider reference must be refused while preserving the first.
select throws_ok(
  $$select public.enrollment_settle_sub(
    '28400000-0000-4000-8000-000000000003', null, 'sub_other'
  )$$,
  '23514',
  'ENROLLMENT_SUBSCRIPTION_SETTLEMENT_BLOCKED',
  'a later settlement replay cannot overwrite a reviewed provider reference'
);
select is(
  (select subscription_ref from public.consumer_subscriptions where enrollment_id = '28400000-0000-4000-8000-000000000003'),
  'sub_284',
  'review keeps the first provider reference after replay'
);
select * from finish();
rollback;
