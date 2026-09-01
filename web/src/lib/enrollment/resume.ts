import type { EnrollmentView } from "@/lib/enrollment/types";

export type EnrollmentResumeState = {
  identityMode: "locked" | "quiz" | "sms";
  paymentAuthorized: boolean;
  step: 2 | 4;
  verified: boolean;
};

/** Maps durable enrollment truth back onto the onboarding wizard after a reload. */
export function enrollmentResumeState(view: EnrollmentView): EnrollmentResumeState {
  if (view.status === "active" || view.idvState === "passed") {
    return { identityMode: "sms", paymentAuthorized: true, step: 4, verified: true };
  }

  if (view.status === "parked" || view.idvState === "locked") {
    return { identityMode: "locked", paymentAuthorized: false, step: 4, verified: false };
  }

  if (view.idvState === "quiz" || view.idvState === "retry") {
    return {
      identityMode: "quiz",
      paymentAuthorized: view.subscription?.paymentMethodOnFile === true,
      step: 4,
      verified: false,
    };
  }

  if (view.idvState === "sms_sent") {
    return {
      identityMode: "sms",
      paymentAuthorized: view.subscription?.paymentMethodOnFile === true,
      step: 4,
      verified: false,
    };
  }

  // The durable agreement exists, but setup or IDV did not start. Return to the signature action;
  // its server retry recovers the enrollment by client and completes only the missing effects.
  return { identityMode: "sms", paymentAuthorized: false, step: 2, verified: false };
}
