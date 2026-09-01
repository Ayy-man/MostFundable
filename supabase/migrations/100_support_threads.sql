-- 100_support_threads.sql — Phase 13 (S2.5), migration range 100-109.
--
-- Support threads, messages, and held drafts.
--
-- THERE IS NO ROLLBACK COMMAND HERE. The fix for a problem in this file is a
-- NEW forward migration in the 100-109 range. Never edit this file once it is
-- merged, and never `supabase db reset` from a lane worktree — one shared local
-- stack serves every lane and a reset destroys every other lane's state.
--
-- DEC-D10 says the no-auto-reply property is architectural, not configurational.
-- This file is where that claim is cashed. Four independent structural facts
-- carry it, and none of them is a setting anybody can flip at runtime:
--
--   (a) public.support_author_kind is a closed three-value enum. There is no
--       value an automated author could take, so such a row is not expressible.
--   (b) public.support_messages.author_profile_id is not null and references
--       public.profiles(id), and private.enforce_support_message_author()
--       rejects any row whose author_kind disagrees with that profile's role.
--       Every message therefore names a person, and the kind cannot lie.
--   (c) `authenticated` holds no insert, update, or delete grant on any of the
--       three tables. The absence is the mechanism, not an oversight: it leaves
--       exactly one writer, the security definer RPC added in migration 101.
--   (d) held_drafts_send_requires_human and its mirror held_drafts_unsent_is_clean
--       make a `sent` draft impossible without a named person, and make faking
--       un-sentness afterwards impossible too. The mirror is load-bearing: a
--       CHECK is satisfied when its expression is NULL, so a one-sided
--       constraint can be walked around by leaving the columns null.
--
-- Wholly additive. No Phase 1, 3, or 5 object is added to, dropped, renamed, or
-- re-granted here; public.audit_log is a target for later inserts only.


-- ---------------------------------------------------------------------------
-- Part 1: the closed vocabularies.
-- ---------------------------------------------------------------------------

create type public.support_thread_kind as enum (
  'team_chat',
  'platform_support'
);

create type public.support_thread_status as enum (
  'open',
  'pending',
  'resolved'
);

-- Exactly three values, all of them people. Widening this type is Phase 16's
-- explicit, reviewable act: `alter type public.support_author_kind add value
-- '...'` is one greppable line in one migration that a reviewer must approve,
-- which is the opposite of a settings row that changes silently in production.
-- Nothing in Phase 13 anticipates that change or leaves a hook for it.
create type public.support_author_kind as enum (
  'consumer',
  'operator',
  'admin'
);

create type public.support_message_origin as enum (
  'human',
  'ai_assisted'
);

create type public.held_draft_status as enum (
  'draft',
  'approved',
  'sent',
  'discarded'
);


-- ---------------------------------------------------------------------------
-- Part 2: threads.
-- ---------------------------------------------------------------------------
--
-- support_threads_client_org_fk lands on Phase 1's existing clients_id_org_unique
-- and makes cross-tenant threading unrepresentable: a wrong select policy still
-- cannot attach an operator's thread to another operator's client, because the
-- row will not insert. MATCH SIMPLE leaves the pair unchecked when client_id is
-- null, which is exactly the platform_support shape.

create table public.support_threads (
  id uuid primary key default extensions.gen_random_uuid(),
  kind public.support_thread_kind not null,
  org_id uuid not null references public.orgs(id),
  client_id uuid,
  status public.support_thread_status not null default 'open',
  subject text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  constraint support_threads_subject_length check (length(btrim(subject)) between 1 and 160),
  constraint support_threads_kind_scope check (
    (kind = 'team_chat' and client_id is not null)
    or (kind = 'platform_support' and client_id is null)
  ),
  constraint support_threads_id_org_unique unique (id, org_id),
  constraint support_threads_client_org_fk
    foreign key (client_id, org_id)
    references public.clients(id, org_id)
);

