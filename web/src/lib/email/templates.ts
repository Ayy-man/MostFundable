import type {
  EmailTemplate,
  EmailTemplateDefinition,
  EmailTemplateRegistry,
  EmailTemplateVars,
} from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_REFERENCE_LIMIT = 128;

function freezeDefinition<T extends EmailTemplate>(
  definition: EmailTemplateDefinition<T>,
): EmailTemplateDefinition<T> {
  Object.freeze(definition.internalKeys);
  Object.freeze(definition.providerKeys);
  return Object.freeze(definition);
}

export const EMAIL_TEMPLATE_REGISTRY: EmailTemplateRegistry = Object.freeze({
  operator_card_failure: freezeDefinition({
    template: "operator_card_failure",
    providerTemplate: "operator-card-failure",
    internalKeys: ["DELIVERY_REFERENCE"],
    providerKeys: [],
  }),
  crs_alert: freezeDefinition({
    template: "crs_alert",
    providerTemplate: null,
    internalKeys: ["MESSAGE", "CLIENT_REFERENCE"],
    providerKeys: ["MESSAGE", "CLIENT_REFERENCE"],
  }),
});

function assertExactKeys(
  value: unknown,
  expected: readonly string[],
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("EMAIL_TEMPLATE_VARS_INVALID");
  }
  const keys = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) {
    throw new Error("EMAIL_TEMPLATE_VARS_INVALID");
  }
}

export function validateTemplateVariables<T extends EmailTemplate>(
  template: T,
  vars: unknown,
): EmailTemplateVars[T] {
  if (template === "operator_card_failure") {
    assertExactKeys(vars, ["DELIVERY_REFERENCE"]);
    if (typeof vars.DELIVERY_REFERENCE !== "string" || !UUID.test(vars.DELIVERY_REFERENCE)) {
      throw new Error("EMAIL_TEMPLATE_VARS_INVALID");
    }
    return Object.freeze({ DELIVERY_REFERENCE: vars.DELIVERY_REFERENCE }) as EmailTemplateVars[T];
  }
  if (template === "crs_alert") {
    assertExactKeys(vars, ["MESSAGE", "CLIENT_REFERENCE"]);
    if (
      vars.MESSAGE !== "Sign in to view"
      || typeof vars.CLIENT_REFERENCE !== "string"
      || vars.CLIENT_REFERENCE.trim() !== vars.CLIENT_REFERENCE
      || vars.CLIENT_REFERENCE.length < 1
      || vars.CLIENT_REFERENCE.length > CLIENT_REFERENCE_LIMIT
    ) {
      throw new Error("EMAIL_TEMPLATE_VARS_INVALID");
    }
    return Object.freeze({
      MESSAGE: "Sign in to view" as const,
      CLIENT_REFERENCE: vars.CLIENT_REFERENCE,
    }) as EmailTemplateVars[T];
  }
  throw new Error("EMAIL_TEMPLATE_INVALID");
}

export function buildProviderVariables<T extends EmailTemplate>(
  template: T,
  vars: EmailTemplateVars[T],
): Readonly<Record<string, string>> {
  const valid = validateTemplateVariables(template, vars);
  if (template === "operator_card_failure") return Object.freeze({});
  const alert = valid as EmailTemplateVars["crs_alert"];
  return Object.freeze({
    MESSAGE: alert.MESSAGE,
    CLIENT_REFERENCE: alert.CLIENT_REFERENCE,
  });
}

export function buildCrsAlertPayload(
  row: Readonly<{ client_id?: unknown; [key: string]: unknown }>,
): EmailTemplateVars["crs_alert"] {
  const clientReference = row.client_id;
  if (
    typeof clientReference !== "string"
    || clientReference.trim() !== clientReference
    || clientReference.length < 1
    || clientReference.length > CLIENT_REFERENCE_LIMIT
  ) {
    throw new Error("EMAIL_CLIENT_REFERENCE_INVALID");
  }
  return Object.freeze({
    MESSAGE: "Sign in to view",
    CLIENT_REFERENCE: clientReference,
  });
}
