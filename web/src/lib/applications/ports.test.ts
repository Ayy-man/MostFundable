import assert from "node:assert/strict";
import { test } from "node:test";

import { featureFlag, resolveDriver } from "@/lib/env";

import { noopVaultWritebackDriver, systemApplicationsClock } from "./ports.ts";
import {
  APPLICATION_CONSUMER_STATUS_VALUES,
  APPLICATION_NOTE_AUTHOR_KIND_VALUES,
  APPLICATION_OPERATOR_STATUS_VALUES,
  APPLICATION_VISIBILITY_VALUES,
  APPLICATIONS_ERROR_CODES,
  ApplicationsError,
  BANK_HEAT_LEVEL_VALUES,
  OUTCOME_JOB_STATUS_VALUES,
  OUTCOME_KIND_VALUES,
  OUTCOME_NOTIFICATION_KIND_VALUES,
  OUTCOME_REVIEW_STATE_VALUES,
  OUTCOME_STATE_VALUES,
  VAULT_WRITEBACK_STATE_VALUES,
  VAULT_WRITEBACK_TARGET_VALUES,
  WRITEBACK_RECORDED_LABEL,
  type ApplicationConsumerStatus,
  type ApplicationNoteAuthorKind,
  type ApplicationOperatorStatus,
  type ApplicationVisibility,
  type ApplicationsErrorCode,
  type BankHeatLevel,
  type OutcomeJobStatus,
  type OutcomeKind,
  type OutcomeNotificationKind,
  type OutcomeReviewState,
  type OutcomeState,
  type VaultWritebackState,
  type VaultWritebackTarget,
} from "./types.ts";

// No environment is mutated anywhere in this file. `EnvSource` exists so a test
// can pass an object literal, which keeps these cases order-independent and
// leaves the ambient shell out of the result.

test("FEATURE_APPLICATIONS is off with no environment at all", () => {
  assert.equal(featureFlag("FEATURE_APPLICATIONS", {}), false);
});

test("FEATURE_APPLICATIONS stays off for blank, falsey and junk values", () => {
  for (const value of ["", " ", "0", "false", "off", "no", "maybe", "TRUE!"]) {
    assert.equal(
      featureFlag("FEATURE_APPLICATIONS", { FEATURE_APPLICATIONS: value }),
      false,
      `${JSON.stringify(value)} must not turn the flag on`,
    );
  }
});

test("FEATURE_APPLICATIONS turns on only for the four listed values", () => {
  for (const value of ["1", "true", "on", "yes"]) {
    assert.equal(
      featureFlag("FEATURE_APPLICATIONS", { FEATURE_APPLICATIONS: value }),
      true,
      `${value} is in TRUTHY_FLAG_VALUES and must turn the flag on`,
    );
  }
});

test("the vault driver falls back to fixture with nothing configured", () => {
  assert.equal(resolveDriver("vault", {}), "fixture");
});

test("an explicit supabase write-back arm with no keys throws rather than degrading", () => {
  assert.throws(
    () => resolveDriver("vault", { VAULT_DRIVER: "supabase" }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /VAULT_DRIVER/);
      assert.match(message, /VAULT_SUPABASE_URL|VAULT_SERVICE_KEY/);
      return true;
    },
  );
});

test("the no-op write-back driver is frozen and leaves the row recorded", async () => {
  assert.equal(Object.isFrozen(noopVaultWritebackDriver), true);

  const result = await noopVaultWritebackDriver.deliver({
    id: "00000000-0000-0000-0000-000000000001",
    outcomeId: "00000000-0000-0000-0000-000000000002",
    bankRef: "example-bank",
    target: "bank_datapoints",
    source: "mostfundable",
    payload: {},
    state: "recorded",
    recordedAt: "2026-08-16T00:00:00.000Z",
    failureCode: null,
  });

  // Not `delivered`. Nothing has been sent, and the label the surface renders
  // says so too.
  assert.deepEqual(result, { state: "recorded" });
  assert.equal(WRITEBACK_RECORDED_LABEL, "Recorded for the funding brain.");
});

test("the system clock port is frozen and returns a real date", () => {
  assert.equal(Object.isFrozen(systemApplicationsClock), true);
  assert.ok(systemApplicationsClock.now() instanceof Date);
});

test("every value list matches its union exhaustively", () => {
  // The `satisfies` pairs are the compile-time half: a value list that grows a
  // member the union does not have fails `tsc`, and a union member missing from
  // the list fails the length assertion below.
  const pairs: readonly (readonly [readonly string[], number])[] = [
    [
      APPLICATION_OPERATOR_STATUS_VALUES satisfies readonly ApplicationOperatorStatus[],
      2,
    ],
    [
      APPLICATION_CONSUMER_STATUS_VALUES satisfies readonly ApplicationConsumerStatus[],
      3,
    ],
    [APPLICATION_VISIBILITY_VALUES satisfies readonly ApplicationVisibility[], 3],
    [
      APPLICATION_NOTE_AUTHOR_KIND_VALUES satisfies readonly ApplicationNoteAuthorKind[],
      2,
    ],
    [OUTCOME_KIND_VALUES satisfies readonly OutcomeKind[], 3],
    [OUTCOME_STATE_VALUES satisfies readonly OutcomeState[], 2],
    [OUTCOME_REVIEW_STATE_VALUES satisfies readonly OutcomeReviewState[], 3],
    [
      OUTCOME_NOTIFICATION_KIND_VALUES satisfies readonly OutcomeNotificationKind[],
      2,
    ],
    [OUTCOME_JOB_STATUS_VALUES satisfies readonly OutcomeJobStatus[], 4],
    [VAULT_WRITEBACK_STATE_VALUES satisfies readonly VaultWritebackState[], 3],
    [VAULT_WRITEBACK_TARGET_VALUES satisfies readonly VaultWritebackTarget[], 2],
    [BANK_HEAT_LEVEL_VALUES satisfies readonly BankHeatLevel[], 3],
    [APPLICATIONS_ERROR_CODES satisfies readonly ApplicationsErrorCode[], 8],
  ];

  for (const [values, expected] of pairs) {
    assert.equal(values.length, expected);
    assert.equal(new Set(values).size, expected, "no duplicate members");
    for (const value of values) {
      assert.equal(typeof value, "string");
      assert.notEqual(value.trim(), "");
    }
  }
});

test("an ApplicationsError carries a code and never a database message", () => {
  const error = new ApplicationsError("attestation_required");
  assert.equal(error.name, "ApplicationsError");
  assert.equal(error.code, "attestation_required");
  assert.equal(error.message, "Applications operation failed");
});
