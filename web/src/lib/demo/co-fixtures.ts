// Change-order fixture data (client-approved scope additions, Aug 1):
// BANK VAULT detail pages, ticket-driven system health, and the generated
// marketing-site preview. Everything here is illustrative and local; the
// production CCA VAULT, ticketing, and hosting connections remain unwired.

export type BankApplyChannel =
  | { type: "online"; value: string }
  | { type: "phone"; value: string }
  | { type: "in-person"; value: null };

export type BankApplicationQuestion = {
  id: string;
  label: string;
  responseBasis: string;
};

export type BankDetail = {
  applicationQuestions: BankApplicationQuestion[];
  applyChannel: BankApplyChannel;
  bankId: string;
  checking: {
    depositAmountCents: number | null;
    // `null` means nobody recorded whether a checking account is required, and
    // the panel prints "Not recorded" for it. The illustrative rows below all
    // carry a real boolean; only the durable `banks_cache` projection
    // (`lib/vault/read.client.ts`) produces `null`, and it used to coerce the
    // unknown to `false`, so a lender with nothing recorded rendered a
    // confident "No" to an operator about to act on it.
    required: boolean | null;
    seasoning: string;
  };
  relationshipManager: {
    required: boolean | null;
    tip: string;
  };
  sourceUpdatedAt: string;
};

const STANDING_APPLICATION_QUESTIONS: readonly BankApplicationQuestion[] = [
  { id: "projected-revenue", label: "Projected revenue", responseBasis: "Use the business's own current revenue projection and supporting records." },
  { id: "projected-personal-income", label: "Projected personal income", responseBasis: "Use the applicant's own current income projection and supporting records." },
  { id: "projected-monthly-spend", label: "Projected monthly spend", responseBasis: "Use the business's own current operating-budget projection." },
  { id: "projected-employees", label: "Projected # employees", responseBasis: "Use the business's own current staffing projection." },
];

function applicationQuestions(extras: BankApplicationQuestion[]): BankApplicationQuestion[] {
  return [...STANDING_APPLICATION_QUESTIONS, ...extras];
}

export const BANK_DETAILS: Record<string, BankDetail> = {
  bluevine: {
    bankId: "bluevine",
    applyChannel: { type: "online", value: "https://example.com/illustrative-bluevine-application" },
    checking: {
      depositAmountCents: 100_000,
      required: true,
      seasoning: "About 3 months",
    },
    relationshipManager: { required: false, tip: "The recorded process starts online; the bank may follow up for documents." },
    applicationQuestions: applicationQuestions([
      { id: "average-monthly-revenue", label: "Average monthly revenue", responseBasis: "Use current business statements to report the recorded monthly average." },
    ]),
    sourceUpdatedAt: "Jul 20",
  },
  "chase-ink": {
    bankId: "chase-ink",
    applyChannel: { type: "online", value: "https://example.com/illustrative-chase-ink-application" },
    checking: {
      depositAmountCents: null,
      required: false,
      seasoning: "Not specified",
    },
    relationshipManager: { required: false, tip: "The recorded process starts online and may include a verification call." },
    applicationQuestions: applicationQuestions([
      { id: "business-start-date", label: "Business start date", responseBasis: "Use the date shown in the business's formation records." },
    ]),
    sourceUpdatedAt: "Jul 18",
  },
  "amex-business": {
    bankId: "amex-business",
    applyChannel: { type: "phone", value: "+1-800-555-0148" },
    checking: {
      depositAmountCents: null,
      required: false,
      seasoning: "Not specified",
    },
    relationshipManager: { required: false, tip: "The recorded phone process may be followed by a request for cash-flow records." },
    applicationQuestions: applicationQuestions([
      { id: "annual-business-revenue", label: "Annual business revenue", responseBasis: "Use the total supported by the business's current revenue records." },
    ]),
    sourceUpdatedAt: "Jul 19",
  },
  "us-bank": {
    bankId: "us-bank",
    applyChannel: { type: "in-person", value: null },
    checking: {
      depositAmountCents: 250_000,
      required: true,
      seasoning: "About 6 months",
    },
    relationshipManager: { required: true, tip: "Research a local branch and expect a banker to provide the application process." },
    applicationQuestions: applicationQuestions([
      { id: "requested-amount", label: "Requested amount", responseBasis: "Use the business's documented funding need and intended use." },
      { id: "business-ownership", label: "Business ownership", responseBasis: "Use the ownership percentages in the current company records." },
    ]),
    sourceUpdatedAt: "Jul 17",
  },
  "wells-fargo": {
    bankId: "wells-fargo",
    applyChannel: { type: "phone", value: "+1-800-555-0192" },
    checking: {
      depositAmountCents: 150_000,
      required: true,
      seasoning: "Established relationship; duration not specified",
    },
    relationshipManager: { required: true, tip: "Expect the assigned banker to explain the document request and next contact." },
    applicationQuestions: applicationQuestions([
      { id: "annual-gross-sales", label: "Annual gross sales", responseBasis: "Use the amount supported by the business's current financial records." },
      { id: "requested-product", label: "Requested product", responseBasis: "Select the product the business is actually requesting." },
    ]),
    sourceUpdatedAt: "Jul 15",
  },
  pnc: {
    bankId: "pnc",
    applyChannel: { type: "online", value: "https://example.com/illustrative-pnc-application" },
    checking: {
      depositAmountCents: 100_000,
      required: true,
      seasoning: "About 3 months",
    },
    relationshipManager: { required: false, tip: "The recorded process starts online and may request revenue records." },
    applicationQuestions: applicationQuestions([
      { id: "industry-classification", label: "Industry classification", responseBasis: "Use the classification in the business's current registration records." },
    ]),
    sourceUpdatedAt: "Jul 20",
  },
  "td-bank": {
    bankId: "td-bank",
    applyChannel: { type: "in-person", value: null },
    checking: {
      depositAmountCents: 200_000,
      required: true,
      seasoning: "About 6 months",
    },
    relationshipManager: { required: true, tip: "Research a local branch and expect a banker to explain the statement request." },
    applicationQuestions: applicationQuestions([
      { id: "average-monthly-deposits", label: "Average monthly deposits", responseBasis: "Use the average shown by the business's current operating statements." },
    ]),
    sourceUpdatedAt: "Jul 14",
  },
};

