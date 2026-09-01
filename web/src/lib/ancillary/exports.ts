import { createSupabaseAncillaryRepository, type AncillaryRepository } from "./repository.ts";

export const DERIVED_EXPORTS = {
  analysis_runs: { table: "analysis_runs", columns: ["id", "client_id", "ran_at", "trigger", "readiness_score", "derived"], order: "id", filters: ["client_id", "from", "to"] },
  plans: { table: "plans", columns: ["id", "client_id", "analysis_run_id", "version", "body", "readiness_score", "created_at"], order: "id", filters: ["client_id", "analysis_run_id", "from", "to"] },
  checklist_item_state: { table: "checklist_item_state", columns: ["checklist_item_id", "client_id", "state", "reported_at", "verifying_at", "verified_at", "verified_by_run_id"], order: "checklist_item_id", filters: ["client_id", "state"] },
  bank_outcome_stats: { table: "bank_outcome_stats", columns: ["bank_ref", "stats_version", "windows", "heat_level", "last_outcome_at", "approved_amount_cents_total", "outcome_count_total", "computed_at"], order: "bank_ref", filters: ["bank_ref"] },
  bank_retrieval_index: { table: "bank_retrieval_index", columns: ["bank_ref", "stats_version", "document", "document_fingerprint", "rebuilt_at"], order: "bank_ref", filters: ["bank_ref"] },
  operator_earnings_ledger: { table: "operator_earnings_ledger", columns: ["id", "operator_org_id", "accrual_month", "base_amount_cents", "pct_snapshot", "amount_cents", "source_row_count", "is_complete", "incomplete_code", "created_at", "settlement_status"], order: "id", filters: ["operator_org_id", "accrual_month", "settlement_status"] },
  referral_ledger: { table: "referral_ledger", columns: ["id", "saas_referral_id", "referrer_org_id", "referred_org_id", "accrual_month", "cycle_number", "base_snapshot", "base_amount_cents", "pct_snapshot", "amount_cents", "source_row_count", "is_complete", "incomplete_code", "created_at", "settlement_status"], order: "id", filters: ["saas_referral_id", "referrer_org_id", "referred_org_id", "accrual_month", "settlement_status"] },
} as const;

export type DerivedDataset = keyof typeof DERIVED_EXPORTS;
export type ExportFormat = "csv" | "json";

export interface DerivedExportRequest {
  actor: { id: string; role: string };
  dataset: string;
  format: string;
  filters?: Readonly<Record<string, string>>;
  pageSize?: number;
}
export interface DerivedExportDescriptor {
  contentType: string;
  fileName: string;
  normalizedFilters: Readonly<Record<string, string>>;
  stream: ReadableStream<Uint8Array>;
}

const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function createDerivedExport(
  request: DerivedExportRequest,
  repository: AncillaryRepository = createSupabaseAncillaryRepository(),
): DerivedExportDescriptor {
  if (request.actor.role !== "platform_admin" || !UUID.test(request.actor.id)) throw new Error("EXPORT_FORBIDDEN");
  if (!Object.hasOwn(DERIVED_EXPORTS, request.dataset)) throw new Error("EXPORT_DATASET_INVALID");
  if (request.format !== "csv" && request.format !== "json") throw new Error("EXPORT_FORMAT_INVALID");
  const dataset = request.dataset as DerivedDataset;
  const spec = DERIVED_EXPORTS[dataset];
  const pageSize = request.pageSize ?? 500;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1_000) throw new Error("EXPORT_PAGE_SIZE_INVALID");
  const normalized: Record<string, string> = {};
  for (const [key, raw] of Object.entries(request.filters ?? {})) {
    if (!(spec.filters as readonly string[]).includes(key)) throw new Error("EXPORT_FILTER_INVALID");
    const value = raw.trim();
    if (!value || value.length > 128 || (key.endsWith("_id") && !UUID.test(value))) throw new Error("EXPORT_FILTER_INVALID");
    normalized[key] = value;
  }

  let offset = 0;
  let emitted = 0;
  let firstJson = true;
  let finished = false;
  let audited = false;
  const audit = async (status: "complete" | "partial") => {
    if (audited) return;
    audited = true;
    await repository.auditExport({ actorId: request.actor.id, dataset, format: request.format, filters: normalized, rowCount: emitted, status });
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (request.format === "csv") controller.enqueue(encoder.encode(`${spec.columns.join(",")}\n`));
      else controller.enqueue(encoder.encode("["));
    },
    async pull(controller) {
      if (finished) return;
      try {
        const rows = await repository.readExportPage({ table: spec.table, columns: spec.columns.join(","), order: spec.order, filters: normalized, offset, limit: pageSize });
        if (rows.length > 0) {
          const chunk = request.format === "csv"
            ? rows.map((row) => `${spec.columns.map((column) => csvCell(row[column])).join(",")}\n`).join("")
            : rows.map((row, index) => `${firstJson && index === 0 ? "" : ","}${JSON.stringify(row)}`).join("");
          controller.enqueue(encoder.encode(chunk));
          firstJson = false;
          emitted += rows.length;
          offset += rows.length;
        }
        if (rows.length < pageSize) {
          if (request.format === "json") controller.enqueue(encoder.encode("]"));
          finished = true;
          await audit("complete");
          controller.close();
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      if (!finished) {
        finished = true;
        await audit("partial");
      }
    },
  });
  return {
    contentType: request.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
    fileName: `${dataset}.${request.format}`,
    normalizedFilters: normalized,
    stream,
  };
}
