begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

select has_column('public', 'orgs', 'portal_application_visibility', 'workspace stores its consumer application presentation');
select has_column('public', 'orgs', 'portal_show_funding_progress', 'workspace stores funding progress visibility');
select has_column('public', 'orgs', 'portal_allow_document_uploads', 'workspace stores consumer upload authority');
select has_column('public', 'orgs', 'portal_show_trainings', 'workspace stores consumer training visibility');
select has_column('public', 'orgs', 'notification_digest_frequency', 'workspace stores digest frequency');
select has_check('public', 'orgs', 'workspace preference values are constrained');
select has_trigger('public', 'orgs', 'orgs_audit_settings_change', 'workspace preference updates retain fixed-action audit attribution');

insert into public.orgs (id, name, slug)
values ('00000000-0000-4000-8000-000000004101', 'Portal preferences org', 'portal-preferences-org');

select is(
  (select portal_application_visibility from public.orgs where id = '00000000-0000-4000-8000-000000004101'),
  'details'::text,
  'new workspaces expose application details by default'
);
select ok(
  (select portal_show_funding_progress and portal_allow_document_uploads and portal_show_trainings
   from public.orgs where id = '00000000-0000-4000-8000-000000004101'),
  'existing consumer portal capabilities remain enabled by default'
);
select throws_ok(
  $$update public.orgs set portal_application_visibility = 'everything' where id = '00000000-0000-4000-8000-000000004101'$$,
  '23514',
  null,
  'unknown application visibility is rejected'
);
select throws_ok(
  $$update public.orgs set notification_digest_frequency = 'sometimes' where id = '00000000-0000-4000-8000-000000004101'$$,
  '23514',
  null,
  'unknown digest frequency is rejected'
);

select * from finish();
rollback;
