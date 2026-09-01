-- 394_consumer_notification_reads.sql — consumer notification read state.
--
-- THERE IS NO ROLLBACK COMMAND HERE. The fix for a problem in this file is a
-- NEW forward migration. Never edit this file once it is merged, and never
-- `supabase db reset` from a lane worktree.
--
-- The feed is derived from source rows that already carry their own consumer
-- RLS policies, so this table stores no notification payload and names no
-- client. It stores only the signed-in profile, the stable event key and the
-- instant that profile read it. The security argument is correspondingly
-- small and entirely in the database:
--
--   (a) both policies resolve the caller through private.auth_profile_id(),
--       which in turn resolves public.profiles from auth.uid(); a caller can
--       neither select nor insert a row for a different profile;
--   (b) authenticated receives SELECT and INSERT only, with no UPDATE or
--       DELETE grant and no policy for either operation, so a read receipt can
--       be appended but cannot be rewritten or erased through a user session;
--   (c) the primary key makes one receipt per (profile, event) structural, and
--       the event-key checks bound both storage and the vocabulary a caller can
--       place in the ledger;
--   (d) service_role keeps its ordinary maintenance access and bypasses RLS,
--       while TRUNCATE remains unavailable under the project-wide boundary.

create table public.consumer_notification_reads (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_key text not null,
  read_at timestamptz not null default now(),
  constraint consumer_notification_reads_pkey primary key (profile_id, event_key),
  constraint consumer_notification_reads_event_key_length
    check (char_length(event_key) between 1 and 120),
  constraint consumer_notification_reads_event_key_shape
    check (event_key ~ '^[a-z_]+:[0-9a-f-]{36}(:[a-z0-9_]+)?$')
);

create index consumer_notification_reads_profile_read_at_idx
  on public.consumer_notification_reads(profile_id, read_at desc);

alter table public.consumer_notification_reads enable row level security;
alter table public.consumer_notification_reads force row level security;

revoke all on table public.consumer_notification_reads
  from public, anon, authenticated;
grant select, insert on table public.consumer_notification_reads to authenticated;
grant all on table public.consumer_notification_reads to service_role;

-- Migration 374 removes this privilege from every application-reachable role.
-- A table created later has to preserve that catalog-wide invariant itself.
revoke truncate on table public.consumer_notification_reads
  from public, anon, authenticated, service_role;

create policy consumer_notification_reads_select_own
on public.consumer_notification_reads
for select
to authenticated
using (profile_id = (select private.auth_profile_id()));

create policy consumer_notification_reads_insert_own
on public.consumer_notification_reads
for insert
to authenticated
with check (profile_id = (select private.auth_profile_id()));

