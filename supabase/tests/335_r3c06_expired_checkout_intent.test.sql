begin;
set local search_path = public, extensions;

-- 2026-08-17 R3C-06: verified expiry terminally closes only the matching intent.
select plan(5);

insert into public.orgs(id,name,slug) values ('33500000-0000-4000-8000-000000000001','Expired Checkout','r3c06-expired-checkout');
insert into public.operator_subscription_creation_intents(operation_id,org_id,creation_path,status,provider_ref,completed_at)
values ('33500000-0000-4000-8000-000000000002','33500000-0000-4000-8000-000000000001','checkout','created','cs_335',pg_catalog.now());

select is((public.operator_billing_fail_expired_checkout_intent('33500000-0000-4000-8000-000000000001','33500000-0000-4000-8000-000000000002','cs_wrong')->>'reason_code'),'state_changed','mismatched provider reference cannot close the intent');
select is((public.operator_billing_fail_expired_checkout_intent('33500000-0000-4000-8000-000000000001','33500000-0000-4000-8000-000000000002','cs_335')->>'reason_code'),'expired','matching expired Checkout closes the intent');
select results_eq(
 $$select status,provider_ref from public.operator_subscription_creation_intents where operation_id='33500000-0000-4000-8000-000000000002'$$,
 $$values ('failed'::text,null::text)$$,
 'terminal closure clears the live provider reference');
select is((public.operator_billing_fail_expired_checkout_intent('33500000-0000-4000-8000-000000000001','33500000-0000-4000-8000-000000000002','cs_335')->>'reason_code'),'state_changed','terminal closure replays closed');
select ok((public.operator_billing_claim_subscription_intent('33500000-0000-4000-8000-000000000001','direct')->>'claimed')::boolean,'direct path claims a fresh operation after terminal closure');

select * from finish();
rollback;