-- The consumer surface has exactly one Team Chat per client. A second one is a
-- reconciliation problem rather than a feature, so make it unrepresentable.
create unique index support_threads_one_team_chat_per_client
  on public.support_threads(client_id)
  where kind = 'team_chat';

create index support_threads_org_activity_idx
  on public.support_threads(org_id, last_activity_at desc);
create index support_threads_client_activity_idx
  on public.support_threads(client_id, last_activity_at desc);
create index support_threads_kind_status_idx
  on public.support_threads(kind, status);


-- ---------------------------------------------------------------------------
-- Part 3: held drafts.
-- ---------------------------------------------------------------------------
--
-- Created before support_messages because the message's origin_draft_id points
-- here; the reverse pointer is added by a trailing alter table once both exist.
--
-- held_drafts is the persistence and the audit record at once (SUPP-02, #192):
-- the body, the confidence, the threshold that applied at generation time, the
-- supervisor verdict, the guardrail codes, the driver, model, prompt key and
-- version, and the decision columns all live on the row. There is no separate
-- review queue, and the partial unique index below makes one unrepresentable.

create table public.held_drafts (
  id uuid primary key default extensions.gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  body text not null,
  confidence numeric(4, 3) not null,
  confidence_threshold numeric(4, 3) not null,
  supervisor_approved boolean not null,
  guardrail_flags text[] not null default '{}'::text[],
  status public.held_draft_status not null default 'draft',
  driver text not null,
  model text not null,
  prompt_key text not null,
  prompt_version integer not null,
  created_at timestamptz not null default now(),
  sent_by uuid references public.profiles(id),
  sent_at timestamptz,
  sent_message_id uuid,
  discarded_by uuid references public.profiles(id),
  discarded_at timestamptz,
  constraint held_drafts_body_length check (length(btrim(body)) between 1 and 4000),
  constraint held_drafts_confidence_range check (confidence between 0 and 1),
  constraint held_drafts_threshold_range check (confidence_threshold between 0 and 1),
  -- A CHECK may not contain a subquery, so the per-element shape is asserted
  -- over the joined array rather than over unnest(). That is the whole reason
  -- this constraint looks the way it does.
  constraint held_drafts_flag_shape check (
    cardinality(guardrail_flags) = 0
    or array_to_string(guardrail_flags, ',') ~ '^[A-Z][A-Z0-9_]{1,63}(,[A-Z][A-Z0-9_]{1,63})*$'
  ),
  constraint held_drafts_flag_count check (cardinality(guardrail_flags) <= 32),
  constraint held_drafts_driver_check check (driver in ('mock', 'openrouter')),
  constraint held_drafts_model_length check (length(model) between 1 and 128),
  constraint held_drafts_prompt_key_check check (prompt_key = 'support-draft'),
  constraint held_drafts_prompt_version_check check (prompt_version >= 1),
  -- SUPP-04, re-derived in SQL independently of runDraftEngine. A bug in the
  -- engine therefore produces a draft that nobody can send, rather than one
  -- that anybody can.
  constraint held_drafts_gates_for_approval check (
    status not in ('approved', 'sent')
    or (
      supervisor_approved
      and cardinality(guardrail_flags) = 0
      and confidence >= confidence_threshold
    )
  ),
  constraint held_drafts_send_requires_human check (
    status <> 'sent'
    or (sent_by is not null and sent_at is not null and sent_message_id is not null)
  ),
  constraint held_drafts_unsent_is_clean check (
    status = 'sent'
    or (sent_by is null and sent_at is null and sent_message_id is null)
  ),
  constraint held_drafts_discard_requires_actor check (
    status <> 'discarded'
    or (discarded_by is not null and discarded_at is not null)
  ),
  constraint held_drafts_undiscarded_is_clean check (
    status = 'discarded'
    or (discarded_by is null and discarded_at is null)
  )
);

-- At most one open draft per thread, so a cross-thread queue of held replies is
-- not a shape the data can take (SUPP-02, #192).
create unique index held_drafts_one_open_per_thread
  on public.held_drafts(thread_id)
  where status in ('draft', 'approved');

create index held_drafts_thread_created_idx
  on public.held_drafts(thread_id, created_at desc);


-- ---------------------------------------------------------------------------
-- Part 4: messages.
-- ---------------------------------------------------------------------------

create table public.support_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  author_profile_id uuid not null references public.profiles(id),
  author_kind public.support_author_kind not null,
  origin public.support_message_origin not null default 'human',
  origin_draft_id uuid,
  body text not null,
  sent_at timestamptz not null default now(),
  constraint support_messages_body_length check (length(btrim(body)) between 1 and 4000),
  constraint support_messages_origin_pairing check (
    (origin = 'human' and origin_draft_id is null)
    or (origin = 'ai_assisted' and origin_draft_id is not null)
  ),
  -- UNIQUE is NULLS DISTINCT by default, so unlimited human messages coexist
  -- with a null origin_draft_id while no two messages can claim one draft.
  constraint support_messages_origin_draft_unique unique (origin_draft_id),
  constraint support_messages_origin_draft_fk
    foreign key (origin_draft_id)
    references public.held_drafts(id)
    on delete cascade
);

create index support_messages_thread_sent_idx
  on public.support_messages(thread_id, sent_at);

-- The reverse pointer, added once both tables exist. Both halves of the
-- draft/message pair cascade: deleting a thread cascades into both tables at
-- once, and without the cascade on this side the delete order can leave a
-- draft referencing an already-deleted message. Drafts are never hard-deleted
-- in normal operation — discard is a status change — so this only ever fires as
-- part of a thread delete in which both rows are going away regardless.
alter table public.held_drafts
  add constraint held_drafts_sent_message_fk
  foreign key (sent_message_id)
  references public.support_messages(id)
  on delete cascade;


-- ---------------------------------------------------------------------------
-- Part 5: the two integrity triggers.
-- ---------------------------------------------------------------------------
--
-- author_kind cannot lie about who wrote the message. There is no service
-- account with a profile row to borrow: the mapping below is total over the
-- three kinds and the `affiliate` application role matches nothing.

create function private.enforce_support_message_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  select profile.role
  into v_role
  from public.profiles as profile
  where profile.id = new.author_profile_id;

  if v_role is null then
    raise exception using errcode = 'P0001', message = 'SUPPORT_AUTHOR_ROLE_MISMATCH';
  end if;

  if not (
    (v_role = 'consumer' and new.author_kind = 'consumer')
    or (v_role = 'operator_member' and new.author_kind = 'operator')
    or (v_role = 'platform_admin' and new.author_kind = 'admin')
  ) then
    raise exception using errcode = 'P0001', message = 'SUPPORT_AUTHOR_ROLE_MISMATCH';
  end if;

  return new;
end;
$$;

create trigger support_messages_enforce_author
before insert on public.support_messages
for each row execute function private.enforce_support_message_author();

-- The one invariant a CHECK cannot express, because it spans two rows: the
-- message a draft points at must be the message that points back, in the same
-- thread. This closes the loop that support_send_message opens in migration 101.

create function private.enforce_held_draft_pairing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.support_messages as message
    where message.id = new.sent_message_id
      and message.origin_draft_id = new.id
      and message.thread_id = new.thread_id
  ) then
    raise exception using errcode = 'P0001', message = 'SUPPORT_DRAFT_PAIRING_INVALID';
  end if;

  return new;
