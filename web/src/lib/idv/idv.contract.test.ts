import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  IDV_LOCK_DURATION_HOURS,
  MAX_IDV_ATTEMPTS,
  MOCK_SMS_CODE,
} from "@/lib/idv/config";
import { createMockIdvAdapter } from "@/lib/idv/mock";
import type { CrsMemberRef, IdvAdapter } from "@/lib/idv/types";

const MEMBER_REF = "mock_member_contract" as CrsMemberRef;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

test("the mock start returns a deterministic member reference accepted by the data driver", async () => {
  const adapter = createMockIdvAdapter();
  const request = {
    enrollmentId: "12345678-0000-0000-0000-000000000001",
    clientId: "a3000000-0000-0000-0000-000000000001",
    identity: {
      email: "local-persona@example.invalid",
      phone: "+15555550100",
      fullName: "Local Persona",
    },
  };

  const first = await adapter.start(request);
  const second = await adapter.start(request);

  assert.equal(first.memberRef, "mock_clean_305419896");
  assert.equal(second.memberRef, first.memberRef);
  assert.match(first.memberRef, /^mock_(clean|derog|thin_file|no_hit)_\d+$/);
});

type ContractOptions = { skip: false } | { skip: string };

function contract(
  name: string,
  make: () => IdvAdapter,
  options: ContractOptions,
): void {
  describe(`${name} IDV contract`, () => {
    const run = (title: string, fn: () => Promise<void>) => {
      if (options.skip) test(title, { skip: options.skip }, fn);
      else test(title, fn);
    };

    run("the correct SMS code passes", async () => {
      const result = await make().submit({
        enrollmentId: "enrollment-contract",
        memberRef: MEMBER_REF,
        submission: { kind: "sms", code: MOCK_SMS_CODE },
        attemptsUsed: 0,
        maxAttempts: MAX_IDV_ATTEMPTS,
      });
      assert.equal(result.outcome, "pass", "the matching SMS code must pass");
    });

    run("a wrong SMS code advances to the quiz", async () => {
      const result = await make().submit({
        enrollmentId: "enrollment-contract",
        memberRef: MEMBER_REF,
        submission: { kind: "sms", code: "wrong" },
        attemptsUsed: 0,
        maxAttempts: MAX_IDV_ATTEMPTS,
      });
      assert.equal(result.outcome, "retry", "a wrong SMS code must allow the quiz");
      assert.equal(
        result.outcome === "retry" ? result.challenge.kind : undefined,
        "quiz",
        "the next challenge must be the identity quiz",
      );
    });

    run("the first wrong quiz answer retries", async () => {
      const result = await make().submit({
        enrollmentId: "enrollment-contract",
        memberRef: MEMBER_REF,
        submission: {
          kind: "quiz",
          answers: [{ questionId: "business", answerId: "wrong" }],
        },
        attemptsUsed: 0,
        maxAttempts: MAX_IDV_ATTEMPTS,
      });
      assert.equal(result.outcome, "retry", "the first wrong quiz answer must retry");
      assert.equal(
        result.outcome === "retry" ? result.challenge.attemptsRemaining : 0,
        MAX_IDV_ATTEMPTS - 1,
        "one quiz attempt must remain",
      );
    });

    run("the second wrong quiz answer locks for the configured window", async () => {
      const before = Date.now();
      const result = await make().submit({
        enrollmentId: "enrollment-contract",
        memberRef: MEMBER_REF,
        submission: {
          kind: "quiz",
          answers: [{ questionId: "business", answerId: "wrong" }],
        },
        attemptsUsed: MAX_IDV_ATTEMPTS - 1,
        maxAttempts: MAX_IDV_ATTEMPTS,
      });
      assert.equal(result.outcome, "locked", "the final wrong answer must lock IDV");
      const lockedUntil =
        result.outcome === "locked" ? Date.parse(result.lockedUntil) : 0;
      const expected = before + IDV_LOCK_DURATION_HOURS * HOUR_MS;
      assert.ok(
        Math.abs(lockedUntil - expected) <= MINUTE_MS,
        "the lock deadline must use the configured duration",
      );
    });

    run("identical submissions produce identical outcomes", async () => {
      const submission = {
        enrollmentId: "enrollment-contract",
        memberRef: MEMBER_REF,
        submission: {
          kind: "quiz" as const,
          answers: [{ questionId: "business", answerId: "wrong" }],
        },
        attemptsUsed: 0,
        maxAttempts: MAX_IDV_ATTEMPTS,
      };
      const adapter = make();
      const first = await adapter.submit(submission);
      const second = await adapter.submit(submission);
      // Timestamps are stamped from the wall clock at submit time, so two calls
      // made milliseconds apart legitimately differ there; the contract is that
      // every other field reproduces exactly and the clocks stay in step.
      const stripClocks = (result: unknown): unknown =>
        JSON.parse(
          JSON.stringify(result, (key, value): unknown =>
            key === "expiresAt" || key === "verifiedAt" || key === "lockedUntil"
              ? undefined
              : (value as unknown),
          ),
        );
      assert.deepEqual(
        stripClocks(second),
        stripClocks(first),
        "the same quiz input must reproduce its outcome",
      );
      if (first.outcome === "retry" && second.outcome === "retry") {
        const drift = Math.abs(
          Date.parse(second.challenge.expiresAt) -
            Date.parse(first.challenge.expiresAt),
        );
        assert.ok(
          drift <= MINUTE_MS,
          "back-to-back challenge expiries must stay within a minute",
        );
      }
    });
  });
}

contract("mock", createMockIdvAdapter, { skip: false });
