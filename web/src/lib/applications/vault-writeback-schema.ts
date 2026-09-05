/**
 * Read-only schema descriptor for the VAULT PostgREST API.
 *
 * Captured from `${VAULT_SUPABASE_URL}/rest/v1/` on 2026-09-05 using the
 * project service credential. `requiredColumns` is the OpenAPI `required`
 * list, which describes non-null columns; `hasDefault` records a server-side
 * default, so `insertRequiredColumns` is the subset a caller must send.
 *
 * This is deliberately a descriptor rather than generated source. It is the
 * checked-in contract the write-back tests can exercise without a credential,
 * and schema drift remains visible in review when the next live read updates
 * it.
 */

export interface VaultColumnDescriptor {
  nullable: boolean;
  hasDefault: boolean;
}

export interface VaultTableDescriptor {
  requiredColumns: readonly string[];
  insertRequiredColumns: readonly string[];
  columns: Readonly<Record<string, VaultColumnDescriptor>>;
}

function column(nullable: boolean, hasDefault = false): VaultColumnDescriptor {
  return Object.freeze({ nullable, hasDefault });
}

const nullable = () => column(true);

/** The two historic targets that the live VAULT OpenAPI description exposes. */
export const LIVE_VAULT_WRITEBACK_SCHEMA = Object.freeze({
  data_points: Object.freeze({
    requiredColumns: Object.freeze(["id", "bank_id"]),
    insertRequiredColumns: Object.freeze(["bank_id"]),
    columns: Object.freeze({
      id: column(false, true),
      bank_id: column(false),
      product: nullable(),
      result: nullable(),
      amount: nullable(),
      amount_notes: nullable(),
      fico_score: nullable(),
      fico_notes: nullable(),
      tib_description: nullable(),
      state: nullable(),
      bureau_pulled: nullable(),
      method: nullable(),
      applicant_profile: nullable(),
      outcome_notes: nullable(),
      source_person: nullable(),
      source_platform: nullable(),
      source_date: nullable(),
      drop_week: nullable(),
      created_at: column(true, true),
    }),
  }),
  bank_datapoints: Object.freeze({
    requiredColumns: Object.freeze(["id", "bank_slug", "dp_type"]),
    insertRequiredColumns: Object.freeze(["bank_slug", "dp_type"]),
    columns: Object.freeze({
      id: column(false, true),
      bank_id: nullable(),
      bank_slug: column(false),
      dp_type: column(false),
      date_observed: nullable(),
      amount: nullable(),
      product: nullable(),
      intro_period: nullable(),
      fico_score: nullable(),
      bureau_pulled: nullable(),
      tib_months: nullable(),
      state: nullable(),
      revenue_stated: nullable(),
      income_stated: nullable(),
      employees_stated: nullable(),
      monthly_spend_stated: nullable(),
      method: nullable(),
      result: nullable(),
      source_platform: nullable(),
      source_poster: nullable(),
      source_date: nullable(),
      raw_text: nullable(),
      funder_action: nullable(),
      created_at: column(true, true),
      confidence: column(true, true),
    }),
  }),
} satisfies Readonly<Record<string, VaultTableDescriptor>>);

export type LiveVaultWritebackTable = keyof typeof LIVE_VAULT_WRITEBACK_SCHEMA;

/** The sole live destination that has an identity available in an outbox row. */
export const VAULT_OUTCOME_DESTINATION = "bank_datapoints" as const;

export function payloadSatisfiesVaultDescriptor(
  table: LiveVaultWritebackTable,
  payload: Record<string, unknown>,
): boolean {
  const descriptor: VaultTableDescriptor = LIVE_VAULT_WRITEBACK_SCHEMA[table];

  for (const [name, value] of Object.entries(payload)) {
    const columnDescriptor = descriptor.columns[name];
    if (columnDescriptor === undefined) return false;
    if (value === null && !columnDescriptor.nullable) return false;
  }

  return descriptor.insertRequiredColumns.every((name) => {
    const value = payload[name];
    return value !== undefined && value !== null;
  });
}
