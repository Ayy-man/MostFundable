"use client";

import { useEffect, useState } from "react";

import type { BankDetail } from "@/lib/demo/co-fixtures";
import type {
  BankHistoricalStat,
  BankMomentum,
  OutcomePeriod,
} from "@/lib/demo/feedback-fixtures";

import type {
  BankDetailPayload,
  BankHeatLevel,
  BankListRow,
  BankWindowKey,
  VaultReadState,
} from "./types.ts";

export type { VaultReadState };

/**
 * The Bank Vault's durable read, in the shape the frozen surface already
 * consumes.
 *
 * The frontend froze on 2026-08-18 at `4bb5232`, so this hook's job is to hand
 * `operator.tsx` a `Record<OutcomePeriod, BankHistoricalStat[]>` that is
 * indistinguishable from the fixture derivation it replaces. Every rendered
 * line stays exactly as it is; only where the array comes from changes.
 */

/** The frozen list's five windows, against `bank_outcome_stats`'s five. */
const PERIOD_WINDOW: Readonly<Record<OutcomePeriod, BankWindowKey>> = {
  "30d": "d30",
  "60d": "d60",
  "90d": "d90",
  "6mo": "d183",
  "12mo": "d365",
};

const PERIODS = Object.keys(PERIOD_WINDOW) as OutcomePeriod[];

/** The window §6 derives `heat_level` from, and the only one it governs. */
const CURRENT_WINDOW_PERIOD: OutcomePeriod = "30d";

/**
 * §6's Heat Level is `hot | warm | cold`; the frozen surface's pill vocabulary
 * is `hot | fair | cold` and renders it title-cased. Mapping warm onto fair here
 * is what keeps a client-facing label from changing under the freeze. A lender
 * whose refresh has never run has no level at all, which reads as cold — the
 * same answer 081 gives a lender with no recent history.
 */
export function momentumFor(heatLevel: BankHeatLevel | null): BankMomentum {
  if (heatLevel === "hot") return "hot";
  if (heatLevel === "warm") return "fair";
  return "cold";
}

/**
 * The pill for one window, on the thresholds `deriveBankHistoricalStats` uses.
 *
 * The pill sits inside a "Historical window" selector, so a single value pinned
 * across all five periods is a control that visibly does nothing — the reader
 * moves from 30d to 12mo, every other number changes, and Heat Level does not.
 * The frozen derivation reads it off that window's own approval rate, and so
 * does this.
 *
 * `bank_outcome_stats.heat_level` is not discarded. §6 derives it from the
 * trailing 30- and 90-day windows, which is what the 30-day view is, so the
 * server's value stays the authority there and the computed value fills the
 * four periods §6 says nothing about.
 */
export function momentumForWindow(
  window: { approvalRate: number; outcomes: number },
  lastOutcomeAt: string | null,
): BankMomentum {
  if (!lastOutcomeAt || window.outcomes === 0) return "cold";
  if (window.approvalRate >= 60) return "hot";
  if (window.approvalRate >= 40) return "fair";
  return "cold";
}

export function toHistoricalStat(bank: BankListRow, period: OutcomePeriod): BankHistoricalStat {
  const window = bank.windows[PERIOD_WINDOW[period]];
  return {
    bankId: bank.bankRef,
    bankName: bank.name,
    products: bank.products,
    qualificationSummary: bank.qualificationSummary ?? "",
    bureauPulls: bank.bureauPulls ?? undefined,
    outcomes: window.outcomes,
    approvals: window.approvals,
    approvalRate: window.approvalRate,
    fundedCount: window.fundedCount,
    fundedAmount: window.fundedAmount,
    averageFundedAmount: window.averageFundedAmount,
    lastOutcomeAt: bank.lastOutcomeAt,
    momentum:
      period === CURRENT_WINDOW_PERIOD
        ? momentumFor(bank.heatLevel)
        : momentumForWindow(window, bank.lastOutcomeAt),
  };
}

export function toStatsByPeriod(
  banks: readonly BankListRow[],
): Record<OutcomePeriod, BankHistoricalStat[]> {
  return Object.fromEntries(
    PERIODS.map((period) => [period, banks.map((bank) => toHistoricalStat(bank, period))]),
  ) as Record<OutcomePeriod, BankHistoricalStat[]>;
}

/**
 * The four states a durable read can be in, named the way the fee and tracker
 * rails main merged name theirs (`receivablesRead.state`). The distinction that
 * matters is between `idle` and `failed`: the first means the flag is off and
 * the fixture book is the honest thing to render, the second means the operator
 * asked for their own records and the platform could not produce them. An
 * earlier shape collapsed both onto `enabled: false`, which made a refused read
 * indistinguishable from a disabled feature and quietly showed illustrative
 * lenders to someone who believed they were looking at their workspace.
 */
export interface VaultBanksState {
  state: VaultReadState;
  byPeriod: Record<OutcomePeriod, BankHistoricalStat[]> | null;
}

const IDLE: VaultBanksState = { state: "idle", byPeriod: null };
const LOADING: VaultBanksState = { state: "loading", byPeriod: null };
const FAILED: VaultBanksState = { state: "failed", byPeriod: null };

