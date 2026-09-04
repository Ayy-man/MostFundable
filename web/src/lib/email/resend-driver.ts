import { buildProviderVariables, validateTemplateVariables } from "./templates.ts";
import type { EmailReceiptRepository } from "./repository.ts";
import type { EmailDriver, EmailSendInput, EmailSendReceipt } from "./types.ts";

export const RESEND_EMAIL_URL = "https://api.resend.com/emails";
const RESPONSE_LIMIT_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAILBOX = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const PROVIDER_ID = /^[A-Za-z0-9._:-]{1,255}$/;

export type ResendEmailErrorCode =
  | "RESEND_CONFIGURATION_INVALID"
  | "RESEND_INPUT_INVALID"
  | "RESEND_TIMEOUT"
  | "RESEND_NETWORK"
  | "RESEND_HTTP"
  | "RESEND_RESPONSE_TOO_LARGE"
  | "RESEND_ENVELOPE_INVALID";

export class ResendEmailError extends Error {
  readonly code: ResendEmailErrorCode;
  readonly status: number | null;

  constructor(code: ResendEmailErrorCode, status: number | null = null) {
    super(code);
    this.name = "ResendEmailError";
    this.code = code;
    this.status = status;
  }
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface ResendEmailDriverOptions {
  readonly apiKey: string | undefined;
  readonly fromAddress: string | undefined;
  readonly repository: EmailReceiptRepository;
  readonly resolveOrgDisplayName: (orgId: string) => Promise<string>;
  readonly fetch?: typeof globalThis.fetch;
  readonly setTimer?: (callback: () => void, milliseconds: number) => TimerHandle;
  readonly clearTimer?: (handle: TimerHandle) => void;
}

function mailbox(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 3
    || normalized.length > 320
    || /[\r\n]/.test(normalized)
    || !MAILBOX.test(normalized)
  ) {
    throw new ResendEmailError("RESEND_INPUT_INVALID");
  }
  return normalized;
}

function displayName(value: string): string {
  if (/[\r\n<>]/.test(value)) throw new ResendEmailError("RESEND_INPUT_INVALID");
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    normalized.length < 1
    || normalized.length > 100
  ) {
    throw new ResendEmailError("RESEND_INPUT_INVALID");
  }
  return normalized;
}

async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > RESPONSE_LIMIT_BYTES) {
    throw new ResendEmailError("RESEND_RESPONSE_TOO_LARGE", response.status);
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > RESPONSE_LIMIT_BYTES) {
      await reader.cancel();
      throw new ResendEmailError("RESEND_RESPONSE_TOO_LARGE", response.status);
    }
    output += decoder.decode(chunk.value, { stream: true });
  }
  return output + decoder.decode();
}

function providerId(body: string, status: number): string {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch {
    throw new ResendEmailError("RESEND_ENVELOPE_INVALID", status);
  }
  if (
    typeof parsed !== "object"
    || parsed === null
    || Array.isArray(parsed)
    || typeof (parsed as { id?: unknown }).id !== "string"
    || !PROVIDER_ID.test((parsed as { id: string }).id)
  ) {
    throw new ResendEmailError("RESEND_ENVELOPE_INVALID", status);
  }
  return (parsed as { id: string }).id;
}

function receipt(input: {
  driver: "resend";
  receiptId: string;
  providerRef: string;
  attemptCount: number;
}): EmailSendReceipt {
  return { ...input, status: "accepted" };
}

export function createResendEmailDriver(options: ResendEmailDriverOptions): EmailDriver {
  const key = options.apiKey?.trim();
  const configuredFrom = options.fromAddress?.trim();
  if (!key || !configuredFrom) throw new ResendEmailError("RESEND_CONFIGURATION_INVALID");
  const fromMailbox = mailbox(configuredFrom);
  const fetcher = options.fetch ?? globalThis.fetch;
  const schedule = options.setTimer ?? setTimeout;
  const cancel = options.clearTimer ?? clearTimeout;

  return {
    async send<T extends "operator_card_failure" | "crs_alert">(
      input: EmailSendInput<T>,
    ): Promise<EmailSendReceipt> {
      if (!UUID.test(input.orgId) || input.template !== "operator_card_failure") {
        throw new ResendEmailError("RESEND_INPUT_INVALID");
      }
      const variables = validateTemplateVariables("operator_card_failure", input.vars);
      const providerVariables = buildProviderVariables("operator_card_failure", variables);
      const recipient = mailbox(input.to);
      const sender = await options.resolveOrgDisplayName(input.orgId).then(
        (value) => ({ ok: true as const, value: displayName(value) }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      if (!sender.ok && sender.error instanceof ResendEmailError) throw sender.error;
      const claimed = await options.repository.claim({
        deliveryId: variables.DELIVERY_REFERENCE,
        template: "operator_card_failure",
        recipient,
      });
      if (claimed.status === "accepted" && claimed.providerRef !== null) {
        return receipt({
          driver: "resend",
          receiptId: claimed.receiptId,
          providerRef: claimed.providerRef,
          attemptCount: claimed.attemptCount,
        });
      }
      if (!sender.ok) throw sender.error;
      const senderName = sender.value;

      const controller = new AbortController();
      const timer = schedule(() => controller.abort(), TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetcher(RESEND_EMAIL_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `email-outbox:${claimed.receiptId}`,
          },
          body: JSON.stringify({
            from: `${senderName} <${fromMailbox}>`,
            to: [recipient],
            template: {
              id: "operator-card-failure",
              variables: providerVariables,
            },
          }),
          signal: controller.signal,
        });
      } catch {
        const code = controller.signal.aborted ? "RESEND_TIMEOUT" : "RESEND_NETWORK";
        await options.repository.fail(claimed.receiptId, code).catch(() => undefined);
        throw new ResendEmailError(code);
      } finally {
        cancel(timer);
      }

      try {
        const body = await readBounded(response);
        if (!response.ok) throw new ResendEmailError("RESEND_HTTP", response.status);
        const id = providerId(body, response.status);
        const accepted = await options.repository.accept(claimed.receiptId, id);
        if (accepted.status !== "accepted" || accepted.providerRef === null) {
          throw new ResendEmailError("RESEND_ENVELOPE_INVALID", response.status);
        }
        return receipt({
          driver: "resend",
          receiptId: accepted.receiptId,
          providerRef: accepted.providerRef,
          attemptCount: accepted.attemptCount,
        });
      } catch (error) {
        const stable = error instanceof ResendEmailError ? error : new ResendEmailError("RESEND_ENVELOPE_INVALID", response.status);
        await options.repository.fail(claimed.receiptId, stable.code).catch(() => undefined);
        throw stable;
      }
    },
  };
}
