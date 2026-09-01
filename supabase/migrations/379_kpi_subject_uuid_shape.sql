-- 379: kpi_rollups accepts every uuid Postgres itself accepts.
--
-- The G-HOST-22 walk left the production tick retrying six kpi.rollup jobs to
-- terminal failure (handler_threw). The chain: the cadence provider reads real
-- org and profile ids and builds subjects from them; the seeded demo ids
-- (a0000000-…, a1000000-…) are valid Postgres uuids but not RFC-4122 (version
-- nibble 0); and kpi_rollups_subject_shape demanded RFC-4122's [1-5] version
-- and [89ab] variant nibbles, so every org- and member-scope rollup over
-- seeded data violated the check and the job died. The app layer had already
-- met this exact mismatch and loosened its own guard (register.ts documents
-- "the seeded demo orgs (a0000000-…) are not RFC-4122"), and
-- admin_compute_kpi_metrics parses subjects with the loose pattern — the
-- table constraint was the one layer never updated. pgTAP missed it because
-- its fixture ids are RFC-conformant; the regression test that lands with
-- this migration derives its subject from the seed instead.
--
-- The strictness bought nothing: subject ids are built from uuid-typed
-- columns, so "a hex uuid shape" is exactly the invariant the table can
-- honestly demand.

alter table public.kpi_rollups drop constraint kpi_rollups_subject_shape;
alter table public.kpi_rollups add constraint kpi_rollups_subject_shape check (
  (scope = 'platform' and subject_id = 'platform')
  or (scope = 'org' and subject_id ~ '^org:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  or (scope = 'member' and subject_id ~ '^member:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
