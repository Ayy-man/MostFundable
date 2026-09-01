import {
  FUNDING_STAGES,
  type AffiliateShare,
  type ApplicationRecord,
  type FundingStage,
} from "@/lib/demo/types";

export const DEMO_TODAY = "2026-07-21";

export type OutcomePeriod = "30d" | "60d" | "90d" | "6mo" | "12mo";
export type MembershipStatus = "trial" | "current" | "deactivated";
export type BankMomentum = "hot" | "fair" | "cold";

export const OUTCOME_PERIODS: ReadonlyArray<{
  days: number;
  id: OutcomePeriod;
  label: string;
}> = [
  { id: "30d", label: "30 days", days: 30 },
  { id: "60d", label: "60 days", days: 60 },
  { id: "90d", label: "90 days", days: 90 },
  { id: "6mo", label: "6 months", days: 183 },
  { id: "12mo", label: "12 months", days: 365 },
];

const moneyFormatters = new Map<string, Intl.NumberFormat>();
const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export function formatDemoMoney(
  amount: number,
  options: { compact?: boolean; minimumFractionDigits?: number } = {},
) {
  const minimumFractionDigits = Math.min(
    options.minimumFractionDigits ?? 0,
    2,
  );
  const key = `${options.compact ? "compact" : "standard"}:${minimumFractionDigits}`;
  let formatter = moneyFormatters.get(key);

  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      currency: "USD",
      maximumFractionDigits: 2,
      minimumFractionDigits,
      notation: options.compact ? "compact" : "standard",
      style: "currency",
    });
    moneyFormatters.set(key, formatter);
  }

  return formatter.format(amount);
}

export function formatDemoNumber(value: number) {
  return numberFormatter.format(value);
}

export function formatDemoPercent(value: number) {
  return `${numberFormatter.format(value)}%`;
}

type DemoOperator = {
  additionalFees: number;
  clientCount: number;
  crsCostPerMonitoringMember: number;
  id: string;
  includedSeats: number;
  membership: MembershipStatus;
  monitoringMembers: number;
  monitoringPrice: number;
  monitoringSplitRate: number;
  name: string;
  nextAction: string;
  paymentStatus: "current" | "trial" | "deactivated";
  plan: "Agency" | "Pro" | "Trial";
  platformFee: number;
  referralSplit: number;
  seats: number;
  startedAt: string;
};

export const OPERATOR_FIXTURES: readonly DemoOperator[] = [
  {
    id: "op-apex",
    name: "Apex Funding Partners",
    startedAt: "2025-09-12",
    membership: "current",
    plan: "Agency",
    clientCount: 214,
    platformFee: 497,
    additionalFees: 58,
    includedSeats: 5,
    seats: 7,
    monitoringMembers: 168,
    monitoringPrice: 49,
    crsCostPerMonitoringMember: 12,
    // Illustrative only; the operator monitoring-share definition remains TBD.
    monitoringSplitRate: 0.4,
    referralSplit: 49.7,
    paymentStatus: "current",
    nextAction: "Renews Aug 1",
  },
  {
    id: "op-liberty",
    name: "Liberty Capital Group",
    startedAt: "2026-01-08",
    membership: "current",
    plan: "Pro",
    clientCount: 86,
    platformFee: 249,
    additionalFees: 0,
    includedSeats: 3,
    seats: 3,
    monitoringMembers: 59,
    monitoringPrice: 49,
    crsCostPerMonitoringMember: 12,
    monitoringSplitRate: 0.4,
    referralSplit: 24.9,
    paymentStatus: "current",
    nextAction: "Renews Aug 3",
  },
  {
    id: "op-northgate",
    name: "Northgate Advisors",
    startedAt: "2026-07-10",
    membership: "trial",
    plan: "Trial",
    clientCount: 12,
    platformFee: 0,
    additionalFees: 0,
    includedSeats: 2,
    seats: 2,
    monitoringMembers: 0,
    monitoringPrice: 49,
    crsCostPerMonitoringMember: 12,
    monitoringSplitRate: 0.4,
    referralSplit: 0,
    paymentStatus: "trial",
    nextAction: "Trial review Jul 24",
  },
  {
    id: "op-summit",
    name: "Summit Advisory Co",
    startedAt: "2025-11-04",
    membership: "deactivated",
    plan: "Pro",
    clientCount: 41,
    platformFee: 0,
    additionalFees: 0,
    includedSeats: 3,
    seats: 3,
    monitoringMembers: 0,
    monitoringPrice: 49,
    crsCostPerMonitoringMember: 12,
    monitoringSplitRate: 0.4,
    referralSplit: 0,
    paymentStatus: "deactivated",
    nextAction: "No billing action",
  },
];

export type DemoClient = {
  affiliateId: string | null;
  business: string;
  clientId: string;
  email: string;
  fundedAmount: number;
  fundingGoal: number;
  name: string;
  operatorId: string;
  ownerId: string;
  phone: string;
  profileCompletion: number;
  stage: FundingStage;
  startedAt: string;
};

