begin;
create extension if not exists pgtap with schema extensions;

-- 2026-08-17 R1C-10: paid refresh reserves, commits, releases, and reuses cap capacity.
select plan(12);

insert into auth.users(id,email) values ('25400000-0000-4000-8000-000000000001','admin@r1c10.test');
insert into public.orgs(id,name,slug) values ('25400000-0000-4000-8000-000000000101','R1C10 Org','r1c10-org');
insert into public.profiles(id,role,full_name,email) values
  ('25400000-0000-4000-8000-000000000001','platform_admin','R1C10 Admin','admin@r1c10.test')
on conflict(id) do update set role=excluded.role;
insert into public.clients(id,org_id,display_name) values
  ('25400000-0000-4000-8000-000000000201','25400000-0000-4000-8000-000000000101','R1C10 Client');
-- 2026-08-17 R2A-03 carry: reservations now lock their durable request first.
insert into public.paid_refresh_requests(
  id, actor_profile_id, client_id, org_id, idempotency_key,
  amount_cents, currency, driver
) values
  ('25400000-0000-4000-8000-000000000301','25400000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000201','25400000-0000-4000-8000-000000000101','r1c10-301',1900,'usd','mock'),
  ('25400000-0000-4000-8000-000000000302','25400000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000201','25400000-0000-4000-8000-000000000101','r1c10-302',1900,'usd','mock'),
  ('25400000-0000-4000-8000-000000000303','25400000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000201','25400000-0000-4000-8000-000000000101','r1c10-303',1900,'usd','mock'),
  ('25400000-0000-4000-8000-000000000304','25400000-0000-4000-8000-000000000001','25400000-0000-4000-8000-000000000201','25400000-0000-4000-8000-000000000101','r1c10-304',1900,'usd','mock');
select public.set_pull_cap('25400000-0000-4000-8000-000000000201',null,1,3600,'25400000-0000-4000-8000-000000000001');

select is((select allowed from public.reserve_paid_refresh_pull('25400000-0000-4000-8000-000000000201','25400000-0000-4000-8000-000000000301',60)),true,'first request reserves the last slot');
select is((select allowed from public.reserve_paid_refresh_pull('25400000-0000-4000-8000-000000000201','25400000-0000-4000-8000-000000000302',60)),false,'a concurrent request cannot reserve the same slot');
select ok((select reservation_state='reserved' and reservation_expires_at is not null from public.pull_cap_attempts where source_id='25400000-0000-4000-8000-000000000301'),'reservation carries an expiry');
select ok(public.release_paid_refresh_pull('25400000-0000-4000-8000-000000000301'),'decline releases reserved capacity');
select is((select allowed from public.reserve_paid_refresh_pull('25400000-0000-4000-8000-000000000201','25400000-0000-4000-8000-000000000302',60)),true,'a declined request no longer consumes the cap');
select is((select allowed from public.reserve_paid_refresh_pull('25400000-0000-4000-8000-000000000201','25400000-0000-4000-8000-000000000302',60)),true,'same-request replay reuses its reservation');
select ok(public.commit_paid_refresh_pull('25400000-0000-4000-8000-000000000302'),'durable enqueue commits the slot');
select ok((select reservation_state='committed' and reservation_expires_at is null from public.pull_cap_attempts where source_id='25400000-0000-4000-8000-000000000302'),'commit is durable and has no lease');
select ok(public.commit_paid_refresh_pull('25400000-0000-4000-8000-000000000302'),'commit replay is idempotent');

delete from public.pull_cap_attempts where client_id='25400000-0000-4000-8000-000000000201';
select * from public.reserve_paid_refresh_pull('25400000-0000-4000-8000-000000000201','25400000-0000-4000-8000-000000000303',60);
update public.pull_cap_attempts set reservation_expires_at=clock_timestamp()-interval '1 second'
where source_id='25400000-0000-4000-8000-000000000303';
select is((select allowed from public.reserve_paid_refresh_pull('25400000-0000-4000-8000-000000000201','25400000-0000-4000-8000-000000000304',60)),true,'an expired reservation releases capacity');
select is((select count(*) from public.pull_cap_attempts where client_id='25400000-0000-4000-8000-000000000201' and reservation_state='reserved' and reservation_expires_at>clock_timestamp()),1::bigint,'only one live reservation consumes the slot');
select ok(pg_get_functiondef('public.reserve_paid_refresh_pull(uuid,uuid,integer)'::regprocedure) like '%for update%','reservation uses row locking');

select * from finish();
rollback;
