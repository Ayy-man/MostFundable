// A refusal code, in words a person can act on.
//
// `AssistantError`'s message IS its code — deliberately, so no table name or row value has a way to
// reach a client (`lib/assistant/types.ts` says so and `lib/support/errors.ts` does the same). The
// consequence is that the sentence has to be written here, and `Record<AssistantErrorCode, …>` is
// what makes a new code a compile error rather than a code that renders as nothing.
//
// The answer outcomes are deliberately separate because the next action differs. An empty authorized
// read and a scope or policy refusal will not change if the same question is repeated; a provider
// outage might, and so might an answer the parser refused for its shape — which is why
// `ASSISTANT_ANSWER_MALFORMED` is separate from the outage code rather than folded into it: the
// retry advice is the same, the sentence is not, and telling a reader the provider was unreachable
// when it answered is simply false. `ASSISTANT_RESULT_TOO_LARGE` is the opposite case: the read
// worked and overflowed, so repeating the question cannot help and the copy asks for a narrower one.
// `ASSISTANT_ANSWER_UNAVAILABLE` retains its old scope-aware copy and retry behavior so
// a stream opened by an older deployment still renders, but new server paths emit one of the four
// specific codes instead.

import type { AssistantErrorCode, AssistantScope } from "@/lib/assistant/types";

const SHARED: Readonly<Record<AssistantErrorCode, string>> = {
  ASSISTANT_ACTOR_REQUIRED: "Your session has ended. Sign in again to keep asking.",
  ASSISTANT_ACTOR_UNKNOWN: "Your session has ended. Sign in again to keep asking.",
  ASSISTANT_ANSWER_UNAVAILABLE: "",
  ASSISTANT_FORBIDDEN: "This conversation is not yours to read.",
  ASSISTANT_NO_MATCHING_RECORDS: "",
  ASSISTANT_DATA_UNAVAILABLE: "The permitted workspace records could not be read just now. Try again.",
  ASSISTANT_NOT_FOUND: "This conversation is no longer available.",
  ASSISTANT_OUT_OF_SCOPE: "That question falls outside the data this assistant is allowed to use.",
  ASSISTANT_POLICY_REFUSED: "I can't answer that question because the assistant's policy rules do not allow it.",
  ASSISTANT_PROVIDER_UNAVAILABLE: "The AI provider could not be reached just now. Try again.",
  ASSISTANT_ANSWER_MALFORMED: "The AI provider could not return a usable answer just now. Try again.",
  ASSISTANT_RESULT_TOO_LARGE: "More records matched than one answer can list in full. Ask about a single client or lender.",
  ASSISTANT_REQUEST_INVALID: "That question could not be sent. Try a shorter one.",
  ASSISTANT_SCOPE_INVALID: "This account cannot open a conversation in this workspace.",
  ASSISTANT_SCOPE_UNAVAILABLE: "This workspace has no assistant behind it yet.",
  ASSISTANT_UNAVAILABLE: "The assistant could not be reached just now.",
};

/** The one sentence whose wording depends on which records the scope reads. */
const NO_ANSWER: Readonly<Record<AssistantScope, string>> = {
  admin: "No answer came back from the recorded platform data. Try asking it a different way.",
  operator: "No answer came back from the records your session can read. Try asking it a different way.",
};

const NO_MATCHING_RECORDS: Readonly<Record<AssistantScope, string>> = {
  admin: "I don't see any matching operators or platform records in the data available here.",
  operator: "I don't see any matching clients or workspace records in the data your session can read.",
};

export function assistantErrorMessage(code: AssistantErrorCode, scope: AssistantScope): string {
  if (code === "ASSISTANT_ANSWER_UNAVAILABLE") return NO_ANSWER[scope];
  if (code === "ASSISTANT_NO_MATCHING_RECORDS") return NO_MATCHING_RECORDS[scope];
  return SHARED[code];
}

/**
 * Whether asking the same question again is worth offering.
 *
 * A signed-out session, an empty authorized read, and a scope or policy refusal do not change when
 * repeated. Provider failures can, while the two legacy transient codes retain their established
 * behavior until old responses have aged out.
 */
export function assistantErrorIsRetryable(code: AssistantErrorCode): boolean {
  return (
    code === "ASSISTANT_PROVIDER_UNAVAILABLE"
    || code === "ASSISTANT_ANSWER_MALFORMED"
    || code === "ASSISTANT_DATA_UNAVAILABLE"
    || code === "ASSISTANT_ANSWER_UNAVAILABLE"
    || code === "ASSISTANT_UNAVAILABLE"
  );
}
