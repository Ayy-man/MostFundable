import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMAIL_TEMPLATE_REGISTRY,
  buildCrsAlertPayload,
  buildProviderVariables,
  validateTemplateVariables,
} from "./templates.ts";

describe("email template registry", () => {
  it("is closed and frozen", () => {
    assert.deepEqual(Object.keys(EMAIL_TEMPLATE_REGISTRY), ["operator_card_failure", "crs_alert"]);
    assert.ok(Object.isFrozen(EMAIL_TEMPLATE_REGISTRY));
    assert.ok(Object.isFrozen(EMAIL_TEMPLATE_REGISTRY.operator_card_failure.internalKeys));
  });

  it("keeps the internal delivery reference out of provider variables", () => {
    const variables = buildProviderVariables("operator_card_failure", {
      DELIVERY_REFERENCE: "82000000-0000-4000-8000-000000000201",
    });
    assert.deepEqual(variables, {});
  });

  it("rejects missing, extra, wrong-type and overlong variables", () => {
    assert.throws(() => validateTemplateVariables("operator_card_failure", {}));
    assert.throws(() => validateTemplateVariables("operator_card_failure", {
      DELIVERY_REFERENCE: "82000000-0000-4000-8000-000000000201",
      EXTRA: "value",
    }));
    assert.throws(() => validateTemplateVariables("operator_card_failure", {
      DELIVERY_REFERENCE: 42,
    }));
    assert.throws(() => validateTemplateVariables("crs_alert", {
      MESSAGE: "Sign in to view",
      CLIENT_REFERENCE: "x".repeat(129),
    }));
  });
});

describe("email payload hygiene", () => {
  it("copies only the fixed sentence and client reference from a poisoned row", () => {
    const row = Object.freeze({
      client_id: "82000000-0000-4000-8000-000000000101",
      alert_type: "private-alert",
      bureau_value: "private-value",
      nested: { confidential: true },
      recipient_profile_id: "private-profile",
    });
    const output = buildCrsAlertPayload(row);
    assert.deepEqual(output, {
      MESSAGE: "Sign in to view",
      CLIENT_REFERENCE: "82000000-0000-4000-8000-000000000101",
    });
    assert.equal(JSON.stringify(output).includes("private"), false);
    assert.ok(Object.isFrozen(output));
  });
});