/**
 * `enabled` is threaded from the server rather than read here, for the reason
 * `surface-client.tsx` gives at length: `featureFlag()` inside a client
 * component returns false unconditionally, and a NEXT_PUBLIC_ twin would bake
 * a runtime switch into the bundle.
 *
 * `active` is the second gate, and it is the one that keeps this off the
 * critical path: the Bank Vault is one of nine operator views, so firing on
 * mount would put a request — and, for anyone the route refuses, a console 4xx
 * on every operator page load — behind a section most sessions never open. It
 * is the pattern `210132d` established on the other rails. Once the section has
 * been opened the request stands; leaving the section does not discard it.
 *
 * The reset when the gates change happens during render rather than inside the
 * effect. Setting state synchronously in an effect body schedules a second
 * render pass for something already known at render time, and the surface reads
 * this state to decide its first paint.
 */
export function useVaultBanks(enabled: boolean, active: boolean): VaultBanksState {
  const wanted = enabled && active;
  const [state, setState] = useState<VaultBanksState>(wanted ? LOADING : IDLE);
  const [lastWanted, setLastWanted] = useState(wanted);

  if (lastWanted !== wanted) {
    setLastWanted(wanted);
    // Only forward: a read that has already landed survives the operator
    // leaving the section and coming back, so the second visit does not blink
    // through a loading notice for data the client already holds.
    if (wanted && state.state === "idle") setState(LOADING);
  }

  useEffect(() => {
    if (!wanted) return;
    let live = true;

    fetch("/api/banks", { headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = (await response.json()) as { banks?: BankListRow[] };
        if (!live) return;
        if (!response.ok || !Array.isArray(body.banks)) {
          setState(FAILED);
          return;
        }
        setState({ state: "ready", byPeriod: toStatsByPeriod(body.banks) });
      })
      .catch(() => {
        if (live) setState(FAILED);
      });

    return () => {
      live = false;
    };
  }, [wanted]);

  return state;
}

/**
 * The durable detail in the shape `BankDetailSheet` already renders, so the
 * frozen component keeps one `detail` and never learns there are two sources.
 *
 * Unknowns are carried through as `null` rather than coerced:
 *   - `checking.required` and `relationshipManager.required` used to be coerced
 *     to `false`, so a lender with nothing recorded rendered a confident "No"
 *     to an operator about to act on it. They now stay `null` and the panel
 *     prints "Not recorded", which is the same third-branch treatment the
 *     deposit amount and the seasoning already had.
 *   - the seasoning and the tip fall back to "Not specified", which is already
 *     the value the frozen Chase Ink fixture carries for exactly this case, so
 *     it is an existing token rather than new client-facing copy.
 */
export function toBankDetail(payload: BankDetailPayload): BankDetail {
  return {
    bankId: payload.bankRef,
    applyChannel:
      payload.channel === null
        ? { type: "in-person", value: null }
        : payload.channel.type === "in-person"
          ? { type: "in-person", value: null }
          : { type: payload.channel.type, value: payload.channel.value },
    checking: {
      depositAmountCents: payload.checking.depositAmountCents,
      required: payload.checking.required ?? null,
      seasoning: payload.checking.seasoning ?? "Not specified",
    },
    relationshipManager: {
      required: payload.relationshipManager.required ?? null,
      tip: payload.relationshipManager.tip ?? "Not specified",
    },
    applicationQuestions: [...payload.applicationQuestions],
    sourceUpdatedAt: payload.sourceUpdatedAt ?? "",
  };
}

export interface VaultBankDetailState {
  state: VaultReadState;
  detail: BankDetailPayload | null;
}

/**
 * The four §6 blocks for one lender, fetched when its panel opens.
 *
 * Same four states and the same reason: the panel's fallback used to be the
 * illustrative fixture map, so a refused detail read rendered a fabricated
 * deposit minimum and an example.com application link inside a panel the
 * operator had every reason to read as their own lender record.
 *
 * The reset when the selected lender changes happens during render, so the
 * panel never paints one lender's blocks under another lender's name while a
 * request is in flight.
 */
export function useVaultBankDetail(
  enabled: boolean,
  bankRef: string | null,
): VaultBankDetailState {
  const active = enabled ? bankRef : null;
  const [state, setState] = useState<VaultBankDetailState>(
    active === null ? { state: "idle", detail: null } : { state: "loading", detail: null },
  );
  const [lastActive, setLastActive] = useState(active);

  if (lastActive !== active) {
    setLastActive(active);
    setState(active === null ? { state: "idle", detail: null } : { state: "loading", detail: null });
  }

  useEffect(() => {
    if (active === null) return;
    let live = true;

    fetch(`/api/banks/${encodeURIComponent(active)}`, { headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = (await response.json()) as { bank?: BankDetailPayload };
        if (!live) return;
        if (!response.ok || !body.bank) {
          setState({ state: "failed", detail: null });
          return;
        }
        setState({ state: "ready", detail: body.bank });
      })
      .catch(() => {
        if (live) setState({ state: "failed", detail: null });
      });

    return () => {
      live = false;
    };
  }, [active]);

  return state;
}
