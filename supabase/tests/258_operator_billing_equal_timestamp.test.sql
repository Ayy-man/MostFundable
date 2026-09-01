begin;
create extension if not exists pgtap with schema extensions;

-- 2026-08-17 R1C-04: equal-second conflicts converge through provider state.
select plan(8);

insert into public.orgs(id,name,slug,membership) values
 ('25800000-0000-4000-8000-000000000101','R1C04 A','r1c04-a','current'),
 ('25800000-0000-4000-8000-000000000102','R1C04 B','r1c04-b','current');
insert into public.operator_subscriptions(org_id,provider,customer_ref,subscription_ref,base_price_ref,seat_price_ref,status) values
 ('25800000-0000-4000-8000-000000000101','mock','cus_258_a','sub_258_a','base','seat','active'),
 ('25800000-0000-4000-8000-000000000102','mock','cus_258_b','sub_258_b','base','seat','active');

select is((public.operator_billing_apply_event_convergent('evt_258_a_fail','invoice.payment_failed','25800000-0000-4000-8000-000000000101','sub_258_a',null,'2026-08-18',1,null,'2026-08-17T12:00:00Z','mock')->>'reason_code'),'applied','first event applies');
select is((select membership::text from public.orgs where id='25800000-0000-4000-8000-000000000101'),'past_due','failure moves the first organization');
select is((public.operator_billing_apply_event_convergent('evt_258_a_paid','invoice.paid','25800000-0000-4000-8000-000000000101','sub_258_a',null,null,null,null,'2026-08-17T12:00:00Z','mock')->>'reason_code'),'equal_timestamp','equal conflict pauses for lookup');
select is((public.operator_billing_apply_event_convergent('evt_258_a_paid','provider.snapshot','25800000-0000-4000-8000-000000000101','sub_258_a','active',null,null,null,'2026-08-17T12:00:00Z','mock')->>'reason_code'),'applied','active snapshot applies under the lock');
select is((select membership::text from public.orgs where id='25800000-0000-4000-8000-000000000101'),'current','failure then payment converges to provider state');

select public.operator_billing_apply_event_convergent('evt_258_b_paid','invoice.paid','25800000-0000-4000-8000-000000000102','sub_258_b',null,null,null,null,'2026-08-17T12:00:00Z','mock');
select is((public.operator_billing_apply_event_convergent('evt_258_b_fail','invoice.payment_failed','25800000-0000-4000-8000-000000000102','sub_258_b',null,'2026-08-18',1,null,'2026-08-17T12:00:00Z','mock')->>'reason_code'),'equal_timestamp','reverse order also pauses');
select public.operator_billing_apply_event_convergent('evt_258_b_fail','provider.snapshot','25800000-0000-4000-8000-000000000102','sub_258_b','active',null,null,null,'2026-08-17T12:00:00Z','mock');
select is((select membership::text from public.orgs where id='25800000-0000-4000-8000-000000000102'),'current','payment then failure converges to the same provider state');
select is((select count(*) from public.operator_billing_events where event_id='evt_258_b_fail'),1::bigint,'only the authoritative application is recorded');

select * from finish();
rollback;