export type HealthElement = {
  category: string;
  id: string;
  label: string;
};

export const HEALTH_ELEMENTS: readonly HealthElement[] = [
  { id: "portal", category: "Client experience", label: "Portal access" },
  { id: "monitoring", category: "Client experience", label: "Monitoring display" },
  { id: "analysis", category: "Data services", label: "Readiness analysis" },
  { id: "vault-sync", category: "Data services", label: "BANK VAULT sync" },
  { id: "coach-review", category: "Platform operations", label: "AI reply review" },
  { id: "esign", category: "Platform operations", label: "E-sign service" },
  { id: "billing", category: "Platform operations", label: "SaaS billing" },
];

export type SupportTicketSeverity = "high" | "low" | "medium";

export type SupportTicket = {
  elementId: string;
  id: string;
  openedAt: string;
  operatorName: string;
  severity: SupportTicketSeverity;
  status: "open" | "resolved";
  summary: string;
};

export const SUPPORT_TICKET_FIXTURES: readonly SupportTicket[] = [
  { id: "tk-118", elementId: "monitoring", operatorName: "Apex Funding Partners", severity: "medium", status: "open", summary: "A client's monitoring widget shows a stale refresh date after reconnecting.", openedAt: "Jul 21" },
  { id: "tk-117", elementId: "monitoring", operatorName: "Liberty Capital Group", severity: "low", status: "open", summary: "Monitoring connection banner overlaps the score panel on one tablet size.", openedAt: "Jul 20" },
  { id: "tk-116", elementId: "esign", operatorName: "Northgate Advisors", severity: "high", status: "open", summary: "An enrollment e-signature session expired before the client could finish.", openedAt: "Jul 21" },
  { id: "tk-114", elementId: "billing", operatorName: "Liberty Capital Group", severity: "low", status: "open", summary: "A seat-adjustment line item needs a clearer label on the operator invoice view.", openedAt: "Jul 19" },
  { id: "tk-112", elementId: "portal", operatorName: "Apex Funding Partners", severity: "medium", status: "resolved", summary: "A client portal invite link returned an expired state on first use.", openedAt: "Jul 17" },
  { id: "tk-110", elementId: "analysis", operatorName: "Apex Funding Partners", severity: "medium", status: "resolved", summary: "A readiness analysis stayed queued past the expected completion window.", openedAt: "Jul 15" },
  { id: "tk-109", elementId: "vault-sync", operatorName: "Liberty Capital Group", severity: "low", status: "resolved", summary: "A promoted intel finding took two sync cycles to appear in the operator view.", openedAt: "Jul 14" },
];

export type MarketingSiteTemplate = {
  description: string;
  headline: string;
  id: string;
  name: string;
  sections: string[];
  subheadline: string;
};

export const MARKETING_SITE_TEMPLATES: readonly MarketingSiteTemplate[] = [
  {
    id: "foundation",
    name: "Foundation",
    description: "A calm, document-first layout for established advisory brands.",
    headline: "Funding readiness, step by step",
    subheadline:
      "We help business owners prepare a complete funding profile and apply in a confirmed order.",
    sections: ["How the program works", "What clients prepare", "Book a conversation"],
  },
  {
    id: "momentum",
    name: "Momentum",
    description: "A bolder hero with the readiness journey front and center.",
    headline: "Get your business funding-ready",
    subheadline:
      "A guided plan, verified progress, and a clear application sequence, managed with your advisor.",
    sections: ["The readiness journey", "Recent client milestones", "Start with a readiness review"],
  },
  {
    id: "ledger",
    name: "Ledger",
    description: "A compact, data-forward layout for operators who lead with process.",
    headline: "A documented path to funding readiness",
    subheadline:
      "Every step is recorded: profile completeness, verified updates, and application results.",
    sections: ["Our process", "What we track", "Talk to the team"],
  },
];
