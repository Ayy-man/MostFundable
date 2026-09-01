export type EmailTemplate = "operator_card_failure" | "crs_alert";

export interface EmailTemplateVars {
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

export interface EmailTemplateDefinition<T extends EmailTemplate> {
  readonly template: T;
  readonly providerTemplate: string | null;
  readonly internalKeys: readonly (keyof EmailTemplateVars[T])[];
  readonly providerKeys: readonly (keyof EmailTemplateVars[T])[];
}

export type EmailTemplateRegistry = Readonly<{
  [T in EmailTemplate]: EmailTemplateDefinition<T>;
}>;

export type EmailDriverFactory = () => EmailDriver;