export const DEMO_CLIENTS: readonly DemoClient[] = [
  { clientId: "c1", name: "Marcus Webb", business: "Webb Electrical", email: "marcus@webbelectrical.co", phone: "(555) 010-2201", operatorId: "op-apex", ownerId: "tm-alec", affiliateId: "aff-summit", startedAt: "2026-05-12", stage: "Optimization", profileCompletion: 54, fundingGoal: 40000, fundedAmount: 0 },
  { clientId: "c2", name: "Priya Cho", business: "Cho Bakery", email: "priya@chobakery.co", phone: "(555) 010-2202", operatorId: "op-apex", ownerId: "tm-alec", affiliateId: null, startedAt: "2026-04-28", stage: "Optimization", profileCompletion: 58, fundingGoal: 30000, fundedAmount: 0 },
  { clientId: "c3", name: "Luis Herrera", business: "Herrera Roofing", email: "luis@herreraroofing.co", phone: "(555) 010-2203", operatorId: "op-apex", ownerId: "tm-marcus", affiliateId: "aff-summit", startedAt: "2026-02-09", stage: "Funded", profileCompletion: 100, fundingGoal: 50000, fundedAmount: 45000 },
  { clientId: "c4", name: "Tasha Nguyen", business: "Nguyen Logistics", email: "tasha@nguyenlogistics.co", phone: "(555) 010-2204", operatorId: "op-apex", ownerId: "tm-alec", affiliateId: "aff-northstar", startedAt: "2026-03-03", stage: "Applying", profileCompletion: 100, fundingGoal: 60000, fundedAmount: 0 },
  { clientId: "c5", name: "Maya Okafor", business: "Okafor Design Co", email: "maya@okafor.co", phone: "(555) 010-2210", operatorId: "op-apex", ownerId: "tm-dana", affiliateId: "aff-northstar", startedAt: "2026-06-20", stage: "Optimization", profileCompletion: 62, fundingGoal: 75000, fundedAmount: 0 },
  { clientId: "c6", name: "Amara Sow", business: "Sow Wellness Studio", email: "amara@sowwellness.co", phone: "(555) 010-1006", operatorId: "op-apex", ownerId: "tm-sam", affiliateId: "aff-summit", startedAt: "2026-03-22", stage: "Ready", profileCompletion: 100, fundingGoal: 40000, fundedAmount: 0 },
  { clientId: "c7", name: "Jordan Ellis", business: "Ellis Catering", email: "jordan@elliscatering.co", phone: "(555) 010-2207", operatorId: "op-apex", ownerId: "tm-dana", affiliateId: null, startedAt: "2026-05-30", stage: "Optimization", profileCompletion: 66, fundingGoal: 45000, fundedAmount: 0 },
  { clientId: "c8", name: "Elena Petrov", business: "Petrov Dental", email: "elena@petrovdental.co", phone: "(555) 010-2208", operatorId: "op-apex", ownerId: "tm-marcus", affiliateId: "aff-northstar", startedAt: "2025-11-10", stage: "Graduate", profileCompletion: 100, fundingGoal: 125000, fundedAmount: 150000 },
];

export const BANK_FIXTURES = [
  { id: "bluevine", name: "Bluevine", products: ["Business line of credit", "Term loan"], bureauPulls: "Experian business", qualificationSummary: "Business banking history and current revenue evidence" },
  { id: "chase-ink", name: "Chase Ink", products: ["Business credit card"], bureauPulls: "Experian personal", qualificationSummary: "Business identity, issuer relationship, and application timing" },
  { id: "amex-business", name: "Amex Business", products: ["Business credit card", "Term loan"], bureauPulls: "Experian personal and business", qualificationSummary: "Current account profile and business cash-flow evidence" },
  { id: "us-bank", name: "US Bank", products: ["Business line of credit", "Business credit card"], bureauPulls: "TransUnion personal", qualificationSummary: "Business banking relationship and complete company records" },
  { id: "wells-fargo", name: "Wells Fargo", products: ["Term loan", "Business line of credit"], bureauPulls: "Experian business", qualificationSummary: "Complete financial records and relationship context" },
  { id: "pnc", name: "PNC", products: ["Business credit card", "Term loan"], bureauPulls: "Equifax business", qualificationSummary: "Business banking history and documented revenue" },
  { id: "td-bank", name: "TD Bank", products: ["Revenue-based funding"], bureauPulls: "Experian business", qualificationSummary: "Current deposits and operating revenue" },
] as const;

