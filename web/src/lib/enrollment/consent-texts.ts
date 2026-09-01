// Live consent documents. Consent and e-signature rows retain these version
// keys, so an older agreement remains resolvable after newer copy ships. The
// analysis document carries the recurring scope from BACKEND-SPEC section 2.1,
// and the agreement carries all four mandate elements from G3-01. Every string
// in this registry is governed by DEV-ONBOARDING rule 4.
export type ConsentDocument = {
  readonly key: 'monitoring' | 'analysis' | 'enrollment_agreement';
  readonly version: string;
  readonly title: string;
  readonly body: readonly string[];
  readonly effectiveFrom: string;
};

export const CONSENT_DOCUMENTS = {
  monitoring: {
    key: 'monitoring',
    version: 'monitoring-2026-08-29.1',
    title: 'Credit monitoring authorization',
    body: [
      'You authorize us to enroll you in credit monitoring and to display your credit information to you inside the monitoring view of your workspace.',
      'CRS, the monitoring provider, retains your credit report for up to 3 months. We do not store the raw report; we keep only the readiness outputs covered by your separate analysis authorization.',
      'This authorization continues until you withdraw it. You can withdraw it at any time from Permissions in Onboarding and Docs.',
    ],
    effectiveFrom: '2026-08-29',
  },
  analysis: {
    key: 'analysis',
    version: 'analysis-2026-08-16.1',
    title: 'Readiness analysis authorization',
    body: [
      'You authorize us to obtain your credit information from the credit reporting agencies on a recurring monthly basis, and additionally whenever a monitoring alert indicates your file has changed, so that we can prepare and keep updating your funding-readiness plan.',
      'These are soft inquiries.',
      'We keep only the readiness outputs we derive — your readiness state, your checklist and your plan. We do not keep the underlying credit file.',
      'This authorization continues until you withdraw it. You can withdraw it at any time from Permissions in Onboarding and Docs, and recurring analysis stops when you do.',
    ],
    effectiveFrom: '2026-08-16',
  },
  enrollment_agreement: {
    key: 'enrollment_agreement',
    version: 'agreement-2026-08-16.1',
    title: 'Service agreement and payment authorization',
    body: [
      'You authorize us to charge the payment method you provide, on a recurring monthly basis, for the credit monitoring and funding-readiness service.',
      'Your card is authorized today and is not charged today. The first charge is taken only after your identity check passes, and then on the same day each month.',
      'Your bank may briefly show a temporary hold while the card is authorized. It is never taken.',
      'The amount is the monthly service price shown to you before you sign, and it does not change without notice to you.',
      'You can stop the recurring charge at any time by cancelling from your workspace. Cancelling stops all future charges.',
    ],
    effectiveFrom: '2026-08-16',
  },
} as const satisfies Record<string, ConsentDocument>;

// TODO(G3-01): pricing may need to revisit the amount clause because the final
// service price is settled only after the identity check passes.
export type ConsentDocumentKey = keyof typeof CONSENT_DOCUMENTS;

const RETIRED_CONSENT_DOCUMENTS: readonly ConsentDocument[] = [{
  key: 'monitoring',
  version: 'monitoring-2026-08-16.1',
  title: 'Credit monitoring authorization',
  body: [
    'You authorize us to enroll you in credit monitoring and to display your credit information to you inside the monitoring view of your workspace.',
    'This information is shown to you directly by the monitoring provider. We do not store it.',
    'This authorization continues until you withdraw it. You can withdraw it at any time from Permissions in Onboarding and Docs.',
  ],
  effectiveFrom: '2026-08-16',
}];

export function currentVersion(key: ConsentDocumentKey): string {
  return CONSENT_DOCUMENTS[key].version;
}

export function documentForVersion(version: string): ConsentDocument {
  const document = [...Object.values(CONSENT_DOCUMENTS), ...RETIRED_CONSENT_DOCUMENTS].find(
    (candidate) => candidate.version === version,
  );
  if (!document) {
    throw new Error(`no consent document registered for version ${version}`);
  }
  return document;
}
