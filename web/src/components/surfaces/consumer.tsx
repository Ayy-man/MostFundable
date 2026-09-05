"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  CreditCard,
  Download,
  FileCheck2,
  FileText,
  Flag,
  FolderLock,
  Gauge,
  GraduationCap,
  Landmark,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  MessageCircleMore,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Upload,
  WalletCards,
  Check,
} from "lucide-react";

import {
  ConsumerPageHeader,
  LabeledProgress,
  MetricRow,
  SourceStamp,
  StateMarker,
  StatusTag,
  WorkspaceSection,
} from "@/components/consumer/consumer-kit";
import { JourneyActiveDot, JourneyConnector, JourneyStepIcon, type JourneyStage } from "@/components/consumer/journey-step-icon";
import { ReadinessRing } from "@/components/consumer/readiness-ring";
import { ConsumerCreditWidget } from "@/components/consumer/credit-widget";
import { useCountUp, usePrevious } from "@/lib/motion/hooks";
import { DurableOptimizationView } from "@/components/consumer/optimization-view";
import {
  ConsumerTrainingsView,
  type TrainingLesson,
  type TrainingsStatus,
} from "@/components/consumer/trainings-view";
import { ConsumerTeamChat } from "@/components/consumer/team-chat";
import { ConsumerPrivacyRequests } from "@/components/consumer/privacy-requests";
import { ASSISTANT_LAUNCHER_ADJACENT_CLASS } from "@/components/assistant/global-companion";
import { ConsumerAssistantCompanion } from "@/components/assistant/consumer-companion";
import { consumerAssistantContext } from "@/components/assistant/page-context";
import type { ConsumerTeamChatSnapshot } from "@/lib/support";
import { ReferralShareControl } from "@/components/consumer/referral-share-control";
import {
  ConsumerShell,
  type ConsumerNavItem,
} from "@/components/consumer/consumer-shell";
import {
  ANCILLARY_UNAVAILABLE_NOTICE,
  ENROLLMENT_UNAVAILABLE_NOTICE,
  loadAncillaryBootstrap,
  loadEnrollmentBootstrap,
  type AncillaryConfig,
  type BootstrapState,
} from "@/components/surfaces/consumer-bootstrap";
import { cancelConsumerEnrollment, consentStateFromView } from "@/components/surfaces/consumer-cancel";
import {
  analysisCompleteCopy,
  applicationUpdateCopy,
  documentCopy,
  enrollmentMilestoneCopy,
  monitoringAlertCopy,
  refreshResultCopy,
  stageChangeCopy,
  teamMessageCopy,
} from "@/lib/notifications/copy";
import {
  fetchNotifications,
  NOTIFICATION_TARGET,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_WINDOW_DAYS,
  type NotificationEventType,
  type NotificationEventV2,
} from "@/components/surfaces/consumer-notifications";
import type { ConsumerNotificationPreferences } from "@/lib/notifications/preferences";
import {
  ConsumerNotificationsView,
  type NotificationsSurfaceStateV1,
} from "@/components/consumer/notifications-view";
import { DEMO_ROLES } from "@/components/demo/demo-chrome";
import {
  CommandPalette,
  type CommandPalettePage,
  type CommandPaletteRecord,
} from "@/components/demo/command-palette";
import { useFeedbackSession } from "@/components/demo/feedback-session";
import { Onboarding1, type OnboardingDraft } from "@/components/onboarding1";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { SessionDisplayIdentity } from "@/lib/auth/display-identity";
import { postJson } from "@/lib/enrollment/client";
import { CONSENT_DOCUMENTS } from "@/lib/enrollment/consent-texts";
import type {
  EnrollConfig,
  EnrollmentView,
  MilestoneKind,
  SubscriptionView,
} from "@/lib/enrollment/types";
// The one date formatter this repo already trusts for a durable timestamp: UTC so two viewers
// never disagree about the day a row was written, and `null` rather than "Invalid Date" when the
// value will not parse, which is the em-dash-with-reason arm the billing panels need.
// Aliased because the Overview component already declares a local `formatTrackerDate` over the
// same Intl options; shadowing an import inside one function and not another is how a later reader
// picks the wrong one.
import { buildPaymentHistory } from "@/lib/billing/payment-history";
import { formatTrackerDate as formatDurableDate } from "@/lib/operator/tracker-detail";
import type { ConsumerPricingCatalog } from "@/lib/pricing/http";
import {
  fetchConsumerPaidRefreshHistory,
  isPaidRefreshInProgress,
  paidRefreshBlocksNewPurchase,
  paidRefreshCanResume,
  type ConsumerPaidRefreshRecord,
} from "@/lib/pricing/paid-refresh-read";
import {
  readWorkspacePreferences,
  type PortalApplicationVisibility,
  type WorkspacePreferences,
} from "@/lib/portal/preferences";
import { readConsumerProfile, updateConsumerProfile } from "@/lib/profile/consumer-profile";
import {
  addConsumerApplicationNote,
  clearSubmittedConsumerNoteDraft,
  clearSubmittedConsumerOutcomeDraft,
  deriveConsumerApprovedFunding,
  readConsumerApplications,
  recordConsumerApplicationOutcome,
  type ConsumerApplicationOutcomeDraft,
  type ConsumerApplicationsRead,
} from "@/lib/applications/consumer";
import { DEMO_CLIENTS } from "@/lib/demo/feedback-fixtures";
import {
  FUNDING_STAGES,
  READY_PROFILE_COMPLETION,
  type ConsumerApplicationContext,
  type FundingStage,
  type SurfaceProps,
} from "@/lib/demo/types";
import {
  MONITORING_BASELINE,
  MONITORING_BASELINE_LABEL,
  MONITORING_BASELINE_UTILIZATION_PCT,
  type MonitoringReading,
} from "@/lib/monitoring/reading";
import { useTrackerClients } from "@/lib/tracker/realtime.client";
import { trackerStageTimer } from "@/lib/tracker/timer";
import {
  TRACKER_STAGE_LABELS,
  trackerStageFromLabel,
  type TrackerClient,
  type TrackerStage,
} from "@/lib/tracker/types";
import { cn } from "@/lib/utils";

type ViewId =
  | "dashboard"
  | "optimization"
  | "plan"
  | "matches"
  | "credit"
  | "documents"
  | "agreements"
  | "coach"
  | "learning"
  | "notifications"
  | "settings"
  | "onboarding";

type Consent = "analysis" | "monitoring";
type ActionState = "todo" | "reported" | "verifying" | "verified";
/**
 * Why a reporting control is switched off, or `null` when it may run.
 *
 * `canceled` is the pre-existing closed-account reason. `no-durable-store` is
 * the wiring-audit finding (`docs/backend/UI-WIRING-BACKLOG.md` #2): the state
 * grammar this control drives lives in `checklist_item_state`, migration 003
 * grants `authenticated` nothing but `select` on it, and no route under
 * `src/app/api` reads or writes it — so a reported action cannot outlive the
 * tab. Where the workspace is durable that makes the control a claim the
 * system cannot keep, and an honestly disabled control beats a lying one.
 */
type ReportBlock = null | "canceled" | "no-durable-store";
type PlanItemState = ActionState | "guardrail";
type ConsumerProfile = { email: string; name: string; phone: string };
type ReadinessTrack = "personal" | "business";
type ChecklistFilter = "open" | "done";
type ConsumerApplicationsSurfaceState = ConsumerApplicationsRead | { readonly status: "loading" };
type DocumentCategory =
  | "articles"
  | "ein"
  | "tax-returns"
  | "bank-statements"
  | "other";
type LiveDocument = { id: string; section: "articles" | "ein" | "tax_returns" | "bank_statements" | "other"; displayName: string };

/**
 * The honest-refusal notices this surface needs, in one place so the copy
 * gate and the source-derived guard both have a single string to read.
 *
 * Each one stands where a control used to assert an effect the platform cannot
 * produce yet. None of them promises a future date, and none of them describes
 * the work as anything other than what it is.
 */
const ACTION_REPORTING_UNAVAILABLE =
  "Reporting an action is not available in this workspace yet, so nothing here is stored on your account. Tell your funding team what you completed.";
const CONSENT_SIGNING_UNAVAILABLE =
  "This authorization is still unsigned. Signing it is not available in this workspace, so ask your funding team how to complete it.";
const APPLICATIONS_UNAVAILABLE =
  "Your application sequence is not available in this workspace yet. Your funding team holds the current record.";
/**
 * Account & Billing's durable-state notices.
 *
 * The page used to render module fixtures for every consumer: an active $49 plan, a saved Visa
 * ending 4242, and paid rows dated Jun 20 through Jul 21. On a consumer who has never enrolled
 * that is billing history dated before any enrollment exists, which contradicts the rule this
 * product states on its own first page — a card is authorized during enrollment and charged only
 * when the enrollment succeeds. So the durable branch renders `public.consumer_subscriptions`, and
 * where that row has nothing to say it says so.
 *
 * `SUBSCRIPTION_ABSENT_NOTICE` is the pre-enrollment state and is the one that has to be exactly
 * right: it must not read as an outage, because nothing failed.
 */
const SUBSCRIPTION_ABSENT_NOTICE =
  "No subscription is recorded on this account. A card is authorized during enrollment and charged only once enrollment succeeds.";
const PAYMENT_HISTORY_ABSENT_NOTICE =
  "No payments are recorded on this account yet.";
const PAYMENT_METHOD_ABSENT_NOTICE =
  "No payment method is shown on this account. If a billing customer exists, add or replace one in the secure billing portal.";
const PAYMENT_METHOD_DETAIL_UNAVAILABLE =
  "A payment method is on file. Card details, replacement, and cancellation are handled in the secure billing portal.";
const BILLING_PORTAL_UNAVAILABLE =
  "Billing management is unavailable because no billing customer is recorded for this account.";
const RENEWAL_DATE_UNAVAILABLE =
  "The next renewal date is not recorded on this account.";
const CONSENT_ABSENT_DETAIL =
  "No authorization is recorded. Both named permissions are captured during enrollment.";
/**
 * Fixture-eviction notices.
 *
 * `AGREEMENT_RECORD_ABSENT` stands where the Agreement record used to open on a
 * literal row — "Funding Readiness Service Agreement · Signed Jun 24 · Approved"
 * — that no read produced. All three documents do have durable evidence:
 * `EnrollmentView.consents` for the two named authorizations, and the
 * `agreement_signed` milestone for the service agreement. So each row reads its
 * own record, and this notice is for the account that carries none of the three.
 *
 * `DOCUMENT_DOWNLOAD_UNAVAILABLE` replaces `downloadDemoDocument` on a durable
 * workspace. That helper writes a text file whose body reads "MostFundable demo
 * document · Generated: Jul 21, 2026", which is a fabricated record leaving the
 * product in the reader's downloads folder, outliving any on-screen caveat.
 *
 * The Optimization view reads its checklist, receipts and utilization through
 * `GET /api/optimization` (`DurableOptimizationView`), so the placeholders that
 * used to stand in for those lists are gone.
 */
const AGREEMENT_RECORD_ABSENT =
  "This record holds the documents captured during enrollment. Nothing is recorded on this account yet.";
const DOCUMENT_DOWNLOAD_UNAVAILABLE =
  "Downloading this record is not available in this workspace yet. Ask your funding team for a copy.";
/**
 * Tier-2 eviction notices — the flag-latent branches.
 *
 * Every notice above stands where a durable read exists and came back empty.
 * These four stand somewhere subtler: the read is switched off, the surface
 * still renders, and until now the off-branch handed a signed-in consumer the
 * fixture person's records. A flag is a deployment fact, never a fact about
 * whose account this is, so each of these branches now asks `durableWorkspace`
 * and says what it does not have.
 */
const TRACKER_STATUS_ABSENT =
  "Funding-readiness status is not available in this workspace yet. Your funding team holds the current record.";
const NOTIFICATIONS_ABSENT =
  "Notifications are not available in this workspace yet.";
const DOCUMENT_STORAGE_ABSENT =
  "Document storage is not available in this workspace yet. Ask your funding team where to send your files.";
const ENROLLMENT_EVIDENCE_ABSENT = "Enrollment evidence unavailable";
const CANCELLATION_UNAVAILABLE =
  "Cancelling is not available in this workspace yet. Ask your funding team to close your plan.";
const PAID_REFRESH_UNAVAILABLE =
  "An add-on refresh cannot be purchased in this workspace yet. Your funding team can tell you when your next included refresh runs.";
const PORTAL_PREFERENCES_UNAVAILABLE =
  "Workspace portal settings could not be loaded. Trainings, document uploads, funding progress, and application details stay hidden until the settings can be read.";
const DOCUMENT_UPLOADS_DISABLED =
  "Document uploads are disabled by your funding workspace. Files already stored here remain available.";
const DOCUMENT_UPLOADS_LOADING =
  "Document upload permissions are loading, so new uploads stay disabled. Files already stored here remain available.";
const DOCUMENT_UPLOADS_UNAVAILABLE =
  "Document upload permissions could not be loaded, so new uploads stay disabled. Files already stored here remain available.";

function priceLabel(amountCents: number, fractionDigits = 0): string {
  return `$${(amountCents / 100).toFixed(fractionDigits)}`;
}

function subscribeToNothing() {
  return () => {};
}

// Same shape the operator and admin workspaces use, so an application date
// reads identically to the client and to the team discussing it with them.
function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

const workspaceNavItems: ConsumerNavItem[] = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "optimization", label: "Optimization", shortLabel: "Optimize", icon: Gauge },
  { id: "plan", label: "Your Funding", shortLabel: "Funding", icon: ClipboardCheck },
  { id: "credit", label: "Credit Monitoring", shortLabel: "Credit", icon: CreditCard },
  { id: "coach", label: "Team Chat", icon: MessageCircleMore },
];

const platformNavItems: ConsumerNavItem[] = [
  { id: "documents", label: "Onboarding & Docs", icon: FolderLock },
  { id: "learning", label: "Trainings", icon: GraduationCap },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "settings", label: "Account & Billing", icon: Settings2 },
];

const planActions = [
  {
    title: "Bring Chase Ink to $3,480 or less",
    detail:
      "Current reported balance is $7,620. A $4,140 payment brings utilization to the 29% target.",
    factor: "Utilization",
    placeholderDays: 26,
    track: "personal" as const,
    due: "Aug 16",
    instructions: [
      "Confirm the $3,480 target with your funding team before sending a payment.",
      "Make the payment through your Chase account and save the confirmation.",
      "Report the action here, then wait for a dated bureau update before treating it as verified.",
    ],
  },
  {
    title: "Pay Capital One Spark below $2,610",
    detail:
      "Current reported balance is $4,050. The target remains open until the next bureau update verifies it.",
    factor: "Utilization",
    placeholderDays: 40,
    track: "personal" as const,
    due: "Aug 30",
    instructions: [
      "Confirm the $2,610 target with your funding team before sending a payment.",
      "Make the payment through your Capital One account and save the confirmation.",
      "Report the action here, then wait for the next dated source update.",
    ],
  },
  {
    title: "Open one net-30 vendor tradeline",
    detail:
      "Choose a vendor you already use, then allow 30 to 60 days for the account to season and report.",
    factor: "Business setup",
    placeholderDays: 42,
    track: "business" as const,
    due: "Sep 1",
    instructions: [
      "Ask your funding team to confirm that a reporting tradeline fits the current plan.",
      "Choose a vendor your business already needs and review its terms before opening an account.",
      "Save the account record and report the action here; seasoning and reporting can take 30 to 60 days.",
    ],
  },
  {
    title: "Hold all new credit applications",
    detail:
      "Keep the inquiry count stable until the verified Ready gate is reached.",
    factor: "Inquiry discipline",
    placeholderDays: 42,
    track: "personal" as const,
    due: "Until Ready",
    instructions: [
      "Do not submit a new credit application while this guardrail is active.",
      "Ask your funding team before agreeing to any application that may create an inquiry.",
      "Keep any offer or invitation for review instead of acting on it on your own.",
    ],
  },
];

const factors = [
  { actionIndexes: [], detail: "Confirm your name, address and other identifying information against the current source report with your funding team.", label: "Correct personal information", state: "Verified", track: "personal" as const },
  { actionIndexes: [], detail: "Review the dated report state with your funding team and keep supporting records for anything that needs a source check.", label: "Clean report", state: "Verified", track: "personal" as const },
  { actionIndexes: [0, 1], detail: "Open the account subtasks below for the current targets, then wait for a dated bureau update before treating the factor as verified.", label: "Utilization under 30%", state: "Action needed", track: "personal" as const },
  { actionIndexes: [], detail: "Keep established accounts open and ask your funding team before opening anything new; the next source check confirms the count.", label: "Minimum 4 personal credit accounts open", state: "Review", track: "personal" as const },
  { actionIndexes: [], detail: "Account age changes with time. Avoid closing established accounts without reviewing the effect with your funding team.", label: "Average credit age across all accounts 2+ years", state: "Review", track: "personal" as const },
  { actionIndexes: [], detail: "Review the dated report state and any supporting records with your funding team. This row records readiness; it does not promise a reporting outcome.", label: "No negative items", state: "Review", track: "personal" as const },
  { actionIndexes: [], detail: "Confirm the current limits from the dated source report. Ask your funding team before considering any new application.", label: "Minimum 1 personal credit card with limit $10k+", state: "Review", track: "personal" as const },
  { actionIndexes: [3], detail: "Hold new credit applications while this factor is under review and keep any offers for your funding team to assess first.", label: "Max 2 inquiries on each bureau", state: "Review", track: "personal" as const },
  { actionIndexes: [2], detail: "Open the subtask below for the reporting-tradeline guidance and confirm any vendor fits the current plan before acting.", label: "Business trade references", state: "Action needed", track: "business" as const },
  { actionIndexes: [], detail: "Upload the current formation and filing records in Onboarding & Docs so your funding team can verify the business profile.", label: "Entity and filings", state: "Review", track: "business" as const },
];

const optimizationWarnings = [
  "Hold all new credit applications",
  "Do not complete steps on your own if unsure. Ask for help! We may ask you to do it again so save time & money.",
  "Be patient! Everything we do will help your credit & finances for life.",
] as const;

const onboardingMilestones: ReadonlyArray<{
  fixtureComplete: boolean;
  kind: MilestoneKind;
  label: string;
}> = [
  { fixtureComplete: true, kind: "agreement_signed", label: "Agreement signed" },
  { fixtureComplete: true, kind: "documents_uploaded", label: "Docs uploaded" },
  { fixtureComplete: true, kind: "monitoring_connected", label: "Credit monitoring connected" },
  { fixtureComplete: false, kind: "onboarding_call_completed", label: "Onboarding call completed" },
];

type OverviewMetric = {
  /** The raw amount behind a money figure, so the cell can count it rather than swap it. */
  amountCents?: number | null;
  detail: string;
  label: string;
  value: string;
};

type OverviewMetricInput = {
  estimatedCompletion: OverviewMetric;
  fundingApprovedCents: number | null;
  monitoring: OverviewMetric;
  nextRefresh: OverviewMetric;
  openActions: OverviewMetric;
  readiness: OverviewMetric;
  stage: OverviewMetric;
};

function formatFundingApproved(amountCents: number | null): string {
  if (amountCents === null) return "No recorded outcome";
  return (amountCents / 100).toLocaleString("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  });
}

function buildOverviewMetricRows(input: OverviewMetricInput): {
  bottom: OverviewMetric[];
  top: OverviewMetric[];
} {
  const fundingApproved = input.fundingApprovedCents === null
    ? {
        detail: "No recorded historical outcome",
        label: "Funding approved",
        value: formatFundingApproved(null),
      }
    : {
        amountCents: input.fundingApprovedCents,
        detail: "Recorded historical outcome",
        label: "Funding approved",
        value: formatFundingApproved(input.fundingApprovedCents),
      };

  return {
    top: [input.stage, input.monitoring, input.nextRefresh],
    bottom: [input.readiness, input.openActions, input.estimatedCompletion, fundingApproved],
  };
}

function OverviewMetricCell({
  count,
  index,
  metric,
}: {
  count: number;
  index: number;
  metric: OverviewMetric;
}) {
  const monitoring = metric.label === "Monitoring";
  const monitoringActive = monitoring && !/(inactive|paused|revoked|unavailable|not authorized)/i.test(metric.value);
  // A money figure counts to its value and ticks when a recorded outcome moves it. Every other
  // metric is a label or a date and simply reads its string.
  const amountCents = metric.amountCents ?? null;
  const shownCents = useCountUp(amountCents, 900);
  const previousCents = usePrevious(amountCents);
  const amountTicked = previousCents !== undefined && previousCents !== null && previousCents !== amountCents;
  const shownValue = amountCents !== null && shownCents !== null ? formatFundingApproved(shownCents) : metric.value;

  return (
    <div
      className={cn(
        "border-b border-[var(--consumer-border)] p-4 lg:border-b-0",
        index < count - 1 && "lg:border-r",
        monitoring && "flex min-h-24 items-center gap-3",
      )}
    >
      {monitoring ? (
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-full",
            monitoringActive
              ? "bg-[var(--consumer-accent-tint)] text-[var(--consumer-accent-ink)]"
              : "bg-muted text-muted-foreground",
          )}
        >
          <ShieldCheck aria-hidden className="size-5" />
        </span>
      ) : null}
      <div className="min-w-0">
        {monitoring ? null : <p className="text-xs text-muted-foreground">{metric.label}</p>}
        <p className={cn("font-semibold tabular-nums", monitoring ? "text-sm" : "mt-2 text-lg")} data-count-tick={amountTicked ? "" : undefined} key={amountTicked ? amountCents ?? 0 : "rest"}>
          {monitoring ? `Monitoring ${monitoringActive ? "active" : metric.value.toLowerCase()}` : shownValue}
        </p>
        <p className="mt-1 text-[0.68rem] text-muted-foreground">{metric.detail}</p>
      </div>
    </div>
  );
}

const accounts = [
  {
    account: "Chase Ink Business",
    balance: "$7,620",
    limit: "$12,000",
    utilization: "64%",
    target: "$3,480",
    tone: "warning" as const,
  },
  {
    account: "Capital One Spark",
    balance: "$4,050",
    limit: "$9,000",
    utilization: "45%",
    target: "$2,610",
    tone: "warning" as const,
  },
  {
    account: "Amex Blue Business",
    balance: "$1,160",
    limit: "$15,000",
    utilization: "8%",
    target: "Under target",
    tone: "success" as const,
  },
  {
    account: "US Bank Triple Cash",
    balance: "$0",
    limit: "$7,500",
    utilization: "0%",
    target: "Under target",
    tone: "success" as const,
  },
];

// The frozen fixture file, now imported rather than repeated. The durable reading folds paid
// refreshes over these same three rows, so a workspace with no completed refresh renders exactly
// what the frozen surface rendered and the two cannot drift apart.
const bureaus = MONITORING_BASELINE;

/**
 * How the panel waits for a paid refresh to land.
 *
 * The interval is a courtesy to a consumer watching the page, and the window is the honest bound
 * on it: on the mock driver the queued run is drained straight after the response and lands in
 * seconds, but the cron is the authority and a missed drain leaves it up to a quarter hour away.
 * Rather than spin until then, the card stops asking and says the refresh is still running.
 */
const REFRESH_POLL_INTERVAL_MS = 2_000;
const REFRESH_POLL_WINDOW_MS = 120_000;
const PAID_REFRESH_ATTEMPT_STORAGE_PREFIX = "mostfundable:paid-refresh-attempt:";

function paidRefreshAttemptStorageKey(clientId: string): string {
  return `${PAID_REFRESH_ATTEMPT_STORAGE_PREFIX}${clientId}`;
}

function readStoredPaidRefreshAttempt(clientId: string): string | null {
  try {
    const value = window.sessionStorage.getItem(paidRefreshAttemptStorageKey(clientId));
    return value !== null
      && value.length > 0
      && value.length <= 128
      && value === value.trim()
      ? value
      : null;
  } catch {
    return null;
  }
}

function writeStoredPaidRefreshAttempt(clientId: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(paidRefreshAttemptStorageKey(clientId));
    else window.sessionStorage.setItem(paidRefreshAttemptStorageKey(clientId), value);
  } catch {
    // The in-memory ref still supports exact-key recovery while this tab stays mounted.
  }
}

type MonitoringSurfaceState = "fixture" | "loading" | "ready" | "unavailable" | "error";
type PortalPreferencesReadState = "fixture" | "loading" | "ready" | "unavailable";

const documentSections: Array<{
  description: string;
  fixtureFiles: string[];
  id: DocumentCategory;
  title: string;
}> = [
  {
    description: "Formation records for each business",
    fixtureFiles: ["Articles of Organization.pdf"],
    id: "articles",
    title: "Articles of incorporation",
  },
  {
    description: "Federal tax identification confirmations",
    fixtureFiles: ["EIN confirmation.pdf"],
    id: "ein",
    title: "EIN confirmation",
  },
  {
    description: "Business returns organized by tax year",
    fixtureFiles: ["2024 Business Tax Return.pdf"],
    id: "tax-returns",
    title: "Tax returns",
  },
  {
    description: "Statements may cover more than one business",
    fixtureFiles: [],
    id: "bank-statements",
    title: "Bank statements",
  },
  {
    description: "Additional company records requested by your team",
    fixtureFiles: [],
    id: "other",
    title: "Other",
  },
];

function emptyDocumentUploads(): Record<DocumentCategory, string[]> {
  return {
    articles: [],
    "bank-statements": [],
    ein: [],
    other: [],
    "tax-returns": [],
  };
}

/**
 * The lessons the fixture walkthrough shows, in the shape the read path returns.
 *
 * These carry a title and a body and nothing else, because that is all a `trainings`
 * row holds. The durations and categories they used to carry ("8 min", "Plan
 * fundamentals") described no column in the table and were printed over durable rows
 * too, as `category: "Training"` and `time: "Video lesson"`. A fixture may stand in for
 * an answer on the disclosed walkthrough; it may not invent a field the product does
 * not have.
 */
const FIXTURE_TRAINING_LESSONS: readonly TrainingLesson[] = [
  {
    body: "Balances usually reach the bureaus after a statement closes, so a payment can be complete while the reported utilization still reflects the prior cycle.",
    id: "fixture-utilization-reporting",
    title: "How utilization reporting works",
    videoUrl: null,
  },
  {
    body: "A soft pull supports monitoring without affecting your score. A hard inquiry is tied to a credit application and may appear on one or more bureau files.",
    id: "fixture-inquiry-order",
    title: "Soft pulls, hard pulls, and inquiry order",
    videoUrl: null,
  },
  {
    body: "A criteria match compares verified facts with published lender guidelines. It helps prioritize options, but it is not an approval or a credit decision.",
    id: "fixture-criteria-match",
    title: "What a lender criteria match means",
    videoUrl: null,
  },
  {
    body: "Each bureau can receive different account updates on different dates, so the useful signal is the verified source and reporting date beside each score.",
    id: "fixture-three-bureau-snapshot",
    title: "Reading your three-bureau snapshot",
    videoUrl: null,
  },
  {
    body: "Clear file separation makes review faster and reduces the chance that a personal statement is treated as evidence for a business obligation.",
    id: "fixture-file-separation",
    title: "Keeping business and personal files separate",
    videoUrl: null,
  },
];

/** The stamp a fixture row takes when the walkthrough marks it read. Fixed, so the demo is stable. */
const FIXTURE_NOTIFICATION_READ_AT = "2026-07-21T12:00:00.000Z";

/**
 * What the fixture shell's empty state teaches.
 *
 * A durable read reports the classes this tenant's flags actually enable; the fixture shell has no
 * flags to report, so it names every class the product can produce rather than only the ones its
 * own seeded rows happen to cover.
 */
const FIXTURE_NOTIFICATION_SOURCES: NotificationEventType[] = [
  "enrollment_milestone",
  "analysis_complete",
  "refresh_result",
  "stage_change",
  "document",
  "team_message",
  "monitoring_alert",
  "application_update",
];

/**
 * One fixture event, with its copy generated by the SERVER's own templates.
 *
 * §3 says the fixture mirrors the templates the server owns. It used to mirror them by hand, and
 * every round since has caught that hand drifting -- a parenthetical the template does not print
 * (C4), a section label in a vocabulary the uploads table does not use (C9), a date re-stamped
 * beside pre-rendered prose (C1). Now `web/src/lib/notifications/copy.ts` writes both strings, so
 * the flags-OFF demo cannot say anything a real account would not receive, and a copy ruling
 * applied to the server reaches this list with no second edit.
 *
 * The type comes off the event key's own prefix (§2: `<type>:<source id>`) and the deep-link
 * target off the view's own type map, so those two cannot drift apart either.
 */
function event(
  id: string,
  occurredAt: string,
  readAt: string | null,
  copy: { title: string; detail: string },
): NotificationEventV2 {
  const type = id.slice(0, id.indexOf(":")) as NotificationEventType;
  return { detail: copy.detail, id, occurredAt, readAt, target: NOTIFICATION_TARGET[type], title: copy.title, type };
}

/**
 * The fixture-shell notification feed: one consumer's lifeline, in order.
 *
 * Every title and detail mirrors a template the server owns (lane contract §3), so the flags-OFF
 * demo shows the sentences a real account would receive rather than a second, friendlier
 * vocabulary. The sequence is the one the product actually produces — five enrollment milestones,
 * then the first analysis, then the alerts that analysis makes possible — so nothing here implies a
 * record read before the consent that authorizes it, and the stage only ever moves forward through
 * the taxonomy (Onboarding, Optimization, Ready, Applying).
 *
 * Every timestamp is in the past. Three days carry three or more events of one type, so the
 * walkthrough sees a real bundle rather than an argument that bundling works, and the Aug 23
 * application row records an update without asserting a decision either way.
 *
 * Reachable only from the fixture shell: on a durable workspace these rows are somebody else's
 * account, which is what the eviction gate exists to prevent.
 */
const notifications: NotificationEventV2[] = [
  event("monitoring_alert:alert-aug-24", "2026-08-24T10:18:00.000Z", null, monitoringAlertCopy()),
  event("team_message:dana-aug-24", "2026-08-24T08:32:00.000Z", null, teamMessageCopy("Dana Whitfield")),
  event("document:operating-agreement-aug-24", "2026-08-24T04:50:00.000Z", null, documentCopy("articles")),
  event("document:ein-letter-aug-24", "2026-08-24T04:21:00.000Z", null, documentCopy("ein")),
  event("document:good-standing-aug-24", "2026-08-24T04:03:00.000Z", null, documentCopy("bank_statements")),
  event("team_message:team-aug-23", "2026-08-23T10:42:00.000Z", "2026-08-23T18:00:00.000Z", teamMessageCopy(null)),
  event("application_update:meridian-update-aug-23", "2026-08-23T04:15:00.000Z", "2026-08-23T18:00:00.000Z", applicationUpdateCopy("update", "meridian-business-lending", "2026-08-23T04:15:00.000Z")),
  event("document:income-aug-22", "2026-08-22T11:00:00.000Z", "2026-08-23T18:00:00.000Z", documentCopy("tax_returns")),
  event("monitoring_alert:alert-aug-15-c", "2026-08-15T12:00:00.000Z", "2026-08-23T18:00:00.000Z", monitoringAlertCopy()),
  event("monitoring_alert:alert-aug-15-b", "2026-08-15T07:15:00.000Z", "2026-08-23T18:00:00.000Z", monitoringAlertCopy()),
  event("monitoring_alert:alert-aug-15-a", "2026-08-15T02:42:00.000Z", "2026-08-23T18:00:00.000Z", monitoringAlertCopy()),
  event("application_update:northgate-recorded-aug-5", "2026-08-05T06:22:00.000Z", "2026-08-23T18:00:00.000Z", applicationUpdateCopy("first", "northgate-working-capital", "2026-08-05T06:22:00.000Z")),
  event("application_update:meridian-recorded-aug-5", "2026-08-05T06:04:00.000Z", "2026-08-23T18:00:00.000Z", applicationUpdateCopy("first", "meridian-business-lending", "2026-08-05T06:04:00.000Z")),
  event("application_update:cardinal-recorded-aug-5", "2026-08-05T05:50:00.000Z", "2026-08-23T18:00:00.000Z", applicationUpdateCopy("first", "cardinal-capital-partners", "2026-08-05T05:50:00.000Z")),
  event("stage_change:applying-aug-5", "2026-08-05T03:38:00.000Z", "2026-08-23T18:00:00.000Z", stageChangeCopy("applying", "2026-08-05T03:38:00.000Z")),
  event("refresh_result:refresh-aug-1", "2026-08-01T07:00:00.000Z", "2026-08-23T18:00:00.000Z", refreshResultCopy()),
  event("stage_change:ready-jul-13", "2026-07-13T03:45:00.000Z", "2026-08-23T18:00:00.000Z", stageChangeCopy("ready", "2026-07-13T03:45:00.000Z")),
  event("team_message:marcus-jun-19", "2026-06-19T09:00:00.000Z", "2026-08-23T18:00:00.000Z", teamMessageCopy("Marcus Ellery")),
  event("document:identity-jun-19", "2026-06-19T05:45:00.000Z", "2026-08-23T18:00:00.000Z", documentCopy("ein")),
  event("stage_change:optimization-jun-19", "2026-06-19T04:20:00.000Z", "2026-08-23T18:00:00.000Z", stageChangeCopy("optimization", "2026-06-19T04:20:00.000Z")),
  event("monitoring_alert:alert-jun-7", "2026-06-07T10:12:00.000Z", "2026-08-23T18:00:00.000Z", monitoringAlertCopy()),
  event("analysis_complete:first-plan-jun-7", "2026-06-07T05:50:00.000Z", "2026-08-23T18:00:00.000Z", analysisCompleteCopy(true, "2026-06-07T05:50:00.000Z")),
  event("stage_change:onboarding-jun-5", "2026-06-05T05:05:00.000Z", "2026-08-23T18:00:00.000Z", stageChangeCopy("onboarding", "2026-06-05T05:05:00.000Z")),
  event("enrollment_milestone:payment-auth-jun-5", "2026-06-05T04:38:00.000Z", "2026-08-23T18:00:00.000Z", enrollmentMilestoneCopy("Payment authorization", "2026-06-05T04:38:00.000Z")),
  event("enrollment_milestone:esignature-jun-5", "2026-06-05T04:31:00.000Z", "2026-08-23T18:00:00.000Z", enrollmentMilestoneCopy("Electronic signature", "2026-06-05T04:31:00.000Z")),
  event("enrollment_milestone:analysis-consent-jun-5", "2026-06-05T04:24:00.000Z", "2026-08-23T18:00:00.000Z", enrollmentMilestoneCopy("Analysis authorization", "2026-06-05T04:24:00.000Z")),
  event("enrollment_milestone:monitoring-consent-jun-5", "2026-06-05T04:22:00.000Z", "2026-08-23T18:00:00.000Z", enrollmentMilestoneCopy("Monitoring authorization", "2026-06-05T04:22:00.000Z")),
  event("enrollment_milestone:profile-details-jun-5", "2026-06-05T04:10:00.000Z", "2026-08-23T18:00:00.000Z", enrollmentMilestoneCopy("Profile details", "2026-06-05T04:10:00.000Z")),
];

