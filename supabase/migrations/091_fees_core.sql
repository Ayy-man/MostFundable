-- 091_fees_core.sql
--
-- The fee schema, and on it the mechanism ROADMAP criterion 1 turns on:
-- "package model unreachable without org_flag". That is a claim about *every*
-- writer, and RLS cannot carry it, because `service_role` — a role this
-- application itself holds — bypasses RLS outright, and `force row level
-- security` constrains the table owner while saying nothing about BYPASSRLS.
-- So the gate is a BEFORE trigger. A trigger fires for `authenticated`, for
-- `service_role`, for `postgres` and for a superuser alike, which is what makes
-- the word "unreachable" true rather than aspirational. RLS is the second
-- layer, never the only one (12-CONTEXT D-01).
--
-- The gate raises SQLSTATE PT403 with the message `legal_gate`. PostgREST maps
-- a PTxyz SQLSTATE onto HTTP status xyz, while a plain `raise exception` is
-- P0001 and maps to 400. Criterion 2 quotes "403 legal_gate" literally, so the
-- status is made a property of the database rather than of a route handler's
-- memory: even a direct PostgREST call answers 403 (12-CONTEXT D-02).

create type public.fee_model as enum ('percentage', 'package', 'custom');
create type public.fee_agreement_status as enum ('draft', 'active', 'void');
create type public.fee_payment_method as enum (
  'bank_transfer',
  'card',
  'check',
  'cash',
  'other'
);

-- ---------------------------------------------------------------------------
-- Tables.
-- ---------------------------------------------------------------------------

create table public.fee_agreements (
  id uuid primary key default extensions.gen_random_uuid(),
  -- Unique because BACKEND-SPEC §5 describes one fee row per client, and the
  -- uniqueness is what makes "the client's fee agreement" a well-defined phrase
  -- rather than a query that has to pick a winner.
  client_id uuid not null unique references public.clients(id) on delete cascade,
  org_id uuid not null references public.orgs(id),
  model public.fee_model not null,
  pct numeric(5, 2),
  upfront_cents bigint,
  success_cents bigint,
  trigger_cents bigint,
  custom_total_cents bigint,
  status public.fee_agreement_status not null default 'draft',
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_agreements_source_check check (
    source in ('workspace_default', 'operator_override', 'platform_admin')
  ),
  constraint fee_agreements_pct_range check (
    pct is null or (pct >= 0 and pct <= 100)
  ),
  constraint fee_agreements_percentage_shape check (
    model <> 'percentage' or pct is not null
  ),
  constraint fee_agreements_custom_shape check (
    model <> 'custom'
    or (custom_total_cents is not null and custom_total_cents >= 0)
  ),
  constraint fee_agreements_amounts_nonnegative check (
    (upfront_cents is null or upfront_cents >= 0)
    and (success_cents is null or success_cents >= 0)
    and (trigger_cents is null or trigger_cents >= 0)
    and (custom_total_cents is null or custom_total_cents >= 0)
  )
);

create table public.fee_ledger (
  client_id uuid primary key references public.clients(id) on delete cascade,
  org_id uuid not null references public.orgs(id),
  total_cents bigint not null default 0,
  paid_cents bigint not null default 0,
  -- The percentage basis. FEES-02 computes a percentage fee from approved
  -- outcomes, and outcomes belong to Phase 11 (migrations 080-089), which
  -- ROADMAP says Phase 12 does not depend on. So the basis is a column this
  -- phase owns, written through exactly one seam —
  -- public.fees_set_outcome_basis() in 092, which web/src/lib/fees exposes as
  -- recordApprovedOutcomeBasis() for Phase 11 to call. Until it does, a
  -- percentage agreement totals 0, which is what a percentage of nothing is
  -- rather than a stub (12-CONTEXT D-08, ask-12-1).
  outcome_basis_cents bigint not null default 0,
  -- BACKEND-SPEC §5 words this as "maintained by trigger". A stored generated
  -- column is strictly stronger and is a deliberate deviation, not an oversight:
  -- a trigger can be disabled, dropped or skipped by `alter table … disable
  -- trigger`, whereas a generated column cannot be written to at all, so the
  -- balance cannot drift from total minus paid under any writer (D-07).
  balance_cents bigint generated always as (total_cents - paid_cents) stored,
  updated_at timestamptz not null default now(),
  constraint fee_ledger_totals_nonnegative check (
    total_cents >= 0 and paid_cents >= 0 and outcome_basis_cents >= 0
  )
);

