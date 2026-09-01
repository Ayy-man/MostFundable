import { AppError } from "@/lib/enrollment/errors";
import type {
  EnrollRequest,
  IdvSubmitBody,
  ReauthorizeConsentBody,
  RevokeConsentBody,
} from "@/lib/enrollment/types";

const ENROLL_KEYS = [
  "aff",
  "draftId",
  "name",
  "email",
  "phone",
  "monitoring",
  "analysis",
  "signature",
  "crsIdentity",
] as const;
const PAYMENT_KEYS = new Set([
  "cardNumber",
  "pan",
  "cvc",
  "cvv",
  "expiry",
  "expMonth",
  "expYear",
  "number",
]);
// Postgres `uuid` shape, not strict RFC-4122: seeded ids carry zero version/variant nibbles (GAPS G-3B-06/07).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEnrollmentId(input: unknown): string {
  if (typeof input !== "string" || !UUID_PATTERN.test(input)) invalid();
  return input;
}

export function parseEnrollRequest(input: unknown): EnrollRequest {
  const value = objectValue(input);
  rejectUnknown(value, ENROLL_KEYS);

  const draftId = requiredString(value, "draftId");
  const email = requiredString(value, "email");
  if (!UUID_PATTERN.test(draftId) || !EMAIL_PATTERN.test(email)) invalid();
  if (value.monitoring !== true || value.analysis !== true) invalid();

  const aff = optionalSlug(value, "aff");
  const crsIdentity = optionalCrsIdentity(value.crsIdentity);
  return {
    ...(aff === undefined ? {} : { aff }),
    draftId,
    name: requiredString(value, "name"),
    email,
    phone: requiredString(value, "phone"),
    monitoring: true,
    analysis: true,
    signature: requiredString(value, "signature"),
    ...(crsIdentity === undefined ? {} : { crsIdentity }),
  };
}

function optionalCrsIdentity(input: unknown): EnrollRequest["crsIdentity"] {
  if (input === undefined) return undefined;
  const value = objectValue(input);
  rejectUnknown(value, ["dateOfBirth", "ssn", "address"]);
  const address = objectValue(value.address);
  rejectUnknown(address, ["line1", "line2", "city", "state", "postalCode"]);
  const dateOfBirth = requiredString(value, "dateOfBirth");
  const ssn = requiredString(value, "ssn");
  const state = requiredString(address, "state").toUpperCase();
  const postalCode = requiredString(address, "postalCode");
  const parsedBirthDate = new Date(`${dateOfBirth}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) ||
    Number.isNaN(parsedBirthDate.getTime()) ||
    parsedBirthDate.toISOString().slice(0, 10) !== dateOfBirth
  ) invalid();
  if (!/^\d{9}$/.test(ssn) || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(?:-\d{4})?$/.test(postalCode)) invalid();
  const line2 = optionalString(address, "line2");
  return {
    dateOfBirth,
    ssn,
    address: {
      line1: requiredString(address, "line1"),
      ...(line2 === undefined ? {} : { line2 }),
      city: requiredString(address, "city"),
      state,
      postalCode,
    },
  };
}

function optionalSlug(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== "string") invalid();
  const slug = field.trim();
  if (slug.length === 0 || slug.length > 255) invalid();
  return slug;
}

export function parseIdvSubmitBody(input: unknown): IdvSubmitBody {
  const value = objectValue(input);
  if (value.kind === "smfa_status") {
    rejectUnknown(value, ["kind"]);
    return { kind: "smfa_status" };
  }
  if (value.kind === "sms") {
    rejectUnknown(value, ["kind", "code"]);
    return { kind: "sms", code: requiredString(value, "code") };
  }
  if (value.kind === "quiz") {
    rejectUnknown(value, ["kind", "answers"]);
    if (!Array.isArray(value.answers) || value.answers.length === 0) invalid();
    const answers = value.answers.map((answer) => {
      const row = objectValue(answer);
      rejectUnknown(row, ["questionId", "answerId"]);
      return {
        questionId: requiredString(row, "questionId"),
        answerId: requiredString(row, "answerId"),
      };
    });
    return { kind: "quiz", answers };
  }
  invalid();
}

export function parseRevokeConsentBody(input: unknown): RevokeConsentBody {
  const value = objectValue(input);
  rejectUnknown(value, ["kind"]);
  if (value.kind !== "monitoring" && value.kind !== "analysis") invalid();
  return { kind: value.kind };
}

export function parseReauthorizeConsentBody(input: unknown): ReauthorizeConsentBody {
  const value = objectValue(input);
  rejectUnknown(value, ["accepted", "draftId", "kind", "signature"]);
  const draftId = requiredString(value, "draftId");
  const signature = requiredString(value, "signature");
  if (
    value.accepted !== true ||
    !UUID_PATTERN.test(draftId) ||
    (value.kind !== "monitoring" && value.kind !== "analysis") ||
    signature.length > 200
  ) invalid();
  return { accepted: true, draftId, kind: value.kind, signature };
}

function objectValue(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) invalid();
  return input as Record<string, unknown>;
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const keys = Object.keys(value);
  if (keys.some((key) => PAYMENT_KEYS.has(key))) {
    throw new AppError(
      "payment_field_rejected",
      "Payment details must be submitted through the authorized payment flow.",
    );
  }
  if (keys.some((key) => !allowed.includes(key))) invalid();
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.trim() === "") invalid();
  return field.trim();
}

function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== "string" || field.trim() === "") invalid();
  return field.trim();
}

function invalid(): never {
  throw new AppError("invalid_payload", "The request payload is invalid.");
}
