// narrative-eval-scenarios.mjs — twenty synthetic facts packs for the narrative eval.
//
// Every number is invented. No real person, account or institution. Each pack is built from a
// short "file" description by the same arithmetic `facts.ts` uses, so the pack is internally
// consistent: the ten personal states, the score, the label, the counts and the per-card paydown
// figures all agree with the accounts and scores underneath them. The point of consistency is that
// a rejected narrative can be blamed on the model or on the checker, never on a contradictory pack.
//
// The set is chosen to reach every way the prompt has been seen to fail: several dollar figures
// within an order of magnitude of each other, more problems than steps, a card that invites the
// model to compute its own paydown, a creditor label that is also a brand word, a clean file where
// the risk is an invented gap, a thin file, a single-bureau pull where one item cannot be checked,
// and files whose only open item is the one the consumer has to confirm.

const PERSONAL_KEYS = [
  'credit_score_700',
  'personal_information_confirmed',
  'clean_report',
  'utilization_under_30',
  'four_personal_accounts_open',
  'average_age_two_years',
  'no_late_payments',
  'no_negative_items_reported',
  'personal_card_ten_k_limit',
  'inquiries_within_bureau_limit',
];

const TITLES = {
  credit_score_700: 'Credit score is 700 or higher',
  personal_information_confirmed: 'Personal information is correct (name and addresses)',
  clean_report: 'Report is clean (no extra addresses or employers listed)',
  utilization_under_30: 'Every personal credit card is under 30% utilization',
  four_personal_accounts_open: 'Four or more personal credit accounts are open',
  average_age_two_years: 'Average account age is two years or more',
  no_late_payments: 'No late payments reported',
  no_negative_items_reported: 'No negative items (bankruptcy, collections, charge-offs)',
  personal_card_ten_k_limit: 'At least one personal card has a $10,000 or higher limit',
  inquiries_within_bureau_limit: 'No more than two inquiries on each bureau',
};

const TARGET = {
  credit_score_700: '700 or higher',
  personal_information_confirmed: 'consumer confirmation of correct name and addresses',
  clean_report: 'no employers and no more than 1 address',
  utilization_under_30: 'under 30% on every card',
  four_personal_accounts_open: '4 or more open personal accounts',
  average_age_two_years: '24 months (two years) or more',
  no_late_payments: 'no late payments reported',
  no_negative_items_reported: 'no negative items, collections, or public records',
  personal_card_ten_k_limit: 'at least one $10,000 or higher card limit',
  inquiries_within_bureau_limit: '2 or fewer inquiries on each bureau',
};

const BUSINESS = [
  ['business_name_confirmed', 'confirmed by the owner'],
  ['industry_classification_confirmed', 'confirmed by the owner'],
  ['business_entity_age_confirmed', 'confirmed by the owner'],
  ['net_asset_value_confirmed', 'confirmed by the owner'],
  ['business_identifier_present', 'supplied by the owner'],
  ['business_email_present', 'supplied by the owner'],
  ['business_website_present', 'supplied by the owner'],
];