create table public.fee_payments (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  org_id uuid not null references public.orgs(id),
  amount_cents bigint not null,
  received_on date not null,
  method public.fee_payment_method not null,
  reference text,
  note text,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  -- A payment entered in error is REVERSED. The two ordinary English words for
  -- this — the noun for a contested payment and the noun for taking a line off
  -- a ledger — are both banned platform-wide by the compliance gate, which
  -- scans SQL comments and column names as well as user-facing copy
  -- (12-CONTEXT D-09). No synonym is introduced anywhere, including here.
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id),
  constraint fee_payments_amount_positive check (amount_cents > 0),
  constraint fee_payments_note_len check (note is null or length(note) <= 1000),
  constraint fee_payments_reversal_pair check (
    (reversed_at is null) = (reversed_by is null)
  )
);

-- A bank reference entered twice for the same client is a database error rather
-- than a reconciliation problem discovered a month later.
create unique index fee_payments_client_reference_key
on public.fee_payments (client_id, reference)
where reference is not null;

create index fee_payments_client_received_idx
on public.fee_payments (client_id, received_on desc);

create index fee_agreements_org_id_idx on public.fee_agreements (org_id);
create index fee_ledger_org_id_idx on public.fee_ledger (org_id);
create index fee_payments_org_id_idx on public.fee_payments (org_id);
create index fee_payments_recorded_by_idx on public.fee_payments (recorded_by);

create table public.org_fee_defaults (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  model public.fee_model not null,
  pct numeric(5, 2),
  upfront_cents bigint,
  success_cents bigint,
  trigger_cents bigint,
  custom_total_cents bigint,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint org_fee_defaults_pct_range check (
    pct is null or (pct >= 0 and pct <= 100)
  ),
  constraint org_fee_defaults_percentage_shape check (
    model <> 'percentage' or pct is not null
  ),
  constraint org_fee_defaults_custom_shape check (
    model <> 'custom'
    or (custom_total_cents is not null and custom_total_cents >= 0)
  ),
  constraint org_fee_defaults_amounts_nonnegative check (
    (upfront_cents is null or upfront_cents >= 0)
    and (success_cents is null or success_cents >= 0)
    and (trigger_cents is null or trigger_cents >= 0)
    and (custom_total_cents is null or custom_total_cents >= 0)
  )
);

create index org_fee_defaults_updated_by_idx on public.org_fee_defaults (updated_by);

comment on table public.fee_agreements is
  'One fee agreement per client. Package and upfront terms are refused by private.fee_agreement_legal_gate() with SQLSTATE PT403 unless the org carries an approved org_flags.upfront_fee_approved.';
comment on table public.org_fee_defaults is
  'The workspace default a new client inherits. Gated identically to fee_agreements: a default is how the package model would be reached at scale, and Log #106 is literally the request to make it the default.';
comment on column public.fee_ledger.balance_cents is
  'Generated and stored. Deliberately stronger than BACKEND-SPEC §5''s "maintained by trigger": no writer can set it, so it cannot drift from total minus paid.';

-- ---------------------------------------------------------------------------
-- The legal gate.
-- ---------------------------------------------------------------------------

create function private.fee_agreement_legal_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_gated boolean;
  v_approved boolean;
begin
  v_gated := new.model = 'package'
    or coalesce(new.upfront_cents, 0) > 0
    or coalesce(new.trigger_cents, 0) > 0;

  if not v_gated then
    return new;
  end if;

  -- A missing org_flags row and an unreadable one are deliberately the same
  -- answer. Writing the read as a coalesced scalar subquery rather than an
  -- `if exists … else` means the two cases cannot diverge later.
  v_approved := coalesce(
    (
      select flag.upfront_fee_approved
      from public.org_flags as flag
      where flag.org_id = new.org_id
    ),
    false
  );

  if not v_approved then
    -- PT403 and not the default P0001. PostgREST maps PTxyz onto HTTP xyz and
    -- P0001 onto 400, so this is what makes criterion 2's literal "403
    -- legal_gate" a property of the database instead of something a handler has
    -- to remember to translate. The code is chosen, not incidental — do not
    -- "simplify" it back to a bare raise.
    raise exception using
      errcode = 'PT403',
      message = 'legal_gate',
      detail = 'org has no recorded legal sign-off for the package or upfront fee model';
  end if;

  return new;
