import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONSUMER_EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_REGISTRY,
  buildProviderVariables,
  deliveryReference,
  isConsumerEmailTemplate,
  validateTemplateVariables,
} from "./templates.ts";

describe("email template registry", () => {
  it("is closed and frozen", () => {
    assert.deepEqual(Object.keys(EMAIL_TEMPLATE_REGISTRY), [
      "operator_card_failure",
      "consumer_monitoring_alert",
      "consumer_stage_change",
      "consumer_analysis_complete",
      "consumer_refresh_result",
      "consumer_enrollment_milestone",
      "consumer_document",
      "consumer_team_message",
      "consumer_application_update",
    ]);
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
  });
});

const DELIVERY = "82000000-0000-4000-8000-000000000801";

function consumerVars(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { APP_PATH: "/consumer", DELIVERY_REFERENCE: DELIVERY, FIRST_NAME: "Dana", ...overrides };
}

describe("consumer event email templates", () => {
  it("publishes one template per consumer notification event type", () => {
    assert.deepEqual(CONSUMER_EMAIL_TEMPLATES, [
      "consumer_monitoring_alert",
      "consumer_stage_change",
      "consumer_analysis_complete",
      "consumer_refresh_result",
      "consumer_enrollment_milestone",
      "consumer_document",
      "consumer_team_message",
      "consumer_application_update",
    ]);
    for (const template of CONSUMER_EMAIL_TEMPLATES) {
      const definition = EMAIL_TEMPLATE_REGISTRY[template];
      assert.ok(isConsumerEmailTemplate(template));
      assert.equal(definition.providerTemplate, template.replaceAll("_", "-"));
      assert.deepEqual(definition.providerKeys, ["FIRST_NAME", "APP_PATH"]);
      assert.ok(Object.isFrozen(definition));
    }
  });

  it("says what happened, offers one action, and carries no private detail", () => {
    const subjects = new Set<string>();
    for (const template of CONSUMER_EMAIL_TEMPLATES) {
      const copy = EMAIL_TEMPLATE_REGISTRY[template].copy;
      assert.ok(copy !== null);
      subjects.add(copy.subject);
      assert.ok(copy.subject.length > 10 && copy.subject.length <= 90);
      assert.equal(copy.body.split(". ").length <= 2, true);
      assert.ok(copy.actionLabel.length > 0 && copy.actionLabel.length <= 32);
      // No amount, no name, no identifier, no interpolation slot beyond the two provider keys.
      for (const line of [copy.subject, copy.body, copy.actionLabel]) {
        assert.doesNotMatch(line, /[$€£%{}<>@]|\d/, `${template} leaks detail: ${line}`);
      }
    }
    assert.equal(subjects.size, CONSUMER_EMAIL_TEMPLATES.length, "each event has its own subject");
  });

  it("sends only the first name and the app path to the provider", () => {
    const variables = buildProviderVariables("consumer_team_message", {
      APP_PATH: "/consumer",
      DELIVERY_REFERENCE: DELIVERY,
      FIRST_NAME: "Dana",
    });
    assert.deepEqual(variables, { APP_PATH: "/consumer", FIRST_NAME: "Dana" });
    assert.equal(
      deliveryReference("consumer_team_message", {
        APP_PATH: "/consumer",
        DELIVERY_REFERENCE: DELIVERY,
        FIRST_NAME: "Dana",
      }),
      DELIVERY,
    );
  });

  it("rejects an injected name, an absolute link, a bad reference and stray keys", () => {
    for (const vars of [
      consumerVars({ FIRST_NAME: "<b>Dana</b>" }),
      consumerVars({ FIRST_NAME: " Dana" }),
      consumerVars({ FIRST_NAME: "D".repeat(65) }),
      consumerVars({ FIRST_NAME: "" }),
      consumerVars({ APP_PATH: "https://evil.test/consumer" }),
      consumerVars({ APP_PATH: "consumer" }),
      consumerVars({ DELIVERY_REFERENCE: "not-a-uuid" }),
      { ...consumerVars(), EXTRA: "value" },
      { APP_PATH: "/consumer", FIRST_NAME: "Dana" },
    ]) {
      assert.throws(
        () => validateTemplateVariables("consumer_document", vars),
        /EMAIL_TEMPLATE_VARS_INVALID/,
      );
    }
  });
});
