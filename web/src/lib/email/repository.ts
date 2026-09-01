import "server-only";

export interface EmailReceiptRecord {
  readonly receiptId: string;
  readonly deliveryId: string;
  readonly template: "operator_card_failure";
  readonly status: "pending" | "accepted" | "failed";
  readonly providerRef: string | null;
  readonly attemptCount: number;
}

export interface EmailReceiptRepository {
  claim(input: {
    readonly deliveryId: string;
    readonly template: "operator_card_failure";
    readonly recipient: string;
  }): Promise<EmailReceiptRecord>;
  accept(receiptId: string, providerRef: string): Promise<EmailReceiptRecord>;
  fail(receiptId: string, errorCode: string): Promise<EmailReceiptRecord>;
}

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface EmailRpcClient {
  rpc(name: string, args: Readonly<Record<string, unknown>>): PromiseLike<RpcResult>;
}

interface ReceiptRow {
  receipt_id: unknown;
  delivery_id: unknown;
  template: unknown;
  status: unknown;
  provider_ref: unknown;
  attempt_count: unknown;
}

function mapReceipt(value: unknown): EmailReceiptRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("EMAIL_RECEIPT_RESULT_INVALID");
  }
  const row = value as ReceiptRow;
  if (
    typeof row.receipt_id !== "string"
    || typeof row.delivery_id !== "string"
    || row.template !== "operator_card_failure"
    || (row.status !== "pending" && row.status !== "accepted" && row.status !== "failed")
    || (row.provider_ref !== null && typeof row.provider_ref !== "string")
    || typeof row.attempt_count !== "number"
    || !Number.isInteger(row.attempt_count)
    || row.attempt_count < 0
  ) {
    throw new Error("EMAIL_RECEIPT_RESULT_INVALID");
  }
  return {
    receiptId: row.receipt_id,
    deliveryId: row.delivery_id,
    template: row.template,
    status: row.status,
    providerRef: row.provider_ref,
    attemptCount: row.attempt_count,
  };
}

async function defaultClient(): Promise<EmailRpcClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as EmailRpcClient;
}

export function createEmailReceiptRepository(
  injectedClient?: EmailRpcClient,
): EmailReceiptRepository {
  async function call(name: string, args: Readonly<Record<string, unknown>>): Promise<EmailReceiptRecord> {
    const client = injectedClient ?? await defaultClient();
    const result = await client.rpc(name, args);
    if (result.error || !Array.isArray(result.data) || result.data.length !== 1) {
      throw new Error("EMAIL_RECEIPT_WRITE_FAILED");
    }
    return mapReceipt(result.data[0]);
  }

  return {
    claim(input) {
      return call("claim_email_delivery", {
        p_delivery_id: input.deliveryId,
        p_template: input.template,
        p_recipient: input.recipient,
      });
    },
    accept(receiptId, providerRef) {
      return call("accept_email_delivery", {
        p_receipt_id: receiptId,
        p_provider_ref: providerRef,
      });
    },
    fail(receiptId, errorCode) {
      return call("fail_email_delivery", {
        p_receipt_id: receiptId,
        p_error_code: errorCode,
      });
    },
  };
}