export const INITIAL_APPLICATION_RECORDS: readonly ApplicationRecord[] = [
  {
    id: "app-c3-bluevine",
    clientId: "c3",
    clientName: "Luis Herrera",
    operatorId: "op-apex",
    bankId: "bluevine",
    bankName: "Bluevine",
    product: "Business line of credit",
    sequence: 1,
    operatorStatus: "done",
    outcome: "approved",
    approvedAmount: 45000,
    outcomeRecordedAt: "2026-07-20",
    outcomeRecordedBy: "operator",
    criteriaSummary: "5 of 5 criteria met",
    applicationProcess: ["Confirm the current plan", "Submit from the approved sequence", "Record the result"],
    sourceUpdatedAt: "2026-07-20",
    notes: [{ id: "note-c3-1", authorName: "Marcus Cole", authorRole: "operator", body: "Result recorded after the client confirmed the funded amount.", createdAt: "Jul 20 · 4:15 PM" }],
  },
  {
    id: "app-c4-us-bank",
    clientId: "c4",
    clientName: "Tasha Nguyen",
    operatorId: "op-apex",
    bankId: "us-bank",
    bankName: "US Bank",
    product: "Business line of credit",
    sequence: 1,
    operatorStatus: "to-do",
    outcome: "pending",
    approvedAmount: null,
    outcomeRecordedAt: "2026-07-14",
    outcomeRecordedBy: "consumer",
    criteriaSummary: "5 of 5 criteria met",
    applicationProcess: ["Confirm the application packet", "Submit from the approved sequence", "Record the result"],
    sourceUpdatedAt: "2026-07-14",
    notes: [{ id: "note-c4-1", authorName: "Tasha Nguyen", authorRole: "consumer", body: "Submitted on Jul 14. I will update this tab when the bank responds.", createdAt: "Jul 14 · 2:08 PM" }],
  },
  {
    id: "app-c4-bluevine",
    clientId: "c4",
    clientName: "Tasha Nguyen",
    operatorId: "op-apex",
    bankId: "bluevine",
    bankName: "Bluevine",
    product: "Business line of credit",
    sequence: 2,
    operatorStatus: "wait",
    outcome: null,
    approvedAmount: null,
    outcomeRecordedAt: null,
    outcomeRecordedBy: null,
    criteriaSummary: "5 of 5 criteria met",
    applicationProcess: ["Wait for the first result", "Reconfirm the current plan", "Record the result"],
    sourceUpdatedAt: "2026-07-18",
    notes: [],
  },
  {
    id: "app-c5-bluevine",
    clientId: "c5",
    clientName: "Maya Okafor",
    operatorId: "op-apex",
    bankId: "bluevine",
    bankName: "Bluevine",
    product: "Business line of credit",
    sequence: 1,
    operatorStatus: "wait",
    outcome: null,
    approvedAmount: null,
    outcomeRecordedAt: null,
    outcomeRecordedBy: null,
    criteriaSummary: "3 of 5 criteria met",
    applicationProcess: ["Complete the Cinderella profile", "Review the sequence with the funding team", "Record the result"],
    sourceUpdatedAt: "2026-07-14",
    notes: [],
  },
  {
    id: "app-c6-bluevine",
    clientId: "c6",
    clientName: "Amara Sow",
    operatorId: "op-apex",
    bankId: "bluevine",
    bankName: "Bluevine",
    product: "Business line of credit",
    sequence: 1,
    operatorStatus: "to-do",
    outcome: null,
    approvedAmount: null,
    outcomeRecordedAt: null,
    outcomeRecordedBy: null,
    criteriaSummary: "5 of 5 criteria met",
    applicationProcess: ["Confirm the current application packet", "Submit from the approved sequence", "Record the result"],
    sourceUpdatedAt: "2026-07-18",
    notes: [{ id: "note-c6-1", authorName: "Sam Ortiz", authorRole: "operator", body: "The application packet is ready for your review.", createdAt: "Jul 18 · 11:20 AM" }],
  },
  {
    id: "app-c6-us-bank",
    clientId: "c6",
    clientName: "Amara Sow",
    operatorId: "op-apex",
    bankId: "us-bank",
    bankName: "US Bank",
    product: "Business credit card",
    sequence: 2,
    operatorStatus: "wait",
    outcome: null,
    approvedAmount: null,
    outcomeRecordedAt: null,
    outcomeRecordedBy: null,
    criteriaSummary: "4 of 5 criteria met",
    applicationProcess: ["Wait for the first result", "Confirm the current criteria", "Record the result"],
    sourceUpdatedAt: "2026-07-17",
    notes: [],
  },
  {
    id: "app-c8-amex-business",
    clientId: "c8",
    clientName: "Elena Petrov",
    operatorId: "op-apex",
    bankId: "amex-business",
    bankName: "Amex Business",
    product: "Term loan",
    sequence: 1,
    operatorStatus: "done",
    outcome: "approved",
    approvedAmount: 90000,
    outcomeRecordedAt: "2025-12-08",
    outcomeRecordedBy: "operator",
    criteriaSummary: "5 of 5 criteria met",
    applicationProcess: ["Confirm the current plan", "Submit from the approved sequence", "Record the result"],
    sourceUpdatedAt: "2025-12-08",
    notes: [{ id: "note-c8-1", authorName: "Marcus Cole", authorRole: "operator", body: "Result recorded after the client confirmed the funded amount.", createdAt: "Dec 8 · 3:40 PM" }],
  },
  {
    id: "app-c8-wells-fargo",
    clientId: "c8",
    clientName: "Elena Petrov",
    operatorId: "op-apex",
    bankId: "wells-fargo",
    bankName: "Wells Fargo",
    product: "Business line of credit",
    sequence: 2,
    operatorStatus: "done",
    outcome: "approved",
    approvedAmount: 60000,
    outcomeRecordedAt: "2026-01-15",
    outcomeRecordedBy: "consumer",
    criteriaSummary: "5 of 5 criteria met",
    applicationProcess: ["Reconfirm the current plan", "Submit from the approved sequence", "Record the result"],
    sourceUpdatedAt: "2026-01-15",
    notes: [{ id: "note-c8-2", authorName: "Elena Petrov", authorRole: "consumer", body: "Second facility confirmed. That completes the sequence we planned.", createdAt: "Jan 15 · 9:12 AM" }],
  },
];

export const INITIAL_AFFILIATE_SHARES: readonly AffiliateShare[] = [
  { id: "share-c1", affiliateId: "aff-summit", affiliateName: "Summit Referral Network", clientId: "c1", expectedCommission: 750, paymentStatus: "not-ready", sharedAt: "2026-05-12" },
  { id: "share-c3", affiliateId: "aff-summit", affiliateName: "Summit Referral Network", clientId: "c3", expectedCommission: 1250, paymentStatus: "pending", sharedAt: "2026-02-09" },
  { id: "share-c4", affiliateId: "aff-northstar", affiliateName: "Northstar Partners", clientId: "c4", expectedCommission: 1000, paymentStatus: "not-ready", sharedAt: "2026-03-03" },
  { id: "share-c5", affiliateId: "aff-northstar", affiliateName: "Northstar Partners", clientId: "c5", expectedCommission: 900, paymentStatus: "not-ready", sharedAt: "2026-06-20" },
  { id: "share-c6", affiliateId: "aff-summit", affiliateName: "Summit Referral Network", clientId: "c6", expectedCommission: 800, paymentStatus: "not-ready", sharedAt: "2026-03-22" },
  { id: "share-c8", affiliateId: "aff-northstar", affiliateName: "Northstar Partners", clientId: "c8", expectedCommission: 1800, paymentStatus: "paid", sharedAt: "2025-11-10" },
];

type BankOutcomeBatch = {
  approvals: number;
  bankId: string;
  fundedAmount: number;
  fundedCount: number;
  id: string;
  operatorId: string;
  outcomes: number;
  recordedAt: string;
};

