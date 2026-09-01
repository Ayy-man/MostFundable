type ClientStage =
  | "onboarding"
  | "optimization"
  | "ready"
  | "applying"
  | "funded"
  | "graduate";

type EnrollmentMilestoneKind =
  | "agreement_signed"
  | "documents_uploaded"
  | "monitoring_connected"
  | "onboarding_call_completed";

type ConsentKind = "monitoring" | "analysis";

type DocumentSection = "articles" | "ein" | "tax_returns" | "bank_statements" | "other";

export type NotificationCopy = { title: string; detail: string };

export const STAGE_LABELS: Readonly<Record<ClientStage, string>> = Object.freeze({
  onboarding: "Onboarding",
  optimization: "Optimization",
  ready: "Ready",
  applying: "Applying",
  funded: "Funded",
  graduate: "Graduate",
});

export const ENROLLMENT_MILESTONE_LABELS: Readonly<Record<EnrollmentMilestoneKind, string>> =
  Object.freeze({
    agreement_signed: "Agreement",
    documents_uploaded: "Documents",
    monitoring_connected: "Credit monitoring",
    onboarding_call_completed: "Onboarding call",
  });

export const CONSENT_LABELS: Readonly<Record<ConsentKind, string>> = Object.freeze({
  monitoring: "Monitoring consent",
  analysis: "Analysis consent",
});

export const DOCUMENT_SECTION_LABELS: Readonly<Record<DocumentSection, string>> = Object.freeze({
  articles: "articles of organization",
  ein: "EIN document",
  tax_returns: "tax returns",
  bank_statements: "bank statements",
  other: "document",
});

export function formatNotificationDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(iso));
}

export function monitoringAlertCopy(): NotificationCopy {
  return {
    title: "A credit source alert is ready",
    detail: "Open Credit Monitoring to see what changed on the source record.",
  };
}

export function stageChangeCopy(stage: ClientStage, occurredAt: string): NotificationCopy {
  return {
    title: `Your stage moved to ${STAGE_LABELS[stage]}`,
    detail: `Your team recorded the change on ${formatNotificationDate(occurredAt)}.`,
  };
}

export function analysisCompleteCopy(isFirstPlan: boolean, occurredAt: string): NotificationCopy {
  return {
    title: isFirstPlan ? "Your analysis is complete" : "Your funding plan was updated",
    detail: `Your plan's next steps were recalculated from the ${formatNotificationDate(occurredAt)} snapshot.`,
  };
}

export function refreshResultCopy(): NotificationCopy {
  return {
    title: "Your credit refresh is complete",
    detail: "Your plan and next steps were updated from the new snapshot.",
  };
}

export function enrollmentMilestoneCopy(label: string, occurredAt: string): NotificationCopy {
  return {
    title: `${label} completed`,
    detail: `Recorded in your enrollment on ${formatNotificationDate(occurredAt)}.`,
  };
}

export function documentCopy(section: DocumentSection): NotificationCopy {
  return {
    title: `New ${DOCUMENT_SECTION_LABELS[section]} received`,
    detail: "Your team can see it in your document vault.",
  };
}

export function teamMessageCopy(authorName?: string | null): NotificationCopy {
  return {
    title: `New message from ${authorName?.trim() || "your team"}`,
    detail: "Open Team Chat to read it.",
  };
}

export function lenderNameFromReference(value: string | null | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return "a lender";
  return normalized
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function applicationUpdateCopy(
  kind: "first" | "update",
  lenderReference: string | null,
  occurredAt: string,
): NotificationCopy {
  const lender = lenderNameFromReference(lenderReference);
  return {
    title: kind === "first"
      ? `An application to ${lender} was recorded`
      : `There's an update on your ${lender} application`,
    detail: `Your team recorded it on ${formatNotificationDate(occurredAt)}. Open Your Funding for the record.`,
  };
}
