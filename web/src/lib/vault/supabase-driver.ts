import "server-only";

import type {
  BankApplicationQuestion,
  BankChannel,
  VaultBankRecord,
  VaultDriver,
} from "./types.ts";

/**
 * `VAULT_DRIVER=supabase` — the real nightly read of the CCA VAULT project.
 *
 * This lane holds no VAULT credential (DEV-ONBOARDING least privilege), so this
 * file has never executed against the real project and the integrator runs its
 * arm after merge. It is written against the schema shapes pulled from the live
 * VAULT project rather than against a guess, and it is deliberately tolerant:
 * every field is read defensively, because a column that has drifted upstream
 * should cost the platform one null on one lender, not the whole sync.
 *
 * VAULT-05, restated where it actually bites. `banks.fico_floor`,
 * `banks.fico_ideal`, `banks.fico_notes`, `banks.tib_floor_months`,
 * `banks.tib_notes`, `bank_requirements.fico_floor`, `.fico_preferred`,
 * `.fico_notes`, `.tib_months_floor` and `.tib_notes` all exist in the tables
 * below and none of them is in a select list here. Neither are the unvetted
 * free-text intel fields — `banks.vault_full_text`, `banks.winning_patterns`,
 * `banks.denial_patterns`, `banks.key_gotchas`, `banks.best_fit_profile`,
 * `bank_application_details.exact_script`. What crosses is §6's cache columns
 * and nothing else.
 *
 * There is no live read anywhere near a request (VAULT-03, DEC-D8). The only
 * caller is the `vault.sync_banks` job.
 */

interface VaultBankSource {
  slug: string | null;
  name: string | null;
  products: string[] | null;
  is_active: boolean | null;
  online_app_available: boolean | null;
  banker_required: boolean | null;
  brm_notes: string | null;
  biz_checking_required: boolean | null;
  primary_bureau: string | null;
  bureau_primary: string | null;
  pull_type: string | null;
  last_updated: string | null;
  id: string;
}

interface VaultRequirementsSource {
  bank_id: string;
  biz_checking_balance_min: number | null;
  biz_checking_seasoning_days: number | null;
  revenue_stated_strategy: string | null;
  personal_income_strategy: string | null;
}

interface VaultApplicationDetailSource {
  bank_id: string;
  methods_ranked: unknown;
  timing_notes: string | null;
}

interface VaultBankerIntelSource {
  bank_id: string;
  how_to_get_handoff: string | null;
}

const BANK_COLUMNS =
  "id,slug,name,products,is_active,online_app_available,banker_required,brm_notes," +
  "biz_checking_required,primary_bureau,bureau_primary,pull_type,last_updated";
// `biz_checking_notes` was selected and never mapped. On a file whose whole
// argument is that the select list is the boundary, a column read for no reason
// is the boundary drifting — so it is gone rather than annotated.
const REQUIREMENT_COLUMNS =
  "bank_id,biz_checking_balance_min,biz_checking_seasoning_days," +
  "revenue_stated_strategy,personal_income_strategy";
const APPLICATION_DETAIL_COLUMNS = "bank_id,methods_ranked,timing_notes";
const BANKER_INTEL_COLUMNS = "bank_id,how_to_get_handoff";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `bank_application_details.methods_ranked` is ranked application methods, so
 * the first entry that resolves to one of §6's three channels wins. The column
 * is jsonb with no declared shape, so both the "array of strings" and the
 * "array of objects" forms are read; anything else leaves the channel null and
 * the detail page falls back to its in-person copy, which is the honest answer
 * when nobody has recorded how to apply.
 */