export const BANK_OUTCOME_BATCHES: readonly BankOutcomeBatch[] = [
  { id: "b01", operatorId: "op-apex", bankId: "bluevine", recordedAt: "2026-01-31", outcomes: 18, approvals: 12, fundedCount: 8, fundedAmount: 300000 },
  { id: "b02", operatorId: "op-liberty", bankId: "us-bank", recordedAt: "2026-01-31", outcomes: 7, approvals: 4, fundedCount: 2, fundedAmount: 70000 },
  { id: "b03", operatorId: "op-summit", bankId: "pnc", recordedAt: "2026-01-31", outcomes: 4, approvals: 2, fundedCount: 1, fundedAmount: 20000 },
  { id: "b04", operatorId: "op-apex", bankId: "chase-ink", recordedAt: "2026-02-28", outcomes: 19, approvals: 11, fundedCount: 9, fundedAmount: 320000 },
  { id: "b05", operatorId: "op-liberty", bankId: "wells-fargo", recordedAt: "2026-02-28", outcomes: 8, approvals: 4, fundedCount: 3, fundedAmount: 80000 },
  { id: "b06", operatorId: "op-summit", bankId: "td-bank", recordedAt: "2026-02-28", outcomes: 5, approvals: 2, fundedCount: 1, fundedAmount: 25000 },
  { id: "b07", operatorId: "op-apex", bankId: "amex-business", recordedAt: "2026-03-31", outcomes: 20, approvals: 13, fundedCount: 10, fundedAmount: 340000 },
  { id: "b08", operatorId: "op-liberty", bankId: "bluevine", recordedAt: "2026-03-31", outcomes: 9, approvals: 6, fundedCount: 3, fundedAmount: 90000 },
  { id: "b09", operatorId: "op-summit", bankId: "pnc", recordedAt: "2026-03-31", outcomes: 5, approvals: 2, fundedCount: 1, fundedAmount: 30000 },
  { id: "b10", operatorId: "op-apex", bankId: "bluevine", recordedAt: "2026-04-30", outcomes: 22, approvals: 15, fundedCount: 10, fundedAmount: 360000 },
  { id: "b11", operatorId: "op-liberty", bankId: "us-bank", recordedAt: "2026-04-30", outcomes: 10, approvals: 6, fundedCount: 4, fundedAmount: 100000 },
  { id: "b12", operatorId: "op-summit", bankId: "td-bank", recordedAt: "2026-04-30", outcomes: 5, approvals: 2, fundedCount: 1, fundedAmount: 25000 },
  { id: "b13", operatorId: "op-apex", bankId: "chase-ink", recordedAt: "2026-05-31", outcomes: 23, approvals: 14, fundedCount: 11, fundedAmount: 380000 },
  { id: "b14", operatorId: "op-liberty", bankId: "wells-fargo", recordedAt: "2026-05-31", outcomes: 11, approvals: 6, fundedCount: 4, fundedAmount: 110000 },
  { id: "b15", operatorId: "op-summit", bankId: "pnc", recordedAt: "2026-05-31", outcomes: 6, approvals: 2, fundedCount: 1, fundedAmount: 30000 },
  { id: "b16", operatorId: "op-apex", bankId: "amex-business", recordedAt: "2026-06-30", outcomes: 24, approvals: 16, fundedCount: 12, fundedAmount: 400000 },
  { id: "b17", operatorId: "op-liberty", bankId: "bluevine", recordedAt: "2026-06-30", outcomes: 10, approvals: 7, fundedCount: 3, fundedAmount: 90000 },
  { id: "b18", operatorId: "op-summit", bankId: "td-bank", recordedAt: "2026-06-30", outcomes: 5, approvals: 2, fundedCount: 1, fundedAmount: 25000 },
  { id: "b19", operatorId: "op-apex", bankId: "bluevine", recordedAt: "2026-07-18", outcomes: 17, approvals: 12, fundedCount: 7, fundedAmount: 255000 },
  { id: "b20", operatorId: "op-liberty", bankId: "us-bank", recordedAt: "2026-07-18", outcomes: 8, approvals: 5, fundedCount: 3, fundedAmount: 70000 },
  { id: "b21", operatorId: "op-summit", bankId: "pnc", recordedAt: "2026-07-18", outcomes: 4, approvals: 1, fundedCount: 1, fundedAmount: 25000 },
];

export const OPERATOR_PIPELINE = FUNDING_STAGES.map((stage, index) => ({
  count: [18, 92, 34, 28, 24, 18][index],
  stage,
}));

function deriveActiveClientCount() {
  const graduateIndex = FUNDING_STAGES.indexOf("Graduate");

  return sum(
    OPERATOR_PIPELINE.slice(0, graduateIndex).map(({ count }) => count),
  );
}

export const TEAM_MEMBERS = [
  { id: "tm-alec", name: "Alec Rivera", role: "Owner" },
  { id: "tm-dana", name: "Dana Whitfield", role: "Prep specialist" },
  { id: "tm-marcus", name: "Marcus Cole", role: "Funding specialist" },
  { id: "tm-sam", name: "Sam Ortiz", role: "Client success specialist" },
  { id: "tm-naomi", name: "Naomi Feld", role: "Manager" },
] as const;

export const TEAM_PERFORMANCE_RECORDS = [
  { id: "perf-1", memberId: "tm-alec", completedAt: "2026-07-18", optimizationDays: 42, fundingAmount: 52000, graduationDays: 88, clientRevenue: 5200 },
  { id: "perf-2", memberId: "tm-alec", completedAt: "2026-06-29", optimizationDays: 36, fundingAmount: 38000, graduationDays: 79, clientRevenue: 3800 },
  { id: "perf-3", memberId: "tm-dana", completedAt: "2026-07-11", optimizationDays: 31, fundingAmount: 0, graduationDays: null, clientRevenue: 1200 },
  { id: "perf-4", memberId: "tm-dana", completedAt: "2026-06-14", optimizationDays: 35, fundingAmount: 28000, graduationDays: 74, clientRevenue: 2800 },
  { id: "perf-5", memberId: "tm-marcus", completedAt: "2026-07-20", optimizationDays: 29, fundingAmount: 45000, graduationDays: 66, clientRevenue: 4500 },
  { id: "perf-6", memberId: "tm-marcus", completedAt: "2026-05-28", optimizationDays: 34, fundingAmount: 67000, graduationDays: 82, clientRevenue: 6700 },
  { id: "perf-7", memberId: "tm-sam", completedAt: "2026-07-03", optimizationDays: 40, fundingAmount: 33000, graduationDays: 91, clientRevenue: 3300 },
  { id: "perf-8", memberId: "tm-sam", completedAt: "2026-05-09", optimizationDays: 44, fundingAmount: 0, graduationDays: null, clientRevenue: 900 },
] as const;

