// Stripe idempotency keys are parameter-strict and expire after 24 hours.
// Deterministic derivation is necessary; subscription_attempt_at covers retries
// that would otherwise cross the provider's idempotency window.
export function setupIntentKey(enrollmentId: string): string {
  return `enroll:${enrollmentId}:seti`;
}

export function subscriptionKey(enrollmentId: string): string {
  return `enroll:${enrollmentId}:sub`;
}
