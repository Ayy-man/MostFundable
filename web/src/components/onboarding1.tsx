"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileCheck2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { StatusTag } from "@/components/consumer/consumer-kit";
import {
  DemoRoleTrigger,
  type DemoRoleIdentity,
} from "@/components/demo/demo-chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ENROLLMENT_STEP_UNAVAILABLE_NOTICE,
  loadEnrollmentBootstrap,
  type BootstrapState,
} from "@/components/surfaces/consumer-bootstrap";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { postJson } from "@/lib/enrollment/client";
import { currentVersion } from "@/lib/enrollment/consent-texts";
import { enrollmentResumeState } from "@/lib/enrollment/resume";
import type { EnrollConfig, EnrollmentView } from "@/lib/enrollment/types";
import {
  MOCK_QUIZ_QUESTION_ID,
  MOCK_SMS_CODE,
  mockQuizAnswer,
  mockQuizOptions,
} from "@/lib/idv/config";
import { usePrevious } from "@/lib/motion/hooks";
import { cn } from "@/lib/utils";

// Adapted from the authenticated @shadcnblocks/onboarding1 registry block.
// The original split-step scaffold is retained; all sample workspace content,
// external assets, and irrelevant team setup have been replaced with the
// MostFundable consumer enrollment and consent model.

const onboardingSteps = [
  { label: "Profile", detail: "Your contact details" },
  { label: "Permissions", detail: "Authorize monitoring and analysis" },
  { label: "Agreement", detail: "Review and sign" },
  { label: "Payment", detail: "Authorize, then hold" },
  { label: "Verify", detail: "SecureView identity check" },
];

function formatPrice(priceCents: number, cents = false) {
  return new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents ? 2 : 0, style: "currency" }).format(priceCents / 100);
}

/**
 * The date the parked identity check reopens, or null when nothing records one.
 *
 * `parkedUntil` is the durable timestamp the enrollment state machine writes,
 * and it is nullable. This used to fall back to a fixed 2026-07-21 plus 72
 * hours and print "Jul 24", so an enrollment whose park window was never
 * recorded told the person a deadline that no timer anywhere is counting down
 * to — on the one screen where the product has just released their card
 * authorization and is asking them to wait. A missing timestamp is now a
 * missing timestamp, and the caller says so instead.
 */
function formatRetryDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(value));
}