export const CLIENT_FEE_RECORDS = [
  { clientId: "c1", model: "unconfigured", fundedAmount: 0, totalFee: 0, paid: 0 },
  { clientId: "c2", model: "custom", fundedAmount: 0, totalFee: 1500, paid: 500 },
  { clientId: "c3", model: "percent", fundedAmount: 45000, totalFee: 4500, paid: 2500 },
  { clientId: "c4", model: "percent", fundedAmount: 0, totalFee: 0, paid: 0 },
  { clientId: "c5", model: "unconfigured", fundedAmount: 0, totalFee: 0, paid: 0 },
  { clientId: "c6", model: "percent", fundedAmount: 0, totalFee: 0, paid: 0 },
  { clientId: "c7", model: "custom", fundedAmount: 0, totalFee: 900, paid: 900 },
  { clientId: "c8", model: "percent", fundedAmount: 150000, totalFee: 15000, paid: 15000 },
] as const;

export const CLIENT_PLATFORM_PLAN_RECORDS = [
  { clientId: "c1", lastPayment: "Jun 21 · payment failed", status: "overdue" },
  { clientId: "c2", lastPayment: "Jul 18", status: "active" },
  { clientId: "c3", lastPayment: "Jul 09", status: "active" },
  { clientId: "c4", lastPayment: "Jul 03", status: "active" },
  { clientId: "c5", lastPayment: "Jul 20", status: "active" },
  { clientId: "c6", lastPayment: "Jul 12", status: "active" },
  { clientId: "c7", lastPayment: "Jul 15", status: "active" },
  { clientId: "c8", lastPayment: "Jul 10", status: "active" },
] as const;

export const TRAINING_FIXTURES = [
  { id: "tr-1", title: "Build a complete application packet", audience: "client-facing", source: "YouTube", videoUrl: "https://www.youtube.com/embed/aqz-KE-bpKQ", summary: "A guided review of the documents used in an application sequence." },
  { id: "tr-2", title: "Reading BANK VAULT outcome history", audience: "platform-training", source: "Vimeo", videoUrl: "https://player.vimeo.com/video/76979871", summary: "How operators use dated historical outcomes without treating them as offers." },
  { id: "tr-3", title: "Run the readiness review", audience: "platform-training", source: "Loom", videoUrl: "https://www.loom.com/embed/5b1f7b3c6c8d4fca8c0e78a5a1f0e001", summary: "A concise walkthrough for a consistent client review." },
] as const;

export const TASK_FIXTURES = [
  { id: "task-1", title: "Review Priya's Team chat draft", status: "pending", priority: "high", type: "Message", assignee: "Alec Rivera", dueAt: "Today" },
  { id: "task-2", title: "Confirm Amara's application packet", status: "pending", priority: "high", type: "Application", assignee: "Sam Ortiz", dueAt: "Today" },
  { id: "task-3", title: "Follow up on Tasha's result", status: "overdue", priority: "high", type: "Outcome", assignee: "Alec Rivera", dueAt: "Jul 20" },
  { id: "task-4", title: "Review Maya's business documents", status: "pending", priority: "medium", type: "Document", assignee: "Dana Whitfield", dueAt: "Jul 22" },
  { id: "task-5", title: "Update Luis's fee payment", status: "completed", priority: "medium", type: "Fee", assignee: "Marcus Cole", dueAt: "Jul 20" },
  { id: "task-6", title: "Prepare the weekly client review", status: "completed", priority: "low", type: "Workspace", assignee: "Naomi Feld", dueAt: "Jul 19" },
] as const;

export const USER_ACTIVITY_SEGMENTS = [
  { segment: "Consumers", activeUsers: 52 },
  { segment: "Operators", activeUsers: 14 },
  { segment: "Platform team", activeUsers: 3 },
  { segment: "Affiliates", activeUsers: 2 },
] as const;

export const TRIAL_RECORDS = [
  true, true, true, true, true, true, true, false, false, false,
] as const;

export const MEMBERSHIP_PERIODS = [
  { startedAt: "2025-09-12", endedAt: null },
  { startedAt: "2026-01-08", endedAt: null },
  { startedAt: "2026-07-10", endedAt: null },
  { startedAt: "2025-11-04", endedAt: "2026-06-18" },
  { startedAt: "2026-02-05", endedAt: "2026-03-02" },
  { startedAt: "2026-04-11", endedAt: "2026-05-29" },
] as const;

export const ANALYSIS_USAGE = [
  { operatorId: "op-apex", count: 412 },
  { operatorId: "op-liberty", count: 176 },
  { operatorId: "op-northgate", count: 22 },
  { operatorId: "op-summit", count: 0 },
] as const;

export const OPERATOR_BOOK_RECORDS = [
  { operatorId: "op-apex", clientsAddedThisQuarter: 16, fundingReadyDays: 34 },
  { operatorId: "op-liberty", clientsAddedThisQuarter: 10, fundingReadyDays: 41 },
  { operatorId: "op-northgate", clientsAddedThisQuarter: 5, fundingReadyDays: 52 },
  { operatorId: "op-summit", clientsAddedThisQuarter: 0, fundingReadyDays: 47 },
] as const;

export const OPTIMIZATION_TASK_DURATIONS = [
  { task: "Open a net-30 vendor account", averageOpenDays: 38 },
  { task: "Reduce revolving utilization", averageOpenDays: 31 },
  { task: "Upload current bank statements", averageOpenDays: 12 },
] as const;