end;
$$;

-- Left SECURITY INVOKER on purpose, and it must stay that way even when the
-- hosted read looks wrong. The flag read resolves under the writer's own
-- visibility. Locally `postgres` is a superuser and bypasses RLS, so the read
-- returns the true value and the tests exercise the real decision. On hosted
-- Supabase `postgres` is the owner and not a superuser, forced RLS applies, the
-- org_flags_read policy finds neither a platform_admin nor an auth_org_id, the
-- read returns zero rows, and the gate treats that as not approved and raises
-- PT403. Both readings are safe for this phase. Making the function SECURITY
-- DEFINER to "fix" the hosted behaviour would give it the owner's rights and
-- turn it into a fifth path toward the package model, which is the opposite of
-- what D-01 protects (12-CONTEXT D-16, pre-flight KA-12-2).
comment on function private.fee_agreement_legal_gate() is
  'BEFORE INSERT OR UPDATE gate on fee_agreements and org_fee_defaults. Raises PT403 legal_gate unless org_flags.upfront_fee_approved is true. Security invoker by design — see 12-CONTEXT D-16.';

create trigger fee_agreements_legal_gate
before insert or update on public.fee_agreements
for each row execute function private.fee_agreement_legal_gate();

create trigger org_fee_defaults_legal_gate
before insert or update on public.org_fee_defaults
for each row execute function private.fee_agreement_legal_gate();

-- ---------------------------------------------------------------------------
-- Tenant anchoring.
-- ---------------------------------------------------------------------------
--
-- Phase 1 uses the same pattern for audit_log (private.validate_audit_anchors).
-- Without it a fee row could be filed under the wrong tenant and then read by
-- the wrong operator through can_access_client, which is a cross-tenant leak
-- that no policy would catch, because the policy would be doing its job on a
-- row that lies about which org it belongs to.

create function private.validate_fee_org_anchor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.clients as client
    where client.id = new.client_id
      and client.org_id = new.org_id
  ) then
    raise exception 'fee row organization must match the owning client'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger fee_agreements_validate_org_anchor
before insert or update of client_id, org_id on public.fee_agreements
for each row execute function private.validate_fee_org_anchor();

create trigger fee_ledger_validate_org_anchor
before insert or update of client_id, org_id on public.fee_ledger
for each row execute function private.validate_fee_org_anchor();

create trigger fee_payments_validate_org_anchor
before insert or update of client_id, org_id on public.fee_payments
for each row execute function private.validate_fee_org_anchor();

-- ---------------------------------------------------------------------------
-- Ledger arithmetic.
-- ---------------------------------------------------------------------------

create function private.fee_recompute_total(p_client_id uuid, p_basis_cents bigint)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select case agreement.model
        when 'percentage' then
          round(coalesce(agreement.pct, 0) / 100.0 * coalesce(p_basis_cents, 0))::bigint
        when 'custom' then
          coalesce(agreement.custom_total_cents, 0)
        when 'package' then
          coalesce(agreement.upfront_cents, 0)
            + coalesce(agreement.success_cents, 0)
            + coalesce(agreement.trigger_cents, 0)
      end
      from public.fee_agreements as agreement
      where agreement.client_id = p_client_id
        -- A withdrawn agreement owes nothing. Any payment already recorded
        -- against it stays on the ledger and drives the balance negative, which
        -- is the honest reading: the money moved, and the agreement did not.
        and agreement.status <> 'void'
    ),
    0
  )
$$;

create function private.fee_recompute_paid(p_client_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select sum(payment.amount_cents)
      from public.fee_payments as payment
      where payment.client_id = p_client_id
        and payment.reversed_at is null
    ),
    0
  )
$$;

-- The two derived columns a generated column cannot cover, covered the same
-- way. `balance_cents` is safe because no writer can set it; `total_cents` and
-- `paid_cents` depend on other tables, so instead of *checking* what a writer
-- supplied, this BEFORE trigger overwrites it with the value derived from the
-- agreement and the unreversed payments. A hand-written total is therefore not
-- forbidden, it is simply ignored — which needs no privilege check to hold and
-- holds for every role, exactly as D-07 argues for the balance.
create function private.fee_ledger_derive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.total_cents := private.fee_recompute_total(new.client_id, new.outcome_basis_cents);
  new.paid_cents := private.fee_recompute_paid(new.client_id);
  new.updated_at := now();
  return new;
