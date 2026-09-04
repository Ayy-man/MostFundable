/**
 * The eight consumer event emails, one per consumer notification event type.
 *
 * Each carries the same variables: the delivery row it hangs off, the consumer's first name and
 * an in-app path for the button. What happened is encoded by the template itself, so the body
 * never has to name an amount, a lender, a task or a message.
 */
export type ConsumerEmailTemplate =
  | "consumer_monitoring_alert"
  | "consumer_stage_change"
  | "consumer_analysis_complete"
  | "consumer_refresh_result"
  | "consumer_enrollment_milestone"
  | "consumer_document"
  | "consumer_team_message"
  | "consumer_application_update";

export type EmailTemplate = "operator_card_failure" | "crs_alert" | ConsumerEmailTemplate;

/** Every consumer template's variable shape. Identical by design: the template is the content. */
export type ConsumerEmailTemplateVars = Readonly<{
  APP_PATH: string;
  DELIVERY_REFERENCE: string;
  FIRST_NAME: string;
}>;

type ConsumerEmailTemplateVarMap = {
  readonly [T in ConsumerEmailTemplate]: ConsumerEmailTemplateVars;
};

export interface EmailTemplateVars extends ConsumerEmailTemplateVarMap {
  readonly operator_card_failure: Readonly<{
    DELIVERY_REFERENCE: string;
  }>;
  readonly crs_alert: Readonly<{
    MESSAGE: "Sign in to view";
    CLIENT_REFERENCE: string;
  }>;
}

export type EmailSendInput<T extends EmailTemplate = EmailTemplate> = Readonly<{
  to: string;
  template: T;
  vars: EmailTemplateVars[T];
  orgId: string;
}>;

export type EmailDriverName = "mock" | "resend";

export interface EmailSendReceipt {
  readonly driver: EmailDriverName;
  readonly receiptId: string;
  readonly providerRef: string;
  readonly status: "accepted";
  readonly attemptCount: number;
}

export interface EmailDriver {
  send<T extends EmailTemplate>(input: EmailSendInput<T>): Promise<EmailSendReceipt>;
}

/**
 * The words a published template renders, kept in the repository rather than only at the
 * provider, so the "no private detail in a consumer email" rule is a test and not a promise.
 */
export interface EmailTemplateCopy {
  readonly subject: string;
  readonly body: string;
  readonly actionLabel: string;
}

export interface EmailTemplateDefinition<T extends EmailTemplate> {
  readonly template: T;
  readonly providerTemplate: string | null;
  readonly internalKeys: readonly (keyof EmailTemplateVars[T])[];
  readonly providerKeys: readonly (keyof EmailTemplateVars[T])[];
  readonly copy: EmailTemplateCopy | null;
}

export type EmailTemplateRegistry = Readonly<{
  [T in EmailTemplate]: EmailTemplateDefinition<T>;
}>;

export type EmailDriverFactory = () => EmailDriver;
