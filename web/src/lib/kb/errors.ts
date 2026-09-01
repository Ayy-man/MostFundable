import "server-only";

export const KB_ANSWER_ERROR_CODES = ["KB_QUESTION_INVALID", "KB_GROUNDING_UNAVAILABLE", "KB_ANSWER_UNAVAILABLE"] as const;
export type KbAnswerErrorCode = (typeof KB_ANSWER_ERROR_CODES)[number];

export class KbAnswerError extends Error {
  readonly code: KbAnswerErrorCode;
  constructor(code: KbAnswerErrorCode) {
    super(code);
    this.name = "KbAnswerError";
    this.code = code;
  }
}