end;
$$;

create trigger fee_ledger_derive_totals
before insert or update on public.fee_ledger
for each row execute function private.fee_ledger_derive();

-- Both recompute triggers only have to touch the ledger row; the BEFORE trigger
-- above does the arithmetic, so there is one implementation of the rule rather
-- than one per calling site.
create function private.fee_touch_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.fee_ledger (client_id, org_id)
  values (new.client_id, new.org_id)
  on conflict (client_id) do update set updated_at = now();

  return null;
end;
$$;

create trigger fee_agreements_recompute_ledger
after insert or update on public.fee_agreements
for each row execute function private.fee_touch_ledger();

create trigger fee_payments_recompute_ledger
after insert or update on public.fee_payments
for each row execute function private.fee_touch_ledger();

-- ---------------------------------------------------------------------------
-- Recorded payments are append-only.
-- ---------------------------------------------------------------------------
--
-- Same spirit as audit_log_prevent_change (003:546): the money history can be
-- corrected forward by recording a reversal, and cannot be quietly rewritten.

create function private.fee_payments_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a recorded payment cannot be deleted, only reversed'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id
    or new.client_id is distinct from old.client_id
    or new.org_id is distinct from old.org_id
    or new.amount_cents is distinct from old.amount_cents
    or new.received_on is distinct from old.received_on
    or new.method is distinct from old.method
    or new.reference is distinct from old.reference
    or new.note is distinct from old.note
    or new.recorded_by is distinct from old.recorded_by
    or new.recorded_at is distinct from old.recorded_at
  then
    raise exception 'a recorded payment can only be reversed, never rewritten'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger fee_payments_append_only