function ContextPanel({
  idvDriver,
  step,
  priceCents,
}: {
  idvDriver?: string;
  step: number;
  priceCents: number;
}) {
  const content: Array<{
    eyebrow: string;
    title: string;
    detail: string;
    rows: Array<{ label: string; value: string }>;
  }> = [
    {
      eyebrow: "Data minimization",
      title: "Only the details enrollment needs.",
      detail:
        "Your profile identifies the account holder and gives SecureView a verified contact route.",
      rows: [
        { label: "Stored by MostFundable", value: "Profile details" },
        { label: "Shared with SecureView", value: "Identity fields only" },
        { label: "Bureau data", value: "Never stored here" },
      ],
    },
    {
      eyebrow: "Required, then independent",
      title: "Two permissions power the complete product.",
      detail:
        "Both are required to enroll. After activation, either permission can be revoked without silently changing the other.",
      rows: [
        { label: "Monitoring off", value: "Credit monitoring turns off" },
        { label: "Analysis off", value: "No readiness updates" },
        { label: "Revocation", value: "Available at any time" },
      ],
    },
    {
      eyebrow: "Written instructions",
      title: "The authorization is explicit and recoverable.",
      detail:
        "You can download the signed record, revoke each permission independently, and see what deletion follows.",
      rows: [
        { label: "Service", value: "Funding readiness software" },
        { label: "Credit inquiry", value: "Soft pull only" },
        { label: "Funding guarantee", value: "None" },
      ],
    },
    {
      eyebrow: "Charge on success",
      title: "The card is authorized, not charged.",
      detail:
        `A temporary authorization confirms the payment method. The ${formatPrice(priceCents)} payment is taken only after SecureView enrollment succeeds.`,
      rows: [
        { label: "Plus plan", value: `${formatPrice(priceCents, true)} monthly` },
        { label: "Current charge", value: "No charge" },
        { label: "Failed enrollment", value: "Hold released" },
      ],
    },
    idvDriver === "crs" ? {
      eyebrow: "Final check",
      title: "Verification opens the account.",
      detail:
        "SecureView sends a secure link to the verified mobile number. Enrollment activates only after the link confirms the device.",
      rows: [
        { label: "Delivery", value: "Secure mobile link" },
        { label: "Pending", value: "No activation or charge" },
        { label: "Success", value: `Take ${formatPrice(priceCents)} and activate` },
      ],
    } : {
      eyebrow: "Final check",
      title: "Verification opens the account.",
      detail:
        "SecureView tries the SMS code first, then a knowledge quiz. Two failed quiz attempts park the account for 72 hours without a charge.",
      rows: [
        { label: "SMS", value: "First verification path" },
        { label: "Fallback", value: "Two-attempt quiz" },
        { label: "Success", value: `Take ${formatPrice(priceCents)} and activate` },
      ],
    },
  ];
  const item = content[step];

  return (
    <div className="flex h-full flex-col justify-between bg-[var(--consumer-rail)] p-6 text-[var(--consumer-ink)] sm:p-8 lg:p-10">
      <div>
        <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[var(--consumer-muted)]">
          <ShieldCheck aria-hidden className="size-4 text-[var(--consumer-connected)]" />
          {item.eyebrow}
        </div>
        <h2 className="mt-5 max-w-md text-2xl font-semibold leading-tight tracking-[-0.035em] sm:text-3xl">
          {item.title}
        </h2>
        <p className="mt-4 max-w-lg text-sm leading-6 text-[var(--consumer-muted)]">
          {item.detail}
        </p>
      </div>
      <dl className="mt-10 divide-y divide-[var(--consumer-border)] rounded-[10px] border border-[var(--consumer-border)] bg-card/60 px-4">
        {item.rows.map((row) => (
          <div
            className="flex items-center justify-between gap-4 py-4 text-xs"
            key={row.label}
          >
            <dt className="text-[var(--consumer-muted)]">{row.label}</dt>
            <dd className="text-right font-medium text-[var(--consumer-ink)]">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-8 flex items-center gap-2 text-[0.68rem] text-[var(--consumer-muted)]">
        <LockKeyhole aria-hidden className="size-3.5" />
        Encrypted in transit and at rest
      </p>
    </div>
  );
}

function StepHeading({
  description,
  step,
  title,
}: {
  description: string;
  step: number;
  title: string;
}) {
  return (
    <div>
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[var(--consumer-accent-ink)]">
        Step {step + 1} of {onboardingSteps.length}
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] sm:text-[1.8rem]">
        {title}
      </h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function Field({
  children,
  error,
  htmlFor,
  label,
}: {
  children: ReactNode;
  error?: string;
  htmlFor: string;
  label: string;
}) {
  return (
    <div>
      <Label className="text-xs font-semibold" htmlFor={htmlFor}>
        {label}
      </Label>
      <div className="mt-2">{children}</div>
      {error ? (
        <p className="mt-1.5 text-xs text-[var(--consumer-negative)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ConsentChoice({
  checked,
  detail,
  onChange,
  title,
}: {
  checked: boolean;
  detail: string;
  onChange: (checked: boolean) => void;
  title: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-28 cursor-pointer gap-3 rounded-[10px] border p-4 transition-colors focus-within:ring-2 focus-within:ring-ring/50",
        checked
          ? "border-[var(--consumer-accent-ink)] bg-[var(--consumer-accent-tint)]"
          : "border-[var(--consumer-border)] bg-muted hover:bg-popover",
      )}
    >
      <input
        checked={checked}
        className="mt-0.5 size-5 shrink-0 accent-[var(--consumer-accent)]"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>
        <span className="flex items-center gap-2 text-sm font-semibold">
          {title}
          {checked ? <StatusTag tone="success">Selected</StatusTag> : null}
        </span>
        <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">
          {detail}
        </span>
      </span>
    </label>
  );
}

export type OnboardingDraft = {
  analysis: boolean;
  authorizedCardLast4: string;
  email: string;
  identityMode: "locked" | "quiz" | "sms";
  monitoring: boolean;
  name: string;
  paymentAuthorized: boolean;
  phone: string;
  quizAttempts: number;
  signature: string;
  step: number;
};

/** The account holder, supplied by the caller. Never defaulted here — see below. */
export type OnboardingIdentity = Pick<OnboardingDraft, "email" | "name" | "phone">;

/**
 * Everything about a draft that is not the account holder.
 *
 * This module used to hold a whole `defaultDraft` including a name, an email and
 * a phone number belonging to the fixture persona, and `initialDraft` defaulted
 * to it. A signed-in consumer with no saved draft therefore opened step 1
 * prefilled with somebody else's contact details, and — because step 3 signs
 * against `name` — was asked to type a stranger's name to execute the
 * authorization. A wizard that owns no persona cannot make that mistake, so the
 * identity fields are gone from here and arrive as a required prop instead. The
 * caller decides whose they are: the session profile under real auth, the
 * fixture roster on the demo shell.
 */
const ENROLLMENT_DRAFT_DEFAULTS: Omit<OnboardingDraft, "email" | "name" | "phone"> = {
  analysis: false,
  authorizedCardLast4: "4242",
  identityMode: "sms",
  monitoring: false,
  paymentAuthorized: false,
  quizAttempts: 0,
  signature: "",
  step: 0,
};

// Step 2 renders this and the payment-authorization dialog on step 4 reopens it,
// so the text a signer reviews before paying is the text they signed, by
// construction rather than by two copies staying in step.
const ENROLLMENT_AGREEMENT_SUMMARY =
  "You authorize the services selected during enrollment. Credit monitoring data remains within the certified SecureView widget. Readiness analysis uses written instructions for soft pulls and stores only derived outputs. MostFundable is educational software, is not a lender, does not alter furnished credit records, and does not guarantee funding. Each permission can be revoked independently from Onboarding & Docs.";

const PAYMENT_STEP_DESCRIPTION =
  "Authorize the payment method now. Your card is not charged now; a temporary hold may appear briefly and is never taken.";

export function Onboarding1({
  businessName,
  identity,
  initialDraft,
  onComplete,
  onExit,
  onOpenProfiles,
  operatorName,
  roleIdentity,
}: {
  /**
   * The client's own `business_name`, for the identity quiz's one question.
   *
   * The option list used to be a fixed catalog whose graded answer was the
   * fixture persona's company, so a signed-in consumer was asked which business
   * is associated with their application and offered three strangers'. It is
   * built from this instead, through the same `mockQuizOptions` derivation the
   * server mock grades with — so the two agree by construction rather than by
   * two people writing the same string twice. Null when no business is on the
   * row, which the derivation states as an option in its own right.
   */
  businessName: string | null;
  identity: OnboardingIdentity;
  initialDraft?: OnboardingDraft;
  onComplete: (result: {
    analysis: boolean;
    cardLast4: string;
    email: string;
    enrollment: EnrollmentView | null;
    monitoring: boolean;
    name: string;
    phone: string;
  }) => void;
  onExit: (draft: OnboardingDraft) => void;
  onOpenProfiles: () => void;
  operatorName: string;
  roleIdentity: DemoRoleIdentity;
}) {
  // A saved draft wins because it is this account's own half-finished work; with
  // no draft the supplied identity is overlaid on the non-identity defaults, so
  // the opening state names the caller and nobody else.
  const openingDraft: OnboardingDraft =
    initialDraft ?? { ...ENROLLMENT_DRAFT_DEFAULTS, ...identity };
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState(openingDraft.step);
  const [name, setName] = useState(openingDraft.name);
  const [email, setEmail] = useState(openingDraft.email);
  const [phone, setPhone] = useState(openingDraft.phone);
  // CRS identity stays in this component until the single enrollment POST succeeds. It is not
  // part of OnboardingDraft, onExit, onComplete, repository state, or any browser response.
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [ssn, setSsn] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [identityPostalCode, setIdentityPostalCode] = useState("");
  const [monitoring, setMonitoring] = useState(openingDraft.monitoring);
  const [analysis, setAnalysis] = useState(openingDraft.analysis);
  const [signature, setSignature] = useState(openingDraft.signature);
  const [paymentAuthorized, setPaymentAuthorized] = useState(openingDraft.paymentAuthorized);
  const [authorizedCardLast4, setAuthorizedCardLast4] = useState(openingDraft.authorizedCardLast4);
  const [signatureError, setSignatureError] = useState("");
  const [agreementExpanded, setAgreementExpanded] = useState(false);
  const [authorizationOpen, setAuthorizationOpen] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  // For the stepper: the cell that just completed pops its check once, and the verify cell rings
  // once on the render where identity becomes verified.
  const previousStep = usePrevious(step);
  const previousVerified = usePrevious(verified) ?? false;
  const [resent, setResent] = useState(false);
  const [identityMode, setIdentityMode] = useState<"sms" | "quiz" | "locked">(openingDraft.identityMode);
  const [quizAttempts, setQuizAttempts] = useState(openingDraft.quizAttempts);
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [expiry, setExpiry] = useState("12/28");
  const [cvc, setCvc] = useState("123");
  const [postalCode, setPostalCode] = useState("30309");
  const [paymentError, setPaymentError] = useState("");
  const [enrollState, setEnrollState] = useState<BootstrapState>("loading");
  const [enroll, setEnroll] = useState<EnrollConfig | null>(null);
  const [enrollReloadToken, setEnrollReloadToken] = useState(0);
  const [enrollmentView, setEnrollmentView] = useState<EnrollmentView | null>(null);
  const [pending, setPending] = useState<null | "profile" | "sign" | "pay" | "verify">(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const draftId = useRef(crypto.randomUUID());
  const paymentReady =
    /^4\d{15}$/.test(cardNumber.replace(/\D/g, "")) &&
    /^\d{2}\/\d{2}$/.test(expiry) &&
    cvc.length >= 3 &&
    postalCode.length >= 5;

  // R4B-02, swept sibling. The surface's bootstrap and this one are separate reads, so fixing the
  // surface alone still leaves a 503 here routing consent, e-signature, card authorization and IDV
  // into the local demo branch — five steps that persist nothing and end on a completion screen.
  // Only an explicit successful `{ enabled: false }` may select that branch.
  useEffect(() => {
    let active = true;
    void loadEnrollmentBootstrap().then((result) => {
      if (!active) return;
      setEnrollState(result.state);
      setEnroll(result.state === "ready" ? result.config : null);
      if (result.state === "ready" && result.config.currentEnrollment) {
        const current = result.config.currentEnrollment;
        const resumed = enrollmentResumeState(current);
        setEnrollmentView(current);
        setIdentityMode(resumed.identityMode);
        setPaymentAuthorized(resumed.paymentAuthorized);
        setVerified(resumed.verified);
        setStep(resumed.step);
      }
    });
    return () => { active = false; };
  }, [enrollReloadToken]);

  const enrollLive = enrollState === "ready" && enroll !== null;
  const crsIdv = enroll?.idvDriver === "crs";
  // Demo-only. The server decides whether this consumer may reset (seeded persona, demo flags on)
  // and says so on the bootstrap, so the control appears only where the request would succeed.
  const demoResetAvailable = enrollLive && enroll.demoResetAvailable === true && enrollmentView !== null;

  async function resetEnrollment() {
    setResetting(true);
    setResetError("");
    const result = await postJson<{ clientId: string }>("/api/enroll/reset", {});
    if (!result.ok) {
      setResetError(result.message);
      setResetting(false);
      return;
    }
    // The whole consumer surface is keyed to the archived client, so a full reload is the honest
    // way to pick up the fresh one rather than patching state piecemeal.
    window.location.reload();
  }

  const demoResetControl = demoResetAvailable ? (
    <div className="mt-4 border-t border-dashed border-[var(--consumer-border)] pt-4">
      <Button className="min-h-9" disabled={resetting} onClick={() => void resetEnrollment()} size="sm" type="button" variant="ghost">
        <RefreshCw aria-hidden /> {resetting ? "Resetting…" : "Reset this enrollment for testing"}
      </Button>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Demo accounts only. Archives this walkthrough and starts a fresh one; nothing is deleted.</p>
      {resetError ? <p className="mt-2 text-xs text-[var(--consumer-negative)]" role="alert">{resetError}</p> : null}
    </div>
  ) : null;
  const enrollPending = enrollState === "loading" || enrollState === "unavailable";

  function submitProfile(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !email.trim() || !phone.trim()) return;
    if (
      crsIdv &&
      (!dateOfBirth || ssn.length !== 9 || !addressLine1.trim() ||
        !addressCity.trim() || addressState.length !== 2 || identityPostalCode.length < 5)
    ) return;
    setStep(1);
  }

  async function submitSignature() {
    if (signature.trim().toLocaleLowerCase() !== name.trim().toLocaleLowerCase()) {
      setSignatureError(`Enter ${name.trim()} exactly as shown on your profile.`);
      return;
    }
    setSignatureError("");
    if (enrollPending) {
      setSignatureError(ENROLLMENT_STEP_UNAVAILABLE_NOTICE);
      return;
    }
    if (!enrollLive) {
      setStep(3);
      return;
    }
    setPending("sign");
    const result = await postJson<EnrollmentView>("/api/enroll", {
      analysis,
      draftId: draftId.current,
      email,
      monitoring,
      name,
      phone,
      signature,
      ...(crsIdv ? {
        crsIdentity: {
          dateOfBirth,
          ssn,
          address: {
            line1: addressLine1,
            ...(addressLine2.trim() ? { line2: addressLine2 } : {}),
            city: addressCity,
            state: addressState,
            postalCode: identityPostalCode,
          },
        },
      } : {}),
    });
    setPending(null);
    if (!result.ok) {
      setSignatureError(result.message);
      return;
    }
    setDateOfBirth("");
    setSsn("");
    setAddressLine1("");
    setAddressLine2("");
    setAddressCity("");
    setAddressState("");
    setIdentityPostalCode("");
    setEnrollmentView(result.data);
    setStep(3);
  }

  function authorizePayment(event: FormEvent) {
    event.preventDefault();
    const digits = cardNumber.replace(/\D/g, "");
    if (enrollPending) {
      setPaymentError(ENROLLMENT_STEP_UNAVAILABLE_NOTICE);
      return;
    }
    if (!enrollLive) {
      if (!paymentReady) {
        setPaymentError("Enter a complete Visa demo card, expiry, CVC, and billing postal code.");
        return;
      }
      setPaymentError("");
      setPaymentAuthorized(true);
      setAuthorizedCardLast4(digits.slice(-4));
      setStep(4);
      return;
    }
    if (!enrollmentView) {
      setPaymentError("The authorization is not ready. Return to the agreement and try again.");
      return;
    }
    setPending("pay");
    setPaymentError("");
    setPaymentAuthorized(true);
    setAuthorizedCardLast4(digits.slice(-4));
    setStep(4);
    setPending(null);
  }

  async function verifyCode() {
    if (code.replace(/\D/g, "").length !== 6) return;
    if (enrollPending) {
      setCodeError(ENROLLMENT_STEP_UNAVAILABLE_NOTICE);
      return;
    }
    if (!enrollLive) {
      setVerifying(true);
      window.setTimeout(() => {
        setVerifying(false);
        if (code === MOCK_SMS_CODE) {
          setCodeError("");
          setVerified(true);
        } else {
          setCodeError("That code did not match. Continue with the SecureView identity quiz.");
        }
      }, 650);
      return;
    }
    if (!enrollmentView) return;
    setVerifying(true);
    setPending("verify");
    const result = await postJson<EnrollmentView>(
      `/api/enrollments/${enrollmentView.enrollmentId}/idv`,
      { code, kind: "sms" },
    );
    setPending(null);
    setVerifying(false);
    if (!result.ok) {
      setCodeError(result.message);
      return;
    }
    setEnrollmentView(result.data);
    setQuizAttempts(Math.max(0, 2 - result.data.attemptsRemaining));
    if (result.data.status === "active") {
      setCodeError("");
      setVerified(true);
    } else if (result.data.status === "parked") {
      setPaymentAuthorized(false);
      setIdentityMode("locked");
    } else {
      setCodeError("That code did not match. Continue with the SecureView identity quiz.");
      setIdentityMode("quiz");
    }
  }

  async function checkSmfaStatus() {
    if (!enrollmentView || !crsIdv || enrollPending) return;
    setVerifying(true);
    setPending("verify");
    setCodeError("");
    const result = await postJson<EnrollmentView>(
      `/api/enrollments/${enrollmentView.enrollmentId}/idv`,
      { kind: "smfa_status" },
    );
    setPending(null);
    setVerifying(false);
    if (!result.ok) {
      setCodeError(result.message);
      return;
    }
    setEnrollmentView(result.data);
    if (result.data.status === "active") {
      setVerified(true);
      return;
    }
    setCodeError("Verification is still pending. Open the secure link sent to your mobile, then check again.");
  }

  async function answerQuiz(answer: string) {
    if (enrollPending) {
      setCodeError(ENROLLMENT_STEP_UNAVAILABLE_NOTICE);
      return;
    }
    if (!enrollLive) {
      if (answer === mockQuizAnswer(businessName)) {
        setVerified(true);
        return;
      }
      const attempts = quizAttempts + 1;
      setQuizAttempts(attempts);
      if (attempts >= 2) {
        setPaymentAuthorized(false);
        setIdentityMode("locked");
      }
      return;
    }
    if (!enrollmentView) return;
    setPending("verify");
    const result = await postJson<EnrollmentView>(
      `/api/enrollments/${enrollmentView.enrollmentId}/idv`,
      {
        answers: [{ answerId: answer, questionId: MOCK_QUIZ_QUESTION_ID }],
        kind: "quiz",
      },
    );
    setPending(null);
    if (!result.ok) {
      setCodeError(result.message);
      return;
    }
    setEnrollmentView(result.data);
    setQuizAttempts(Math.max(0, 2 - result.data.attemptsRemaining));
    if (result.data.status === "active") {
      setVerified(true);
      return;
    }
    if (result.data.status === "parked") {
      setPaymentAuthorized(false);
      setIdentityMode("locked");
    }
  }

  return (
    <div
      className="min-h-[calc(100dvh-var(--demo-banner-height))] bg-[var(--consumer-canvas)] text-foreground"
      data-demo-theme="consumer"
    >
      <header className="sticky top-[var(--demo-banner-height)] z-20 flex h-16 items-center border-b border-[var(--consumer-border)] bg-card/95 px-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-[74rem] items-center">
          <span className="grid size-8 place-items-center rounded-md bg-[var(--consumer-brand-tile)] text-xs font-bold text-[var(--consumer-accent)]">
            {operatorName
              .split(/\s+/)
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </span>
          <span className="ml-3 min-w-0">
            <span className="block truncate text-sm font-semibold">{operatorName}</span>
            <span className="block truncate text-xs text-muted-foreground">{roleIdentity.name}</span>
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              className="min-h-11"
              onClick={() => onExit({ analysis, authorizedCardLast4, email, identityMode, monitoring, name, paymentAuthorized, phone, quizAttempts, signature, step })}
              variant="ghost"
            >
              <span className="sm:hidden">Save</span>
              <span className="hidden sm:inline">Save and exit</span>
            </Button>
            <DemoRoleTrigger
              className="sm:hidden"
              currentRole="consumer"
              identity={roleIdentity}
              onOpen={onOpenProfiles}
              variant="compact"
            />
            <DemoRoleTrigger
              className="hidden w-auto border-0 bg-transparent shadow-none sm:flex"
              currentRole="consumer"
              identity={roleIdentity}
              onOpen={onOpenProfiles}
            />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[74rem] px-4 py-5 sm:px-6 sm:py-8">
        <ol
          aria-label="Enrollment progress"
          className="relative mb-5 grid grid-cols-5 overflow-hidden rounded-[10px] border border-[var(--consumer-border)] bg-card sm:mb-6"
        >
          {/*
            One green line along the top edge grows to the current step, so progress reads as a
            single shape rather than five separate cells changing colour. Identity verification is
            the one step that earns a ring: it is the point at which money is taken.
          */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-0.5 bg-[var(--consumer-positive)] transition-[width] duration-[var(--duration-very-slow)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none"
            style={{ width: `${((step + (verified ? 1 : 0.5)) / onboardingSteps.length) * 100}%` }}
          />
          {onboardingSteps.map((item, index) => (
            <li
              aria-current={index === step ? "step" : undefined}
              className={cn(
                "relative min-w-0 px-2 py-3 text-center transition-colors duration-[var(--duration-slow)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none sm:px-4 sm:text-left",
                index > 0 && "border-l border-[var(--consumer-border)]",
                index < step && "bg-[color-mix(in_srgb,var(--consumer-positive),transparent_94%)]",
                index === step && "bg-[var(--consumer-accent-tint)]",
              )}
              key={item.label}
            >
              <span
                className={cn(
                  "mx-auto grid size-5 place-items-center rounded-full border text-[0.61rem] font-bold transition-colors duration-[var(--duration-slow)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none sm:mx-0",
                  index < step &&
                    "border-[var(--consumer-positive)] bg-[var(--consumer-positive)] text-card",
                  index === step &&
                    "border-[var(--consumer-accent)] bg-[var(--consumer-accent)] text-primary-foreground",
                  index > step &&
                    "border-[var(--consumer-border)] text-muted-foreground",
                )}
                data-mark-pop={index < step && index === previousStep ? "" : undefined}
                data-mark-ring={index === step && verified && !previousVerified ? "" : undefined}
                key={index < step ? "done" : index === step ? "current" : "next"}
              >
                {index < step ? <Check aria-hidden className="size-3" /> : index + 1}
              </span>
              <span className="mt-1 block whitespace-normal text-[0.58rem] font-semibold leading-tight sm:text-xs">
                {item.label}
              </span>
              <span className="mt-0.5 hidden text-[0.65rem] text-muted-foreground md:block">
                {item.detail}
              </span>
            </li>
          ))}
        </ol>

        {enrollState === "unavailable" ? (
          <div className="mb-5 flex flex-col gap-3 rounded-[10px] border border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_65%)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_55%)] px-4 py-3 text-sm sm:flex-row sm:items-center" role="status">
            <p className="min-w-0 flex-1"><strong>Enrollment unavailable.</strong> {ENROLLMENT_STEP_UNAVAILABLE_NOTICE}</p>
            <Button
              className="min-h-11"
              onClick={() => { setEnrollState("loading"); setEnrollReloadToken((current) => current + 1); }}
              variant="outline"
            >
              Try again
            </Button>
          </div>
        ) : null}

        <div className="grid min-h-[36rem] overflow-hidden rounded-[12px] border border-[var(--consumer-surface-border)] bg-card shadow-[var(--consumer-surface-shadow)] lg:grid-cols-[minmax(0,0.92fr)_minmax(26rem,1.08fr)]">
          <div className="flex min-h-[36rem] flex-col p-5 sm:p-8 lg:p-10">
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="flex h-full flex-col"
              initial={reduceMotion ? false : { opacity: 0, x: 12 }}
              key={step}
              transition={{ duration: reduceMotion ? 0 : 0.18 }}
            >
              {step === 0 ? (
                <form className="flex h-full flex-col" onSubmit={submitProfile}>
                  <StepHeading
                    description="Confirm the account holder and the contact route used for secure verification."
                    step={step}
                    title="Set up your profile"
                  />
                  <div className="mt-7 space-y-5">
                    <Field htmlFor="onboarding-name" label="Full legal name">
                      <Input
                        className="min-h-11"
                        id="onboarding-name"
                        pattern={crsIdv ? ".*\\S\\s+\\S.*" : undefined}
                        onChange={(event) => setName(event.target.value)}
                        required
                        value={name}
                      />
                    </Field>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field htmlFor="onboarding-email" label="Email">
                        <Input
                          className="min-h-11"
                          id="onboarding-email"
                          onChange={(event) => setEmail(event.target.value)}
                          required
                          type="email"
                          value={email}
                        />
                      </Field>
                      <Field htmlFor="onboarding-phone" label="Mobile phone">
                        <Input
                          className="min-h-11"
                          id="onboarding-phone"
                          onChange={(event) => setPhone(event.target.value)}
                          required
                          type="tel"
                          value={phone}
                        />
                      </Field>
                    </div>
                    {crsIdv ? (
                      <div className="space-y-5 rounded-[10px] border border-[var(--consumer-border)] bg-[var(--consumer-canvas)] p-4">
                        <p className="text-xs leading-5 text-muted-foreground">
                          SecureView uses these details once to verify identity. MostFundable does not store them in the enrollment record.
                        </p>
                        <div className="grid gap-5 sm:grid-cols-2">
                          <Field htmlFor="onboarding-dob" label="Date of birth">
                            <Input
                              autoComplete="bday"
                              className="min-h-11"
                              id="onboarding-dob"
                              onChange={(event) => setDateOfBirth(event.target.value)}
                              required
                              type="date"
                              value={dateOfBirth}
                            />
                          </Field>
                          <Field htmlFor="onboarding-ssn" label="Social Security number">
                            <Input
                              autoComplete="off"
                              className="min-h-11 tabular-nums"
                              id="onboarding-ssn"
                              inputMode="numeric"
                              maxLength={9}
                              onChange={(event) => setSsn(event.target.value.replace(/\D/g, "").slice(0, 9))}
                              required
                              type="password"
                              value={ssn}
                            />
                          </Field>
                        </div>
                        <Field htmlFor="onboarding-address-1" label="Home address">
                          <Input
                            autoComplete="address-line1"
                            className="min-h-11"
                            id="onboarding-address-1"
                            onChange={(event) => setAddressLine1(event.target.value)}
                            required
                            value={addressLine1}
                          />
                        </Field>
                        <Field htmlFor="onboarding-address-2" label="Apartment or unit (optional)">
                          <Input
                            autoComplete="address-line2"
                            className="min-h-11"
                            id="onboarding-address-2"
                            onChange={(event) => setAddressLine2(event.target.value)}
                            value={addressLine2}
                          />
                        </Field>
                        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_5rem_7rem]">
                          <Field htmlFor="onboarding-city" label="City">
                            <Input
                              autoComplete="address-level2"
                              className="min-h-11"
                              id="onboarding-city"
                              onChange={(event) => setAddressCity(event.target.value)}
                              required
                              value={addressCity}
                            />
                          </Field>
                          <Field htmlFor="onboarding-state" label="State">
                            <Input
                              autoComplete="address-level1"
                              className="min-h-11 uppercase"
                              id="onboarding-state"
                              maxLength={2}
                              onChange={(event) => setAddressState(event.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2))}
                              required
                              value={addressState}
                            />
                          </Field>
                          <Field htmlFor="onboarding-identity-postal" label="ZIP code">
                            <Input
                              autoComplete="postal-code"
                              className="min-h-11 tabular-nums"
                              id="onboarding-identity-postal"
                              inputMode="numeric"
                              maxLength={10}
                              onChange={(event) => setIdentityPostalCode(event.target.value.replace(/[^0-9-]/g, "").slice(0, 10))}
                              required
                              value={identityPostalCode}
                            />
                          </Field>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-auto flex justify-end pt-8">
                    <Button className="min-h-11 px-4" disabled={enrollPending} type="submit">
                      Continue <ArrowRight aria-hidden />
                    </Button>
                  </div>
                </form>
              ) : null}

              {step === 1 ? (
                <div className="flex h-full flex-col">
                  <StepHeading
                    description="Both permissions are required for the combined product. After activation, either can be revoked without silently changing the other."
                    step={step}
                    title="Choose your permissions"
                  />
                  <div className="mt-7 space-y-3">
                    <ConsentChoice
                      checked={monitoring}
                      detail="CRS retains the report for up to 3 months. MostFundable processes it in memory and stores only derived readiness outputs."
                      onChange={setMonitoring}
                      title="Credit monitoring"
                    />
                    <ConsentChoice
                      checked={analysis}
                      detail="Authorizes the soft pulls used to create readiness scores, prioritized actions, and future verified updates."
                      onChange={setAnalysis}
                      title="Readiness analysis"
                    />
                    {!monitoring || !analysis ? (
                      <p className="text-xs leading-5 text-muted-foreground">
                        Select both permissions to enroll in monitoring and readiness analysis.
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-3 pt-8">
                    <Button className="min-h-11" onClick={() => setStep(0)} variant="ghost">
                      <ArrowLeft aria-hidden /> Back
                    </Button>
                    <Button
                      className="min-h-11 px-4"
                      disabled={!monitoring || !analysis}
                      onClick={() => setStep(2)}
                    >
                      Continue <ArrowRight aria-hidden />
                    </Button>
                  </div>
                </div>
              ) : null}

              {step === 2 ? (
                <div className="flex h-full flex-col">
                  <StepHeading
                    description="Review the services selected below, then sign using the exact legal name on your profile."
                    step={step}
                    title="Review and sign"
                  />
                  <div className="mt-7 rounded-[10px] border border-[var(--consumer-border)] bg-[var(--consumer-canvas)]">
                    <div className="flex items-center gap-3 border-b border-[var(--consumer-border)] px-4 py-3">
                      <FileCheck2 aria-hidden className="size-4 text-[var(--consumer-accent-ink)]" />
                      <div>
                        <p className="text-xs font-semibold">Enrollment agreement</p>
                        <p className="text-[0.66rem] text-muted-foreground">
                          {currentVersion("enrollment_agreement")}
                        </p>
                      </div>
                      <Button
                        className="ml-auto min-h-11"
                        onClick={() => setAgreementExpanded((current) => !current)}
                        size="sm"
                        variant="outline"
                      >
                        {agreementExpanded ? "Collapse" : "View full text"}
                      </Button>
                    </div>
                    <div
                      className={cn(
                        "p-4 text-xs leading-6 text-muted-foreground",
                        !agreementExpanded && "max-h-36 overflow-y-auto",
                      )}
                      tabIndex={agreementExpanded ? undefined : 0}
                    >
                      {ENROLLMENT_AGREEMENT_SUMMARY}
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 rounded-[10px] border border-[var(--consumer-border)] p-4 text-xs sm:grid-cols-2">
                    <div>
                      <p className="text-muted-foreground">Services selected</p>
                      <p className="mt-1 font-semibold">
                        {[monitoring && "Monitoring", analysis && "Analysis"]
                          .filter(Boolean)
                          .join(" + ")}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Subscription</p>
                      <p className="mt-1 font-semibold">
                        Plus · {formatPrice(enroll?.priceCents ?? 4900, true)} monthly after verification
                      </p>
                    </div>
                  </div>
                  <div className="mt-5">
                    <Field
                      error={signatureError}
                      htmlFor="onboarding-signature"
                      label={`Type “${name}” to sign`}
                    >
                      <Input
                        aria-invalid={Boolean(signatureError)}
                        className="min-h-11"
                        id="onboarding-signature"
                        onChange={(event) => {
                          setSignature(event.target.value);
                          if (signatureError) setSignatureError("");
                        }}
                        value={signature}
                      />
                    </Field>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-3 pt-8">
                    <Button className="min-h-11" onClick={() => setStep(1)} variant="ghost">
                      <ArrowLeft aria-hidden /> Back
                    </Button>
                    <Button className="min-h-11 px-4" disabled={enrollPending || pending === "sign"} onClick={submitSignature}>
                      {pending === "sign" ? "Authorizing" : "Sign and continue"} <ArrowRight aria-hidden />
                    </Button>
                  </div>
                </div>
              ) : null}

              {step === 3 ? (
                <form className="flex h-full flex-col" onSubmit={authorizePayment}>
                  <StepHeading
                    description={PAYMENT_STEP_DESCRIPTION}
                    step={step}
                    title="Authorize your payment method"
                  />
                  <div className="mt-7 space-y-5">
                    <Field htmlFor="billing-card" label="Visa demo card number">
                      <Input
                        autoComplete="cc-number"
                        className="min-h-11 tabular-nums"
                        id="billing-card"
                        inputMode="numeric"
                        onChange={(event) => setCardNumber(event.target.value)}
                        value={cardNumber}
                      />
                    </Field>
                    <div className="grid grid-cols-3 gap-3">
                      <Field htmlFor="billing-expiry" label="Expiry">
                        <Input
                          autoComplete="cc-exp"
                          className="min-h-11 tabular-nums"
                          id="billing-expiry"
                          onChange={(event) => setExpiry(event.target.value)}
                          value={expiry}
                        />
                      </Field>
                      <Field htmlFor="billing-cvc" label="CVC">
                        <Input
                          autoComplete="cc-csc"
                          className="min-h-11 tabular-nums"
                          id="billing-cvc"
                          inputMode="numeric"
                          maxLength={4}
                          onChange={(event) => setCvc(event.target.value.replace(/\D/g, ""))}
                          type="password"
                          value={cvc}
                        />
                      </Field>
                      <Field htmlFor="billing-postal" label="Postal code">
                        <Input
                          autoComplete="postal-code"
                          className="min-h-11 tabular-nums"
                          id="billing-postal"
                          inputMode="numeric"
                          onChange={(event) => setPostalCode(event.target.value)}
                          value={postalCode}
                        />
                      </Field>
                    </div>
                    <div className="rounded-[10px] border border-[var(--consumer-border)] bg-[var(--consumer-canvas)] p-4 text-xs">
                      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Authorization now</span><strong>No charge</strong></div>
                      <div className="mt-2 flex justify-between gap-4"><span className="text-muted-foreground">First payment after enrollment</span><strong>{formatPrice(enroll?.priceCents ?? 4900, true)}</strong></div>
                      <div className="mt-2 flex justify-between gap-4"><span className="text-muted-foreground">Then renews</span><strong>Monthly</strong></div>
                      {/*
                        This used to call setStep(2), which walked the signer
                        backwards out of the payment step to re-read the
                        agreement and lost every field they had entered. Reading
                        what you are about to authorize is not a reason to leave
                        the page you are authorizing on, so it opens the same
                        text in a dialog and step 4 stays put.
                      */}
                      <Button className="mt-2 h-auto min-h-6 px-0 text-xs" onClick={() => setAuthorizationOpen(true)} type="button" variant="link">Review payment authorization</Button>
                    </div>
                    {paymentError ? <p className="text-xs text-[var(--consumer-negative)]" role="alert">{paymentError}</p> : null}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-3 pt-8">
                    <Button className="min-h-11" onClick={() => setStep(2)} type="button" variant="ghost">
                      <ArrowLeft aria-hidden /> Back
                    </Button>
                    <Button className="min-h-11 px-4" disabled={enrollPending || (!enrollLive && !paymentReady) || pending === "pay"} type="submit">
                      {pending === "pay" ? "Authorizing" : "Authorize and continue"} <ArrowRight aria-hidden />
                    </Button>
                  </div>
                </form>
              ) : null}

              {step === 4 ? (
                <div className="flex h-full flex-col">
                  <StepHeading
                    description={crsIdv
                      ? `SecureView sent a secure verification link to the mobile ending ${phone.replace(/\D/g, "").slice(-4)}.`
                      : `SecureView sent a six-digit code to the mobile ending ${phone.replace(/\D/g, "").slice(-4)}.${!enroll || enroll.idvDriver === "mock" ? ` For this demo, use ${MOCK_SMS_CODE}.` : ""}`}
                    step={step}
                    title="Verify your identity"
                  />
                  {!verified && crsIdv ? (
                    <div className="mt-8">
                      <p className="text-sm leading-6 text-muted-foreground">
                        Open the secure link on your mobile. Return here after SecureView confirms the device.
                      </p>
                      {enrollmentView?.verificationUrl ? (
                        <a
                          className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-[var(--consumer-accent-ink)] underline"
                          href={enrollmentView.verificationUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open secure verification
                        </a>
                      ) : null}
                      {codeError ? <p className="mt-3 text-xs text-[var(--consumer-negative)]" role="alert">{codeError}</p> : null}
                      <Button className="mt-4 min-h-11 w-full" disabled={enrollPending || verifying || !paymentAuthorized} onClick={checkSmfaStatus}>
                        {verifying ? <><LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> Checking</> : "Check verification status"}
                      </Button>
                    </div>
                  ) : null}
                  {!verified && !crsIdv && identityMode === "sms" ? (
                    <div className="mt-8">
                      <Field error={codeError} htmlFor="verification-code" label="Verification code">
                        <Input
                          aria-invalid={Boolean(codeError)}
                          className="min-h-14 text-center text-xl font-semibold tracking-[0.3em] tabular-nums"
                          id="verification-code"
                          inputMode="numeric"
                          maxLength={6}
                          onChange={(event) => {
                            // `maxLength` caps the raw keystrokes, not the digits
                            // that survive the strip, so a paste or an autofill of
                            // "000000 246810" arrived as more than six digits and
                            // the field read as a concatenation of the placeholder
                            // and the code. Slicing after the strip is the only
                            // point where the six-digit rule is actually true.
                            setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                            if (codeError) setCodeError("");
                          }}
                          placeholder="000000"
                          value={code}
                        />
                      </Field>
                      <Button className="mt-4 min-h-11 w-full" disabled={enrollPending || code.length !== 6 || verifying || !paymentAuthorized} onClick={verifyCode}>
                        {verifying ? <><LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> Verifying</> : "Verify identity"}
                      </Button>
                      {codeError ? <Button className="mt-2 min-h-11 w-full" onClick={() => setIdentityMode("quiz")} variant="outline">Start identity quiz <ArrowRight aria-hidden /></Button> : null}
                      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                        <span>{resent ? "A new code was sent." : "Didn't receive it?"}</span>
                        <Button className="min-h-11 px-1 text-xs" onClick={() => { setResent(true); setCodeError(""); }} variant="link"><RefreshCw aria-hidden className="size-3" /> Resend code</Button>
                      </div>
                    </div>
                  ) : null}
                  {!verified && !crsIdv && identityMode === "quiz" ? (
                    <div className="mt-8">
                      {/*
                        A rejected code used to switch this branch on and take
                        its own explanation with it: `codeError` was rendered
                        only inside the SMS branch, so the screen replaced the
                        code field with a quiz and said nothing about why. The
                        signer read it as the app skipping a step rather than as
                        their code being wrong. The message the SMS branch would
                        have shown is carried into the fallback instead.
                      */}
                      {codeError ? <p className="mb-4 text-xs text-[var(--consumer-negative)]" role="alert">{codeError}</p> : null}
                      <StatusTag tone="warning">Knowledge quiz · {2 - quizAttempts} attempts remaining</StatusTag>
                      <fieldset className="mt-5">
                        <legend className="text-sm font-semibold">Which business is associated with this application?</legend>
                        <div className="mt-3 grid gap-2">
                          {mockQuizOptions(businessName).map((answer) => <Button className="min-h-11 justify-start" disabled={enrollPending || pending === "verify"} key={answer} onClick={() => answerQuiz(answer)} type="button" variant="outline">{answer}</Button>)}
                        </div>
                      </fieldset>
                      {quizAttempts === 1 ? <p className="mt-3 text-xs text-[var(--consumer-negative)]" role="alert">That answer did not match. One attempt remains.</p> : null}
                    </div>
                  ) : null}
                  {!verified && identityMode === "locked" ? (
                    <div className="mt-8 rounded-[10px] border border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_65%)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_58%)] p-5">
                      <AlertTriangle aria-hidden className="size-5 text-[var(--consumer-warning-ink)]" />
                      <h2 className="mt-3 text-sm font-semibold">Identity check parked for 72 hours</h2>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">The payment authorization was released and no charge was captured. {formatRetryDate(enrollmentView?.parkedUntil ?? null) ? <>SecureView will email {email} when retry opens on {formatRetryDate(enrollmentView?.parkedUntil ?? null)}.</> : <>SecureView will email {email} when retry opens. The reopening date is not recorded on this enrollment yet.</>}</p>
                      <StatusTag tone="neutral">Pending · no charge</StatusTag>
                      {demoResetControl}
                    </div>
                  ) : null}
                  {verified ? (
                    <div className="mt-8 rounded-[10px] border border-[color-mix(in_srgb,var(--consumer-positive),transparent_72%)] bg-[color-mix(in_srgb,var(--consumer-positive),transparent_94%)] p-6 text-center">
                      <span className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--consumer-positive)] text-card">
                        <CheckCircle2 aria-hidden className="size-5" />
                      </span>
                      <h2 className="mt-4 text-base font-semibold">Enrollment complete</h2>
                      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                        Identity is verified. The subscription is active, the first {formatPrice(enroll?.priceCents ?? 4900, true)} payment was taken, and the first authorized analysis is queued.
                      </p>
                      <Button
                        className="mt-5 min-h-11"
                        onClick={() => {
                          onComplete({
                            analysis,
                            cardLast4: authorizedCardLast4,
                            email,
                            enrollment: enrollmentView,
                            monitoring,
                            name,
                            phone,
                          });
                        }}
                      >
                        Open consumer workspace <ArrowRight aria-hidden />
                      </Button>
                      {demoResetControl}
                    </div>
                  ) : null}
                  {!verified && identityMode !== "locked" ? (
                    <div className="mt-auto flex items-center justify-start pt-8">
                      <Button className="min-h-11" onClick={() => setStep(3)} variant="ghost">
                        <ArrowLeft aria-hidden /> Back
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </motion.div>
          </div>

          <div className="hidden lg:block">
            <motion.div
              animate={{ opacity: 1 }}
              className="h-full"
              initial={reduceMotion ? false : { opacity: 0.78 }}
              key={`context-${step}`}
              transition={{ duration: reduceMotion ? 0 : 0.2 }}
            >
              <ContextPanel idvDriver={enroll?.idvDriver} step={step} priceCents={enroll?.priceCents ?? 4900} />
            </motion.div>
          </div>
        </div>
      </div>

      <Dialog onOpenChange={setAuthorizationOpen} open={authorizationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review payment authorization</DialogTitle>
            <DialogDescription>{PAYMENT_STEP_DESCRIPTION}</DialogDescription>
          </DialogHeader>
          <div className="rounded-[8px] border border-[var(--consumer-border)] bg-[var(--consumer-canvas)] p-4 text-xs">
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Authorization now</span><strong>No charge</strong></div>
            <div className="mt-2 flex justify-between gap-4"><span className="text-muted-foreground">First payment after enrollment</span><strong className="tabular-nums">{formatPrice(enroll?.priceCents ?? 4900, true)}</strong></div>
            <div className="mt-2 flex justify-between gap-4"><span className="text-muted-foreground">Then renews</span><strong>Monthly</strong></div>
          </div>
          <div className="max-h-56 overflow-y-auto text-xs leading-6 text-muted-foreground" tabIndex={0}>
            {ENROLLMENT_AGREEMENT_SUMMARY}
          </div>
          <DialogFooter>
            <Button className="min-h-11" onClick={() => setAuthorizationOpen(false)} variant="outline">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