function dollars(cents) {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

/** Same arithmetic as `facts.ts`: 29% of the limit floored to the dollar, and the distance to it. */
function paydown(balanceCents, limitCents) {
  if (limitCents === null || limitCents <= 0) return { targetBalanceCents: null, paydownCents: null };
  const targetBalanceCents = Math.floor((limitCents * 0.29) / 100) * 100;
  return { targetBalanceCents, paydownCents: Math.max(0, balanceCents - targetBalanceCents) };
}

/**
 * One account from a compact tuple: [label, kind, balance$, limit$ | null, ageMonths, flags].
 * flags: 'late' (a late in 24 months), 'pastdue:NNN' (dollars past due), 'closed', 'negative'.
 */
function account(index, [label, kind, balanceDollars, limitDollars, ageMonths, ...flags]) {
  const balanceCents = balanceDollars * 100;
  const limitCents = limitDollars === null ? null : limitDollars * 100;
  const pastDue = flags.find((flag) => flag.startsWith('pastdue:'));
  const utilizationPct = limitCents === null || limitCents === 0 ? null : Math.round((balanceCents / limitCents) * 100);
  return {
    accountRef: `account-${index + 1}`,
    label,
    kind,
    isOpen: !flags.includes('closed'),
    isNegative: flags.includes('negative'),
    balanceCents,
    limitCents,
    utilizationPct,
    ageMonths,
    lateWithin24Months: flags.includes('late'),
    pastDueCents: pastDue ? Number(pastDue.slice('pastdue:'.length)) * 100 : 0,
    ...paydown(balanceCents, limitCents),
  };
}

/**
 * Build a consistent pack.
 *
 * file: {
 *   bureaus: ['EQF','EXP','TUC'],
 *   scores: { EQF: 651, ... },           // omit a bureau for "no score reported"
 *   accounts: [tuple, ...],
 *   inquiries: [[bureau, monthsAgo, matched], ...],
 *   identity: { names, addresses, employers },   // employers null when unknown
 *   collections, publicRecords,                   // counts, default 0
 *   personalInfo: 'verified' | 'not_checkable',   // the consumer-confirmed item
 * }
 */
export function buildPack(name, file) {
  const accounts = file.accounts.map((tuple, index) => account(index, tuple));
  const open = accounts.filter((item) => item.isOpen);
  const revolvingOpen = open.filter((item) => item.kind === 'revolving' && item.limitCents !== null && item.limitCents > 0);
  const scores = Object.entries(file.scores ?? {}).map(([bureau, score]) => ({ bureau, model: 'VANTAGE', score }));
  const lowestScore = scores.length ? Math.min(...scores.map((score) => score.score)) : null;
  const inquiries = (file.inquiries ?? []).map(([bureau, monthsAgo, matched], index) => ({
    inquiryRef: `inquiry-${index + 1}`,
    bureau,
    monthsAgo,
    matchedNewAccountWithin45Days: matched,
  }));
  const inquiriesByBureau = { EQF: 0, EXP: 0, TUC: 0 };
  for (const inquiry of inquiries) inquiriesByBureau[inquiry.bureau] += 1;
  const identity = {
    namesOnFile: file.identity?.names ?? 1,
    addressesOnFile: file.identity?.addresses ?? 1,
    employersOnFile: file.identity?.employers ?? 0,
  };
  const collections = file.collections ?? 0;
  const publicRecords = file.publicRecords ?? 0;
  const negativesCount = accounts.filter((item) => item.isNegative).length;
  const lateAccounts = accounts.filter((item) => item.lateWithin24Months).length;
  const ageMonthsList = accounts.map((item) => item.ageMonths).filter((age) => age !== null);
  const averageAgeMonths = ageMonthsList.length ? Math.round(ageMonthsList.reduce((sum, age) => sum + age, 0) / ageMonthsList.length) : null;
  const highestRevolvingLimitCents = revolvingOpen.length ? Math.max(...revolvingOpen.map((item) => item.limitCents)) : null;
  const totalBalance = revolvingOpen.reduce((sum, item) => sum + item.balanceCents, 0);
  const totalLimit = revolvingOpen.reduce((sum, item) => sum + item.limitCents, 0);
  const overallUtilizationPct = totalLimit > 0 ? Math.round((totalBalance / totalLimit) * 100) : null;
  const worstUtilization = revolvingOpen.length ? Math.max(...revolvingOpen.map((item) => item.utilizationPct)) : null;
  const worstBureauInquiries = Math.max(...Object.values(inquiriesByBureau));
  const singleBureau = (file.bureaus ?? ['EQF', 'EXP', 'TUC']).length === 1;

  const evaluate = {
    credit_score_700: () => (lowestScore === null ? 'unverified' : lowestScore >= 700 ? 'verified' : 'unverified'),
    personal_information_confirmed: () => file.personalInfo ?? 'not_checkable',
    clean_report: () => (singleBureau ? 'not_checkable' : identity.addressesOnFile <= 1 && identity.employersOnFile === 0 ? 'verified' : 'unverified'),
    utilization_under_30: () => (revolvingOpen.length === 0 ? 'unverified' : worstUtilization < 30 ? 'verified' : 'unverified'),
    four_personal_accounts_open: () => (open.length >= 4 ? 'verified' : 'unverified'),
    average_age_two_years: () => (averageAgeMonths !== null && averageAgeMonths >= 24 ? 'verified' : 'unverified'),
    no_late_payments: () => (lateAccounts === 0 ? 'verified' : 'unverified'),
    no_negative_items_reported: () => (negativesCount === 0 && collections === 0 && publicRecords === 0 ? 'verified' : 'unverified'),
    personal_card_ten_k_limit: () => (highestRevolvingLimitCents !== null && highestRevolvingLimitCents >= 1_000_000 ? 'verified' : 'unverified'),
    inquiries_within_bureau_limit: () => (worstBureauInquiries <= 2 ? 'verified' : 'unverified'),
  };

  const gap = {
    credit_score_700: () => (lowestScore === null ? 'No bureau score was reported; the target is 700 or higher.' : `Lowest pulled bureau score is ${lowestScore}, below the 700 target.`),
    personal_information_confirmed: () => 'Personal information needs consumer confirmation against the report.',
    clean_report: () => `${identity.addressesOnFile} addresses and ${identity.employersOnFile} employers are reported; the target is one address and no employers.`,
    utilization_under_30: () => {
      const card = revolvingOpen.find((item) => item.utilizationPct >= 30);
      if (!card) return 'No open revolving account with a limit was reported; the target is under 30% on every card.';
      return `${card.label ?? card.accountRef} is ${dollars(card.balanceCents)} on a ${dollars(card.limitCents)} limit = ${card.utilizationPct}%, above the 30% target.`;
    },
    four_personal_accounts_open: () => `${open.length} personal accounts are open, below the target of 4.`,
    average_age_two_years: () => `Average account age is ${averageAgeMonths ?? 0} months, below the 24-month target.`,
    no_late_payments: () => `${lateAccounts} accounts have a late payment within 24 months; the target is 0.`,
    no_negative_items_reported: () => `${negativesCount} negative accounts, ${collections} collections, and ${publicRecords} public records are reported; the target is 0.`,
    personal_card_ten_k_limit: () => `Highest revolving limit is ${dollars(highestRevolvingLimitCents ?? 0)}, below the ${dollars(1_000_000)} target.`,
    inquiries_within_bureau_limit: () => `${worstBureauInquiries} inquiries are reported at the highest bureau, above the target of 2.`,
  };

  const personal = PERSONAL_KEYS.map((key) => {
    const state = evaluate[key]();
    const observed = { title: TITLES[key] };
    if (key === 'credit_score_700') observed.lowestScore = lowestScore;
    if (key === 'clean_report') { observed.addressesOnFile = identity.addressesOnFile; observed.employersOnFile = identity.employersOnFile; }
    if (key === 'average_age_two_years') observed.averageAgeMonths = averageAgeMonths;
    if (key === 'four_personal_accounts_open') observed.openAccountsCount = open.length;
    if (key === 'no_late_payments') observed.lateAccountsCount = lateAccounts;
    if (key === 'no_negative_items_reported') { observed.negativesCount = negativesCount; observed.collectionsCount = collections; observed.publicRecordsCount = publicRecords; }
    return { key, state, observed, target: TARGET[key], gap: state === 'unverified' ? gap[key]() : null };
  });

  const verified = personal.filter((item) => item.state === 'verified').length;
  const unverified = personal.filter((item) => item.state === 'unverified').length;
  const readinessScore = unverified > 0 ? Math.min(99, verified * 10) : verified * 10;
  const readinessLabel = readinessScore === 100 ? 'Ready' : readinessScore >= 90 ? 'Near Ready' : 'Building Readiness';

  return {
    name,
    pack: {
      schemaVersion: 2,
      computedAt: '2026-09-05T12:00:00.000Z',
      bureausPulled: file.bureaus ?? ['EQF', 'EXP', 'TUC'],
      readinessScore,
      readinessLabel,
      itemsToFix: unverified,
      personalVerifiedCount: verified,
      personal,
      business: BUSINESS.map(([key, target]) => ({ key, state: 'not_checkable', observed: {}, target, gap: null })),
      accounts,
      inquiries,
      scores,
      identity,
      overallUtilizationPct,
      averageAgeMonths,
      highestRevolvingLimitCents,
      openAccountsCount: open.length,
      negativesCount,
      inquiriesByBureau,
    },
  };
}

export const NARRATIVE_EVAL_SCENARIOS = [
  buildPack('01-ready-all-verified', {
    scores: { EQF: 742, EXP: 751, TUC: 739 }, personalInfo: 'verified',
    accounts: [['REWARDS CARD', 'revolving', 900, 12000, 84], ['CREDIT UNION CARD', 'revolving', 400, 8000, 61], ['STORE CARD', 'revolving', 0, 3000, 40], ['AUTO LOAN', 'installment', 6200, null, 30]],
    inquiries: [['EQF', 8, true]],
  }),
  buildPack('02-near-ready-one-card', {
    scores: { EQF: 721, EXP: 716, TUC: 724 }, personalInfo: 'verified',
    accounts: [['PLATINUM CARD', 'revolving', 6800, 10000, 70], ['CREDIT UNION CARD', 'revolving', 300, 5000, 48], ['GAS CARD', 'revolving', 120, 1500, 36], ['STUDENT LOAN', 'installment', 14000, null, 90]],
    inquiries: [],
  }),
  buildPack('03-near-ready-info-unconfirmed', {
    scores: { EQF: 733, EXP: 728, TUC: 740 }, personalInfo: 'not_checkable',
    accounts: [['REWARDS CARD', 'revolving', 1200, 15000, 96], ['CREDIT UNION CARD', 'revolving', 250, 6000, 72], ['STORE CARD', 'revolving', 0, 2500, 50], ['MORTGAGE', 'mortgage', 212000, null, 60]],
    inquiries: [['TUC', 11, true]],
  }),
  buildPack('04-mixed-four-items', {
    scores: { EQF: 651, EXP: 664, TUC: 658 }, personalInfo: 'verified', identity: { names: 1, addresses: 2, employers: 1 },
    accounts: [['RETAIL CARD', 'revolving', 4200, 5000, 48], ['CREDIT UNION CARD', 'revolving', 300, 12000, 26], ['AUTO LOAN', 'installment', 9800, null, 24, 'late', 'pastdue:215'], ['STORE CARD', 'revolving', 150, 2000, 58], ['GAS CARD', 'revolving', 90, 1200, 44]],
    inquiries: [['EXP', 3, false], ['EXP', 5, true], ['EXP', 9, false], ['EQF', 6, true]],
  }),
  buildPack('05-maxed-cards', {
    scores: { EQF: 581, EXP: 598, TUC: 590 }, personalInfo: 'verified', identity: { names: 1, addresses: 1, employers: 2 },
    accounts: [['STORE CARD', 'revolving', 1030, 1000, 11, 'late', 'pastdue:45'], ['CREDIT UNION VISA', 'revolving', 3325, 3500, 22], ['GAS CARD', 'revolving', 480, 600, 9, 'late', 'pastdue:32'], ['AUTO LOAN', 'installment', 18400, null, 14]],
    inquiries: [['EQF', 2, true], ['EQF', 7, false], ['EQF', 1, false], ['EXP', 4, true], ['TUC', 10, false]],
  }),
  buildPack('06-thin-file', {
    scores: { EQF: 668 }, bureaus: ['EQF'], personalInfo: 'not_checkable',
    accounts: [['SECURED CARD', 'revolving', 180, 500, 7]],
    inquiries: [['EQF', 1, true]],
  }),
  buildPack('07-no-scores-reported', {
    scores: {}, personalInfo: 'not_checkable',
    accounts: [['RETAIL CARD', 'revolving', 2100, 2500, 15], ['CREDIT UNION CARD', 'revolving', 40, 3000, 19]],
    inquiries: [],
  }),
  buildPack('08-collections-and-public-record', {
    scores: { EQF: 612, EXP: 604, TUC: 619 }, personalInfo: 'verified', collections: 2, publicRecords: 1,
    accounts: [['REWARDS CARD', 'revolving', 700, 4000, 55], ['DEPARTMENT STORE CARD', 'revolving', 0, 1000, 71, 'closed'], ['MEDICAL COLLECTION', 'other', 640, null, 18, 'negative'], ['AUTO LOAN', 'installment', 11200, null, 41], ['CREDIT UNION CARD', 'revolving', 220, 2500, 33]],
    inquiries: [['EQF', 5, true]],
  }),
  buildPack('09-brand-label-on-file', {
    scores: { EQF: 701, EXP: 698, TUC: 706 }, personalInfo: 'verified',
    accounts: [['CHASE FREEDOM', 'revolving', 3900, 6000, 38], ['DISCOVER IT', 'revolving', 200, 9000, 52], ['CREDIT UNION CARD', 'revolving', 0, 2000, 80], ['STUDENT LOAN', 'installment', 8100, null, 100]],
    inquiries: [['EXP', 2, true], ['EXP', 3, false]],
  }),
  buildPack('10-young-accounts', {
    scores: { EQF: 706, EXP: 711, TUC: 703 }, personalInfo: 'verified',
    accounts: [['REWARDS CARD', 'revolving', 350, 12000, 9], ['CREDIT UNION CARD', 'revolving', 120, 5000, 14], ['STORE CARD', 'revolving', 60, 1500, 6], ['AUTO LOAN', 'installment', 21000, null, 12]],
    inquiries: [['EQF', 9, true], ['EXP', 12, true], ['TUC', 6, true]],
  }),
  buildPack('11-inquiry-heavy', {
    scores: { EQF: 688, EXP: 693, TUC: 690 }, personalInfo: 'verified',
    accounts: [['REWARDS CARD', 'revolving', 1100, 11000, 61], ['CREDIT UNION CARD', 'revolving', 400, 7000, 45], ['STORE CARD', 'revolving', 0, 2000, 30], ['GAS CARD', 'revolving', 30, 800, 27]],
    inquiries: [['EQF', 1, false], ['EQF', 2, false], ['EQF', 3, true], ['EQF', 5, false], ['EXP', 1, false], ['EXP', 2, false], ['EXP', 4, false], ['TUC', 3, true]],
  }),
  buildPack('12-three-accounts-only', {
    scores: { EQF: 724, EXP: 731, TUC: 719 }, personalInfo: 'verified',
    accounts: [['REWARDS CARD', 'revolving', 800, 14000, 88], ['CREDIT UNION CARD', 'revolving', 150, 6000, 64], ['MORTGAGE', 'mortgage', 184000, null, 71]],
    inquiries: [],
  }),
  buildPack('13-small-limits-only', {
    scores: { EQF: 712, EXP: 709, TUC: 715 }, personalInfo: 'verified',
    accounts: [['STORE CARD', 'revolving', 200, 1500, 50], ['GAS CARD', 'revolving', 40, 800, 44], ['SECURED CARD', 'revolving', 90, 500, 62], ['CREDIT UNION CARD', 'revolving', 300, 4000, 39]],
    inquiries: [['TUC', 7, true]],
  }),
  buildPack('14-one-late-recent', {
    scores: { EQF: 677, EXP: 681, TUC: 670 }, personalInfo: 'verified',
    accounts: [['REWARDS CARD', 'revolving', 600, 10000, 57], ['CREDIT UNION CARD', 'revolving', 900, 8000, 63, 'late'], ['STORE CARD', 'revolving', 0, 2000, 49], ['AUTO LOAN', 'installment', 7400, null, 35]],
    inquiries: [['EQF', 4, true]],
  }),
  buildPack('15-past-due-installment', {
    scores: { EQF: 640, EXP: 652, TUC: 647 }, personalInfo: 'verified',
    accounts: [['REWARDS CARD', 'revolving', 2900, 10000, 66], ['CREDIT UNION CARD', 'revolving', 1700, 4000, 40], ['PERSONAL LOAN', 'installment', 5600, null, 20, 'late', 'pastdue:390'], ['STORE CARD', 'revolving', 110, 1200, 31]],
    inquiries: [['EXP', 6, true], ['TUC', 2, false]],
  }),
  buildPack('16-two-cards-over', {
    scores: { EQF: 703, EXP: 708, TUC: 701 }, personalInfo: 'verified',
    accounts: [['PLATINUM CARD', 'revolving', 7600, 12000, 74], ['REWARDS CARD', 'revolving', 4100, 6000, 52], ['CREDIT UNION CARD', 'revolving', 100, 5000, 47], ['GAS CARD', 'revolving', 20, 1000, 39], ['AUTO LOAN', 'installment', 3200, null, 58]],
    inquiries: [],
  }),
  buildPack('17-extra-addresses', {
    scores: { EQF: 731, EXP: 727, TUC: 735 }, personalInfo: 'not_checkable', identity: { names: 2, addresses: 4, employers: 3 },
    accounts: [['REWARDS CARD', 'revolving', 1500, 16000, 91], ['CREDIT UNION CARD', 'revolving', 300, 7000, 68], ['STORE CARD', 'revolving', 0, 3000, 55], ['MORTGAGE', 'mortgage', 265000, null, 77]],
    inquiries: [['EQF', 10, true]],
  }),
  buildPack('18-single-bureau-mixed', {
    scores: { TUC: 662 }, bureaus: ['TUC'], personalInfo: 'not_checkable',
    accounts: [['REWARDS CARD', 'revolving', 2600, 4000, 29], ['CREDIT UNION CARD', 'revolving', 500, 5000, 33], ['STORE CARD', 'revolving', 300, 1000, 12], ['AUTO LOAN', 'installment', 15300, null, 26]],
    inquiries: [['TUC', 1, false], ['TUC', 2, false], ['TUC', 4, true]],
  }),
  buildPack('19-unlabelled-accounts', {
    scores: { EQF: 695, EXP: 702, TUC: 699 }, personalInfo: 'verified',
    accounts: [[null, 'revolving', 2300, 3000, 44], [null, 'revolving', 100, 11000, 60], ['CREDIT UNION CARD', 'revolving', 0, 2500, 37], [null, 'installment', 4400, null, 29]],
    inquiries: [['EXP', 3, true]],
  }),
  buildPack('20-everything-wrong', {
    scores: { EQF: 548, EXP: 561, TUC: 552 }, personalInfo: 'not_checkable', identity: { names: 1, addresses: 3, employers: 2 }, collections: 1,
    accounts: [['STORE CARD', 'revolving', 1980, 2000, 8, 'late', 'pastdue:120'], ['GAS CARD', 'revolving', 700, 700, 6, 'late'], ['CHARGED OFF CARD', 'revolving', 1350, 1500, 30, 'closed', 'negative']],
    inquiries: [['EQF', 1, false], ['EQF', 2, false], ['EQF', 3, false], ['EXP', 1, false], ['EXP', 2, false], ['EXP', 3, false], ['TUC', 2, false]],
  }),
];
