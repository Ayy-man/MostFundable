-- Resetting a demo enrollment archives the old client and creates a new active
-- row. Receivables are retained against the archived record for audit, but the
-- operator's current Client Fees roster must use the same active-client set as
-- the tracker and platform client count.

drop function public.fees_list_org_receivables(uuid, integer, integer);

create function public.fees_list_org_receivables(
  p_org_id uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  client_id uuid,
  display_name text,
  model public.fee_model,
  status public.fee_agreement_status,
  outcome_basis_cents bigint,
  total_cents bigint,
  paid_cents bigint,
  balance_cents bigint,
  last_payment_on date
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  select
    client.id,
    client.display_name,
    agreement.model,
    agreement.status,
    coalesce(ledger.outcome_basis_cents, 0),
    coalesce(ledger.total_cents, 0),
    coalesce(ledger.paid_cents, 0),
    coalesce(ledger.balance_cents, 0),
    (
      select max(payment.received_on)
      from public.fee_payments as payment
      where payment.client_id = client.id
        and payment.reversed_at is null
    )
  from public.clients as client
  left join public.fee_agreements as agreement on agreement.client_id = client.id
  left join public.fee_ledger as ledger on ledger.client_id = client.id
  where client.org_id = p_org_id
    and client.status = 'active'
  order by coalesce(ledger.balance_cents, 0) desc, client.display_name asc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.fees_list_org_receivables(uuid, integer, integer) from public, anon;
grant execute on function public.fees_list_org_receivables(uuid, integer, integer) to authenticated;

comment on function public.fees_list_org_receivables(uuid, integer, integer) is
  'Current fee roster for every active client in one workspace, including unconfigured clients and their recorded funded basis; archived fee evidence remains stored and readable by client id.';