end;
$$;

create trigger held_drafts_enforce_pairing
after update on public.held_drafts
for each row
when (new.sent_message_id is not null)
execute function private.enforce_held_draft_pairing();

revoke all on function private.enforce_support_message_author() from public;
revoke all on function private.enforce_held_draft_pairing() from public;


-- ---------------------------------------------------------------------------
-- Part 6: the access predicate.
-- ---------------------------------------------------------------------------
--
-- Two authorization regimes, on purpose. service_role bypasses RLS, so the
-- admin client reaching an RPC carries no authorization at all — which is why
-- every RPC in migration 101 takes p_actor_profile_id explicitly and re-checks
-- it through the two-argument predicate. Reads are the opposite: they go
-- through the authenticated client under RLS, and the one-argument wrapper
-- resolves the caller from Phase 1's private.auth_profile_id().
--
-- For team_chat the rules are Phase 1's private.can_access_client rules,
-- parameterized by profile rather than by auth.uid(); they are re-expressed
-- rather than delegated because can_access_client reads auth.uid() directly and
-- the RPC path has no session.

create function private.profile_can_access_support_thread(
  p_profile_id uuid,
  p_thread_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when thread.kind = 'platform_support' then
          case
            when profile.role = 'platform_admin' then true
            when profile.role = 'operator_member' then profile.org_id = thread.org_id
            else false
          end
        else
          case
            when profile.role = 'platform_admin' then true
            when profile.role = 'consumer' then client.consumer_profile_id = profile.id
            when profile.role = 'operator_member' and client.org_id = profile.org_id then
              organization.team_sees_all_clients
              or client.assigned_to = profile.id
              or profile.org_role in ('owner', 'admin', 'commando')
              or (
                profile.org_role = 'manager'
                and exists (
                  select 1
                  from public.profiles as managed_profile
                  where managed_profile.id = client.assigned_to
                    and managed_profile.org_id = profile.org_id
                    and managed_profile.role = 'operator_member'
                    and managed_profile.id = any(profile.manages)
                )
              )
            else false
          end
      end
      from public.support_threads as thread
      join public.profiles as profile on profile.id = p_profile_id
      left join public.clients as client on client.id = thread.client_id
      left join public.orgs as organization on organization.id = thread.org_id
      where thread.id = p_thread_id
    ),
    false
  )
