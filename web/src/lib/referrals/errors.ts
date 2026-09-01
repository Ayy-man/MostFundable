export type ReferralErrorCode =
  | "disabled"
  | "unavailable"
  | "invalid_token"
  | "not_found"
  | "conflict"
  | "forbidden"
  | "invalid_conversion"
  | "unexpected";

export class ReferralError extends Error {
  readonly code: ReferralErrorCode;

  constructor(
    code: ReferralErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReferralError";
    this.code = code;
  }
}