function actionState(index: number, reported: Set<number>): PlanItemState {
  if (index === 3) return "guardrail";
  if (reported.has(index)) return "reported";
  return "todo";
}

function ActionStateTag({ state }: { state: PlanItemState }) {
  if (state === "verified") {
    return <StatusTag icon={false} tone="success">Verified</StatusTag>;
  }
  if (state === "verifying") {
    return <StatusTag icon={false} tone="info">Verifying</StatusTag>;
  }
  if (state === "reported") {
    return <StatusTag icon={false} tone="info">Reported</StatusTag>;
  }
  if (state === "guardrail") {
    return <StatusTag icon={false} tone="info">Guardrail active</StatusTag>;
  }
  return <StatusTag icon={false} tone="neutral">To do</StatusTag>;
}

function ReadinessTrajectory({ analysisActive, canceled, readiness }: { analysisActive: boolean; canceled: boolean; readiness: number }) {
  const snapshotFrames = [
    { day: 0, date: "Jun 24", delta: 14 },
    { day: 4, date: "Jun 28", delta: 11 },
    { day: 8, date: "Jul 2", delta: 10 },
    { day: 13, date: "Jul 7", delta: 6 },
    { day: 16, date: "Jul 10", delta: 4 },
    { day: 20, date: "Jul 14", delta: 0 },
  ];
  const snapshots = snapshotFrames.map(({ delta, ...snapshot }) => ({
    ...snapshot,
    source: "Experian",
    value: Math.max(0, Math.min(100, readiness - delta)),
  }));
  const plot = { bottom: 140, left: 46, right: 394, top: 16 };
  const horizonDays = 50;
  const xForDay = (day: number) => plot.left + (day / horizonDays) * (plot.right - plot.left);
  const yForValue = (value: number) => plot.bottom - (value / 100) * (plot.bottom - plot.top);
  const points = snapshots.map((snapshot) => ({ ...snapshot, x: xForDay(snapshot.day), y: yForValue(snapshot.value) }));
  const currentPoint = points[points.length - 1];
  const historyPath = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const areaPath = `${historyPath} L${currentPoint.x.toFixed(1)} ${plot.bottom} L${points[0].x.toFixed(1)} ${plot.bottom} Z`;
  const targetY = yForValue(100);

  return (
    <div
      aria-label={canceled
        ? `Six source-dated readiness snapshots moved from ${snapshots[0].value} on June 24 to ${readiness} on July 14. The verified history is preserved as a closed account record, and no future credit refresh is scheduled because the account was canceled. Funding can start when the Cinderella profile reaches 100.`
        : analysisActive
        ? `Six source-dated readiness snapshots moved from ${snapshots[0].value} on June 24 to ${readiness} on July 14. The timeline continues empty through the next credit refresh on August 13. Funding can start when the Cinderella profile reaches 100.`
        : `Six source-dated readiness snapshots moved from ${snapshots[0].value} on June 24 to ${readiness} on July 14. The verified history is preserved, but no future credit refresh is scheduled because analysis authorization is paused. Funding can start when the Cinderella profile reaches 100.`}
      className="flex h-full flex-col text-[var(--consumer-hero-ink)]"
      role="figure"
    >
      <div className="flex items-start justify-between gap-5">
        <div>
          <p className="text-sm font-semibold text-[var(--consumer-hero-ink)]">Readiness history</p>
          <p className="mt-1 text-xs text-[var(--consumer-muted)]">Six source-dated observations</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-[var(--consumer-hero-ink)] tabular-nums">Readiness {readiness} / 100</p>
          <p className="mt-1 text-xs text-[var(--consumer-muted)] tabular-nums">Snapshot · Jul 14</p>
        </div>
      </div>
      <div className="mt-4 flex-1" aria-hidden>
        <div className="overflow-hidden border-y border-[var(--consumer-border)] py-3">
          <div className="relative">
            <svg className="aspect-[42/17] w-full overflow-visible" viewBox="0 0 420 170">
              <rect fill="color-mix(in srgb, var(--consumer-ink), transparent 96%)" height={plot.bottom - plot.top} width={plot.right - currentPoint.x} x={currentPoint.x} y={plot.top} />
              {[0, 25, 50, 75, 100].map((value) => (
                <line key={value} stroke="color-mix(in srgb, var(--consumer-ink), transparent 86%)" strokeWidth="1" x1={plot.left} x2={plot.right} y1={yForValue(value)} y2={yForValue(value)} />
              ))}
              {[0, 10, 20, 30, 40, 50].map((day) => (
                <line key={day} stroke="color-mix(in srgb, var(--consumer-ink), transparent 92%)" strokeWidth="1" x1={xForDay(day)} x2={xForDay(day)} y1={plot.top} y2={plot.bottom} />
              ))}
              <line stroke="var(--consumer-warning-border)" strokeDasharray="5 5" strokeWidth="1.5" x1={plot.left} x2={plot.right} y1={targetY} y2={targetY} />
              <line stroke="color-mix(in srgb, var(--consumer-ink), transparent 65%)" strokeDasharray="4 5" strokeWidth="1" x1={currentPoint.x} x2={currentPoint.x} y1={plot.top} y2={plot.bottom} />
              <path d={areaPath} fill="var(--consumer-accent-tint)" />
              <path d={historyPath} fill="none" stroke="var(--consumer-accent-ink)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
              {points.slice(0, -1).map((point) => (
                <circle cx={point.x} cy={point.y} fill="var(--consumer-hero-panel)" key={point.date} r="4" stroke="var(--consumer-accent-ink)" strokeWidth="1.75" />
              ))}
              <circle cx={currentPoint.x} cy={currentPoint.y} fill="var(--consumer-accent-ink)" r="5.5" />
              <circle cx={currentPoint.x} cy={currentPoint.y} fill="none" r="9" stroke="color-mix(in srgb, var(--consumer-accent-ink), transparent 55%)" strokeWidth="1" />
            </svg>
            <div className="pointer-events-none absolute inset-0 text-xs text-[var(--consumer-muted)] tabular-nums">
              {[0, 25, 50, 75, 100].map((value) => (
                <span className="absolute left-0 -translate-y-1/2" key={value} style={{ top: `${(yForValue(value) / 170) * 100}%` }}>{value}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="relative mt-3 h-8 text-xs text-[var(--consumer-muted)] tabular-nums">
          <span className="absolute left-0">Jun 24 · {snapshots[0].value}</span>
          <span className="absolute left-[40%] -translate-x-1/2 font-semibold text-[var(--consumer-hero-ink)]">Jul 14 · {readiness}</span>
          <span className="absolute right-0 text-right">{analysisActive ? "Aug 13 · scheduled" : canceled ? "Closed Jul 21" : "Unscheduled"}</span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 border-t border-[var(--consumer-border)] pt-3 text-xs">
        <div>
          <p className="text-[var(--consumer-muted)]">Source record</p>
          <p className="mt-1 font-medium text-[var(--consumer-hero-ink)]">6 dated snapshots</p>
        </div>
        <div className="text-right">
          <p className="text-[var(--consumer-muted)]">{analysisActive ? "Next credit refresh" : "Refresh status"}</p>
          <p className="mt-1 font-semibold text-[var(--consumer-hero-ink)]">{analysisActive ? "Aug 13" : "Not scheduled"}</p>
        </div>
      </div>
      <table className="sr-only">
        <caption>Verified readiness observations</caption>
        <thead><tr><th>Date</th><th>Readiness</th><th>Source</th></tr></thead>
        <tbody>{snapshots.map((snapshot) => <tr key={snapshot.date}><td>{snapshot.date}</td><td>{snapshot.value}</td><td>{snapshot.source}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/**
 * The durable counterpart of ReadinessTrajectory. The tracker read carries one
 * verified observation — the latest completed analysis — so this panel presents
 * exactly that and never draws a trajectory out of a single point the way the
 * fixture's six-snapshot graph would imply. History accrues as source checks
 * complete; until it exists, saying so is the honest render.
 */
function DurableReadinessPanel({ client, formatDate }: { client: TrackerClient; formatDate: (value: string) => string }) {
  const verified = client.readiness !== null;
  return (
    <div
      aria-label={verified
        ? `Verified readiness ${client.readiness} out of 100 from the latest completed analysis${client.analysisAt ? ` on ${formatDate(client.analysisAt)}` : ""}. ${client.nextRefreshAt ? `The next credit refresh is scheduled for ${formatDate(client.nextRefreshAt)}.` : "No credit refresh is scheduled."}`
        : "No completed funding-readiness analysis has been recorded yet, so there is no verified readiness score to show."}
      className="flex h-full flex-col text-[var(--consumer-hero-ink)]"
      role="figure"
    >
      <div className="flex items-start justify-between gap-5">
        <div>
          <p className="text-sm font-semibold text-[var(--consumer-hero-ink)]">Verified readiness</p>
          <p className="mt-1 text-xs text-[var(--consumer-muted)]">Latest completed analysis</p>
        </div>
        {verified && client.analysisAt ? (
          <p className="text-right text-xs text-[var(--consumer-muted)] tabular-nums">Snapshot · {formatDate(client.analysisAt)}</p>
        ) : null}
      </div>
      <div className="mt-4 flex flex-1 items-center gap-5 border-y border-[var(--consumer-border)] py-5">
        {/* The ring reads client.readiness and, while an authorized analysis is still running,
            client.analysisPending: it sweeps with no digits until the verified figure lands. */}
        <ReadinessRing inFlight={!verified && client.analysisPending !== null} value={client.readiness} />
        <div className="min-w-0">
          <FadeSwap as="div" className="text-sm font-semibold" id={verified ? "verified" : client.analysisPending !== null ? "running" : "pending"}>
            {verified ? "Verified from the latest completed analysis" : client.analysisPending !== null ? "Analysis running" : "Not yet verified"}
          </FadeSwap>
          <p className="mt-1.5 max-w-[30ch] text-xs leading-5 text-[var(--consumer-muted)]">
            {verified
              ? "Readiness history builds as completed source checks are recorded."
              : client.analysisPending !== null
                ? "The first verified figure lands here when the analysis completes."
                : "Readiness history builds as completed source checks are recorded."}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 pt-1 text-xs">
        <div>
          <p className="text-[var(--consumer-muted)]">Latest observation</p>
          <p className="mt-1 font-medium text-[var(--consumer-hero-ink)]">{client.analysisAt ? formatDate(client.analysisAt) : "None recorded"}</p>
        </div>
        <div className="text-right">
          <p className="text-[var(--consumer-muted)]">Next credit refresh</p>
          <p className="mt-1 font-semibold text-[var(--consumer-hero-ink)]">{client.nextRefreshAt ? formatDate(client.nextRefreshAt) : "Not scheduled"}</p>
        </div>
      </div>
    </div>
  );
}

function ActionList({
  actionIndexes,
  compact = false,
  navigate,
  nested = false,
  reported,
  reportBlock = null,
  track,
  toggleReported,
}: {
  actionIndexes?: number[];
  compact?: boolean;
  navigate?: (view: ViewId) => void;
  /** True when this list renders as a factor's subtasks inside the Cinderella
      checklist, where it is the fourth level of the type hierarchy rather than
      a section's own top-level content. */
  nested?: boolean;
  reported: Set<number>;
  reportBlock?: ReportBlock;
  track?: ReadinessTrack;
  toggleReported: (index: number) => void;
}) {
  const [instructionIndex, setInstructionIndex] = useState<number | null>(null);
  const matchingActions = planActions
    .map((item, index) => ({ index, item }))
    .filter(
      ({ index, item }) =>
        (!track || item.track === track) &&
        (!actionIndexes || actionIndexes.includes(index)),
    );
  const visible = compact ? matchingActions.slice(0, 3) : matchingActions;
  const instructionAction =
    instructionIndex === null ? null : planActions[instructionIndex];
  return (
    // Row layout depends on how wide THIS list is, not how wide the window is.
    // The widest place it renders is ~570px (the checklist track column at the
    // 86rem cap, less the subtask indent), so a `sm:` viewport breakpoint at
    // 640px was always on and always wrong: the `auto` button column took the
    // ~280px its two buttons need and the detail paragraph was left with about
    // 100px. A container query switches on the space the row actually has.
    // Do not turn this back into a viewport breakpoint.
    <div className="@container">
      {visible.map(({ index, item }) => {
        const state = actionState(index, reported);
        const isReported = reported.has(index);
        return (
          <div
            className="grid grid-cols-[1.6rem_minmax(0,1fr)] gap-3 border-b border-[var(--consumer-border)] py-4 first:pt-0 last:border-0 last:pb-0 @2xl:grid-cols-[1.6rem_minmax(0,1fr)_auto] @2xl:items-start"
            key={item.title}
          >
            <span className="mt-0.5">
              <StateMarker size="sm" state={state === "guardrail" ? "active" : state} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className={nested ? "text-xs font-medium" : "text-sm font-semibold"}>
                  {item.title}
                </p>
                <ActionStateTag state={state} />
              </div>
              {!compact ? (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {item.detail}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.68rem] text-muted-foreground">
                <span>{item.factor}</span>
                <span>{state === "guardrail" ? "TBD duration · observed through Jul 14" : `TBD duration · target ${item.due}`}</span>
              </div>
            </div>
            <div className="col-start-2 flex flex-wrap gap-2 justify-self-start @2xl:col-start-3 @2xl:justify-self-end">
              <Button
                className="min-h-11"
                onClick={() => setInstructionIndex(index)}
                size="sm"
                variant="outline"
              >
                Instructions
              </Button>
              {state !== "verified" && state !== "guardrail" ? (
                <Button
                  className="min-h-11"
                  disabled={reportBlock !== null}
                  onClick={() => toggleReported(index)}
                  size="sm"
                  title={reportBlock === "no-durable-store" ? ACTION_REPORTING_UNAVAILABLE : undefined}
                  variant={isReported ? "ghost" : "outline"}
                >
                  {reportBlock === "canceled" ? "Account canceled" : reportBlock === "no-durable-store" ? "Reporting unavailable" : isReported ? "Undo report" : "Report done"}
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
      {compact && navigate ? (
        <Button
          className="mt-4 min-h-11 px-0"
          onClick={() => navigate("optimization")}
          variant="link"
        >
          Open all actions <ArrowRight aria-hidden />
        </Button>
      ) : null}
      <Dialog
        onOpenChange={(open) => {
          if (!open) setInstructionIndex(null);
        }}
        open={instructionAction !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{instructionAction?.title}</DialogTitle>
            <DialogDescription>
              Review these educational steps with your funding team before acting.
            </DialogDescription>
          </DialogHeader>
          {instructionAction ? (
            <ol className="divide-y divide-[var(--consumer-border)] border-y border-[var(--consumer-border)]">
              {instructionAction.instructions.map((instruction, index) => (
                <li
                  className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 py-4 text-sm leading-6"
                  key={instruction}
                >
                  <span className="grid size-7 place-items-center rounded-full bg-[var(--consumer-accent-tint)] text-xs font-semibold text-[var(--consumer-accent-ink)] tabular-nums">
                    {index + 1}
                  </span>
                  <span>{instruction}</span>
                </li>
              ))}
            </ol>
          ) : null}
          <SourceStamp>
            No partner links are included. Ask your funding team if any step is unclear.
          </SourceStamp>
          <DialogFooter>
            <Button
              className="min-h-11"
              onClick={() => setInstructionIndex(null)}
              variant="outline"
            >
              Close instructions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function estimatedCompletionLabel(reported: Set<number>) {
  // TODO(question #46): Replace these placeholder durations with the
  // operator-approved task-duration model when Alec supplies it.
  const remainingDurations = planActions
    .map((item, index) => ({ index, item }))
    .filter(({ index }) => actionState(index, reported) === "todo")
    .map(({ item }) => item.placeholderDays);

  if (!remainingDurations.length) return "Awaiting refresh";

  const longestParallelDuration = Math.max(...remainingDurations);
  const date = new Date(Date.UTC(2026, 6, 21 + longestParallelDuration));
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function CinderellaChecklist({
  filter,
  reported,
  reportBlock,
  track,
  toggleReported,
}: {
  filter: ChecklistFilter;
  reported: Set<number>;
  reportBlock: ReportBlock;
  track: ReadinessTrack;
  toggleReported: (index: number) => void;
}) {
  const trackFactors = factors.filter((factor) => factor.track === track);
  const completed = trackFactors.filter((factor) => factor.state === "Verified");
  const visible = trackFactors.filter((factor) =>
    filter === "done"
      ? true
      : factor.state !== "Verified",
  );
  const completion = trackFactors.length
    ? Math.round((completed.length / trackFactors.length) * 100)
    : 0;
  const label = track === "personal" ? "Personal credit" : "Business setup";

  return (
    <section
      aria-label={`${label} checklist`}
      className="min-w-0 py-1"
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold tracking-[-0.015em]">{label}</h3>
          <p className="mt-1 text-[0.68rem] text-muted-foreground">
            {completed.length} of {trackFactors.length} known factors verified
          </p>
        </div>
        <span className="text-sm font-semibold tabular-nums">{completion}%</span>
      </div>
      <div className="mt-3">
        <LabeledProgress label={`${label} checklist completion`} value={completion} />
      </div>
      <div className="mt-5 divide-y divide-[var(--consumer-border)] border-t border-[var(--consumer-border)]">
        {visible.length ? (
          visible.map((factor) => {
            const verified = factor.state === "Verified";
            return (
              <details className="group py-2" key={factor.label}>
                <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-[8px] px-1 [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--consumer-accent-ink)]">
                  <StateMarker size="sm" state={verified ? "verified" : "todo"} />
                  <p className="min-w-0 flex-1 text-sm font-medium">{factor.label}</p>
                  <StatusTag
                    tone={
                      verified
                        ? "success"
                        : factor.state === "Review"
                          ? "info"
                          : "warning"
                    }
                  >
                    {factor.state}
                  </StatusTag>
                  <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                </summary>
                <div className="pb-2 pl-9 pr-1">
                  <p className="text-xs leading-5 text-muted-foreground">{factor.detail}</p>
                {factor.actionIndexes.length ? (
                  <div className="ml-7 mt-3 border-l border-[var(--consumer-border)] pl-4">
                    <p className="mb-3 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      {factor.actionIndexes.length === 1 ? "Subtask" : "Subtasks"}
                    </p>
                    <ActionList
                      actionIndexes={factor.actionIndexes}
                      nested
                      reportBlock={reportBlock}
                      reported={reported}
                      toggleReported={toggleReported}
                    />
                  </div>
                ) : null}
                </div>
              </details>
            );
          })
        ) : (
          <p className="py-5 text-sm text-muted-foreground">
            {filter === "done"
              ? "No checklist factors are recorded in this track yet."
              : "Every known factor in this track is already done."}
          </p>
        )}
      </div>
    </section>
  );
}

function DashboardView({
  analysisActive,
  canceled,
  clientId,
  clientStage,
  durableWorkspace,
  monitoringActive,
  navigate,
  profileName,
  readiness,
  referralsEnabled,
  reported,
  showFundingProgress,
}: {
  analysisActive: boolean;
  canceled: boolean;
  clientId: string;
  clientStage: FundingStage;
  durableWorkspace: boolean;
  monitoringActive: boolean;
  navigate: (view: ViewId) => void;
  profileName: string;
  readiness: number;
  referralsEnabled: boolean;
  reported: Set<number>;
  showFundingProgress: boolean;
}) {
  const { getClientFundedAmount } = useFeedbackSession();
  const trackerClients = useTrackerClients({ active: true, audience: "consumer" });
  /**
   * Which cast this view is allowed to draw from.
   *
   * Every branch below used to ask `trackerClients.enabled !== false`, which is
   * a question about a deployment flag. With `FEATURE_TRACKER` off, a signed-in
   * consumer fell through to the fixture arm and read one fixture person's
   * six-snapshot readiness graph, their named tradeline target, their "Day 27 of
   * 60" and their "Aug 13" refresh as their own. The flag decides whether the
   * read happens; `durableWorkspace` decides whose account this is, and only the
   * second one may select fixture data. So the fixture arm now needs both.
   */
  const fixtureOverview = !durableWorkspace && trackerClients.enabled === false;
  /** The read is switched off on an account that has no fixture to fall back to. */
  const trackerReadOff = durableWorkspace && trackerClients.enabled === false;
  const primaryReported = reported.has(0);
  const openActionCount = planActions.filter((_, index) => actionState(index, reported) === "todo").length;
  const personalOpenCount = planActions.filter(
    (item, index) =>
      item.track === "personal" && actionState(index, reported) === "todo",
  ).length;
  const businessOpenCount = planActions.filter(
    (item, index) =>
      item.track === "business" && actionState(index, reported) === "todo",
  ).length;
  const fundedAmount = getClientFundedAmount(clientId);
  const estimatedCompletion = estimatedCompletionLabel(reported);
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const now = hydrated ? new Date() : null;
  const trackerClient = trackerClients.clients[0] ?? null;
  const trackerTimer = trackerClient && now
    ? trackerStageTimer(trackerClient.stage, trackerClient.stageEnteredAt, now)
    : null;
  const formatTrackerDate = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
      year: "numeric",
    }).format(new Date(value));
  const handoff = useContext(EnrollmentHandoffContext);
  const reduceMotion = useReducedMotion();
  // The hero owns the shared box while the interstitial's card travels into it.
  const landing = handoff.phase === "landing" && handoff.fromRect !== null;
  const landingRef = useHandoffLanding(landing, handoff.fromRect, handoff.onHeroLanded);
  // Either hero branch below renders once the tracker read settles; the
  // handoff waits for exactly that before it lands the interstitial card.
  const heroWillRender = fixtureOverview || trackerReadOff || trackerClient !== null;
  const { onHeroReady } = handoff;
  useEffect(() => {
    if (handoff.phase === "staged" && heroWillRender) onHeroReady();
  }, [handoff.phase, heroWillRender, onHeroReady]);
  // While the first analysis drains (minutes on the production queue), keep
  // the hero live instead of a dead screen: realtime already invalidates when
  // the analysis completion touches the clients row, and this poll covers the
  // paths that never do, plus the queued→running hop the jobs table records.
  // Bounded so an abandoned tab stops polling after half an hour.
  const trackerRefetch = trackerClients.refetch;
  const awaitingFirstAnalysis = trackerClient !== null && trackerClient.status === "active" && trackerClient.readiness === null;
  useEffect(() => {
    if (!awaitingFirstAnalysis) return;
    const startedAt = Date.now();
    const tick = () => {
      if (document.hidden || Date.now() - startedAt > 30 * 60_000) return;
      void trackerRefetch().catch(() => {
        // A missed background poll needs no error surface; the next tick retries.
      });
    };
    const interval = window.setInterval(tick, 12_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [awaitingFirstAnalysis, trackerRefetch]);
  const analysisInFlight = trackerClient !== null && trackerClient.readiness === null && trackerClient.analysisPending !== null;
  const trackerOverviewMetrics = trackerClient
    ? buildOverviewMetricRows({
        stage: {
          detail: trackerTimer
            ? `Day ${trackerTimer.elapsedDays} of ${trackerTimer.targetDays} · ${trackerTimer.remainingDays} days remaining`
            : `Entered ${formatTrackerDate(trackerClient.stageEnteredAt)}`,
          label: "Client stage",
          value: TRACKER_STAGE_LABELS[trackerClient.stage],
        },
        monitoring: {
          detail: "Enrollment monitoring status",
          label: "Monitoring",
          value: trackerClient.monitoring,
        },
        nextRefresh: {
          detail: trackerClient.nextRefreshAt
            ? "Persisted analysis schedule"
            : "No completed analysis schedule",
          label: "Next credit refresh",
          value: trackerClient.nextRefreshAt
            ? formatTrackerDate(trackerClient.nextRefreshAt)
            : "Not scheduled",
        },
        readiness: {
          detail: trackerClient.readiness === null
            ? "No completed funding-readiness analysis"
            : "Persisted funding-readiness score",
          label: "Verified readiness",
          value: trackerClient.readiness === null
            ? "Unavailable"
            : `${trackerClient.readiness} / 100`,
        },
        openActions: {
          detail: trackerClient.openActionCount === null
            ? "Checklist data not available"
            : "Persisted open checklist items",
          label: "Open actions",
          value: trackerClient.openActionCount === null
            ? "Unavailable"
            : String(trackerClient.openActionCount),
        },
        estimatedCompletion: {
          detail: trackerClient.estimatedCompletionAt
            ? "Persisted duration result"
            : "Duration not yet available",
          label: "Estimated completion",
          value: trackerClient.estimatedCompletionAt
            ? formatTrackerDate(trackerClient.estimatedCompletionAt)
            : "TBD",
        },
        fundingApprovedCents: trackerClient.fundingApprovedCents,
      })
    : null;
  const fixtureOverviewMetrics = buildOverviewMetricRows({
    stage: {
      detail: canceled ? "Frozen · closed Jul 21" : analysisActive ? "Day 27 of 60" : "Paused · last verified Jul 14",
      label: "Client stage",
      value: clientStage,
    },
    monitoring: {
      detail: monitoringActive ? "SecureView connected" : "Monitoring consent was revoked",
      label: "Monitoring",
      value: monitoringActive ? "Connected" : "Paused",
    },
    nextRefresh: {
      detail: analysisActive ? "Monthly source update" : "Last verified Jul 14",
      label: "Next credit refresh",
      value: analysisActive ? "Aug 13" : "Not scheduled",
    },
    readiness: {
      detail: "Funding can start when the profile reaches 100",
      label: "Verified readiness",
      value: `${readiness} / 100`,
    },
    openActions: {
      detail: `Personal ${personalOpenCount} · Business ${businessOpenCount}`,
      label: "Open actions",
      value: String(openActionCount),
    },
    estimatedCompletion: {
      detail: readiness >= READY_PROFILE_COMPLETION ? "Verified at 100" : "TBD durations · remaining actions",
      label: "Estimated completion",
      value: readiness >= READY_PROFILE_COMPLETION ? "Reached" : estimatedCompletion,
    },
    fundingApprovedCents: fundedAmount > 0 ? Math.round(fundedAmount * 100) : null,
  });
  // The operator setting governs the goal meter and funded-to-date result on a
  // consumer's Overview. This surface does not have a separate durable goal
  // meter yet, so the persisted "Funding approved" row is the complete
  // funding-progress disclosure available here. The fixture walkthrough always
  // passes true and therefore keeps its existing row unchanged.
  const trackerOverviewBottomMetrics = trackerOverviewMetrics?.bottom.filter(
    (metric) => showFundingProgress || metric.label !== "Funding approved",
  ) ?? null;
  const trackerOverviewMessage = trackerReadOff
    ? TRACKER_STATUS_ABSENT
    : trackerClients.error
    ? "Unable to load funding-readiness status."
    : trackerClients.loading || trackerClients.enabled === null
      ? "Loading funding-readiness status…"
      : trackerClients.empty
        ? "Funding-readiness analysis not available."
        : null;
  // Server-rendered and pre-hydration there is no clock to read, and the
  // fallback was a fixed "Tuesday · Jul 21" — a date that was wrong on every
  // day but one. Nothing until the real date exists. (`ConsumerPageHeader`
  // discards the eyebrow since #207; the literal goes anyway, because a wrong
  // date sitting in a prop is a wrong date waiting to be rendered.)
  const greetingDate = now
    ? new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        month: "short",
        weekday: "long",
      })
        .format(now)
        .replace(",", " ·")
    : undefined;
  const greeting = now
    ? now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 18
        ? "Good afternoon"
        : "Good evening"
    : "Good afternoon";

  // Durable mode replaces the fixture's analysis-state claims in the header
  // tag with what the tracker read actually shows.
  const overviewStatusTag = trackerReadOff
    ? <StatusTag icon={false} tone="neutral">Status unavailable</StatusTag>
    : !fixtureOverview
    ? (
      <StatusTag tone={trackerClient?.analysisAt ? "success" : "neutral"}>
        {trackerClient?.analysisAt ? "Analysis current" : "Analysis pending"}
      </StatusTag>
    )
    : (
      <StatusTag icon={canceled ? false : undefined} tone={analysisActive ? "success" : "neutral"}>
        {canceled ? "Account canceled" : analysisActive ? "Analysis current" : "Analysis paused"}
      </StatusTag>
    );

  return (
    <div>
      <HandoffReveal order={0}>
      <ConsumerPageHeader
        actions={referralsEnabled ? <>{overviewStatusTag}<ReferralShareControl /></> : overviewStatusTag}
        eyebrow={greetingDate}
        title={`${greeting}, ${profileName.split(" ")[0] || profileName}`}
      />
      </HandoffReveal>

      <div className="mb-5">
        {/* With the tracker read active, the fixture hero's claims (a named
            account target, a six-snapshot graph, fixed dates) would sit above
            durable panels that contradict them, so the hero itself goes durable:
            everything below derives from the tracker read, and the plan's own
            top action — which has no consumer read yet — is pointed at rather
            than invented. While loading or empty, the section under this one
            already announces the state; the hero stays out of the way. */}
        {!fixtureOverview ? (
          trackerClient ? (
            handoff.phase === "staged" ? null : (
            <section
              className="relative overflow-hidden rounded-[14px] border border-[var(--consumer-border)] bg-[var(--consumer-hero)] text-[var(--consumer-hero-ink)] shadow-[var(--consumer-surface-shadow)]"
              ref={landingRef}
            >
              <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-card/70" />
              <motion.div
                animate={{ opacity: 1 }}
                className="grid lg:min-h-[24rem] lg:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.92fr)] lg:items-stretch"
                initial={landing && !reduceMotion ? { opacity: 0 } : false}
                transition={{ delay: 0.08, duration: 0.26, ease: HANDOFF_EASE }}
              >
                <div className="flex flex-col justify-between px-5 pb-8 pt-6 sm:px-8 sm:pb-9 sm:pt-8 lg:px-7 lg:pb-7 lg:pt-6">
                  <div>
                    <div className="flex items-start gap-3">
                      <motion.span
                        animate={analysisInFlight && !reduceMotion ? { opacity: [1, 0.45, 1] } : { opacity: 1 }}
                        className={cn("mt-1.5 size-2 rounded-full", trackerClient.readiness === null && !analysisInFlight ? "bg-[var(--consumer-muted)]" : "bg-[var(--consumer-accent-ink)]")}
                        transition={analysisInFlight && !reduceMotion ? { duration: 2.2, ease: "easeInOut", repeat: Infinity } : { duration: 0.2 }}
                      />
                      <div>
                        <p className="text-sm font-semibold text-[var(--consumer-hero-ink)]">{trackerClient.readiness === null ? "Funding-readiness analysis pending" : "Verified funding-readiness status"}</p>
                        <FadeSwap className="mt-1 text-xs text-[var(--consumer-muted)]" id={trackerClient.analysisAt ? "analyzed" : trackerClient.analysisPending ?? "none"}>
                          {trackerClient.analysisAt
                            ? `Analyzed ${formatTrackerDate(trackerClient.analysisAt)}`
                            : trackerClient.analysisPending === "running"
                              ? "Reviewing authorized sources · In progress"
                              : trackerClient.analysisPending === "queued"
                                ? "Analysis queued"
                                : "No completed analysis yet"}
                        </FadeSwap>
                      </div>
                    </div>
                    <h2 className="mt-7 max-w-[18ch] text-[2.25rem] font-semibold leading-[1.04] tracking-[-0.035em] text-[var(--consumer-hero-ink)] sm:text-[2.75rem] lg:mt-5 lg:text-[2.8rem]">
                      <FadeSwap id={trackerClient.openActionCount === null ? (trackerClient.readiness === null ? "awaiting" : "verified") : "actions"}>
                      {trackerClient.openActionCount === null
                        ? trackerClient.readiness === null
                          ? "Awaiting your first completed analysis"
                          : `Readiness verified at ${trackerClient.readiness}`
                        : trackerClient.openActionCount === 0
                          ? "All plan actions are complete"
                          : `${trackerClient.openActionCount} plan action${trackerClient.openActionCount === 1 ? "" : "s"} open`}
                      </FadeSwap>
                    </h2>
                    <p className="mt-5 max-w-[60ch] text-sm leading-6 text-[var(--consumer-muted)] lg:mt-4">
                      {trackerClient.readiness === null
                        ? "Your verified readiness score and plan actions appear here after the first completed analysis."
                        : "Action detail lives in your optimization plan. Readiness updates after each completed source check."}
                    </p>
                  </div>
                  <div className="mt-8 flex flex-col gap-5 border-t border-[var(--consumer-border)] pt-6 sm:flex-row sm:items-end sm:justify-between lg:mt-5 lg:flex-col lg:items-start lg:gap-4 lg:pt-5 xl:flex-row xl:items-end">
                    <Button
                      className="min-h-12 w-full bg-primary px-5 text-primary-foreground shadow-[0_8px_24px_color-mix(in_srgb,var(--consumer-brand-tile),transparent_86%)] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] hover:-translate-y-0.5 hover:bg-primary/85 sm:w-auto"
                      onClick={() => navigate("optimization")}
                    >
                      Review optimization plan <ArrowRight aria-hidden />
                    </Button>
                    <SourceStamp className="max-w-xs text-left text-[var(--consumer-muted)] sm:text-right lg:text-left xl:text-right">
                      {trackerClient.analysisAt
                        ? `Latest funding-readiness analysis · ${formatTrackerDate(trackerClient.analysisAt)}`
                        : "Funding-readiness analysis not available"}
                    </SourceStamp>
                  </div>
                </div>
                <div className="border-t border-[var(--consumer-border)] bg-[var(--consumer-hero-panel)] p-5 sm:p-7 lg:border-l lg:border-t-0 lg:p-6 xl:p-7">
                  <DurableReadinessPanel client={trackerClient} formatDate={formatTrackerDate} />
                </div>
              </motion.div>
            </section>
            )
          ) : null
        ) : (
        handoff.phase === "staged" ? null : (
        <section
          className="relative overflow-hidden rounded-[14px] border border-[var(--consumer-border)] bg-[var(--consumer-hero)] text-[var(--consumer-hero-ink)] shadow-[var(--consumer-surface-shadow)]"
          ref={landingRef}
        >
          <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-card/70" />
          <motion.div
            animate={{ opacity: 1 }}
            className="grid lg:min-h-[28rem] lg:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.92fr)] lg:items-stretch"
            initial={landing && !reduceMotion ? { opacity: 0 } : false}
            transition={{ delay: 0.08, duration: 0.26, ease: HANDOFF_EASE }}
          >
            <div className="flex flex-col justify-between px-5 pb-8 pt-6 sm:px-8 sm:pb-9 sm:pt-8 lg:px-7 lg:pb-7 lg:pt-6">
              <div>
                <div className="flex items-start gap-3">
                  <span className={cn("mt-1.5 size-2 rounded-full", canceled || !analysisActive ? "bg-[var(--consumer-muted)]" : primaryReported ? "bg-[var(--consumer-accent-ink)]" : "bg-[var(--consumer-warning)]")} />
                  <div>
                    <p className="text-sm font-semibold text-[var(--consumer-hero-ink)]">{canceled ? "Last verified target" : primaryReported ? "Payment awaiting verification" : "Highest-impact action"}</p>
                    <p className="mt-1 text-xs text-[var(--consumer-muted)]">{canceled ? "Closed account record" : primaryReported ? (analysisActive ? "Source check scheduled Aug 13" : "Verification is not scheduled") : analysisActive ? "Due Aug 16" : "Reporting remains available; verification is paused"}</p>
                  </div>
                </div>
                <h2 className="mt-7 max-w-[18ch] text-[2.25rem] font-semibold leading-[1.04] tracking-[-0.035em] text-[var(--consumer-hero-ink)] sm:text-[2.75rem] lg:mt-5 lg:text-[2.8rem]">
                  {canceled ? (primaryReported ? "Chase Ink payment record" : "Last verified Chase Ink target") : primaryReported ? "Chase Ink payment reported" : "Bring Chase Ink to $3,480"}
                </h2>
                <p className="mt-5 max-w-[60ch] text-sm leading-6 text-[var(--consumer-muted)] lg:mt-4">
                  {canceled
                    ? primaryReported
                      ? "Reported payment preserved; readiness closed at 62."
                      : "Jul 14 target preserved; reporting and verification are closed."
                    : primaryReported
                    ? analysisActive
                      ? "Payment reported. Readiness remains 62 pending the next Experian source check."
                      : "Payment reported. Readiness remains 62 until analysis resumes."
                    : analysisActive
                      ? <>Pay $4,140 to reach 29% utilization. Readiness updates after the next Experian source check.</>
                      : <>Pay $4,140 to reach 29% utilization. Source checks resume with analysis authorization.</>}
                </p>

              </div>
              <div className="mt-8 flex flex-col gap-5 border-t border-[var(--consumer-border)] pt-6 sm:flex-row sm:items-end sm:justify-between lg:mt-5 lg:flex-col lg:items-start lg:gap-4 lg:pt-5 xl:flex-row xl:items-end">
                <Button
                  className="min-h-12 w-full bg-primary px-5 text-primary-foreground shadow-[0_8px_24px_color-mix(in_srgb,var(--consumer-brand-tile),transparent_86%)] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-smooth-out)] hover:-translate-y-0.5 hover:bg-primary/85 sm:w-auto"
                  onClick={() => navigate("optimization")}
                >
                  {canceled ? "Review plan record" : "Review optimization plan"} <ArrowRight aria-hidden />
                </Button>
                <SourceStamp className="max-w-xs text-left text-[var(--consumer-muted)] sm:text-right lg:text-left xl:text-right">
                  {trackerClients.enabled === false
                    ? "Derived from Experian · Jul 14 · readiness plan v2.4"
                    : trackerClient?.analysisAt
                      ? `Latest funding-readiness analysis · ${formatTrackerDate(trackerClient.analysisAt)}`
                      : "Funding-readiness analysis not available"}
                </SourceStamp>
              </div>
            </div>
            <div className="border-t border-[var(--consumer-border)] bg-[var(--consumer-hero-panel)] p-5 sm:p-7 lg:border-l lg:border-t-0 lg:p-6 xl:p-7">
              <ReadinessTrajectory analysisActive={analysisActive} canceled={canceled} readiness={readiness} />
            </div>
          </motion.div>
        </section>
        )
        )}

        <HandoffReveal order={1}>
        {!fixtureOverview ? (
          trackerOverviewMessage ? (
            <section
              aria-live="polite"
              className="mt-4 rounded-[12px] border border-[var(--consumer-border)] bg-card p-5 text-sm text-muted-foreground shadow-[var(--consumer-surface-shadow)]"
            >
              {trackerOverviewMessage}
            </section>
          ) : trackerOverviewMetrics ? (
            <>
              <section
                aria-label="Account status"
                className="mt-4 grid overflow-hidden rounded-[12px] border border-[var(--consumer-border)] bg-card shadow-[var(--consumer-surface-shadow)] lg:grid-cols-3"
              >
                {trackerOverviewMetrics.top.map((metric, index) => (
                  <OverviewMetricCell
                    count={trackerOverviewMetrics.top.length}
                    index={index}
                    key={metric.label}
                    metric={metric}
                  />
                ))}
              </section>

              <div className="mt-4">
                <MetricRow items={trackerOverviewBottomMetrics ?? []} />
              </div>
            </>
          ) : null
        ) : (
          <>
            <section
              aria-label="Account status"
              className="mt-4 grid overflow-hidden rounded-[12px] border border-[var(--consumer-border)] bg-card shadow-[var(--consumer-surface-shadow)] lg:grid-cols-3"
            >
              {fixtureOverviewMetrics.top.map((metric, index) => (
                <OverviewMetricCell
                  count={fixtureOverviewMetrics.top.length}
                  index={index}
                  key={metric.label}
                  metric={metric}
                />
              ))}
            </section>

            <div className="mt-4">
              <MetricRow
                items={fixtureOverviewMetrics.bottom}
              />
            </div>
          </>
        )}
        </HandoffReveal>
      </div>

      <HandoffReveal order={2}>
      <WorkspaceSection className="mt-5" description="Your populated path from onboarding through recorded funding outcomes." title="Your funding journey">
        {!fixtureOverview ? (
          trackerClient ? (
            <JourneyTimeline
              analysisActive
              canceled={false}
              currentStage={TRACKER_STAGE_LABELS[trackerClient.stage] as FundingStage}
              durable={{ analysisComplete: trackerClient.analysisAt !== null, currentDateLabel: `Entered ${formatTrackerDate(trackerClient.stageEnteredAt)}` }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Funding-journey status is not available.</p>
          )
        ) : (
        <JourneyTimeline analysisActive={analysisActive} canceled={canceled} currentStage={clientStage} />
        )}
      </WorkspaceSection>
      </HandoffReveal>
    </div>
  );
}

/**
 * This account's tracker row, read only when there is an account to read.
 *
 * `DashboardView` has held this read since the hero went durable; Your Funding
 * needed the same row for its open-action sentence, which was counting a module
 * constant. `active: durableWorkspace` keeps the fixture shell from issuing a
 * fetch or opening a realtime channel it has no session for.
 *
 * `settled` distinguishes "read finished and this account has no row" from
 * "still loading or failed", so a caller can refuse rather than print a zero.
 */
function useConsumerTracker(durableWorkspace: boolean): {
  client: TrackerClient | null;
  settled: boolean;
} {
  const tracker = useTrackerClients({ active: durableWorkspace, audience: "consumer" });
  if (!durableWorkspace) return { client: null, settled: false };
  if (tracker.error || tracker.loading || tracker.enabled === null) {
    return { client: null, settled: false };
  }
  return { client: tracker.clients[0] ?? null, settled: true };
}

function OptimizationView({
  analysisActive,
  canceled,
  durableWorkspace,
  navigate,
  reported,
  reportBlock,
  toggleReported,
  northwestPartnerUrl,
}: {
  analysisActive: boolean;
  canceled: boolean;
  durableWorkspace: boolean;
  navigate: (view: ViewId) => void;
  reported: Set<number>;
  reportBlock: ReportBlock;
  toggleReported: (index: number) => void;
  northwestPartnerUrl?: string | null;
}) {
  const [checklistFilter, setChecklistFilter] =
    useState<ChecklistFilter>("open");

  // A signed-in consumer reads their own plan through `GET /api/optimization`;
  // the fixture shell below is the disclosed simulation and never sees a durable
  // account. `optimizationWarnings` is passed down so Alec's three cautions have
  // exactly one home, the one the Drop 7 guard pins.
  return durableWorkspace ? (
    <DurableOptimizationView canceled={canceled} navigate={navigate} northwestPartnerUrl={northwestPartnerUrl} warnings={optimizationWarnings} />
  ) : (
    <div>
      {/* The header used to carry eyebrow="Analysis current through Jul 14" —
          the fixture roster's analysis date, on a prop `ConsumerPageHeader` has
          discarded since #207 froze page headers to title plus actions. There
          is no honest date to put here (the one fact that answers it,
          `analysisAt`, is stated on Overview), and a literal that renders
          nowhere today is a fixture date waiting for the header to be
          unfrozen, so the prop is gone rather than rewritten. */}
      <ConsumerPageHeader
        actions={
          <Button className="min-h-11" onClick={() => navigate("plan")} variant="outline">
            <Flag aria-hidden /> View Your Funding
          </Button>
        }
        title="Optimization"
      />

      {reported.size > 0 ? (
        <div className="mb-5 flex flex-col gap-3 rounded-[10px] border border-[color-mix(in_srgb,var(--consumer-accent-ink),transparent_74%)] bg-[var(--consumer-accent-tint)] px-4 py-3.5 sm:flex-row sm:items-center">
          <StateMarker state={analysisActive ? "reported" : "paused"} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{reported.size} {reported.size === 1 ? "action" : "actions"} reported</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {/* These three sentences used to open on "Your report is saved" and
                  "This report remains in the account record" while `reported` was a
                  component-local Set a reload cleared. The persistence claim was the
                  defect; what each says about verification was true and stays. */}
              {canceled
                ? "Verification ended when the subscription was canceled."
                : analysisActive
                ? "Verified readiness stays at 62 until the Aug 13 source check."
                : "No source check is scheduled while analysis authorization is paused."}
            </p>
          </div>
          <span className="text-[0.68rem] font-medium text-[var(--consumer-accent-ink)]">Verification receipt</span>
        </div>
      ) : null}

      <WorkspaceSection
        className="mb-5"
        description="Educational guidance for the current optimization plan."
        title="Before you complete an action"
      >
        {/* Single column, always. A grid only pays when every item fits one
            line so the column bottoms land level; these cautions run 33 to 100
            characters, so two columns leave a hole and three would stagger
            worse. The 72ch cap sits on this list rather than the page, because
            this is the one prose block in a view whose metric rows and
            checklists legitimately want the full 86rem. Dividers earn their
            place: with only a gap between them, the second line of the wrapped
            caution reads as a fourth item. */}
        <ul className="max-w-[72ch] divide-y divide-[var(--consumer-border)] text-sm leading-6">
          {optimizationWarnings.map((guidance) => (
            <li className="flex gap-3 py-3 first:pt-0 last:pb-0" key={guidance}>
              <AlertTriangle aria-hidden className="mt-1 size-4 shrink-0 text-[var(--consumer-warning-ink)]" />
              <span className="min-w-0">{guidance}</span>
            </li>
          ))}
        </ul>
      </WorkspaceSection>

      <WorkspaceSection
        description="Funding can start when both checklists are complete and verified at 100."
        title="Cinderella profile"
        trailing={(
          <div aria-label="Checklist status filter" className="flex gap-1">
            <Button
              aria-pressed={checklistFilter === "open"}
              onClick={() => setChecklistFilter("open")}
              size="sm"
              variant={checklistFilter === "open" ? "secondary" : "ghost"}
            >
              Open
            </Button>
            <Button
              aria-pressed={checklistFilter === "done"}
              onClick={() => setChecklistFilter("done")}
              size="sm"
              variant={checklistFilter === "done" ? "secondary" : "ghost"}
            >
              Completed
            </Button>
          </div>
        )}
      >
        {checklistFilter === "done" ? (
          <p className="mb-5 rounded-[8px] bg-[var(--consumer-canvas)] px-3 py-2 text-xs leading-5 text-muted-foreground">
            Already done: the complete known checklist is shown alongside anything that still needs verification.
          </p>
        ) : null}
        {/* No vertical rule between the tracks. Grid items stretch to the tallest
            row, so `lg:divide-x` drew a full-height border down the side of the
            8-factor Personal column and framed the empty ~60% of the 2-factor
            Business column. Each track already declares itself with a heading,
            a completion caption, a progress bar and its own top rule, so the
            separation is column space alone: it reads the same when the tracks
            are balanced, when one is empty (nothing bounds the void), and on
            the mobile single-column stack where a rule would not apply. */}
        {/* The ten checklist factors and their four subtasks are one fixture
            person's plan — "Bring Chase Ink to $3,480 or less", "Pay Capital One
            Spark below $2,610" — and they rendered to every signed-in consumer,
            complete with per-factor Verified tags and a completion percentage.
            `public.checklist_item_state` has no consumer-side route, so there is
            nothing to swap in and inventing tradelines for somebody's own credit
            plan is the worst version of the defect. The section says what it
            cannot show. */}
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-x-10">
          <CinderellaChecklist filter={checklistFilter} reportBlock={reportBlock} reported={reported} toggleReported={toggleReported} track="personal" />
          <CinderellaChecklist filter={checklistFilter} reportBlock={reportBlock} reported={reported} toggleReported={toggleReported} track="business" />
        </div>
        <SourceStamp className="mt-5 border-t border-[var(--consumer-border)] pt-4">
          Based on your credit report, your docs, and what you report to us.
        </SourceStamp>
        {northwestPartnerUrl ? <a className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-[var(--consumer-accent-ink)] underline" href={northwestPartnerUrl} rel="noreferrer" target="_blank">Open Northwest partner resource <ArrowRight aria-hidden className="ml-2 size-4" /></a> : null}
      </WorkspaceSection>

      <WorkspaceSection
        className="mt-5"
        description="Balances and limits are display values from the last authorized analysis."
        title="Revolving utilization"
      >
        {/* Four named tradelines with balances, limits and targets — Chase Ink,
            Capital One Spark, Amex Blue, US Bank — belonging to the fixture
            persona. The analysis pipeline persists only derived outputs and
            never sends account rows to the consumer surface, so there is no
            durable list to print here. */}
        <>
        <div className="hidden overflow-x-auto md:block" tabIndex={0}>
          <table className="w-full min-w-[42rem] text-sm">
            <thead className="border-b border-[var(--consumer-border)] text-left text-[0.68rem] text-muted-foreground">
              <tr>
                <th className="pb-3 font-medium">Account</th>
                <th className="pb-3 text-right font-medium">Balance</th>
                <th className="pb-3 text-right font-medium">Limit</th>
                <th className="pb-3 text-right font-medium">Utilization</th>
                <th className="pb-3 text-right font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr className="border-b border-[var(--consumer-border)] last:border-0" key={account.account}>
                  <td className="py-4 font-medium">{account.account}</td>
                  <td className="py-4 text-right tabular-nums">{account.balance}</td>
                  <td className="py-4 text-right text-muted-foreground tabular-nums">{account.limit}</td>
                  <td className="py-4 text-right font-semibold tabular-nums">{account.utilization}</td>
                  <td className="py-4 text-right"><StatusTag tone={account.tone}>{account.target}</StatusTag></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-[var(--consumer-border)] md:hidden">
          {accounts.map((account) => (
            <dl className="py-4 first:pt-0 last:pb-0" key={account.account}>
              <div className="mb-3 flex items-start justify-between gap-3">
                <dt className="text-sm font-semibold">{account.account}</dt>
                <span className="flex flex-col items-end gap-1">
                  <span className="text-[0.65rem] text-muted-foreground">Target</span>
                  <StatusTag tone={account.tone}>{account.target}</StatusTag>
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div><dt className="text-muted-foreground">Balance</dt><dd className="mt-1 font-medium tabular-nums">{account.balance}</dd></div>
                <div><dt className="text-muted-foreground">Limit</dt><dd className="mt-1 font-medium tabular-nums">{account.limit}</dd></div>
                <div><dt className="text-muted-foreground">Utilization</dt><dd className="mt-1 font-semibold tabular-nums">{account.utilization}</dd></div>
              </div>
            </dl>
          ))}
        </div>
        </>
      </WorkspaceSection>

      <SourceStamp className="mt-4">
        Educational planning only. MostFundable is not a lender and does not guarantee funding.
      </SourceStamp>
    </div>
  );
}

// `analysisActive` left with the fixture eyebrow: it was this view's only
// reader of it.
function FundingPlanView({
  canceled,
  clientId,
  consumerApplications,
  durableWorkspace,
  navigate,
  operatorUnlocked,
  readiness,
}: {
  canceled: boolean;
  clientId: string;
  consumerApplications: ConsumerApplicationsSurfaceState;
  durableWorkspace: boolean;
  navigate: (view: ViewId) => void;
  operatorUnlocked: boolean;
  readiness: number;
}) {
  const { getApplicationsForClient, getClientFundedAmount } = useFeedbackSession();
  const applications = getApplicationsForClient(clientId);
  const fundedAmount = getClientFundedAmount(clientId);
  const profileComplete = readiness >= READY_PROFILE_COMPLETION;
  const unlockedEarly = !canceled && !profileComplete && operatorUnlocked;
  const isReady = !canceled && (profileComplete || operatorUnlocked);
  const availableOptions = isReady ? applications.length : 0;
  const pendingApplications = applications.filter(
    (application) => application.outcome === "pending",
  ).length;
  const durableApplications = consumerApplications.status === "ready"
    ? consumerApplications.applications
    : null;
  const durableFunding = deriveConsumerApprovedFunding(durableApplications);
  const durablePending = durableApplications?.filter(
    (application) => application.outcome === null && application.consumerStatus === "pending",
  ).length ?? null;

  return (
    <div>
      {/* Same discarded fixture eyebrow the Optimization header carried. */}
      <ConsumerPageHeader
        title="Your Funding"
      />

      <dl className="grid overflow-hidden rounded-[10px] border border-[var(--consumer-surface-border)] bg-card shadow-[var(--consumer-surface-shadow)] sm:grid-cols-3">
        {[
          // All three read the route-local feedback provider, which is keyed on the
          // demo roster's client ids. A durable workspace carries a uuid, so every
          // figure here is a zero that came from never reading rather than from a
          // record with nothing in it — the same class the documents and
          // notifications readers were fixed for. Naming the source under a
          // confident "$0" was not enough: the figure is the first thing read and
          // it asserted a total nobody computed, so the durable arm prints an em
          // dash and the caption carries the reason.
          { label: "Total funding approved", value: durableWorkspace ? durableFunding.status === "ready" ? (durableFunding.amountCents / 100).toLocaleString("en-US", { currency: "USD", maximumFractionDigits: 0, style: "currency" }) : "—" : fundedAmount.toLocaleString("en-US", { currency: "USD", maximumFractionDigits: 0, style: "currency" }), detail: durableWorkspace ? durableFunding.status === "unavailable" ? "Application records could not be loaded" : durableFunding.status === "private" ? "One or more approved amounts are private" : "Counted approved outcomes" : "Recorded approved outcomes" },
          { label: "Available lending options", value: durableWorkspace ? durableApplications === null ? "—" : isReady ? durableApplications.length : 0 : availableOptions, detail: durableWorkspace ? durableApplications === null ? "Application records could not be loaded" : isReady ? `${durableApplications.length} in the shared sequence` : "Unlocks when funding can start" : isReady ? `${applications.length} in the shared sequence` : "Unlocks when funding can start" },
          { label: "Pending applications", value: durableWorkspace ? durablePending ?? "—" : pendingApplications, detail: durableWorkspace ? durablePending === null ? "Application records could not be loaded" : durablePending ? "Awaiting recorded outcomes" : "No pending outcomes" : pendingApplications ? "Awaiting recorded outcomes" : "No pending outcomes" },
        ].map((item, index) => (
          <div className={cn("min-h-24 px-4 py-4 sm:px-5", index > 0 && "border-t border-[var(--consumer-border)] sm:border-l sm:border-t-0")} key={item.label}>
            <dt className="text-[0.67rem] font-medium text-muted-foreground">{item.label}</dt>
            <dd className="mt-1.5 text-xl font-semibold tracking-[-0.025em] tabular-nums">{item.value}</dd>
            <dd className="mt-1 text-[0.68rem] text-muted-foreground">{item.detail}</dd>
          </div>
        ))}
      </dl>

      <WorkspaceSection
        className="mt-5"
        description={isReady ? "The application sequence is unlocked and shared with your funding team." : "Application controls unlock when the Cinderella profile is complete and verified at 100."}
        title="Lender matches"
        trailing={
          <StatusTag icon={isReady ? undefined : false} tone={isReady ? "success" : "neutral"}>
            {canceled ? "Closed" : profileComplete ? "Ready · 100" : unlockedEarly ? "Unlocked by your team" : "Locked until Ready"}
          </StatusTag>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[var(--consumer-canvas)] text-muted-foreground">
            {isReady ? <Landmark aria-hidden className="size-4" /> : <LockKeyhole aria-hidden className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {canceled ? "Matches closed with the account" : isReady ? "Application sequence available" : "Complete the Cinderella profile first"}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {canceled
                ? `The last verified readiness was ${readiness} on Jul 14.`
                : unlockedEarly
                  ? `Your funding team unlocked matches early at ${readiness} / 100. Optimization actions still apply.`
                  : isReady
                    ? "Work through the confirmed order and log each outcome with your funding team."
                    : `Verified readiness is ${readiness} / 100. Matches stay private until the profile is complete and verified at 100.`}
            </p>
          </div>
          <Button
            className="min-h-11"
            disabled={canceled}
            onClick={() => navigate(isReady ? "matches" : "optimization")}
            variant={isReady ? "default" : "outline"}
          >
            {isReady ? "Open applications" : "Open Optimization"} <ArrowRight aria-hidden />
          </Button>
        </div>
      </WorkspaceSection>

      <SourceStamp className="mt-4">
        Educational planning only. MostFundable is not a lender and does not guarantee funding.
      </SourceStamp>
    </div>
  );
}

function JourneyTimeline({ analysisActive, canceled, currentStage, durable }: { analysisActive: boolean; canceled: boolean; currentStage: FundingStage; durable?: { analysisComplete: boolean; currentDateLabel: string } }) {
  const currentStageIndex = FUNDING_STAGES.indexOf(currentStage);
  // A stage change while the page is open is the one moment this list has to show rather than
  // merely reflect. The row that just became current settles its border (the repo's own cue for
  // "the row that moved") and carries a dated line of record; the node that just completed plays
  // its finished motion once through JourneyStepIcon, and the rule between them starts flowing.
  const [seenStageIndex, setSeenStageIndex] = useState(currentStageIndex);
  const [advancedTo, setAdvancedTo] = useState<number | null>(null);
  if (seenStageIndex !== currentStageIndex) {
    setSeenStageIndex(currentStageIndex);
    if (currentStageIndex > seenStageIndex) setAdvancedTo(currentStageIndex);
  }
  useEffect(() => {
    if (advancedTo === null) return;
    const timer = window.setTimeout(() => setAdvancedTo(null), 6000);
    return () => window.clearTimeout(timer);
  }, [advancedTo]);
  // The Onboarding line asserted a completed analysis unconditionally, so on a durable workspace
  // with no analysis yet it sat two panels below a hero reading "Awaiting your first completed
  // analysis" and directly contradicted it. Both now read the same fact — `trackerClient.analysisAt`
  // — so they cannot disagree. The fixture shell has no such read and keeps the original sentence,
  // which is true of its persona.
  const stageDetails: Record<FundingStage, string> = {
    Onboarding: durable && !durable.analysisComplete
      ? "Identity and agreement recorded. The first authorized analysis has not completed yet."
      : "Identity, agreement, and first authorized analysis completed.",
    Optimization: "Clear the verified readiness actions before moving to the application sequence.",
    Ready: "The application sequence is unlocked and shared with your funding team.",
    Applying: "Follow the checked application order and log each outcome.",
    Funded: "The funding event and terms are part of the shared record.",
    Graduate: "Monitoring continues only while its permission remains active.",
  };
  const lockedDates: Record<FundingStage, string> = {
    Onboarding: "Jun 24",
    Optimization: "After onboarding",
    Ready: "At 100",
    Applying: "After Ready",
    Funded: "After approval",
    Graduate: "Ongoing",
  };
  const currentDates: Record<FundingStage, string> = {
    Onboarding: "Current stage",
    Optimization: "Day 27 of 60",
    Ready: "Current stage",
    Applying: "In progress",
    Funded: "Outcome recorded",
    Graduate: "Ongoing",
  };
  const stages = FUNDING_STAGES.map((name, index) => {
    const current = index === currentStageIndex;
    const status = index < currentStageIndex
      ? "Complete"
      : current
        ? canceled
          ? "Frozen"
          : !analysisActive && name === "Optimization"
            ? "Paused"
            : "Active"
        : "Locked";
    return {
      name,
      status,
      date: index < currentStageIndex
        ? durable || name !== "Onboarding" ? "Complete" : "Jun 24"
        : current
          ? durable ? durable.currentDateLabel : canceled ? "Closed Jul 21" : currentDates[name]
          : lockedDates[name],
      detail: current && canceled
        ? "The last verified stage is preserved as a closed account record; no future update is scheduled."
        : current && status === "Paused"
          ? "The last verified stage is preserved, but updates are paused until analysis authorization resumes."
          : stageDetails[name],
    };
  });
  return (
    <ol>
          {stages.map((stage, index) => {
            const complete = stage.status === "Complete";
            const active = stage.status === "Active" || stage.status === "Paused";
            // Paused and Frozen are the current stage with its motion stopped: the node keeps the
            // active treatment so the reader still sees where they are, but nothing loops.
            const iconStatus = complete ? "complete" : stage.status === "Locked" ? "locked" : "active";
            const stillCurrent = stage.status === "Paused" || stage.status === "Frozen";
            return (
              <li className="grid grid-cols-[36px_minmax(0,1fr)] gap-4" key={stage.name}>
                <div className="flex flex-col items-center">
                  <JourneyStepIcon reducedMotion={stillCurrent} stage={stage.name.toLowerCase() as JourneyStage} status={iconStatus} />
                  {index < stages.length - 1 ? <JourneyConnector flowing={complete} stage={stage.name.toLowerCase() as JourneyStage} /> : null}
                </div>
                <div className="border-b border-[var(--consumer-border)] pb-6 last:border-0 last:pb-0" data-timeline-settle={advancedTo === index ? "" : undefined}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">{stage.name}</h2>
                    <StatusTag icon={stage.status === "Active" ? <JourneyActiveDot /> : complete || stillCurrent ? undefined : false} tone={complete ? "success" : stage.status === "Active" ? "info" : "neutral"}>{stage.status}</StatusTag>
                    <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground">{stage.date}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground [text-wrap:pretty]">{stage.detail}</p>
                  {advancedTo === index ? (
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--consumer-positive)]" data-motion-state>
                      <Check aria-hidden className="size-3.5 stroke-[2.6]" />
                      Moved to {stage.name} · {stage.date}
                    </p>
                  ) : null}
                  {active && stage.name === "Optimization" && !durable ? (
                    <div className="mt-4 grid gap-2 rounded-[8px] bg-[var(--consumer-canvas)] p-3 text-xs sm:grid-cols-3">
                      <span className="flex items-center gap-2"><StateMarker size="sm" state="todo" /> Utilization: open</span>
                      <span className="flex items-center gap-2"><StateMarker size="sm" state="active" /> Tradeline: pending</span>
                      <span className="flex items-center gap-2"><StateMarker size="sm" state="verified" /> Inquiries: verified</span>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
    </ol>
  );
}

function DurableMatchesView({
  applicationsState,
  navigate,
  notify,
  onReload,
  readiness,
  shownStage,
}: {
  applicationsState: ConsumerApplicationsSurfaceState;
  navigate: (view: ViewId) => void;
  notify: (message: string) => void;
  onReload: () => void;
  readiness: number;
  shownStage: string;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [outcomeDrafts, setOutcomeDrafts] = useState<Record<string, ConsumerApplicationOutcomeDraft>>({});
  const [pendingByApplication, setPendingByApplication] = useState<Record<string, "note" | "outcome" | undefined>>({});
  const applications = applicationsState.status === "ready" ? applicationsState.applications : [];
  const selected = applications.find((application) => application.id === selectedId) ?? applications[0] ?? null;
  const selectedNoteDraft = selected ? noteDrafts[selected.id] ?? "" : "";
  const selectedOutcomeDraft = selected
    ? outcomeDrafts[selected.id] ?? { approvedAmount: "", kind: "approved" }
    : { approvedAmount: "", kind: "approved" };
  const selectedPending = selected ? pendingByApplication[selected.id] : undefined;

  async function saveOutcome() {
    if (!selected || selected.outcome !== null || pendingByApplication[selected.id] !== undefined) return;
    const applicationId = selected.id;
    const submittedDraft = outcomeDrafts[applicationId] ?? { approvedAmount: "", kind: "approved" };
    let amountCents: number | null = null;
    if (submittedDraft.kind === "approved") {
      const value = submittedDraft.approvedAmount.trim();
      if (!/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) <= 0) {
        notify("Enter an approved amount greater than zero with no more than two decimal places.");
        return;
      }
      amountCents = Math.round(Number(value) * 100);
      if (!Number.isSafeInteger(amountCents)) {
        notify("The approved amount is too large to record.");
        return;
      }
    }
    setPendingByApplication((current) => ({ ...current, [applicationId]: "outcome" }));
    const saved = await recordConsumerApplicationOutcome(applicationId, { amountCents, kind: submittedDraft.kind });
    setPendingByApplication((current) => {
      if (current[applicationId] !== "outcome") return current;
      const next = { ...current };
      delete next[applicationId];
      return next;
    });
    if (!saved) {
      notify("The application result could not be saved. Reload to see whether another result already landed.");
      onReload();
      return;
    }
    setOutcomeDrafts((current) => clearSubmittedConsumerOutcomeDraft(current, applicationId, submittedDraft));
    notify("Application result recorded for funding-team review.");
    onReload();
  }

  async function shareNote(event: FormEvent) {
    event.preventDefault();
    if (!selected || pendingByApplication[selected.id] !== undefined) return;
    const applicationId = selected.id;
    const submittedDraft = noteDrafts[applicationId] ?? "";
    const body = submittedDraft.trim();
    if (!body) return;
    setPendingByApplication((current) => ({ ...current, [applicationId]: "note" }));
    const saved = await addConsumerApplicationNote(applicationId, body);
    setPendingByApplication((current) => {
      if (current[applicationId] !== "note") return current;
      const next = { ...current };
      delete next[applicationId];
      return next;
    });
    if (!saved) {
      notify("The note could not be shared. Reload before trying again.");
      onReload();
      return;
    }
    setNoteDrafts((current) => clearSubmittedConsumerNoteDraft(current, applicationId, submittedDraft));
    notify("Note shared with your funding team.");
    onReload();
  }

  return (
    <div>
      <ConsumerPageHeader
        actions={<><Button className="min-h-11" onClick={() => navigate("plan")} variant="outline">Back to Your Funding</Button><StatusTag tone="success">{shownStage} · {readiness}</StatusTag></>}
        description="Work through the durable sequence your funding team recorded and keep each result current."
        eyebrow="Shared application tracker"
        title="Applications"
      />
      <WorkspaceSection description="Lender details are included only where your workspace and this application allow them." title="Application sequence">
        {applicationsState.status === "loading" ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading your application sequence…</p>
        ) : applicationsState.status === "unavailable" ? (
          <div className="py-8 text-center"><p className="text-sm text-muted-foreground">Your application sequence could not be loaded.</p><Button className="mt-4 min-h-11" onClick={onReload} variant="outline">Try again</Button></div>
        ) : applications.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Your funding team has not recorded a lender application yet.</p>
        ) : (
          <>
            <div aria-label="Applications" className="flex gap-2 overflow-x-auto border-b border-[var(--consumer-border)] pb-3" role="tablist">
              {applications.map((application) => (
                <button
                  aria-selected={application.id === selected?.id}
                  className={cn("min-h-11 shrink-0 rounded-[8px] border px-3 text-left text-xs", application.id === selected?.id ? "border-[var(--consumer-accent-ink)] bg-[var(--consumer-accent-tint)] text-[var(--consumer-accent-ink)]" : "border-[var(--consumer-border)] bg-card text-muted-foreground")}
                  key={application.id}
                  onClick={() => setSelectedId(application.id)}
                  role="tab"
                  type="button"
                >
                  <span className="block font-semibold">Application {application.sequence}</span>
                  {application.lender ? <span className="mt-0.5 block">{application.lender.name}</span> : null}
                </button>
              ))}
            </div>
            {selected ? (
              <div className="pt-5" role="tabpanel">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div><p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Application {selected.sequence}</p><h2 className="mt-1 text-lg font-semibold">{selected.lender?.name ?? "Application status"}</h2>{selected.lender?.products[0] ? <p className="mt-1 text-sm text-muted-foreground">{selected.lender.products[0]}</p> : null}</div>
                  <StatusTag icon={false} tone={selected.operatorStatus === "todo" ? "info" : "neutral"}>Team: {selected.operatorStatus === "todo" ? "TO DO" : "WAIT"}</StatusTag>
                </div>
                {selected.presentation === "details" ? (
                  selected.lender ? (
                    <div className="mt-5 rounded-[8px] bg-[var(--consumer-canvas)] p-4"><p className="text-xs text-muted-foreground">Current lender context</p><p className="mt-1 text-sm font-semibold">{selected.lender.qualificationSummary ?? "No qualification summary is recorded."}</p>{selected.lender.sourceUpdatedAt ? <SourceStamp className="mt-3">Updated {formatDate(selected.lender.sourceUpdatedAt.slice(0, 10))}</SourceStamp> : null}</div>
                  ) : <p className="mt-5 rounded-[8px] bg-[var(--consumer-canvas)] p-4 text-sm text-muted-foreground">Lender details are temporarily unavailable; the application status remains current.</p>
                ) : <p className="mt-5 rounded-[8px] bg-[var(--consumer-canvas)] p-4 text-sm text-muted-foreground">Your funding team is sharing status and notes for this application, while lender details remain private.</p>}

                <div className="mt-6 border-t border-[var(--consumer-border)] pt-5">
                  <h3 className="text-sm font-semibold">Result</h3>
                  {selected.outcome ? (
                    <div className="mt-3 rounded-[8px] bg-[var(--consumer-canvas)] p-4" data-motion-state key={selected.id}><p className="flex items-center gap-2 text-sm font-semibold capitalize">{selected.outcome.kind === "approved" ? <span className="contents" data-mark-pop><StateMarker size="sm" state="verified" /></span> : null}{selected.outcome.kind}</p><p className="mt-1 text-xs text-muted-foreground">Recorded {formatDate(selected.outcome.decidedOn)} by {selected.outcome.recordedByKind === "consumer" ? "you" : "your funding team"}{selected.outcome.amountCents ? ` · ${(selected.outcome.amountCents / 100).toLocaleString("en-US", { currency: "USD", style: "currency" })}` : ""}</p></div>
                  ) : (
                    <div className="mt-3"><p className="text-xs text-muted-foreground">Current status: <span className="font-semibold uppercase text-foreground">{selected.consumerStatus}</span>. Record a final lender response when it arrives.</p><div className="mt-3 flex flex-wrap gap-2">{(["approved", "denied", "withdrawn"] as const).map((kind) => <Button aria-pressed={selectedOutcomeDraft.kind === kind} className="min-h-11" key={kind} onClick={() => setOutcomeDrafts((current) => ({ ...current, [selected.id]: { approvedAmount: current[selected.id]?.approvedAmount ?? "", kind } }))} size="sm" variant={selectedOutcomeDraft.kind === kind ? "default" : "outline"}>{kind.toUpperCase()}</Button>)}</div>{selectedOutcomeDraft.kind === "approved" ? <label className="mt-4 block max-w-xs text-xs font-medium">Approved amount<Input className="mt-2 min-h-11" inputMode="decimal" onChange={(event) => setOutcomeDrafts((current) => ({ ...current, [selected.id]: { approvedAmount: event.target.value, kind: current[selected.id]?.kind ?? "approved" } }))} placeholder="0.00" value={selectedOutcomeDraft.approvedAmount} /></label> : null}<Button className="mt-4 min-h-11" disabled={selectedPending !== undefined} onClick={() => void saveOutcome()}>{selectedPending === "outcome" ? "Saving result" : "Save result"}</Button></div>
                  )}
                </div>

                <div className="mt-6 border-t border-[var(--consumer-border)] pt-5">
                  <h3 className="text-sm font-semibold">Shared notes</h3>
                  <div className="mt-3 divide-y divide-[var(--consumer-border)] border-y border-[var(--consumer-border)]">{selected.notes.length ? selected.notes.map((note) => <article className="py-3" key={note.id}><div className="flex items-center gap-2"><p className="text-xs font-semibold">{note.authorKind === "consumer" ? "You" : "Funding team"}</p><span className="text-[0.68rem] text-muted-foreground">{formatDate(note.createdAt.slice(0, 10))}</span></div><p className="mt-2 text-sm leading-6">{note.body}</p></article>) : <p className="py-4 text-sm text-muted-foreground">No shared notes yet.</p>}</div>
                  <form className="mt-4" onSubmit={shareNote}><label className="text-xs font-medium" htmlFor={`durable-application-note-${selected.id}`}>Add a note</label><Textarea className="mt-2 min-h-24" id={`durable-application-note-${selected.id}`} maxLength={4000} onChange={(event) => setNoteDrafts((current) => ({ ...current, [selected.id]: event.target.value }))} placeholder="Share an update with your funding team" value={selectedNoteDraft} /><Button className="mt-3 min-h-11" disabled={selectedPending !== undefined || !selectedNoteDraft.trim()} type="submit">{selectedPending === "note" ? "Sharing note" : "Share note"}</Button></form>
                </div>
              </div>
            ) : null}
          </>
        )}
      </WorkspaceSection>
      <SourceStamp className="mt-4">Recorded results go to your funding team for review. MostFundable is not a lender and does not guarantee funding.</SourceStamp>
    </div>
  );
}

function MatchesView({
  applicationVisibility,
  consumerApplications,
  canceled,
  clientId,
  clientStage,
  durableWorkspace,
  navigate,
  notify,
  onReloadConsumerApplications,
  portalPreferencesState,
  profileName,
  readiness,
}: {
  applicationVisibility: PortalApplicationVisibility | null;
  consumerApplications: ConsumerApplicationsSurfaceState;
  canceled: boolean;
  clientId: string;
  clientStage: FundingStage;
  durableWorkspace: boolean;
  navigate: (view: ViewId) => void;
  notify: (message: string) => void;
  onReloadConsumerApplications: () => void;
  portalPreferencesState: PortalPreferencesReadState;
  profileName: string;
  readiness: number;
}) {
  const {
    addApplicationNote,
    getApplicationsForClient,
    matchesUnlocked,
    recordApplicationOutcome,
    resolveApplicationPresentation,
  } = useFeedbackSession();
  const applications = getApplicationsForClient(clientId);
  // The feedback provider is the fixture shell's simulated workspace default.
  // A signed-in consumer instead reads the operator's persisted default. Until
  // that read succeeds, status-only is the least-disclosing render and the copy
  // below explains why details are withheld.
  const presentation = durableWorkspace
    ? applicationVisibility ?? "status-only"
    : resolveApplicationPresentation(clientId);
  const applicationVisibilityNotice = durableWorkspace && applicationVisibility === null
    ? portalPreferencesState === "loading"
      ? "Workspace application visibility is loading, so bank and product details stay hidden."
      : "Workspace application visibility could not be loaded, so bank and product details stay hidden."
    : null;
  const [selectedApplicationId, setSelectedApplicationId] = useState("");
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [outcomeDrafts, setOutcomeDrafts] = useState<
    Record<string, "approved" | "pending" | "denied">
  >({});
  /**
   * The stage tag beside the readiness score.
   *
   * `clientStage` is resolved in `ConsumerApp` by looking the context's client
   * id up in `DEMO_CLIENTS`, which a durable uuid never matches, so the `??
   * "Optimization"` fallback printed a literal stage to every signed-in
   * consumer — including one sitting in Applying or Funded. The tracker row
   * carries the stage the whole platform agrees on, through the same
   * `TRACKER_STAGE_LABELS` map the Overview metrics read.
   */
  const { client: trackerClient, settled: trackerSettled } = useConsumerTracker(durableWorkspace);
  const shownStage = durableWorkspace
    ? trackerClient
      ? TRACKER_STAGE_LABELS[trackerClient.stage]
      : trackerSettled
        ? "Stage not recorded"
        : "Stage unavailable"
    : clientStage;
  const profileComplete = readiness >= READY_PROFILE_COMPLETION;
  const operatorUnlocked = matchesUnlocked[clientId] ?? false;
  const unlockedEarly = !canceled && !profileComplete && operatorUnlocked;
  const isReady = !canceled && (profileComplete || operatorUnlocked);

  if (!isReady) {
    return (
      <div>
        <ConsumerPageHeader
          actions={
            <StatusTag icon={false} tone="neutral">
              {canceled ? "Account canceled" : "Locked until Ready"}
            </StatusTag>
          }
          eyebrow="Available when the Cinderella profile is complete"
          title="Matches"
        />
        <WorkspaceSection>
          <div className="mx-auto flex max-w-lg flex-col items-center py-10 text-center sm:py-14">
            <span className="grid size-12 place-items-center rounded-full bg-[var(--consumer-canvas)] text-muted-foreground">
              <LockKeyhole aria-hidden className="size-5" />
            </span>
            <h2 className="mt-5 text-base font-semibold">
              {canceled
                ? "Matches closed with the account"
                : "Complete the Cinderella profile first"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {canceled
                ? `The last verified readiness was ${readiness} on Jul 14. No lender or application details are available in the closed account.`
                : `Verified readiness is ${readiness} / 100. This page stays private until the profile is complete and verified at 100.`}
            </p>
            <div className="mt-6">
              <Button
                className="min-h-11"
                onClick={() => navigate(canceled ? "plan" : "optimization")}
                variant="outline"
              >
                {canceled ? "Review plan record" : "Open Optimization"}{" "}
                <ArrowRight aria-hidden />
              </Button>
            </div>
          </div>
        </WorkspaceSection>
      </div>
    );
  }

  if (durableWorkspace) {
    return <DurableMatchesView applicationsState={consumerApplications} navigate={navigate} notify={notify} onReload={onReloadConsumerApplications} readiness={readiness} shownStage={shownStage} />;
  }

  const selectedApplication =
    applications.find(
      (application) => application.id === selectedApplicationId,
    ) ?? applications[0];

  function saveOutcome() {
    if (!selectedApplication) return;
    // The toast already refused on a durable workspace, but the write ran
    // anyway: `recordApplicationOutcome` stamps the row `outcomeRecordedAt:
    // DEMO_TODAY` in the in-memory provider, so a signed-in consumer whose
    // screen said the sequence was unavailable still moved a funding outcome
    // and dated it. Refuse before the write, not after it.
    if (durableWorkspace) {
      notify(APPLICATIONS_UNAVAILABLE);
      return;
    }
    const outcome =
      outcomeDrafts[selectedApplication.id] ?? selectedApplication.outcome;
    if (!outcome) {
      notify("Choose APPROVED, PENDING, or DENIED before saving.");
      return;
    }

    let approvedAmount: number | null = null;
    if (outcome === "approved") {
      const rawAmount =
        amountDrafts[selectedApplication.id] ??
        (selectedApplication.approvedAmount === null
          ? ""
          : selectedApplication.approvedAmount.toFixed(2));
      if (!/^\d+(\.\d{1,2})?$/.test(rawAmount)) {
        notify("Enter an approved amount with no more than two decimal places.");
        return;
      }
      approvedAmount = Number(rawAmount);
      if (approvedAmount <= 0) {
        notify("Enter the approved amount before saving.");
        return;
      }
    }

    recordApplicationOutcome({
      actor: "consumer",
      amount: approvedAmount,
      applicationId: selectedApplication.id,
      outcome,
    });
    // `recordApplicationOutcome` writes the route-local feedback provider, not
    // `POST /api/applications/[id]/outcomes`. On the fixture shell that is the
    // disclosed simulation and the wording holds; a durable workspace has no
    // application row to reach this at all today, and if one ever arrives it
    // must not inherit a toast that calls somebody's account a demo.
    notify(
      durableWorkspace
        ? APPLICATIONS_UNAVAILABLE
        : `${selectedApplication.bankName} outcome saved. Your funding team will review it.`,
    );
  }

  function addNote(event: FormEvent) {
    event.preventDefault();
    if (!selectedApplication) return;
    const body = noteDrafts[selectedApplication.id] ?? "";
    if (!body.trim()) return;
    addApplicationNote({
      applicationId: selectedApplication.id,
      authorName: profileName,
      authorRole: "consumer",
      body,
    });
    setNoteDrafts((current) => ({
      ...current,
      [selectedApplication.id]: "",
    }));
    notify("Note shared with your funding team.");
  }

  return (
    <div>
      <ConsumerPageHeader
        actions={
          <>
            <Button className="min-h-11" onClick={() => navigate("plan")} variant="outline">
              Back to Your Funding
            </Button>
            <StatusTag tone="success">
              {profileComplete
                ? `${shownStage} · ${readiness}`
                : `${shownStage} · unlocked by your team`}
            </StatusTag>
          </>
        }
        description={
          unlockedEarly
            ? `Your funding team unlocked applications early at ${readiness} / 100. Keep working the Optimization actions alongside this sequence.`
            : "Work through the sequence in order and keep each result current for your funding team."
        }
        eyebrow="Shared application tracker"
        title="Applications"
      />

      <WorkspaceSection
        description={
          applicationVisibilityNotice ?? (presentation === "details"
            ? "Your funding team is sharing application details."
            : "Your funding team is sharing statuses and notes only.")
        }
        title="Application sequence"
        trailing={
          <StatusTag icon={false} tone="neutral">
            {applicationVisibilityNotice
              ? portalPreferencesState === "loading" ? "Visibility loading" : "Visibility unavailable"
              : presentation === "details" ? "Details shared" : "Status only"}
          </StatusTag>
        }
      >
        {applications.length ? (
          <>
            <div
              aria-label="Applications"
              className="flex gap-2 overflow-x-auto border-b border-[var(--consumer-border)] pb-3"
              role="tablist"
            >
              {applications.map((application) => {
                const selected =
                  application.id === selectedApplication?.id;
                return (
                  <button
                    aria-selected={selected}
                    className={cn(
                      "min-h-11 shrink-0 rounded-[8px] border px-3 text-left text-xs transition-colors",
                      selected
                        ? "border-[var(--consumer-accent-ink)] bg-[var(--consumer-accent-tint)] text-[var(--consumer-accent-ink)]"
                        : "border-[var(--consumer-border)] bg-card text-muted-foreground hover:bg-[var(--consumer-canvas)]",
                    )}
                    key={application.id}
                    onClick={() => setSelectedApplicationId(application.id)}
                    role="tab"
                    type="button"
                  >
                    <span className="block font-semibold">
                      Application {application.sequence}
                    </span>
                    {presentation === "details" ? (
                      <span className="mt-0.5 block">{application.bankName}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {selectedApplication ? (
              <div
                aria-label={`Application ${selectedApplication.sequence}`}
                className="pt-5"
                role="tabpanel"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Application {selectedApplication.sequence}
                    </p>
                    <h2 className="mt-1 text-lg font-semibold tracking-[-0.025em]">
                      {presentation === "details"
                        ? selectedApplication.bankName
                        : "Application status"}
                    </h2>
                    {presentation === "details" ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedApplication.product}
                      </p>
                    ) : null}
                  </div>
                  <StatusTag
                    icon={false}
                    tone={
                      selectedApplication.operatorStatus === "done"
                        ? "success"
                        : selectedApplication.operatorStatus === "to-do"
                          ? "info"
                          : "neutral"
                    }
                  >
                    Team:{" "}
                    {selectedApplication.operatorStatus === "done"
                      ? "DONE"
                      : selectedApplication.operatorStatus === "to-do"
                        ? "TO DO"
                        : "WAIT"}
                  </StatusTag>
                </div>

                {presentation === "details" ? (
                  <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                    <div className="rounded-[8px] bg-[var(--consumer-canvas)] p-4">
                      <p className="text-xs text-muted-foreground">
                        Current criteria
                      </p>
                      <p className="mt-1 text-sm font-semibold">
                        {selectedApplication.criteriaSummary}
                      </p>
                      <SourceStamp className="mt-3">
                        Updated {formatDate(selectedApplication.sourceUpdatedAt)}
                      </SourceStamp>
                    </div>
                    <div>
                      <p className="text-xs font-semibold">Application process</p>
                      <ol className="mt-2 divide-y divide-[var(--consumer-border)] border-y border-[var(--consumer-border)]">
                        {selectedApplication.applicationProcess.map(
                          (step, index) => (
                            <li
                              className="flex min-h-11 items-center gap-3 py-2 text-sm"
                              key={step}
                            >
                              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--consumer-brand-tile)] text-[0.65rem] font-semibold text-[var(--consumer-canvas)]">
                                {index + 1}
                              </span>
                              {step}
                            </li>
                          ),
                        )}
                      </ol>
                    </div>
                  </div>
                ) : (
                  <p className="mt-5 rounded-[8px] bg-[var(--consumer-canvas)] p-4 text-sm leading-6 text-muted-foreground">
                    {/* `resolveApplicationPresentation` reads the in-memory
                        feedback provider, so on a durable workspace this
                        explained an absence as a deliberate privacy setting
                        when the real reason is that nothing was read. */}
                    {applicationVisibilityNotice ?? (durableWorkspace
                      ? APPLICATIONS_UNAVAILABLE
                      : "Your funding team has chosen not to share product, criteria, and process details here. You can still update the result and share notes with them.")}
                  </p>
                )}

                <div className="mt-6 border-t border-[var(--consumer-border)] pt-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">Your result</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {durableWorkspace
                          ? APPLICATIONS_UNAVAILABLE
                          : "Save the bank's current response. Your funding team reviews every recorded result."}
                      </p>
                    </div>
                    {selectedApplication.outcomeRecordedAt ? (
                      <SourceStamp>
                        Last saved {formatDate(selectedApplication.outcomeRecordedAt)} by{" "}
                        {selectedApplication.outcomeRecordedBy}
                      </SourceStamp>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["approved", "pending", "denied"] as const).map(
                      (outcome) => {
                        const selectedOutcome =
                          outcomeDrafts[selectedApplication.id] ??
                          selectedApplication.outcome;
                        return (
                          <Button
                            aria-pressed={selectedOutcome === outcome}
                            className="min-h-11"
                            key={outcome}
                            onClick={() =>
                              setOutcomeDrafts((current) => ({
                                ...current,
                                [selectedApplication.id]: outcome,
                              }))
                            }
                            size="sm"
                            type="button"
                            variant={
                              selectedOutcome === outcome
                                ? "default"
                                : "outline"
                            }
                          >
                            {outcome.toUpperCase()}
                          </Button>
                        );
                      },
                    )}
                  </div>
                  {(outcomeDrafts[selectedApplication.id] ??
                    selectedApplication.outcome) === "approved" ? (
                    <label className="mt-4 block max-w-xs text-xs font-medium">
                      Approved amount
                      <Input
                        className="mt-2 min-h-11"
                        inputMode="decimal"
                        onChange={(event) =>
                          setAmountDrafts((current) => ({
                            ...current,
                            [selectedApplication.id]: event.target.value,
                          }))
                        }
                        placeholder="0.00"
                        value={
                          amountDrafts[selectedApplication.id] ??
                          (selectedApplication.approvedAmount === null
                            ? ""
                            : selectedApplication.approvedAmount.toFixed(2))
                        }
                      />
                    </label>
                  ) : null}
                  <Button className="mt-4 min-h-11" onClick={saveOutcome}>
                    Save result
                  </Button>
                </div>

                <div className="mt-6 border-t border-[var(--consumer-border)] pt-5">
                  <h3 className="text-sm font-semibold">Shared notes</h3>
                  <div className="mt-3 divide-y divide-[var(--consumer-border)] border-y border-[var(--consumer-border)]">
                    {selectedApplication.notes.length ? (
                      selectedApplication.notes.map((note) => (
                        <article className="py-3" key={note.id}>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-semibold">
                              {note.authorName}
                            </p>
                            <StatusTag icon={false} tone="neutral">
                              {note.authorRole === "consumer"
                                ? "Client"
                                : "Funding team"}
                            </StatusTag>
                            <span className="text-[0.68rem] text-muted-foreground">
                              {note.createdAt}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6">{note.body}</p>
                        </article>
                      ))
                    ) : (
                      <p className="py-4 text-sm text-muted-foreground">
                        No shared notes yet.
                      </p>
                    )}
                  </div>
                  <form className="mt-4" onSubmit={addNote}>
                    <label
                      className="text-xs font-medium"
                      htmlFor={`application-note-${selectedApplication.id}`}
                    >
                      Add a note
                    </label>
                    <Textarea
                      className="mt-2 min-h-24"
                      id={`application-note-${selectedApplication.id}`}
                      onChange={(event) =>
                        setNoteDrafts((current) => ({
                          ...current,
                          [selectedApplication.id]: event.target.value,
                        }))
                      }
                      placeholder="Share an update with your funding team"
                      value={noteDrafts[selectedApplication.id] ?? ""}
                    />
                    <Button className="mt-3 min-h-11" type="submit">
                      Share note
                    </Button>
                  </form>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          // Wiring audit #3. `getApplicationsForClient` reads the route-local
          // feedback provider, whose rows are keyed on the demo roster ("c5"), so a
          // durable workspace's uuid matches nothing and the list is empty for a
          // reason that has nothing to do with the funding team. Saying so is the
          // whole fix available here: `POST /api/applications/[id]/outcomes` and
          // `POST /api/applications/[id]/notes` do accept a consumer session, but
          // neither has an application to act on until this view reads
          // `GET /api/applications?clientId=` and can render a durable row — which
          // needs lender display data the vault read model has not landed yet.
          <p className="py-8 text-center text-sm text-muted-foreground">
            {durableWorkspace
              ? APPLICATIONS_UNAVAILABLE
              : "Your funding team has not added an application sequence yet."}
          </p>
        )}
      </WorkspaceSection>
      {/* The old stamp promised that a saved result updates totals "immediately"
          and lands in the admin review queue. Both are true of the in-memory
          feedback provider the fixture shell writes to and neither is true of a
          durable workspace, where this view has no application to act on at
          all — so the durable arm states that rather than describing a pipeline
          nothing here reaches. */}
      <SourceStamp className="mt-4">
        {durableWorkspace
          ? `${APPLICATIONS_UNAVAILABLE} MostFundable is not a lender and does not guarantee funding.`
          : "Recorded results go to your funding team for review. MostFundable is not a lender and does not guarantee funding."}
      </SourceStamp>
    </div>
  );
}

function CreditScoreCard({
  band,
  bureau,
  change,
  score,
}: {
  band: string;
  bureau: string;
  change: string;
  score: number | null;
}) {
  const minimum = 300;
  const maximum = 850;
  const circumference = 2 * Math.PI * 42;
  const progress = score === null ? 0 : Math.max(0, Math.min(1, (score - minimum) / (maximum - minimum)));
  const positive = band === "Good" || band === "Excellent";

  return (
    <article className="rounded-[12px] border border-[var(--consumer-border)] bg-card p-4 shadow-[var(--consumer-surface-shadow)] sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{bureau}</h3>
        <StatusTag tone={score === null ? "neutral" : positive ? "success" : "warning"}>
          {score === null ? "Unavailable" : band}
        </StatusTag>
      </div>
      <div
        aria-label={score === null ? `${bureau} score unavailable` : `${bureau} credit score ${score}, ${band}`}
        className="relative mx-auto mt-3 grid size-36 place-items-center"
        role="img"
      >
        <svg aria-hidden className="absolute inset-0 size-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" fill="none" r="42" stroke="var(--consumer-border)" strokeWidth="7" />
          <circle
            cx="50"
            cy="50"
            fill="none"
            r="42"
            stroke={positive ? "var(--consumer-accent-ink)" : "var(--consumer-warning-border)"}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            strokeLinecap="round"
            strokeWidth="7"
          />
        </svg>
        <div className="relative text-center">
          <strong className="block text-[2.15rem] font-semibold leading-none tracking-[-0.04em] tabular-nums">{score ?? "—"}</strong>
          <span className="mt-1 block text-[0.68rem] text-muted-foreground">300–850</span>
        </div>
      </div>
      <p className={cn("mt-2 text-center text-xs font-medium", score === null ? "text-muted-foreground" : positive ? "text-[var(--consumer-positive)]" : "text-[var(--consumer-warning-ink)]")}>
        {score === null ? "Current value could not be read" : change}
      </p>
    </article>
  );
}

function CreditView({
  analysisActive,
  canRefresh,
  latestRefresh = null,
  monitoringActive,
  onRefresh,
  refreshComplete,
  refreshPending,
  refreshResumeAvailable = false,
  refreshPriceLabel,
  refreshSubmitting = false,
  paidRefreshEnabled,
  purchaseUnavailable = false,
  refreshStatusUnavailable = false,
  reading,
  readingState,
  nextRefreshAt = null,
  refreshRunning = false,
}: {
  analysisActive: boolean;
  canRefresh: boolean;
  latestRefresh?: ConsumerPaidRefreshRecord | null;
  monitoringActive: boolean;
  onRefresh: () => void;
  refreshComplete: boolean;
  refreshPending: boolean;
  /** This tab holds the exact key for an unresolved request the service can safely reconcile. */
  refreshResumeAvailable?: boolean;
  refreshPriceLabel: string;
  refreshSubmitting?: boolean;
  paidRefreshEnabled: boolean;
  /** The add-on cannot be bought here, so the control must not quote a price. */
  purchaseUnavailable?: boolean;
  refreshStatusUnavailable?: boolean;
  /** The durable reading, or `null` when none has been derived for this workspace. */
  reading?: MonitoringReading | null;
  /** Whether values are fixture-only, durable mock values, or owned by the provider frame. */
  readingState: MonitoringSurfaceState;
  /** Durable tracker schedule, available even when the provider owns all bureau values. */
  nextRefreshAt?: string | null;
  /** A paid refresh is queued and has not landed yet. */
  refreshRunning?: boolean;
}) {
  const [creditTab, setCreditTab] = useState<"summary" | "detail">("summary");

  // A provider-owned frame never borrows the mock baseline. The baseline exists only on the
  // explicit fixture arm; every provider loading/empty/error state renders as unavailable instead.
  const fixture = readingState === "fixture";
  const rows = reading?.bureaus ?? (fixture ? bureaus : []);
  const asOfLabel = reading?.asOfLabel ?? (fixture ? MONITORING_BASELINE_LABEL : null);
  const nextRefreshLabel = reading?.nextRefreshLabel
    ?? (nextRefreshAt ? formatDurableDate(nextRefreshAt) : null)
    ?? (fixture ? "Aug 13" : null);
  const utilizationPct = reading?.utilizationPct
    ?? (fixture ? MONITORING_BASELINE_UTILIZATION_PCT : null);
  const valuesAvailable = readingState === "ready" || fixture;
  const refreshStatusCopy = latestRefresh === null
    ? null
    : latestRefresh.status === "completed"
      ? `Paid and completed ${formatDurableDate(latestRefresh.completedAt ?? "") ?? "on a recorded date"}.`
      : latestRefresh.status === "payment_pending"
        ? "Payment confirmation is still pending. No completed charge is being claimed."
        : latestRefresh.status === "payment_action_required"
          ? "Payment action is required before the refresh can start."
          : latestRefresh.status === "payment_failed"
            ? "The payment failed. No completed charge is shown."
            : latestRefresh.status === "payment_review"
              ? "The payment needs review. No completed charge is being claimed."
              : latestRefresh.status === "paid"
                ? "Payment is recorded. The analysis has not been queued yet."
                : latestRefresh.status === "queued"
                  ? "Payment is recorded and the refresh is queued."
                  : latestRefresh.status === "running"
                    ? "Payment is recorded and the refresh is running."
                    : latestRefresh.status === "unfulfillable"
                      ? "Payment is recorded, but the refresh cannot run. The funding team has been alerted."
                      : latestRefresh.status === "remediated"
                        ? "The funding team resolved the earlier paid refresh obligation."
                      : latestRefresh.status === "failed"
                        ? "Payment is recorded, but the analysis failed to complete."
                        : latestRefresh.paidAt
                          ? "The refresh was canceled after payment was recorded."
                          : "The refresh was canceled. No completed charge is shown.";

  function handleCreditTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = creditTab === "summary" ? "detail" : "summary";
    setCreditTab(next);
    window.requestAnimationFrame(() =>
      document.getElementById(`credit-${next}-tab`)?.focus(),
    );
  }

  return (
    <div>
      <ConsumerPageHeader
        actions={<Button className="min-h-11" disabled={!canRefresh} onClick={onRefresh} variant="outline">{refreshSubmitting || refreshRunning ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : refreshComplete ? <CheckCircle2 aria-hidden /> : <RefreshCw aria-hidden />} {refreshSubmitting ? "Resuming refresh" : refreshResumeAvailable ? `Resume refresh · ${refreshPriceLabel}` : refreshPending ? "Confirming refresh" : refreshRunning ? "Refresh in progress" : refreshComplete ? "Snapshot refreshed" : purchaseUnavailable ? "Refresh" : paidRefreshEnabled ? `Refresh · ${refreshPriceLabel}` : "Refresh · $19"}</Button>}
        description="SecureView displays bureau data; MostFundable does not store it."
        eyebrow="Monitoring · display only"
        title="Credit snapshot"
      />
      <SourceStamp className="mb-5">SecureView displays bureau data; MostFundable does not store it.</SourceStamp>
      {/* The bureau's own widget decides for itself whether to appear: no configured host key,
          no enrollment or a provider outage all leave the durable reading below untouched. */}
      {analysisActive ? <ConsumerCreditWidget /> : null}
      {refreshStatusCopy ? (
        <div className="mb-5 flex items-start gap-3 rounded-[10px] border border-[var(--consumer-border)] bg-card px-4 py-3 text-sm" role="status">
          {latestRefresh?.status === "completed" || latestRefresh?.status === "remediated" ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--consumer-positive)]" /> : <RefreshCw aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
          <p><strong>Latest refresh request.</strong> {refreshStatusCopy}</p>
        </div>
      ) : null}
      {refreshStatusUnavailable ? (
        <div className="mb-5 flex items-start gap-3 rounded-[10px] border border-[var(--consumer-border)] bg-card px-4 py-3 text-sm" role="status">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--consumer-warning-ink)]" />
          <p><strong>Refresh status is unavailable.</strong> A new request is disabled until the durable payment and job history can be read.</p>
        </div>
      ) : null}
      <div
        aria-label="Credit report view"
        className="mb-5 flex gap-1 rounded-[10px] border border-[var(--consumer-border)] bg-card p-1"
        role="tablist"
      >
        <button
          aria-controls="credit-summary-panel"
          aria-selected={creditTab === "summary"}
          className={cn("min-h-10 flex-1 rounded-[8px] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--consumer-accent-ink)]", creditTab === "summary" ? "bg-[var(--consumer-accent-tint)] text-[var(--consumer-accent-ink)]" : "text-muted-foreground hover:bg-[var(--consumer-canvas)]")}
          id="credit-summary-tab"
          onClick={() => setCreditTab("summary")}
          onKeyDown={handleCreditTabKey}
          role="tab"
          tabIndex={creditTab === "summary" ? 0 : -1}
          type="button"
        >
          Credit summary
        </button>
        <button
          aria-controls="credit-detail-panel"
          aria-selected={creditTab === "detail"}
          className={cn("min-h-10 flex-1 rounded-[8px] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--consumer-accent-ink)]", creditTab === "detail" ? "bg-[var(--consumer-accent-tint)] text-[var(--consumer-accent-ink)]" : "text-muted-foreground hover:bg-[var(--consumer-canvas)]")}
          id="credit-detail-tab"
          onClick={() => setCreditTab("detail")}
          onKeyDown={handleCreditTabKey}
          role="tab"
          tabIndex={creditTab === "detail" ? 0 : -1}
          type="button"
        >
          Detailed report
        </button>
      </div>
      {creditTab === "detail" ? (
        <WorkspaceSection>
          <div aria-labelledby="credit-detail-tab" className="mx-auto max-w-lg py-10 text-center sm:py-14" id="credit-detail-panel" role="tabpanel">
            <span className="mx-auto grid size-11 place-items-center rounded-full bg-[var(--consumer-canvas)] text-muted-foreground"><FolderLock aria-hidden className="size-5" /></span>
            <h2 className="mt-4 text-sm font-semibold">Detailed report connection required</h2>
            {/* The refusal was right and the wording was not: a signed-in
                consumer's own workspace is not "this demo". What the panel has
                to say is the second sentence. */}
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Your detailed report appears here once credit monitoring is connected.</p>
            <SourceStamp className="mt-4 justify-center">No bureau data is shown here yet.</SourceStamp>
          </div>
        </WorkspaceSection>
      ) : !monitoringActive ? (
        <WorkspaceSection>
          <div aria-labelledby="credit-summary-tab" className="mx-auto max-w-md py-10 text-center" id="credit-summary-panel" role="tabpanel">
            <span className="mx-auto grid size-11 place-items-center rounded-full bg-[var(--consumer-canvas)] text-muted-foreground"><LockKeyhole aria-hidden className="size-5" /></span>
            <h2 className="mt-4 text-sm font-semibold">Credit monitoring is inactive</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Credit monitoring is off because you revoked that permission. Your analysis permission is separate and unchanged.</p>
          </div>
        </WorkspaceSection>
      ) : !valuesAvailable ? (
        <WorkspaceSection>
          <div aria-labelledby="credit-summary-tab" className="mx-auto max-w-lg py-10 text-center sm:py-14" id="credit-summary-panel" role="tabpanel">
            <span className="mx-auto grid size-11 place-items-center rounded-full bg-[var(--consumer-canvas)] text-muted-foreground">
              {readingState === "loading" ? <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" /> : <AlertTriangle aria-hidden className="size-5" />}
            </span>
            <h2 className="mt-4 text-sm font-semibold">
              {readingState === "loading" ? "Loading current credit scores" : "Current credit scores are unavailable"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {readingState === "error"
                ? "The monitoring status could not be read. No previous or fixture score is shown in its place."
                : "SecureView owns the current score display. MostFundable does not fetch, proxy, or store those bureau values."}
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              {analysisActive
                ? nextRefreshLabel ? `Next included refresh ${nextRefreshLabel}` : "The next included refresh is not scheduled yet."
                : "No refresh is scheduled while analysis is paused."}
            </p>
            {refreshRunning ? <p className="mt-2 text-xs text-muted-foreground">Your paid refresh is still running. Its durable status will remain here after a reload.</p> : null}
            <SourceStamp className="mt-4 justify-center">No mock or stored bureau value is being substituted.</SourceStamp>
          </div>
        </WorkspaceSection>
      ) : (
        <div aria-labelledby="credit-summary-tab" id="credit-summary-panel" role="tabpanel">
          <WorkspaceSection className="mb-5" title={reading ? "What changed since the previous pull" : "What changed since Jul 2"}>
            <p className="text-sm leading-6">{reading?.whatChanged ?? "The Jul 14 TransUnion source record includes a lower revolving balance. Experian added the Amex Blue Business account on Jul 9. Chase Ink remains the primary utilization watch item."}</p>
          </WorkspaceSection>
          <WorkspaceSection
            description={`Last refreshed ${asOfLabel} · VantageScore 3.0 · score range 300–850`}
            title="Your credit scores"
            trailing={refreshRunning ? <StatusTag tone="warning">Refresh running</StatusTag> : <StatusTag tone="success">Connected</StatusTag>}
          >
            <div className="grid gap-3 md:grid-cols-3">
              {rows.map((bureau) => (
                <CreditScoreCard
                  band={bureau.band}
                  bureau={bureau.bureau}
                  change={bureau.change}
                  key={bureau.bureau}
                  score={bureau.score}
                />
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-2 border-t border-[var(--consumer-border)] pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>{analysisActive ? `Next included refresh ${nextRefreshLabel}` : "No refresh scheduled while analysis is paused"}</span>
              {refreshRunning ? <span>A paid refresh is running. Updated scores appear when it lands.</span> : null}
            </div>
            <SourceStamp className="mt-4">Displayed inside the certified monitoring frame; MostFundable does not store bureau values.</SourceStamp>
          </WorkspaceSection>
          <WorkspaceSection className="mt-5" title="Watch items">
            <div className="divide-y divide-[var(--consumer-border)]">
              <div className="flex items-start gap-3 py-3 first:pt-0"><AlertTriangle aria-hidden className="mt-0.5 size-4 text-[var(--consumer-warning-ink)]" /><div><p className="text-sm font-semibold">Chase Ink utilization is {utilizationPct}%</p><p className="mt-1 text-xs text-muted-foreground">Target 29% or less · reported by Experian</p></div></div>
              <div className="flex items-start gap-3 py-3 last:pb-0"><CheckCircle2 aria-hidden className="mt-0.5 size-4 text-[var(--consumer-positive)]" /><div><p className="text-sm font-semibold">No new hard inquiries</p><p className="mt-1 text-xs text-muted-foreground">Verified across the {asOfLabel} snapshot</p></div></div>
            </div>
          </WorkspaceSection>
        </div>
      )}
    </div>
  );
}

function OnboardingHubView({
  analysisActive,
  documentUploadsAllowed,
  enrollment,
  enrollmentState,
  initialTab = "files",
  monitoringActive,
  notify,
  onUpload,
  portalPreferencesState,
  termsSigned,
  uploadedFiles,
  uploadingCategory,
  ancillaryEnabled = false,
  ancillaryPending = false,
  clientId,
  durableWorkspace,
}: {
  analysisActive: boolean;
  documentUploadsAllowed: boolean;
  durableWorkspace: boolean;
  enrollment: EnrollmentView | null;
  enrollmentState: BootstrapState;
  initialTab?: "files" | "permissions";
  monitoringActive: boolean;
  notify: (message: string) => void;
  onUpload: (category: DocumentCategory, files: File[]) => void;
  portalPreferencesState: PortalPreferencesReadState;
  termsSigned: boolean;
  uploadedFiles: Record<DocumentCategory, string[]>;
  uploadingCategory: DocumentCategory | null;
  ancillaryEnabled?: boolean;
  ancillaryPending?: boolean;
  clientId: string;
}) {
  /**
   * The document vault has three states, and the flag alone told them apart.
   * With the ancillary set off, `documentSections[].fixtureFiles` listed one
   * fixture company's Articles of Organization, EIN confirmation and 2024
   * return, each stamped "Jun 24 · encrypted storage" and tagged Verified, on
   * whatever account was signed in. Off is off for everyone; only the fixture
   * shell may fill the gap with a fixture.
   */
  const documentsOff = durableWorkspace && !ancillaryEnabled && !ancillaryPending;
  const documentUploadNotice = !durableWorkspace || documentUploadsAllowed
    ? null
    : portalPreferencesState === "loading"
      ? DOCUMENT_UPLOADS_LOADING
      : portalPreferencesState === "unavailable"
        ? DOCUMENT_UPLOADS_UNAVAILABLE
        : DOCUMENT_UPLOADS_DISABLED;
  const monitoringConsent = enrollment?.consents.find((item) => item.kind === "monitoring");
  const analysisConsent = enrollment?.consents.find((item) => item.kind === "analysis");
  // R4D-04. Cancellation retains the consent rows on purpose, so the grants stay visible as
  // history — but a cancelled enrollment can never present them as live permissions with a working
  // Revoke control, because the durable status says the plan is closed.
  const cancelledEnrollment = enrollment?.status === "cancelled";
  /**
   * A missing consent row is not a granted consent.
   *
   * `monitoringActive` and `analysisActive` are `ConsumerApp` state that starts
   * `true` for the fixture walkthrough, so `?? monitoringActive` handed every
   * signed-in consumer with no enrollment record an "Active" grant on both named
   * authorizations — the G-HOST-14 class, on the two rows that are this
   * product's entire legal basis for pulling anything. On a durable workspace
   * the absent row now reads as absent; the fixture shell keeps its local
   * toggles, which is what the Settings revoke control there drives.
   */
  const monitoringUnrecorded = durableWorkspace && !monitoringConsent;
  const analysisUnrecorded = durableWorkspace && !analysisConsent;
  const monitoringGranted = monitoringConsent?.authorized ?? (durableWorkspace ? false : monitoringActive);
  const analysisGranted = analysisConsent?.authorized ?? (durableWorkspace ? false : analysisActive);
  const shownMonitoringActive = !cancelledEnrollment && monitoringGranted;
  const shownAnalysisActive = !cancelledEnrollment && analysisGranted;
  const monitoringLabel = monitoringUnrecorded ? "Not recorded" : cancelledEnrollment && monitoringGranted ? "Retained" : shownMonitoringActive ? "Active" : "Revoked";
  const analysisLabel = analysisUnrecorded ? "Not recorded" : cancelledEnrollment && analysisGranted ? "Retained" : shownAnalysisActive ? "Active" : "Revoked";
  // The same two expressions the agreement rows below use to render "Pending",
  // read once here so the honest-refusal notice cannot drift away from the rows
  // that need it.
  const analysisSignaturePending = Boolean(enrollment) && !analysisConsent?.signedAt;
  const monitoringSignaturePending =
    shownMonitoringActive && !(Boolean(monitoringConsent?.signedAt) || termsSigned);
  const signaturePending = analysisSignaturePending || monitoringSignaturePending;
  const completedMilestones = new Set(
    enrollment?.milestones.map((milestone) => milestone.kind) ?? [],
  );
  /**
   * When this account signed the service agreement, or null when nothing says.
   *
   * The Agreement record's first row used to be the literal ["Funding Readiness
   * Service Agreement", "Signed Jun 24", "Approved"] with no source at all. The
   * document is real — `CONSENT_DOCUMENTS.enrollment_agreement` — and so is its
   * signature, which `beginEnrollment` captures and records as the
   * `agreement_signed` milestone. The row reads that milestone's own timestamp.
   */
  const agreementSignedAt =
    enrollment?.milestones.find((milestone) => milestone.kind === "agreement_signed")?.completedAt ?? null;
  const agreementUnrecorded = durableWorkspace && agreementSignedAt === null;
  const milestoneRows = onboardingMilestones.map((milestone) => ({
    ...milestone,
    complete: enrollmentState === "ready"
      ? completedMilestones.has(milestone.kind)
      // Same rule as the documents above: with the enrollment bootstrap off,
      // `fixtureComplete` pre-marked three milestones Complete on an account
      // that has never enrolled.
      : enrollmentState === "disabled" && !durableWorkspace
        ? milestone.fixtureComplete
        : false,
  }));
  const milestoneEvidenceLabel = enrollmentState === "ready"
    ? enrollment
      ? "Live enrollment milestones"
      : "No current enrollment record"
    : enrollmentState === "disabled"
      ? durableWorkspace ? ENROLLMENT_EVIDENCE_ABSENT : "Illustrative checklist"
      : enrollmentState === "loading"
        ? "Loading live enrollment evidence"
        : "Live enrollment evidence unavailable";
  const [tab, setTab] = useState<"files" | "permissions">(initialTab);
  const [uploadCategory, setUploadCategory] =
    useState<DocumentCategory>("tax-returns");
  const inputRef = useRef<HTMLInputElement>(null);
  const reportInputRef = useRef<HTMLInputElement>(null);
  const [liveDocuments, setLiveDocuments] = useState<LiveDocument[]>([]);
  const [liveState, setLiveState] = useState("");
  const [liveError, setLiveError] = useState(false);
  const [agreementDownloadPending, setAgreementDownloadPending] = useState(false);
  const sectionApi = (category: DocumentCategory) => category.replaceAll("-", "_");
  async function refreshDocuments() { const response = await fetch(`/api/uploads/documents?clientId=${encodeURIComponent(clientId)}`); if (!response.ok) { setLiveState("Documents are unavailable."); setLiveError(true); return; } const data = await response.json() as { documents?: LiveDocument[] }; setLiveDocuments(data.documents ?? []); setLiveState(""); setLiveError(false); }
  // The initial read reports its failure exactly as refreshDocuments does. It
  // used to map every non-OK response and network error to no state change,
  // which rendered an outage as a healthy empty vault ("No files in this
  // section yet") — the G-HOST-14 class, found by the wiring audit (#5).
  useEffect(() => { if (!ancillaryEnabled) return; let active = true; void fetch(`/api/uploads/documents?clientId=${encodeURIComponent(clientId)}`).then((response) => response.ok ? response.json() : null).then((data: { documents?: LiveDocument[] } | null) => { if (!active) return; if (data) { setLiveDocuments(data.documents ?? []); setLiveError(false); } else { setLiveState("Documents are unavailable."); setLiveError(true); } }).catch(() => { if (active) { setLiveState("Documents are unavailable."); setLiveError(true); } }); return () => { active = false; }; }, [ancillaryEnabled, clientId]);

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (!documentUploadsAllowed) {
      event.target.value = "";
      if (selectedFiles.length) notify(documentUploadNotice ?? DOCUMENT_UPLOADS_DISABLED);
      return;
    }
    // R4B-03. Neither branch is safe while the bootstrap is loading or unavailable: the live one
    // has no confirmed route to storage, and the local one would list the file as stored.
    if (ancillaryPending) {
      event.target.value = "";
      if (selectedFiles.length) notify(ANCILLARY_UNAVAILABLE_NOTICE);
      return;
    }
    if (!selectedFiles.length) return;
    const allowed = ["application/pdf", "image/png", "image/jpeg"];
    const validFiles = selectedFiles.filter(
      (file) =>
        allowed.includes(file.type) && file.size <= (ancillaryEnabled ? 6 : 10) * 1024 * 1024,
    );
    if (validFiles.length !== selectedFiles.length) {
      notify("Some files were skipped. Use PDF, PNG, or JPG files up to 10 MB each.");
    }
    if (validFiles.length) {
      if (ancillaryEnabled) void uploadLive(uploadCategory, validFiles);
      else onUpload(uploadCategory, validFiles);
    }
    event.target.value = "";
  }
  async function uploadLive(category: DocumentCategory, files: File[]) {
    if (!documentUploadsAllowed) {
      notify(documentUploadNotice ?? DOCUMENT_UPLOADS_DISABLED);
      return;
    }
    setLiveState("Uploading…");
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    const response = await fetch(`/api/uploads/documents?clientId=${encodeURIComponent(clientId)}&section=${sectionApi(category)}`, { method: "POST", body: form });
    if (!response.ok) { setLiveState("Upload failed."); return; }
    await refreshDocuments();
    notify(`${files.length} ${files.length === 1 ? "file" : "files"} added to private storage.`);
  }
  async function downloadLive(row: LiveDocument) { const response = await fetch(`/api/uploads/documents/${row.id}?clientId=${encodeURIComponent(clientId)}`); if (!response.ok) { setLiveState("Download failed."); return; } const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = row.displayName; link.click(); URL.revokeObjectURL(url); }
  async function deleteLive(row: LiveDocument) { const response = await fetch(`/api/uploads/documents/${row.id}?clientId=${encodeURIComponent(clientId)}`, { method: "DELETE" }); if (!response.ok) { setLiveState("Delete failed."); return; } await refreshDocuments(); }
  async function uploadReport(file: File) {
    if (!documentUploadsAllowed) {
      notify(documentUploadNotice ?? DOCUMENT_UPLOADS_DISABLED);
      return;
    }
    setLiveState("Processing credit file…");
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/uploads/credit-report?clientId=${encodeURIComponent(clientId)}`, { method: "POST", body: form });
    setLiveState(response.status === 201 ? "Credit file processed and queued." : response.status === 202 ? "Source clearing is pending." : response.status === 503 ? "Credit-file parsing is unavailable." : "Credit-file processing failed.");
  }

  async function downloadSignedAgreement() {
    if (!enrollment || !agreementSignedAt || agreementDownloadPending) return;
    setAgreementDownloadPending(true);
    try {
      const response = await fetch(`/api/enrollments/${enrollment.enrollmentId}/agreement`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: unknown } } | null;
        notify(typeof payload?.error?.message === "string"
          ? payload.error.message
          : "The signed agreement could not be downloaded right now.");
        return;
      }
      const disposition = response.headers.get("content-disposition") ?? "";
      const suppliedName = disposition.match(/filename="([^"]+)"/i)?.[1];
      const filename = suppliedName?.replace(/[^a-z0-9._-]/gi, "-")
        ?? `mostfundable-service-agreement-${agreementSignedAt.slice(0, 10)}.html`;
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(url);
      }, 0);
      notify("Signed service agreement downloaded.");
    } catch {
      notify("The signed agreement could not be downloaded right now.");
    } finally {
      setAgreementDownloadPending(false);
    }
  }

  function openFilePicker(category: DocumentCategory) {
    if (!documentUploadsAllowed) {
      notify(documentUploadNotice ?? DOCUMENT_UPLOADS_DISABLED);
      return;
    }
    if (ancillaryPending) {
      notify(ANCILLARY_UNAVAILABLE_NOTICE);
      return;
    }
    setUploadCategory(category);
    window.requestAnimationFrame(() => inputRef.current?.click());
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tab === "files" ? "permissions" : "files";
    setTab(next);
    window.requestAnimationFrame(() => document.getElementById(`${next}-tab`)?.focus());
  }

  function downloadDemoDocument(name: string) {
    const content = `MostFundable demo document\n\nRecord: ${name}\nGenerated: Jul 21, 2026\n\nThis text artifact represents the downloadable record in the interactive product demo.`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name.replace(/\.[^.]+$/, "")}-demo-record.txt`;
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 0);
    notify(`${name} downloaded as a demo record.`);
  }

  const signedAgreementDownloadAvailable = enrollment !== null && agreementSignedAt !== null;
  const agreementRows = [
    {
      download: signedAgreementDownloadAvailable ? "signed" : "none",
      name: durableWorkspace
        ? CONSENT_DOCUMENTS.enrollment_agreement.title
        : "Funding Readiness Service Agreement",
      date: agreementSignedAt
        ? `Signed ${formatDate(agreementSignedAt.slice(0, 10))}`
        : durableWorkspace ? "No signature recorded" : "Signed Jun 24",
      status: agreementSignedAt || !durableWorkspace ? "Approved" : "Not recorded",
    },
    {
      download: durableWorkspace ? "unavailable" : "demo",
      name: enrollment || durableWorkspace ? CONSENT_DOCUMENTS.analysis.title : "Written Instructions for Analysis",
      date: analysisConsent?.signedAt
        ? `Signed ${formatDate(analysisConsent.signedAt.slice(0, 10))}`
        : analysisUnrecorded ? "No signature recorded" : enrollment ? "Signature needed" : "Signed Jun 24",
      status: analysisUnrecorded
        ? analysisLabel
        : enrollment && !analysisConsent?.signedAt ? "Pending" : shownAnalysisActive ? "Approved" : analysisLabel,
    },
    {
      download: durableWorkspace ? "unavailable" : "demo",
      name: enrollment || durableWorkspace ? CONSENT_DOCUMENTS.monitoring.title : "SecureView Monitoring Terms",
      date: monitoringConsent?.signedAt
        ? `Signed ${formatDate(monitoringConsent.signedAt.slice(0, 10))}`
        : monitoringUnrecorded ? "No signature recorded" : termsSigned ? "Signed Jul 21" : "Signature needed",
      status: monitoringUnrecorded
        ? monitoringLabel
        : shownMonitoringActive
          ? Boolean(monitoringConsent?.signedAt) || termsSigned ? "Approved" : "Pending"
          : monitoringLabel,
    },
  ] as const;

  return (
    <div>
      <ConsumerPageHeader eyebrow="Setup and permissions record" title="Onboarding & Docs" />

      <WorkspaceSection
        className="mb-5"
        description={milestoneEvidenceLabel}
        title="Enrollment"
      >
        <div className="divide-y divide-[var(--consumer-border)]">
          {milestoneRows.map((milestone) => (
            <div className="flex min-h-14 items-center gap-3 py-3 first:pt-0 last:pb-0" key={milestone.kind}>
              <StateMarker size="sm" state={milestone.complete ? "verified" : "todo"} />
              <p className="min-w-0 flex-1 text-sm font-medium">{milestone.label}</p>
              <StatusTag icon={milestone.complete ? undefined : false} tone={milestone.complete ? "success" : "neutral"}>
                {milestone.complete ? "Complete" : "Incomplete"}
              </StatusTag>
            </div>
          ))}
        </div>
      </WorkspaceSection>

      <div className="mb-5 flex gap-1 border-b border-[var(--consumer-border)]" role="tablist" aria-label="Onboarding and documents sections">
        <button aria-controls="files-panel" aria-selected={tab === "files"} className={cn("min-h-11 border-b-2 px-3 text-sm font-medium", tab === "files" ? "border-[var(--consumer-accent-ink)] text-[var(--consumer-accent-ink)]" : "border-transparent text-muted-foreground")} id="files-tab" onClick={() => setTab("files")} onKeyDown={handleTabKey} role="tab" tabIndex={tab === "files" ? 0 : -1} type="button">Document vault</button>
        <button aria-controls="permissions-panel" aria-selected={tab === "permissions"} className={cn("min-h-11 border-b-2 px-3 text-sm font-medium", tab === "permissions" ? "border-[var(--consumer-accent-ink)] text-[var(--consumer-accent-ink)]" : "border-transparent text-muted-foreground")} id="permissions-tab" onClick={() => setTab("permissions")} onKeyDown={handleTabKey} role="tab" tabIndex={tab === "permissions" ? 0 : -1} type="button">Agreements</button>
      </div>

      {tab === "files" ? (
        <div aria-labelledby="files-tab" className="space-y-5" id="files-panel" role="tabpanel">
          <WorkspaceSection
            description={documentUploadsAllowed
              ? "Upload the documents your funding team asks for. Only your team can see them."
              : "Review files already stored for your funding team."}
            title="Company documents"
          >
            {documentUploadsAllowed ? <input
              accept=".pdf,.png,.jpg,.jpeg"
              className="hidden"
              disabled={ancillaryPending}
              multiple
              onChange={chooseFiles}
              ref={inputRef}
              type="file"
            /> : null}
            {documentUploadNotice ? <p className="mb-4 rounded-[8px] bg-[var(--consumer-canvas)] px-3 py-3 text-xs text-muted-foreground" role="status">{documentUploadNotice}</p> : null}
            {documentsOff ? <p className="mb-4 rounded-[8px] bg-[var(--consumer-canvas)] px-3 py-3 text-xs text-muted-foreground" role="status">{DOCUMENT_STORAGE_ABSENT}</p> : ancillaryPending ? <p className="mb-4 rounded-[8px] bg-[var(--consumer-canvas)] px-3 py-3 text-xs text-muted-foreground" role="status">{ANCILLARY_UNAVAILABLE_NOTICE}</p> : null}
            {ancillaryEnabled && documentUploadsAllowed ? <input accept=".pdf" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadReport(file); event.target.value = ""; }} ref={reportInputRef} type="file" /> : null}
            {ancillaryEnabled && documentUploadsAllowed ? <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[8px] bg-[var(--consumer-canvas)] p-3"><Button onClick={() => reportInputRef.current?.click()} variant="outline"><Upload aria-hidden />Upload credit file separately</Button><span className="text-xs text-muted-foreground">{liveState || "The source is cleared after successful parsing before analysis is queued."}</span></div> : null}
            <div className="divide-y divide-[var(--consumer-border)]">
              {documentSections.map((section) => {
                const uploaded = uploadedFiles[section.id];
                const liveRows = liveDocuments.filter((row) => row.section === sectionApi(section.id));
                const files = ancillaryEnabled ? liveRows.map((row) => row.displayName) : ancillaryPending || documentsOff ? [] : [...section.fixtureFiles, ...uploaded];
                const isUploading = uploadingCategory === section.id;
                return (
                  <section className="py-5 first:pt-0 last:pb-0" key={section.id}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[var(--consumer-accent-tint)] text-[var(--consumer-accent-ink)]">
                        <FolderLock aria-hidden className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold">{section.title}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {section.description}{documentUploadsAllowed ? <> · PDF, PNG, or JPG up to {ancillaryEnabled ? 6 : 10} MB each</> : null}
                        </p>
                      </div>
                      {documentUploadsAllowed ? <Button
                        className="min-h-11"
                        disabled={uploadingCategory !== null || ancillaryPending || documentsOff}
                        onClick={() => openFilePicker(section.id)}
                        title={documentsOff ? DOCUMENT_STORAGE_ABSENT : undefined}
                        variant="outline"
                      >
                        {isUploading ? (
                          <>
                            <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> Encrypting
                          </>
                        ) : (
                          <>
                            <Upload aria-hidden /> Add files
                          </>
                        )}
                      </Button> : null}
                    </div>
                    {files.length ? (
                      <div className="mt-4 divide-y divide-[var(--consumer-border)] border-y border-[var(--consumer-border)]">
                        {files.map((name, index) => {
                          const isNew = index >= section.fixtureFiles.length;
                          return (
                            <div className="flex min-h-14 items-center gap-3 py-3" key={`${section.id}-${name}-${index}`}>
                              <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <p className="break-words text-sm font-medium">{name}</p>
                                <p className="mt-1 text-[0.68rem] text-muted-foreground">
                                  {ancillaryEnabled ? "Only your funding team can see this" : <>{isNew ? "Uploaded now" : "Jun 24"} · only your funding team can see this</>}
                                </p>
                              </div>
                              <StatusTag tone="success">{isNew ? "Available" : "Verified"}</StatusTag>
                              <Button
                                aria-label={`Download ${name}`}
                                className="size-11"
                                disabled={durableWorkspace && !(ancillaryEnabled && liveRows[index])}
                                onClick={() => { const row = liveRows[index]; if (ancillaryEnabled && row) void downloadLive(row); else downloadDemoDocument(name); }}
                                size="icon-lg"
                                title={durableWorkspace && !(ancillaryEnabled && liveRows[index]) ? DOCUMENT_DOWNLOAD_UNAVAILABLE : undefined}
                                variant="ghost"
                              >
                                <Download aria-hidden />
                              </Button>
                              {ancillaryEnabled && liveRows[index] ? <Button aria-label={`Delete ${name}`} className="size-11" onClick={() => void deleteLive(liveRows[index])} size="icon-lg" variant="ghost">Delete</Button> : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-4 rounded-[8px] bg-[var(--consumer-canvas)] px-3 py-3 text-xs text-muted-foreground">
                        {ancillaryPending || (ancillaryEnabled && liveError) ? "This section cannot be listed right now." : "No files in this section yet."}
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          </WorkspaceSection>
        </div>
      ) : (
        <div aria-labelledby="permissions-tab" className="space-y-5" id="permissions-panel" role="tabpanel">
          <WorkspaceSection title="Agreement record">
            {/*
              Wiring audit #1. This button used to call `notify` with
              "<document> signed." and nothing else, so an unsigned analysis
              authorization stayed unsigned while the toast said it had been
              captured — the worst shape a consent control can have in a product
              whose two named consents plus the e-signature are the legal basis
              for every pull that follows.

              A first grant still has no standalone endpoint: it is captured
              inside `POST /api/enroll`, which carries the signature in the same
              request. The reauthorization route added later accepts only a
              previously signed and revoked permission, so an initial Pending row
              remains disabled and says so.
            */}
            {/*
              The list used to open on a literal row — "Funding Readiness Service
              Agreement · Signed Jun 24 · Approved" — that ran unconditionally, so
              a signed-in consumer whose two real consent rows read "Signature
              needed" was still told a third document had been signed on a date
              nothing records. The document is real and so is its signature: the
              row now names `CONSENT_DOCUMENTS.enrollment_agreement` and dates it
              from the `agreement_signed` milestone, and says so when the
              enrollment carries none.
            */}
            <div className="divide-y divide-[var(--consumer-border)]">
              {agreementRows.map(({ date, download, name, status }) => (
                <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center" key={name}>
                  <FileCheck2 aria-hidden className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium">{name}</p><p className="mt-1 text-[0.68rem] text-muted-foreground">{date}</p></div>
                  <StatusTag tone={status === "Approved" ? "success" : status === "Pending" ? "warning" : "neutral"}>{status}</StatusTag>
                  {status === "Pending" ? (
                    <Button className="min-h-11" disabled size="sm" title={CONSENT_SIGNING_UNAVAILABLE}>Review and sign</Button>
                  ) : download === "signed" ? (
                    <Button
                      aria-label="Download signed service agreement"
                      className="size-11"
                      disabled={agreementDownloadPending}
                      onClick={() => { void downloadSignedAgreement(); }}
                      size="icon-lg"
                      variant="ghost"
                    >
                      {agreementDownloadPending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Download aria-hidden />}
                    </Button>
                  ) : download === "demo" ? (
                    <Button aria-label={`Download ${name}`} className="size-11" onClick={() => downloadDemoDocument(name)} size="icon-lg" variant="ghost"><Download aria-hidden /></Button>
                  ) : download === "unavailable" ? (
                    <Button aria-label={`Download ${name}`} className="size-11" disabled size="icon-lg" title={DOCUMENT_DOWNLOAD_UNAVAILABLE} variant="ghost"><Download aria-hidden /></Button>
                  ) : null}
                </div>
              ))}
            </div>
            {monitoringUnrecorded && analysisUnrecorded && agreementUnrecorded ? (
              <p
                className="mt-4 rounded-[8px] bg-[var(--consumer-canvas)] px-3 py-3 text-xs leading-5 text-muted-foreground"
                role="status"
              >
                {AGREEMENT_RECORD_ABSENT}
              </p>
            ) : null}
            {signaturePending ? (
              <p
                className="mt-4 rounded-[8px] bg-[var(--consumer-canvas)] px-3 py-3 text-xs leading-5 text-muted-foreground"
                role="status"
              >
                {CONSENT_SIGNING_UNAVAILABLE}
              </p>
            ) : null}
          </WorkspaceSection>
        </div>
      )}
    </div>
  );
}


function SettingsView({
  analysisActive,
  cardLast4,
  canceled,
  enrollment,
  enrollmentFixture,
  enrollmentPending,
  monitoringActive,
  notify,
  onCancel,
  onReauthorize,
  onRevoke,
  onUpdateCard,
  onUpdateProfile,
  profile,
  profileReadState,
  profileDurable,
  paidRefreshHistoryUnavailable,
  paidRefreshes,
  refreshChargedAt,
  refreshComplete,
  refreshPending,
  monitoringPriceAmountLabel,
  monitoringPriceLabel,
  refreshPriceAmountLabel,
}: {
  analysisActive: boolean;
  cardLast4: string;
  canceled: boolean;
  enrollment: EnrollmentView | null;
  /** True only on an explicit successful `{ enabled: false }` — the flags-off demo shell. */
  enrollmentFixture: boolean;
  enrollmentPending: boolean;
  monitoringActive: boolean;
  notify: (message: string) => void;
  onCancel: () => void;
  onReauthorize: (kind: Consent) => void;
  onRevoke: (kind: Consent) => void;
  onUpdateCard: (last4: string) => void;
  onUpdateProfile: (profile: ConsumerProfile) => void;
  profile: ConsumerProfile;
  profileReadState: "loading" | "ready" | "unavailable";
  /** False only for the explicit fixture shell, whose editor remains local and labeled demo. */
  profileDurable: boolean;
  paidRefreshHistoryUnavailable: boolean;
  paidRefreshes: readonly ConsumerPaidRefreshRecord[];
  /** Fixture-only confirmation instant; durable charges come from `paidRefreshes[].paidAt`. */
  refreshChargedAt: string | null;
  refreshComplete: boolean;
  refreshPending: boolean;
  monitoringPriceAmountLabel: string;
  monitoringPriceLabel: string;
  refreshPriceAmountLabel: string;
}) {
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState(profile);
  const [profileSavePending, setProfileSavePending] = useState(false);
  const [profileSaveNotice, setProfileSaveNotice] = useState<{
    message: string;
    tone: "error" | "info" | "success";
  } | null>(null);
  const [editingPayment, setEditingPayment] = useState(false);
  const [cardDraft, setCardDraft] = useState("");
  const [expiryDraft, setExpiryDraft] = useState("12/28");
  const [paymentError, setPaymentError] = useState("");
  const [billingPortalPending, setBillingPortalPending] = useState(false);
  const [billingPortalError, setBillingPortalError] = useState("");
  /**
   * The bootstrap grammar, applied to billing.
   *
   * `consumer-bootstrap.ts` gives this surface four outcomes and only one of them is the fixture:
   * `disabled` — a successful `{ enabled: false }` from `/api/enroll` — is the flags-off demo
   * shell, and `loading`/`unavailable` are a read that has not landed or has failed. Everything
   * else is a signed-in consumer's own record, whether or not that record holds an enrollment.
   *
   * The defect this closes: the plan card, the payment history, the permission rows and the card
   * on file were all module literals with no branch at all, so a consumer who has never enrolled
   * was shown an active $49 plan, a saved Visa and paid rows dated Jun 20 through Jul 21. Rows
   * dated before any enrollment exists contradict the rule stated at enrollment — card authorized
   * then, charged only on success — which makes this a compliance-visible contradiction rather
   * than a cosmetic one. Durable now means durable: what the subscription row says, or an em dash
   * with the reason beside it.
   */
  const billingDurable = !enrollmentFixture && !enrollmentPending;
  const subscription: SubscriptionView | null = billingDurable
    ? enrollment?.subscription ?? null
    : null;
  const billingPortalAvailable = billingDurable && subscription !== null;
  const durableDate = (value: string | null): string | null =>
    value === null ? null : formatDurableDate(value);

  // A consent that no durable read has produced is not an authorized one. The `?? analysisActive`
  // fallback below is component state that initialises to `true`, which is correct for the fixture
  // shell and is exactly how a never-enrolled consumer came to see two Active permissions with
  // working Revoke buttons; outside the fixture the absence of a grant row means no grant.
  const analysisAuthorized = enrollment?.consents.find((item) => item.kind === "analysis")?.authorized
    ?? (enrollmentFixture ? analysisActive : false);
  const monitoringAuthorized = enrollment?.consents.find((item) => item.kind === "monitoring")?.authorized
    ?? (enrollmentFixture ? monitoringActive : false);
  // R4D-04. Cancellation retains the consent rows on purpose, so the grants stay visible as
  // history — but a cancelled enrollment can never present them as live permissions with a working
  // Revoke control, because the durable status says the plan is closed. Drop 7 #182 moved these
  // rows here from the agreement card; the withdrawal control has to stay reachable in Account
  // settings, so the cancelled arm disables it rather than removing it.
  const cancelledEnrollment = enrollment?.status === "cancelled";
  const shownAnalysisActive = !cancelledEnrollment && analysisAuthorized;
  const shownMonitoringActive = !cancelledEnrollment && monitoringAuthorized;
  // Five states, not two. "Not shown" is the failed or pending read: rendering "Revoked" there
  // would be the G-HOST-14 class again, an outage displayed as a settled fact about somebody's
  // permissions. "Not authorized" is the honest pre-enrollment state.
  const consentLabel = (authorized: boolean, shownActive: boolean): string =>
    enrollmentPending
      ? "Not shown"
      : billingDurable && enrollment === null
        ? "Not authorized"
        : cancelledEnrollment && authorized
          ? "Retained"
          : shownActive
            ? "Active"
            : "Revoked";
  const analysisLabel = consentLabel(analysisAuthorized, shownAnalysisActive);
  const monitoringLabel = consentLabel(monitoringAuthorized, shownMonitoringActive);
  /**
   * The ledger.
   *
   * There is no consumer invoice table in this platform — `public.consumer_subscriptions` holds one
   * row per enrollment, and its two timestamps are the only durable payment events a consumer's
   * own read can reach. So the durable arm renders exactly those: the card authorization at
   * `created_at`, which is $0.00 by design, and the first charge at `activated_at`. Monthly
   * renewals are not stored anywhere reachable, which is why none are listed rather than four being
   * invented.
   *
   * The on-demand refresh rows come from the consumer-scoped status route, whose `paidAt` exists
   * only when the immutable succeeded payment event exists. Browser confirmation time never enters
   * the durable ledger. `buildPaymentHistory` orders the subscription rows, then the evidence-backed
   * add-on rows are merged into the same timestamp order below.
   */
  const paymentHistory = buildPaymentHistory({
    fixture: enrollmentFixture,
    fixtureMonthlyAmount: monitoringPriceAmountLabel,
    refresh: enrollmentFixture && (refreshPending || refreshComplete)
      ? { chargedAt: refreshChargedAt, pending: refreshPending }
      : null,
    refreshAmount: refreshPriceAmountLabel,
    subscription: subscription
      ? {
          activatedAt: subscription.activatedAt,
          authorizedAt: subscription.authorizedAt,
          monthlyAmount: priceLabel(subscription.priceCents, 2),
        }
      : null,
  });
  if (!enrollmentFixture) {
    // Payment history is a ledger, so only immutable succeeded events belong in it. A queued or
    // completed request with no `paidAt` is not silently promoted to a charge, and a paid request
    // remains visible even if its analysis later fails or becomes unfulfillable.
    for (const refresh of paidRefreshes) {
      if (refresh.paidAt === null) continue;
      const at = Date.parse(refresh.paidAt);
      paymentHistory.push({
        amount: priceLabel(refresh.amountCents, 2),
        at,
        date: formatDurableDate(refresh.paidAt) ?? "—",
        item: "On-demand refresh",
        status: "Paid",
      });
    }
    paymentHistory.sort((left, right) => (right.at ?? -Infinity) - (left.at ?? -Infinity));
  }
  // The plan card's three claims, each derived from the subscription row or refused.
  const planPriceLabel = enrollmentFixture
    ? monitoringPriceLabel
    : subscription
      ? priceLabel(subscription.priceCents)
      : "—";
  const planStatusLabel = enrollmentFixture
    ? canceled ? "Canceled" : "Active"
    : enrollmentPending
      ? "Not shown"
      : subscription === null
        // True both before enrollment starts and part-way through it, where the enrollment row
        // exists and no card has been authorized against it yet. "Not enrolled" would be wrong for
        // the second, and the second is a state a real consumer sits in.
        ? "No subscription"
        : subscription.status === "active"
          ? "Active"
          : subscription.status === "cancelled"
            ? "Canceled"
            : subscription.status === "authorized"
              ? "Authorized"
              : "In review";
  const planStatusHealthy = enrollmentFixture ? !canceled : subscription?.status === "active";
  const planDetail = enrollmentFixture
    ? canceled ? "Canceled Jul 21 · no renewal" : "Renews Aug 20, 2026"
    : enrollmentPending
      ? ENROLLMENT_UNAVAILABLE_NOTICE
      : subscription === null
        ? SUBSCRIPTION_ABSENT_NOTICE
        : subscription.status === "cancelled"
          ? `Canceled ${durableDate(subscription.cancelledAt) ?? "on a date not recorded"} · no renewal`
          : subscription.status === "active"
            ? `Started ${durableDate(subscription.activatedAt) ?? "on a date not recorded"}. ${RENEWAL_DATE_UNAVAILABLE}`
            : `Card authorized ${durableDate(subscription.authorizedAt) ?? "on a date not recorded"}. No charge is made until enrollment succeeds.`;

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    const draft = {
      email: profileDraft.email.trim(),
      name: profileDraft.name.trim(),
      phone: profileDraft.phone.trim(),
    };
    if (!draft.name || !draft.email || profileSavePending) return;

    if (!profileDurable) {
      onUpdateProfile(draft);
      setProfileDraft(draft);
      setProfileSaveNotice(null);
      setEditingProfile(false);
      notify("Demo profile details updated for this session.");
      return;
    }

    setProfileSavePending(true);
    setProfileSaveNotice(null);
    const result = await updateConsumerProfile({
      email: draft.email,
      fullName: draft.name,
      phone: draft.phone,
    });
    setProfileSavePending(false);
    if (result === null) {
      setProfileSaveNotice({
        message: "The profile result could not be read back, so this draft is not shown as saved. Reload before trying again.",
        tone: "error",
      });
      notify("Profile changes could not be verified.");
      return;
    }

    // Apply the server's durable read-back, never the optimistic draft. In particular, the
    // identity provider can leave an email change pending or fail to start it while the profile
    // name and phone are already committed.
    onUpdateProfile(result.profile);
    setProfileDraft(result.profile);
    setEditingProfile(false);
    if (result.emailChange === "pending") {
      setProfileSaveNotice({
        message: `Profile saved. The email change to ${draft.email} is pending confirmation; this account still shows ${result.profile.email}.`,
        tone: "info",
      });
      notify("Profile saved; the email change is pending confirmation.");
    } else if (result.emailChange === "failed") {
      setProfileSaveNotice({
        message: `Profile saved, but the email change to ${draft.email} could not be started; this account still uses ${result.profile.email}.`,
        tone: "error",
      });
      notify("Profile saved, but the email change could not be started.");
    } else {
      setProfileSaveNotice({
        message: result.emailChange === "confirmed"
          ? "Profile saved and the email change is confirmed."
          : "Profile details saved.",
        tone: "success",
      });
      notify(result.emailChange === "confirmed"
        ? "Profile saved and email confirmed."
        : "Profile details saved.");
    }
  }

  async function openBillingPortal() {
    if (!billingPortalAvailable || billingPortalPending) {
      if (!billingPortalAvailable && !enrollmentPending) {
        setBillingPortalError(BILLING_PORTAL_UNAVAILABLE);
      }
      return;
    }
    setBillingPortalPending(true);
    setBillingPortalError("");
    try {
      const response = await fetch("/api/consumer/billing-portal", {
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      });
      const body: unknown = await response.json().catch(() => null);
      const record = typeof body === "object" && body !== null && !Array.isArray(body)
        ? body as Record<string, unknown>
        : null;
      const error = typeof record?.error === "object" && record.error !== null && !Array.isArray(record.error)
        ? record.error as Record<string, unknown>
        : null;
      const code = typeof error?.code === "string" ? error.code : null;
      let hostedUrl: string | null = null;
      if (response.ok && typeof record?.url === "string") {
        try {
          const parsed = new URL(record.url);
          hostedUrl = parsed.protocol === "https:" && !parsed.username && !parsed.password
            ? parsed.toString()
            : null;
        } catch {
          hostedUrl = null;
        }
      }
      if (hostedUrl === null) {
        const message = code === "billing_customer_unavailable"
          ? BILLING_PORTAL_UNAVAILABLE
          : code === "billing_provider_unconfigured"
            ? "Hosted billing is not configured for this workspace. Nothing was changed."
            : "The secure billing portal could not be opened right now. Nothing was changed.";
        setBillingPortalError(message);
        notify(message);
        return;
      }
      // The validated destination belongs to the hosted billing provider, not the Next.js router.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(hostedUrl);
    } catch {
      const message = "The secure billing portal could not be opened right now. Nothing was changed.";
      setBillingPortalError(message);
      notify(message);
    } finally {
      setBillingPortalPending(false);
    }
  }

  function savePayment(event: FormEvent) {
    event.preventDefault();
    const digits = cardDraft.replace(/\D/g, "");
    if (!/^4\d{15}$/.test(digits) || !/^\d{2}\/\d{2}$/.test(expiryDraft)) {
      setPaymentError("Enter a complete Visa demo card and expiry in MM/YY format.");
      return;
    }
    onUpdateCard(digits.slice(-4));
    setEditingPayment(false);
    setPaymentError("");
    notify("Payment method updated.");
  }

  return (
    <div>
      <ConsumerPageHeader eyebrow="Account" title="Account & Billing" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-5">
          <WorkspaceSection title="Profile">
            {/*
              The durable editor applies only the profile returned by PATCH
              `/api/consumer/profile`. This matters when the auth provider leaves an email change
              pending or rejects it: name and phone can be committed while the old email remains
              authoritative. The explicit fixture shell keeps its session-only editor and never
              calls the durable endpoint.
            */}
            {profileSaveNotice ? (
              <p
                className={cn(
                  "mb-4 rounded-[8px] px-3 py-3 text-xs leading-5",
                  profileSaveNotice.tone === "error"
                    ? "bg-[color-mix(in_srgb,var(--consumer-negative),transparent_92%)] text-[var(--consumer-negative)]"
                    : profileSaveNotice.tone === "success"
                      ? "bg-[color-mix(in_srgb,var(--consumer-positive),transparent_92%)] text-[var(--consumer-positive)]"
                      : "bg-[var(--consumer-accent-tint)] text-[var(--consumer-accent-ink)]",
                )}
                role={profileSaveNotice.tone === "error" ? "alert" : "status"}
              >
                {profileSaveNotice.message}
              </p>
            ) : null}
            {editingProfile ? (
              <form className="space-y-4" onSubmit={saveProfile}>
                <div><label className="text-xs font-semibold" htmlFor="settings-name">Full legal name</label><Input className="mt-2 min-h-11" disabled={profileSavePending} id="settings-name" onChange={(event) => setProfileDraft((current) => ({ ...current, name: event.target.value }))} required value={profileDraft.name} /></div>
                <div className="grid gap-4 sm:grid-cols-2"><div><label className="text-xs font-semibold" htmlFor="settings-email">Email</label><Input className="mt-2 min-h-11" disabled={profileSavePending} id="settings-email" onChange={(event) => setProfileDraft((current) => ({ ...current, email: event.target.value }))} required type="email" value={profileDraft.email} /></div><div><label className="text-xs font-semibold" htmlFor="settings-phone">Mobile phone (optional)</label><Input className="mt-2 min-h-11" disabled={profileSavePending} id="settings-phone" onChange={(event) => setProfileDraft((current) => ({ ...current, phone: event.target.value }))} type="tel" value={profileDraft.phone} /></div></div>
                <div className="flex justify-end gap-2"><Button className="min-h-11" disabled={profileSavePending} onClick={() => { setProfileDraft(profile); setEditingProfile(false); }} type="button" variant="ghost">Cancel</Button><Button className="min-h-11" disabled={profileSavePending} type="submit">{profileSavePending ? <><LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />Saving…</> : "Save profile"}</Button></div>
              </form>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center"><span className="grid size-11 place-items-center rounded-full bg-[var(--consumer-brand-tile)] text-xs font-semibold text-[var(--consumer-canvas)]">{profile.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{profile.name}</p><p className="mt-1 text-xs text-muted-foreground">{profileReadState === "ready" || !profileDurable ? `${profile.email} · ${profile.phone || "No phone recorded"}` : profileReadState === "loading" ? "Loading contact details…" : "Contact details could not be loaded."}</p></div><Button className="min-h-11" disabled={profileDurable && profileReadState !== "ready"} onClick={() => { setProfileDraft(profile); setEditingProfile(true); }} size="sm" variant="outline">{profileReadState === "loading" ? "Loading profile" : "Edit profile"}</Button></div>
            )}
          </WorkspaceSection>
          <WorkspaceSection
            title="Payment history"
            trailing={!enrollmentFixture ? (
              <Button
                className="min-h-11"
                disabled={!billingPortalAvailable || billingPortalPending}
                onClick={() => { void openBillingPortal(); }}
                size="sm"
                title={!billingPortalAvailable && !enrollmentPending ? BILLING_PORTAL_UNAVAILABLE : undefined}
                variant="outline"
              >
                {billingPortalPending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
                Manage billing &amp; invoices
              </Button>
            ) : undefined}
          >
            {/* An empty ledger is not the same fact as an unreadable one, and neither may render as
                a table with no rows under a healthy heading. The pending arm names the read that
                failed; the empty arm says plainly that nothing has been charged. */}
            {paymentHistory.length === 0 ? (
              <p className="rounded-[10px] bg-[var(--consumer-canvas)] p-4 text-sm leading-6 text-muted-foreground" role="status">
                — {enrollmentPending ? ENROLLMENT_UNAVAILABLE_NOTICE : PAYMENT_HISTORY_ABSENT_NOTICE}
              </p>
            ) : (
            <>
            <div className="hidden overflow-x-auto sm:block" tabIndex={0}><table className="w-full min-w-[32rem] text-sm"><caption className="sr-only">Subscription and add-on payment history</caption><thead className="border-b border-[var(--consumer-border)] text-left text-[0.68rem] text-muted-foreground"><tr><th className="pb-3 font-medium" scope="col">Date</th><th className="pb-3 font-medium" scope="col">Item</th><th className="pb-3 text-right font-medium" scope="col">Amount</th><th className="pb-3 text-right font-medium" scope="col">Status</th></tr></thead><tbody>{paymentHistory.map(({ amount, date, item, status }, index) => <tr className="border-b border-[var(--consumer-border)] last:border-0" key={`${date}-${item}-${amount}-${index}`}><td className="py-3 text-xs text-muted-foreground">{date}</td><td className="py-3">{item}</td><td className="py-3 text-right font-semibold tabular-nums">{amount}</td><td className="py-3 text-right"><StatusTag icon={status === "Paid" ? undefined : false} tone={status === "Paid" ? "success" : "neutral"}>{status}</StatusTag></td></tr>)}</tbody></table></div>
            <div className="divide-y divide-[var(--consumer-border)] sm:hidden">{paymentHistory.map(({ amount, date, item, status }, index) => <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0" key={`${date}-${item}-${amount}-${index}`}><div className="min-w-0 flex-1"><p className="text-sm font-medium">{item}</p><p className="mt-1 text-xs text-muted-foreground">{date}</p></div><div className="text-right"><p className="text-sm font-semibold tabular-nums">{amount}</p><StatusTag icon={status === "Paid" ? undefined : false} tone={status === "Paid" ? "success" : "neutral"}>{status}</StatusTag></div></div>)}</div>
            </>
            )}
            {paidRefreshHistoryUnavailable && !enrollmentFixture ? (
              <p className="mt-4 text-xs leading-5 text-muted-foreground" role="status">On-demand refresh payment history is temporarily unavailable. No browser-session charge is shown in its place.</p>
            ) : null}
            {billingPortalError && !enrollmentFixture ? (
              <p className="mt-4 text-xs leading-5 text-[var(--consumer-negative)]" role="alert">{billingPortalError}</p>
            ) : !enrollmentFixture && !enrollmentPending && subscription === null ? (
              <p className="mt-4 text-xs leading-5 text-muted-foreground" role="status">{BILLING_PORTAL_UNAVAILABLE}</p>
            ) : null}
          </WorkspaceSection>
          <WorkspaceSection
            description="Each permission controls one thing. You will see exactly what changes before you revoke either one."
            title="Data permissions"
          >
            <div className="divide-y divide-[var(--consumer-border)]">
              {[
                { kind: "analysis" as const, name: "Readiness analysis", active: shownAnalysisActive, label: analysisLabel, detail: analysisLabel === "Not shown" ? ENROLLMENT_UNAVAILABLE_NOTICE : analysisLabel === "Not authorized" ? CONSENT_ABSENT_DETAIL : cancelledEnrollment ? "Kept as a record of what was authorized. Recurring soft pulls stopped with the subscription." : "Controls recurring source review and derived readiness outputs." },
                { kind: "monitoring" as const, name: "Credit monitoring", active: shownMonitoringActive, label: monitoringLabel, detail: monitoringLabel === "Not shown" ? ENROLLMENT_UNAVAILABLE_NOTICE : monitoringLabel === "Not authorized" ? CONSENT_ABSENT_DETAIL : cancelledEnrollment ? "Kept as a record of what was authorized. The SecureView widget closed with the subscription." : "Controls the display-only SecureView monitoring connection." },
              ].map((permission) => (
                <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center" key={permission.kind}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><p className="text-sm font-semibold">{permission.name}</p><StatusTag icon={permission.active ? undefined : <LockKeyhole aria-hidden className="size-3" />} tone={permission.active ? "success" : "neutral"}>{permission.label}</StatusTag></div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{permission.detail}</p>
                  </div>
                  {/* A revoked permission has durable prior evidence and can collect a new signed
                      grant. "Not authorized" has no prior grant, while Retained belongs to a
                      cancelled enrollment, so neither state can enter reauthorization. */}
                  <Button
                    className="min-h-11"
                    disabled={
                      enrollmentPending ||
                      (permission.label === "Revoked"
                        ? enrollment === null || cancelledEnrollment
                        : !permission.active)
                    }
                    onClick={() => permission.label === "Revoked"
                      ? onReauthorize(permission.kind)
                      : onRevoke(permission.kind)}
                    size="sm"
                    variant="outline"
                  >
                    {permission.label === "Revoked" ? "Re-authorize" : "Revoke"}
                  </Button>
                </div>
              ))}
            </div>
            {enrollmentPending ? <p className="mt-4 text-xs leading-5 text-muted-foreground" role="status">{ENROLLMENT_UNAVAILABLE_NOTICE}</p> : null}
          </WorkspaceSection>
          {profileDurable ? <ConsumerPrivacyRequests /> : null}
        </div>
        <div className="space-y-5">
          <WorkspaceSection title="Plus plan">
            <div className="flex items-center justify-between gap-4"><div><p className="text-2xl font-semibold tabular-nums">{planPriceLabel}<span className="text-sm font-normal text-muted-foreground"> / month</span></p><p className="mt-1 text-xs leading-5 text-muted-foreground">{planDetail}</p></div><StatusTag icon={planStatusHealthy ? undefined : false} tone={planStatusHealthy ? "success" : "neutral"}>{planStatusLabel}</StatusTag></div>
            {/*
              The card on file. Migration 022 stores `payment_method_ref` and no brand or last4
              column, so a durable session can be told that a card exists and cannot be told which
              one — "Visa ending 4242" was a module literal shown to every consumer including those
              who had never authorized a card at all. Editing stays outside this application: the
              authenticated portal route scopes the provider customer to this consumer and returns
              the provider-hosted session where cards and invoices are actually managed.
            */}
            {!enrollmentFixture ? (
              <div className="mt-5 border-t border-[var(--consumer-border)] pt-4">
                <p className="text-xs text-muted-foreground">Payment method</p>
                <div className="mt-2 flex items-center gap-3">
                  <WalletCards aria-hidden className="size-4" />
                  <span className="text-sm font-medium">—</span>
                  <Button
                    className="ml-auto min-h-11"
                    disabled={!billingPortalAvailable || billingPortalPending}
                    onClick={() => { void openBillingPortal(); }}
                    size="sm"
                    title={!billingPortalAvailable && !enrollmentPending ? BILLING_PORTAL_UNAVAILABLE : undefined}
                    variant="ghost"
                  >
                    {billingPortalPending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
                    Edit
                  </Button>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {enrollmentPending
                    ? ENROLLMENT_UNAVAILABLE_NOTICE
                    : subscription?.paymentMethodOnFile
                      ? PAYMENT_METHOD_DETAIL_UNAVAILABLE
                      : PAYMENT_METHOD_ABSENT_NOTICE}
                </p>
              </div>
            ) : (
            <div className="mt-5 border-t border-[var(--consumer-border)] pt-4"><p className="text-xs text-muted-foreground">Payment method</p>{editingPayment ? <form className="mt-3 space-y-3" onSubmit={savePayment}><div><label className="text-xs font-semibold" htmlFor="settings-card">New demo card</label><Input className="mt-2 min-h-11 tabular-nums" id="settings-card" inputMode="numeric" onChange={(event) => setCardDraft(event.target.value)} placeholder={`Current card ends ${cardLast4}`} value={cardDraft} /></div><div><label className="text-xs font-semibold" htmlFor="settings-expiry">Expiry</label><Input className="mt-2 min-h-11 tabular-nums" id="settings-expiry" onChange={(event) => setExpiryDraft(event.target.value)} value={expiryDraft} /></div>{paymentError ? <p className="text-xs text-[var(--consumer-negative)]" role="alert">{paymentError}</p> : null}<div className="flex justify-end gap-2"><Button className="min-h-11" onClick={() => { setCardDraft(""); setPaymentError(""); setEditingPayment(false); }} size="sm" type="button" variant="ghost">Cancel</Button><Button className="min-h-11" size="sm" type="submit">Save card</Button></div></form> : <div className="mt-2 flex items-center gap-3"><WalletCards aria-hidden className="size-4" /><span className="text-sm font-medium">Visa ending {cardLast4}</span><Button className="ml-auto min-h-11" onClick={() => { setCardDraft(""); setPaymentError(""); setEditingPayment(true); }} size="sm" variant="ghost">Edit</Button></div>}</div>
            )}
          </WorkspaceSection>
          <WorkspaceSection className={cn(!canceled && "border-[color-mix(in_srgb,var(--consumer-negative),transparent_68%)]")} title="Subscription controls">
            <p className="text-xs leading-5 text-muted-foreground">{canceled ? "Monitoring and recurring analysis stopped immediately. Derived outputs are scheduled for deletion within 30 days." : "Cancellation stops pulls and monitoring immediately, prevents renewal, and schedules derived outputs for deletion within 30 days."}</p>
            {enrollmentPending ? <p className="mt-3 text-xs leading-5 text-muted-foreground" role="status">{ENROLLMENT_UNAVAILABLE_NOTICE}</p> : null}
            {/* Nothing to cancel is its own state. With no subscription row the control has no
                target, and an enabled destructive button that opens a confirmation dialog over an
                account that was never billed is the same false claim the panels above carried. */}
            {billingDurable && subscription === null ? <p className="mt-3 text-xs leading-5 text-muted-foreground" role="status">{SUBSCRIPTION_ABSENT_NOTICE}</p> : null}
            <Button className="mt-4 min-h-11 w-full" disabled={canceled || enrollmentPending || (billingDurable && subscription === null)} onClick={onCancel} variant="destructive">{canceled ? "Subscription canceled" : "Cancel subscription"}</Button>
          </WorkspaceSection>
        </div>
      </div>
    </div>
  );
}

/**
 * Enrollment-to-workspace handoff.
 *
 * The interstitial after enrollment is no longer a separate screen that hard-
 * cuts to the Overview: it renders as an opaque overlay above the already-
 * mounted workspace, its status lines resolve one by one (every line is a fact
 * that is already true — nothing spins forever), and then the card itself
 * inherits the Overview hero's box through a shared `layoutId`, so the viewer
 * perceives one object shrinking and settling into place while the rest of the
 * Overview staggers in beneath it. Phases:
 *
 *   idle → staged (overlay up, workspace warming beneath, tracker read in
 *   flight) → landing (overlay dissolves, hero mounts with the shared
 *   layoutId and travels) → revealing (surrounding blocks stagger in) → idle.
 *
 * The landing waits for both the resolved status lines and a mounted hero
 * target; a failsafe timer dissolves the overlay without the travel if the
 * tracker read never produces a hero. Reduced motion collapses the whole
 * sequence to an instant swap.
 */
const HANDOFF_EASE = [0.22, 1, 0.36, 1] as const;
const HANDOFF_EASE_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";
const HANDOFF_TRAVEL_MS = 380;
/** Marks the card that owns the shared box, so the landing can measure it. */
const HANDOFF_CARD_ATTR = "data-mf-handoff-card";

interface HandoffRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

type HandoffPhase = "idle" | "staged" | "landing" | "revealing";

interface EnrollmentHandoff {
  phase: HandoffPhase;
  /** The interstitial card's last box, measured the frame before it unmounts. */
  fromRect: HandoffRect | null;
  onHeroReady: () => void;
  onHeroLanded: () => void;
}

const IDLE_HANDOFF: EnrollmentHandoff = {
  fromRect: null,
  onHeroLanded: () => {},
  onHeroReady: () => {},
  phase: "idle",
};

const EnrollmentHandoffContext = createContext<EnrollmentHandoff>(IDLE_HANDOFF);

/**
 * The shared-element travel, as an explicit FLIP rather than a `layoutId` pair.
 *
 * `layoutId` was the first implementation and it measurably did not animate:
 * the interstitial lives in an `AnimatePresence` subtree and the hero mounts
 * inside the shell on the same commit, and sampling the card's box every
 * animation frame showed exactly two states — a hard jump from the overlay's
 * box to the hero's with no interpolated frame between them. So the landing
 * measures the outgoing card itself and drives the incoming one from that box
 * with the Web Animations API, which is deterministic and verifiable by the
 * same per-frame sampling.
 *
 * Only the vertical offset and the height are animated. The two boxes share a
 * column, so their widths already match, and scaling a card full of financial
 * figures to fake a size change would distort the type — the height closes
 * with a real height animation under `overflow: hidden` instead.
 */
function useHandoffLanding(
  active: boolean,
  fromRect: HandoffRect | null,
  onLanded: () => void,
): (node: HTMLElement | null) => void {
  const landed = useRef(false);
  return useCallback((node: HTMLElement | null) => {
    if (!node || landed.current) return;
    if (!active || !fromRect) return;
    landed.current = true;
    const to = node.getBoundingClientRect();
    const dy = Math.round(fromRect.y - to.y);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || (Math.abs(dy) < 2 && Math.abs(fromRect.height - to.height) < 2)) {
      onLanded();
      return;
    }
    const animation = node.animate(
      [
        { height: `${Math.round(fromRect.height)}px`, transform: `translateY(${dy}px)` },
        { height: `${Math.round(to.height)}px`, transform: "translateY(0px)" },
      ],
      { duration: HANDOFF_TRAVEL_MS, easing: HANDOFF_EASE_CSS, fill: "backwards" },
    );
    const finish = () => onLanded();
    animation.addEventListener("finish", finish, { once: true });
    animation.addEventListener("cancel", finish, { once: true });
  }, [active, fromRect, onLanded]);
}

/**
 * Crossfades its children when `id` changes — the moment the hero flips from
 * "awaiting" to a verified readiness value without a reload. Inert on first
 * mount so ordinary visits never replay an entrance.
 */
function FadeSwap({ as = "span", children, className, id }: { as?: "div" | "span"; children: ReactNode; className?: string; id: string }) {
  const reduceMotion = useReducedMotion();
  // The id this instance first rendered with: only a *change* away from it
  // animates, so ordinary visits never replay an entrance.
  const [initialId] = useState(id);
  const Tag = as === "div" ? motion.div : motion.span;
  return (
    <Tag
      animate={{ opacity: 1, y: 0 }}
      className={cn(as === "span" && "block", className)}
      initial={id !== initialId && !reduceMotion ? { opacity: 0, y: 6 } : false}
      key={id}
      transition={{ duration: 0.24, ease: HANDOFF_EASE }}
    >
      {children}
    </Tag>
  );
}

/**
 * Holds one Overview block invisible while the enrollment overlay covers the
 * surface, then resolves it top-to-bottom once the hero lands. Renders a plain
 * div outside the handoff so ordinary visits carry zero animation state.
 */
function HandoffReveal({ children, className, order }: { children: ReactNode; className?: string; order: number }) {
  const handoff = useContext(EnrollmentHandoffContext);
  const reduceMotion = useReducedMotion();
  if (handoff.phase === "idle") return <div className={className}>{children}</div>;
  const visible = handoff.phase === "revealing";
  return (
    <motion.div
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: reduceMotion ? 0 : 10 }}
      className={className}
      initial={false}
      transition={reduceMotion ? { duration: 0 } : { delay: visible ? 0.05 * order : 0, duration: 0.26, ease: HANDOFF_EASE }}
    >
      {children}
    </motion.div>
  );
}

interface HandoffRow {
  detail?: string;
  label: string;
  resolvedStatus: string;
}

/**
 * Every line resolves, on a fixed stagger, to a state that is already true at
 * enrollment completion. The durable rows stop at "Queued" for the readiness
 * analysis because the real source review drains in the background over
 * minutes — the landed hero carries that wait as a live status instead of this
 * screen pretending it finished.
 */
const DURABLE_HANDOFF_ROWS: readonly HandoffRow[] = [
  { detail: "Identity, payment, and named permissions recorded", label: "Enrollment verified", resolvedStatus: "Complete" },
  { label: "Readiness analysis", resolvedStatus: "Queued" },
  { detail: "Readiness, plan, and the next credit refresh become available together", label: "Open verified workspace", resolvedStatus: "Complete" },
];

const FIXTURE_HANDOFF_ROWS: readonly HandoffRow[] = [
  { detail: "Identity, payment, and named permissions recorded", label: "Enrollment verified", resolvedStatus: "Complete" },
  { detail: "Ordering your first actions from the sources you authorized", label: "Reviewing authorized sources", resolvedStatus: "Complete" },
  { detail: "Readiness, plan, and the next credit refresh become available together", label: "Open verified workspace", resolvedStatus: "Complete" },
];

function AnalysisQueuedView({
  durable,
  onSettled,
  profileName,
}: {
  durable: boolean;
  onSettled: () => void;
  profileName: string;
}) {
  const reduceMotion = useReducedMotion();
  const rows = durable ? DURABLE_HANDOFF_ROWS : FIXTURE_HANDOFF_ROWS;
  const [resolvedCount, setResolvedCount] = useState(() => (reduceMotion ? rows.length : 0));
  const choreographed = useRef(false);
  const settled = useRef(false);

  useEffect(() => {
    if (choreographed.current) return;
    choreographed.current = true;
    const fireSettled = () => {
      if (settled.current) return;
      settled.current = true;
      onSettled();
    };
    const timers: number[] = [];
    if (reduceMotion) {
      // resolvedCount already initialized to rows.length for reduced motion.
      timers.push(window.setTimeout(fireSettled, 280));
    } else {
      rows.forEach((_, index) => {
        timers.push(window.setTimeout(() => setResolvedCount(index + 1), 260 + index * 120));
      });
      timers.push(window.setTimeout(fireSettled, 260 + rows.length * 120 + 420));
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [onSettled, reduceMotion, rows]);

  useEffect(() => {
    document.getElementById("mf-analysis-queued-heading")?.focus({ preventScroll: true });
  }, []);

  return (
    /*
     * The overlay covers the content column only: the shell's sidebar stays
     * visible and keeps its own identity, so the workspace is already present
     * around the card rather than replaced by a second full-screen chrome.
     * That is what lets the landing read as one object settling into a frame
     * the viewer can already see. The insets mirror ConsumerShell's own
     * `<main>` offsets (17rem sidebar at lg; no header bar at any width since
     * #167 closed) — they must move together.
     */
    <motion.div
      animate={{ opacity: 1 }}
      aria-labelledby="mf-analysis-queued-heading"
      aria-modal="true"
      className="fixed bottom-0 left-0 right-0 top-[var(--demo-banner-height)] z-40 overflow-y-auto bg-[var(--consumer-canvas)] px-4 py-5 text-foreground sm:px-6 sm:py-7 lg:left-[17rem] xl:px-8 xl:py-8"
      data-demo-theme="consumer"
      exit={{ opacity: 0, transition: { duration: 0.22, ease: HANDOFF_EASE } }}
      initial={false}
      role="dialog"
    >
      <div className="mx-auto w-full max-w-[86rem]">
        <section {...{ [HANDOFF_CARD_ATTR]: "" }} className="overflow-hidden rounded-[14px] border border-[var(--consumer-surface-border)] bg-card shadow-[var(--consumer-surface-shadow)]">
          <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
            <div className="p-6 sm:p-9 lg:p-11">
              <StatusTag tone="info">Analysis queued</StatusTag>
              <h1 className="mt-5 max-w-[18ch] text-3xl font-semibold leading-[1.08] tracking-[-0.045em] outline-none sm:text-4xl" id="mf-analysis-queued-heading" tabIndex={-1}>We’re building your first verified plan, {profileName.split(" ")[0]}.</h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">{durable
                ? "Your authorizations and identity check are complete. Your readiness and plan appear as soon as the first source review finishes."
                : "Your authorizations and identity check are complete. Your readiness and plan appear as soon as the first simulated source review finishes."}</p>

              <div aria-live="polite" className="mt-8 space-y-1 border-y border-[var(--consumer-border)] py-3">
                {rows.map((row, index) => {
                  const resolved = index < resolvedCount;
                  return (
                    <div className="flex min-h-12 items-center gap-3" key={row.label}>
                      <motion.span
                        animate={resolved && !reduceMotion ? { scale: [0.72, 1] } : undefined}
                        className="grid place-items-center"
                        transition={{ duration: 0.22, ease: HANDOFF_EASE }}
                      >
                        <StateMarker size="sm" state={resolved ? "verified" : "locked"} />
                      </motion.span>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm font-medium transition-colors duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]", !resolved && "text-muted-foreground")}>{row.label}</p>
                        {row.detail ? <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p> : null}
                      </div>
                      <span className={cn("text-xs font-medium", resolved ? (row.resolvedStatus === "Queued" ? "text-[var(--consumer-accent-ink)]" : "text-[var(--consumer-positive)]") : "text-muted-foreground")}>
                        {resolved ? row.resolvedStatus : "Pending"}
                      </span>
                    </div>
                  );
                })}
              </div>

              {durable ? null : (
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <SourceStamp>Simulated · no real sources were checked</SourceStamp>
                </div>
              )}
            </div>
            <div className="border-t border-[var(--consumer-border)] bg-[var(--consumer-hero)] p-6 text-[var(--consumer-hero-ink)] sm:p-9 lg:border-l lg:border-t-0 lg:p-10">
              <ShieldCheck aria-hidden className="size-7 text-[var(--consumer-muted)]" />
              <p className="mt-7 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[var(--consumer-muted)]">Setup receipt</p>
              <h2 className="mt-3 text-xl font-semibold tracking-[-0.03em]">Nothing is inferred before the source review.</h2>
              <dl className="mt-7 divide-y divide-[var(--consumer-border)] text-sm">
                <div className="flex items-center justify-between gap-4 py-3"><dt className="text-[var(--consumer-muted)]">Identity</dt><dd className="font-medium">Verified</dd></div>
                <div className="flex items-center justify-between gap-4 py-3"><dt className="text-[var(--consumer-muted)]">Monitoring</dt><dd className="font-medium">Authorized</dd></div>
                <div className="flex items-center justify-between gap-4 py-3"><dt className="text-[var(--consumer-muted)]">Readiness analysis</dt><dd className="font-medium">Queued</dd></div>
                <div className="flex items-center justify-between gap-4 py-3"><dt className="text-[var(--consumer-muted)]">Verified readiness</dt><dd className="font-medium">Pending</dd></div>
              </dl>
            </div>
          </div>
        </section>
      </div>
    </motion.div>
  );
}

export function ConsumerSurface({
  applicationContext,
  onOpenProfiles,
  onProfileIdentityChange,
  paidRefreshEnabled = false,
  realAuth = false,
  referralsEnabled = false,
  sessionIdentity,
  teamChat,
  timelineEnabled = false,
}: SurfaceProps & {
  /**
   * Required, and that is the fix. It defaulted to `{ clientId: "c5",
   * readiness: 62 }` — one fixture client's id and one fixture client's
   * readiness score — so a caller that forgot to resolve the real context got a
   * silently wrong account instead of an error. Both callers pass it today, so
   * dropping the default costs nothing and makes the omission a type error.
   */
  applicationContext: ConsumerApplicationContext;
  onProfileIdentityChange?: (identity: { initials: string; name: string }) => void;
  paidRefreshEnabled?: boolean;
  /**
   * Server-side only, so it arrives as a plain prop the way the operator route
   * passes its own (D-55). The one thing it decides here is whether the shell
   * offers sign-out, because `/api/auth/sign-out` 404s when the flag is off and
   * an offered control that answers 404 is worse than no control at all.
   */
  realAuth?: boolean;
  referralsEnabled?: boolean;
  sessionIdentity?: SessionDisplayIdentity;
  /**
   * The consumer's team chat, read on the server so the Team Chat view paints with its messages
   * rather than chaining three requests after mount (F-01). Optional because `demo-app.tsx` mounts
   * this surface with no server read at all, and that absence is the fixture shell's own case —
   * see `ConsumerTeamChatProps` for the three meanings.
   */
  teamChat?: ConsumerTeamChatSnapshot | null;
  /**
   * `FEATURE_TIMELINE`. Resolved on the server and passed down, like the two flags above it.
   * Off is the shipped Team Chat thread, unchanged.
   */
  timelineEnabled?: boolean;
}) {
  /**
   * The brand a consumer sees is their own operator's, and a consumer profile's
   * `org_id` points at exactly that operator, so the same self-read the operator
   * shell uses gives the right answer here. Absent identity means the fixture
   * shell (flags off, or the read failed), where the fixture operator is the
   * correct thing to show — white-label is the product promise, so rendering
   * another operator's name to a signed-in client is the defect this closes.
   */
  const operatorName = sessionIdentity?.orgName ?? "Apex Funding Partners";
  /**
   * Is this a signed-in consumer's own record, or the fixture shell?
   *
   * `displayName` is set by exactly one caller — `resolveConsumerApplicationContext`
   * fills it from the tracker client under real auth — and `DemoApp` builds its
   * context from the fixture roster and leaves it unset; `ConsumerApplicationContext`
   * in `src/lib/demo/types.ts` documents that split and the surface already relies on
   * it to greet a signed-in consumer by their own name. Reusing it here asks the same
   * question without a second fetch and without a loading state to flicker through.
   *
   * What it decides: which controls may still write to component state alone. On the
   * fixture shell that is the disclosed simulation the environment bar describes
   * ("changes reset on reload"). On a durable workspace the same write is a claim
   * about somebody's account that nothing keeps, so those controls are disabled with
   * their reason instead.
   */
  const durableWorkspace = applicationContext.displayName !== undefined;
  const selectedClient = DEMO_CLIENTS.find(
    (client) => client.clientId === applicationContext.clientId,
  );
  const clientStage = selectedClient?.stage ?? "Optimization";
  /**
   * The stage the Trainings guide marks as current.
   *
   * `stage` is being added to `ConsumerApplicationContext` by the parallel
   * consumer/application-context lane, which resolves it from the tracker row the
   * consumer already reads. This branch predates that merge, so the field is read
   * defensively rather than typed: when it is there and the workspace is durable it
   * wins, and otherwise the fixture roster's stage stands in for the walkthrough.
   */
  const durableStage = (applicationContext as { stage?: TrackerStage }).stage;
  const trainingsStage: TrackerStage =
    (durableWorkspace ? durableStage : undefined) ??
    trackerStageFromLabel(clientStage) ??
    "onboarding";
  /**
   * The business named beside the account holder in the identity chip.
   *
   * The roster lookup above is keyed on demo client ids, which a durable uuid
   * never matches, so `selectedClient` is always undefined for a signed-in
   * consumer and the old `?? DEMO_ROLES.consumer.organization` fallback labelled
   * every real client with the fixture persona's company — the same shape of
   * defect the profile fallback beneath it already documents. So the durable
   * branch reads the tracker row's own business, and when that row carries none
   * it names the operator whose workspace this is (already on screen beside it)
   * rather than borrowing a fixture's.
   */
  const profileOrganization = durableWorkspace
    ? applicationContext.businessName ?? operatorName
    : selectedClient?.business ?? DEMO_ROLES.consumer.organization;
  const { matchesUnlocked: sessionMatchesUnlocked } = useFeedbackSession();
  const [activeView, setActiveView] = useState<ViewId>(
    applicationContext.entryView === "matches" ||
      applicationContext.readiness >= READY_PROFILE_COMPLETION
      ? "matches"
      : "dashboard",
  );
  const [reported, setReported] = useState<Set<number>>(new Set());
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [refreshPending, setRefreshPending] = useState(false);
  const [refreshSubmitting, setRefreshSubmitting] = useState(false);
  const [refreshResumeAvailable, setRefreshResumeAvailable] = useState(false);
  const [refreshComplete, setRefreshComplete] = useState(false);
  // Fixture-only. Durable charges are dated exclusively by the immutable payment event readback.
  const [refreshChargedAt, setRefreshChargedAt] = useState<string | null>(null);
  const [monitoringReading, setMonitoringReading] = useState<MonitoringReading | null>(null);
  const [monitoringReadState, setMonitoringReadState] = useState<MonitoringSurfaceState>(
    durableWorkspace ? "loading" : "fixture",
  );
  const [monitoringNextRefreshAt, setMonitoringNextRefreshAt] = useState<string | null>(null);
  const [refreshRunning, setRefreshRunning] = useState(false);
  const [paidRefreshes, setPaidRefreshes] = useState<readonly ConsumerPaidRefreshRecord[]>([]);
  const [paidRefreshReadState, setPaidRefreshReadState] = useState<"idle" | "loading" | "ready" | "unavailable">(
    durableWorkspace ? "loading" : "idle",
  );
  const [pricingCatalog, setPricingCatalog] = useState<ConsumerPricingCatalog | null>(null);
  const [pricingState, setPricingState] = useState<"idle" | "loading" | "ready" | "unavailable">(
    paidRefreshEnabled ? "loading" : "idle",
  );
  const [cancelOpen, setCancelOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<Consent | null>(null);
  const [reauthorizeTarget, setReauthorizeTarget] = useState<Consent | null>(null);
  const [reauthorizeAccepted, setReauthorizeAccepted] = useState(false);
  const [reauthorizeSignature, setReauthorizeSignature] = useState("");
  const [reauthorizePending, setReauthorizePending] = useState(false);
  const reauthorizeDraft = useRef<string | null>(null);
  const [monitoringActive, setMonitoringActive] = useState(true);
  const [analysisActive, setAnalysisActive] = useState(true);
  // The enrollment handoff's state machine — see the note above
  // AnalysisQueuedView. `token` keys the shared layoutId so a later Overview
  // visit can never pair against a stale interstitial box.
  const [handoff, setHandoff] = useState<{
    phase: HandoffPhase;
    fromRect: HandoffRect | null;
    heroReady: boolean;
    rowsSettled: boolean;
    token: number;
  }>({ fromRect: null, heroReady: false, phase: "idle", rowsSettled: false, token: 0 });
  const [canceled, setCanceled] = useState(false);
  const [readNotifications, setReadNotifications] = useState<Set<string>>(new Set());
  const [liveNotifications, setLiveNotifications] = useState<NotificationEventV2[]>([]);
  const [liveNotificationsError, setLiveNotificationsError] = useState(false);
  /**
   * Consecutive failed reads, kept beside the boolean rather than derived from it: Retry clears the
   * error so the view can go back to loading, but the tally has to survive that so a second failure
   * knows it is the second one.
   */
  const [liveNotificationsFailures, setLiveNotificationsFailures] = useState(0);
  const [liveNotificationsWindow, setLiveNotificationsWindow] = useState(NOTIFICATION_WINDOW_DAYS);
  const [liveNotificationsCapped, setLiveNotificationsCapped] = useState(false);
  const [liveNotificationsSources, setLiveNotificationsSources] = useState<NotificationEventType[]>([]);
  /**
   * The last unread count a successful read produced.
   *
   * R2 B28: while the read is in flight or failing the true count is unknown, and rendering an
   * unknown count as "0" tells the consumer their inbox is clear when nobody knows that. The badge
   * holds the last number it was actually told until a read replaces it.
   */
  const [lastKnownUnread, setLastKnownUnread] = useState(0);
  const [notificationsReloadToken, setNotificationsReloadToken] = useState(0);
  const notificationsRequestSequence = useRef(0);
  const [ancillaryState, setAncillaryState] = useState<BootstrapState>("loading");
  const [ancillaryConfig, setAncillaryConfig] = useState<AncillaryConfig | null>(null);
  const [ancillaryReloadToken, setAncillaryReloadToken] = useState(0);
  const [portalPreferences, setPortalPreferences] = useState<WorkspacePreferences | null>(null);
  const [portalPreferencesState, setPortalPreferencesState] = useState<PortalPreferencesReadState>(
    durableWorkspace ? "loading" : "fixture",
  );
  const [portalPreferencesReloadToken, setPortalPreferencesReloadToken] = useState(0);
  const [consumerApplicationsState, setConsumerApplicationsState] = useState<ConsumerApplicationsSurfaceState>(
    durableWorkspace ? { status: "loading" } : { applications: [], status: "ready" },
  );
  const [consumerApplicationsReloadToken, setConsumerApplicationsReloadToken] = useState(0);
  /**
   * The result of the last lesson read, or `null` while one is in flight.
   *
   * A discriminated result rather than a status string, so a failed read cannot be
   * confused with a successful read of zero rows: `{ ok: false }` renders the error box,
   * `{ ok: true, rows: [] }` renders the empty state. `trainingsStatus` below is derived
   * from it and from the flag, which keeps the effect free of a synchronous setState.
   */
  const [trainingsRead, setTrainingsRead] =
    useState<{ ok: true; rows: TrainingLesson[] } | { ok: false } | null>(null);
  const [trainingsReloadToken, setTrainingsReloadToken] = useState(0);
  const trainingsEnabled = ancillaryConfig?.enabled === true;
  const portalPreferencesReady = portalPreferencesState === "ready" && portalPreferences !== null;
  // Fixtures have no operator workspace preference record, so they keep the
  // walkthrough exactly as it was. Durable consumers are fail-closed until the
  // signed-in workspace read succeeds.
  const trainingsVisible = !durableWorkspace
    || (portalPreferencesReady && portalPreferences.portal.showTrainings);
  const documentUploadsAllowed = !durableWorkspace
    || (portalPreferencesReady && portalPreferences.portal.allowDocumentUploads);
  const showFundingProgress = !durableWorkspace
    || (portalPreferencesReady && portalPreferences.portal.showFundingProgress);
  const applicationVisibility: PortalApplicationVisibility | null = durableWorkspace
    ? portalPreferencesReady ? portalPreferences.portal.applicationVisibility : null
    : null;
  /**
   * The fixture walkthrough opens with the monitoring terms already signed —
   * that is the state its Settings revoke control acts on. A signed-in consumer
   * has no such prior: this flag used to start `true` for them too, so the
   * Agreement record printed "Signed Jul 21 · Approved" over an enrollment that
   * carried no monitoring signature at all. Off by default on a durable
   * workspace, so the row falls to the record and to the existing
   * signature-needed notice.
   */
  const [termsSigned, setTermsSigned] = useState(!durableWorkspace);
  const [uploadingCategory, setUploadingCategory] =
    useState<DocumentCategory | null>(null);
  const [uploadedFiles, setUploadedFiles] =
    useState<Record<DocumentCategory, string[]>>(emptyDocumentUploads);
  const [toast, setToast] = useState("");
  const [enrollmentDraft, setEnrollmentDraft] = useState<OnboardingDraft | null>(null);
  const [enrollState, setEnrollState] = useState<BootstrapState>("loading");
  const [enroll, setEnroll] = useState<EnrollConfig | null>(null);
  const [enrollReloadToken, setEnrollReloadToken] = useState(0);
  const [enrollmentView, setEnrollmentView] = useState<EnrollmentView | null>(null);
  // Identity comes from the shared roster so an operator preview of any client
  // opens with that client's real contact details, not a blank profile.
  // Durable identity first: under real auth the context carries the tracker
  // client's display name, and the roster lookup below it is keyed on demo
  // client ids that a durable uuid never matches — which is how a signed-in
  // consumer ended up greeted as "Client" over another person's fixtures.
  const [profile, setProfile] = useState<ConsumerProfile>(() =>
    applicationContext.displayName
      ? {
          email: "",
          name: applicationContext.displayName,
          phone: "",
        }
      : selectedClient
        ? {
            email: selectedClient.email,
            name: selectedClient.name,
            phone: selectedClient.phone,
          }
        : {
            email: "",
            name: "Client",
            phone: "",
          },
  );
  const [profileReadState, setProfileReadState] = useState<"loading" | "ready" | "unavailable">(
    durableWorkspace ? "loading" : "ready",
  );
  useEffect(() => {
    if (!durableWorkspace) return;
    let active = true;
    void readConsumerProfile().then((result) => {
      if (!active) return;
      if (result.status === "ready") {
        setProfile(result.profile);
        setProfileReadState("ready");
      } else {
        setProfileReadState("unavailable");
      }
    });
    return () => { active = false; };
  }, [durableWorkspace]);
  const [cardLast4, setCardLast4] = useState("4242");
  const toastTimer = useRef<number | null>(null);
  const refreshTimer = useRef<number | null>(null);
  const refreshPollTimer = useRef<number | null>(null);
  const refreshAttemptKey = useRef<string | null>(null);
  const analysisTimer = useRef<number | null>(null);
  const firstView = useRef(true);
  const rememberRefreshAttemptKey = useCallback((value: string | null) => {
    refreshAttemptKey.current = value;
    setRefreshResumeAvailable(value !== null);
    if (durableWorkspace) writeStoredPaidRefreshAttempt(applicationContext.clientId, value);
  }, [applicationContext.clientId, durableWorkspace]);

  useEffect(() => {
    if (!durableWorkspace) return;
    queueMicrotask(() => {
      rememberRefreshAttemptKey(readStoredPaidRefreshAttempt(applicationContext.clientId));
    });
  }, [applicationContext.clientId, durableWorkspace, rememberRefreshAttemptKey]);
  // R4B-03. `disabled` comes only from a successful `{ enabled: false }`; a 503, a network error or
  // an unparseable body is `unavailable`, which keeps every local fixture mutation switched off
  // instead of presenting an unsent upload as stored.
  useEffect(() => {
    let active = true;
    void loadAncillaryBootstrap().then((result) => {
      if (!active) return;
      setAncillaryState(result.state);
      setAncillaryConfig(result.state === "ready" ? result.config : null);
    });
    return () => { active = false; };
  }, [ancillaryReloadToken]);

  useEffect(() => {
    if (!durableWorkspace) return;
    let active = true;
    // Defer the async state transition so this effect follows the same
    // react-hooks/set-state-in-effect-safe pattern as the monitoring readers.
    queueMicrotask(() => {
      void readWorkspacePreferences().then((preferences) => {
        if (!active) return;
        setPortalPreferences(preferences);
        setPortalPreferencesState(preferences ? "ready" : "unavailable");
      });
    });
    return () => { active = false; };
  }, [durableWorkspace, portalPreferencesReloadToken]);

  useEffect(() => {
    if (!durableWorkspace) return;
    let active = true;
    queueMicrotask(() => {
      void readConsumerApplications().then((result) => {
        if (active) setConsumerApplicationsState(result);
      });
    });
    return () => { active = false; };
  }, [consumerApplicationsReloadToken, durableWorkspace]);

  useEffect(() => {
    if (!ancillaryConfig?.enabled) return;
    let active = true;
    const requestSequence = ++notificationsRequestSequence.current;
    void fetchNotifications().then((result) => {
      if (!active || requestSequence !== notificationsRequestSequence.current) return;
      // A failed read used to leave the empty array in place, rendering a
      // healthy zero-notification page — the G-HOST-14 class (wiring audit #6).
      // The read path now returns the outage as its own value, so the view can
      // say so rather than showing an account with nothing on it.
      if (result.status === "ready") {
        setLiveNotifications(result.notifications);
        setLiveNotificationsWindow(result.windowDays);
        setLiveNotificationsCapped(result.capped);
        setLiveNotificationsSources(result.sources);
        setLastKnownUnread(result.unreadCount);
        setLiveNotificationsError(false);
        setLiveNotificationsFailures(0);
        return;
      }
      setLiveNotificationsError(true);
      setLiveNotificationsFailures((count) => count + 1);
    });
    return () => { active = false; };
  }, [ancillaryConfig?.enabled, notificationsReloadToken]);

  /**
   * The published lessons for this workspace.
   *
   * A read that does not come back is a failure, never an empty array, so a failed list
   * cannot render as a healthy nothing (the G-HOST-14 class). The flag being off is not a
   * failure and not a read: it resolves to `idle` below, which the view renders as the
   * same empty state as zero rows, because either way this workspace has no lesson to
   * show. `trainingsReloadToken` is what the error box's Reload runs.
   */
  useEffect(() => {
    if (!trainingsEnabled || !trainingsVisible) return;
    let active = true;
    void fetch("/api/trainings", { cache: "no-store", credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { trainings?: TrainingLesson[] } | null) => {
        if (!active) return;
        setTrainingsRead(data ? { ok: true, rows: data.trainings ?? [] } : { ok: false });
      })
      .catch(() => {
        if (active) setTrainingsRead({ ok: false });
      });
    return () => { active = false; };
  }, [trainingsEnabled, trainingsReloadToken, trainingsVisible]);

  useEffect(() => {
    if (!paidRefreshEnabled) return;
    let active = true;
    void fetch("/api/pricing/consumer", { cache: "no-store", credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((catalog: ConsumerPricingCatalog | null) => {
        if (!active) return;
        if (catalog?.enabled && Number.isSafeInteger(catalog.forcePull.amountCents) && catalog.forcePull.amountCents > 0) {
          setPricingCatalog(catalog);
          setPricingState("ready");
        } else {
          setPricingCatalog(null);
          setPricingState("unavailable");
        }
      })
      .catch(() => {
        if (active) {
          setPricingCatalog(null);
          setPricingState("unavailable");
        }
      });
    return () => { active = false; };
  }, [paidRefreshEnabled]);

  /** Read score-display availability and the durable analysis schedule as separate facts. */
  const loadMonitoringReading = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch("/api/monitoring/reading", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) {
        setMonitoringReadState("error");
        setMonitoringReading(null);
        return false;
      }
      const body = await response.json().catch(() => null) as
        | {
            available?: boolean;
            latestAnalysisAt?: string | null;
            nextRefreshAt?: string | null;
            reading?: MonitoringReading | null;
            source?: "mock" | "provider";
          }
        | null;
      if (
        body === null || typeof body !== "object"
        || (body.source !== "mock" && body.source !== "provider")
        || !(body.nextRefreshAt === null || typeof body.nextRefreshAt === "string")
      ) {
        setMonitoringReadState("error");
        setMonitoringReading(null);
        return false;
      }
      setMonitoringNextRefreshAt(body.nextRefreshAt ?? null);
      if (body.available === true && body.source === "mock" && body.reading) {
        setMonitoringReading(body.reading);
        setMonitoringReadState("ready");
        return true;
      }
      setMonitoringReading(null);
      // A real driver owns the bureau display. `available:false` is therefore an explicit
      // unavailable screen, never permission to substitute the July mock file.
      setMonitoringReadState(body.source === "provider" ? "unavailable" : "fixture");
      return true;
    } catch {
      setMonitoringReadState("error");
      setMonitoringReading(null);
      return false;
    }
  }, []);

  const loadPaidRefreshHistory = useCallback(async (): Promise<readonly ConsumerPaidRefreshRecord[] | null> => {
    const result = await fetchConsumerPaidRefreshHistory();
    if (result.status !== "ready") {
      setPaidRefreshReadState("unavailable");
      return null;
    }
    setPaidRefreshReadState("ready");
    setPaidRefreshes(result.refreshes);
    const latest = result.refreshes[0] ?? null;
    setRefreshPending(latest?.status === "payment_pending");
    setRefreshRunning(latest ? ["queued", "running"].includes(latest.status) : false);
    if (!result.refreshes.some((refresh) => paidRefreshCanResume(refresh.status))) {
      rememberRefreshAttemptKey(null);
    } else {
      setRefreshResumeAvailable(refreshAttemptKey.current !== null);
    }
    return result.refreshes;
  }, [rememberRefreshAttemptKey]);

  useEffect(() => {
    if (!durableWorkspace) return;
    // Deferred a tick so no setState in the loader's chain runs synchronously inside the effect
    // body (react-hooks/set-state-in-effect) — the idiom realtime.client.ts already uses.
    queueMicrotask(() => { void loadMonitoringReading(); });
  }, [durableWorkspace, loadMonitoringReading]);

  useEffect(() => {
    if (!durableWorkspace) return;
    queueMicrotask(() => { void loadPaidRefreshHistory(); });
  }, [durableWorkspace, loadPaidRefreshHistory]);

  const monitoringPriceLabel = paidRefreshEnabled
    ? pricingCatalog ? priceLabel(pricingCatalog.monitoring.amountCents) : "Unavailable"
    : durableWorkspace ? "Unavailable" : "$49";
  const monitoringPriceAmountLabel = paidRefreshEnabled
    ? pricingCatalog ? priceLabel(pricingCatalog.monitoring.amountCents, 2) : "Unavailable"
    : durableWorkspace ? "Unavailable" : "$49.00";
  const refreshPriceLabel = paidRefreshEnabled
    ? pricingCatalog ? priceLabel(pricingCatalog.forcePull.amountCents) : "Unavailable"
    : durableWorkspace ? "Unavailable" : "$19";
  const refreshPriceAmountLabel = paidRefreshEnabled
    ? pricingCatalog ? priceLabel(pricingCatalog.forcePull.amountCents, 2) : "Unavailable"
    : durableWorkspace ? "Unavailable" : "$19.00";
  const blockingPaidRefresh = paidRefreshes.find((refresh) =>
    paidRefreshBlocksNewPurchase(refresh.status)
  ) ?? null;
  const replayablePaidRefresh = refreshResumeAvailable
    && blockingPaidRefresh !== null
    && paidRefreshCanResume(blockingPaidRefresh.status)
    ? blockingPaidRefresh
    : null;

  /** Poll the exact durable request returned by the POST, bounded to a two-minute courtesy window. */
  function watchForRefresh(requestId: string) {
    if (refreshPollTimer.current) window.clearTimeout(refreshPollTimer.current);
    const deadline = Date.now() + REFRESH_POLL_WINDOW_MS;
    const check = async () => {
      const refreshes = await loadPaidRefreshHistory();
      const refresh = refreshes?.find((record) => record.requestId === requestId) ?? null;
      if (refresh && !isPaidRefreshInProgress(refresh.status)) {
        if (refresh.status === "completed" && refresh.paidAt && refresh.completedAt) {
          setRefreshComplete(true);
          await loadMonitoringReading();
          notify("Refresh complete. The durable payment and analysis records are both complete.");
        } else if (refresh.status === "payment_action_required") {
          notify("Payment action is required before this refresh can start.");
        } else if (refresh.status === "payment_failed") {
          notify("The payment failed. No completed charge is shown.");
        } else if (refresh.status === "payment_review") {
          notify("The payment needs review. No completed charge is being claimed.");
        } else if (refresh.status === "unfulfillable") {
          notify("Payment was recorded, but the refresh cannot run. The funding team has been alerted.");
        } else if (refresh.status === "remediated") {
          notify("The funding team resolved the earlier paid refresh obligation.");
        } else {
          notify("The refresh did not complete. Its durable status is shown on this account.");
        }
        return;
      }
      if (Date.now() >= deadline) {
        notify("The refresh is still in progress. Its durable status will remain after a reload.");
        return;
      }
      refreshPollTimer.current = window.setTimeout(() => { void check(); }, REFRESH_POLL_INTERVAL_MS);
    };
    refreshPollTimer.current = window.setTimeout(() => { void check(); }, REFRESH_POLL_INTERVAL_MS);
  }

  async function confirmPaidRefresh() {
    if (
      refreshSubmitting
      || (blockingPaidRefresh !== null && replayablePaidRefresh === null)
      || paidRefreshReadState !== "ready"
      || pricingState !== "ready"
      || !pricingCatalog
    ) return;
    setRefreshOpen(false);
    setRefreshPending(true);
    setRefreshSubmitting(true);
    setRefreshComplete(false);
    setRefreshRunning(false);
    const idempotencyKey = refreshAttemptKey.current ?? crypto.randomUUID();
    rememberRefreshAttemptKey(idempotencyKey);
    let response: Response;
    try {
      response = await fetch("/api/refresh-now", {
        body: JSON.stringify({ expectedAmountCents: pricingCatalog.forcePull.amountCents }),
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
      });
    } catch {
      setRefreshPending(false);
      await loadPaidRefreshHistory();
      setRefreshSubmitting(false);
      notify("Refresh unavailable.");
      return;
    }
    const result = await response.json().catch(() => null) as { error?: unknown; requestId?: unknown; status?: unknown } | null;
    if (!response.ok || result?.status !== "queued") {
      setRefreshPending(false);
      await loadPaidRefreshHistory();
      setRefreshSubmitting(false);
      notify(
        result?.error === "payment_requires_action"
          ? "Payment action is required. Complete it with your payment provider, then try again."
          : result?.error === "request_in_progress"
            ? "An earlier refresh still needs attention. Its durable status is shown on this account."
          : result?.error === "price_changed"
            ? "The refresh price changed. Reload pricing before confirming again."
            : result?.error === "cap_denied"
              ? "The refresh limit has been reached for this period."
              : "Refresh unavailable.",
      );
      return;
    }
    if (typeof result.requestId !== "string" || result.requestId.length === 0) {
      setRefreshPending(false);
      await loadPaidRefreshHistory();
      setRefreshSubmitting(false);
      notify("Refresh status is unavailable. Reload the account before trying again.");
      return;
    }
    rememberRefreshAttemptKey(null);
    // The POST returns `queued` only after the succeeded payment event and linked job are durable.
    // This is still a running state, never a completed-charge or completed-analysis claim.
    setRefreshPending(false);
    setRefreshSubmitting(false);
    setRefreshRunning(true);
    notify("Refresh request accepted. Checking the durable payment and analysis status.");
    await loadPaidRefreshHistory();
    watchForRefresh(result.requestId);
  }

  useEffect(() => {
    onProfileIdentityChange?.({
      initials: profile.name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      name: profile.name,
    });
  }, [onProfileIdentityChange, profile.name]);

  // R4B-02 / R4D-04. Only an explicit successful `{ enabled: false }` selects the local demo
  // branch; everything else is `unavailable`, which disables cancellation and consent revocation
  // rather than confirming one that never reached the server. When the record does load, the
  // durable status — not the retained consent grants — decides whether the plan is live: a
  // cancelled enrollment keeps its grant rows as history but drives both controls off.
  useEffect(() => {
    let active = true;
    void loadEnrollmentBootstrap().then((result) => {
      if (!active) return;
      setEnrollState(result.state);
      setEnroll(result.state === "ready" ? result.config : null);
      if (result.state !== "ready") return;
      const current = result.config.currentEnrollment;
      if (!current) return;
      const state = consentStateFromView(current);
      setEnrollmentView(current);
      setCanceled(state.canceled);
      setMonitoringActive(state.monitoringActive);
      setAnalysisActive(state.analysisActive);
    });
    return () => { active = false; };
  }, [enrollReloadToken]);

  const enrollLive = enrollState === "ready" && enroll !== null;
  /**
   * Found by the flag-off selector scan, not by the census.
   *
   * `enrollFixture` licensed the fixture walkthrough's Account & Billing panel
   * — an active plan at a fixture price, both named consents shown as granted
   * from component state, and a Cancel control whose whole implementation is
   * four `setState` calls and a toast reading "Subscription canceled. Pulls
   * stopped and deletion is scheduled." With `FEATURE_ENROLLMENT` off, a
   * signed-in consumer got all of it. Requiring the fixture shell drops them
   * into the durable branch, which renders the subscription row and, finding
   * none, says so.
   */
  const enrollFixture = enrollState === "disabled" && !durableWorkspace;
  const enrollPending = enrollState === "loading" || enrollState === "unavailable";
  const ancillaryLive = ancillaryState === "ready" && ancillaryConfig !== null;
  /**
   * `disabled` is the ancillary bootstrap reporting that the flag is off. That
   * licensed the local document vault, the four seeded notifications and their
   * sidebar badge — one fixture person's records, handed to whoever was signed
   * in. The flag governs whether the service answers; `durableWorkspace`
   * governs whether a fixture may stand in for the answer, and only the fixture
   * shell may say yes.
   */
  const ancillaryFixture = ancillaryState === "disabled" && !durableWorkspace;
  /** The ancillary set is off on an account with no fixture to fall back to. */
  /** New money is disabled independently from durable monitoring and purchase-history reads. */
  const paidRefreshOff = durableWorkspace && !paidRefreshEnabled;
  const paidRefreshControlReady = durableWorkspace
    ? paidRefreshEnabled
      && !refreshSubmitting
      && !refreshRunning
      && !refreshComplete
      && pricingState === "ready"
      && paidRefreshReadState === "ready"
      && (blockingPaidRefresh === null || replayablePaidRefresh !== null)
    : !refreshPending && !refreshRunning && !refreshComplete;
  const ancillaryPending = ancillaryState === "loading" || ancillaryState === "unavailable";

  // The ancillary set being switched off is not a claim that this account has five unread
  // alerts about somebody else's file, so the fixture list is reachable only from the fixture shell.
  const notificationsOff = durableWorkspace && !ancillaryLive && !ancillaryPending;
  const trainingsStatus: TrainingsStatus = !trainingsEnabled || !trainingsVisible
    ? "idle"
    : trainingsRead === null
      ? "loading"
      : trainingsRead.ok
        ? "ready"
        : "error";
  const trainings = trainingsRead?.ok ? trainingsRead.rows : null;

  useEffect(() => {
    if (trainingsVisible || activeView !== "learning") return;
    // The render switch below already substitutes Overview in the same commit;
    // this aligns shell state and history after a hidden preference loads.
    queueMicrotask(() => setActiveView("dashboard"));
  }, [activeView, trainingsVisible]);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    if (refreshPollTimer.current) window.clearTimeout(refreshPollTimer.current);
    if (analysisTimer.current) window.clearTimeout(analysisTimer.current);
  }, []);

  // Latest-value mirror so the view-change effect can consult the handoff
  // without refiring (and re-scrolling) on every phase transition.
  const handoffPhaseRef = useRef<HandoffPhase>("idle");
  handoffPhaseRef.current = handoff.phase;

  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // During the handoff the overlay hides the workspace, so the scroll reset
    // jumps instead of animating (a smooth scroll would still be running when
    // the shared-element travel measures its boxes) and focus stays with the
    // overlay heading until the reveal hands it back.
    const staged = handoffPhaseRef.current === "staged";
    window.scrollTo({ top: 0, behavior: reduced || staged ? "auto" : "smooth" });
    window.requestAnimationFrame(() => {
      if (handoffPhaseRef.current !== "idle") return;
      document.getElementById("consumer-view-heading")?.focus({ preventScroll: true });
    });
  }, [activeView]);

  const onHandoffRowsSettled = useCallback(() => {
    setHandoff((current) => (current.phase === "staged" ? { ...current, rowsSettled: true } : current));
  }, []);
  const onHandoffHeroReady = useCallback(() => {
    setHandoff((current) => (current.phase === "staged" && !current.heroReady ? { ...current, heroReady: true } : current));
  }, []);
  const onHandoffHeroLanded = useCallback(() => {
    setHandoff((current) => (current.phase === "landing" ? { ...current, phase: "revealing" } : current));
  }, []);

  // Land once the overlay's status lines have resolved and the hero target is
  // mounted beneath it. The overlay dissolve, the hero's shared-element travel
  // and the fixture completion claim all hang off this one transition; the
  // durable arm makes no completion claim because the real source review is
  // still draining — the landed hero carries that as a live status instead.
  useEffect(() => {
    if (handoff.phase !== "staged" || !handoff.rowsSettled || !handoff.heroReady) return;
    if (analysisTimer.current) window.clearTimeout(analysisTimer.current);
    analysisTimer.current = null;
    const fixture = !enrollLive;
    // Measured now, while the interstitial is still mounted: this box is what
    // the hero animates out of on the very next commit.
    const card = document.querySelector(`[${HANDOFF_CARD_ATTR}]`);
    const box = card?.getBoundingClientRect() ?? null;
    const fromRect = box ? { height: box.height, width: box.width, x: box.x, y: box.y } : null;
    queueMicrotask(() => {
      setHandoff((current) => (current.phase === "staged" ? { ...current, fromRect, phase: "landing" } : current));
      // The fixture's simulated analysis completes at the landing; the durable
      // arm claims nothing here because the real review is still draining.
      if (fixture) notify("First authorized analysis complete. Your verified workspace is ready.");
    });
  }, [handoff, enrollLive]);

  // "landing" normally resolves through the hero's layout-animation callback;
  // this watchdog covers the unpaired dissolve (no hero to travel to) and any
  // missed callback so the workspace can never stay hidden.
  useEffect(() => {
    if (handoff.phase !== "landing") return;
    const timer = window.setTimeout(() => {
      setHandoff((current) => (current.phase === "landing" ? { ...current, phase: "revealing" } : current));
    }, handoff.fromRect ? 900 : 0);
    return () => window.clearTimeout(timer);
  }, [handoff.fromRect, handoff.phase]);

  useEffect(() => {
    if (handoff.phase !== "revealing") return;
    const focusFrame = window.requestAnimationFrame(() => {
      document.getElementById("consumer-view-heading")?.focus({ preventScroll: true });
    });
    const timer = window.setTimeout(() => {
      setHandoff((current) => (current.phase === "revealing" ? { ...current, fromRect: null, heroReady: false, phase: "idle", rowsSettled: false } : current));
    }, 1400);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.clearTimeout(timer);
    };
  }, [handoff.phase]);

  const handoffContext = useMemo<EnrollmentHandoff>(() => ({
    fromRect: handoff.fromRect,
    onHeroLanded: onHandoffHeroLanded,
    onHeroReady: onHandoffHeroReady,
    phase: handoff.phase,
  }), [handoff.fromRect, handoff.phase, onHandoffHeroLanded, onHandoffHeroReady]);

  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3400);
  }

  function navigate(view: ViewId) {
    setActiveView(view);
  }

  const reportBlock: ReportBlock = canceled
    ? "canceled"
    : durableWorkspace
      ? "no-durable-store"
      : null;

  function toggleReported(index: number) {
    if (reportBlock === "canceled") {
      notify("Reporting is unavailable because the subscription is canceled.");
      return;
    }
    // The control is already disabled for this reason; the guard is here because a
    // disabled button is a rendering decision and this is the only place that can
    // stop the write itself. `reported` is component state with no durable home
    // (see `ReportBlock`), so on a durable workspace it may not move at all.
    if (reportBlock === "no-durable-store") {
      notify(ACTION_REPORTING_UNAVAILABLE);
      return;
    }
    setReported((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
        notify("Action returned to To do.");
      } else {
        next.add(index);
        notify("Action reported. It remains unverified until the next authorized update.");
      }
      return next;
    });
  }

  function upload(category: DocumentCategory, files: File[]) {
    // The local vault is the flag-off demo, so it may only run when the server said the flag is
    // off. While the bootstrap is loading or unavailable nothing may be appended, because the row
    // it appends reads as a stored file.
    if (!ancillaryFixture || uploadingCategory) return;
    setUploadingCategory(category);
    window.setTimeout(() => {
      setUploadedFiles((current) => ({
        ...current,
        [category]: [
          ...current[category],
          ...files.map((file) => file.name),
        ],
      }));
      setUploadingCategory(null);
      notify(`${files.length} ${files.length === 1 ? "file" : "files"} encrypted and added.`);
    }, 850);
  }

  function openReauthorization(kind: Consent) {
    reauthorizeDraft.current = crypto.randomUUID();
    setReauthorizeAccepted(false);
    setReauthorizeSignature("");
    setReauthorizeTarget(kind);
  }

  function closeReauthorization() {
    if (reauthorizePending) return;
    reauthorizeDraft.current = null;
    setReauthorizeAccepted(false);
    setReauthorizeSignature("");
    setReauthorizeTarget(null);
  }

  async function submitReauthorization() {
    if (!reauthorizeTarget || !enrollmentView || !enrollLive) {
      notify("The enrollment is not ready. Refresh the workspace and try again.");
      return;
    }
    if (!reauthorizeAccepted) {
      notify("Read and affirm the authorization before signing.");
      return;
    }
    if (
      reauthorizeSignature.trim().toLocaleLowerCase("en-US") !==
      profile.name.trim().toLocaleLowerCase("en-US")
    ) {
      notify("Type your full legal name exactly as it appears on your account.");
      return;
    }
    const draftId = reauthorizeDraft.current ?? crypto.randomUUID();
    reauthorizeDraft.current = draftId;
    setReauthorizePending(true);
    const result = await postJson<EnrollmentView>(
      `/api/enrollments/${enrollmentView.enrollmentId}/reauthorize-consent`,
      {
        accepted: true,
        draftId,
        kind: reauthorizeTarget,
        signature: reauthorizeSignature.trim(),
      },
    );
    setReauthorizePending(false);
    if (!result.ok) {
      // Keep the draft and dialog open. A CRS resume failure happens after the
      // signed grant is durable, so retrying this exact draft resumes the
      // provider without appending another grant.
      notify(result.message);
      return;
    }
    const state = consentStateFromView(result.data);
    setEnrollmentView(result.data);
    setCanceled(state.canceled);
    setMonitoringActive(state.monitoringActive);
    setAnalysisActive(state.analysisActive);
    const restored = reauthorizeTarget;
    reauthorizeDraft.current = null;
    setReauthorizeAccepted(false);
    setReauthorizeSignature("");
    setReauthorizeTarget(null);
    notify(restored === "monitoring"
      ? "Credit monitoring authorization restored."
      : "Readiness analysis authorization restored.");
  }

  async function revokeConsent() {
    if (enrollPending) {
      setRevokeTarget(null);
      notify(ENROLLMENT_UNAVAILABLE_NOTICE);
      return;
    }
    if (enrollLive) {
      if (!revokeTarget || !enrollmentView) {
        notify("The enrollment is not ready. Refresh the workspace and try again.");
        return;
      }
      const result = await postJson<EnrollmentView>(
        `/api/enrollments/${enrollmentView.enrollmentId}/revoke-consent`,
        { kind: revokeTarget },
      );
      if (!result.ok) {
        notify(result.message);
        return;
      }
      setEnrollmentView(result.data);
    }
    if (revokeTarget === "monitoring") {
      setMonitoringActive(false);
      notify("Monitoring consent revoked. The CRS widget is now unavailable.");
    }
    if (revokeTarget === "analysis") {
      setAnalysisActive(false);
      notify("Analysis authorization revoked. Recurring analysis has stopped.");
    }
    setRevokeTarget(null);
  }

  async function confirmCancellation() {
    if (enrollPending) {
      setCancelOpen(false);
      notify(ENROLLMENT_UNAVAILABLE_NOTICE);
      return;
    }
    if (enrollLive) {
      if (!enrollmentView?.enrollmentId) {
        notify("The enrollment is not ready. Refresh the workspace and try again.");
        return;
      }
      await cancelConsumerEnrollment(enrollmentView.enrollmentId, {
        apply(view) {
          // R5D-03: the same derivation the bootstrap path uses, so the retained grants a
          // cancellation returns cannot render as live permissions until the next reload.
          const state = consentStateFromView(view);
          setEnrollmentView(view);
          setCanceled(state.canceled);
          setMonitoringActive(state.monitoringActive);
          setAnalysisActive(state.analysisActive);
        },
        fail: notify,
        succeed(message) {
          setCancelOpen(false);
          setRefreshPending(false);
          if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
          notify(message);
        },
      });
      return;
    }

    // Neither a live enrollment nor the fixture shell: there is nothing here
    // that cancelling could act on, and a control that silently does nothing is
    // worse than one that says why.
    if (!enrollFixture) {
      setCancelOpen(false);
      notify(CANCELLATION_UNAVAILABLE);
      return;
    }
    setCancelOpen(false);
    setCanceled(true);
    setMonitoringActive(false);
    setAnalysisActive(false);
    setRefreshPending(false);
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    notify("Subscription canceled. Pulls stopped and deletion is scheduled.");
  }



  function applyReadNotifications(updated: readonly NotificationEventV2[]) {
    const byId = new Map(updated.map((item) => [item.id, item]));
    setLiveNotifications((current) => current.map((item) => byId.get(item.id) ?? item));
  }

  async function markLiveRead(eventKey: string): Promise<boolean> {
    const result = await markNotificationRead(eventKey);
    if (!result.ok) {
      notify(result.message);
      return false;
    }
    applyReadNotifications([result.notification]);
    return true;
  }

  async function markAllLiveRead(): Promise<boolean> {
    const result = await markAllNotificationsRead();
    if (!result.ok) {
      notify(result.message);
      return false;
    }
    // The route reports how many rows it moved, not which ones, so the local copy stamps every
    // unread row it was holding. The next read reconciles against the server's own timestamps.
    const readAt = new Date().toISOString();
    setLiveNotifications((current) =>
      current.map((item) => (item.readAt === null ? { ...item, readAt } : item)),
    );
    notify("All notifications marked read.");
    return true;
  }

  if (activeView === "onboarding") {
    return (
      <Onboarding1
        // The client's own business, for the identity quiz. Deliberately NOT
        // `profileOrganization`, which falls back to the operator's name when
        // the row carries no business: the server mock grades the same
        // `mockQuizAnswer` derivation on the raw `business_name`, so anything
        // substituted here would make the consumer's correct answer fail and
        // burn an attempt.
        businessName={durableWorkspace ? applicationContext.businessName ?? null : selectedClient?.business ?? null}
        // The wizard holds no persona of its own any more, so whoever it names
        // on step 1 and asks to sign on step 3 is whoever this surface resolved:
        // the tracker client under real auth, the fixture roster on the demo
        // shell. An e-signature is only worth capturing if it bears the signer's
        // own name.
        identity={{ email: profile.email, name: profile.name, phone: profile.phone }}
        initialDraft={enrollmentDraft ?? undefined}
        onComplete={(result) => {
          if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
          if (analysisTimer.current) window.clearTimeout(analysisTimer.current);
          setEnrollmentDraft(null);
          setEnrollmentView(result.enrollment);
          setMonitoringActive(result.monitoring);
          setAnalysisActive(result.analysis);
          setTermsSigned(true);
          setProfile({ email: result.email, name: result.name, phone: result.phone });
          setCardLast4(result.cardLast4);
          setCanceled(false);
          setReported(new Set());
          setRefreshOpen(false);
          setRefreshPending(false);
          setRefreshComplete(false);
          setReadNotifications(new Set());
          setUploadedFiles(emptyDocumentUploads());
          setUploadingCategory(null);
          setActiveView("dashboard");
          notify("Enrollment complete. Your first authorized analysis is queued.");
          if (result.analysis) {
            setHandoff((current) => ({ fromRect: null, heroReady: false, phase: "staged", rowsSettled: false, token: current.token + 1 }));
            // Failsafe: if the tracker read never yields a hero to land on,
            // dissolve the overlay without the travel rather than hold the
            // workspace hostage behind it.
            analysisTimer.current = window.setTimeout(() => {
              analysisTimer.current = null;
              setHandoff((current) => (current.phase === "staged" ? { ...current, fromRect: null, phase: "landing" } : current));
            }, 7000);
          }
        }}
        onExit={(draft) => {
          setEnrollmentDraft(draft);
          setActiveView("settings");
          notify("Enrollment progress saved for this demo.");
        }}
        onOpenProfiles={onOpenProfiles}
        operatorName={operatorName}
        roleIdentity={{
          initials: profile.name
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase(),
          name: profile.name,
          organization: profileOrganization,
        }}
      />
    );
  }

  let content: ReactNode;
  switch (activeView) {
    case "optimization":
      content = <OptimizationView analysisActive={analysisActive} canceled={canceled} durableWorkspace={durableWorkspace} navigate={navigate} northwestPartnerUrl={ancillaryConfig?.northwestPartnerUrl ?? null} reportBlock={reportBlock} reported={reported} toggleReported={toggleReported} />;
      break;
    case "plan":
      content = <FundingPlanView canceled={canceled} clientId={applicationContext.clientId} consumerApplications={consumerApplicationsState} durableWorkspace={durableWorkspace} navigate={navigate} operatorUnlocked={sessionMatchesUnlocked[applicationContext.clientId] ?? false} readiness={applicationContext.readiness} />;
      break;
    case "matches":
      content = (
        <MatchesView
          applicationVisibility={applicationVisibility}
          canceled={canceled}
          clientId={applicationContext.clientId}
          clientStage={clientStage}
          consumerApplications={consumerApplicationsState}
          durableWorkspace={durableWorkspace}
          navigate={navigate}
          notify={notify}
          onReloadConsumerApplications={() => {
            setConsumerApplicationsState({ status: "loading" });
            setConsumerApplicationsReloadToken((token) => token + 1);
          }}
          portalPreferencesState={portalPreferencesState}
          profileName={profile.name}
          readiness={applicationContext.readiness}
        />
      );
      break;
    case "credit":
      content = <CreditView analysisActive={analysisActive} canRefresh={!canceled && analysisActive && monitoringActive && paidRefreshControlReady} latestRefresh={paidRefreshes[0] ?? null} monitoringActive={monitoringActive} nextRefreshAt={monitoringNextRefreshAt} onRefresh={() => setRefreshOpen(true)} paidRefreshEnabled={paidRefreshEnabled} purchaseUnavailable={paidRefreshOff} reading={monitoringReading} readingState={monitoringReadState} refreshComplete={refreshComplete} refreshPending={refreshPending} refreshPriceLabel={refreshPriceLabel} refreshResumeAvailable={replayablePaidRefresh !== null} refreshRunning={refreshRunning} refreshStatusUnavailable={durableWorkspace && paidRefreshReadState === "unavailable"} refreshSubmitting={refreshSubmitting} />;
      break;
    case "documents":
    case "agreements":
      content = <OnboardingHubView ancillaryEnabled={ancillaryLive} ancillaryPending={ancillaryPending} analysisActive={analysisActive} clientId={applicationContext.clientId} documentUploadsAllowed={documentUploadsAllowed} durableWorkspace={durableWorkspace} enrollment={enrollLive ? enrollmentView : null} enrollmentState={enrollState} initialTab={activeView === "agreements" ? "permissions" : "files"} key={activeView} monitoringActive={monitoringActive} notify={(message) => { if (message.includes("signed")) setTermsSigned(true); notify(message); }} onUpload={upload} portalPreferencesState={portalPreferencesState} termsSigned={termsSigned} uploadedFiles={uploadedFiles} uploadingCategory={uploadingCategory} />;
      break;
    case "coach":
      content = <ConsumerTeamChat analysisActive={analysisActive} canceled={canceled} navigate={navigate} notify={notify} operatorName={operatorName} teamChat={teamChat} timelineEnabled={timelineEnabled} />;
      break;
    case "learning":
      content = trainingsVisible ? (
        <ConsumerTrainingsView
          canceled={canceled}
          durableWorkspace={durableWorkspace}
          fixtureLessons={FIXTURE_TRAINING_LESSONS}
          navigate={navigate}
          onReload={() => {
            setTrainingsRead(null);
            setTrainingsReloadToken((token) => token + 1);
          }}
          platformTrainingsUrl={ancillaryConfig?.platformTrainingsUrl ?? null}
          stage={trainingsStage}
          status={trainingsStatus}
          trainings={trainings}
        />
      ) : <DashboardView analysisActive={analysisActive} canceled={canceled} clientId={applicationContext.clientId} clientStage={clientStage} durableWorkspace={durableWorkspace} monitoringActive={monitoringActive} navigate={navigate} profileName={profile.name} readiness={applicationContext.readiness} referralsEnabled={referralsEnabled} reported={reported} showFundingProgress={showFundingProgress} />;
      break;
    case "notifications": {
      // The fixture rows are reachable only from the fixture shell; on a durable workspace they
      // would be a claim about somebody else's account.
      const fixtureNotifications = ancillaryFixture ? notifications.map((item) => (readNotifications.has(item.id) ? { ...item, readAt: FIXTURE_NOTIFICATION_READ_AT } : item)) : [];
      // Four answers and no fifth. A durable workspace with the ancillary set off has no store to
      // read; a read in flight is not an empty account; and a failed read is not an empty account
      // either. Only the last branch is allowed to claim there is nothing here.
      const notificationsState: NotificationsSurfaceStateV1 = notificationsOff
        ? { notice: NOTIFICATIONS_ABSENT, status: "absent" }
        : ancillaryPending
          ? { status: "loading" }
          : ancillaryLive && liveNotificationsError
            ? { failures: liveNotificationsFailures, status: "error" }
            : ancillaryLive
              ? { capped: liveNotificationsCapped, events: liveNotifications, sources: liveNotificationsSources, status: "ready", windowDays: liveNotificationsWindow }
              // The fixture shell has no flags to report, so it teaches every class the product can
              // produce rather than only the ones its four seeded rows happen to cover (R2 B2).
              : { events: fixtureNotifications, sources: FIXTURE_NOTIFICATION_SOURCES, status: "ready" };
      content = (
        <ConsumerNotificationsView
          markAllRead={async () => {
            if (ancillaryLive) return markAllLiveRead();
            if (!ancillaryFixture) return false;
            setReadNotifications(new Set(fixtureNotifications.map((item) => item.id)));
            notify("All notifications marked read.");
            return true;
          }}
          markRead={async (eventKey) => {
            if (ancillaryLive) return markLiveRead(eventKey);
            if (!ancillaryFixture) return false;
            setReadNotifications((current) => new Set(current).add(eventKey));
            return true;
          }}
          navigate={navigate}
          onPreferencesSaved={(preferences: ConsumerNotificationPreferences) => {
            // Invalidate an older feed read before React starts the replacement effect. Turning a
            // category off also removes those rows and their unread contribution synchronously;
            // the no-store read that follows is authoritative for both off and on transitions.
            notificationsRequestSequence.current += 1;
            const enabledTypes = new Set(
              preferences
                .filter((preference) => preference.inApp)
                .map((preference) => preference.eventType),
            );
            const reconciled = liveNotifications.filter((notification) =>
              enabledTypes.has(notification.type));
            setLiveNotifications(reconciled);
            setLastKnownUnread(reconciled.filter((notification) => notification.readAt === null).length);
            setNotificationsReloadToken((token) => token + 1);
          }}
          preferencesEnabled={durableWorkspace && ancillaryLive}
          retry={() => {
            // The failure tally is deliberately not reset here: a successful read clears it, and a
            // second failure has to know it is the second one.
            setLiveNotificationsError(false);
            notificationsRequestSequence.current += 1;
            setNotificationsReloadToken((token) => token + 1);
          }}
          state={notificationsState}
        />
      );
      break;
    }
    case "settings":
      content = <SettingsView analysisActive={analysisActive} cardLast4={cardLast4} canceled={canceled} enrollment={enrollLive ? enrollmentView : null} enrollmentFixture={enrollFixture} enrollmentPending={enrollPending} monitoringActive={monitoringActive} monitoringPriceAmountLabel={monitoringPriceAmountLabel} monitoringPriceLabel={monitoringPriceLabel} notify={notify} onCancel={() => setCancelOpen(true)} onReauthorize={openReauthorization} onRevoke={setRevokeTarget} onUpdateCard={setCardLast4} onUpdateProfile={setProfile} paidRefreshes={paidRefreshes} paidRefreshHistoryUnavailable={durableWorkspace && paidRefreshReadState === "unavailable"} profile={profile} profileDurable={durableWorkspace} profileReadState={profileReadState} refreshChargedAt={refreshChargedAt} refreshComplete={refreshComplete} refreshPending={refreshPending} refreshPriceAmountLabel={refreshPriceAmountLabel} />;
      break;
    default:
      content = <DashboardView analysisActive={analysisActive} canceled={canceled} clientId={applicationContext.clientId} clientStage={clientStage} durableWorkspace={durableWorkspace} monitoringActive={monitoringActive} navigate={navigate} profileName={profile.name} readiness={applicationContext.readiness} referralsEnabled={referralsEnabled} reported={reported} showFundingProgress={showFundingProgress} />;
  }

  const reauthorizationDocument = reauthorizeTarget
    ? CONSENT_DOCUMENTS[reauthorizeTarget]
    : null;
  const reauthorizationSignatureMatches =
    reauthorizeSignature.trim().toLocaleLowerCase("en-US") ===
    profile.name.trim().toLocaleLowerCase("en-US");
  const visiblePlatformNavItems = trainingsVisible
    ? platformNavItems
    : platformNavItems.filter((item) => item.id !== "learning");
  const consumerPlatformItems: ConsumerNavItem[] = enrollLive
    ? [...visiblePlatformNavItems, { id: "onboarding", label: "Enrollment", icon: Flag }]
    : visiblePlatformNavItems;
  // Search uses the same arrays the shell renders, after the Trainings and
  // Enrollment gates have been applied. Record results come only from the
  // consumer-scoped application and notification reads already on this page;
  // the palette performs no broader query and receives no database ids.
  const consumerCommandPages: CommandPalettePage[] = [
    ...workspaceNavItems.map((item) => ({
      description: "Workspace page",
      icon: item.icon,
      id: item.id,
      keywords: item.shortLabel ? [item.shortLabel] : undefined,
      label: item.label,
    })),
    ...consumerPlatformItems.map((item) => ({
      description: "Platform page",
      icon: item.icon,
      id: item.id,
      keywords: item.shortLabel ? [item.shortLabel] : undefined,
      label: item.label,
    })),
  ];
  const consumerCommandRecords: CommandPaletteRecord[] = [
    ...(consumerApplicationsState.status === "ready"
      ? consumerApplicationsState.applications.map((application, index) => ({
          description: `Application ${application.sequence} · ${application.consumerStatus.toUpperCase()}`,
          icon: Landmark,
          id: `application-${index + 1}`,
          keywords: [
            application.consumerStatus,
            application.operatorStatus,
            ...(application.lender
              ? [application.lender.name, ...application.lender.products]
              : []),
          ],
          label: application.lender?.name ?? `Application ${application.sequence}`,
          onSelect: () => navigate("matches"),
        }))
      : []),
    ...(durableWorkspace && ancillaryLive && !liveNotificationsError
      ? liveNotifications.map((notification, index) => ({
          description: notification.detail,
          icon: Bell,
          id: `notification-${index + 1}`,
          keywords: [notification.type.replaceAll("_", " ")],
          label: notification.title,
          onSelect: () => navigate("notifications"),
        }))
      : []),
  ];

  return (
    <MotionConfig reducedMotion="user">
    <AnimatePresence>
      {handoff.phase === "staged" ? (
        <AnalysisQueuedView
          durable={enrollLive}
          key={`enrollment-interstitial-${handoff.token}`}
          onSettled={onHandoffRowsSettled}
          profileName={profile.name}
        />
      ) : null}
    </AnimatePresence>
    <EnrollmentHandoffContext.Provider value={handoffContext}>
    <ConsumerShell
      activeView={activeView}
      notificationCount={ancillaryLive ? (liveNotificationsError ? lastKnownUnread : liveNotifications.filter((item) => item.readAt === null).length) : ancillaryFixture ? notifications.filter((item) => item.readAt === null && !readNotifications.has(item.id)).length : lastKnownUnread}
      onNavigate={(view) => navigate(view as ViewId)}
      onOpenProfiles={onOpenProfiles}
      operatorName={operatorName}
      platformItems={consumerPlatformItems}
      profileInitials={profile.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
      profileName={profile.name}
      profileOrganization={profileOrganization}
      signOutAvailable={realAuth}
      workspaceItems={workspaceNavItems}
    >
      <div className="mb-5 flex justify-end">
        <CommandPalette
          records={consumerCommandRecords}
          className="w-full sm:w-auto"
          onNavigate={(pageId) => navigate(pageId as ViewId)}
          pages={consumerCommandPages}
          triggerLabel="Search pages and records"
        />
      </div>
      {enrollState === "unavailable" ? (
        <div className="mb-5 flex flex-col gap-3 rounded-[10px] border border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_65%)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_55%)] px-4 py-3 text-sm sm:flex-row sm:items-center" role="status">
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-[var(--consumer-warning-ink)]" />
          <p className="min-w-0 flex-1"><strong>Subscription record unavailable.</strong> {ENROLLMENT_UNAVAILABLE_NOTICE}</p>
          <Button className="min-h-11" onClick={() => { setEnrollState("loading"); setEnrollReloadToken((current) => current + 1); }} variant="outline">Reload record</Button>
        </div>
      ) : null}
      {ancillaryState === "unavailable" ? (
        <div className="mb-5 flex flex-col gap-3 rounded-[10px] border border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_65%)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_55%)] px-4 py-3 text-sm sm:flex-row sm:items-center" role="status">
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-[var(--consumer-warning-ink)]" />
          <p className="min-w-0 flex-1"><strong>Documents and trainings unavailable.</strong> {ANCILLARY_UNAVAILABLE_NOTICE}</p>
          <Button className="min-h-11" onClick={() => { setAncillaryState("loading"); setAncillaryReloadToken((current) => current + 1); }} variant="outline">Try again</Button>
        </div>
      ) : null}
      {portalPreferencesState === "unavailable" ? (
        <div className="mb-5 flex flex-col gap-3 rounded-[10px] border border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_65%)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_55%)] px-4 py-3 text-sm sm:flex-row sm:items-center" role="status">
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-[var(--consumer-warning-ink)]" />
          <p className="min-w-0 flex-1"><strong>Portal settings unavailable.</strong> {PORTAL_PREFERENCES_UNAVAILABLE}</p>
          <Button className="min-h-11" onClick={() => { setPortalPreferences(null); setPortalPreferencesState("loading"); setPortalPreferencesReloadToken((current) => current + 1); }} variant="outline">Try again</Button>
        </div>
      ) : null}
      {canceled || !analysisActive ? (
        <div className="mb-5 flex flex-col gap-3 rounded-[10px] border border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_65%)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_55%)] px-4 py-3 text-sm sm:flex-row sm:items-center">
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-[var(--consumer-warning-ink)]" />
          <p className="min-w-0 flex-1"><strong>{canceled ? "Subscription canceled." : "Ongoing analysis paused."}</strong> {canceled ? "Pulls stopped, renewal was removed, and derived data deletion is scheduled within 30 days." : "Existing results remain visible, but they will not update without analysis authorization."}</p>
          <Button className="min-h-11" onClick={() => navigate("settings")} variant="outline">Review account</Button>
        </div>
      ) : null}
      {content}

      {activeView !== "coach" ? (
        <Button
          aria-label="Open Team Chat"
          className={cn(ASSISTANT_LAUNCHER_ADJACENT_CLASS, "min-h-11 rounded-full border-[var(--consumer-surface-border)] bg-popover px-4 text-foreground shadow-[0_6px_18px_color-mix(in_srgb,var(--consumer-brand-tile),transparent_84%)] hover:bg-[var(--consumer-canvas)]")}
          data-app-opening-floating-action
          onClick={() => navigate("coach")}
          variant="outline"
        >
          <MessageCircleMore aria-hidden /> <span className="hidden sm:inline">Team Chat</span>
        </Button>
      ) : null}

      <ConsumerAssistantCompanion context={consumerAssistantContext(activeView, applicationContext.clientId)} />

      <Dialog onOpenChange={setRefreshOpen} open={refreshOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{replayablePaidRefresh ? "Resume the existing credit refresh?" : "Refresh the credit snapshot?"}</DialogTitle>
            <DialogDescription>{paidRefreshOff ? PAID_REFRESH_UNAVAILABLE : replayablePaidRefresh ? `This retries the original ${refreshPriceLabel} request with its original key. It cannot create a second purchase.` : paidRefreshEnabled ? `A ${refreshPriceLabel} add-on charge starts an authorized soft pull. It does not affect your score, and ${monitoringNextRefreshAt ? `the included ${formatDurableDate(monitoringNextRefreshAt) ?? "monthly"} refresh` : "your included monthly refresh"} remains scheduled.` : "A $19 add-on charge starts an authorized soft pull. It does not affect your score, and the included Aug 13 refresh remains scheduled."}</DialogDescription>
          </DialogHeader>
          {blockingPaidRefresh ? <p className="rounded-[8px] border border-[var(--consumer-border)] bg-[var(--consumer-canvas)] p-3 text-xs text-muted-foreground" role="status">{replayablePaidRefresh ? "The original request is unresolved. Resuming reuses its exact key and cannot start another charge." : "An earlier refresh is unresolved. Review its durable status before starting another charge."}</p> : null}
          {paidRefreshOff ? null : <div className="rounded-[8px] border border-[var(--consumer-border)] bg-[var(--consumer-canvas)] p-4 text-xs"><div className="flex justify-between gap-4"><span className="text-muted-foreground">{replayablePaidRefresh ? "Original amount" : "Charge now"}</span><strong className="tabular-nums">{paidRefreshEnabled ? refreshPriceAmountLabel : "$19.00"}</strong></div><div className="mt-2 flex justify-between gap-4"><span className="text-muted-foreground">Pull type</span><strong>Soft inquiry</strong></div></div>}
          <DialogFooter>
            <Button className="min-h-11" onClick={() => setRefreshOpen(false)} variant="outline">{paidRefreshOff ? "Close" : "Not now"}</Button>
            {/* The flag-off arm below is the fixture walkthrough's scripted
                purchase: it announces a pending $19 charge, waits 2.2 seconds,
                and announces the charge as paid, all from component state and
                without a payment provider anywhere in the path. Told to a
                signed-in consumer that is a claim about their money, so on a
                durable workspace the control is disabled with its reason
                instead of pretending. */}
            {paidRefreshOff ? null : <Button className="min-h-11" disabled={paidRefreshEnabled && (refreshSubmitting || (blockingPaidRefresh !== null && replayablePaidRefresh === null) || paidRefreshReadState !== "ready" || pricingState !== "ready")} onClick={paidRefreshEnabled ? () => { void confirmPaidRefresh(); } : () => { setRefreshOpen(false); setRefreshPending(true); setRefreshComplete(false); setRefreshChargedAt(new Date().toISOString()); notify("Refresh started and the $19 charge is pending. This demo will complete it in a few seconds."); if (refreshTimer.current) window.clearTimeout(refreshTimer.current); refreshTimer.current = window.setTimeout(() => { setRefreshPending(false); setRefreshComplete(true); notify("Refresh complete. The $19 charge is paid and the snapshot is current through Jul 21."); }, 2200); }}>{paidRefreshEnabled ? replayablePaidRefresh ? "Resume existing refresh" : `Confirm ${refreshPriceLabel} refresh` : "Confirm $19 refresh"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setCancelOpen} open={cancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel the Plus subscription?</DialogTitle>
            <DialogDescription>Pulls and monitoring stop immediately. Renewal is removed, SecureView closes, and derived analysis data is scheduled for deletion within 30 days. Paid invoices remain unchanged.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button className="min-h-11" onClick={() => setCancelOpen(false)} variant="outline">Keep the plan</Button>
            <Button className="min-h-11" disabled={enrollPending} onClick={() => { void confirmCancellation(); }} variant="destructive">Cancel subscription</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => { if (!open) setRevokeTarget(null); }} open={revokeTarget !== null}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke {revokeTarget === "monitoring" ? "credit monitoring" : "readiness analysis"}?</DialogTitle>
            <DialogDescription>{revokeTarget === "monitoring" ? "The SecureView CRS widget closes immediately. This does not revoke the separate analysis authorization or cancel your subscription. Cancel the subscription separately in Account & Billing if you also want to stop renewal." : "Recurring soft pulls stop and derived readiness outputs are scheduled for deletion within 30 days. This does not revoke the separate monitoring consent or cancel your subscription. Cancel the subscription separately in Account & Billing if you also want to stop renewal."}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button className="min-h-11" onClick={() => setRevokeTarget(null)} variant="outline">Keep permission</Button>
            <Button className="min-h-11" disabled={enrollPending} onClick={revokeConsent} variant="destructive">Revoke permission</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => { if (!open) closeReauthorization(); }}
        open={reauthorizationDocument !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Re-authorize {reauthorizeTarget === "monitoring" ? "credit monitoring" : "readiness analysis"}
            </DialogTitle>
            <DialogDescription>
              This creates a new signed authorization. Your earlier grant and revocation remain in your account history.
            </DialogDescription>
          </DialogHeader>
          {reauthorizationDocument ? (
            <div className="space-y-4">
              <div className="max-h-64 space-y-3 overflow-y-auto rounded-[8px] border border-[var(--consumer-border)] bg-[var(--consumer-canvas)] p-4 text-sm leading-6">
                {reauthorizationDocument.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                <p className="text-xs text-muted-foreground">
                  Effective {formatDate(reauthorizationDocument.effectiveFrom)} · Version {reauthorizationDocument.version}
                </p>
              </div>
              <label className="flex items-start gap-3 rounded-[8px] border border-[var(--consumer-border)] p-3 text-sm leading-5" htmlFor="reauthorize-affirmation">
                <input
                  checked={reauthorizeAccepted}
                  className="mt-1 size-4 shrink-0 accent-[var(--consumer-brand-tile)]"
                  disabled={reauthorizePending}
                  id="reauthorize-affirmation"
                  onChange={(event) => setReauthorizeAccepted(event.target.checked)}
                  type="checkbox"
                />
                <span>I have read this authorization and affirmatively authorize the service described above.</span>
              </label>
              <div>
                <label className="text-xs font-semibold" htmlFor="reauthorize-signature">Type your full legal name to sign</label>
                <Input
                  autoComplete="name"
                  className="mt-2 min-h-11"
                  disabled={reauthorizePending}
                  id="reauthorize-signature"
                  onChange={(event) => setReauthorizeSignature(event.target.value)}
                  placeholder={profile.name}
                  value={reauthorizeSignature}
                />
                {reauthorizeSignature && !reauthorizationSignatureMatches ? (
                  <p className="mt-2 text-xs text-destructive" role="status">Enter {profile.name} exactly as shown on your account.</p>
                ) : null}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button className="min-h-11" disabled={reauthorizePending} onClick={closeReauthorization} variant="outline">Cancel</Button>
            <Button
              className="min-h-11"
              disabled={!reauthorizeAccepted || !reauthorizationSignatureMatches || reauthorizePending}
              onClick={() => { void submitReauthorization(); }}
            >
              {reauthorizePending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ShieldCheck aria-hidden />}
              Sign and re-authorize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        aria-live="polite"
        /*
          Top-right, on owner ruling (Ayman, 2026-08-24). It used to be bottom-right, where it
          shared a corner with the assistant launcher and the surface's own floating action and
          therefore needed a per-view bottom offset (`activeView === "coach"`) to stay off them.
          Anchoring it to the top drops that coupling entirely: nothing else is pinned to this
          corner. The offset is the shell's one fixed band — the demo banner (the sticky header
          bar it also used to clear was removed when #167 closed) — plus a gap. That number is
          `consumer-shell.tsx`'s and has to move with it.
          Dialogs and sheets are `z-50` against this `z-[42]`, so a toast can never cover a modal's
          close button; that ordering is unchanged.
        */
        className="t-toast fixed right-4 top-[calc(var(--demo-banner-height)+0.75rem)] z-[42] max-w-sm rounded-[9px] bg-[var(--consumer-brand-tile)] px-4 py-3 text-sm text-[var(--consumer-canvas)] shadow-xl lg:right-6"
        data-open={toast ? "true" : "false"}
        role="status"
      >
        <span className="flex items-start gap-2"><CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--consumer-connected-on-dark)]" />{toast}</span>
      </div>
    </ConsumerShell>
    </EnrollmentHandoffContext.Provider>
    </MotionConfig>
  );
}