function isoTime(date: string) {
  return Date.parse(`${date}T00:00:00Z`);
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function roundTwo(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function average(values: readonly number[]) {
  return values.length ? roundTwo(sum(values) / values.length) : 0;
}

export function deriveClientFundedAmount(
  clientId: string,
  trackedApplicationAmount: number,
) {
  const bookedAmount =
    DEMO_CLIENTS.find((client) => client.clientId === clientId)?.fundedAmount ??
    0;

  return roundTwo(Math.max(bookedAmount, trackedApplicationAmount));
}

function applicationFunding(
  applications: readonly ApplicationRecord[],
  operatorId?: string,
) {
  return sum(
    applications
      .filter(
        (application) =>
          application.outcome === "approved" &&
          application.approvedAmount !== null &&
          (!operatorId || application.operatorId === operatorId),
      )
      .map((application) => application.approvedAmount ?? 0),
  );
}

export function deriveFundedVolume(
  applications: readonly ApplicationRecord[] = INITIAL_APPLICATION_RECORDS,
) {
  const byMonth = new Map<string, number>();

  for (const batch of BANK_OUTCOME_BATCHES) {
    const month = batch.recordedAt.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + batch.fundedAmount);
  }

  for (const application of applications) {
    if (
      application.outcome !== "approved" ||
      application.approvedAmount === null ||
      !application.outcomeRecordedAt
    ) {
      continue;
    }
    const month = application.outcomeRecordedAt.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + application.approvedAmount);
  }

  return [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, amount]) => ({ amount, month }));
}

export function deriveFundedVolumeWeekly(
  applications: readonly ApplicationRecord[] = INITIAL_APPLICATION_RECORDS,
  weeks = 5,
) {
  const dayMs = 24 * 60 * 60 * 1000;
  const today = isoTime(DEMO_TODAY);
  const buckets = Array.from({ length: weeks }, (_, index) => {
    const start = today - (weeks - index) * 7 * dayMs + dayMs;
    return { amount: 0, start };
  });

  function add(recordedAt: string, amount: number) {
    const time = isoTime(recordedAt);
    for (const bucket of buckets) {
      if (time >= bucket.start && time < bucket.start + 7 * dayMs) {
        bucket.amount += amount;
        return;
      }
    }
  }

  for (const batch of BANK_OUTCOME_BATCHES) {
    add(batch.recordedAt, batch.fundedAmount);
  }
  for (const application of applications) {
    if (
      application.outcome === "approved" &&
      application.approvedAmount !== null &&
      application.outcomeRecordedAt
    ) {
      add(application.outcomeRecordedAt, application.approvedAmount);
    }
  }

  return buckets.map((bucket) => ({
    amount: bucket.amount,
    weekStart: new Date(bucket.start).toISOString().slice(0, 10),
  }));
}

export function deriveOperatorFundedYtd(
  operatorId: string,
  applications: readonly ApplicationRecord[] = INITIAL_APPLICATION_RECORDS,
) {
  const historical = sum(
    BANK_OUTCOME_BATCHES.filter(
      (batch) =>
        batch.operatorId === operatorId &&
        batch.recordedAt.startsWith(DEMO_TODAY.slice(0, 4)),
    ).map((batch) => batch.fundedAmount),
  );
  return historical + applicationFunding(applications, operatorId);
}

export function deriveOperatorFundedAllTime(
  operatorId: string,
  applications: readonly ApplicationRecord[] = INITIAL_APPLICATION_RECORDS,
) {
  const historical = sum(
    BANK_OUTCOME_BATCHES.filter(
      (batch) => batch.operatorId === operatorId,
    ).map((batch) => batch.fundedAmount),
  );
  return historical + applicationFunding(applications, operatorId);
}

export function deriveOperatorAverageFundedOutcome(
  operatorId: string,
  applications: readonly ApplicationRecord[] = INITIAL_APPLICATION_RECORDS,
) {
  const batches = BANK_OUTCOME_BATCHES.filter(
    (batch) => batch.operatorId === operatorId,
  );
  const approvedApplications = applications.filter(
    (application) =>
      application.operatorId === operatorId &&
      application.outcome === "approved" &&
      application.approvedAmount !== null,
  );
  const fundedCount =
    sum(batches.map((batch) => batch.fundedCount)) +
    approvedApplications.length;
  const fundedAmount =
    sum(batches.map((batch) => batch.fundedAmount)) +
    sum(
      approvedApplications.map(
        (application) => application.approvedAmount ?? 0,
      ),
    );

  return fundedCount ? roundTwo(fundedAmount / fundedCount) : 0;
}

export function deriveOperatorFundingReadyDays(operatorId: string) {
  return (
    OPERATOR_BOOK_RECORDS.find((record) => record.operatorId === operatorId)
      ?.fundingReadyDays ?? 0
  );
}

export function deriveOperatorCashCollectedAllTime(operatorId: string) {
  const operatorClientIds = new Set(
    DEMO_CLIENTS.filter((client) => client.operatorId === operatorId).map(
      (client) => client.clientId,
    ),
  );

  return sum(
    CLIENT_FEE_RECORDS.filter((record) =>
      operatorClientIds.has(record.clientId),
    ).map((record) => record.paid),
  );
}

export function deriveAnalysisCreditsUsed(operatorId?: string) {
  return sum(
    ANALYSIS_USAGE.filter(
      (entry) => !operatorId || entry.operatorId === operatorId,
    ).map((entry) => entry.count),
  );
}

export function deriveAdminOverview(
  applications: readonly ApplicationRecord[] = INITIAL_APPLICATION_RECORDS,
) {
  const currentPlanOperators = OPERATOR_FIXTURES.filter(
    (operator) => operator.membership === "current",
  );
  return {
    operators: OPERATOR_FIXTURES.length,
    consumers: sum(OPERATOR_FIXTURES.map((operator) => operator.clientCount)),
    operatorsActivePlan: currentPlanOperators.length,
    consumersActivePlan: CLIENT_PLATFORM_PLAN_RECORDS.filter(
      (record) => record.status === "active",
    ).length,
    fundedAllTime: sum(
      OPERATOR_FIXTURES.map((operator) =>
        deriveOperatorFundedAllTime(operator.id, applications),
      ),
    ),
    fundedYtd: sum(
      OPERATOR_FIXTURES.map((operator) =>
        deriveOperatorFundedYtd(operator.id, applications),
      ),
    ),
    cashAllTime: sum(
      OPERATOR_FIXTURES.map((operator) =>
        deriveOperatorCashCollectedAllTime(operator.id),
      ),
    ),
    analysisCreditsUsed: deriveAnalysisCreditsUsed(),
    analyses: sum(ANALYSIS_USAGE.map((entry) => entry.count)),
  };
}

