begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

-- Migration 439: `private.derived_features_valid` accepts the v2 shape the
-- plan-engine v2 extractor writes, keeps the v1 rule for stored rows, and still
-- rejects anything outside either closed key set.

create temporary table t439 as
select
  jsonb_build_object(
    'schemaVersion', 1,
    'bureausPulled', '["EQF"]'::jsonb,
    'accounts', '[]'::jsonb,
    'overallUtilizationPct', null,
    'inquiriesByBureau', jsonb_build_object('EQF', 0, 'EXP', 0, 'TUC', 0),
    'negativesCount', 0,
    'openRevolvingCount', 0,
    'averageAgeMonths', null,
    'highestRevolvingLimitCents', null,
    'dti', jsonb_build_object('monthlyDebtPaymentsCents', 0, 'statedMonthlyIncomeCents', null, 'ratioPct', null),
    'flags', jsonb_build_object(
      'averageAgeTwoYearsOrMore', false, 'cardWithTenKLimit', false, 'fourOrMorePersonalAccountsOpen', false,
      'noNegativeItemsReported', true, 'thinFile', true, 'twoOrFewerInquiriesEveryBureau', true, 'utilizationUnder30', true),
    'computedAt', '2026-09-05T00:00:00.000Z') as v1,
  jsonb_build_object(
    'schemaVersion', 2,
    'bureausPulled', '["EQF", "EXP", "TUC"]'::jsonb,
    'scores', '[{"bureau": "EQF", "model": "VANTAGE", "score": 620}]'::jsonb,
    'identity', jsonb_build_object('namesOnFile', 1, 'addressesOnFile', 1, 'employersOnFile', 0),
    'accounts', '[{
      "accountRef": "account-1", "label": "DG1", "kind": "revolving", "balanceCents": 418000,
      "limitCents": 450000, "utilizationPct": 92.9, "ageMonths": 38, "pastDueCents": 0,
      "lateWithin24Months": false, "isOpen": true, "isNegative": false
    }]'::jsonb,
    'overallUtilizationPct', 92.9,
    'inquiries', '[{"inquiryRef": "eqf-inquiry-1", "bureau": "EQF", "monthsAgo": 11, "matchedNewAccountWithin45Days": false}]'::jsonb,
    'inquiriesByBureau', jsonb_build_object('EQF', 1, 'EXP', 0, 'TUC', 0),
    'negativesCount', 0,
    'lateAccountsCount', 0,
    'collectionsCount', 0,
    'publicRecordsCount', 0,
    'openRevolvingCount', 1,
    'averageAgeMonths', 38,
    'highestRevolvingLimitCents', 450000,
    'dti', jsonb_build_object('monthlyDebtPaymentsCents', 61500, 'statedMonthlyIncomeCents', null, 'ratioPct', null),
    'flags', jsonb_build_object(
      'scoreAtLeast700', false, 'cleanReport', true, 'noLatePayments', true, 'noNegativeItemsReported', true,
      'personalInformationConfirmed', false, 'utilizationUnder30', false, 'fourOrMorePersonalAccountsOpen', false,
      'averageAgeTwoYearsOrMore', true, 'cardWithTenKLimit', false, 'twoOrFewerInquiriesEveryBureau', true,
      'thinFile', true),
    'computedAt', '2026-09-05T00:00:00.000Z') as v2;

select ok((select private.derived_features_valid(v1) from t439), 'the v1 shape is still valid');
select ok((select private.derived_features_valid(v2) from t439), 'the v2 shape the extractor writes is valid');
select ok(
  (select private.derived_features_valid(v2 #- '{flags,scoreAtLeast700}' #- '{flags,cleanReport}' #- '{flags,noLatePayments}' #- '{flags,noNegativeItemsReported}') from t439),
  'v2 without the record-dependent flags is valid');
select ok(
  (select private.derived_features_valid(jsonb_set(v2, '{accounts,0,utilizationPct}', '112.5')) from t439),
  'v2 keeps an over-limit account utilisation');

select ok(not (select private.derived_features_valid(v1 || '{"scores": []}') from t439), 'v1 rejects a v2 key');
select ok(not (select private.derived_features_valid(jsonb_set(v1, '{schemaVersion}', '2')) from t439), 'v1 fields under schemaVersion 2 are incomplete');
select ok(not (select private.derived_features_valid(v2 || '{"extra": true}') from t439), 'v2 rejects an unknown key');
select ok(not (select private.derived_features_valid(v2 - 'scores') from t439), 'v2 requires scores');
select ok(not (select private.derived_features_valid(v2 #- '{flags,personalInformationConfirmed}') from t439), 'v2 requires personalInformationConfirmed');
select ok(not (select private.derived_features_valid(jsonb_set(v2, '{scores,0,bureau}', '"XXX"')) from t439), 'v2 rejects an unknown score bureau');
select ok(not (select private.derived_features_valid(jsonb_set(v2, '{identity,namesOnFile}', '-1')) from t439), 'v2 rejects a negative identity count');
select ok(not (select private.derived_features_valid(jsonb_set(v2, '{inquiries,0,monthsAgo}', '"eleven"')) from t439), 'v2 rejects a non-numeric inquiry age');
select ok(not (select private.derived_features_valid(jsonb_set(v2, '{accounts,0,lateWithin24Months}', '"no"')) from t439), 'v2 rejects a non-boolean late marker');
select ok(not (select private.derived_features_valid(jsonb_set(v2, '{schemaVersion}', '3')) from t439), 'schemaVersion 3 is unknown');

select * from finish();
rollback;
