import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { DEMO_CLIENTS } from "@/lib/demo/feedback-fixtures";
import {
  IDV_LOCK_DURATION_HOURS,
  MAX_IDV_ATTEMPTS,
  MOCK_QUIZ_DECOYS,
  MOCK_QUIZ_NO_BUSINESS_ANSWER,
  mockQuizAnswer,
  mockQuizOptions,
} from "@/lib/idv/config";
import { createMockIdvAdapter } from "@/lib/idv/mock";
import type { CrsMemberRef, IdvSubmitRequest } from "@/lib/idv/types";

/**
 * (The catalog sweep that proves no fixture persona is named lives in
 * `quiz-catalog.test.ts`, which imports none of the exports this fix added so it
 * could be watched failing on the pre-fix tree.)
 *
 * The mock identity quiz asks "Which business is associated with this
 * application?" and it used to grade the answer against "Okafor Design Co" —
 * the fixture persona's company — with two more strangers' companies as the
 * other options. A signed-in consumer was therefore asked to prove their
 * identity by picking somebody else's business, and the only passable option was
 * the wrong one.
 *
 * The fix derives the graded answer from the client's own `business_name`. What
 * this file guards is the two halves of that staying in step: the option list the
 * browser renders and the answer the mock grades both come out of
 * `mockQuizAnswer`, and the state machine around it — the pass/retry/lock
 * transitions and the two-attempt budget — is byte-for-byte what it was.
 *
 * The persona premise is derived from `DEMO_CLIENTS` at test time, so renaming a
 * fixture client renames what this guard looks for rather than quietly retiring
 * it.
 *
 * Watched failing on the pre-fix tree: `mockQuizAnswer` did not exist, and the
 * source sweep found `"Okafor Design Co"` in `config.ts`.
 */

const HOUR_MS = 60 * 60 * 1000;
const MEMBER_REF = "mock_clean_1" as CrsMemberRef;
function quiz(answer: string, overrides: Partial<IdvSubmitRequest> = {}): IdvSubmitRequest {
  return {
    attemptsUsed: 0,
    enrollmentId: "00000000-0000-0000-0000-0000000004a1",
    maxAttempts: MAX_IDV_ATTEMPTS,
    memberRef: MEMBER_REF,
    submission: { kind: "quiz", answers: [{ answerId: answer, questionId: "business-association" }] },
    ...overrides,
  };
}

describe("the identity quiz names the consumer's own business", () => {
  it("offers the client's own business as the answer, beside fixed decoys", () => {
    const options = mockQuizOptions("Northbridge Widgets LLC");
    assert.equal(options[0], "Northbridge Widgets LLC", "the client's own business is not offered first");
    assert.deepEqual(
      [...options].slice(1),
      [...MOCK_QUIZ_DECOYS],
      "the option list no longer carries exactly the fixed decoys beside the answer",
    );
    assert.ok(
      options.includes(mockQuizAnswer("Northbridge Widgets LLC")),
      "the graded answer is not among the options, which makes the quiz unpassable",
    );
  });

  it("states the absence when no business is recorded, and stays passable", () => {
    assert.equal(mockQuizAnswer(null), MOCK_QUIZ_NO_BUSINESS_ANSWER);
    assert.equal(mockQuizAnswer("   "), MOCK_QUIZ_NO_BUSINESS_ANSWER);
    assert.ok(
      mockQuizOptions(null).includes(MOCK_QUIZ_NO_BUSINESS_ANSWER),
      "a client with no business on file has no passable option",
    );
  });

  it("grades the supplied business as the pass", async () => {
    const adapter = createMockIdvAdapter();
    const business = "Northbridge Widgets LLC";
    const passed = await adapter.submit(quiz(mockQuizAnswer(business), { businessName: business }));
    assert.equal(passed.outcome, "pass", "the client's own business does not grade as correct");

    // And the option the old catalog graded as correct is now just an answer
    // like any other: on a client whose business is something else, it fails.
    const persona = DEMO_CLIENTS[0]?.business;
    assert.ok(persona, "the fixture roster has no business to test against");
    assert.notEqual(persona, business, "the roster's first business collides with the test's");
    const failed = await adapter.submit(quiz(persona, { businessName: business }));
    assert.equal(failed.outcome, "retry", "a business that is not this client's still grades as correct");
  });

  it("leaves the transitions and the two-attempt budget exactly as they were", async () => {
    const adapter = createMockIdvAdapter();
    const business = "Northbridge Widgets LLC";

    const first = await adapter.submit(quiz(MOCK_QUIZ_DECOYS[0], { businessName: business }));
    assert.equal(first.outcome, "retry", "the first wrong answer no longer retries");
    assert.equal(
      first.outcome === "retry" ? first.challenge.attemptsRemaining : -1,
      MAX_IDV_ATTEMPTS - 1,
      "the attempt budget changed with the answer",
    );

    const before = Date.now();
    const second = await adapter.submit(
      quiz(MOCK_QUIZ_DECOYS[0], { attemptsUsed: MAX_IDV_ATTEMPTS - 1, businessName: business }),
    );
    assert.equal(second.outcome, "locked", "the final wrong answer no longer locks");
    const lockedUntil = second.outcome === "locked" ? Date.parse(second.lockedUntil) : 0;
    assert.ok(
      Math.abs(lockedUntil - (before + IDV_LOCK_DURATION_HOURS * HOUR_MS)) <= 60_000,
      "the lock window changed with the answer",
    );
  });

  it("keeps its deterministic fallback when no client row is supplied", async () => {
    // The CRS-free contract tests and the E2E parked arm submit without a client
    // row; those paths must grade exactly as before.
    const adapter = createMockIdvAdapter();
    const fallback = await adapter.submit(quiz(MOCK_QUIZ_NO_BUSINESS_ANSWER));
    assert.equal(fallback.outcome, "pass", "the no-business fallback answer stopped passing");
    const wrong = await adapter.submit(quiz("incorrect"));
    assert.equal(wrong.outcome, "retry", "an unrelated answer stopped failing");
  });
});

describe("the enrollment path supplies the client row", () => {
  it("reads business_name from the clients row it already joins", () => {
    // Premise, derived: `readEnrollmentState` joins `clients` for the consent and
    // milestone rows, so the business name costs no extra query — and if that
    // join ever goes, the mock silently falls back to the no-business answer and
    // this says so.
    const repository = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../enrollment/repository.ts"),
      "utf8",
    );
    const select = repository.slice(
      repository.indexOf("export async function readEnrollmentState"),
    );
    assert.match(
      select.slice(0, 900),
      /client:clients!inner\([^)]*business_name/,
      "the enrollment read no longer selects business_name, so the quiz cannot name the client's own business",
    );

    const service = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../enrollment/service.ts"),
      "utf8",
    );
    const submitStart = service.indexOf("export async function submitIdv");
    const submit = service.slice(
      submitStart,
      service.indexOf("export async function revokeConsent", submitStart),
    );
    assert.match(
      submit,
      /businessName: state\.businessName/,
      "submitIdv no longer tells the adapter whose enrollment it is holding",
    );
  });
});
