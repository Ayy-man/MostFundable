// Integrator-owned registration (Phase 16 merge): wires the weekly KB reimport
// into Phase 14's shared registry per INTERFACES §7 (subject `global`, window
// ISO week). The handler itself stays with the KB lane in `../job.ts`.
import { registerCadenceProvider, registerJobHandler } from "@/lib/jobs/registry";

import { runVaultReimportKb, VAULT_REIMPORT_KB_JOB } from "../job.ts";

/** UTC ISO-8601 week label, e.g. 2026-W34 — the §7 window for this key. */
export function utcIsoWeek(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

registerJobHandler(VAULT_REIMPORT_KB_JOB, runVaultReimportKb, "FEATURE_KB");
registerCadenceProvider(VAULT_REIMPORT_KB_JOB, async (now) => [
  { job: "vault.reimport_kb" as const, subject: "global", window: utcIsoWeek(now) },
], "FEATURE_KB");
