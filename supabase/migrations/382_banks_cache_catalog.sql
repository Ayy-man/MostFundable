-- 382_banks_cache_catalog.sql — Phase 8 (S2.2), VAULT-06.
--
-- The bank list is VAULT's 47, not the Notion 688 (Alec, client portal, Aug 17:
-- "47 inside the vault datapoints database. focus on those"). VAULT-06 is
-- answered and the sync stays a straight nightly copy. This lane holds no VAULT
-- credential, so the 47 real rows arrive when the integrator runs the real sync
-- arm; what ships here is the seven-lender illustrative catalog the frozen
-- surface already names, marked `source = 'fixture'` so a real sync run
-- overwrites it rather than sitting beside it.
--
-- Why a migration rather than `supabase/seed.sql`: `supabase db push` does not
-- apply the seed to the hosted project — that is what forced the Aug-18
-- Management-API seed — and 383's foreign key has nothing to validate against
-- on a database where these rows are missing. Reference data that a constraint
-- depends on belongs in the ledger.
--
-- Every string below is already committed, word for word, in
-- `web/src/lib/demo/co-fixtures.ts` and `web/src/lib/demo/feedback-fixtures.ts`
-- and has been through the compliance gate there. The frontend froze on
-- 2026-08-18 at `4bb5232`; copying the frozen wording is what keeps the durable
-- path rendering exactly what the fixture path renders, and writing anything
-- new here would be a change order.

insert into public.banks_cache (
  bank_ref, name, products, bureau_pulls, qualification_summary,
  channel_type, channel_value,
  checking_required, checking_deposit_cents, checking_seasoning,
  rel_manager, rel_manager_tip,
  application_questions, source_updated_at, is_active, source
)
select
  row.bank_ref,
  row.name,
  row.products,
  row.bureau_pulls,
  row.qualification_summary,
  row.channel_type,
  row.channel_value,
  row.checking_required,
  row.checking_deposit_cents,
  row.checking_seasoning,
  row.rel_manager,
  row.rel_manager_tip,
  -- The four standing §6 questions first, in the frozen order, then whatever
  -- the lender adds. `applicationQuestions()` in co-fixtures.ts composes the
  -- same two halves the same way round.
  standing.questions || row.extra_questions,
  row.source_updated_at,
  true,
  'fixture'
from (
  select '[
    {"id": "projected-revenue", "label": "Projected revenue", "responseBasis": "Use the business''s own current revenue projection and supporting records."},
    {"id": "projected-personal-income", "label": "Projected personal income", "responseBasis": "Use the applicant''s own current income projection and supporting records."},
    {"id": "projected-monthly-spend", "label": "Projected monthly spend", "responseBasis": "Use the business''s own current operating-budget projection."},
    {"id": "projected-employees", "label": "Projected # employees", "responseBasis": "Use the business''s own current staffing projection."}
  ]'::jsonb as questions
) as standing
cross join (
  values
    (
      'bluevine', 'Bluevine',
      array['Business line of credit', 'Term loan'],
      'Experian business',
      'Business banking history and current revenue evidence',
      'online', 'https://example.com/illustrative-bluevine-application',
      true, 100000, 'About 3 months',
      false, 'The recorded process starts online; the bank may follow up for documents.',
      '[{"id": "average-monthly-revenue", "label": "Average monthly revenue", "responseBasis": "Use current business statements to report the recorded monthly average."}]'::jsonb,
      date '2026-07-20'
    ),
    (
      'chase-ink', 'Chase Ink',
      array['Business credit card'],
      'Experian personal',
      'Business identity, issuer relationship, and application timing',
      'online', 'https://example.com/illustrative-chase-ink-application',
      false, null, 'Not specified',
      false, 'The recorded process starts online and may include a verification call.',
      '[{"id": "business-start-date", "label": "Business start date", "responseBasis": "Use the date shown in the business''s formation records."}]'::jsonb,
      date '2026-07-18'
    ),
    (
      'amex-business', 'Amex Business',
      array['Business credit card', 'Term loan'],
      'Experian personal and business',
      'Current account profile and business cash-flow evidence',
      'phone', '+1-800-555-0148',
      false, null, 'Not specified',
      false, 'The recorded phone process may be followed by a request for cash-flow records.',
      '[{"id": "annual-business-revenue", "label": "Annual business revenue", "responseBasis": "Use the total supported by the business''s current revenue records."}]'::jsonb,
      date '2026-07-19'
    ),
    (
      'us-bank', 'US Bank',
      array['Business line of credit', 'Business credit card'],
      'TransUnion personal',
      'Business banking relationship and complete company records',
      'in-person', null,
      true, 250000, 'About 6 months',
      true, 'Research a local branch and expect a banker to provide the application process.',
      '[{"id": "requested-amount", "label": "Requested amount", "responseBasis": "Use the business''s documented funding need and intended use."},
        {"id": "business-ownership", "label": "Business ownership", "responseBasis": "Use the ownership percentages in the current company records."}]'::jsonb,
      date '2026-07-17'
    ),
    (
      'wells-fargo', 'Wells Fargo',
      array['Term loan', 'Business line of credit'],
      'Experian business',
      'Complete financial records and relationship context',
      'phone', '+1-800-555-0192',
      true, 150000, 'Established relationship; duration not specified',
      true, 'Expect the assigned banker to explain the document request and next contact.',
      '[{"id": "annual-gross-sales", "label": "Annual gross sales", "responseBasis": "Use the amount supported by the business''s current financial records."},
        {"id": "requested-product", "label": "Requested product", "responseBasis": "Select the product the business is actually requesting."}]'::jsonb,
      date '2026-07-15'
    ),
    (
      'pnc', 'PNC',
      array['Business credit card', 'Term loan'],
      'Equifax business',
      'Business banking history and documented revenue',
      'online', 'https://example.com/illustrative-pnc-application',
      true, 100000, 'About 3 months',
      false, 'The recorded process starts online and may request revenue records.',
      '[{"id": "industry-classification", "label": "Industry classification", "responseBasis": "Use the classification in the business''s current registration records."}]'::jsonb,
      date '2026-07-20'
    ),
    (
      'td-bank', 'TD Bank',
      array['Revenue-based funding'],
      'Experian business',
      'Current deposits and operating revenue',
      'in-person', null,
      true, 200000, 'About 6 months',
      true, 'Research a local branch and expect a banker to explain the statement request.',
      '[{"id": "average-monthly-deposits", "label": "Average monthly deposits", "responseBasis": "Use the average shown by the business''s current operating statements."}]'::jsonb,
      date '2026-07-14'
    )
) as row (
  bank_ref, name, products, bureau_pulls, qualification_summary,
  channel_type, channel_value,
  checking_required, checking_deposit_cents, checking_seasoning,
  rel_manager, rel_manager_tip,
  extra_questions, source_updated_at
)
on conflict (bank_ref) do nothing;