export function deriveSaasMetrics() {
  const platformMrr = sum(
    OPERATOR_FIXTURES.map(
      (operator) => operator.platformFee + operator.additionalFees,
    ),
  );
  const monitoringRevenue = sum(
    OPERATOR_FIXTURES.map(
      (operator) => operator.monitoringMembers * operator.monitoringPrice,
    ),
  );
  const monitoringCost = sum(
    OPERATOR_FIXTURES.map(
      (operator) =>
        operator.monitoringMembers * operator.crsCostPerMonitoringMember,
    ),
  );
  const operatorMonitoringSplit = sum(
    OPERATOR_FIXTURES.map(
      (operator) =>
        operator.monitoringMembers *
        operator.monitoringPrice *
        operator.monitoringSplitRate,
    ),
  );

  return {
    monthlyRecurringTotal: roundTwo(platformMrr + monitoringRevenue),
    platformMrr,
    monitoringProfit: roundTwo(
      monitoringRevenue - monitoringCost - operatorMonitoringSplit,
    ),
    referralSplit: roundTwo(
      sum(OPERATOR_FIXTURES.map((operator) => operator.referralSplit)),
    ),
    monitoringRevenue,
    monitoringCost,
    operatorMonitoringSplit: roundTwo(operatorMonitoringSplit),
  };
}

export function deriveOperatorBillingRows() {
  return OPERATOR_FIXTURES.map((operator) => ({
    ...operator,
    payment: operator.platformFee + operator.additionalFees,
  }));
}

export function deriveAnalyticsMetrics() {
  const activeOperators = OPERATOR_FIXTURES.filter(
    (operator) => operator.membership !== "deactivated",
  );
  const convertedTrials = TRIAL_RECORDS.filter(Boolean).length;
  const membershipDays = MEMBERSHIP_PERIODS.map((period) => {
    const end = isoTime(period.endedAt ?? DEMO_TODAY);
    return Math.max(1, Math.round((end - isoTime(period.startedAt)) / 86400000));
  });
  const saas = deriveSaasMetrics();

  return {
    activeUsers: sum(USER_ACTIVITY_SEGMENTS.map((segment) => segment.activeUsers)),
    operators: OPERATOR_FIXTURES.length,
    currentMonitoring: sum(
      OPERATOR_FIXTURES.map((operator) => operator.monitoringMembers),
    ),
    trialConversion: roundTwo(
      (convertedTrials / TRIAL_RECORDS.length) * 100,
    ),
    averageMonthlyPlan: roundTwo(saas.platformMrr / activeOperators.length),
    averageMembershipDays: average(membershipDays),
  };
}

export function deriveAdminBookStats(
  applications: readonly ApplicationRecord[] = INITIAL_APPLICATION_RECORDS,
) {
  const overview = deriveAdminOverview(applications);
  const fundedByMonth = deriveFundedVolume(applications);
  const previousMonth = new Date(`${DEMO_TODAY}T00:00:00Z`);
  previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
  const previousMonthKey = previousMonth.toISOString().slice(0, 7);
  const biggestOptimizationBottleneck = [...OPTIMIZATION_TASK_DURATIONS].sort(
    (left, right) => right.averageOpenDays - left.averageOpenDays,
  )[0];

  return {
    clientGrowthThisQuarter: sum(
      OPERATOR_BOOK_RECORDS.map((record) => record.clientsAddedThisQuarter),
    ),
    averageFundingReadyDays: average(
      OPERATOR_BOOK_RECORDS.map((record) => record.fundingReadyDays),
    ),
    averageFundingPerConsumer: overview.consumers
      ? roundTwo(overview.fundedAllTime / overview.consumers)
      : 0,
    biggestOptimizationBottleneck,
    topBanks: deriveBankHistoricalStats("12mo", applications)
      .sort(
        (left, right) =>
          right.fundedAmount - left.fundedAmount ||
          left.bankName.localeCompare(right.bankName),
      )
      .slice(0, 5)
      .map((bank) => ({
        bankId: bank.bankId,
        bankName: bank.bankName,
        fundedAmount: bank.fundedAmount,
      })),
    fundingThisYear: overview.fundedYtd,
    previousMonthFunded:
      fundedByMonth.find((entry) => entry.month === previousMonthKey)?.amount ??
      0,
  };
}

export type TeamPerformanceMetric = {
  averageFundingPerClient: number;
  averageGraduationDays: number;
  averageOptimizationDays: number;
  memberId: string;
  memberName: string;
  totalClientRevenue: number;
};

export function deriveTeamPerformance(): TeamPerformanceMetric[] {
  return TEAM_MEMBERS.map((member) => {
    const records = TEAM_PERFORMANCE_RECORDS.filter(
      (record) => record.memberId === member.id,
    );
    const graduated = records.reduce<number[]>((days, record) => {
      if (record.graduationDays !== null) days.push(record.graduationDays);
      return days;
    }, []);

    return {
      memberId: member.id,
      memberName: member.name,
      averageOptimizationDays: average(
        records.map((record) => record.optimizationDays),
      ),
      averageFundingPerClient: average(
        records.map((record) => record.fundingAmount),
      ),
      averageGraduationDays: average(graduated),
      totalClientRevenue: sum(records.map((record) => record.clientRevenue)),
    };
  });
}

