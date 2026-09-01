import {
  BANK_WINDOW_KEYS,
  type BankDetailPayload,
  type BankListRow,
  type BankReadModelRow,
  type BankWindowCounts,
  type BankWindowKey,
  type BankWindowSummary,
  type VaultReadState,
} from "./types.ts";
import { surfacePlainText } from "./sync.ts";

/**
 * `bank_outcome_stats.windows` as the surface reads it.
 *
 * Phase 11 owns the counting; nothing here recounts anything. This is unit
 * conversion and arithmetic over counts that already exist, which is why
 * VAULT-01's reconciliation can be a comparison rather than a second
 * implementation.
 *
 * Two conventions, both inherited from the frozen surface rather than invented:
 * money is dollars (`formatDemoMoney` takes dollars) and the approval rate is
 * 0–100 to two places (`deriveBankHistoricalStats` rounds the same way). Every
 * number here is labelled a recorded historical outcome wherever it renders
 * (#206): each one counts something that already happened, and none of them is
 * a forecast.
 */

const EMPTY_COUNTS: BankWindowCounts = Object.freeze({
  approved: 0,
  denied: 0,
  withdrawn: 0,
  approved_amount_cents: 0,
});

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function summariseWindow(counts: BankWindowCounts | null | undefined): BankWindowSummary {
  const approved = count(counts?.approved);
  const denied = count(counts?.denied);
  const approvedAmountCents = count(counts?.approved_amount_cents);
  // Decided outcomes only. `deriveBankHistoricalStats` — the fixture derivation
  // this replaces — counts approvals and denials and nothing else, so a
  // withdrawn application does not move the rate there. Including withdrawn in
  // the denominator here would have changed what the same number on the same
  // frozen column means the moment FEATURE_VAULT flipped: two lenders with
  // identical decisions would rank differently because one had more abandoned
  // files. The column is labelled "Recent approval rate", and an application
  // nobody decided is not a decision that went against the client.
  const outcomes = approved + denied;
  // Funded count is the approved count: `outcomes_amount_shape` in migration 080
  // makes an approved outcome carry a positive amount and every other kind carry
  // none, so "approved" and "funded with a recorded amount" are the same set.
  const fundedAmount = roundTwo(approvedAmountCents / 100);

  return {
    outcomes,
    approvals: approved,
    approvalRate: outcomes === 0 ? 0 : roundTwo((approved / outcomes) * 100),
    fundedCount: approved,
    fundedAmount,
    averageFundedAmount: approved === 0 ? 0 : roundTwo(fundedAmount / approved),
  };
}

export function summariseWindows(
  windows: Record<BankWindowKey, BankWindowCounts> | null | undefined,
): Record<BankWindowKey, BankWindowSummary> {
  const summary = {} as Record<BankWindowKey, BankWindowSummary>;
  for (const key of BANK_WINDOW_KEYS) {
    summary[key] = summariseWindow(windows?.[key] ?? EMPTY_COUNTS);
  }
  return summary;
}

export function toListRow(row: BankReadModelRow): BankListRow {
  return {
    bankRef: row.bank_ref,
    name: surfacePlainText(row.name) ?? row.name,
    products: (row.products ?? []).flatMap((product) => {
      const text = surfacePlainText(product);
      return text === null ? [] : [text];
    }),
    bureauPulls: surfacePlainText(row.bureau_pulls),
    qualificationSummary: surfacePlainText(row.qualification_summary),
    heatLevel: row.heat_level,
    lastOutcomeAt: row.last_outcome_at,
    windows: summariseWindows(row.windows),
  };
}

export function toDetailPayload(row: BankReadModelRow): BankDetailPayload {
  return {
    ...toListRow(row),
    channel:
      row.channel_type === null
        ? null
        : row.channel_type === "in-person"
          ? { type: "in-person", value: null }
          : { type: row.channel_type, value: row.channel_value ?? "" },
    checking: {
      required: row.checking_required,
      depositAmountCents: row.checking_deposit_cents,
      seasoning: surfacePlainText(row.checking_seasoning),
    },
    relationshipManager: {
      required: row.rel_manager,
      tip: surfacePlainText(row.rel_manager_tip),
    },
    applicationQuestions: (row.application_questions ?? []).flatMap((question) => {
      const label = surfacePlainText(question.label);
      const responseBasis = surfacePlainText(question.responseBasis);
      return label === null || responseBasis === null
        ? []
        : [{ ...question, label, responseBasis }];
    }),
    sourceUpdatedAt: row.source_updated_at,
  };
}

/**
 * Which of the four things a Bank Vault surface may render.
 *
 * A pure function rather than an expression inlined in `operator.tsx`, for two
 * reasons. The decision is made in three places — the list rail, the detail
 * sheet and the trend tiles all have to agree — and a surface test can only
 * assert that an inlined condition *mentions* its inputs, which stays true if
 * the condition is negated. Here every combination is drivable.
 *
 * `fixtures` is reachable on exactly one input: the flag being off. With the
 * flag on, a read that has not landed is `loading` or `failed` and the caller
 * renders a notice — never the illustrative catalog, which carries invented
 * deposit minimums and example.com links that an operator reading their own
 * workspace would have no way to recognise as fabricated.
 */
export type BankVaultSource = "fixtures" | "durable" | "loading" | "failed";

export function bankVaultSource(
  vaultEnabled: boolean,
  state: VaultReadState,
): BankVaultSource {
  if (!vaultEnabled) return "fixtures";
  if (state === "ready") return "durable";
  if (state === "failed") return "failed";
  // `idle` means the flag is on and nothing has been asked for yet, which the
  // surface only ever sees before the section it gates is open. It is grouped
  // with `loading` because the one answer it must never produce is `fixtures`.
  return "loading";
}
