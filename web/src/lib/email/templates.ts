import type {
  ConsumerEmailTemplate,
  ConsumerEmailTemplateVars,
  EmailTemplate,
  EmailTemplateCopy,
  EmailTemplateDefinition,
  EmailTemplateRegistry,
  EmailTemplateVars,
} from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIRST_NAME_LIMIT = 64;
/** A first name and nothing else: no punctuation a mail client would render as markup. */
const FIRST_NAME = /^[\p{L}][\p{L}\p{M} '’-]{0,63}$/u;
/** An in-app destination, never an absolute URL: the provider template owns the origin. */
const APP_PATH = /^\/[A-Za-z0-9/_-]{0,120}$/;

function freezeDefinition<T extends EmailTemplate>(
  definition: EmailTemplateDefinition<T>,
): EmailTemplateDefinition<T> {
  Object.freeze(definition.internalKeys);
  Object.freeze(definition.providerKeys);
  if (definition.copy !== null) Object.freeze(definition.copy);
  return Object.freeze(definition);
}

/**
 * The consumer event emails.
 *
 * Email is not a private channel: it lands in inboxes the consumer does not control, is forwarded,
 * and is indexed. So a consumer template says only what kind of thing happened and asks the person
 * to sign in. No amount, no lender name, no task text, no message body — the subject and body below
 * are the whole payload, and the only variables are the consumer's first name and an app path.
 */
const CONSUMER_TEMPLATE_COPY: Readonly<Record<ConsumerEmailTemplate, EmailTemplateCopy>> =
  Object.freeze({
    consumer_monitoring_alert: {
      subject: "There is a new credit alert on your account",
      body: "Something changed on your credit file. Sign in to see the alert.",
      actionLabel: "Open MostFundable",
    },
    consumer_stage_change: {
      subject: "Your funding journey moved to a new stage",
      body: "Your stage changed. Sign in to see where you are now.",
      actionLabel: "Open MostFundable",
    },
    consumer_analysis_complete: {
      subject: "Your plan is ready",
      body: "A new plan finished building for you. Sign in to read it.",
      actionLabel: "Open MostFundable",
    },
    consumer_refresh_result: {
      subject: "Your refresh has finished",
      body: "The refresh you asked for is done. Sign in to see the result.",
      actionLabel: "Open MostFundable",
    },
    consumer_enrollment_milestone: {
      subject: "You completed an onboarding step",
      body: "One of your onboarding steps is now complete. Sign in to see what is next.",
      actionLabel: "Open MostFundable",
    },
    consumer_document: {
      subject: "A new document is on your account",
      body: "A document was added to your account. Sign in to view it.",
      actionLabel: "Open MostFundable",
    },
    consumer_team_message: {
      subject: "Your team sent you a message",
      body: "You have a new message from your team. Sign in to read it.",
      actionLabel: "Open MostFundable",
    },
    consumer_application_update: {
      subject: "There is an update on one of your applications",
      body: "One of your applications changed. Sign in to see the update.",
      actionLabel: "Open MostFundable",
    },
  });

export const CONSUMER_EMAIL_TEMPLATES = Object.freeze(
  Object.keys(CONSUMER_TEMPLATE_COPY) as ConsumerEmailTemplate[],
);

export function isConsumerEmailTemplate(value: string): value is ConsumerEmailTemplate {
  return Object.hasOwn(CONSUMER_TEMPLATE_COPY, value);
}

/** `consumer_team_message` publishes as `consumer-team-message`. */
function providerTemplateId(template: ConsumerEmailTemplate): string {
  return template.replaceAll("_", "-");
}

function consumerDefinition(
  template: ConsumerEmailTemplate,
): EmailTemplateDefinition<ConsumerEmailTemplate> {
  return freezeDefinition({
    template,
    providerTemplate: providerTemplateId(template),
    internalKeys: ["DELIVERY_REFERENCE", "FIRST_NAME", "APP_PATH"],
    providerKeys: ["FIRST_NAME", "APP_PATH"],
    copy: CONSUMER_TEMPLATE_COPY[template],
  });
}

const CONSUMER_DEFINITIONS = Object.freeze(Object.fromEntries(
  CONSUMER_EMAIL_TEMPLATES.map((template) => [template, consumerDefinition(template)]),
)) as Readonly<{ [T in ConsumerEmailTemplate]: EmailTemplateDefinition<T> }>;

export const EMAIL_TEMPLATE_REGISTRY: EmailTemplateRegistry = Object.freeze({
  operator_card_failure: freezeDefinition({
    template: "operator_card_failure",
    providerTemplate: "operator-card-failure",
    internalKeys: ["DELIVERY_REFERENCE"],
    providerKeys: [],
    copy: null,
  }),
  ...CONSUMER_DEFINITIONS,
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

function validateConsumerVariables(vars: unknown): ConsumerEmailTemplateVars {
  assertExactKeys(vars, ["APP_PATH", "DELIVERY_REFERENCE", "FIRST_NAME"]);
  if (
    typeof vars.DELIVERY_REFERENCE !== "string"
    || !UUID.test(vars.DELIVERY_REFERENCE)
    || typeof vars.FIRST_NAME !== "string"
    || vars.FIRST_NAME.trim() !== vars.FIRST_NAME
    || vars.FIRST_NAME.length > FIRST_NAME_LIMIT
    || !FIRST_NAME.test(vars.FIRST_NAME)
    || typeof vars.APP_PATH !== "string"
    || !APP_PATH.test(vars.APP_PATH)
  ) {
    throw new Error("EMAIL_TEMPLATE_VARS_INVALID");
  }
  return Object.freeze({
    APP_PATH: vars.APP_PATH,
    DELIVERY_REFERENCE: vars.DELIVERY_REFERENCE,
    FIRST_NAME: vars.FIRST_NAME,
  });
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
  if (isConsumerEmailTemplate(template)) {
    return validateConsumerVariables(vars) as EmailTemplateVars[T];
  }
  throw new Error("EMAIL_TEMPLATE_INVALID");
}

export function buildProviderVariables<T extends EmailTemplate>(
  template: T,
  vars: EmailTemplateVars[T],
): Readonly<Record<string, string>> {
  const valid = validateTemplateVariables(template, vars);
  if (template === "operator_card_failure") return Object.freeze({});
  if (isConsumerEmailTemplate(template)) {
    const consumer = valid as ConsumerEmailTemplateVars;
    // Resend reserves FIRST_NAME (with LAST_NAME, EMAIL and UNSUBSCRIBE_URL) for its own
    // contact fields and rejects a send that supplies it, so the provider-side key is GIVEN_NAME.
    return Object.freeze({
      APP_PATH: consumer.APP_PATH,
      GIVEN_NAME: consumer.FIRST_NAME,
    });
  }
  throw new Error("EMAIL_TEMPLATE_INVALID");
}

/**
 * The delivery row a published send is idempotent against. Every published template carries one,
 * which is what lets a driver claim the same receipt on a retry instead of sending twice.
 */
export function deliveryReference<T extends EmailTemplate>(
  template: T,
  vars: EmailTemplateVars[T],
): string {
  const valid = validateTemplateVariables(template, vars);
  const reference = (valid as { DELIVERY_REFERENCE?: unknown }).DELIVERY_REFERENCE;
  if (typeof reference !== "string" || !UUID.test(reference)) {
    throw new Error("EMAIL_TEMPLATE_UNPUBLISHED");
  }
  return reference;
}