before update or delete on public.fee_payments
for each row execute function private.fee_payments_append_only();

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
--
-- PG 17 grants EXECUTE on a new function to PUBLIC, so the revoke is the line
-- doing the work and the grant only restores what is needed. Phase 1 treats the
-- default the same way at 001:319-328.
--
-- The two arithmetic helpers are called from inside a trigger function's body,
-- which is checked for EXECUTE as the *calling* role, so both writer roles need
-- the grant. Trigger functions themselves are checked at CREATE TRIGGER time
-- and not when they fire (052's note), but they are revoked-and-granted anyway
-- so the file has one rule rather than two.
revoke all on function private.fee_agreement_legal_gate() from public;
revoke all on function private.validate_fee_org_anchor() from public;
revoke all on function private.fee_ledger_derive() from public;
revoke all on function private.fee_touch_ledger() from public;
revoke all on function private.fee_payments_append_only() from public;
revoke all on function private.fee_recompute_total(uuid, bigint) from public;
revoke all on function private.fee_recompute_paid(uuid) from public;

grant execute on function private.fee_agreement_legal_gate() to authenticated;
grant execute on function private.validate_fee_org_anchor() to authenticated;
grant execute on function private.fee_ledger_derive() to authenticated;
grant execute on function private.fee_touch_ledger() to authenticated;
grant execute on function private.fee_payments_append_only() to authenticated;
grant execute on function private.fee_recompute_total(uuid, bigint) to authenticated, service_role;
grant execute on function private.fee_recompute_paid(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row level security.
-- ---------------------------------------------------------------------------

alter table public.fee_agreements enable row level security;
alter table public.fee_agreements force row level security;
alter table public.fee_ledger enable row level security;
alter table public.fee_ledger force row level security;
alter table public.fee_payments enable row level security;
alter table public.fee_payments force row level security;
alter table public.org_fee_defaults enable row level security;
alter table public.org_fee_defaults force row level security;

revoke all on table public.fee_agreements from anon, authenticated;
revoke all on table public.fee_ledger from anon, authenticated;
revoke all on table public.fee_payments from anon, authenticated;
revoke all on table public.org_fee_defaults from anon, authenticated;

grant select, insert, update on table public.fee_agreements to authenticated;
grant select, insert, update on table public.fee_ledger to authenticated;
grant select, insert, update on table public.fee_payments to authenticated;
grant select, insert, update on table public.org_fee_defaults to authenticated;

-- service_role holds the same privileges deliberately. Criterion 1 is a claim
-- about every writer, and a proof that service_role is stopped by the gate is
-- only worth anything if service_role could otherwise have written the row —
-- a 42501 from a missing grant would prove the wrong thing. DELETE is withheld
-- from both roles: an agreement is voided and a payment is reversed.
grant select, insert, update on table public.fee_agreements to service_role;
grant select, insert, update on table public.fee_ledger to service_role;
grant select, insert, update on table public.fee_payments to service_role;
grant select, insert, update on table public.org_fee_defaults to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fee_agreements'
      and policyname = 'fee_agreements_read'
  ) then
    create policy fee_agreements_read
    on public.fee_agreements
    for select
    to authenticated
    using ((select private.can_access_client(client_id)));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fee_agreements'
      and policyname = 'fee_agreements_operator_write'
  ) then
    -- Narrowed to the two app roles that run a book of business. A consumer's
    -- can_access_client is true for their own client, so a client-access-only
    -- write policy would let a consumer set their own fee. Which *operator*
    -- roles may set commercial terms is narrowed further at the route layer
    -- rather than here, because the client auto-create trigger in 093 fires
    -- under whichever operator created the client and must not be refused.
    create policy fee_agreements_operator_write
    on public.fee_agreements
    for all
    to authenticated
    using (
      (select private.auth_app_role()) in ('platform_admin', 'operator_member')
      and (select private.can_access_client(client_id))
    )
    with check (
      (select private.auth_app_role()) in ('platform_admin', 'operator_member')
      and (select private.can_access_client(client_id))
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fee_ledger'
      and policyname = 'fee_ledger_read'
  ) then
    create policy fee_ledger_read
    on public.fee_ledger
    for select
    to authenticated
    using ((select private.can_access_client(client_id)));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fee_ledger'
      and policyname = 'fee_ledger_operator_write'
  ) then
    create policy fee_ledger_operator_write
    on public.fee_ledger
    for all
    to authenticated
    using (
      (select private.auth_app_role()) in ('platform_admin', 'operator_member')
      and (select private.can_access_client(client_id))
    )
    with check (
      (select private.auth_app_role()) in ('platform_admin', 'operator_member')
      and (select private.can_access_client(client_id))
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fee_payments'
      and policyname = 'fee_payments_read'
  ) then
    create policy fee_payments_read
    on public.fee_payments
    for select
    to authenticated
    using ((select private.can_access_client(client_id)));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'fee_payments'
      and policyname = 'fee_payments_operator_write'
  ) then
    create policy fee_payments_operator_write
    on public.fee_payments
    for all
    to authenticated
    using (
      (select private.auth_app_role()) in ('platform_admin', 'operator_member')
      and (select private.can_access_client(client_id))
    )
    with check (
      (select private.auth_app_role()) in ('platform_admin', 'operator_member')
      and (select private.can_access_client(client_id))
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_fee_defaults'
      and policyname = 'org_fee_defaults_read'
  ) then
    create policy org_fee_defaults_read
    on public.org_fee_defaults
    for select
    to authenticated
    using (
      (select private.auth_app_role()) = 'platform_admin'
      or org_id = (select private.auth_org_id())
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_fee_defaults'
      and policyname = 'org_fee_defaults_owner_write'
  ) then
    -- Narrower than the per-client policies, and it can afford to be: no
    -- trigger path writes this table, so tightening it cannot refuse an
    -- unrelated operation. It is also the table worth tightening — a workspace
    -- default is how the package model would be reached at scale.
    create policy org_fee_defaults_owner_write
    on public.org_fee_defaults
    for all
    to authenticated
    using (
      (select private.auth_app_role()) = 'platform_admin'
      or (
        (select private.auth_app_role()) = 'operator_member'
        and (select private.auth_org_role()) in ('owner', 'admin')
        and org_id = (select private.auth_org_id())
      )
    )
    with check (
      (select private.auth_app_role()) = 'platform_admin'
      or (
        (select private.auth_app_role()) = 'operator_member'
        and (select private.auth_org_role()) in ('owner', 'admin')
        and org_id = (select private.auth_org_id())
      )
    );
  end if;
end
$$;
