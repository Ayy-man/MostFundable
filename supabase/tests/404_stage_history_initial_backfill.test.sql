begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(1);

select is_empty(
  $$
    select client.id
    from public.clients as client
    where client.status = 'active'
      and client.stage <> 'onboarding'
      and not exists (
        select 1
        from public.stage_history as history
        where history.client_id = client.id
      )
  $$,
  'every active seeded client beyond onboarding has recorded stage history'
);

select * from finish();
rollback;
