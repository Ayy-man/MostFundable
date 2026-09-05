-- 2026-09-05. DerivedFeatures v2 reaches the database.
--
-- The plan-engine v2 merge made `extractFeatures` emit `schemaVersion: 2`: the
-- same twelve fields as v1 plus per-bureau scores, an identity summary, the
-- inquiry list, three more counts, an `accountRef`-level late marker, and five
-- more flags. `private.derived_features_valid` (migration 003) checks an exact
-- v1 key set and `schemaVersion = 1`, so `persist_analysis_result` refused every
-- v2 result with ANALYSIS_RESULT_INVALID and the analysis job failed at the
-- persistence stage. The unit suite never saw it because the in-memory
-- repository does not run the validator; the e2e live chain did.
--
-- This replaces the validator with one that accepts either version. The v1 rule
-- is unchanged for stored rows. The v2 rule requires every field the extractor
-- always writes, allows the fields it writes only when a bureau record carries
-- them, and rejects anything else, so an unknown key is still an invalid result.
-- Account utilisation may exceed 100 in v2: an over-limit balance is a real
-- observation, and the extractor no longer clamps it.

create or replace function private.derived_features_valid(p_derived jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  account jsonb;
  item jsonb;
  current_key text;
  key_set text[];
  numeric_value numeric;
  v_version numeric;
  v_required text[];
  v_allowed text[];
  v_account_required text[] := array[
    'accountRef', 'ageMonths', 'balanceCents', 'isNegative', 'isOpen', 'kind', 'limitCents', 'utilizationPct'
  ];
  v_account_allowed text[];
  v_flags_required text[];
  v_flags_allowed text[];
begin
  if p_derived is null or jsonb_typeof(p_derived) <> 'object' then
    return false;
  end if;

  if jsonb_typeof(p_derived -> 'schemaVersion') <> 'number' then
    return false;
  end if;
  v_version := (p_derived ->> 'schemaVersion')::numeric;
  if v_version not in (1, 2) then
    return false;
  end if;

  if v_version = 1 then
    v_required := array[
      'accounts', 'averageAgeMonths', 'bureausPulled', 'computedAt', 'dti', 'flags',
      'highestRevolvingLimitCents', 'inquiriesByBureau', 'negativesCount', 'openRevolvingCount',
      'overallUtilizationPct', 'schemaVersion'
    ];
    v_allowed := v_required;
    v_account_allowed := v_account_required;
    v_flags_required := array[
      'averageAgeTwoYearsOrMore', 'cardWithTenKLimit', 'fourOrMorePersonalAccountsOpen',
      'noNegativeItemsReported', 'thinFile', 'twoOrFewerInquiriesEveryBureau', 'utilizationUnder30'
    ];
    v_flags_allowed := v_flags_required;
  else
    v_required := array[
      'accounts', 'averageAgeMonths', 'bureausPulled', 'collectionsCount', 'computedAt', 'dti',
      'flags', 'highestRevolvingLimitCents', 'identity', 'inquiries', 'inquiriesByBureau',
      'lateAccountsCount', 'negativesCount', 'openRevolvingCount', 'overallUtilizationPct',
      'publicRecordsCount', 'schemaVersion', 'scores'
    ];
    v_allowed := v_required;
    v_account_allowed := v_account_required || array['label', 'lateWithin24Months', 'pastDueCents'];
    v_flags_required := array[
      'averageAgeTwoYearsOrMore', 'cardWithTenKLimit', 'fourOrMorePersonalAccountsOpen',
      'personalInformationConfirmed', 'thinFile', 'twoOrFewerInquiriesEveryBureau', 'utilizationUnder30'
    ];
    v_flags_allowed := v_flags_required
      || array['cleanReport', 'noLatePayments', 'noNegativeItemsReported', 'scoreAtLeast700'];
  end if;

  select array_agg(key order by key) into key_set from jsonb_object_keys(p_derived) as key;
  if not (v_required <@ key_set) or not (key_set <@ v_allowed) then
    return false;
  end if;

  if jsonb_typeof(p_derived -> 'bureausPulled') <> 'array' then
    return false;
  end if;
  for item in select value from jsonb_array_elements(p_derived -> 'bureausPulled')
  loop
    if jsonb_typeof(item) <> 'string' or item #>> '{}' not in ('EQF', 'EXP', 'TUC') then
      return false;
    end if;
  end loop;

  if jsonb_typeof(p_derived -> 'accounts') <> 'array' then
    return false;
  end if;
  for account in select value from jsonb_array_elements(p_derived -> 'accounts')
  loop
    if jsonb_typeof(account) <> 'object' then
      return false;
    end if;
    select array_agg(key order by key) into key_set from jsonb_object_keys(account) as key;
    if not (v_account_required <@ key_set) or not (key_set <@ v_account_allowed) then
      return false;
    end if;
    if jsonb_typeof(account -> 'accountRef') <> 'string'
      or length(account ->> 'accountRef') = 0
      or jsonb_typeof(account -> 'kind') <> 'string'
      or account ->> 'kind' not in ('revolving', 'installment', 'mortgage', 'other')
      or jsonb_typeof(account -> 'balanceCents') <> 'number'
      or (account ->> 'balanceCents')::numeric < 0
      or jsonb_typeof(account -> 'isOpen') <> 'boolean'
      or jsonb_typeof(account -> 'isNegative') <> 'boolean' then
      return false;
    end if;
    if account -> 'limitCents' <> 'null'::jsonb
      and (jsonb_typeof(account -> 'limitCents') <> 'number' or (account ->> 'limitCents')::numeric < 0) then
      return false;
    end if;
    if account -> 'utilizationPct' <> 'null'::jsonb then
      if jsonb_typeof(account -> 'utilizationPct') <> 'number' then
        return false;
      end if;
      numeric_value := (account ->> 'utilizationPct')::numeric;
      if numeric_value < 0 or (v_version = 1 and numeric_value > 100) then
        return false;
      end if;
    end if;
    if account -> 'ageMonths' <> 'null'::jsonb
      and (jsonb_typeof(account -> 'ageMonths') <> 'number' or (account ->> 'ageMonths')::numeric < 0) then
      return false;
    end if;
    if account ? 'label'
      and account -> 'label' <> 'null'::jsonb
      and jsonb_typeof(account -> 'label') <> 'string' then
      return false;
    end if;
    if account ? 'pastDueCents'
      and (jsonb_typeof(account -> 'pastDueCents') <> 'number' or (account ->> 'pastDueCents')::numeric < 0) then
      return false;
    end if;
    if account ? 'lateWithin24Months' and jsonb_typeof(account -> 'lateWithin24Months') <> 'boolean' then
      return false;
    end if;
  end loop;

  if p_derived -> 'overallUtilizationPct' <> 'null'::jsonb then
    if jsonb_typeof(p_derived -> 'overallUtilizationPct') <> 'number' then
      return false;
    end if;
    numeric_value := (p_derived ->> 'overallUtilizationPct')::numeric;
    if numeric_value < 0 or (v_version = 1 and numeric_value > 100) then
      return false;
    end if;
  end if;

  if jsonb_typeof(p_derived -> 'inquiriesByBureau') <> 'object' then
    return false;
  end if;
  select array_agg(key order by key) into key_set
  from jsonb_object_keys(p_derived -> 'inquiriesByBureau') as key;
  if key_set <> array['EQF', 'EXP', 'TUC']::text[] then
    return false;
  end if;
  foreach current_key in array array['EQF', 'EXP', 'TUC']::text[]
  loop
    if jsonb_typeof((p_derived -> 'inquiriesByBureau') -> current_key) <> 'number' then
      return false;
    end if;
    numeric_value := ((p_derived -> 'inquiriesByBureau') ->> current_key)::numeric;
    if numeric_value < 0 or numeric_value <> trunc(numeric_value) then
      return false;
    end if;
  end loop;

  foreach current_key in array (
    case when v_version = 1
      then array['negativesCount', 'openRevolvingCount']
      else array['negativesCount', 'openRevolvingCount', 'lateAccountsCount', 'collectionsCount', 'publicRecordsCount']
    end
  )
  loop
    if jsonb_typeof(p_derived -> current_key) <> 'number' then
      return false;
    end if;
    numeric_value := (p_derived ->> current_key)::numeric;
    if numeric_value < 0 or numeric_value <> trunc(numeric_value) then
      return false;
    end if;
  end loop;

  foreach current_key in array array['averageAgeMonths', 'highestRevolvingLimitCents']::text[]
  loop
    if p_derived -> current_key <> 'null'::jsonb
      and (jsonb_typeof(p_derived -> current_key) <> 'number' or (p_derived ->> current_key)::numeric < 0) then
      return false;
    end if;
  end loop;

  if jsonb_typeof(p_derived -> 'dti') <> 'object' then
    return false;
  end if;
  select array_agg(key order by key) into key_set from jsonb_object_keys(p_derived -> 'dti') as key;
  if key_set <> array['monthlyDebtPaymentsCents', 'ratioPct', 'statedMonthlyIncomeCents']::text[] then
    return false;
  end if;
  if jsonb_typeof((p_derived -> 'dti') -> 'monthlyDebtPaymentsCents') <> 'number'
    or ((p_derived -> 'dti') ->> 'monthlyDebtPaymentsCents')::numeric < 0 then
    return false;
  end if;
  foreach current_key in array array['statedMonthlyIncomeCents', 'ratioPct']::text[]
  loop
    if (p_derived -> 'dti') -> current_key <> 'null'::jsonb
      and (jsonb_typeof((p_derived -> 'dti') -> current_key) <> 'number'
        or ((p_derived -> 'dti') ->> current_key)::numeric < 0) then
      return false;
    end if;
  end loop;

  if jsonb_typeof(p_derived -> 'flags') <> 'object' then
    return false;
  end if;
  select array_agg(key order by key) into key_set from jsonb_object_keys(p_derived -> 'flags') as key;
  if not (v_flags_required <@ key_set) or not (key_set <@ v_flags_allowed) then
    return false;
  end if;
  foreach current_key in array key_set
  loop
    if jsonb_typeof((p_derived -> 'flags') -> current_key) <> 'boolean' then
      return false;
    end if;
  end loop;

  if jsonb_typeof(p_derived -> 'computedAt') <> 'string'
    or (p_derived ->> 'computedAt') !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    return false;
  end if;

  if v_version = 2 then
    if jsonb_typeof(p_derived -> 'scores') <> 'array' then
      return false;
    end if;
    for item in select value from jsonb_array_elements(p_derived -> 'scores')
    loop
      select array_agg(key order by key) into key_set from jsonb_object_keys(item) as key;
      if jsonb_typeof(item) <> 'object'
        or key_set <> array['bureau', 'model', 'score']::text[]
        or jsonb_typeof(item -> 'bureau') <> 'string'
        or item ->> 'bureau' not in ('EQF', 'EXP', 'TUC')
        or jsonb_typeof(item -> 'model') <> 'string'
        or jsonb_typeof(item -> 'score') <> 'number'
        or (item ->> 'score')::numeric < 0 then
        return false;
      end if;
    end loop;

    if jsonb_typeof(p_derived -> 'identity') <> 'object' then
      return false;
    end if;
    select array_agg(key order by key) into key_set from jsonb_object_keys(p_derived -> 'identity') as key;
    if key_set <> array['addressesOnFile', 'employersOnFile', 'namesOnFile']::text[] then
      return false;
    end if;
    foreach current_key in array key_set
    loop
      if (p_derived -> 'identity') -> current_key <> 'null'::jsonb then
        if jsonb_typeof((p_derived -> 'identity') -> current_key) <> 'number' then
          return false;
        end if;
        numeric_value := ((p_derived -> 'identity') ->> current_key)::numeric;
        if numeric_value < 0 or numeric_value <> trunc(numeric_value) then
          return false;
        end if;
      end if;
    end loop;

    if jsonb_typeof(p_derived -> 'inquiries') <> 'array' then
      return false;
    end if;
    for item in select value from jsonb_array_elements(p_derived -> 'inquiries')
    loop
      select array_agg(key order by key) into key_set from jsonb_object_keys(item) as key;
      if jsonb_typeof(item) <> 'object'
        or key_set <> array['bureau', 'inquiryRef', 'matchedNewAccountWithin45Days', 'monthsAgo']::text[]
        or jsonb_typeof(item -> 'inquiryRef') <> 'string'
        or length(item ->> 'inquiryRef') = 0
        or jsonb_typeof(item -> 'bureau') <> 'string'
        or item ->> 'bureau' not in ('EQF', 'EXP', 'TUC')
        or jsonb_typeof(item -> 'monthsAgo') <> 'number'
        or (item ->> 'monthsAgo')::numeric < 0
        or jsonb_typeof(item -> 'matchedNewAccountWithin45Days') <> 'boolean' then
        return false;
      end if;
    end loop;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

revoke all on function private.derived_features_valid(jsonb) from public;
grant execute on function private.derived_features_valid(jsonb) to service_role;