export function channelFromMethods(
  methods: unknown,
  onlineAvailable: boolean | null,
): BankChannel | null {
  const entries = Array.isArray(methods) ? methods : [];

  for (const entry of entries) {
    const label = text(typeof entry === "string" ? entry : isRecord(entry)
      ? entry.method ?? entry.type ?? entry.channel ?? entry.name
      : null);
    if (label === null) continue;
    const value = isRecord(entry)
      ? text(entry.url ?? entry.link ?? entry.value ?? entry.phone ?? entry.number)
      : null;
    const normalized = label.toLowerCase();

    if (/online|web|portal|digital|app\b/.test(normalized)) {
      if (value !== null && /^https:\/\//i.test(value)) return { type: "online", value };
      continue;
    }
    if (/phone|call|telephone/.test(normalized)) {
      if (value !== null) return { type: "phone", value };
      continue;
    }
    if (/branch|in.?person|in.?branch|walk.?in/.test(normalized)) {
      return { type: "in-person", value: null };
    }
  }

  // `banks.online_app_available` is the only channel signal every lender
  // carries, but it says an online application exists without saying where, and
  // §6's online arm renders a link. So a true here with no link recorded is an
  // in-person answer, not a broken online one.
  return onlineAvailable === false ? { type: "in-person", value: null } : null;
}

/**
 * VAULT records the checking-account seasoning as a number of days. Rendering
 * it as days rather than converting to "about N months" keeps the cache saying
 * exactly what the source says: the approximation would be ours, not theirs.
 */
export function seasoningFromDays(days: number | null | undefined): string | null {
  if (typeof days !== "number" || !Number.isFinite(days) || days < 0) return null;
  const whole = Math.round(days);
  return whole === 1 ? "1 day" : `${whole} days`;
}

/**
 * The lender-specific application questions. VAULT holds strategy notes rather
 * than a question table, so the two that map cleanly onto §6's per-bank rows are
 * taken and nothing is invented from prose. The four standing questions are
 * added by the sync core, not here.
 */
export function questionsFromRequirements(
  requirements: VaultRequirementsSource | undefined,
  detail: VaultApplicationDetailSource | undefined,
): BankApplicationQuestion[] {
  const questions: BankApplicationQuestion[] = [];
  const revenue = text(requirements?.revenue_stated_strategy);
  if (revenue !== null) {
    questions.push({
      id: "stated-business-revenue",
      label: "Stated business revenue",
      responseBasis: revenue,
    });
  }
  const income = text(requirements?.personal_income_strategy);
  if (income !== null) {
    questions.push({
      id: "stated-personal-income",
      label: "Stated personal income",
      responseBasis: income,
    });
  }
  const timing = text(detail?.timing_notes);
  if (timing !== null) {
    questions.push({
      id: "application-timing",
      label: "Application timing",
      responseBasis: timing,
    });
  }
  return questions;
}

export function toVaultBankRecord(
  bank: VaultBankSource,
  requirements: VaultRequirementsSource | undefined,
  detail: VaultApplicationDetailSource | undefined,
  intel: VaultBankerIntelSource | undefined,
): VaultBankRecord | null {
  const bankRef = text(bank.slug);
  const name = text(bank.name);
  if (bankRef === null || name === null) return null;

  return {
    bankRef: bankRef.toLowerCase(),
    name,
    products: (bank.products ?? []).filter((product): product is string => typeof product === "string"),
    bureauPulls: text(bank.primary_bureau) ?? text(bank.bureau_primary) ?? text(bank.pull_type),
    // VAULT's own summary fields are free-text intel, so the cache carries no
    // qualification summary from this driver. The sync's compliance filter would
    // drop most of it anyway, and a half-vetted paragraph is worse than none.
    qualificationSummary: null,
    channel: channelFromMethods(detail?.methods_ranked, bank.online_app_available),
    checking: {
      required: typeof bank.biz_checking_required === "boolean" ? bank.biz_checking_required : null,
      // VAULT records the minimum balance as a currency amount and this cache
      // stores cents, so this multiply is the whole unit conversion. It is the
      // one place a number could be silently wrong by two orders of magnitude,
      // and `supabase-driver.test.ts` pins it for that reason.
      depositAmountCents:
        typeof requirements?.biz_checking_balance_min === "number"
          ? Math.round(requirements.biz_checking_balance_min * 100)
          : null,
      seasoning: seasoningFromDays(requirements?.biz_checking_seasoning_days),
    },
    relationshipManager: {
      required: typeof bank.banker_required === "boolean" ? bank.banker_required : null,
      tip: text(bank.brm_notes) ?? text(intel?.how_to_get_handoff),
    },
    applicationQuestions: questionsFromRequirements(requirements, detail),
    sourceUpdatedAt: text(bank.last_updated),
    isActive: bank.is_active !== false,
  };
}

function byBankId<Row extends { bank_id: string }>(rows: readonly Row[]): Map<string, Row> {
  const index = new Map<string, Row>();
  for (const row of rows) if (!index.has(row.bank_id)) index.set(row.bank_id, row);
  return index;
}

export const supabaseVaultDriver: VaultDriver = {
  name: "supabase",
  async listBanks() {
    const [{ createClient }, { requireEnv }] = await Promise.all([
      import("@supabase/supabase-js"),
      import("./env.ts"),
    ]);

    const client = createClient(requireEnv("VAULT_SUPABASE_URL"), requireEnv("VAULT_SERVICE_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const [banks, requirements, details, intel] = await Promise.all([
      client.from("banks").select(BANK_COLUMNS),
      client.from("bank_requirements").select(REQUIREMENT_COLUMNS),
      client.from("bank_application_details").select(APPLICATION_DETAIL_COLUMNS),
      client.from("banker_intel").select(BANKER_INTEL_COLUMNS),
    ]);

    for (const result of [banks, requirements, details, intel]) {
      // The message is not echoed anywhere near a response: this runs in a job,
      // and a PostgREST error can name a column value.
      if (result.error) throw new Error("VAULT_READ_FAILED");
    }

    const requirementsById = byBankId((requirements.data ?? []) as unknown as VaultRequirementsSource[]);
    const detailsById = byBankId((details.data ?? []) as unknown as VaultApplicationDetailSource[]);
    const intelById = byBankId((intel.data ?? []) as unknown as VaultBankerIntelSource[]);

    const records: VaultBankRecord[] = [];
    for (const bank of (banks.data ?? []) as unknown as VaultBankSource[]) {
      const record = toVaultBankRecord(
        bank,
        requirementsById.get(bank.id),
        detailsById.get(bank.id),
        intelById.get(bank.id),
      );
      if (record !== null) records.push(record);
    }
    return records;
  },
};
