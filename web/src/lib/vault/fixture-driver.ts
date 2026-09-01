import type { VaultBankRecord, VaultDriver } from "./types.ts";

/**
 * `VAULT_DRIVER=fixture`, the default when no `VAULT_SERVICE_KEY` is present
 * (INTERFACES §10, DEC-OWN-CREDLESS).
 *
 * A real implementation of the interface rather than a test double: the sync
 * job runs against it end to end, writes the same `banks_cache` rows the real
 * driver writes, and is the reason the read model, the two routes and the
 * durable surface can all be exercised with no credential anywhere.
 *
 * The seven lenders below are the ones the frozen Bank Vault already names, and
 * every string is copied character for character from
 * `web/src/lib/demo/co-fixtures.ts` and `web/src/lib/demo/feedback-fixtures.ts`
 * — which is what makes a flag flip a change of data source rather than a
 * change of what a reader sees. `fixture-driver.test.ts` asserts the two agree,
 * so a fixture edit that this file does not follow fails there rather than at a
 * client review. Migration 382 seeds the same seven so the read model renders
 * before the first sync run has happened.
 */
const RECORDS: readonly VaultBankRecord[] = Object.freeze([
  {
    bankRef: "bluevine",
    name: "Bluevine",
    products: ["Business line of credit", "Term loan"],
    bureauPulls: "Experian business",
    qualificationSummary: "Business banking history and current revenue evidence",
    channel: { type: "online", value: "https://example.com/illustrative-bluevine-application" },
    checking: { required: true, depositAmountCents: 100_000, seasoning: "About 3 months" },
    relationshipManager: {
      required: false,
      tip: "The recorded process starts online; the bank may follow up for documents.",
    },
    applicationQuestions: [
      {
        id: "average-monthly-revenue",
        label: "Average monthly revenue",
        responseBasis: "Use current business statements to report the recorded monthly average.",
      },
    ],
    sourceUpdatedAt: "2026-07-20",
    isActive: true,
  },
  {
    bankRef: "chase-ink",
    name: "Chase Ink",
    products: ["Business credit card"],
    bureauPulls: "Experian personal",
    qualificationSummary: "Business identity, issuer relationship, and application timing",
    channel: { type: "online", value: "https://example.com/illustrative-chase-ink-application" },
    checking: { required: false, depositAmountCents: null, seasoning: "Not specified" },
    relationshipManager: {
      required: false,
      tip: "The recorded process starts online and may include a verification call.",
    },
    applicationQuestions: [
      {
        id: "business-start-date",
        label: "Business start date",
        responseBasis: "Use the date shown in the business's formation records.",
      },
    ],
    sourceUpdatedAt: "2026-07-18",
    isActive: true,
  },
  {
    bankRef: "amex-business",
    name: "Amex Business",
    products: ["Business credit card", "Term loan"],
    bureauPulls: "Experian personal and business",
    qualificationSummary: "Current account profile and business cash-flow evidence",
    channel: { type: "phone", value: "+1-800-555-0148" },
    checking: { required: false, depositAmountCents: null, seasoning: "Not specified" },
    relationshipManager: {
      required: false,
      tip: "The recorded phone process may be followed by a request for cash-flow records.",
    },
    applicationQuestions: [
      {
        id: "annual-business-revenue",
        label: "Annual business revenue",
        responseBasis: "Use the total supported by the business's current revenue records.",
      },
    ],
    sourceUpdatedAt: "2026-07-19",
    isActive: true,
  },
  {
    bankRef: "us-bank",
    name: "US Bank",
    products: ["Business line of credit", "Business credit card"],
    bureauPulls: "TransUnion personal",
    qualificationSummary: "Business banking relationship and complete company records",
    channel: { type: "in-person", value: null },
    checking: { required: true, depositAmountCents: 250_000, seasoning: "About 6 months" },
    relationshipManager: {
      required: true,
      tip: "Research a local branch and expect a banker to provide the application process.",
    },
    applicationQuestions: [
      {
        id: "requested-amount",
        label: "Requested amount",
        responseBasis: "Use the business's documented funding need and intended use.",
      },
      {
        id: "business-ownership",
        label: "Business ownership",
        responseBasis: "Use the ownership percentages in the current company records.",
      },
    ],
    sourceUpdatedAt: "2026-07-17",
    isActive: true,
  },
  {
    bankRef: "wells-fargo",
    name: "Wells Fargo",
    products: ["Term loan", "Business line of credit"],
    bureauPulls: "Experian business",
    qualificationSummary: "Complete financial records and relationship context",
    channel: { type: "phone", value: "+1-800-555-0192" },
    checking: {
      required: true,
      depositAmountCents: 150_000,
      seasoning: "Established relationship; duration not specified",
    },
    relationshipManager: {
      required: true,
      tip: "Expect the assigned banker to explain the document request and next contact.",
    },
    applicationQuestions: [
      {
        id: "annual-gross-sales",
        label: "Annual gross sales",
        responseBasis: "Use the amount supported by the business's current financial records.",
      },
      {
        id: "requested-product",
        label: "Requested product",
        responseBasis: "Select the product the business is actually requesting.",
      },
    ],
    sourceUpdatedAt: "2026-07-15",
    isActive: true,
  },
  {
    bankRef: "pnc",
    name: "PNC",
    products: ["Business credit card", "Term loan"],
    bureauPulls: "Equifax business",
    qualificationSummary: "Business banking history and documented revenue",
    channel: { type: "online", value: "https://example.com/illustrative-pnc-application" },
    checking: { required: true, depositAmountCents: 100_000, seasoning: "About 3 months" },
    relationshipManager: {
      required: false,
      tip: "The recorded process starts online and may request revenue records.",
    },
    applicationQuestions: [
      {
        id: "industry-classification",
        label: "Industry classification",
        responseBasis: "Use the classification in the business's current registration records.",
      },
    ],
    sourceUpdatedAt: "2026-07-20",
    isActive: true,
  },
  {
    bankRef: "td-bank",
    name: "TD Bank",
    products: ["Revenue-based funding"],
    bureauPulls: "Experian business",
    qualificationSummary: "Current deposits and operating revenue",
    channel: { type: "in-person", value: null },
    checking: { required: true, depositAmountCents: 200_000, seasoning: "About 6 months" },
    relationshipManager: {
      required: true,
      tip: "Research a local branch and expect a banker to explain the statement request.",
    },
    applicationQuestions: [
      {
        id: "average-monthly-deposits",
        label: "Average monthly deposits",
        responseBasis: "Use the average shown by the business's current operating statements.",
      },
    ],
    sourceUpdatedAt: "2026-07-14",
    isActive: true,
  },
]);

export const fixtureVaultDriver: VaultDriver = {
  name: "fixture",
  async listBanks() {
    return RECORDS;
  },
};

export const FIXTURE_BANK_RECORDS = RECORDS;
