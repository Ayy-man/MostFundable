-- 384_support_realtime_publication.test.sql — chat rebuild, lane 1a.
--
-- Watched failing against the pre-migration tree: with 383 as the head of the
-- ledger the publication held `public.clients` alone, and assertions 1 and 2
-- below reported `have: 0 / want: 1` for both support tables.
--
-- The four derived assertions are the ones worth having. They do not name the
-- tables this migration published; they read the publication back from
-- `pg_publication_tables` and require every member to carry the protections
-- that make publishing safe. A later lane that publishes an unprotected table —
-- or that drops a grant or an RLS flag out from under a published one — fails
-- here without anybody remembering to add a case for it.
--
-- F-37 added the allowlist in section 1b, and the reason it is an allowlist
-- rather than a longer list of tables that must stay unpublished is written
-- there. Watched failing by adding `public.assistant_turns` to the publication
-- inside this file's own transaction: `not ok 4 … have: public.assistant_turns
-- / want:` and nothing else red — 1 of 9.
--
-- That count is the finding, and it is worth more than the fix. The three
-- derived assertions below did not notice, and they were right not to:
-- `assistant_turns` forces RLS, carries a select policy and keeps a default
-- replica identity, so it satisfies every property that makes publishing safe.
-- Those assertions ask whether a published table is *protected*. They cannot
-- ask whether it should be *broadcast*, because that is a product decision and
-- not a fact in the catalog. A table can pass every safety check in this file
-- and still be machine text nobody has approved arriving on a subscriber's
-- screen, which is the rail this one holds.

begin;

set local search_path = public, extensions;

select plan(9);


-- ---------------------------------------------------------------------------
-- 1. Membership, in both directions.
-- ---------------------------------------------------------------------------

select is(
  (
    select count(*)::integer
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_threads'
  ),
  1,
  'support_threads is published, so a thread status change can reach an open pane'
);

select is(
  (
    select count(*)::integer
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_messages'
  ),
  1,
  'support_messages is published, so a reply arrives without a reload'
);

select is(
  (
    select count(*)::integer
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'held_drafts'
  ),
  0,
  'held_drafts stays unpublished: un-approved machine text is not put on a channel'
);


-- ---------------------------------------------------------------------------
-- 1b. Nothing is on a channel that was not put there on purpose.
-- ---------------------------------------------------------------------------
--
-- The assertion above names one table where the property is a class. Held
-- drafts are not the only rows in this schema holding machine text nobody has
-- approved — `assistant_conversations`, `assistant_turns` and `email_outbox`
-- are the others as this is written, and the next lane's is not written yet.
-- Streaming assistant answers over a channel instead of the NDJSON stage stream
-- is a normal thing to reach for, and nothing here would have caught it.
--
-- So this inverts the shape rather than lengthening the list. "Holds
-- un-approved machine text" is not a property the catalog knows and no
-- derivation can compute it; "was deliberately published" is a decision, and a
-- decision is the one thing a literal list should hold. The four names below
-- are that decision, and this is the one place in this suite where writing
-- names down is right rather than transcription — deriving the allowlist from
-- the migrations would make it pass the instant a later lane published
-- anything, which is precisely the review moment it exists to force.
--
-- It reports the offending members by name instead of a count, because the
-- first question on a failure is which table somebody put on a channel.

select is(
  (
    select coalesce(
      string_agg(
        published.schemaname || '.' || published.tablename,
        ', '
        order by published.schemaname, published.tablename
      ),
      ''
    )
    from pg_publication_tables as published
    where published.pubname = 'supabase_realtime'
      and (published.schemaname::text, published.tablename::text) not in (
        ('public', 'clients'),
        ('public', 'consent_revocations'),
        ('public', 'support_threads'),
        ('public', 'support_messages')
      )
  ),
  '',
  'nothing beyond the four tables put there on purpose is published: a held draft, an assistant turn or a queued email on a channel is the no-auto-send rail defeated below the interface'
);


-- ---------------------------------------------------------------------------
-- 2. What makes publishing safe, derived from the publication itself.
-- ---------------------------------------------------------------------------
--
-- Realtime re-checks each row as the subscriber's role, so a published table
-- whose RLS is off or unforced would broadcast every row to every subscriber.
-- These read the membership list rather than a list of names kept here, which
-- is the only version of this check that stays true after the next lane.

select is(
  (
    select count(*)::integer
    from pg_publication_tables as published
    join pg_namespace as namespace on namespace.nspname = published.schemaname
    join pg_class as relation
      on relation.relname = published.tablename
     and relation.relnamespace = namespace.oid
    where published.pubname = 'supabase_realtime'
      and not (relation.relrowsecurity and relation.relforcerowsecurity)
  ),
  0,
  'every published table enables and forces row level security'
);

select is(
  (
    select count(*)::integer
    from pg_publication_tables as published
    join pg_namespace as namespace on namespace.nspname = published.schemaname
    join pg_class as relation
      on relation.relname = published.tablename
     and relation.relnamespace = namespace.oid
    where published.pubname = 'supabase_realtime'
      and not exists (
        select 1
        from pg_policies
        where pg_policies.schemaname = published.schemaname
          and pg_policies.tablename = published.tablename
          and pg_policies.cmd = 'SELECT'
      )
  ),
  0,
  'every published table carries a select policy, which is what filters a subscription'
);

select is(
  (
    select count(*)::integer
    from pg_publication_tables as published
    join pg_namespace as namespace on namespace.nspname = published.schemaname
    join pg_class as relation
      on relation.relname = published.tablename
     and relation.relnamespace = namespace.oid
    where published.pubname = 'supabase_realtime'
      and relation.relreplident <> 'd'
  ),
  0,
  'no published table uses a full replica identity, so no old row image rides on a delete'
);


-- ---------------------------------------------------------------------------
-- 3. The predicate a subscriber is filtered by is still the shared one.
-- ---------------------------------------------------------------------------
--
-- Publishing support_messages is only safe while its select policy delegates to
-- private.can_access_support_thread. Read the policy expression back rather than
-- trusting the migration comment.

select matches(
  (
    select qual
    from pg_policies
    where schemaname = 'public'
      and tablename = 'support_messages'
      and policyname = 'support_messages_select'
  ),
  'can_access_support_thread',
  'a message subscription is filtered by the same thread predicate a page read is'
);

select matches(
  (
    select qual
    from pg_policies
    where schemaname = 'public'
      and tablename = 'support_threads'
      and policyname = 'support_threads_select'
  ),
  'can_access_support_thread',
  'a thread subscription is filtered by the same thread predicate a page read is'
);

select * from finish();

rollback;
