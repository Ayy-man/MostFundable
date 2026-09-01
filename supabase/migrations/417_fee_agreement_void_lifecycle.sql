-- 417_fee_agreement_void_lifecycle.sql
-- A void agreement owes nothing, so withdrawing it must remain possible after
-- an organization loses legal approval for its package or upfront terms.
-- Reactivation is still an INSERT/UPDATE whose new status is active, so it runs
-- through the unchanged legal-gate function and must earn approval again.

drop trigger if exists fee_agreements_legal_gate on public.fee_agreements;

create trigger fee_agreements_legal_gate
before insert or update on public.fee_agreements
for each row
when (new.status <> 'void')
execute function private.fee_agreement_legal_gate();

comment on trigger fee_agreements_legal_gate on public.fee_agreements is
  'Package, upfront, and legacy trigger terms require legal approval when draft or active. A void write is always allowed so an agreement can be withdrawn after approval is revoked; reactivation runs the gate again.';