export function deriveOperatorHomeMetrics(
  operatorId = "op-apex",
  applications: readonly ApplicationRecord[] = INITIAL_APPLICATION_RECORDS,
) {
  const operator = OPERATOR_FIXTURES.find((entry) => entry.id === operatorId);
  const recentPerformance = TEAM_PERFORMANCE_RECORDS.filter(
    (record) =>
      isoTime(record.completedAt) >= isoTime(DEMO_TODAY) - 89 * 86400000,
  );
  const fundedGraduates = recentPerformance
    .map((record) => record.fundingAmount)
    .filter((amount) => amount > 0);

  return {
    activeClients:
      operatorId === "op-apex"
        ? deriveActiveClientCount()
        : (operator?.clientCount ?? 0),
    fundedAllTime: deriveOperatorFundedAllTime(operatorId, applications),
    fundedYtd: deriveOperatorFundedYtd(operatorId, applications),
    graduatedClients:
      operatorId === "op-apex"
        ? (OPERATOR_PIPELINE.find(({ stage }) => stage === "Graduate")?.count ??
          0)
        : 0,
    feesCollected: deriveOperatorCashCollectedAllTime(operatorId),
    analyses: deriveAnalysisCreditsUsed(operatorId),
    averageOptimizationDays: average(
      recentPerformance.map((record) => record.optimizationDays),
    ),
    averageFundingPerGraduatedClient: average(fundedGraduates),
  };
}

export function deriveFeeMetrics() {
  const total = sum(CLIENT_FEE_RECORDS.map((fee) => fee.totalFee));
  const paid = sum(CLIENT_FEE_RECORDS.map((fee) => fee.paid));
  return { total, paid, balance: total - paid };
}

export function deriveTaskMetrics(
  tasks: readonly { status: string }[] = TASK_FIXTURES,
) {
  return {
    total: tasks.length,
    pending: tasks.filter((task) => task.status === "pending").length,
    completed: tasks.filter((task) => task.status === "completed").length,
    overdue: tasks.filter((task) => task.status === "overdue").length,
  };
}

export type BankHistoricalStat = {
  approvalRate: number;
  approvals: number;
  averageFundedAmount: number;
  bankId: string;
  bankName: string;
  /**
   * Phase 8, behind FEATURE_VAULT. The fixture derivation never sets this — the
   * tiles look the lender up in BANK_FIXTURES for it — but a durable lender is
   * not in that array, so the durable row carries its own. Optional, so the
   * fixture path is unchanged.
   */
  bureauPulls?: string;
  fundedAmount: number;
  fundedCount: number;
  lastOutcomeAt: string | null;
  momentum: BankMomentum;
  outcomes: number;
  products: readonly string[];
  qualificationSummary: string;
};

export type BankTrendState = "Trending up" | "Up" | "Neutral" | "Down" | "Trending down";

export function classifyBankTrend(
  current: Pick<BankHistoricalStat, "approvalRate" | "outcomes"> | undefined,
  prior: Pick<BankHistoricalStat, "approvalRate" | "outcomes"> | undefined,
): BankTrendState {
  if (!current?.outcomes || !prior?.outcomes) return "Neutral";
  const delta = current.approvalRate - prior.approvalRate;
  if (delta >= 10) return "Trending up";
  if (delta > 0) return "Up";
  if (delta <= -10) return "Trending down";
  if (delta < 0) return "Down";
  return "Neutral";
}

export function deriveBankHistoricalStats(
  period: OutcomePeriod,
  applications: readonly ApplicationRecord[] = INITIAL_APPLICATION_RECORDS,
): BankHistoricalStat[] {
  const days =
    OUTCOME_PERIODS.find((entry) => entry.id === period)?.days ?? 30;
  const cutoff = isoTime(DEMO_TODAY) - (days - 1) * 86400000;

  return BANK_FIXTURES.map((bank) => {
    const batches = BANK_OUTCOME_BATCHES.filter(
      (batch) =>
        batch.bankId === bank.id && isoTime(batch.recordedAt) >= cutoff,
    );
    const decidedApplications = applications.filter(
      (application) =>
        application.bankId === bank.id &&
        (application.outcome === "approved" ||
          application.outcome === "denied") &&
        application.outcomeRecordedAt !== null &&
        isoTime(application.outcomeRecordedAt) >= cutoff,
    );
    const outcomes =
      sum(batches.map((batch) => batch.outcomes)) + decidedApplications.length;
    const approvals =
      sum(batches.map((batch) => batch.approvals)) +
      decidedApplications.filter(
        (application) => application.outcome === "approved",
      ).length;
    const approvedApplications = decidedApplications.filter(
      (application) =>
        application.outcome === "approved" &&
        application.approvedAmount !== null,
    );
    const fundedCount =
      sum(batches.map((batch) => batch.fundedCount)) +
      approvedApplications.length;
    const fundedAmount =
      sum(batches.map((batch) => batch.fundedAmount)) +
      sum(
        approvedApplications.map(
          (application) => application.approvedAmount ?? 0,
        ),
      );
    const approvalRate = outcomes
      ? roundTwo((approvals / outcomes) * 100)
      : 0;
    const dates = [
      ...batches.map((batch) => batch.recordedAt),
      ...decidedApplications
        .map((application) => application.outcomeRecordedAt)
        .filter((date): date is string => date !== null),
    ].sort();
    const lastOutcomeAt = dates.at(-1) ?? null;
    const momentum: BankMomentum =
      !lastOutcomeAt || outcomes === 0
        ? "cold"
        : approvalRate >= 60
          ? "hot"
          : approvalRate >= 40
            ? "fair"
            : "cold";

    return {
      bankId: bank.id,
      bankName: bank.name,
      products: bank.products,
      qualificationSummary: bank.qualificationSummary,
      outcomes,
      approvals,
      approvalRate,
      fundedCount,
      fundedAmount,
      averageFundedAmount: fundedCount
        ? roundTwo(fundedAmount / fundedCount)
        : 0,
      lastOutcomeAt,
      momentum,
    };
  });
}