$$;

-- Wrapping the auth helper in (select …) is Supabase's documented guidance: the
-- planner then evaluates it once per statement instead of once per row.
create function private.can_access_support_thread(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.profile_can_access_support_thread(
    (select private.auth_profile_id()),
    p_thread_id
  )
$$;

revoke all on function private.profile_can_access_support_thread(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.can_access_support_thread(uuid)
  from public, anon, authenticated;
grant execute on function private.profile_can_access_support_thread(uuid, uuid) to service_role;
grant execute on function private.can_access_support_thread(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Part 7: the grant set, and the three read policies.
-- ---------------------------------------------------------------------------
--
-- The absence below is the point. `authenticated` gets select and nothing else
-- on all three tables, so there is no insert path from a browser session, from
-- a leaked anon key, or from a lane that forgets to call the repository. There
-- are no insert, update, or delete policies because there is nothing for them
-- to police — the grant does not exist.

alter table public.support_threads enable row level security;
alter table public.support_threads force row level security;
alter table public.held_drafts enable row level security;
alter table public.held_drafts force row level security;
alter table public.support_messages enable row level security;
alter table public.support_messages force row level security;

revoke all on table public.support_threads from public, anon, authenticated;
revoke all on table public.held_drafts from public, anon, authenticated;
revoke all on table public.support_messages from public, anon, authenticated;

grant select on table public.support_threads to authenticated;
grant select on table public.held_drafts to authenticated;
grant select on table public.support_messages to authenticated;

grant all on table public.support_threads to service_role;
grant all on table public.held_drafts to service_role;
grant all on table public.support_messages to service_role;

create policy support_threads_select
on public.support_threads
for select
to authenticated
using (private.can_access_support_thread(id));

create policy support_messages_select
on public.support_messages
for select
to authenticated
using (private.can_access_support_thread(thread_id));

-- The staff conjunct is why a consumer cannot read a draft even through a
-- hand-rolled query: drafts are staff-side by policy, not by UI omission.
create policy held_drafts_select
on public.held_drafts
for select
to authenticated
using (
  private.can_access_support_thread(thread_id)
  and (select private.auth_app_role()) in ('operator_member', 'platform_admin')
);
