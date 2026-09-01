"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from "react";
import {
  Activity,
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  BrainCircuit,
  CalendarPlus,
  Check,
  CheckSquare2,
  ChevronsDown,
  ChevronsUp,
  Clock3,
  Columns3,
  Download,
  FileText,
  Home,
  Inbox,
  Landmark,
  LayoutGrid,
  LifeBuoy,
  List,
  MessageSquare,
  Minus,
  Plus,
  Pencil,
  RotateCcw,
  Search,
  Settings,
  Share2,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";

import { BankDetailSheet } from "@/components/demo/bank-detail-sheet";
import { bankVaultSource } from "@/lib/vault/read-model";
import {
  toBankDetail,
  useVaultBankDetail,
  useVaultBanks,
} from "@/lib/vault/read.client";
import {
  CommandPalette,
  type CommandPaletteAction,
  type CommandPalettePage,
  type CommandPaletteRecord,
} from "@/components/demo/command-palette";
import { useFeedbackSession } from "@/components/demo/feedback-session";
import { DemoShell } from "@/components/demo/demo-shell";
import {
  EmptyState,
  MetricStrip,
  Panel,
  ReadinessBar,
  StatusPill,
} from "@/components/demo/shared";
import { ScopedAssistantCompanion } from "@/components/assistant/scoped-companion";
import { ASSISTANT_LAUNCHER_ADJACENT_CLASS, openGlobalAssistant } from "@/components/assistant/global-companion";
import {
  ClientIdentity,
  CompactHeader,
  formatDurableTimestamp,
  initials,
  titleCase,
} from "@/components/operator/chrome";
import { OperatorInbox, useOperatorInbox } from "@/components/operator/inbox";
import { ClientNotesPanel } from "@/components/operator/client-notes-panel";
import { FeeEditSheet } from "@/components/operator/fee-edit-sheet";
import { TrackerClientTimeline } from "@/components/operator/tracker-client-timeline";
import { TrackerFundingPipeline } from "@/components/operator/tracker-funding-pipeline";
import { SUPPORT_SEED } from "@/components/operator/inbox/seeds";
import { SupportBubblePanel } from "@/components/support/support-bubble-panel";
import { SupportThreadView } from "@/components/support/support-thread-view";
import { OperatorOnboarding } from "@/components/surfaces/operator-onboarding";
// The Inbox moved out, but the *roster* did not: the seat table, the tracker's team filter and
// the task assignee controls all read the same directory, and `/api/clients` is the only route
// that names an operator member at all. The Inbox happens to be the other reader of that rail,
// which is why these two used to arrive with its imports.
import {
  inboxTeamOptions,
  readSupportInboxDirectory,
  type SupportInboxDirectoryRead,
} from "@/lib/operator/support-inbox.client";
import { BrandSelect } from "@/components/ui/brand-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  displayInitials,
  displayRoleLine,
  type SessionDisplayIdentity,
} from "@/lib/auth/display-identity";
import { getJson } from "@/lib/enrollment/client";
import type { EnrollConfig } from "@/lib/enrollment/types";
import type { OrgReceivable } from "@/lib/fees/types";
import {
  feeOptionAvailable,
  readReceivables,
  readWorkspaceFeeDefaults,
  setWorkspaceFeeDefault,
  type FeeGateRead,
  type ReceivablesRead,
  type WorkspaceFeeDefaultsRead,
} from "@/lib/operator/fees.client";
import { clientsNavBadge, durableClientCount } from "@/lib/operator/nav-badges";
import {
  readOperatorCreditScores,
  type OperatorCreditScoresRead,
} from "@/lib/operator/credit-scores.client";
import {
  readWorkspaceAccessSettings,
  saveWorkspaceAccessSettings,
  type WorkspaceAccessSettings,
} from "@/lib/operator/durable-rails.client";
import { updateOperatorTeamMemberRole } from "@/lib/operator/member-role.client";
import {
  CONSUMER_PLAN_STATUSES,
  type ConsumerPlanStatus,
  type OperatorPlatformRevenue,
  type OperatorPlanRosterRow,
  type OperatorRevenueLedgerMonth,
} from "@/lib/operator/platform-revenue.types";
import {
  formatTrackerDate,
  trackerActivityEntries,
  trackerFeesFields,
  trackerFundingFields,
  trackerHealthTone,
  trackerOverviewFields,
  trackerPlanFields,
  TRACKER_PLAN_STEPS_NOTE,
  type TrackerDetailField,
  type TrackerFeesSource,
} from "@/lib/operator/tracker-detail";
import type { OperatorPricingCatalog } from "@/lib/pricing/http";
import { operatorBrandPresentation } from "@/lib/tenancy/operator-brand";
import type { PublishedBrand } from "@/lib/tenancy/types";
import {
  readWorkspacePreferences,
  saveWorkspacePreferences,
  type NotificationDigestFrequency,
  type PortalApplicationVisibility,
  type WorkspacePreferences,
  type WorkspacePreferencePatch,
} from "@/lib/portal/preferences";
import {
  createOperatorAffiliateInvite,
  createOperatorTeamInvite,
  publishOperatorBrand,
  updateOperatorBrand,
  type TenantSurfaceFailure,
} from "@/components/surfaces/operator-tenancy";
import {
  affiliatePaymentStatusLabel,
  loadOperatorAffiliates,
  loadOperatorAffiliateStatement,
  shareOperatorAffiliateClient,
  unshareOperatorAffiliateClient,
  updateOperatorAffiliateLifecycle,
  updateOperatorAffiliateShare,
} from "@/lib/operator/affiliates.client";
import type {
  AffiliatePaymentStatus as DurableAffiliatePaymentStatus,
  AffiliateRosterEntry,
  AffiliateStatementRow,
} from "@/lib/affiliates/types";
import {
  MARKETING_SITE_TEMPLATES,
  SUPPORT_TICKET_FIXTURES,
} from "@/lib/demo/co-fixtures";
import {
  CLIENT_FEE_RECORDS,
  CLIENT_PLATFORM_PLAN_RECORDS,
  DEMO_CLIENTS,
  OPERATOR_FIXTURES,
  OPERATOR_PIPELINE,
  OUTCOME_PERIODS,
  TASK_FIXTURES,
  TRAINING_FIXTURES,
  classifyBankTrend,
  deriveClientFundedAmount,
  deriveOperatorHomeMetrics,
  deriveTaskMetrics,
  formatDemoMoney,
  formatDemoNumber,
  formatDemoPercent,
  type OutcomePeriod,
} from "@/lib/demo/feedback-fixtures";
import {
  FUNDING_STAGES,
  READY_PROFILE_COMPLETION,
  type AffiliatePaymentStatus,
  type ApplicationOperatorStatus,
  type ApplicationOutcome,
  type ApplicationPresentationOverride,
  type FundingStage,
  type NavSection,
  type SurfaceProps,
} from "@/lib/demo/types";
import {
  deriveDurableHomeMetrics,
  type DurableHomeMetrics,
} from "@/lib/tracker/home-metrics";
import {
  readTrackerClientSnapshot,
  useTrackerClients,
} from "@/lib/tracker/realtime.client";
import { trackerStageTimer } from "@/lib/tracker/timer";
import {
  createTask,
  loadTasks,
  removeTask,
  TaskClientError,
  updateTask,
} from "@/lib/tasks/client";
import type { OperatorTask, TaskPriority } from "@/lib/tasks/types";
import {
  isTrackerClientStatus,
  isTrackerStage,
  isTrackerUuid,
  TRACKER_STAGE_LABELS,
  trackerStageFromLabel,
  type TrackerClientStatus,
  type TrackerMetadataPatch,
  type TrackerAssigneeOrgRole,
  type TrackerClient,
  type TrackerClientStatusPatch,
  type TrackerReadFilters,
} from "@/lib/tracker/types";
import { cn } from "@/lib/utils";

type View =
  | "home"
  | "assistant"
  | "clients"
  | "bank-vault"
  | "knowledge"
  | "tasks"
  | "inbox"
  | "team"
  | "settings"
  | "onboarding";
type ClientMode = "cards" | "table" | "board" | "timeline";
type ClientsTab = "tracker" | "client-fees" | "platform-rev";
type DrawerTab = "overview" | "plan" | "funding" | "fees" | "notes" | "activity";
type BankVaultTab = "banks" | "updates" | "trends";
type BankViewMode = "list" | "tiles";
type WorkspaceSetupTab = "setup" | "brand" | "access";
type ClientAssignmentMode = "round-robin" | "manual";
type Health =
  | "attention"
  | "fee due"
  | "funded"
  | "on pace"
  | "result due"
  | "review";
type PlanStepState = "active" | "complete" | "overdue" | "proposed";
type FeeModel = "custom" | "package" | "percent" | "unconfigured";
type TaskViewStatus = "completed" | "overdue" | "pending";
type TrainingAudience = "client-facing" | "platform-training";
type TrainingApiAudience = "client" | "operator";
type TrainingRecordSource = "operator" | "platform";
type TrainingSource = "Loom" | "Vimeo" | "YouTube";

type ClientDetail = {
  activity: Array<[string, string]>;
  health: Health;
  next: string;
  plan: Array<{ state: PlanStepState; title: string }>;
  utilization: string;
};

type Client = (typeof DEMO_CLIENTS)[number] & ClientDetail;

const TEAM_ROLES = [
  "Owner",
  "Admin",
  "Prep specialist",
  "Funding specialist",
  "Client success specialist",
  "Commando",
  "Manager",
  "Member",
] as const;

type TeamRole = (typeof TEAM_ROLES)[number];

/**
 * One person on the workspace roster.
 *
 * The durable roster is derived from assigned profiles in `/api/clients`: it
 * carries a stable id, stored org role and active/current-user flags, but no
 * email or last-active instant. Unknown role stays null and cannot authorize a
 * destructive action; absent presentation fields render as an em dash rather
 * than borrowing the fixture workspace's values.
 */
type TeamRow = {
  active: boolean;
  email: string | null;
  id: string;
  isCurrentUser: boolean;
  lastActive: string | null;
  name: string;
  role: TeamRole | null;
};

type TrainingRow = {
  apiAudience: TrainingApiAudience;
  audience: TrainingAudience;
  id: string;
  published: boolean;
  recordSource: TrainingRecordSource;
  source: TrainingSource;
  summary: string;
  title: string;
  videoUrl: string;
  takedownReason: string | null;
  takenDownBy: string | null;
  takenDownAt: string | null;
};

type TrainingEditDraft = Pick<TrainingRow, "id" | "source" | "summary" | "title" | "videoUrl">;
type TrainingTab = "your" | "platform";

type AncillaryBootstrap = {
  enabled: boolean;
  consoleOpsEnabled?: boolean;
  attestationAvailable: boolean;
  attestationText?: string;
  northwestPartnerUrl: string | null;
};

type FeeRow = {
  adminUpfront: number;
  clientId: string;
  model: FeeModel;
  paid: number;
  totalFee: number;
  triggerAmount: number;
};

function tenantFailureMessage(failure: TenantSurfaceFailure): string {
  return `${failure.code}: ${failure.message}`;
}

type DemoTask = {
  assignee: string;
  assigneeProfileId: string | null;
  clientId: string | null;
  dueAt: string;
  dueOn: string | null;
  id: string;
  notes: string;
  priority: TaskPriority;
  status: TaskViewStatus;
  title: string;
  type: string;
};

type TaskEditDraft = {
  assigneeProfileId: string | null;
  clientId: string | null;
  dueOn: string;
  notes: string;
  priority: TaskPriority;
  title: string;
};

type PlatformRevenueRead =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly message: string; readonly state: "failed" }
  | { readonly revenue: OperatorPlatformRevenue; readonly state: "ready" };

type WorkspacePreferencesRead =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly preferences: WorkspacePreferences; readonly state: "ready" };

type WorkspaceAccessUiState =
  | "failed"
  | "idle"
  | "loading"
  | "ready"
  | "unavailable";

type TrackerClientEditDraft = {
  assignedToId: string | null;
  businessName: string;
  displayName: string;
  id: string;
  originalAssignedToId: string | null;
};

type TrackerClientMutationFeedback = {
  kind: "error" | "success";
  message: string;
};

const TASK_CLIENT_LINKS: Record<string, string | null> = {
  "task-1": "c2",
  "task-2": "c6",
  "task-3": "c4",
  "task-4": "c5",
  "task-5": "c3",
  "task-6": null,
};

const CLIENT_DETAILS: Record<string, ClientDetail> = {
  c1: {
    activity: [
      ["Jul 20", "Check-in sent after six days without a reply"],
      ["Jul 08", "Application pause confirmed"],
      ["Jun 30", "Profile refreshed at 54 of 100"],
    ],
    health: "attention",
    next: "Review two actions that are 12 days overdue",
    plan: [
      { state: "overdue", title: "Bring the fuel card below the 29% target" },
      { state: "overdue", title: "Open a net-30 vendor account" },
      { state: "active", title: "Keep new applications paused" },
    ],
    utilization: "71%",
  },
  c2: {
    activity: [
      ["Today", "A Team chat draft entered human review"],
      ["Jul 15", "Business identity action completed"],
      ["Jul 01", "Profile refreshed at 58 of 100"],
    ],
    health: "review",
    next: "Review the held Team chat draft",
    plan: [
      { state: "active", title: "Bring the bakery card below the 29% target" },
      { state: "complete", title: "Match the business address across records" },
      { state: "active", title: "Keep new applications paused" },
    ],
    utilization: "44%",
  },
  c3: {
    activity: [
      ["Jul 20", "Bluevine result recorded at $45,000"],
      ["Jul 20", "Success fee balance updated"],
      ["Jul 14", "Bluevine application submitted"],
    ],
    health: "fee due",
    next: "Review the remaining success fee balance",
    plan: [
      { state: "complete", title: "Complete the utilization plan" },
      { state: "complete", title: "Open a vendor account" },
      { state: "complete", title: "Complete the approved application order" },
    ],
    utilization: "21%",
  },
  c4: {
    activity: [
      ["Jul 14", "US Bank application submitted"],
      ["Jul 08", "Cinderella profile reached 100"],
      ["Jun 30", "Application order confirmed"],
    ],
    health: "result due",
    next: "Record the US Bank result when it arrives",
    plan: [
      { state: "active", title: "Pause new applications until a result arrives" },
      { state: "active", title: "Keep utilization below 25%" },
      { state: "complete", title: "Finish the paydown plan" },
    ],
    utilization: "24%",
  },
  c5: {
    activity: [
      ["Jul 19", "Two plan actions prepared for operator review"],
      ["Jul 12", "Profile refreshed at 62 of 100"],
      ["Jun 24", "Enrollment and first analysis completed"],
    ],
    health: "on pace",
    next: "Review the proposed Chase Ink payment target",
    plan: [
      { state: "proposed", title: "Bring Chase Ink below the 29% target" },
      { state: "proposed", title: "Review the business account limit after payment" },
      { state: "active", title: "Keep new applications paused" },
    ],
    utilization: "38%",
  },
  c6: {
    activity: [
      ["Jul 18", "Cinderella profile reached 100"],
      ["Jul 18", "Application order confirmed"],
      ["Jul 10", "Profile refreshed at 100 of 100"],
    ],
    health: "on pace",
    next: "Start the first application in the confirmed order",
    plan: [
      { state: "complete", title: "Confirm the application order" },
      { state: "active", title: "Pause other applications during the sequence" },
    ],
    utilization: "19%",
  },
  c7: {
    activity: [
      ["Jul 17", "Payment target reported"],
      ["Jun 28", "Vendor account opened"],
      ["Jun 15", "Profile refreshed at 66 of 100"],
    ],
    health: "on pace",
    next: "Verify the payment after the Aug 1 update",
    plan: [
      { state: "active", title: "Wait for the scheduled source update" },
      { state: "complete", title: "Open a vendor account" },
      { state: "active", title: "Keep new applications paused" },
    ],
    utilization: "31%",
  },
  c8: {
    activity: [
      ["Jun 14", "Client fee recorded as paid"],
      ["Jun 12", "Funding result recorded at $150,000"],
      ["Jun 02", "Application sequence completed"],
    ],
    health: "funded",
    next: "Keep the completed profile available for future planning",
    plan: [
      { state: "complete", title: "Complete the approved application order" },
      { state: "active", title: "Maintain the post-funding plan" },
    ],
    utilization: "12%",
  },
};

const clients: Client[] = DEMO_CLIENTS.map((client) => ({
  ...client,
  ...CLIENT_DETAILS[client.clientId],
}));

/**
 * One searchable client, as the task composer needs it.
 *
 * The typeahead used to close over the module-level fixture `clients` array, so
 * a signed-in operator linking a task searched somebody else's book and could
 * only ever link a fixture handle. It takes its candidates as a prop now, and
 * the surface hands it the durable tracker list whenever there is one.
 */
type TaskClientOption = {
  business: string | null;
  id: string;
  name: string;
};

function TaskClientTypeahead({
  clients: candidates,
  id,
  label,
  onChange,
  value,
}: {
  clients: readonly TaskClientOption[];
  id: string;
  label: string;
  onChange: (clientId: string | null) => void;
  value: string | null;
}) {
  const optionLabel = (client: TaskClientOption) =>
    client.business ? `${client.name} — ${client.business}` : client.name;
  const selected = candidates.find((client) => client.id === value) ?? null;
  const [query, setQuery] = useState(selected ? optionLabel(selected) : "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = candidates.filter((client) =>
    !normalizedQuery || `${client.name} ${client.business ?? ""}`.toLowerCase().includes(normalizedQuery),
  );
  const options: Array<TaskClientOption | null> = [null, ...matches];

  function select(client: TaskClientOption | null) {
    onChange(client?.id ?? null);
    setQuery(client ? optionLabel(client) : "");
    setOpen(false);
    setActiveIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        return (current + direction + options.length) % options.length;
      });
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      select(options[activeIndex] ?? null);
    }
  }

  return (
    <div
      className="relative min-w-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label className="text-xs font-medium text-muted-foreground" htmlFor={id}>{label}</label>
      <Input
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        aria-autocomplete="list"
        aria-controls={`${id}-options`}
        aria-expanded={open}
        className="mt-1.5"
        id={id}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          setActiveIndex(candidates.some((client) => `${client.name} ${client.business ?? ""}`.toLowerCase().includes(nextQuery.trim().toLowerCase())) ? 1 : 0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search client or business"
        role="combobox"
        value={query}
      />
      {open ? (
        <div className="absolute z-40 mt-1 max-h-56 w-full min-w-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg" id={`${id}-options`} role="listbox">
          {options.length === 1 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No clients are available to link.
            </p>
          ) : null}
          {options.map((client, index) => (
            <button
              aria-selected={(client?.id ?? null) === value}
              className={cn(
                "block min-h-11 w-full rounded-md px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                index === activeIndex && "bg-muted",
              )}
              id={`${id}-option-${index}`}
              key={client?.id ?? "no-client"}
              onClick={() => select(client)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              type="button"
            >
              <span className="block text-sm font-medium">{client?.name ?? "No client"}</span>
              {client ? <span className="mt-0.5 block text-xs text-muted-foreground">{client.business ?? "No business recorded"}</span> : <span className="mt-0.5 block text-xs text-muted-foreground">Leave this task unlinked</span>}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const TEAM_ROLE_LABELS: Readonly<Record<TrackerAssigneeOrgRole, TeamRole>> = {
  admin: "Admin",
  commando: "Commando",
  funding_specialist: "Funding specialist",
  manager: "Manager",
  member: "Member",
  owner: "Owner",
  prep_specialist: "Prep specialist",
};

const TEAM_ROLE_VALUES = Object.keys(TEAM_ROLE_LABELS) as TrackerAssigneeOrgRole[];
const TEAM_ROLE_BY_LABEL = Object.fromEntries(
  Object.entries(TEAM_ROLE_LABELS).map(([value, label]) => [label, value]),
) as Partial<Record<TeamRole, TrackerAssigneeOrgRole>>;

/** The fixture shell's roster. Never reaches a signed-in workspace. */
const TEAM_ROWS: TeamRow[] = [
  { active: true, id: "tm-alec", isCurrentUser: true, name: "Alec Rivera", role: "Owner", email: "alec@apexfunding.co", lastActive: "Today" },
  { active: true, id: "tm-ivy", isCurrentUser: false, name: "Ivy Tran", role: "Admin", email: "ivy@apexfunding.co", lastActive: "Today" },
  { active: true, id: "tm-dana", isCurrentUser: false, name: "Dana Whitfield", role: "Prep specialist", email: "dana@apexfunding.co", lastActive: "Today" },
  { active: true, id: "tm-marcus", isCurrentUser: false, name: "Marcus Cole", role: "Funding specialist", email: "marcus@apexfunding.co", lastActive: "Yesterday" },
  { active: true, id: "tm-sam", isCurrentUser: false, name: "Sam Ortiz", role: "Client success specialist", email: "sam@apexfunding.co", lastActive: "Jul 17" },
  { active: true, id: "tm-naomi", isCurrentUser: false, name: "Naomi Feld", role: "Manager", email: "naomi@apexfunding.co", lastActive: "Today" },
  { active: true, id: "tm-ray", isCurrentUser: false, name: "Ray Gibbs", role: "Prep specialist", email: "ray@apexfunding.co", lastActive: "Jul 10" },
];

/**
 * The two illustrative referral partners the fixture book is shared with.
 *
 * They stay for the fixture shell and reach no signed-in workspace. There is no
 * operator-facing affiliate list on this tree — `src/app/api/affiliates` holds
 * `me` (affiliate-role only) and the per-affiliate share writes, and nothing
 * that enumerates an org's partners — so a real workspace gets the tracker's
 * "no affiliate" filter and an empty sharing panel rather than these names,
 * which would filter a healthy book down to nothing.
 */
const AFFILIATES = [
  { id: "aff-northstar", name: "Northstar Partners" },
  { id: "aff-summit", name: "Summit Referral Network" },
] as const;

// The shape of the sidebar, without its counters. Badges are attached inside
// the surface, because the only honest count is the one the view behind the
// item is reading — see `@/lib/operator/nav-badges`. The Inbox item carried a
// literal `2`, and nothing durable backs it: `/api/support/threads` has no
// unread concept at all (`SupportInboxThread` is id, kind, subject, status,
// lastActivityAt), so the badge is gone rather than invented.
const NAV_SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { icon: Home, id: "home", label: "Dashboard" },
      { icon: Users, id: "clients", label: "Clients" },
      { icon: Inbox, id: "inbox", label: "Inbox" },
      { icon: CheckSquare2, id: "tasks", label: "Tasks" },
    ],
  },
  {
    label: "Platform",
    items: [
      { icon: Landmark, id: "bank-vault", label: "Bank Vault" },
      { icon: BookOpen, id: "knowledge", label: "Client Trainings" },
    ],
  },
  {
    label: "Account",
    items: [
      { icon: UserCog, id: "team", label: "Team & Affiliates" },
      { icon: Settings, id: "settings", label: "Settings & Billing" },
      { icon: UserPlus, id: "onboarding", label: "Workspace Setup" },
    ],
  },
];

const BANK_TREND_PRESENTATION = {
  "Trending up": {
    Icon: ChevronsUp,
    className: "border-[color-mix(in_srgb,var(--consumer-positive),black_35%)] bg-[color-mix(in_srgb,var(--consumer-positive),black_35%)] text-white",
  },
  Up: {
    Icon: ArrowUp,
    className: "border-[color-mix(in_srgb,var(--consumer-positive),transparent_62%)] bg-[color-mix(in_srgb,var(--consumer-positive),transparent_88%)] text-[var(--consumer-positive)]",
  },
  Neutral: {
    Icon: Minus,
    className: "border-border bg-muted/40 text-foreground",
  },
  Down: {
    Icon: ArrowDown,
    className: "border-[color-mix(in_srgb,var(--consumer-negative),transparent_62%)] bg-[color-mix(in_srgb,var(--consumer-negative),transparent_88%)] text-[var(--consumer-negative)]",
  },
  "Trending down": {
    Icon: ChevronsDown,
    className: "border-[color-mix(in_srgb,var(--consumer-negative),black_35%)] bg-[color-mix(in_srgb,var(--consumer-negative),black_35%)] text-white",
  },
} as const;

// The roster spans two calendar years, so the year has to stay visible or a
// 2025 start date reads as this year's.
function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

const TRAINING_VIDEO_HOSTS = new Set([
  "loom.com",
  "vimeo.com",
  "www.loom.com",
  "www.vimeo.com",
  "www.youtube.com",
  "youtu.be",
  "youtube.com",
]);

function trainingRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hostedTrainingVideoUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && TRAINING_VIDEO_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function trainingVideoSource(videoUrl: string): TrainingSource {
  const host = new URL(videoUrl).hostname.toLowerCase();
  if (host === "loom.com" || host === "www.loom.com") return "Loom";
  if (host === "vimeo.com" || host === "www.vimeo.com") return "Vimeo";
  return "YouTube";
}

function trainingRowFromResponse(value: unknown): TrainingRow | null {
  if (!trainingRecord(value)
      || !isTrackerUuid(value.id)
      || (value.audience !== "client" && value.audience !== "operator")
      || (value.source !== "operator" && value.source !== "platform")
      || (value.source === "platform"
        ? value.orgId !== null
        : !isTrackerUuid(value.orgId))
      || typeof value.title !== "string" || value.title.trim().length === 0
      || value.title.length > 200
      || !hostedTrainingVideoUrl(value.videoUrl)
      || typeof value.body !== "string" || value.body.trim().length === 0
      || value.body.length > 20_000
      || typeof value.published !== "boolean"
      || !(value.takedownReason === null || typeof value.takedownReason === "string")
      || !(value.takenDownBy === null || isTrackerUuid(value.takenDownBy))
      || !(value.takenDownAt === null
        || (typeof value.takenDownAt === "string" && Number.isFinite(Date.parse(value.takenDownAt))))) {
    return null;
  }
  return {
    apiAudience: value.audience,
    audience: value.source === "platform" ? "platform-training" : "client-facing",
    id: value.id,
    published: value.published,
    recordSource: value.source,
    source: trainingVideoSource(value.videoUrl),
    summary: value.body,
    title: value.title,
    videoUrl: value.videoUrl,
    takedownReason: value.takedownReason,
    takenDownBy: value.takenDownBy,
    takenDownAt: value.takenDownAt,
  };
}

function trainingRowsFromResponse(value: unknown): TrainingRow[] | null {
  if (!trainingRecord(value) || !Array.isArray(value.trainings)) return null;
  const rows = value.trainings.map(trainingRowFromResponse);
  return rows.some((row) => row === null) ? null : rows as TrainingRow[];
}

type TeamMemberDeactivateResult =
  | { applied: boolean; outcome: "accepted" }
  | { message: string; outcome: "failed" };

async function deactivateOperatorTeamMember(
  memberId: string,
  fetcher: typeof fetch = fetch,
): Promise<TeamMemberDeactivateResult> {
  if (!isTrackerUuid(memberId)) {
    return { message: "This team member does not have a durable profile id.", outcome: "failed" };
  }
  try {
    const response = await fetcher(
      `/api/invites/members/${encodeURIComponent(memberId)}/deactivate`,
      {
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      },
    );
    const value: unknown = await response.json().catch(() => null);
    const body = trainingRecord(value) ? value : null;
    if (!response.ok) {
      const error = trainingRecord(body?.error) ? body.error : null;
      return {
        message: typeof error?.message === "string"
          ? error.message
          : "The team member could not be removed.",
        outcome: "failed",
      };
    }
    const member = trainingRecord(body?.member) ? body.member : null;
    if (
      member?.profileId !== memberId
      || typeof member.applied !== "boolean"
    ) {
      return { message: "The member response could not be verified.", outcome: "failed" };
    }
    return { applied: member.applied, outcome: "accepted" };
  } catch {
    return { message: "The team member could not be removed.", outcome: "failed" };
  }
}

type OperatorTrackerClientPatch = TrackerMetadataPatch | TrackerClientStatusPatch;

async function patchOperatorTrackerClient(
  clientId: string,
  patch: OperatorTrackerClientPatch,
  fetcher: typeof fetch = fetch,
): Promise<TrackerClient> {
  if (!isTrackerUuid(clientId)) throw new Error("This client does not have a durable id.");
  const response = await fetcher(`/api/clients/${encodeURIComponent(clientId)}`, {
    body: JSON.stringify(patch),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  const value: unknown = await response.json().catch(() => null);
  const body = trainingRecord(value) ? value : null;
  if (!response.ok) {
    const error = trainingRecord(body?.error) ? body.error : null;
    throw new Error(
      typeof error?.message === "string"
        ? error.message
        : "The client could not be updated.",
    );
  }
  const client = trainingRecord(body?.client) ? body.client : null;
  if (
    client?.id !== clientId
    || typeof client.displayName !== "string"
    || !(client.businessName === null || typeof client.businessName === "string")
    || !(client.assignedToId === null || isTrackerUuid(client.assignedToId))
    || !(client.goalCents === null || (typeof client.goalCents === "number" && Number.isSafeInteger(client.goalCents)))
    || typeof client.matchesUnlockedOverride !== "boolean"
    || !isTrackerClientStatus(client.status)
  ) throw new Error("The client update response could not be verified.");
  if (
    ("status" in patch && client.status !== patch.status)
    || ("displayName" in patch && client.displayName !== patch.displayName?.trim())
    || ("businessName" in patch && client.businessName !== (
      patch.businessName === null ? null : patch.businessName?.trim()
    ))
    || ("assignedToId" in patch && client.assignedToId !== patch.assignedToId)
    || ("goalCents" in patch && client.goalCents !== patch.goalCents)
    || (
      "matchesUnlockedOverride" in patch
      && client.matchesUnlockedOverride !== patch.matchesUnlockedOverride
    )
  ) throw new Error("The server did not confirm the requested client change.");
  return client as unknown as TrackerClient;
}

function csvCell(value: string | number | null): string {
  const raw = value === null ? "" : String(value);
  // Spreadsheet programs execute cells beginning with these characters. A
  // leading apostrophe keeps operator-entered names and businesses as text.
  const safe = /^(?:[\t\r]|\s*[=+\-@])/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function trackerClientsCsv(clients: readonly TrackerClient[]): string {
  const rows = clients.map((client) => [
    client.id,
    client.displayName,
    client.businessName,
    TRACKER_STAGE_LABELS[client.stage],
    client.status,
    client.assignedToName,
    client.startedAt,
    client.lastActivityAt,
    client.fundingApprovedCents,
  ]);
  return [
    ["Client ID", "Client", "Business", "Stage", "Status", "Team member", "Started", "Last activity", "Funded cents"],
    ...rows,
  ].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function downloadTrackerClientsCsv(clients: readonly TrackerClient[], now = new Date()) {
  const blob = new Blob([`\uFEFF${trackerClientsCsv(clients)}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = `mostfundable-clients-${now.toISOString().slice(0, 10)}.csv`;
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
}

function localDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function taskViewStatus(task: OperatorTask, today: string | null): TaskViewStatus {
  if (task.status === "completed") return "completed";
  return task.dueOn !== null && today !== null && task.dueOn < today
    ? "overdue"
    : "pending";
}

function taskFailureMessage(error: unknown): string {
  return error instanceof TaskClientError
    ? error.message
    : "Tasks are temporarily unavailable.";
}

type TrackerFilterRestore = Readonly<{
  affiliate(value: string): void;
  mode(value: ClientMode): void;
  query(value: string): void;
  restored(): void;
  stage(value: FundingStage): void;
  status(value: TrackerClientStatus | "all"): void;
  team(value: string): void;
}>;

/** Hydrate the editable tracker controls from the browser URL after mount. */
function restoreTrackerFiltersFromLocation(apply: TrackerFilterRestore): void {
  const params = new URL(window.location.href).searchParams;
  const savedQuery = params.get("clients_q");
  const savedStage = params.get("clients_stage");
  const savedMember = params.get("clients_member");
  const savedAffiliate = params.get("clients_affiliate");
  const savedStatus = params.get("clients_status");
  const savedMode = params.get("clients_view");
  if (savedQuery !== null) apply.query(savedQuery.slice(0, 160));
  if (isTrackerStage(savedStage)) apply.stage(TRACKER_STAGE_LABELS[savedStage] as FundingStage);
  if (isTrackerUuid(savedMember)) apply.team(savedMember);
  if (savedAffiliate === "none" || isTrackerUuid(savedAffiliate)) apply.affiliate(savedAffiliate);
  if (savedStatus === "all" || isTrackerClientStatus(savedStatus)) apply.status(savedStatus);
  if (
    savedMode === "cards"
    || savedMode === "table"
    || savedMode === "board"
    || savedMode === "timeline"
  ) apply.mode(savedMode);
  apply.restored();
}

function revenueRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function revenueCents(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function nullableRevenueTimestamp(value: unknown): value is string | null {
  return value === null
    || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function parsePlatformPlanStatus(value: unknown): ConsumerPlanStatus | null | undefined {
  if (value === null) return null;
  return typeof value === "string"
    && CONSUMER_PLAN_STATUSES.includes(value as ConsumerPlanStatus)
    ? value as ConsumerPlanStatus
    : undefined;
}

function parseOperatorPlanRosterRow(value: unknown): OperatorPlanRosterRow | null {
  if (!revenueRecord(value)) return null;
  const status = parsePlatformPlanStatus(value.status);
  const priceCents = value.priceCents === null ? null : revenueCents(value.priceCents);
  if (!isTrackerUuid(value.clientId)
      || typeof value.clientName !== "string" || value.clientName.trim().length === 0
      || status === undefined
      || (value.priceCents !== null && priceCents === null)
      || !(value.currency === null || (typeof value.currency === "string" && value.currency.trim().length > 0))
      || !nullableRevenueTimestamp(value.activatedAt)
      || !nullableRevenueTimestamp(value.cancelledAt)
      || !nullableRevenueTimestamp(value.updatedAt)) return null;
  return Object.freeze({
    activatedAt: value.activatedAt,
    cancelledAt: value.cancelledAt,
    clientId: value.clientId,
    clientName: value.clientName.trim(),
    currency: value.currency,
    priceCents,
    status,
    updatedAt: value.updatedAt,
  });
}

function parseOperatorRevenueLedger(value: unknown): OperatorRevenueLedgerMonth | null | undefined {
  if (value === null) return null;
  if (!revenueRecord(value)) return undefined;
  const baseAmountCents = revenueCents(value.baseAmountCents);
  const amountCents = value.amountCents === null ? null : revenueCents(value.amountCents);
  const sourceRowCount = revenueCents(value.sourceRowCount);
  const pctSnapshot = value.pctSnapshot === null
    ? null
    : typeof value.pctSnapshot === "number"
        && Number.isFinite(value.pctSnapshot)
        && value.pctSnapshot >= 0
        && value.pctSnapshot <= 100
      ? value.pctSnapshot
      : undefined;
  const settlementStatus = value.settlementStatus;
  const incompleteCode = value.incompleteCode;
  if (baseAmountCents === null
      || (value.amountCents !== null && amountCents === null)
      || sourceRowCount === null
      || pctSnapshot === undefined
      || typeof value.isComplete !== "boolean"
      || !(incompleteCode === null || typeof incompleteCode === "string")
      || value.isComplete !== (incompleteCode === null)
      || !(settlementStatus === "accrued" || settlementStatus === "exported"
        || settlementStatus === "paid" || settlementStatus === "reversed")) return undefined;
  return Object.freeze({
    amountCents,
    baseAmountCents,
    incompleteCode,
    isComplete: value.isComplete,
    pctSnapshot,
    settlementStatus,
    sourceRowCount,
  });
}

function parseOperatorPlatformRevenue(value: unknown): OperatorPlatformRevenue | null {
  if (!revenueRecord(value)
      || typeof value.month !== "string"
      || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.month)
      || !Array.isArray(value.roster)) return null;
  const ledger = parseOperatorRevenueLedger(value.ledger);
  if (ledger === undefined) return null;
  const roster: OperatorPlanRosterRow[] = [];
  for (const row of value.roster) {
    const parsed = parseOperatorPlanRosterRow(row);
    if (parsed === null) return null;
    roster.push(parsed);
  }
  return Object.freeze({ ledger, month: value.month, roster: Object.freeze(roster) });
}

function formatRevenueMoney(cents: number | null, currency = "USD"): string {
  if (cents === null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      style: "currency",
    }).format(cents / 100);
  } catch {
    return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
}

function platformPlanStatusLabel(status: ConsumerPlanStatus | null): string {
  if (status === null) return "No plan record";
  if (status === "review_required") return "Review required";
  return titleCase(status);
}

function platformPlanStatusTone(
  status: ConsumerPlanStatus | null,
): "danger" | "info" | "neutral" | "success" | "warning" {
  if (status === "active") return "success";
  if (status === "authorized") return "info";
  if (status === "failed") return "danger";
  if (status === "review_required") return "warning";
  return "neutral";
}

function platformRevenueIncompleteMessage(code: string | null): string {
  if (code === "monitoring_split_unset") {
    return "The revenue-share percentage has not been configured for this month.";
  }
  if (code === "paid_invoice_evidence_missing") {
    return "Paid-invoice evidence is incomplete for this month.";
  }
  if (code === "consumer_subscriptions_missing") {
    return "Consumer subscription evidence is incomplete for this month.";
  }
  return "This month’s ledger is incomplete and did not record a usable reason.";
}

function subscribeToNothing() {
  return () => {};
}

// A missing value renders an em dash and the reason beside it, never a zero:
// the durable client peek is read by someone deciding what to do next, and
// "no analysis yet" and "no open actions" are opposite answers.
function TrackerDetailFields({
  fields,
}: {
  fields: readonly TrackerDetailField[];
}) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
      {fields.map((field) => (
        <Fragment key={field.label}>
          <dt className="text-muted-foreground">{field.label}</dt>
          <dd className="tabular-nums">
            {field.value === null ? (
              <span className="text-muted-foreground">
                <span aria-hidden>—</span>
                <span className="sr-only">Not available:</span>{" "}
                <span className="text-xs">{field.note}</span>
              </span>
            ) : (
              field.value
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

const PLATFORM_PLAN_PRICE = 49;
const PLATFORM_REV_SHARE = 0.4;
/**
 * The workspace's percentage success fee, as one number.
 *
 * Every fixture total below multiplies the funded amount by this, and the
 * durable workspace default sent to `/api/fees/org-defaults` is the same rate
 * expressed as a percentage. Two copies of the rate would drift the moment one
 * of them was edited, and the drift would be invisible: the table would show
 * one fee and the stored agreement would compute another.
 */
const SUCCESS_FEE_RATE = 0.1;
const FIXTURE_SUCCESS_FEE_PCT = SUCCESS_FEE_RATE * 100;

function parseMoney(value: string | number) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round((amount + Number.EPSILON) * 100) / 100);
}

function healthTone(
  health: Health,
): "danger" | "info" | "neutral" | "success" | "warning" {
  if (health === "review") return "danger";
  if (health === "attention" || health === "fee due") return "warning";
  if (health === "result due") return "info";
  if (health === "funded") return "success";
  return "neutral";
}

function stepTone(
  state: PlanStepState,
): "danger" | "info" | "neutral" | "success" | "warning" {
  if (state === "complete") return "success";
  if (state === "overdue") return "danger";
  if (state === "proposed") return "warning";
  return "info";
}

// Sections that only ever render inside the support sheet. The page behind the
// sheet already owns the single <h1>, so these headings stay at <h2>.
function SheetSectionHeader({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: React.ReactNode;
  description?: string;
  icon: typeof Home;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <h2 className="flex items-center gap-3 text-lg font-semibold tracking-[-0.02em] text-foreground">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary-ink">
            <Icon aria-hidden className="size-4" />
          </span>
          {title}
        </h2>
        {description ? (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function Segmented<T extends string>({
  disabled = false,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  onChange: (value: T) => void;
  options: Array<{ icon?: typeof Home; label: string; value: T }>;
  value: T;
}) {
  return (
    <div
      className="inline-flex w-fit rounded-lg border border-border bg-muted/50 p-1"
      role="group"
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            aria-pressed={value === option.value}
            className={cn(
              "flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              value === option.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            disabled={disabled}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {Icon ? <Icon aria-hidden className="size-3.5" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function MobileField({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[0.68rem] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

function ClientProgress({
  client,
  fundedAmount,
  goal,
}: {
  client: Client;
  fundedAmount: number;
  goal: number;
}) {
  const fundingStage = ["Applying", "Funded", "Graduate"].includes(client.stage);
  if (!fundingStage) {
    return (
      <ReadinessBar
        label={client.stage === "Ready" ? "Cinderella profile complete" : client.stage}
        value={client.profileCompletion}
      />
    );
  }

  const progress = goal > 0 ? Math.min(100, (fundedAmount / goal) * 100) : 0;
  return (
    <ReadinessBar
      label={`${formatDemoMoney(fundedAmount)} funded of ${formatDemoMoney(goal)} goal`}
      value={progress}
    />
  );
}

function StatStrip({
  stats,
}: {
  stats: Array<[label: string, value: string, detail: string]>;
}) {
  return (
    <dl className="grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {stats.map(([label, value, detail], index) => (
        <div
          className={cn(
            "border-border px-4 py-4",
            index > 0 && "border-t",
            index % 2 === 1 && "sm:border-l",
            index === 1 && "sm:border-t-0",
            index === 2 && "xl:border-l xl:border-t-0",
            index === 3 && "xl:border-l-0 xl:border-t",
            index > 3 && "xl:border-l xl:border-t",
            index > 0 && "2xl:border-l 2xl:border-t-0",
          )}
          key={label}
        >
          <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </dt>
          <dd className="mt-1 text-xl font-semibold tracking-[-0.03em] tabular-nums">
            {value}
          </dd>
          <dd className="mt-1 text-xs text-muted-foreground">{detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OperatorSurface({
  affiliatesEnabled = false,
  applicationsEnabled = false,
  feesEnabled = false,
  onOpenProfiles,
  onPreviewConsumerApplications,
  paidRefreshEnabled = false,
  realAuth = false,
  sessionIdentity,
  tenantBrand,
  tenancyEnabled = false,
  timelineEnabled = false,
  trackerEnabled = false,
  vaultEnabled = false,
}: SurfaceProps & {
  affiliatesEnabled?: boolean;
  applicationsEnabled?: boolean;
  feesEnabled?: boolean;
  onPreviewConsumerApplications?: (clientId: string) => void;
  paidRefreshEnabled?: boolean;
  /** True on `(surfaces)/operator`. Optional so `<DemoApp />` keeps its shell. */
  realAuth?: boolean;
  sessionIdentity?: SessionDisplayIdentity;
  tenantBrand?: PublishedBrand;
  tenancyEnabled?: boolean;
  /** `FEATURE_TIMELINE`. Off is the shipped Inbox thread, unchanged. */
  timelineEnabled?: boolean;
  trackerEnabled?: boolean;
  vaultEnabled?: boolean;
}) {
  /**
   * Whether a signed-in workspace is looking at this, rather than the fixture
   * demo shell.
   *
   * Deliberately an OR across every signal the route can send instead of one
   * feature flag. `<DemoApp />` mounts this component with two callbacks and
   * nothing else, so anything arriving from `(surfaces)/operator/page.tsx` —
   * the session identity, the published brand, or any rail flag — means a real
   * operator is reading the screen. Branching on a single flag is what left
   * fixture panels reachable behind a flag that happened to be off; an OR can
   * only ever classify more of the surface as durable, never less, and a
   * signal that stops arriving costs a panel its fixtures rather than handing
   * a real workspace somebody else's book.
   */
  const durableWorkspace =
    realAuth
    || sessionIdentity !== undefined
    || tenantBrand !== undefined
    || affiliatesEnabled
    || applicationsEnabled
    || feesEnabled
    || paidRefreshEnabled
    || tenancyEnabled
    || trackerEnabled
    || vaultEnabled;
  /**
   * The name this surface writes under, in the shell header and in both Inbox
   * composers.
   *
   * One constant rather than three copies of the same `??` chain, because the
   * three used to disagree the moment one of them was edited. A signed-in
   * workspace with no org on its session gets a neutral placeholder: naming
   * somebody else's company over a real operator's reply is the failure, and
   * "Apex Funding Partners" is a company none of them work for.
   */
  const [liveTenantBrand, setLiveTenantBrand] = useState(tenantBrand);
  const [liveWorkspaceName, setLiveWorkspaceName] = useState(
    () => sessionIdentity?.orgName
      ?? (durableWorkspace ? "Your workspace" : "Apex Funding Partners"),
  );
  const workspaceBrandName = liveTenantBrand?.portalName ?? liveWorkspaceName;
  const publishedBrand = operatorBrandPresentation(liveTenantBrand);
  const {
    addApplicationNote,
    affiliateShares,
    applications,
    bankStatsByPeriod: fixtureBankStatsByPeriod,
    clientApplicationPresentation,
    getApplicationsForClient,
    getClientFundedAmount: getTrackedClientFundedAmount,
    matchesUnlocked,
    setMatchesUnlocked,
    recordApplicationOutcome,
    resolveApplicationPresentation,
    setAffiliatePaymentStatus,
    setClientApplicationPresentation,
    setExpectedCommission,
    setOperatorApplicationStatus,
    setWorkspaceApplicationPresentation,
    shareClientWithAffiliate,
    unshareClientFromAffiliate,
    workspaceApplicationPresentation,
  } = useFeedbackSession();

  function getClientFundedAmount(clientId: string) {
    return deriveClientFundedAmount(
      clientId,
      getTrackedClientFundedAmount(clientId),
    );
  }

  const [view, setView] = useState<View>("home");
  const [clientMode, setClientMode] = useState<ClientMode>("cards");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<FundingStage | "All stages">(
    "All stages",
  );
  const [teamFilter, setTeamFilter] = useState("all");
  const [affiliateFilter, setAffiliateFilter] = useState("all");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  // The durable peek is separate state, not a second id in `selectedClientId`.
  // The fixture drawer resolves that id against `DEMO_CLIENTS`, so a tracker
  // UUID would open an empty sheet; keeping the two apart is also what
  // guarantees a real client can never pick up a fixture client's numbers.
  const [selectedTrackerClientId, setSelectedTrackerClientId] = useState<
    string | null
  >(null);
  const [trackerStatusFilter, setTrackerStatusFilter] = useState<
    TrackerClientStatus | "all"
  >("active");
  const [trackerFiltersRestored, setTrackerFiltersRestored] = useState(false);
  const trackerFiltersRestoreRequested = useRef(false);
  const [trackerSelectedIds, setTrackerSelectedIds] = useState<Set<string>>(
    new Set(),
  );
  const [trackerBulkAssigneeId, setTrackerBulkAssigneeId] = useState("choose");
  const [trackerBulkAssignmentCandidateId, setTrackerBulkAssignmentCandidateId] =
    useState<string | null>(null);
  const [trackerBulkArchiveCandidate, setTrackerBulkArchiveCandidate] = useState(false);
  const [trackerStatusCandidate, setTrackerStatusCandidate] = useState<{
    id: string;
    name: string;
    status: TrackerClientStatus;
  } | null>(null);
  const [trackerEditDraft, setTrackerEditDraft] = useState<TrackerClientEditDraft | null>(null);
  const [trackerMutationPending, setTrackerMutationPending] = useState<string | null>(null);
  const [trackerMutationFeedback, setTrackerMutationFeedback] =
    useState<TrackerClientMutationFeedback | null>(null);
  const [trackerDrawerTab, setTrackerDrawerTab] = useState<DrawerTab>("overview");
  const [trackerCreditScoreRead, setTrackerCreditScoreRead] = useState<{
    clientId: string;
    result: OperatorCreditScoresRead;
  } | null>(null);
  const [enroll, setEnroll] = useState<EnrollConfig | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("overview");
  const [approvedSteps, setApprovedSteps] = useState<Set<string>>(new Set());
  const [addedSteps, setAddedSteps] = useState<Record<string, string[]>>({});
  const [goalOverrides, setGoalOverrides] = useState<Record<string, number>>(
    () =>
      Object.fromEntries(
        DEMO_CLIENTS.map((client) => [client.clientId, client.fundingGoal]),
      ),
  );
  const [period, setPeriod] = useState<OutcomePeriod>("30d");
  const [bankVaultTab, setBankVaultTab] = useState<BankVaultTab>("banks");
  const [bankViewMode, setBankViewMode] = useState<BankViewMode>("list");
  const [selectedBankId, setSelectedBankId] = useState("bluevine");
  const [detailBankId, setDetailBankId] = useState<string | null>(null);

  // FEATURE_VAULT (Phase 8). The swap happens once, here, at the source of the
  // data rather than at each of the four places `renderBankVault` reads it: the
  // list, the Updates tab, the trend tiles and the detail panel all consume
  // `bankStatsByPeriod`, so redefining that one name behind the flag moves every
  // Bank Vault view to durable data without touching a rendered line. With the
  // flag off — the committed default — this is the fixture derivation itself,
  // byte for byte.
  //
  // The fixtures are the fallback for exactly one case: the flag being off.
  // A read that is loading or refused does NOT fall through to them — it
  // renders the unreadable notice below, the same way the fee ledger does,
  // because illustrative lenders shown to someone who believes they are looking
  // at their own records are worse than an honest empty state.
  //
  // The fetch is gated on the section being open as well as on the flag, so an
  // operator who never opens the Bank Vault never issues the request and never
  // collects a console 4xx for a route that would refuse them.
  const vaultBanks = useVaultBanks(vaultEnabled, view === "bank-vault");
  const bankListSource = bankVaultSource(vaultEnabled, vaultBanks.state);
  const bankStatsByPeriod =
    bankListSource === "durable" && vaultBanks.byPeriod
      ? vaultBanks.byPeriod
      : fixtureBankStatsByPeriod;
  const bankVaultUnreadable = bankListSource === "loading" || bankListSource === "failed";
  // #198/#212's disclosures name the data source, so they have to move with it.
  // A page that says "illustrative fixtures with no external data connections"
  // while rendering a synced lender catalog is a disclosure that is false, which
  // is worse than no disclosure at all. Off is byte-identical to what shipped.
  const bankVaultHeaderCopy =
    "Historical operator outcomes. Click a bank name to open its detail page; qualification context lives inside each bank item." +
    (vaultEnabled
      ? " Bank detail pages read a lender catalog synced nightly from CCA VAULT."
      : " Bank detail pages are illustrative CCA VAULT fixtures with no external data connections.");
  const bankVaultSourceCopy = vaultEnabled
    ? "Bank detail pages read a lender catalog synced nightly from CCA VAULT. Historical outcomes are records, not offers."
    : "Bank detail pages use illustrative local fixtures with no external data connections. Historical outcomes are records, not offers.";
  // `selectedBankId` initialises to the first fixture handle, which is the right
  // answer for the flag-off path and a handle the durable catalog need not
  // contain. Resolving it against whichever catalog is actually rendering keeps
  // the trend tiles and the comment box pointed at a lender that exists instead
  // of at nothing; the state itself is left alone so the operator's choice
  // survives a period change.
  const activeBankId =
    bankStatsByPeriod["30d"].some((bank) => bank.bankId === selectedBankId)
      ? selectedBankId
      : (bankStatsByPeriod["30d"][0]?.bankId ?? selectedBankId);
  const vaultBankDetail = useVaultBankDetail(
    vaultEnabled && vaultBanks.state === "ready",
    detailBankId,
  );
  // Same rule one level down: with the flag on, a detail read that has not
  // landed must not be answered with the illustrative map.
  const bankDetailSource = bankVaultSource(vaultEnabled, vaultBankDetail.state);
  const durableBankDetail =
    bankDetailSource === "durable" && vaultBankDetail.detail
      ? toBankDetail(vaultBankDetail.detail)
      : null;
  const [bankCommentOpen, setBankCommentOpen] = useState(false);
  const [bankCommentDrafts, setBankCommentDrafts] = useState<Record<string, string>>(
    {},
  );
  /**
   * The trainings library, seeded from the illustrative set only off a durable
   * workspace.
   *
   * With `/api/trainings/config` answering `enabled: false` this list kept six
   * fixture lessons and let the operator rename, publish and unpublish them
   * against component state alone. On the illustrative shell that is the demo.
   * On a signed-in workspace it is six lessons the operator never made, shown as
   * their library, with working-looking publish controls over them — so the
   * durable arm starts empty and the panel below says the library is not
   * connected rather than filling it in.
   */
  const [trainings, setTrainings] = useState<TrainingRow[]>(() =>
    durableWorkspace ? [] : TRAINING_FIXTURES.map((training) => ({
      ...training,
      apiAudience: training.audience === "client-facing" ? "client" as const : "operator" as const,
      audience: training.audience as TrainingAudience,
      published: true,
      recordSource: training.audience === "platform-training" ? "platform" as const : "operator" as const,
      source: training.source as TrainingSource,
      videoUrl: training.videoUrl,
      takedownReason: null,
      takenDownBy: null,
      takenDownAt: null,
    })),
  );
  /**
   * May this surface edit the trainings list in component state alone?
   *
   * Only where such an edit is the disclosed simulation: the illustrative
   * shell. `ancillaryConfigState === "disabled"` alone said yes to a
   * signed-in operator too, and a Publish control that stores nothing is a
   * claim to their clients that nothing keeps.
   */
  const trainingsLocalFixture = !durableWorkspace;
  const [trainingAttestations, setTrainingAttestations] = useState<Set<string>>(
    new Set(),
  );
  const [trainingTab, setTrainingTab] = useState<TrainingTab>("your");
  const [trainingEditDraft, setTrainingEditDraft] = useState<TrainingEditDraft | null>(null);
  const [trainingDeleteCandidate, setTrainingDeleteCandidate] = useState<TrainingRow | null>(null);
  const [trainingDeletePendingId, setTrainingDeletePendingId] = useState<string | null>(null);
  const trainingPublicationPendingRef = useRef<Set<string>>(new Set());
  const [trainingPublicationPendingIds, setTrainingPublicationPendingIds] = useState<Set<string>>(
    new Set(),
  );
  const [trainingDeleteFeedback, setTrainingDeleteFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);
  const [ancillaryConfig, setAncillaryConfig] = useState<AncillaryBootstrap | null>(null);
  const [ancillaryConfigState, setAncillaryConfigState] = useState<"loading" | "disabled" | "enabled" | "unavailable">("loading");
  const [trainingsReload, setTrainingsReload] = useState(0);
  const [pricingCatalog, setPricingCatalog] = useState<OperatorPricingCatalog | null>(null);
  const [fixtureTeamRows, setFixtureTeamRows] = useState<TeamRow[]>(TEAM_ROWS);
  /**
   * The signed-in workspace's own people.
   *
   * `/api/clients` is the only route on this tree that names an operator member
   * at all, through each client's `assignedToId`/`assignedToName`, which is why
   * the Inbox already derives its team filter from it. The roster below is the
   * same derivation reused, so the seat list, the tracker's team filter and the
   * task assignee controls all name the same people — and name nobody the
   * workspace has not actually assigned work to, rather than the seven fixture
   * @apexfunding.co addresses.
   */
  const [teamDirectory, setTeamDirectory] = useState<SupportInboxDirectoryRead>({
    state: "unavailable",
  });
  const [teamDirectoryLoaded, setTeamDirectoryLoaded] = useState(false);
  // The "already asked" latch lives in a ref rather than in state: the request
  // is fired once per mount, and a state write inside the effect body would be
  // a cascading render the lint rule correctly refuses.
  const teamDirectoryRequested = useRef(false);
  const [teamTab, setTeamTab] = useState<"affiliates" | "members">("members");
  const [teamSeesAllClients, setTeamSeesAllClients] = useState(true);
  const [clientAssignmentMode, setClientAssignmentMode] =
    useState<ClientAssignmentMode>("round-robin");
  const [clientOwnerOverrides, setClientOwnerOverrides] = useState<
    Record<string, string>
  >({});
  const [clientAssignmentDraft, setClientAssignmentDraft] = useState<Set<string>>(new Set());
  const [clientAssignmentQuery, setClientAssignmentQuery] = useState("");
  const [selectedTeamMemberId, setSelectedTeamMemberId] = useState<string | null>(
    null,
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePending, setInvitePending] = useState(false);
  const [teamNotice, setTeamNotice] = useState("");
  const [teamDeactivateCandidateId, setTeamDeactivateCandidateId] = useState<string | null>(null);
  const [teamDeactivatePendingId, setTeamDeactivatePendingId] = useState<string | null>(null);
  const [teamDeactivateFeedback, setTeamDeactivateFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);
  const [teamRolePendingId, setTeamRolePendingId] = useState<string | null>(null);
  const [teamRoleFeedback, setTeamRoleFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);
  const [shareAffiliateChoice, setShareAffiliateChoice] = useState<
    Record<string, string>
  >({});
  const [shareCommissionDraft, setShareCommissionDraft] = useState<
    Record<string, string>
  >({});
  const [affiliateRoster, setAffiliateRoster] = useState<AffiliateRosterEntry[]>([]);
  const [affiliateRosterState, setAffiliateRosterState] = useState<
    "idle" | "loading" | "ready" | "failed"
  >("idle");
  const [affiliateRosterReload, setAffiliateRosterReload] = useState(0);
  const [selectedAffiliateId, setSelectedAffiliateId] = useState<string | null>(null);
  const [affiliateStatement, setAffiliateStatement] = useState<AffiliateStatementRow[]>([]);
  const [affiliateStatementForId, setAffiliateStatementForId] = useState<string | null>(null);
  const [affiliateStatementState, setAffiliateStatementState] = useState<
    "idle" | "loading" | "ready" | "failed"
  >("idle");
  const [affiliateMutationPending, setAffiliateMutationPending] = useState<string | null>(null);
  const [affiliateDeactivateCandidateId, setAffiliateDeactivateCandidateId] = useState<string | null>(null);
  const [affiliateFeedback, setAffiliateFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);
  const [affiliateInviteOpen, setAffiliateInviteOpen] = useState(false);
  const [affiliateInviteEmail, setAffiliateInviteEmail] = useState("");
  const [affiliateInvitePending, setAffiliateInvitePending] = useState(false);
  const [affiliateDefaultCommissionDraft, setAffiliateDefaultCommissionDraft] = useState<
    Record<string, string>
  >({});
  const [affiliateShareClientId, setAffiliateShareClientId] = useState("choose");
  const [affiliateCommissionOverrideDraft, setAffiliateCommissionOverrideDraft] = useState<
    Record<string, string>
  >({});
  const [feeRows, setFeeRows] = useState<FeeRow[]>(() =>
    CLIENT_FEE_RECORDS.map((fee) => ({
      adminUpfront: 0,
      clientId: fee.clientId,
      model: fee.model as FeeModel,
      paid: fee.paid,
      totalFee: fee.totalFee,
      triggerAmount: 0,
    })),
  );
  const [editingFeeClient, setEditingFeeClient] = useState<{
    clientId: string;
    name: string;
  } | null>(null);
  useEffect(() => {
    if (!durableWorkspace || teamDirectoryRequested.current) return undefined;
    teamDirectoryRequested.current = true;
    let cancelled = false;
    void readSupportInboxDirectory().then((result) => {
      if (cancelled) return;
      setTeamDirectory(result);
      setTeamDirectoryLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [durableWorkspace]);
  useEffect(() => {
    const rosterNeeded = (view === "team" && teamTab === "affiliates")
      || view === "clients";
    if (!durableWorkspace || !affiliatesEnabled || !rosterNeeded) {
      return undefined;
    }
    let cancelled = false;
    void loadOperatorAffiliates()
      .then((rows) => {
        if (cancelled) return;
        setAffiliateRoster(rows);
        setAffiliateRosterState("ready");
        setSelectedAffiliateId((current) =>
          rows.some((row) => row.affiliateId === current)
            ? current
            : (rows.find((row) => row.active)?.affiliateId ?? rows[0]?.affiliateId ?? null),
        );
      })
      .catch(() => {
        if (!cancelled) setAffiliateRosterState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [affiliateRosterReload, affiliatesEnabled, durableWorkspace, teamTab, view]);
  useEffect(() => {
    if (
      !durableWorkspace
      || !affiliatesEnabled
      || view !== "team"
      || teamTab !== "affiliates"
      || selectedAffiliateId === null
    ) return undefined;
    let cancelled = false;
    const statementAffiliateId = selectedAffiliateId;
    void loadOperatorAffiliateStatement(statementAffiliateId)
      .then((rows) => {
        if (cancelled) return;
        setAffiliateStatement(rows);
        setAffiliateStatementForId(statementAffiliateId);
        setAffiliateStatementState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setAffiliateStatement([]);
        setAffiliateStatementForId(statementAffiliateId);
        setAffiliateStatementState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [affiliateRosterReload, affiliatesEnabled, durableWorkspace, selectedAffiliateId, teamTab, view]);
  /**
   * The roster every panel on this surface reads.
   *
   * A signed-in workspace gets the durable members and, while the read is in
   * flight or unavailable, an empty roster — never the fixture seven. An empty
   * roster costs the seat table its rows and the assignee controls their
   * options, which is the honest answer to "we cannot see who works here";
   * seven strangers with @apexfunding.co addresses is not.
   */
  const teamRows: TeamRow[] = durableWorkspace
    ? inboxTeamOptions(
        teamDirectory.state === "ready" ? teamDirectory.clients : [],
      ).map((member) => ({
        active: member.active,
        email: null,
        id: member.id,
        isCurrentUser: member.isCurrentUser,
        lastActive: null,
        name: member.name,
        role: member.orgRole === null ? null : TEAM_ROLE_LABELS[member.orgRole],
      }))
    : fixtureTeamRows;
  const teamRosterPending = durableWorkspace && !teamDirectoryLoaded;
  const teamRosterUnavailable = durableWorkspace
    && teamDirectoryLoaded
    && teamDirectory.state === "unavailable";
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const configResponse = await fetch("/api/trainings/config", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!configResponse.ok) throw new Error("training_config_unavailable");
        const config = await configResponse.json() as AncillaryBootstrap;
        if (!active) return;
        setAncillaryConfig(config);
        if (!config.enabled) {
          setAncillaryConfigState("disabled");
          return;
        }
        const response = await fetch("/api/trainings", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("trainings_unavailable");
        const rows = trainingRowsFromResponse(await response.json());
        if (rows === null) throw new Error("training_response_invalid");
        if (!active) return;
        setTrainings(rows);
        setAncillaryConfigState("enabled");
      } catch {
        if (active) setAncillaryConfigState("unavailable");
      }
    })();
    return () => {
      active = false;
    };
  }, [trainingsReload]);
  useEffect(() => {
    if (!paidRefreshEnabled) return;
    let active = true;
    void fetch("/api/pricing/operator", { cache: "no-store", credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((catalog: OperatorPricingCatalog | null) => {
        if (active && catalog?.enabled) setPricingCatalog(catalog);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [paidRefreshEnabled]);
  /**
   * The operator's monitoring share, as a label.
   *
   * A failed or absent pricing read must not read as authoritative: the literal
   * "40%" this fell back to is the fixture assumption, and printed beside a real
   * workspace's numbers it looked like the rate the platform had agreed to. An
   * em dash is the honest answer to "we could not read the pricing catalog".
   */
  const monitoringSharePercent =
    paidRefreshEnabled && pricingCatalog
      ? pricingCatalog.monitoringSplit.percent
      : durableWorkspace
        ? null
        : PLATFORM_REV_SHARE * 100;
  const monitoringShareLabel =
    monitoringSharePercent === null ? "—" : `${monitoringSharePercent}%`;
  const monitoringShareRate =
    monitoringSharePercent === null ? null : monitoringSharePercent / 100;
  const [feeModelOverrides, setFeeModelOverrides] = useState<Set<string>>(
    () =>
      new Set(
        CLIENT_FEE_RECORDS.filter(
          (fee) => fee.model !== "unconfigured",
        ).map((fee) => fee.clientId),
      ),
  );
  const [defaultFeeModel, setDefaultFeeModel] =
    useState<Exclude<FeeModel, "unconfigured">>("percent");
  const [defaultSuccessFeePct, setDefaultSuccessFeePct] = useState(
    FIXTURE_SUCCESS_FEE_PCT,
  );
  /**
   * Whether this workspace has a saved default, or the fixture shell has a
   * local one. Durable workspaces start unknown and hydrate from the org row.
   */
  const [feeDefaultChosen, setFeeDefaultChosen] = useState(!durableWorkspace);
  const [defaultCustomFee, setDefaultCustomFee] = useState(1000);
  /**
   * The workspace's default upfront administrative fee. Only editable once the
   * org's legal gate is open, and `null` — an empty field, not a confident
   * zero — until the org-default read lands or somebody types one.
   */
  const [defaultUpfrontFee, setDefaultUpfrontFee] = useState<number | null>(
    durableWorkspace ? null : 0,
  );
  /** Fixture tasks never cross into a signed-in workspace. */
  const [fixtureTasks, setFixtureTasks] = useState<DemoTask[]>(() =>
    durableWorkspace
      ? []
      : TASK_FIXTURES.map((task) => ({
          ...task,
          assigneeProfileId: null,
          clientId: TASK_CLIENT_LINKS[task.id] ?? null,
          dueOn: null,
          notes: "",
          priority: task.priority as TaskPriority,
          status: task.status as TaskViewStatus,
        })),
  );
  const [durableTasks, setDurableTasks] = useState<readonly OperatorTask[]>([]);
  const [taskReadState, setTaskReadState] = useState<
    "idle" | "loading" | "ready" | "failed"
  >(durableWorkspace ? "idle" : "ready");
  const [taskReadError, setTaskReadError] = useState("");
  const [taskMutationError, setTaskMutationError] = useState("");
  const [taskNotice, setTaskNotice] = useState("");
  const [taskMutationKey, setTaskMutationKey] = useState<string | null>(null);
  const taskReadEpoch = useRef(0);
  const [taskFilter, setTaskFilter] = useState<"all" | TaskViewStatus>("all");
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<
    "all" | "high" | "medium" | "low"
  >("all");
  const [taskAssigneeFilter, setTaskAssigneeFilter] = useState("all");
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [confirmingTaskDeleteId, setConfirmingTaskDeleteId] = useState<string | null>(null);
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState<string | null>(
    durableWorkspace ? null : "Alec Rivera",
  );
  const [newTaskClientId, setNewTaskClientId] = useState<string | null>(null);
  const [newTaskDueOn, setNewTaskDueOn] = useState("");
  const [newTaskNotes, setNewTaskNotes] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>("medium");
  const [taskEditDrafts, setTaskEditDrafts] = useState<Record<string, TaskEditDraft>>({});

  const refreshDurableTasks = useCallback(async (): Promise<boolean> => {
    const epoch = taskReadEpoch.current + 1;
    taskReadEpoch.current = epoch;
    setTaskReadState("loading");
    setTaskReadError("");
    try {
      const rows = await loadTasks();
      if (taskReadEpoch.current !== epoch) return false;
      setDurableTasks(rows);
      setTaskReadState("ready");
      return true;
    } catch (error) {
      if (taskReadEpoch.current !== epoch) return false;
      setDurableTasks([]);
      setTaskReadError(taskFailureMessage(error));
      setTaskReadState("failed");
      return false;
    }
  }, []);

  useEffect(() => {
    if (!durableWorkspace || view !== "tasks") return undefined;
    const epoch = taskReadEpoch.current + 1;
    taskReadEpoch.current = epoch;
    void loadTasks()
      .then((rows) => {
        if (taskReadEpoch.current !== epoch) return;
        setDurableTasks(rows);
        setTaskReadState("ready");
      })
      .catch((error: unknown) => {
        if (taskReadEpoch.current !== epoch) return;
        setDurableTasks([]);
        setTaskReadError(taskFailureMessage(error));
        setTaskReadState("failed");
      });
    return () => {
      taskReadEpoch.current += 1;
    };
  }, [durableWorkspace, view]);
  const [supportResolved, setSupportResolved] = useState<Record<string, string>>(
    {},
  );
  const [supportSelected, setSupportSelected] = useState("s1");
  const [supportDraft, setSupportDraft] = useState<string>(
    SUPPORT_SEED[0].draft,
  );
  const [brandAccent, setBrandAccent] = useState("emerald");
  const [brandPublished, setBrandPublished] = useState(true);
  // No publish date until this session watched a publish land, or the tenancy
  // read carried one. A literal date is a claim about when somebody published.
  const [brandPublishedAt, setBrandPublishedAt] = useState<string | null>(
    durableWorkspace ? null : "Jul 18, 2026",
  );
  const [brandPending, setBrandPending] = useState(false);
  const [brandNotice, setBrandNotice] = useState("");
  const [siteTemplateId, setSiteTemplateId] = useState("foundation");
  const [settingsNotice, setSettingsNotice] = useState("");
  const [platformSupportDraft, setPlatformSupportDraft] = useState("");
  const [platformSupportNotice, setPlatformSupportNotice] = useState("");
  const [emailHolds, setEmailHolds] = useState(true);
  const [weeklyDigest, setWeeklyDigest] = useState(true);
  const [notifyTaskDue, setNotifyTaskDue] = useState(true);
  const [notifyPaymentFailed, setNotifyPaymentFailed] = useState(true);
  const [notifyClientMessages, setNotifyClientMessages] = useState(false);
  const [digestFrequency, setDigestFrequency] = useState("weekly");
  const [portalShowProgress, setPortalShowProgress] = useState(true);
  const [portalAllowUploads, setPortalAllowUploads] = useState(true);
  const [portalShowTrainings, setPortalShowTrainings] = useState(true);
  const [workspacePreferencesRead, setWorkspacePreferencesRead] =
    useState<WorkspacePreferencesRead>({ state: "idle" });
  const [workspacePreferencesSaving, setWorkspacePreferencesSaving] = useState<string | null>(null);
  const [workspacePreferencesReload, setWorkspacePreferencesReload] = useState(0);
  const [workspacePreferencesFeedback, setWorkspacePreferencesFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!durableWorkspace || view !== "settings") return undefined;
    let active = true;
    void readWorkspacePreferences().then((preferences) => {
      if (!active) return;
      setWorkspacePreferencesRead(preferences === null
        ? { state: "failed" }
        : { preferences, state: "ready" });
    });
    return () => {
      active = false;
    };
  }, [durableWorkspace, view, workspacePreferencesReload]);

  async function persistWorkspacePreferences(
    key: string,
    patch: WorkspacePreferencePatch,
  ) {
    if (!durableWorkspace || workspacePreferencesSaving !== null) return;
    setWorkspacePreferencesSaving(key);
    setWorkspacePreferencesFeedback(null);
    const saved = await saveWorkspacePreferences(patch);
    if (saved === null) {
      setWorkspacePreferencesFeedback({
        kind: "error",
        message: "The preference could not be saved. The previous saved values remain shown.",
      });
    } else {
      setWorkspacePreferencesRead({ preferences: saved, state: "ready" });
      setWorkspacePreferencesFeedback({
        kind: "success",
        message: "Workspace preferences saved.",
      });
    }
    setWorkspacePreferencesSaving(null);
  }
  const [applicationNoteDrafts, setApplicationNoteDrafts] = useState<
    Record<string, string>
  >({});
  const [applicationOutcomeDrafts, setApplicationOutcomeDrafts] = useState<
    Record<string, { amount: string; outcome: ApplicationOutcome }>
  >({});
  const [leadCaptureOpen, setLeadCaptureOpen] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [trackerCreateError, setTrackerCreateError] = useState(false);
  const [trackerCreatePending, setTrackerCreatePending] = useState(false);
  const [supportBubbleOpen, setSupportBubbleOpen] = useState(false);
  // Phase 13 (S2.5). Only an explicit disabled bootstrap selects the fixture path below.
  const [supportState, setSupportState] = useState<
    "loading" | "disabled" | "ready" | "unavailable"
  >("loading");
  const [workspaceSetupTab, setWorkspaceSetupTab] =
    useState<WorkspaceSetupTab>("setup");
  const [workspaceAccessState, setWorkspaceAccessState] =
    useState<WorkspaceAccessUiState>(durableWorkspace ? "idle" : "ready");
  const [workspaceAccessConfirmed, setWorkspaceAccessConfirmed] =
    useState<WorkspaceAccessSettings | null>(null);
  const [workspaceAccessSaving, setWorkspaceAccessSaving] = useState<string | null>(null);
  const [workspaceAccessReload, setWorkspaceAccessReload] = useState(0);
  const [workspaceAccessFeedback, setWorkspaceAccessFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!durableWorkspace || view !== "onboarding" || workspaceSetupTab !== "access") {
      return undefined;
    }
    let active = true;
    void readWorkspaceAccessSettings().then((result) => {
      if (!active) return;
      if (result.outcome === "ready") {
        setWorkspaceAccessConfirmed(result.settings);
        setTeamSeesAllClients(result.settings.teamSeesAllClients);
        setClientAssignmentMode(result.settings.assignmentMode);
        setWorkspaceAccessState("ready");
        return;
      }
      setWorkspaceAccessState(result.outcome);
      setWorkspaceAccessFeedback({
        kind: "error",
        message: result.outcome === "unavailable"
          ? "Workspace access settings are not available on this deployment."
          : "Workspace access settings could not be loaded.",
      });
    });
    return () => {
      active = false;
    };
  }, [durableWorkspace, view, workspaceAccessReload, workspaceSetupTab]);

  async function persistWorkspaceAccess(
    key: string,
    next: WorkspaceAccessSettings,
  ): Promise<boolean> {
    if (!durableWorkspace
        || workspaceAccessState !== "ready"
        || workspaceAccessSaving !== null
        || workspaceAccessConfirmed === null) return false;
    const previous = workspaceAccessConfirmed;
    setWorkspaceAccessSaving(key);
    setWorkspaceAccessFeedback(null);
    setTeamSeesAllClients(next.teamSeesAllClients);
    setClientAssignmentMode(next.assignmentMode);
    const result = await saveWorkspaceAccessSettings(next);
    if (result.outcome === "ready") {
      setWorkspaceAccessConfirmed(result.settings);
      setTeamSeesAllClients(result.settings.teamSeesAllClients);
      setClientAssignmentMode(result.settings.assignmentMode);
      setWorkspaceAccessState("ready");
      setWorkspaceAccessFeedback({
        kind: "success",
        message: "Workspace access and assignment settings saved.",
      });
      setWorkspaceAccessSaving(null);
      return true;
    }
    setTeamSeesAllClients(previous.teamSeesAllClients);
    setClientAssignmentMode(previous.assignmentMode);
    setWorkspaceAccessState(result.outcome);
    setWorkspaceAccessFeedback({
      kind: "error",
      message: result.outcome === "unavailable"
        ? "Workspace access settings are unavailable. The last confirmed values were restored."
        : "Workspace access settings could not be saved. The last confirmed values were restored.",
    });
    setWorkspaceAccessSaving(null);
    return false;
  }

  // Phase 13 (S2.5): ask once, the first time the bubble opens.
  useEffect(() => {
    if (!supportBubbleOpen || supportState !== "loading") return undefined;
    let cancelled = false;
    void (async () => {
      let nextState: "disabled" | "ready" | "unavailable" = "unavailable";
      try {
        const response = await fetch("/api/support/threads", { cache: "no-store" });
        if (response.ok) {
          const body = (await response.json()) as { enabled?: boolean } | null;
          nextState = body?.enabled === true
            ? "ready"
            : body?.enabled === false
              ? "disabled"
              : "unavailable";
        }
      } catch {
        nextState = "unavailable";
      }
      if (!cancelled) setSupportState(nextState);
    })();
    return () => {
      cancelled = true;
    };
  }, [supportBubbleOpen, supportState]);
  const [clientsTab, setClientsTab] = useState<ClientsTab>("tracker");
  const platformRevenueCanRead =
    sessionIdentity?.orgRole === "owner" || sessionIdentity?.orgRole === "admin";
  const [platformRevenueRead, setPlatformRevenueRead] = useState<PlatformRevenueRead>({
    state: "idle",
  });
  const [platformRevenueReload, setPlatformRevenueReload] = useState(0);

  useEffect(() => {
    if (!durableWorkspace || clientsTab !== "platform-rev" || !platformRevenueCanRead) {
      return undefined;
    }
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/operator/platform-revenue", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!active) return;
        if (!response.ok) {
          setPlatformRevenueRead({
            message: response.status === 404
              ? "Platform revenue is not enabled for this workspace."
              : response.status === 403
                ? "Only workspace owners and admins can view platform revenue."
                : "Platform revenue is temporarily unavailable.",
            state: "failed",
          });
          return;
        }
        const parsed = parseOperatorPlatformRevenue(await response.json());
        if (!active) return;
        setPlatformRevenueRead(parsed === null
          ? { message: "The platform revenue response was invalid.", state: "failed" }
          : { revenue: parsed, state: "ready" });
      } catch {
        if (active) {
          setPlatformRevenueRead({
            message: "Platform revenue is temporarily unavailable.",
            state: "failed",
          });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [clientsTab, durableWorkspace, platformRevenueCanRead, platformRevenueReload]);

  // ---------------------------------------------------------------------------
  // The durable rails behind the previously simulated operator controls.
  // `docs/backend/UI-WIRING-BACKLOG.md` #7, #8, #9, #10 and #17.
  // ---------------------------------------------------------------------------

  // #9. The Inbox, its state and its two bodies, now live in `components/operator/inbox`.
  // The hook is called here rather than inside `<OperatorInbox>` for the reason the state was
  // here in the first place: leaving the Inbox for Clients and coming back must not close the
  // conversation that was open, and a component that unmounts on every view change would.
  const inbox = useOperatorInbox({ active: view === "inbox" });
  // #7. The org's receivables. A failed read is its own state and never renders
  // as a workspace that owes nothing.
  const [receivablesRead, setReceivablesRead] = useState<ReceivablesRead>({
    state: "loading",
  });
  const [feeDefaultFailed, setFeeDefaultFailed] = useState(false);
  // The upfront administrative fee's legal gate (T-CL-03). It is a per-org
  // switch — `org_flags.upfront_fee_approved`, enforced by the trigger in
  // migration 091. The org-default read carries the gate and saved default in
  // one response, so the field cannot hydrate against a different snapshot.
  const [workspaceFeeDefaultsRead, setWorkspaceFeeDefaultsRead] =
    useState<WorkspaceFeeDefaultsRead>({ state: "loading" });
  const feeGateRead: FeeGateRead = workspaceFeeDefaultsRead;
  const upfrontFeeApproved = feeOptionAvailable(feeGateRead, "upfront");
  const upfrontSignoffRef =
    feeGateRead.state === "ready" ? feeGateRead.signoffRef : null;
  /** The workspace default every client created afterwards inherits as a draft. */
  async function persistWorkspaceFeeDefault(
    model: Exclude<FeeModel, "package" | "unconfigured">,
    customTotal: number,
    upfrontTotal: number | null,
  ) {
    // A gated amount is sent only when the gate says it is open. The route
    // refuses it either way — that is the check that counts — but sending one
    // we know is refused would fail the whole default write, including the
    // success-fee half that was never gated.
    const upfrontCents = upfrontFeeApproved && upfrontTotal !== null && upfrontTotal > 0
      ? Math.round(upfrontTotal * 100)
      : null;
    const result = await setWorkspaceFeeDefault(
      model === "percent"
        ? {
            customTotalCents: null,
            model: "percentage",
            pct: defaultSuccessFeePct,
            upfrontCents,
          }
        : {
            customTotalCents: Math.round(customTotal * 100),
            model: "custom",
            pct: null,
            upfrontCents,
          },
    );
    setFeeDefaultFailed(!result.ok);
  }
  const feesTabActive = view === "clients" && clientsTab === "client-fees";
  // The durable client peek's Fees tab reads the same org receivables list the
  // fee table does and picks its client out of it, rather than adding a second
  // per-client read: `GET /api/fees/[clientId]` exists, but two readers of the
  // same ledger eventually disagree about what a client owes.
  const trackerFeesTabActive =
    selectedTrackerClientId !== null && trackerDrawerTab === "fees";
  useEffect(() => {
    if (!feesEnabled || !(feesTabActive || trackerFeesTabActive)) return undefined;
    let cancelled = false;
    void readReceivables().then((result) => {
      if (!cancelled) setReceivablesRead(result);
    });
    void readWorkspaceFeeDefaults().then((result) => {
      if (cancelled) return;
      setWorkspaceFeeDefaultsRead(result);
      if (result.state !== "ready") return;
      const saved = result.orgDefault;
      if (saved === null) {
        setFeeDefaultChosen(false);
        setDefaultUpfrontFee(null);
        return;
      }
      setFeeDefaultChosen(true);
      setDefaultUpfrontFee(
        saved.upfrontCents === null ? null : saved.upfrontCents / 100,
      );
      if (saved.model === "percentage") {
        setDefaultFeeModel("percent");
        setDefaultSuccessFeePct(saved.pct ?? 0);
      } else if (saved.model === "custom") {
        setDefaultFeeModel("custom");
        setDefaultCustomFee((saved.customTotalCents ?? 0) / 100);
      } else {
        setDefaultFeeModel("package");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [feesEnabled, feesTabActive, trackerFeesTabActive]);

  // #8 and #10. Whether the application and affiliate rails are live at all.
  // Both surfaces render the fixture book, whose row ids are fixture handles
  // rather than the UUIDs those routes require, so a live rail is exactly when
  // the controls have to say so instead of writing to local state.
  // The rail state arrives as a server-rendered prop rather than an HTTP probe.
  // The probe worked, but it learned the answer by provoking a 400 and a 403 on
  // every operator page load, which put two failures in the console and in the
  // walk harness's non-2xx tally on a surface whose clean console is something
  // we verify before every demo. featureFlag() is server-only, so page.tsx
  // reads both flags and passes them down the same way feesEnabled already
  // travels.
  const applicationWritesDurable = applicationsEnabled;
  const affiliateWritesDurable = affiliatesEnabled;
  /**
   * The gate polarity, corrected.
   *
   * These controls were disabled only while the rail was live, which is exactly
   * backwards: the rows they act on are fixture handles, so with the rail live
   * the route refuses the id and with the rail off the write lands in an
   * in-memory provider nothing else reads. Neither state stores anything, so
   * both are disabled and both say so. The rail flags above still decide the
   * wording, because "records are not stored" and "this route is not connected"
   * are different sentences.
   */
  const applicationControlsDisabled = true;
  const affiliateControlsDisabled = true;

  const [drawerWidth, setDrawerWidth] = useState(672);
  const drawerResizeState = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );
  const trackerCreatePendingRef = useRef(false);

  const trackerStageFilter =
    stageFilter === "All stages" ? null : trackerStageFromLabel(stageFilter);
  useEffect(() => {
    if (!durableWorkspace || trackerFiltersRestoreRequested.current) return undefined;
    trackerFiltersRestoreRequested.current = true;
    restoreTrackerFiltersFromLocation({
      affiliate: setAffiliateFilter,
      mode: setClientMode,
      query: setQuery,
      restored: () => setTrackerFiltersRestored(true),
      stage: setStageFilter,
      status: setTrackerStatusFilter,
      team: setTeamFilter,
    });
    return undefined;
  }, [durableWorkspace]);

  useEffect(() => {
    if (
      !durableWorkspace
      || !trackerFiltersRestored
      || view !== "clients"
      || clientsTab !== "tracker"
    ) return;
    const url = new URL(window.location.href);
    const values: Array<[string, string | null]> = [
      ["clients_q", query.trim() || null],
      ["clients_stage", trackerStageFilter],
      ["clients_member", isTrackerUuid(teamFilter) ? teamFilter : null],
      ["clients_affiliate", affiliateFilter === "none" || isTrackerUuid(affiliateFilter) ? affiliateFilter : null],
      ["clients_status", trackerStatusFilter === "active" ? null : trackerStatusFilter],
      ["clients_view", clientMode === "cards" ? null : clientMode],
    ];
    for (const [key, value] of values) {
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.replaceState(window.history.state, "", next);
  }, [
    affiliateFilter,
    clientMode,
    clientsTab,
    durableWorkspace,
    query,
    teamFilter,
    trackerFiltersRestored,
    trackerStageFilter,
    trackerStatusFilter,
    view,
  ]);
  // One subscription serves both readers. The Dashboard needs the unfiltered
  // book — its rollups are the whole workspace, not whatever the Clients view
  // was last filtered to — so the filters collapse to `scope: all` while the
  // Dashboard is the active view. Two hooks would open two realtime channels
  // under the same channel name, which is why this is widened rather than
  // duplicated.
  // The 90-day optimization window needs a clock, and reading one during render
  // is a hydration hazard: the server would stamp one instant into the HTML and
  // the client another. Same idiom the consumer surface uses for its stage
  // timer — the clock is null until hydration, so the server renders the
  // loading state the client hydrates into and no timestamp crosses the wire.
  const dashboardHydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const dashboardNow = dashboardHydrated ? new Date() : null;

  const trackerHomeActive = view === "home";
  const affiliateTeamActive = view === "team" && teamTab === "affiliates";
  // Cash collected across the book, summed from the fee ledger the same way
  // the receivables list renders it. null = not loaded (or FEATURE_FEES off,
  // in which case the effect never runs and the stat says so); "failed" keeps
  // a broken read from being mistaken for an empty book.
  const [collectedCents, setCollectedCents] = useState<number | "failed" | null>(null);
  useEffect(() => {
    if (!feesEnabled || !trackerHomeActive || collectedCents !== null) return;
    let current = true;
    void fetch("/api/fees?limit=200", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { receivables?: Array<{ paidCents?: unknown }> };
        if (!Array.isArray(body.receivables)) throw new Error("shape");
        return body.receivables.reduce(
          (sum, row) => sum + (typeof row.paidCents === "number" && Number.isSafeInteger(row.paidCents) && row.paidCents >= 0 ? row.paidCents : 0),
          0,
        );
      })
      .then((total) => { if (current) setCollectedCents(total); })
      .catch(() => { if (current) setCollectedCents("failed"); });
    return () => { current = false; };
  }, [feesEnabled, trackerHomeActive, collectedCents]);
  const trackerFilters: TrackerReadFilters = trackerHomeActive || view === "tasks" || affiliateTeamActive
    ? { scope: "all" }
    : {
        scope: "all",
        ...(trackerStageFilter ? { stage: trackerStageFilter } : {}),
        ...(isTrackerUuid(teamFilter) ? { member: teamFilter } : {}),
        ...(affiliateFilter === "none" || isTrackerUuid(affiliateFilter)
          ? { affiliate: affiliateFilter }
          : {}),
        ...(trackerStatusFilter === "active"
          ? {}
          : { status: trackerStatusFilter }),
      };
  const trackerClients = useTrackerClients({
    // Tasks is in here because its client typeahead links against this book;
    // one widened subscription rather than a second hook, which would open a
    // second realtime channel under the same channel name.
    active:
      trackerHomeActive
      || view === "tasks"
      || affiliateTeamActive
      || (view === "clients" && clientsTab === "tracker"),
    audience: "operator",
    filters: trackerFilters,
  });
  // The sidebar counter is the size of the book, not the size of whatever the
  // Clients view was last filtered to, so only an unfiltered read updates it —
  // and "unfiltered" is read off the filters object itself rather than
  // re-listing the filter states, which would drift the moment a filter is
  // added. It sticks once read because the hook drops to its inactive state on
  // every other view, and a badge that vanishes when you open Tasks reads as a
  // workspace that lost its clients.
  const trackerReadIsWholeBook = Object.keys(trackerFilters).length === 1;
  const currentDurableClientCount = trackerReadIsWholeBook
    ? durableClientCount(trackerClients)
    : null;
  const [lastDurableClientCount, setLastDurableClientCount] = useState<
    number | null
  >(null);
  const [searchableTrackerClients, setSearchableTrackerClients] = useState<
    readonly TrackerClient[]
  >([]);
  // Adjusted during render, the same idiom the durable inbox uses above: an
  // effect would paint the previous count once before correcting it, and the
  // whole point of this counter is that it never shows a number that is not
  // the current read's.
  if (
    currentDurableClientCount !== null &&
    currentDurableClientCount !== lastDurableClientCount
  ) {
    setLastDurableClientCount(currentDurableClientCount);
  }
  useEffect(() => {
    // Wait for the existing tracker read to prove that this rail is enabled.
    // Then fetch the same authenticated, tenant-scoped route once with all
    // statuses, without opening a second realtime channel. Depending on the
    // current table rows makes realtime invalidations and mutations refresh the
    // search snapshot as well.
    if (!durableWorkspace || trackerClients.enabled !== true) return undefined;
    let active = true;
    void readTrackerClientSnapshot({ scope: "all", status: "all" })
      .then((result) => {
        if (active) setSearchableTrackerClients(result.enabled ? result.clients : []);
      })
      .catch(() => {
        if (active) setSearchableTrackerClients([]);
      });
    return () => {
      active = false;
    };
  }, [durableWorkspace, trackerClients.clients, trackerClients.enabled]);
  const navSections = useMemo<NavSection[]>(() => {
    const badge = clientsNavBadge({
      fixtureCount: clients.length,
      lastDurableCount: lastDurableClientCount,
      trackerEnabled,
    });
    return NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        item.id === "clients" && badge !== undefined ? { ...item, badge } : item,
      ),
    }));
  }, [lastDurableClientCount, trackerEnabled]);
  // Search reads the exact navigation handed to DemoShell. If a workspace gate
  // removes a page from that rail later, the palette loses it on the same
  // render instead of retaining a second, stale route map.
  const commandPages: CommandPalettePage[] = navSections.flatMap((section) =>
    section.items.map((item) => ({
      description: section.label ? `${section.label} page` : undefined,
      icon: item.icon,
      id: item.id,
      label: item.label,
    })),
  );
  const commandActions: CommandPaletteAction[] = [
    {
      description: "Open the client-capture form.",
      icon: UserPlus,
      id: "create-lead",
      keywords: ["client", "new", "prospect", "lead"],
      label: "Create client",
      onSelect: () => {
        setView("clients");
        setLeadCaptureOpen(true);
      },
    },
    {
      description: "Open the workspace assistant.",
      icon: BrainCircuit,
      id: "ask-ai",
      keywords: ["assistant", "help", "workspace"],
      label: "Ask AI assistant",
      onSelect: () => openGlobalAssistant("operator"),
    },
    {
      description: "Prepare a meeting draft. No calendar event is created.",
      icon: CalendarPlus,
      id: "schedule-meeting",
      keywords: ["calendar", "call", "appointment"],
      label: "Schedule meeting",
      onSelect: () => {
        setView("tasks");
        setSettingsNotice(
          "Meeting draft prepared. No calendar event was created.",
        );
      },
    },
  ];
  const commandRecords: CommandPaletteRecord[] = durableWorkspace
    ? searchableTrackerClients.map((client, index) => ({
        description: `${client.businessName ?? "No business recorded"} · ${TRACKER_STAGE_LABELS[client.stage]}`,
        icon: Users,
        id: `client-${index + 1}`,
        keywords: [
          client.businessName ?? "",
          client.assignedToName ?? "",
          TRACKER_STAGE_LABELS[client.stage],
          client.status,
        ],
        label: client.displayName,
        onSelect: () => {
          setView("clients");
          setClientsTab("tracker");
          setQuery("");
          setStageFilter("All stages");
          setTeamFilter("all");
          setAffiliateFilter("all");
          setTrackerStatusFilter(client.status);
          // Let the filter-changing render start its tracker read before
          // opening the drawer; otherwise the stale filtered snapshot can
          // close the selection before the requested row is returned.
          window.setTimeout(() => openTrackerClient(client.id), 0);
        },
      }))
    : clients.map((client, index) => ({
        description: `${client.business} · ${client.stage}`,
        icon: Users,
        id: `client-${index + 1}`,
        keywords: [client.business, client.stage],
        label: client.name,
        onSelect: () => {
          setView("clients");
          setClientsTab("tracker");
          setQuery("");
          setStageFilter("All stages");
          setTeamFilter("all");
          setAffiliateFilter("all");
          setTrackerStatusFilter("active");
          openClient(client.clientId);
        },
      }));

  useEffect(() => {
    void getJson<EnrollConfig>("/api/enroll").then((result) => {
      if (result.ok && result.data.enabled) setEnroll(result.data);
    });
  }, []);

  const selectedClient =
    clients.find((client) => client.clientId === selectedClientId) ?? null;
  // The tracker read is the peek's only source. There is no `GET
  // /api/clients/[id]` — the route exports PATCH alone — so the row the list
  // already fetched is both the newest answer available and the same row the
  // card behind the sheet is rendering, which is what keeps the two from
  // disagreeing. A filter that drops the client closes the sheet.
  const selectedTrackerClient =
    trackerClients.clients.find(
      (client) => client.id === selectedTrackerClientId,
    ) ?? null;
  useEffect(() => {
    if (selectedTrackerClientId === null || trackerDrawerTab !== "plan") {
      return undefined;
    }
    let cancelled = false;
    void readOperatorCreditScores(selectedTrackerClientId).then((result) => {
      if (!cancelled) setTrackerCreditScoreRead({ clientId: selectedTrackerClientId, result });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedTrackerClientId, trackerDrawerTab]);
  const trackerCreditScores: OperatorCreditScoresRead = selectedTrackerClientId === null || trackerDrawerTab !== "plan"
    ? { state: "idle" }
    : trackerCreditScoreRead?.clientId === selectedTrackerClientId
      ? trackerCreditScoreRead.result
      : { state: "loading" };
  // A filter that excludes the open client closes the sheet, and the selection
  // has to go with it — otherwise clearing the filter later pops the sheet back
  // open on a client nobody asked for.
  if (
    selectedTrackerClientId !== null &&
    selectedTrackerClient === null &&
    trackerClients.enabled === true &&
    !trackerClients.loading
  ) {
    setSelectedTrackerClientId(null);
  }
  const trackerFeesSource: TrackerFeesSource = !feesEnabled
    ? { state: "disabled" }
    : receivablesRead.state === "ready"
      ? {
          receivable:
            receivablesRead.receivables.find(
              (row) => row.clientId === selectedTrackerClientId,
            ) ?? null,
          state: "ready",
        }
      : receivablesRead;
  const selectedEnrollment = enroll?.enrollments?.find(
    (item) => item.email === selectedClient?.email,
  );
  const selectedClientApplications = selectedClient
    ? getApplicationsForClient(selectedClient.clientId)
    : [];
  const activeSupport = SUPPORT_SEED.filter(
    (thread) => !supportResolved[thread.id],
  );
  const selectedSupport =
    activeSupport.find((thread) => thread.id === supportSelected) ??
    activeSupport[0] ??
    null;
  const homeMetrics = deriveOperatorHomeMetrics("op-apex", applications);
  const currentFeeRows = feeRows.map((fee) => ({
    ...fee,
    totalFee:
      fee.model === "percent"
        ? parseMoney(getClientFundedAmount(fee.clientId) * SUCCESS_FEE_RATE)
        : fee.totalFee,
  }));
  const feeMetrics = (() => {
    const total = currentFeeRows.reduce(
      (sum, fee) => sum + fee.totalFee,
      0,
    );
    const paid = currentFeeRows.reduce((sum, fee) => sum + fee.paid, 0);
    return { balance: Math.max(0, total - paid), paid, total };
  })();
  const taskToday = dashboardNow === null ? null : localDateOnly(dashboardNow);
  const taskAssigneeById = new Map(teamRows.map((member) => [member.id, member.name]));
  const taskRows: readonly DemoTask[] = durableWorkspace
    ? durableTasks.map((task) => ({
        assignee: task.assigneeProfileId === null
          ? "Unassigned"
          : taskAssigneeById.get(task.assigneeProfileId) ?? "Team member unavailable",
        assigneeProfileId: task.assigneeProfileId,
        clientId: task.clientId,
        dueAt: task.dueOn === null ? "No due date" : formatDate(task.dueOn),
        dueOn: task.dueOn,
        id: task.id,
        notes: task.notes,
        priority: task.priority,
        status: taskViewStatus(task, taskToday),
        title: task.title,
        type: task.clientId === null ? "Workspace task" : "Client task",
      }))
    : fixtureTasks;
  const taskMetrics = deriveTaskMetrics(taskRows);
  const selectedTeamMember = teamRows.find(
    (member) => member.id === selectedTeamMemberId,
  );

  function getClientOwnerId(client: Client) {
    return clientOwnerOverrides[client.clientId] ?? client.ownerId;
  }

  const filteredClients = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return clients.filter((client) => {
      const matchesSearch =
        !normalizedQuery ||
        `${client.name} ${client.business}`
          .toLowerCase()
          .includes(normalizedQuery);
      const matchesStage =
        stageFilter === "All stages" || client.stage === stageFilter;
      const matchesTeam =
        teamFilter === "all" ||
        (clientOwnerOverrides[client.clientId] ?? client.ownerId) === teamFilter;
      const matchesAffiliate =
        affiliateFilter === "all" ||
        (affiliateFilter === "none"
          ? !affiliateShares.some(
              (share) => share.clientId === client.clientId,
            )
          : affiliateShares.some(
              (share) =>
                share.clientId === client.clientId &&
                share.affiliateId === affiliateFilter,
            ));
      return matchesSearch && matchesStage && matchesTeam && matchesAffiliate;
    });
  }, [
    affiliateFilter,
    affiliateShares,
    clientOwnerOverrides,
    query,
    stageFilter,
    teamFilter,
  ]);

  function openClient(id: string, tab: DrawerTab = "overview") {
    setSupportBubbleOpen(false);
    setSelectedClientId(id);
    setDrawerTab(tab);
  }

  function openTrackerClient(id: string, tab: DrawerTab = "overview") {
    setSupportBubbleOpen(false);
    setSelectedTrackerClientId(id);
    setTrackerDrawerTab(tab);
  }

  function getGoal(client: Client) {
    return goalOverrides[client.clientId] ?? 0;
  }

  function toggleSet(
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    value: string,
  ) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function discardFixtureSupportDraft() {
    if (!selectedSupport) return;
    const resolvingId = selectedSupport.id;
    setSupportResolved((current) => ({ ...current, [resolvingId]: "Discarded" }));
    const next = activeSupport.find((thread) => thread.id !== resolvingId);
    if (next) {
      setSupportSelected(next.id);
      setSupportDraft(next.draft);
    }
  }

  /**
   * The Dashboard reads the workspace's own clients whenever the tracker is
   * enabled, and the fixture only when it is not.
   *
   * This is the fix for the screen that made a real sign-in dangerous: with
   * FEATURE_REAL_AUTH on, the first view after sign-in claimed 196 active
   * clients and $2.55M funded from `deriveOperatorHomeMetrics()` while the
   * Clients badge one inch away read the durable 4. Labelled a demo, that was a
   * limitation; behind a real login it is a screen that misstates the system.
   *
   * `trackerEnabled` comes from the server rather than from the fetch, so the
   * choice is made on the first paint. Deriving it from `trackerClients.enabled`
   * would render the fixture numbers for as long as the request takes and then
   * swap them for the real ones — a visible flash of 196 → 4, which is worse
   * than either state on its own.
   */
  function renderDurableHome(metrics: DurableHomeMetrics) {
    const maxPipeline = Math.max(1, ...metrics.pipeline.map((row) => row.count));
    // Stage transitions the tracker actually recorded, newest first. The fixture
    // this replaces narrated staff joining and cohort imports, neither of which
    // the workspace has any record of.
    const activity = trackerClients.clients
      .flatMap((client) =>
        client.history.map((entry) => ({
          at: entry.at,
          client,
          entry,
        })),
      )
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
      .slice(0, 4);

    return (
      <div className="space-y-5">
        <CompactHeader icon={Home} title="Dashboard" />
        <StatStrip
          stats={[
            ["Active clients", formatDemoNumber(metrics.activeClients), "Not yet graduated"],
            metrics.fundedAllTimeCents === null
              ? ["Funded All-Time", "—", "No recorded funded outcomes"]
              : ["Funded All-Time", formatDemoMoney(metrics.fundedAllTimeCents / 100, { compact: true }), "Recorded funded outcomes"],
            !feesEnabled
              ? ["Cash Collected All-Time", "—", "Fee records not enabled"]
              : collectedCents === null
                ? ["Cash Collected All-Time", "—", "Loading fee records"]
                : collectedCents === "failed"
                  ? ["Cash Collected All-Time", "—", "Fee records unavailable"]
                  : ["Cash Collected All-Time", formatDemoMoney(collectedCents / 100, { compact: true }), "Recorded fee payments"],
            ["Completed AI analysis", formatDemoNumber(metrics.analyses), "Clients with a completed analysis"],
            [
              "Avg optimization",
              metrics.averageOptimizationDays === null
                ? "—"
                : `${formatDemoNumber(metrics.averageOptimizationDays)} days`,
              "Completed in the past 90 days",
            ],
            ["Graduated", formatDemoNumber(metrics.graduatedClients), "Recorded clients"],
          ]}
        />
        <div className="grid gap-5 xl:grid-cols-[1.12fr_0.88fr]">
          <Panel
            title="Needs attention"
            trailing={
              <span className="text-xs text-muted-foreground tabular-nums">
                {metrics.attention.length} open
              </span>
            }
          >
            {metrics.attention.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No client is flagged for attention right now.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {metrics.attention.map((client) => (
                  <div
                    className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                    key={client.id}
                  >
                    <StatusPill tone={client.health === "red" ? "danger" : "warning"}>
                      {client.health}
                    </StatusPill>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {client.displayName}
                        {client.businessName ? ` · ${client.businessName}` : ""}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {TRACKER_STAGE_LABELS[client.stage]}
                        {client.openActionCount === null
                          ? ""
                          : ` · ${client.openActionCount} open action${client.openActionCount === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    <Button onClick={() => setView("clients")} size="sm" variant="ghost">
                      Open <ArrowUpRight aria-hidden />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <div className="space-y-5">
            <Panel
              title="Pipeline"
              trailing={
                <Button onClick={() => setView("clients")} size="sm" variant="link">
                  Open clients
                </Button>
              }
            >
              <div className="space-y-3">
                {metrics.pipeline.map(({ count, stage }) => (
                  <div
                    className="grid grid-cols-[6rem_1fr_2.5rem] items-center gap-3 text-xs"
                    key={stage}
                  >
                    <span className="text-muted-foreground">
                      {TRACKER_STAGE_LABELS[stage]}
                    </span>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          stage === "optimization"
                            ? "bg-primary"
                            : stage === "funded" || stage === "graduate"
                              ? "bg-[var(--consumer-positive)]"
                              : "bg-primary/30",
                        )}
                        style={{ width: `${(count / maxPipeline) * 100}%` }}
                      />
                    </div>
                    <span className="text-right tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel
              title="Activity"
              trailing={
                <span className="text-xs text-muted-foreground">Your workspace</span>
              }
            >
              {activity.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No stage changes recorded yet.
                </p>
              ) : (
                <div className="space-y-3 text-xs">
                  {activity.map(({ at, client, entry }) => (
                    <div
                      className="grid gap-1 sm:grid-cols-[7rem_1fr]"
                      key={`${client.id}-${at}-${entry.to}`}
                    >
                      <span className="font-mono text-muted-foreground tabular-nums">
                        {formatDurableTimestamp(at)}
                      </span>
                      <span>
                        {client.displayName} moved to{" "}
                        {TRACKER_STAGE_LABELS[entry.to]}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>
    );
  }

  function renderHome() {
    if (trackerEnabled) {
      if (
        trackerClients.loading ||
        trackerClients.enabled === null ||
        dashboardNow === null
      ) {
        return (
          <div className="space-y-5">
            <CompactHeader icon={Home} title="Dashboard" />
            <Panel>
              <p className="text-sm text-muted-foreground" role="status">
                Loading workspace totals…
              </p>
            </Panel>
          </div>
        );
      }
      if (trackerClients.error) {
        return (
          <div className="space-y-5">
            <CompactHeader icon={Home} title="Dashboard" />
            <Panel>
              <p className="text-sm text-destructive" role="alert">
                Unable to load workspace totals.
              </p>
            </Panel>
          </div>
        );
      }
      if (trackerClients.enabled) {
        return renderDurableHome(
          deriveDurableHomeMetrics(trackerClients.clients, dashboardNow),
        );
      }
    }

    // Same rule as the Clients view: a real workspace never falls through to the
    // fixture rollups (196 clients, $2.55M funded, "Ray Gibbs joined").
    if (durableWorkspace) {
      return (
        <div className="space-y-5">
          <CompactHeader icon={Home} title="Dashboard" />
          <Panel>
            <p className="text-sm text-muted-foreground" role="status">
              Workspace totals are not available, because the funding-readiness
              tracker is not enabled for this workspace.
            </p>
          </Panel>
        </div>
      );
    }

    const attention = clients.filter((client) =>
      ["attention", "fee due", "result due", "review"].includes(client.health),
    );
    const herreraClient = clients.find((client) => client.clientId === "c3");
    const maxPipeline = Math.max(...OPERATOR_PIPELINE.map((stage) => stage.count));
    return (
      <div className="space-y-5">
        <CompactHeader
          icon={Home}
          title="Dashboard"
        />
        <StatStrip
          stats={[
            ["Active clients", formatDemoNumber(homeMetrics.activeClients), "Optimization & funding"],
            ["Funded All-Time", formatDemoMoney(homeMetrics.fundedAllTime, { compact: true }), "Recorded outcomes"],
            ["Cash Collected All-Time", formatDemoMoney(feeMetrics.paid), `${formatDemoMoney(feeMetrics.balance)} balance`],
            ["Completed AI analysis", formatDemoNumber(homeMetrics.analyses), "Current plan period"],
            ["Avg optimization", `${formatDemoNumber(homeMetrics.averageOptimizationDays)} days`, "Completed in the past 90 days"],
            ["Graduated", formatDemoNumber(homeMetrics.graduatedClients), "Recorded clients"],
          ]}
        />
        <div className="grid gap-5 xl:grid-cols-[1.12fr_0.88fr]">
          <Panel
            title="Needs attention"
            trailing={
              <span className="text-xs text-muted-foreground tabular-nums">
                {attention.length} open
              </span>
            }
          >
            <div className="divide-y divide-border">
              {attention.map((client) => (
                <div
                  className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                  key={client.clientId}
                >
                  <StatusPill tone={healthTone(client.health)}>
                    {client.health}
                  </StatusPill>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {client.name} · {client.business}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {client.next}
                    </p>
                  </div>
                  <Button
                    onClick={() => openClient(client.clientId)}
                    size="sm"
                    variant="ghost"
                  >
                    Open <ArrowUpRight aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
          </Panel>
          <div className="space-y-5">
            <Panel
              title="Pipeline"
              trailing={
                <Button
                  onClick={() => setView("clients")}
                  size="sm"
                  variant="link"
                >
                  Open clients
                </Button>
              }
            >
              <div className="space-y-3">
                {OPERATOR_PIPELINE.map(({ count, stage }) => (
                  <div
                    className="grid grid-cols-[6rem_1fr_2.5rem] items-center gap-3 text-xs"
                    key={stage}
                  >
                    <span className="text-muted-foreground">{stage}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          stage === "Optimization"
                            ? "bg-primary"
                            : stage === "Funded" || stage === "Graduate"
                              ? "bg-[var(--consumer-positive)]"
                              : "bg-primary/30",
                        )}
                        style={{ width: `${(count / maxPipeline) * 100}%` }}
                      />
                    </div>
                    <span className="text-right tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel
              title="Activity"
              trailing={
                <span className="text-xs text-muted-foreground">
                  Your workspace
                </span>
              }
            >
              <div className="space-y-3 text-xs">
                {[
                  ["Today 2:04 PM", "Ray Gibbs joined as a Prep specialist"],
                  ["Today 11:20 AM", "38 analyses completed across the book"],
                  [
                    "Jul 20",
                    `${herreraClient?.business ?? "Client"} recorded ${formatDemoMoney(
                      getClientFundedAmount("c3"),
                    )} funded`,
                  ],
                  ["Jul 19", "Client cohort import completed with 26 records"],
                ].map(([time, event]) => (
                  <div
                    className="grid gap-1 sm:grid-cols-[7rem_1fr]"
                    key={event}
                  >
                    <span className="font-mono text-muted-foreground tabular-nums">
                      {time}
                    </span>
                    <span>{event}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    );
  }

  function renderClients() {
    return (
      <div className="space-y-5 lg:-mt-3 xl:-mt-5">
        <CompactHeader
          action={
            clientsTab === "tracker" ? (
              <Button onClick={() => setLeadCaptureOpen((open) => !open)}>
                <UserPlus aria-hidden /> Create client
              </Button>
            ) : undefined
          }
          icon={Users}
          title="Clients"
        />
        <Segmented
          onChange={setClientsTab}
          options={[
            { label: "Tracker", value: "tracker" },
            { label: "Client Fees", value: "client-fees" },
            { label: "Platform rev", value: "platform-rev" },
          ]}
          value={clientsTab}
        />
        {clientsTab === "tracker"
          ? renderClientsTracker()
          : clientsTab === "client-fees"
            ? renderFees()
            : renderPlatformRev()}
      </div>
    );
  }

  async function createPersistedTrackerClient() {
    const displayName = leadName.trim();
    if (!displayName || trackerCreatePendingRef.current) return;

    trackerCreatePendingRef.current = true;
    setTrackerCreatePending(true);
    setTrackerCreateError(false);
    try {
      const response = await fetch("/api/clients", {
        body: JSON.stringify({ displayName }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (response.status !== 200 && response.status !== 201) {
        throw new Error("tracker_create_failed");
      }
      await trackerClients.refetch();
      setSettingsNotice("Client saved to the funding-readiness tracker.");
      setLeadName("");
      setLeadCaptureOpen(false);
    } catch {
      setTrackerCreateError(true);
    } finally {
      trackerCreatePendingRef.current = false;
      setTrackerCreatePending(false);
    }
  }

  function trackerMutationMessage(error: unknown): string {
    return error instanceof Error && error.message.trim()
      ? error.message
      : "The client could not be updated.";
  }

  async function refreshTrackerAfterMutation(acceptedMessage: string): Promise<boolean> {
    try {
      await trackerClients.refetch();
      setTrackerMutationFeedback({ kind: "success", message: acceptedMessage });
      return true;
    } catch {
      setTrackerMutationFeedback({
        kind: "error",
        message: "The server confirmed the change, but the tracker could not be read back. Reload before making another client change.",
      });
      return false;
    }
  }

  async function saveTrackerClientEdit() {
    const draft = trackerEditDraft;
    if (draft === null || trackerMutationPending !== null) return;
    const displayName = draft.displayName.trim();
    if (!displayName) {
      setTrackerMutationFeedback({ kind: "error", message: "Client name is required." });
      return;
    }
    const assignmentChanged = draft.assignedToId !== draft.originalAssignedToId;
    if (
      assignmentChanged
      && draft.assignedToId !== null
      && !trackerClients.assignableMembers.some(
        (member) => member.active && member.id === draft.assignedToId,
      )
    ) {
      setTrackerMutationFeedback({
        kind: "error",
        message: "Choose an active team member from this workspace.",
      });
      return;
    }

    setTrackerMutationPending(`edit:${draft.id}`);
    setTrackerMutationFeedback(null);
    try {
      await patchOperatorTrackerClient(draft.id, {
        ...(assignmentChanged ? { assignedToId: draft.assignedToId } : {}),
        businessName: draft.businessName.trim() || null,
        displayName,
      });
      const refreshed = await refreshTrackerAfterMutation(`${displayName}'s client record was saved.`);
      if (refreshed) setTrackerEditDraft(null);
    } catch (error) {
      setTrackerMutationFeedback({ kind: "error", message: trackerMutationMessage(error) });
    } finally {
      setTrackerMutationPending(null);
    }
  }

  async function confirmTrackerStatusChange() {
    const candidate = trackerStatusCandidate;
    if (candidate === null || trackerMutationPending !== null) return;
    setTrackerMutationPending(`status:${candidate.id}`);
    setTrackerMutationFeedback(null);
    try {
      await patchOperatorTrackerClient(candidate.id, { status: candidate.status });
      const verb = candidate.status === "archived" ? "archived" : "reactivated";
      await refreshTrackerAfterMutation(`${candidate.name} was ${verb} and the tracker was refreshed.`);
      setTrackerStatusCandidate(null);
      setTrackerEditDraft(null);
    } catch (error) {
      setTrackerMutationFeedback({ kind: "error", message: trackerMutationMessage(error) });
    } finally {
      setTrackerMutationPending(null);
    }
  }

  async function runTrackerBulkMutation(input: {
    ids: readonly string[];
    label: string;
    patch: OperatorTrackerClientPatch;
  }) {
    if (input.ids.length === 0 || trackerMutationPending !== null) return;
    setTrackerMutationPending(`bulk:${input.label}`);
    setTrackerMutationFeedback(null);
    const completed: string[] = [];
    let failure: string | null = null;
    for (const id of input.ids) {
      try {
        await patchOperatorTrackerClient(id, input.patch);
        completed.push(id);
      } catch (error) {
        failure = trackerMutationMessage(error);
        break;
      }
    }

    if (completed.length > 0) {
      try {
        await trackerClients.refetch();
      } catch {
        failure = "The server confirmed changes, but the tracker could not be read back. Reload before continuing.";
      }
      setTrackerSelectedIds((current) => {
        const next = new Set(current);
        for (const id of completed) next.delete(id);
        return next;
      });
    }
    if (failure) {
      setTrackerMutationFeedback({
        kind: "error",
        message: completed.length === input.ids.length
          ? `${completed.length} clients were accepted by the server. ${failure}`
          : `${completed.length} of ${input.ids.length} clients changed before the operation stopped. ${failure}`,
      });
    } else {
      setTrackerMutationFeedback({
        kind: "success",
        message: `${completed.length} clients ${input.label} and confirmed by server read-back.`,
      });
    }
    setTrackerBulkArchiveCandidate(false);
    setTrackerBulkAssignmentCandidateId(null);
    setTrackerMutationPending(null);
  }

  function renderPersistedClientsTracker() {
    function TrackerIdentity({ client }: { client: TrackerClient }) {
      return (
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-[0.68rem] font-semibold text-muted-foreground">
            {initials(client.displayName)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {client.displayName}
            </span>
            {client.businessName ? (
              <span className="block truncate text-xs text-muted-foreground">
                {client.businessName}
              </span>
            ) : null}
          </span>
        </div>
      );
    }

    function formatTrackerTimestamp(timestamp: string) {
      return new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        timeZone: "UTC",
        year: "numeric",
      }).format(new Date(timestamp));
    }

    function TrackerStageMetadata({ client }: { client: TrackerClient }) {
      const timer = trackerStageTimer(
        client.stage,
        client.stageEnteredAt,
        new Date(),
      );
      return (
        <div className="space-y-1">
          <StatusPill>{TRACKER_STAGE_LABELS[client.stage]}</StatusPill>
          <p className="text-xs text-muted-foreground">
            Entered {formatTrackerTimestamp(client.stageEnteredAt)}
          </p>
          {timer ? (
            <p className="text-xs font-medium tabular-nums text-foreground">
              Day {timer.elapsedDays} of {timer.targetDays} · {timer.remainingDays} days remaining
            </p>
          ) : null}
        </div>
      );
    }

    const normalizedQuery = query.trim().toLowerCase();
    const filteredTrackerClients = trackerClients.clients.filter((client) => {
      const matchesSearch =
        !normalizedQuery ||
        `${client.displayName} ${client.businessName ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery);
      const matchesStage =
        trackerStageFilter === null || client.stage === trackerStageFilter;
      const matchesTeam =
        teamFilter === "all" || client.assignedToId === teamFilter;
      const matchesStatus =
        trackerStatusFilter === "all" || client.status === trackerStatusFilter;
      return matchesSearch && matchesStage && matchesTeam && matchesStatus;
    });
    const selectedTrackerClients = filteredTrackerClients.filter((client) =>
      trackerSelectedIds.has(client.id),
    );
    const selectedActiveTrackerClients = selectedTrackerClients.filter(
      (client) => client.status === "active",
    );
    const allSelectedTrackerClientsActive = selectedTrackerClients.length > 0
      && selectedActiveTrackerClients.length === selectedTrackerClients.length;
    const allFilteredSelected = filteredTrackerClients.length > 0
      && filteredTrackerClients.every((client) => trackerSelectedIds.has(client.id));
    const assignmentOptions = [
      { label: "Unassigned", value: "unassigned" },
      ...trackerClients.assignableMembers.map((member) => ({
        label: member.isCurrentUser ? `${member.fullName} (you)` : member.fullName,
        value: member.id,
      })),
    ];
    const exportClients = selectedTrackerClients.length > 0
      ? selectedTrackerClients
      : filteredTrackerClients;
    const bulkAssignmentName = trackerBulkAssignmentCandidateId === "unassigned"
      ? "Unassigned"
      : trackerClients.assignableMembers.find(
          (member) => member.id === trackerBulkAssignmentCandidateId,
        )?.fullName ?? null;

    function toggleTrackerClientSelection(clientId: string) {
      setTrackerSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(clientId)) next.delete(clientId);
        else next.add(clientId);
        return next;
      });
    }

    if (trackerClients.loading || trackerClients.enabled === null) {
      return (
        <Panel>
          <p className="text-sm text-muted-foreground" role="status">
            Loading funding-readiness tracker…
          </p>
        </Panel>
      );
    }

    if (trackerClients.error) {
      return (
        <Panel>
          <p className="text-sm text-destructive" role="alert">
            Unable to load the funding-readiness tracker.
          </p>
        </Panel>
      );
    }

    return (
      <div className="space-y-5">
        {leadCaptureOpen ? (
          <Panel
            description="This client will be saved to the funding-readiness tracker."
            title="Create client"
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="Client name"
                className="flex-1"
                disabled={trackerCreatePending}
                onChange={(event) => {
                  setLeadName(event.target.value);
                  setTrackerCreateError(false);
                }}
                placeholder="Client name"
                value={leadName}
              />
              <Button
                disabled={!leadName.trim() || trackerCreatePending}
                onClick={() => void createPersistedTrackerClient()}
              >
                {trackerCreatePending ? "Saving…" : "Create client"}
              </Button>
              <Button
                disabled={trackerCreatePending}
                onClick={() => {
                  setLeadCaptureOpen(false);
                  setTrackerCreateError(false);
                }}
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
            {trackerCreateError ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                Unable to save this client to the funding-readiness tracker.
              </p>
            ) : null}
          </Panel>
        ) : null}

        <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center">
          <Segmented
            onChange={setClientMode}
            options={[
              { icon: LayoutGrid, label: "Cards", value: "cards" },
              { icon: List, label: "Table", value: "table" },
              { icon: Columns3, label: "Board", value: "board" },
              { icon: Activity, label: "Timeline", value: "timeline" },
            ]}
            value={clientMode}
          />
          <label className="relative min-w-56 flex-1 xl:max-w-xs">
            <span className="sr-only">Search clients</span>
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search clients"
              value={query}
            />
          </label>
          <BrandSelect
            ariaLabel="Filter by stage"
            className="w-auto min-w-44"
            onValueChange={(next) =>
              setStageFilter(next as FundingStage | "All stages")
            }
            options={["All stages", ...FUNDING_STAGES]}
            value={stageFilter}
          />
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            Team member :
            <BrandSelect
              ariaLabel="Filter by team member"
              className="w-auto min-w-40"
              onValueChange={setTeamFilter}
              options={[
                { label: "All", value: "all" },
                ...trackerClients.assignableMembers.map((member) => ({
                  label: member.isCurrentUser ? `${member.fullName} (you)` : member.fullName,
                  value: member.id,
                })),
                ...(isTrackerUuid(teamFilter)
                  && !trackerClients.assignableMembers.some((member) => member.id === teamFilter)
                  ? [{ label: "Saved member", value: teamFilter }]
                  : []),
              ]}
              value={teamFilter}
            />
          </span>
          <BrandSelect
            ariaLabel="Filter by client status"
            className="w-auto min-w-40"
            onValueChange={(value) => {
              if (value === "all" || isTrackerClientStatus(value)) {
                setTrackerStatusFilter(value);
                setTrackerSelectedIds(new Set());
              }
            }}
            options={[
              { label: "Active clients", value: "active" },
              { label: "Archived clients", value: "archived" },
              { label: "All statuses", value: "all" },
            ]}
            value={trackerStatusFilter}
          />
          <BrandSelect
            ariaLabel="Filter by affiliate"
            className="w-auto min-w-44"
            onValueChange={setAffiliateFilter}
            options={[
              { label: "All affiliates", value: "all" },
              { label: "No affiliate", value: "none" },
              ...(durableWorkspace
                ? affiliateRoster.map((affiliate) => ({
                    label: affiliate.active ? affiliate.name : `${affiliate.name} (inactive)`,
                    value: affiliate.affiliateId,
                  }))
                : AFFILIATES.map((affiliate) => ({
                    label: affiliate.name,
                    value: affiliate.id,
                  }))),
            ]}
            value={affiliateFilter}
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {filteredTrackerClients.length} shown
          </span>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 lg:flex-row lg:flex-wrap lg:items-center">
          <Button
            disabled={filteredTrackerClients.length === 0 || trackerMutationPending !== null}
            onClick={() => {
              setTrackerSelectedIds((current) => {
                const next = new Set(current);
                for (const client of filteredTrackerClients) {
                  if (allFilteredSelected) next.delete(client.id);
                  else next.add(client.id);
                }
                return next;
              });
            }}
            size="sm"
            variant="outline"
          >
            {allFilteredSelected ? "Clear shown" : "Select all shown"}
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {selectedTrackerClients.length} selected
          </span>
          <BrandSelect
            ariaLabel="Assign selected clients"
            className="min-w-48"
            disabled={!allSelectedTrackerClientsActive || trackerMutationPending !== null}
            onValueChange={setTrackerBulkAssigneeId}
            options={[
              { label: "Choose assignee", value: "choose" },
              ...assignmentOptions,
            ]}
            value={trackerBulkAssigneeId}
          />
          <Button
            disabled={
              !allSelectedTrackerClientsActive
              || trackerBulkAssigneeId === "choose"
              || trackerMutationPending !== null
            }
            onClick={() => setTrackerBulkAssignmentCandidateId(trackerBulkAssigneeId)}
            size="sm"
          >
            Assign selected
          </Button>
          <Button
            disabled={
              !trackerClients.consoleOpsEnabled
              || !allSelectedTrackerClientsActive
              || trackerMutationPending !== null
            }
            onClick={() => setTrackerBulkArchiveCandidate(true)}
            size="sm"
            variant="destructive"
          >
            <Archive aria-hidden /> Archive selected
          </Button>
          <Button
            disabled={exportClients.length === 0}
            onClick={() => {
              downloadTrackerClientsCsv(exportClients);
              setTrackerMutationFeedback({
                kind: "success",
                message: `${exportClients.length} ${selectedTrackerClients.length ? "selected" : "filtered"} client records exported to CSV.`,
              });
            }}
            size="sm"
            variant="outline"
          >
            <Download aria-hidden /> Export CSV
          </Button>
          <span className="text-xs text-muted-foreground lg:ml-auto">
            {selectedTrackerClients.length > 0 && !allSelectedTrackerClientsActive
              ? "Bulk assignment and archive apply to active-only selections."
              : "Search, filters, status, and view are saved in this URL."}
          </span>
        </div>

        {trackerMutationFeedback ? (
          <div
            className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              trackerMutationFeedback.kind === "error"
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "border-primary/20 bg-primary/5 text-primary-ink",
            )}
            role={trackerMutationFeedback.kind === "error" ? "alert" : "status"}
          >
            {trackerMutationFeedback.message}
          </div>
        ) : settingsNotice ? (
          <div
            className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary-ink"
            role="status"
          >
            {settingsNotice}
          </div>
        ) : null}

        {filteredTrackerClients.length === 0 ? (
          <EmptyState
            action={
              <Button
                onClick={() => {
                  setQuery("");
                  setStageFilter("All stages");
                  setTeamFilter("all");
                  setAffiliateFilter("all");
                  setTrackerStatusFilter("active");
                  setTrackerSelectedIds(new Set());
                }}
                variant="outline"
              >
                Clear filters
              </Button>
            }
            description={
              trackerClients.empty
                ? "No clients have been saved to this tracker."
                : "No clients match the current search and filters."
            }
            title={trackerClients.empty ? "No tracker clients" : "No matching clients"}
          />
        ) : null}

        {filteredTrackerClients.length > 0 && clientMode === "cards" ? (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {filteredTrackerClients.map((client) => (
              <article
                className={cn(
                  "rounded-xl border bg-card p-4 shadow-[var(--consumer-surface-shadow)]",
                  trackerSelectedIds.has(client.id) ? "border-primary-ink" : "border-border",
                )}
                key={client.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <input
                      aria-label={`Select ${client.displayName}`}
                      checked={trackerSelectedIds.has(client.id)}
                      className="size-4 accent-primary"
                      disabled={trackerMutationPending !== null}
                      onChange={() => toggleTrackerClientSelection(client.id)}
                      type="checkbox"
                    />
                    Select
                  </label>
                  <StatusPill tone={client.status === "archived" ? "neutral" : "success"}>
                    {client.status}
                  </StatusPill>
                </div>
                <button
                  className="mt-2 w-full rounded-md text-left transition-colors hover:text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => openTrackerClient(client.id)}
                  type="button"
                >
                  <TrackerIdentity client={client} />
                  <p className="mt-3 text-xs text-muted-foreground">
                    {client.assignedToName ?? "Unassigned"}
                  </p>
                  <div className="mt-4 border-t border-border pt-4">
                    <TrackerStageMetadata client={client} />
                  </div>
                </button>
              </article>
            ))}
          </div>
        ) : null}

        {filteredTrackerClients.length > 0 && clientMode === "table" ? (
          <Panel className="overflow-hidden">
            <div className="hidden md:block">
              <Table className="min-w-[820px]" containerLabel="Clients data table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Select</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Entered</TableHead>
                    <TableHead>Timer</TableHead>
                    <TableHead>Team member</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTrackerClients.map((client) => {
                    const timer = trackerStageTimer(
                      client.stage,
                      client.stageEnteredAt,
                      new Date(),
                    );
                    return (
                      <TableRow key={client.id}>
                        <TableCell>
                          <input
                            aria-label={`Select ${client.displayName}`}
                            checked={trackerSelectedIds.has(client.id)}
                            className="size-4 accent-primary"
                            disabled={trackerMutationPending !== null}
                            onChange={() => toggleTrackerClientSelection(client.id)}
                            type="checkbox"
                          />
                        </TableCell>
                        <TableCell>
                          <button
                            className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => openTrackerClient(client.id)}
                            type="button"
                          >
                            <TrackerIdentity client={client} />
                          </button>
                        </TableCell>
                        <TableCell>
                          <StatusPill tone={client.status === "archived" ? "neutral" : "success"}>
                            {client.status}
                          </StatusPill>
                        </TableCell>
                        <TableCell>
                          <StatusPill>{TRACKER_STAGE_LABELS[client.stage]}</StatusPill>
                        </TableCell>
                        <TableCell>{formatTrackerTimestamp(client.stageEnteredAt)}</TableCell>
                        <TableCell className="tabular-nums">
                          {timer
                            ? `Day ${timer.elapsedDays} of ${timer.targetDays}`
                            : "—"}
                        </TableCell>
                        <TableCell>{client.assignedToName ?? "Unassigned"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-border md:hidden">
              {filteredTrackerClients.map((client) => (
                <li className="py-4 first:pt-0 last:pb-0" key={client.id}>
                  <div className="flex items-start gap-3">
                    <input
                      aria-label={`Select ${client.displayName}`}
                      checked={trackerSelectedIds.has(client.id)}
                      className="mt-3 size-4 accent-primary"
                      disabled={trackerMutationPending !== null}
                      onChange={() => toggleTrackerClientSelection(client.id)}
                      type="checkbox"
                    />
                    <button
                      className="min-h-11 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => openTrackerClient(client.id)}
                      type="button"
                    >
                      <TrackerIdentity client={client} />
                    </button>
                    <StatusPill tone={client.status === "archived" ? "neutral" : "success"}>
                      {client.status}
                    </StatusPill>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3">
                    <MobileField label="Stage">
                      {TRACKER_STAGE_LABELS[client.stage]}
                    </MobileField>
                    <MobileField label="Team member">
                      {client.assignedToName ?? "Unassigned"}
                    </MobileField>
                    <MobileField className="col-span-2" label="Stage timing">
                      <TrackerStageMetadata client={client} />
                    </MobileField>
                  </dl>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {filteredTrackerClients.length > 0 && clientMode === "board" ? (
          <div className="grid auto-cols-[18rem] grid-flow-col gap-3 overflow-x-auto pb-3">
            {Object.entries(TRACKER_STAGE_LABELS).map(([stage, label]) => {
              const stageClients = filteredTrackerClients.filter(
                (client) => client.stage === stage,
              );
              return (
                <section
                  className="min-h-[26rem] rounded-xl border border-border bg-muted/25"
                  key={stage}
                >
                  <header className="flex items-center justify-between border-b border-border px-4 py-3">
                    <h2 className="text-xs font-semibold">{label}</h2>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {stageClients.length}
                    </span>
                  </header>
                  <div className="space-y-2 p-2">
                    {stageClients.map((client) => (
                      <article
                        className={cn(
                          "w-full rounded-lg border bg-card p-3",
                          trackerSelectedIds.has(client.id) ? "border-primary-ink" : "border-border",
                        )}
                        key={client.id}
                      >
                        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                          <input
                            aria-label={`Select ${client.displayName}`}
                            checked={trackerSelectedIds.has(client.id)}
                            className="size-4 accent-primary"
                            disabled={trackerMutationPending !== null}
                            onChange={() => toggleTrackerClientSelection(client.id)}
                            type="checkbox"
                          />
                          Select
                        </label>
                        <button
                          className="w-full rounded-md text-left transition-colors hover:text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => openTrackerClient(client.id)}
                          type="button"
                        >
                          <TrackerIdentity client={client} />
                          {trackerClients.consoleOpsEnabled ? (
                            <p aria-label={`Health: ${client.health}`} className="mt-2 flex items-center gap-2 text-xs capitalize text-muted-foreground">
                              <span aria-hidden className={cn("size-2 rounded-full", client.health === "red" ? "bg-destructive" : client.health === "amber" ? "bg-amber-500" : "bg-emerald-500")} />
                              {client.health}
                            </p>
                          ) : null}
                          <div className="mt-3">
                            <TrackerStageMetadata client={client} />
                          </div>
                          <p className="mt-3 text-xs text-muted-foreground">
                            {client.assignedToName ?? "Unassigned"}
                          </p>
                        </button>
                      </article>
                    ))}
                    {stageClients.length === 0 ? (
                      <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                        No clients
                      </p>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}

        {filteredTrackerClients.length > 0 && clientMode === "timeline" ? (
          <Panel>
            <div className="space-y-4">
              {filteredTrackerClients.map((client) => (
                <article
                  className="rounded-lg border border-border p-4"
                  key={client.id}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                    <input
                      aria-label={`Select ${client.displayName}`}
                      checked={trackerSelectedIds.has(client.id)}
                      className="mt-3 size-4 shrink-0 accent-primary"
                      disabled={trackerMutationPending !== null}
                      onChange={() => toggleTrackerClientSelection(client.id)}
                      type="checkbox"
                    />
                    {/* The identity carries the click here rather than the whole
                        row: the row holds the transition list, and an <ol>
                        inside a <button> is not valid content. */}
                    <button
                      className="min-h-11 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => openTrackerClient(client.id)}
                      type="button"
                    >
                      <TrackerIdentity client={client} />
                    </button>
                    <ol className="flex-1 space-y-2">
                      {[...client.history]
                        .sort(
                          (left, right) =>
                            Date.parse(left.at) - Date.parse(right.at),
                        )
                        .map((entry, index) => (
                          <li
                            className="rounded-md bg-muted/50 px-3 py-2 text-xs"
                            key={`${entry.at}-${entry.to}-${index}`}
                          >
                            {entry.from
                              ? `${TRACKER_STAGE_LABELS[entry.from]} → `
                              : ""}
                            {TRACKER_STAGE_LABELS[entry.to]} · {formatTrackerTimestamp(entry.at)}
                          </li>
                        ))}
                    </ol>
                    <div className="min-w-48 rounded-md bg-primary/5 px-3 py-2">
                      <p className="text-xs font-semibold">
                        Current · {TRACKER_STAGE_LABELS[client.stage]}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Entered {formatTrackerTimestamp(client.stageEnteredAt)}
                      </p>
                      <div className="mt-2">
                        <TrackerStageMetadata client={client} />
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        ) : null}

        <Dialog
          onOpenChange={(open) => {
            if (!open && trackerMutationPending === null) {
              setTrackerBulkAssignmentCandidateId(null);
            }
          }}
          open={trackerBulkAssignmentCandidateId !== null}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign {selectedTrackerClients.length} clients?</DialogTitle>
              <DialogDescription>
                {bulkAssignmentName === null
                  ? "This saved team member is no longer available. Choose an active member and try again."
                  : `The selected clients will be assigned to ${bulkAssignmentName}. The server checks each client and stops if any assignment is refused.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                disabled={trackerMutationPending !== null}
                onClick={() => setTrackerBulkAssignmentCandidateId(null)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={
                  bulkAssignmentName === null
                  || !allSelectedTrackerClientsActive
                  || trackerMutationPending !== null
                }
                onClick={() => {
                  const assigneeId = trackerBulkAssignmentCandidateId;
                  if (assigneeId === null || bulkAssignmentName === null) return;
                  void runTrackerBulkMutation({
                    ids: selectedTrackerClients.map((client) => client.id),
                    label: assigneeId === "unassigned"
                      ? "unassigned"
                      : `assigned to ${bulkAssignmentName}`,
                    patch: {
                      assignedToId: assigneeId === "unassigned" ? null : assigneeId,
                    },
                  });
                }}
              >
                {trackerMutationPending !== null ? "Saving…" : "Confirm assignment"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          onOpenChange={(open) => {
            if (!open && trackerMutationPending === null) {
              setTrackerBulkArchiveCandidate(false);
            }
          }}
          open={trackerBulkArchiveCandidate}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Archive {selectedActiveTrackerClients.length} clients?</DialogTitle>
              <DialogDescription>
                Archived clients leave the default active tracker but keep their history and can be reactivated later. The server checks each client and stops if any archive is refused.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                disabled={trackerMutationPending !== null}
                onClick={() => setTrackerBulkArchiveCandidate(false)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={
                  !trackerClients.consoleOpsEnabled
                  || !allSelectedTrackerClientsActive
                  || trackerMutationPending !== null
                }
                onClick={() => {
                  void runTrackerBulkMutation({
                    ids: selectedActiveTrackerClients.map((client) => client.id),
                    label: "archived",
                    patch: { status: "archived" },
                  });
                }}
                variant="destructive"
              >
                {trackerMutationPending !== null ? "Archiving…" : "Archive clients"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  function renderClientsTracker() {
    if (trackerClients.enabled !== false) {
      return renderPersistedClientsTracker();
    }

    // A signed-in workspace whose tracker read came back disabled has no client
    // book to show. The fixture book below is eight strangers with recorded
    // funded amounts and named lenders, and handing it to a real operator is
    // the failure this whole pass exists to remove.
    if (durableWorkspace) {
      return (
        <Panel>
          <p className="text-sm text-muted-foreground" role="status">
            The funding-readiness tracker is not available for this workspace,
            so no client records can be shown.
          </p>
        </Panel>
      );
    }

    return (
      <div className="space-y-5">
        {leadCaptureOpen ? (
          <Panel
            description="This creates local fixture state only."
            title="Create client"
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="Client name"
                className="flex-1"
                onChange={(event) => setLeadName(event.target.value)}
                placeholder="Client name"
                value={leadName}
              />
              <Button
                disabled={!leadName.trim()}
                onClick={() => {
                  const clientName = leadName.trim();
                  if (clientAssignmentMode === "manual") {
                    setFixtureTasks((current) => [
                      {
                        assignee: "Alec Rivera",
                        assigneeProfileId: null,
                        clientId: null,
                        dueAt: "Today",
                        dueOn: null,
                        id: `task-assignment-${Date.now()}`,
                        notes: `Created automatically for ${clientName}.`,
                        priority: "high",
                        status: "pending",
                        title: `Assign ${clientName} to a team member`,
                        type: "Assignment",
                      },
                      ...current,
                    ]);
                  }
                  setSettingsNotice(
                    clientAssignmentMode === "manual"
                      ? `${clientName} was added as a demo client record. An assignment task was created for Alec Rivera.`
                      : `${clientName} was added as a demo client record and queued for round-robin assignment.`,
                  );
                  setLeadName("");
                  setLeadCaptureOpen(false);
                }}
              >
                Create client
              </Button>
              <Button onClick={() => setLeadCaptureOpen(false)} variant="ghost">
                Cancel
              </Button>
            </div>
          </Panel>
        ) : null}

        <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center">
          <Segmented
            onChange={setClientMode}
            options={[
              { icon: LayoutGrid, label: "Cards", value: "cards" },
              { icon: List, label: "Table", value: "table" },
              { icon: Columns3, label: "Board", value: "board" },
              { icon: Activity, label: "Timeline", value: "timeline" },
            ]}
            value={clientMode}
          />
          <label className="relative min-w-56 flex-1 xl:max-w-xs">
            <span className="sr-only">Search clients</span>
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search clients"
              value={query}
            />
          </label>
          <BrandSelect
            ariaLabel="Filter by stage"
            className="w-auto min-w-44"
            onValueChange={(next) =>
              setStageFilter(next as FundingStage | "All stages")
            }
            options={["All stages", ...FUNDING_STAGES]}
            value={stageFilter}
          />
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            Team member :
            <BrandSelect
              ariaLabel="Filter by team member"
              className="w-auto min-w-40"
              onValueChange={setTeamFilter}
              options={[
                { label: "All", value: "all" },
                ...teamRows.map((member) => ({
                  label: member.name,
                  value: member.id,
                })),
              ]}
              value={teamFilter}
            />
          </span>
          <BrandSelect
            ariaLabel="Filter by affiliate"
            className="w-auto min-w-44"
            onValueChange={setAffiliateFilter}
            options={[
              { label: "All affiliates", value: "all" },
              { label: "No affiliate", value: "none" },
              ...AFFILIATES.map((affiliate) => ({
                label: affiliate.name,
                value: affiliate.id,
              })),
            ]}
            value={affiliateFilter}
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {filteredClients.length} shown
          </span>
        </div>

        {settingsNotice ? (
          <div
            className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary-ink"
            role="status"
          >
            {settingsNotice}
          </div>
        ) : null}

        {filteredClients.length === 0 ? (
          <EmptyState
            action={
              <Button
                onClick={() => {
                  setQuery("");
                  setStageFilter("All stages");
                  setTeamFilter("all");
                  setAffiliateFilter("all");
                }}
                variant="outline"
              >
                Clear filters
              </Button>
            }
            description="No clients match the current search and filters."
            title="No matching clients"
          />
        ) : null}

        {filteredClients.length > 0 && clientMode === "cards" ? (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {filteredClients.map((client) => {
              const funded = getClientFundedAmount(client.clientId);
              return (
                <button
                  className="rounded-xl border border-border bg-card p-4 text-left shadow-[var(--consumer-surface-shadow)] transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  key={client.clientId}
                  onClick={() => openClient(client.clientId)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <ClientIdentity client={client} />
                    <StatusPill tone={healthTone(client.health)}>
                      {client.health}
                    </StatusPill>
                  </div>
                  <div className="mt-5">
                    <ClientProgress
                      client={client}
                      fundedAmount={funded}
                      goal={getGoal(client)}
                    />
                  </div>
                  <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                    {client.next}
                  </p>
                </button>
              );
            })}
          </div>
        ) : null}

        {filteredClients.length > 0 && clientMode === "table" ? (
          <Panel className="overflow-hidden">
            <div className="hidden md:block">
              <Table className="min-w-[980px]" containerLabel="Clients data table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead>Team member</TableHead>
                    <TableHead>Affiliate</TableHead>
                    <TableHead>Next action</TableHead>
                    <TableHead>Health</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClients.map((client) => (
                    <TableRow key={client.clientId}>
                      <TableCell>
                        <button
                          className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => openClient(client.clientId)}
                          type="button"
                        >
                          <ClientIdentity client={client} />
                        </button>
                      </TableCell>
                      <TableCell>
                        <StatusPill>{client.stage}</StatusPill>
                      </TableCell>
                      <TableCell className="min-w-56">
                        <ClientProgress
                          client={client}
                          fundedAmount={getClientFundedAmount(client.clientId)}
                          goal={getGoal(client)}
                        />
                      </TableCell>
                      <TableCell>
                        {teamRows.find((member) => member.id === getClientOwnerId(client))
                          ?.name ?? "Unassigned"}
                      </TableCell>
                      <TableCell>
                        {affiliateShares.find(
                          (share) => share.clientId === client.clientId,
                        )?.affiliateName ?? "None"}
                      </TableCell>
                      <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                        {client.next}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={healthTone(client.health)}>
                          {client.health}
                        </StatusPill>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-border md:hidden">
              {filteredClients.map((client) => (
                <li
                  className="py-4 first:pt-0 last:pb-0"
                  key={client.clientId}
                >
                  <button
                    className="min-h-11 w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => openClient(client.clientId)}
                    type="button"
                  >
                    <ClientIdentity client={client} />
                  </button>
                  <dl className="mt-4 grid grid-cols-2 gap-3">
                    <MobileField label="Stage">{client.stage}</MobileField>
                    <MobileField label="Team member">
                      {teamRows.find((member) => member.id === getClientOwnerId(client))
                        ?.name ?? "Unassigned"}
                    </MobileField>
                    <MobileField className="col-span-2" label="Progress">
                      <ClientProgress
                        client={client}
                        fundedAmount={getClientFundedAmount(client.clientId)}
                        goal={getGoal(client)}
                      />
                    </MobileField>
                    <MobileField className="col-span-2" label="Next action">
                      <span className="font-normal text-muted-foreground">
                        {client.next}
                      </span>
                    </MobileField>
                  </dl>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {filteredClients.length > 0 && clientMode === "board" ? (
          <div className="grid auto-cols-[18rem] grid-flow-col gap-3 overflow-x-auto pb-3">
            {FUNDING_STAGES.map((stage) => {
              const stageClients = filteredClients.filter(
                (client) => client.stage === stage,
              );
              return (
                <section
                  className="min-h-[26rem] rounded-xl border border-border bg-muted/25"
                  key={stage}
                >
                  <header className="flex items-center justify-between border-b border-border px-4 py-3">
                    <h2 className="text-xs font-semibold">{stage}</h2>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {stageClients.length}
                    </span>
                  </header>
                  <div className="space-y-2 p-2">
                    {stageClients.map((client) => (
                      <button
                        className="w-full rounded-lg border border-border bg-card p-3 text-left hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        key={client.clientId}
                        onClick={() => openClient(client.clientId)}
                        type="button"
                      >
                        <ClientIdentity client={client} />
                        <div className="mt-3">
                          <ClientProgress
                            client={client}
                            fundedAmount={getClientFundedAmount(client.clientId)}
                            goal={getGoal(client)}
                          />
                        </div>
                        <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {client.next}
                        </p>
                      </button>
                    ))}
                    {stageClients.length === 0 ? (
                      <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                        No clients
                      </p>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}

        {filteredClients.length > 0 && clientMode === "timeline" ? (
          <Panel>
            <div className="space-y-4">
              {filteredClients.map((client) => {
                const activeIndex = FUNDING_STAGES.indexOf(client.stage);
                return (
                  <button
                    className="w-full rounded-lg border border-border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    key={client.clientId}
                    onClick={() => openClient(client.clientId)}
                    type="button"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                      <ClientIdentity client={client} />
                      <div className="grid flex-1 grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-6">
                        {FUNDING_STAGES.map((stage, index) => (
                          <span
                            className={cn(
                              "rounded px-2 py-1.5 text-center text-[0.65rem] font-medium",
                              index < activeIndex
                                ? "bg-[color-mix(in_srgb,var(--consumer-positive),transparent_92%)] text-[var(--consumer-positive)]"
                                : index === activeIndex
                                  ? "bg-primary/10 text-primary-ink"
                                  : "bg-muted text-muted-foreground",
                            )}
                            key={stage}
                          >
                            {index <= activeIndex ? stage : "Pending"}
                          </span>
                        ))}
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">
                        Started {formatDate(client.startedAt)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Panel>
        ) : null}
      </div>
    );
  }

  function renderBankVault() {
    // FEATURE_VAULT on and the catalog read has not landed. The fixture book is
    // not an acceptable stand-in here — every number on the page below is a
    // recorded outcome an operator would act on — so the section says so
    // instead, the way the fee ledger does when its read fails.
    if (bankVaultUnreadable) {
      const failed = bankListSource === "failed";
      return (
        <div className="space-y-5 pb-36">
          <CompactHeader
            description={bankVaultHeaderCopy}
            icon={Landmark}
            title="Bank Vault"
          />
          <Panel
            description="Approval rate and average funded amount are historical recorded outcomes, not offers."
            title="Bank list"
          >
            <p
              className={cn("text-sm", failed ? "text-destructive" : "text-muted-foreground")}
              role={failed ? "alert" : "status"}
            >
              {failed ? "Unable to load lender records." : "Loading lender records…"}
            </p>
          </Panel>
        </div>
      );
    }

    const stats = bankStatsByPeriod[period];
    // Both bank pickers below are fed the whole catalog for the period, so
    // their length varies with the workspace rather than with the code: a
    // provisioned workspace syncs dozens of banks and gets a filter box, while
    // the local fixture set is short enough that the picker stays a plain
    // list. The shared combobox decides that from the option count, so neither
    // call site hard-codes a `searchable` answer that would be wrong in the
    // other environment.
    const bankOptions = stats.map((bank) => ({
      label: bank.bankName,
      value: bank.bankId,
    }));
    const selectedBank = stats.find((bank) => bank.bankId === activeBankId);
    const commentDraft = bankCommentDrafts[activeBankId] ?? "";
    const updateRows = [...stats].sort(
      (left, right) =>
        right.approvalRate - left.approvalRate || right.outcomes - left.outcomes,
    );
    const trendRows = OUTCOME_PERIODS.map((option, index) => {
      const bank = bankStatsByPeriod[option.id].find(
        (bank) => bank.bankId === activeBankId,
      );
      const priorPeriod = index > 0 ? OUTCOME_PERIODS[index - 1] : undefined;
      const prior = priorPeriod
        ? bankStatsByPeriod[priorPeriod.id].find(
            (row) => row.bankId === activeBankId,
          )
        : undefined;
      return {
        bank,
        hasComparison: Boolean(bank?.outcomes && prior?.outcomes),
        label: option.label,
        state: classifyBankTrend(bank, prior),
      };
    });
    return (
      // pb reserves room for the fixed "Leave a comment" control so it never
      // covers a row action at the bottom of the list.
      <div className="space-y-5 pb-36">
        <CompactHeader
          description={bankVaultHeaderCopy}
          icon={Landmark}
          title="Bank Vault"
        />
        <Segmented
          onChange={setBankVaultTab}
          options={[
            { label: "Banks", value: "banks" },
            { label: "Updates", value: "updates" },
            { label: "Bank trends", value: "trends" },
          ]}
          value={bankVaultTab}
        />
        <p className="text-xs leading-5 text-muted-foreground">
          {bankVaultSourceCopy}
        </p>
        {bankVaultTab === "banks" ? (
          <>
        {/* TODO(#208: referent inferred — confirm the broken-formatting screenshot) */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-full text-xs font-medium text-muted-foreground sm:w-auto">Historical window</span>
            {OUTCOME_PERIODS.map((option) => (
              <Button
                aria-pressed={period === option.id}
                key={option.id}
                onClick={() => setPeriod(option.id)}
                size="sm"
                variant={period === option.id ? "secondary" : "outline"}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <div aria-label="Banks view" className="flex flex-wrap items-center gap-2" role="group">
            <span className="text-xs font-medium text-muted-foreground">View</span>
            <Button aria-pressed={bankViewMode === "list"} className="min-h-11" onClick={() => setBankViewMode("list")} size="sm" variant={bankViewMode === "list" ? "secondary" : "outline"}>
              <List aria-hidden /> List
            </Button>
            <Button aria-pressed={bankViewMode === "tiles"} className="min-h-11" onClick={() => setBankViewMode("tiles")} size="sm" variant={bankViewMode === "tiles" ? "secondary" : "outline"}>
              <LayoutGrid aria-hidden /> Tiles
            </Button>
          </div>
        </div>
        {bankViewMode === "list" ? (
        <Panel
          description="Approval rate and average funded amount are historical recorded outcomes, not offers."
          title="Bank list"
          trailing={
            <Button
              aria-label="Leave a bank comment"
              className="min-h-11"
              onClick={() => setBankCommentOpen(true)}
              size="sm"
              variant="outline"
            >
              <MessageSquare aria-hidden /> Leave a comment
            </Button>
          }
        >
          <div className="hidden overflow-x-auto lg:block">
            <Table className="min-w-[860px]" containerLabel="Bank Vault bank list">
              <TableHeader>
                <TableRow>
                  <TableHead>Bank</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead className="text-center">Heat Level</TableHead>
                  <TableHead className="text-center">Recent approval rate</TableHead>
                  <TableHead className="text-center">Avg funded</TableHead>
                  <TableHead className="text-center">Comments</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.map((bank) => (
                  <TableRow key={bank.bankId}>
                    <TableCell>
                      <button
                        aria-label={`Open ${bank.bankName} detail`}
                        className="inline-flex min-h-6 items-center font-semibold text-foreground underline-offset-4 hover:text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setDetailBankId(bank.bankId)}
                        type="button"
                      >
                        {bank.bankName}
                      </button>
                    </TableCell>
                    <TableCell className="max-w-52 whitespace-normal">
                      {bank.products.join(" · ")}
                    </TableCell>
                    <TableCell className="text-center">
                      <StatusPill
                        tone={
                          bank.momentum === "hot"
                            ? "success"
                            : bank.momentum === "fair"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {titleCase(bank.momentum)}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {bank.outcomes
                        ? formatDemoPercent(bank.approvalRate)
                        : "No outcomes"}
                    </TableCell>
                    <TableCell className="text-center font-semibold tabular-nums">
                      {bank.fundedCount
                        ? formatDemoMoney(bank.averageFundedAmount)
                        : "No funded results"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        aria-label={`Comment on ${bank.bankName}`}
                        onClick={() => {
                          setSelectedBankId(bank.bankId);
                          setBankCommentOpen(true);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        <MessageSquare aria-hidden />
                        Add
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="divide-y divide-border lg:hidden">
            {stats.map((bank) => (
              <article
                className="py-4 first:pt-0 last:pb-0"
                key={bank.bankId}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <button
                      aria-label={`Open ${bank.bankName} detail`}
                      className="inline-flex min-h-6 items-center text-left text-sm font-semibold underline-offset-4 hover:text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setDetailBankId(bank.bankId)}
                      type="button"
                    >
                      {bank.bankName}
                    </button>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {bank.products.join(" · ")}
                    </p>
                  </div>
                  <StatusPill
                    tone={
                      bank.momentum === "hot"
                        ? "success"
                        : bank.momentum === "fair"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {titleCase(bank.momentum)}
                  </StatusPill>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3">
                  <MobileField label="Recent approval rate">
                    {bank.outcomes
                      ? formatDemoPercent(bank.approvalRate)
                      : "No outcomes"}
                  </MobileField>
                  <MobileField label="Avg funded">
                    {bank.fundedCount
                      ? formatDemoMoney(bank.averageFundedAmount)
                      : "No results"}
                  </MobileField>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    className="min-h-11"
                    onClick={() => {
                      setSelectedBankId(bank.bankId);
                      setBankCommentOpen(true);
                    }}
                    size="sm"
                    variant="outline"
                  >
                    <MessageSquare aria-hidden /> Add comment
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {stats.map((bank) => {
              return (
                <article className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-[var(--consumer-surface-shadow)]" key={bank.bankId}>
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="break-words text-base font-semibold">{bank.bankName}</h2>
                      <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{bank.products.join(" · ")}</p>
                    </div>
                    <StatusPill tone={bank.momentum === "hot" ? "success" : bank.momentum === "fair" ? "warning" : "neutral"}>{titleCase(bank.momentum)}</StatusPill>
                  </div>
                  <dl className="mt-4 grid grid-cols-1 gap-3 min-[430px]:grid-cols-2">
                    {/* The catalog row's own answer or "Not specified". The
                        illustrative map used to fill this in whenever the
                        durable column was null, so a lender the sync had no
                        bureau-pull record for still named one. */}
                    <MobileField label="Bureau pulls">{bank.bureauPulls ?? "Not specified"}</MobileField>
                    <MobileField label="Heat level">{titleCase(bank.momentum)}</MobileField>
                    <MobileField label="Average funded — recorded historical outcome">{bank.fundedCount ? formatDemoMoney(bank.averageFundedAmount) : "No funded results"}</MobileField>
                    <MobileField label="Recent approval rate — recorded historical outcome">{bank.outcomes ? formatDemoPercent(bank.approvalRate) : "No outcomes"}</MobileField>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button className="min-h-11" onClick={() => setDetailBankId(bank.bankId)} size="sm" variant="outline">Open details</Button>
                    <Button className="min-h-11" onClick={() => { setSelectedBankId(bank.bankId); setBankCommentOpen(true); }} size="sm" variant="outline"><MessageSquare aria-hidden /> Comment</Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
          </>
        ) : null}
        {bankVaultTab === "updates" ? (
          <Panel
            description="Ranked from the selected recorded-outcome window, not lender offers."
            title="Updates"
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {updateRows.map((bank) => (
                <button
                  className="rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  key={bank.bankId}
                  onClick={() => {
                    setSelectedBankId(bank.bankId);
                    setBankVaultTab("trends");
                  }}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{bank.bankName}</span>
                    <StatusPill>{titleCase(bank.momentum)}</StatusPill>
                  </span>
                  <span className="mt-4 grid grid-cols-2 gap-3">
                    <span className="text-sm font-semibold tabular-nums">
                      {bank.outcomes
                        ? formatDemoPercent(bank.approvalRate)
                        : "No outcomes"}
                    </span>
                    <span className="text-right text-sm text-muted-foreground tabular-nums">
                      {formatDemoNumber(bank.outcomes)} outcomes
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </Panel>
        ) : null}
        {bankVaultTab === "trends" ? (
          <Panel
            description="The same bank compared across each available recorded-outcome window."
            title="Bank trends"
          >
            <div className="mb-4 flex justify-end">
              <BrandSelect
                ariaLabel="Bank trend"
                className="w-full sm:w-72"
                emptyMessage="No banks match that name"
                onValueChange={setSelectedBankId}
                options={bankOptions}
                searchPlaceholder="Filter banks"
                value={activeBankId}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {trendRows.map(({ bank, hasComparison, label, state }) => {
                const { Icon, className } = BANK_TREND_PRESENTATION[state];
                return (
                  <div className={cn("rounded-xl border p-4", className)} key={label}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold">{label}</p>
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                        <Icon aria-hidden className="size-4" /> {state}
                      </span>
                    </div>
                    <p className="mt-3 text-xs opacity-75">Historical approval rate</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{bank?.outcomes ? formatDemoPercent(bank.approvalRate) : "No outcomes"}</p>
                    <p className="mt-2 text-xs opacity-75">{formatDemoNumber(bank?.outcomes ?? 0)} recorded outcomes · {hasComparison ? "Compared with prior window" : "No recorded comparison"}</p>
                  </div>
                );
              })}
            </div>
          </Panel>
        ) : null}
        <Dialog onOpenChange={setBankCommentOpen} open={bankCommentOpen}>
          <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>
                Comment · {selectedBank?.bankName ?? "Select a bank"}
              </DialogTitle>
              <DialogDescription>
                Earn free credits for submitting approved datapoints. Your help
                makes the platform more powerful. Let&rsquo;s all work together!
                {/* #99 incentive copy kept as Alec supplied it (sentence-casing
                    and the missing apostrophe are the only changes). */}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="bank-comment-target"
                >
                  Bank
                </label>
                <BrandSelect
                  ariaLabel="Bank"
                  className="mt-1"
                  emptyMessage="No banks match that name"
                  id="bank-comment-target"
                  onValueChange={setSelectedBankId}
                  options={bankOptions}
                  searchPlaceholder="Filter banks"
                  value={activeBankId}
                />
              </div>
              <Textarea
                disabled
                aria-label={`Add comment for ${selectedBank?.bankName ?? "the selected bank"}`}
                onChange={(event) =>
                  setBankCommentDrafts((current) => ({
                    ...current,
                    [activeBankId]: event.target.value,
                  }))
                }
                placeholder="Add operator context for platform review"
                value={commentDraft}
              />
              {/* No route carries a bank comment anywhere. The dialog kept its
                  Submit button and captioned the result "Queued for platform
                  review", which named a queue that does not exist; the control
                  is disabled and says what is true instead. */}
              <p className="text-xs leading-5 text-muted-foreground">
                Bank comments cannot be submitted for platform review yet, so
                this box is not connected. Credit amounts are TBD pending the
                billing session.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => setBankCommentOpen(false)} variant="outline">
                Close
              </Button>
              <Button disabled>Submit for review</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <BankDetailSheet
          bank={bankStatsByPeriod["30d"].find((bank) => bank.bankId === detailBankId) ?? null}
          durableDetail={durableBankDetail}
          durableState={vaultEnabled ? vaultBankDetail.state : null}
          onClose={() => setDetailBankId(null)}
        />
        {/* TODO(#155: change order — awaiting pricing) */}
        {/* TODO(question #73): Confirm the production review path before bank
            comments can inform any generated client plan. */}
      </div>
    );
  }

  function renderKnowledge() {
    const visibleTrainings = ancillaryConfigState === "enabled" || (ancillaryConfigState === "disabled" && trainingsLocalFixture)
      ? trainings.filter((training) =>
          training.recordSource === "operator" && training.apiAudience === "client")
      : [];
    const platformTrainings = ancillaryConfigState === "enabled"
      || (ancillaryConfigState === "disabled" && trainingsLocalFixture)
      ? trainings.filter((training) =>
          training.recordSource === "platform" && training.published)
      : [];

    async function addTraining() {
      const draft: TrainingRow = {
        apiAudience: "client",
        audience: "client-facing",
        id: `training-${Date.now()}`,
        published: false,
        recordSource: "operator",
        source: "YouTube",
        summary: "",
        title: "Untitled training",
        videoUrl: "",
        takedownReason: null,
        takenDownBy: null,
        takenDownAt: null,
      };
      if (ancillaryConfigState !== "enabled" && !(ancillaryConfigState === "disabled" && trainingsLocalFixture)) return;
      setTrainings((current) => [...current, draft]);
      setTrainingEditDraft(draft);
    }

    async function saveTraining() {
      if (!trainingEditDraft) return;
      if (trainingPublicationPendingRef.current.has(trainingEditDraft.id)) return;
      if (ancillaryConfigState === "enabled") {
        const creating = trainingEditDraft.id.startsWith("training-");
        const current = trainings.find((training) => training.id === trainingEditDraft.id);
        if (!creating && (current?.recordSource !== "operator" || current.apiAudience !== "client")) {
          return;
        }
        const response = await fetch(creating ? "/api/trainings" : `/api/trainings/${trainingEditDraft.id}`, {
          body: JSON.stringify({ audience: "client", title: trainingEditDraft.title, videoUrl: trainingEditDraft.videoUrl, body: trainingEditDraft.summary }),
          headers: { "content-type": "application/json" },
          method: creating ? "POST" : "PATCH",
        });
        if (!response.ok) return;
        const saved = trainingRowFromResponse(await response.json());
        if (saved === null
            || saved.recordSource !== "operator"
            || saved.apiAudience !== "client") return;
        setTrainings((current) => current.map((training) => training.id === trainingEditDraft.id ? saved : training));
      } else if (ancillaryConfigState === "disabled" && trainingsLocalFixture) {
        setTrainings((current) => current.map((training) => training.id === trainingEditDraft.id ? { ...training, ...trainingEditDraft } : training));
      } else {
        return;
      }
      setTrainingAttestations((current) => {
        const next = new Set(current);
        next.delete(trainingEditDraft.id);
        return next;
      });
      setTrainingEditDraft(null);
    }

    async function deleteTrainingDraft() {
      const candidate = trainingDeleteCandidate;
      if (
        ancillaryConfigState !== "enabled"
        || candidate === null
        || candidate.recordSource !== "operator"
        || candidate.apiAudience !== "client"
        || candidate.published
        || !isTrackerUuid(candidate.id)
        || trainingDeletePendingId !== null
        || trainingPublicationPendingRef.current.has(candidate.id)
      ) return;

      let deletionAccepted = false;
      setTrainingDeletePendingId(candidate.id);
      setTrainingDeleteFeedback(null);
      try {
        const response = await fetch(
          `/api/trainings/${encodeURIComponent(candidate.id)}`,
          {
            cache: "no-store",
            credentials: "same-origin",
            method: "DELETE",
          },
        );
        if (!response.ok) {
          const value: unknown = await response.json().catch(() => null);
          const code = trainingRecord(value) && typeof value.error === "string"
            ? value.error
            : null;
          setTrainingDeleteFeedback({
            kind: "error",
            message: code?.includes("published")
              ? "Published trainings must be unpublished before deletion."
              : "The training draft could not be deleted. Nothing was removed from this view.",
          });
          return;
        }
        deletionAccepted = true;
        if (response.status !== 204) throw new Error("training_delete_response_invalid");

        const readback = await fetch("/api/trainings", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!readback.ok) throw new Error("training_delete_readback_failed");
        const rows = trainingRowsFromResponse(await readback.json());
        if (rows === null) throw new Error("training_delete_readback_invalid");
        if (rows.some((training) => training.id === candidate.id)) {
          setTrainingDeleteFeedback({
            kind: "error",
            message: "The training is still present after deletion, so its absence was not confirmed.",
          });
          return;
        }

        setTrainings(rows);
        setTrainingAttestations((current) => {
          const next = new Set(current);
          next.delete(candidate.id);
          return next;
        });
        setTrainingEditDraft((current) => current?.id === candidate.id ? null : current);
        setTrainingDeleteCandidate(null);
        setTrainingDeleteFeedback({
          kind: "success",
          message: "Training draft deleted and its absence confirmed by server read-back.",
        });
      } catch {
        if (deletionAccepted) {
          setTrainings([]);
          setAncillaryConfigState("unavailable");
          setTrainingDeleteCandidate(null);
          setTrainingDeleteFeedback({
            kind: "error",
            message: "The server accepted the deletion, but the training library could not be read back. Reload before making another change.",
          });
        } else {
          setTrainingDeleteFeedback({
            kind: "error",
            message: "The training draft could not be deleted. Nothing was removed from this view.",
          });
        }
      } finally {
        setTrainingDeletePendingId(null);
      }
    }

    async function toggleTrainingPublication(training: TrainingRow) {
      if (training.recordSource !== "operator" || training.apiAudience !== "client") return;
      const trainingComplete =
        training.title.trim() !== "" &&
        training.title !== "Untitled training" &&
        training.videoUrl.trim() !== "" &&
        training.summary.trim() !== "";
      if (!training.published && (!trainingComplete || !trainingAttestations.has(training.id))) return;
      if (trainingPublicationPendingRef.current.has(training.id)) return;
      if (ancillaryConfigState !== "enabled"
          && !(ancillaryConfigState === "disabled" && trainingsLocalFixture)) {
        return;
      }

      trainingPublicationPendingRef.current.add(training.id);
      setTrainingPublicationPendingIds(new Set(trainingPublicationPendingRef.current));
      try {
        if (ancillaryConfigState === "enabled") {
          if (!training.published && !ancillaryConfig?.attestationAvailable) return;
          const targetPublished = !training.published;
          const response = await fetch(
            `/api/trainings/${encodeURIComponent(training.id)}/publication`,
            {
              ...(targetPublished
                ? {
                    body: JSON.stringify({ attested: true }),
                    headers: { "content-type": "application/json" },
                    method: "POST",
                  }
                : { method: "DELETE" }),
              cache: "no-store",
              credentials: "same-origin",
            },
          );
          if (!response.ok) return;
          const saved = trainingRowFromResponse(await response.json().catch(() => null));
          if (saved === null
              || saved.id !== training.id
              || saved.recordSource !== "operator"
              || saved.apiAudience !== "client"
              || saved.published !== targetPublished) {
            return;
          }
          setTrainings((current) => current.map((row) => row.id === training.id ? saved : row));
        } else {
          setTrainings((current) => current.map((row) => row.id === training.id
            ? { ...row, published: !row.published }
            : row));
        }
        setTrainingAttestations((current) => {
          const next = new Set(current);
          next.delete(training.id);
          return next;
        });
      } finally {
        trainingPublicationPendingRef.current.delete(training.id);
        setTrainingPublicationPendingIds(new Set(trainingPublicationPendingRef.current));
      }
    }

    return (
      <div className="space-y-5">
        <CompactHeader
          action={trainingTab === "your" && (ancillaryConfigState === "enabled" || (ancillaryConfigState === "disabled" && trainingsLocalFixture)) ? (
            <Button onClick={() => { void addTraining(); }}><Plus aria-hidden /> Add training</Button>
          ) : undefined}
          description="Create and publish your client lessons, or watch platform lessons."
          icon={BookOpen}
          title="Client Trainings"
        />
        <Segmented
          onChange={setTrainingTab}
          options={[
            { label: "Your Trainings", value: "your" },
            { label: "Platform Trainings", value: "platform" },
          ]}
          value={trainingTab}
        />

        {trainingTab === "your" && trainingDeleteFeedback ? (
          <div
            className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              trainingDeleteFeedback.kind === "error"
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "border-primary/20 bg-primary/5 text-primary-ink",
            )}
            role={trainingDeleteFeedback.kind === "error" ? "alert" : "status"}
          >
            {trainingDeleteFeedback.message}
          </div>
        ) : null}

        {trainingTab === "platform" ? (
          <Panel
            description="Published lessons maintained by the MostFundable platform team."
            title="Platform Trainings"
          >
            {ancillaryConfigState === "loading" ? (
              <p className="text-sm text-muted-foreground" role="status">
                Platform trainings are loading.
              </p>
            ) : ancillaryConfigState === "unavailable" ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-destructive" role="alert">
                  Platform trainings are unavailable right now.
                </p>
                <Button
                  onClick={() => setTrainingsReload((current) => current + 1)}
                  size="sm"
                  variant="outline"
                >
                  Retry
                </Button>
              </div>
            ) : ancillaryConfigState === "disabled" && !trainingsLocalFixture ? (
              <p className="text-sm text-muted-foreground" role="status">
                Platform trainings are not connected to this workspace yet.
              </p>
            ) : platformTrainings.length ? (
              <div className="divide-y divide-border">
                {platformTrainings.map((training) => (
                  <article className="py-4 first:pt-0 last:pb-0" key={training.id}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold">{training.title}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {training.source} · Platform lesson
                        </p>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {training.summary}
                        </p>
                      </div>
                      <a
                        className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        href={training.videoUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Watch lesson
                        <ArrowUpRight aria-hidden className="ml-2 size-4" />
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                description="The platform team has not published any operator lessons yet."
                title="No platform trainings"
              />
            )}
          </Panel>
        ) : ancillaryConfigState === "loading" ? (
          <p className="text-sm text-muted-foreground">Client trainings are loading.</p>
        ) : ancillaryConfigState === "unavailable" ? (
          <p className="text-sm text-muted-foreground">Client trainings are unavailable.</p>
        ) : ancillaryConfigState === "disabled" && !trainingsLocalFixture ? (
          // Off, on a real workspace. Nothing failed and nothing is stored, so
          // the panel says exactly that rather than offering six lessons this
          // operator never made and a Publish control that writes to nothing.
          <p className="text-sm text-muted-foreground">Client trainings are not connected to this workspace yet, so nothing can be created or published here.</p>
        ) : (
          <>
            <Panel title="Your Trainings">
              {visibleTrainings.length ? (
                <div className="divide-y divide-border">
                  {visibleTrainings.map((training) => {
                    const trainingComplete =
                      training.title.trim() !== "" &&
                      training.title !== "Untitled training" &&
                      training.videoUrl.trim() !== "" &&
                      training.summary.trim() !== "";
                    const editing = trainingEditDraft?.id === training.id;
                    return (
                      <div className="py-4 first:pt-0 last:pb-0" key={training.id}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{training.title}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{training.source} · operator-owned client training</p>
                          </div>
                          <StatusPill tone={training.published ? "success" : "neutral"}>{training.published ? "Published" : "Draft"}</StatusPill>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              disabled={trainingDeletePendingId !== null || trainingPublicationPendingIds.has(training.id)}
                              onClick={() => setTrainingEditDraft(editing ? null : {
                                id: training.id,
                                source: training.source,
                                summary: training.summary,
                                title: training.title,
                                videoUrl: training.videoUrl,
                              })}
                              size="sm"
                              variant="outline"
                            >
                              {editing ? "Cancel edit" : "Edit"}
                            </Button>
                            <Button
                              disabled={trainingDeletePendingId !== null || trainingPublicationPendingIds.has(training.id) || (!training.published && (!trainingComplete || !trainingAttestations.has(training.id) || (ancillaryConfigState === "enabled" && !ancillaryConfig?.attestationAvailable)))}
                              onClick={() => { void toggleTrainingPublication(training); }}
                              size="sm"
                              variant="ghost"
                            >
                              {trainingPublicationPendingIds.has(training.id)
                                ? (training.published ? "Unpublishing…" : "Publishing…")
                                : (training.published ? "Unpublish" : "Publish")}
                            </Button>
                            {durableWorkspace ? (
                              <Button
                                aria-label={`Delete ${training.title}`}
                                disabled={
                                  trainingDeletePendingId !== null
                                  || trainingPublicationPendingIds.has(training.id)
                                  || training.published
                                  || training.recordSource !== "operator"
                                  || !isTrackerUuid(training.id)
                                }
                                onClick={() => {
                                  setTrainingDeleteFeedback(null);
                                  setTrainingDeleteCandidate(training);
                                }}
                                size="sm"
                                title={training.published
                                  ? "Unpublish this training before deleting it."
                                  : !isTrackerUuid(training.id)
                                    ? "Save this draft before deleting it."
                                    : undefined}
                                variant="destructive"
                              >
                                Delete
                              </Button>
                            ) : null}
                          </div>
                        </div>

                        {!training.published ? (
                          <label className="mt-3 flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3 text-xs leading-5">
                            <input
                              checked={trainingAttestations.has(training.id)}
                              className="mt-1 size-4 accent-primary"
                              disabled={trainingPublicationPendingIds.has(training.id)}
                              onChange={(event) => setTrainingAttestations((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(training.id);
                                else next.delete(training.id);
                                return next;
                              })}
                              type="checkbox"
                            />
                            <span>{ancillaryConfigState === "enabled" ? (ancillaryConfig?.attestationText ?? "Publishing attestation is unavailable.") : "I am responsible for this lesson, confirm it stays within funding-readiness education, and accept the platform takedown policy."}</span>
                          </label>
                        ) : null}

                        {editing && trainingEditDraft ? (
                          <div className="mt-4 grid gap-3 rounded-lg border border-border bg-muted/25 p-4">
                            <label className="text-xs font-medium">Training title<Input className="mt-1" onChange={(event) => setTrainingEditDraft((current) => current ? { ...current, title: event.target.value } : current)} value={trainingEditDraft.title} /></label>
                            <label className="text-xs font-medium">{trainingEditDraft.source} video URL<Input className="mt-1" onChange={(event) => setTrainingEditDraft((current) => current ? { ...current, videoUrl: event.target.value } : current)} placeholder="Paste the operator-managed embed URL" type="url" value={trainingEditDraft.videoUrl} /></label>
                            <label className="text-xs font-medium">Lesson text<Textarea className="mt-1 min-h-28" onChange={(event) => setTrainingEditDraft((current) => current ? { ...current, summary: event.target.value } : current)} placeholder="Add the text shown below the video." value={trainingEditDraft.summary} /></label>
                            <div className="flex flex-wrap gap-2">
                              {(["YouTube", "Vimeo", "Loom"] as TrainingSource[]).map((source) => (
                                <Button aria-pressed={trainingEditDraft.source === source} key={source} onClick={() => setTrainingEditDraft((current) => current ? { ...current, source } : current)} size="sm" variant={trainingEditDraft.source === source ? "secondary" : "outline"}>{source}</Button>
                              ))}
                              <Button className="sm:ml-auto" onClick={() => setTrainingEditDraft(null)} size="sm" variant="ghost">Cancel</Button>
                              <Button disabled={trainingPublicationPendingIds.has(trainingEditDraft.id)} onClick={() => { void saveTraining(); }} size="sm">Save changes</Button>
                            </div>
                          </div>
                        ) : null}

                        {ancillaryConfig?.consoleOpsEnabled && training.takedownReason ? (
                          <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-xs leading-5">
                            <p className="font-medium">Platform takedown reason</p>
                            <p className="mt-1 text-muted-foreground">{training.takedownReason}</p>
                            {training.takenDownAt ? <p className="mt-1 text-muted-foreground">Recorded {new Date(training.takenDownAt).toLocaleString("en-US", { timeZone: "UTC" })}{training.takenDownBy ? ` by ${training.takenDownBy}` : ""}</p> : null}
                          </div>
                        ) : null}

                        {!trainingComplete ? <p className="mt-2 text-xs text-muted-foreground">Add a title, video URL, and lesson text before publishing.</p> : !training.published && !trainingAttestations.has(training.id) ? <p className="mt-2 text-xs text-muted-foreground">Confirm the publishing attestation to continue.</p> : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState description="Add the first operator-owned lesson for clients." title="No client trainings" />
              )}
            </Panel>
            <Panel
              description="Funding-readiness boundaries apply to every client-facing lesson. Publishing records the operator's content attestation."
              title="Publishing boundary"
            >
              <p className="text-xs leading-5 text-muted-foreground">
                MostFundable may unpublish content that falls outside the platform boundary. Video content remains operator-authored and does not pass through automated enforcement.
              </p>
            </Panel>
            <Dialog
              onOpenChange={(open) => {
                if (!open && trainingDeletePendingId === null) {
                  setTrainingDeleteCandidate(null);
                }
              }}
              open={trainingDeleteCandidate !== null}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete {trainingDeleteCandidate?.title}?</DialogTitle>
                  <DialogDescription>
                    This permanently removes the operator-owned draft. Published
                    and platform trainings cannot be deleted here.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    disabled={trainingDeletePendingId !== null}
                    onClick={() => setTrainingDeleteCandidate(null)}
                    variant="outline"
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={
                      trainingDeletePendingId !== null
                      || (trainingDeleteCandidate !== null
                        && trainingPublicationPendingIds.has(trainingDeleteCandidate.id))
                      || trainingDeleteCandidate?.published === true
                      || trainingDeleteCandidate?.recordSource !== "operator"
                      || !isTrackerUuid(trainingDeleteCandidate?.id)
                    }
                    onClick={() => { void deleteTrainingDraft(); }}
                    variant="destructive"
                  >
                    {trainingDeletePendingId === trainingDeleteCandidate?.id
                      ? "Deleting…"
                      : "Delete draft"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    );
  }

  function renderTasks() {
    const unassignedValue = "__unassigned__";
    const directoryMemberIds = new Set(teamRows.map((member) => member.id));
    const unavailableAssigneeOptions = durableWorkspace
      ? [...new Set(
          durableTasks.flatMap((task) =>
            task.assigneeProfileId !== null && !directoryMemberIds.has(task.assigneeProfileId)
              ? [task.assigneeProfileId]
              : [],
          ),
        )].map((id) => ({
          description: "This person is not in the current team directory.",
          disabled: true,
          label: "Team member unavailable",
          value: id,
        }))
      : [];
    const assigneeOptions = durableWorkspace
      ? [
          { label: "Unassigned", value: unassignedValue },
          ...teamRows.map((member) => ({ label: member.name, value: member.id })),
          ...unavailableAssigneeOptions,
        ]
      : [
          { label: "Unassigned", value: unassignedValue },
          ...[...new Set(teamRows.map((member) => member.name))]
            .map((name) => ({ label: name, value: name })),
        ];
    // Whatever book this workspace actually has. The fixture book is the
    // fixture shell's; a signed-in operator links tasks to tracker clients.
    const taskClientOptions: TaskClientOption[] = durableWorkspace
      ? trackerClients.clients.map((client) => ({
          business: client.businessName,
          id: client.id,
          name: client.displayName,
        }))
      : clients.map((client) => ({
          business: client.business,
          id: client.clientId,
          name: client.name,
        }));
    const visibleTasks = taskRows.filter(
      (task) =>
        (taskFilter === "all" || task.status === taskFilter) &&
        (taskPriorityFilter === "all" || task.priority === taskPriorityFilter) &&
        (taskAssigneeFilter === "all" ||
          (durableWorkspace
            ? (task.assigneeProfileId ?? unassignedValue) === taskAssigneeFilter
            : (task.assignee === "Unassigned" ? unassignedValue : task.assignee) === taskAssigneeFilter)),
    );
    const taskListReady = !durableWorkspace || taskReadState === "ready";
    const taskBusy = taskMutationKey !== null;
    const metricValue = (value: number) =>
      durableWorkspace && taskReadState !== "ready" ? "—" : value;

    function resetTaskComposer() {
      setNewTaskTitle("");
      setNewTaskClientId(null);
      setNewTaskAssigneeId(durableWorkspace ? null : "Alec Rivera");
      setNewTaskDueOn("");
      setNewTaskNotes("");
      setNewTaskPriority("medium");
      setTaskComposerOpen(false);
    }

    async function persistTaskMutation(
      key: string,
      mutation: () => Promise<unknown>,
      successMessage: string,
    ): Promise<boolean> {
      setTaskMutationKey(key);
      setTaskMutationError("");
      setTaskNotice("");
      try {
        await mutation();
        const readBack = await refreshDurableTasks();
        if (!readBack) {
          setTaskMutationError(
            "The change was accepted, but the saved task list could not be read back.",
          );
          return false;
        }
        setTaskNotice(successMessage);
        return true;
      } catch (error) {
        setTaskMutationError(taskFailureMessage(error));
        return false;
      } finally {
        setTaskMutationKey(null);
      }
    }

    async function handleCreateTask() {
      const taskTitle = newTaskTitle.trim();
      if (!taskTitle) return;
      if (durableWorkspace) {
        const saved = await persistTaskMutation(
          "create",
          () => createTask({
            assigneeProfileId: newTaskAssigneeId,
            clientId: newTaskClientId,
            dueOn: newTaskDueOn || null,
            notes: newTaskNotes,
            priority: newTaskPriority,
            title: taskTitle,
          }),
          "Task created.",
        );
        if (saved) resetTaskComposer();
        return;
      }
      setFixtureTasks((current) => [
        {
          assignee: newTaskAssigneeId ?? "Unassigned",
          assigneeProfileId: null,
          clientId: newTaskClientId,
          dueAt: newTaskDueOn ? formatDate(newTaskDueOn) : "No due date",
          dueOn: newTaskDueOn || null,
          id: `task-local-${Date.now()}`,
          notes: newTaskNotes,
          priority: newTaskPriority,
          status: "pending",
          title: taskTitle,
          type: newTaskClientId === null ? "Workspace task" : "Client task",
        },
        ...current,
      ]);
      resetTaskComposer();
    }

    function beginTaskEdit(task: DemoTask) {
      setTaskEditDrafts((current) => ({
        ...current,
        [task.id]: {
          assigneeProfileId: durableWorkspace
            ? task.assigneeProfileId
            : task.assignee === "Unassigned"
              ? null
              : task.assignee,
          clientId: task.clientId,
          dueOn: task.dueOn ?? "",
          notes: task.notes,
          priority: task.priority,
          title: task.title,
        },
      }));
      setEditingTaskId(task.id);
      setConfirmingTaskDeleteId(null);
    }

    function closeTaskEdit(taskId: string) {
      setEditingTaskId(null);
      setConfirmingTaskDeleteId(null);
      setTaskEditDrafts((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    }

    async function handleSaveTask(task: DemoTask) {
      const draft = taskEditDrafts[task.id];
      if (!draft || !draft.title.trim()) return;
      if (durableWorkspace) {
        const saved = await persistTaskMutation(
          `edit:${task.id}`,
          () => updateTask(task.id, {
            assigneeProfileId: draft.assigneeProfileId,
            clientId: draft.clientId,
            dueOn: draft.dueOn || null,
            notes: draft.notes,
            priority: draft.priority,
            title: draft.title.trim(),
          }),
          "Task updated.",
        );
        if (saved) closeTaskEdit(task.id);
        return;
      }
      setFixtureTasks((current) =>
        current.map((row) =>
          row.id === task.id
            ? {
                ...row,
                assignee: draft.assigneeProfileId ?? "Unassigned",
                clientId: draft.clientId,
                dueAt: draft.dueOn ? formatDate(draft.dueOn) : "No due date",
                dueOn: draft.dueOn || null,
                notes: draft.notes,
                priority: draft.priority,
                title: draft.title.trim(),
                type: draft.clientId === null ? "Workspace task" : "Client task",
              }
            : row,
        ),
      );
      closeTaskEdit(task.id);
    }

    async function handleTaskStatus(task: DemoTask) {
      const status = task.status === "completed" ? "pending" : "completed";
      if (durableWorkspace) {
        await persistTaskMutation(
          `status:${task.id}`,
          () => updateTask(task.id, { status }),
          status === "completed" ? "Task completed." : "Task reopened.",
        );
        return;
      }
      setFixtureTasks((current) =>
        current.map((row) => row.id === task.id ? { ...row, status } : row),
      );
    }

    async function handleDeleteTask(task: DemoTask) {
      if (durableWorkspace) {
        const removed = await persistTaskMutation(
          `delete:${task.id}`,
          () => removeTask(task.id),
          "Task deleted.",
        );
        if (!removed) return;
      } else {
        setFixtureTasks((current) => current.filter((row) => row.id !== task.id));
      }
      setExpandedTaskId((current) => current === task.id ? null : current);
      closeTaskEdit(task.id);
    }

    function deleteTaskControls(task: DemoTask) {
      if (confirmingTaskDeleteId !== task.id) {
        return (
          <Button
            disabled={taskBusy}
            onClick={() => setConfirmingTaskDeleteId(task.id)}
            size="sm"
            variant="ghost"
          >
            Delete task
          </Button>
        );
      }
      return (
        <div
          aria-label={`Confirm deletion of ${task.title}`}
          className="flex flex-wrap items-center gap-2"
          role="group"
        >
          <span className="text-xs font-medium text-destructive">Delete this task?</span>
          <Button
            disabled={taskBusy}
            onClick={() => void handleDeleteTask(task)}
            size="sm"
            variant="outline"
          >
            {taskMutationKey === `delete:${task.id}` ? "Deleting…" : "Delete"}
          </Button>
          <Button
            disabled={taskBusy}
            onClick={() => setConfirmingTaskDeleteId(null)}
            size="sm"
            variant="ghost"
          >
            Keep task
          </Button>
        </div>
      );
    }
    return (
      <div className="space-y-5">
        <CompactHeader
          action={
            <Button
              disabled={!taskListReady || taskBusy}
              onClick={() => setTaskComposerOpen((open) => !open)}
            >
              <Plus aria-hidden /> Add task
            </Button>
          }
          description="Work assigned to you and your clients."
          icon={CheckSquare2}
          title="Tasks"
        />
        <MetricStrip
          items={[
            { label: "Total", value: metricValue(taskMetrics.total) },
            { label: "Pending", value: metricValue(taskMetrics.pending) },
            { label: "Completed", value: metricValue(taskMetrics.completed) },
            { label: "Overdue", value: metricValue(taskMetrics.overdue) },
          ]}
        />
        {taskListReady ? <div className="flex flex-wrap items-center gap-3">
          <Segmented
            onChange={setTaskFilter}
            options={[
              { label: "All", value: "all" },
              { label: "Pending", value: "pending" },
              { label: "Completed", value: "completed" },
              { label: "Overdue", value: "overdue" },
            ]}
            value={taskFilter}
          />
          <Segmented
            onChange={setTaskPriorityFilter}
            options={[
              { label: "Any priority", value: "all" },
              { label: "High", value: "high" },
              { label: "Medium", value: "medium" },
              { label: "Low", value: "low" },
            ]}
            value={taskPriorityFilter}
          />
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            Person
            <BrandSelect
              ariaLabel="Filter tasks by person"
              className="w-auto min-w-40"
              onValueChange={setTaskAssigneeFilter}
              options={[{ label: "Anyone", value: "all" }, ...assigneeOptions]}
              value={taskAssigneeFilter}
            />
          </span>
        </div> : null}
        {taskMutationError ? (
          <p className="text-sm text-destructive" role="alert">{taskMutationError}</p>
        ) : null}
        {taskNotice ? (
          <p className="text-sm text-muted-foreground" role="status">{taskNotice}</p>
        ) : null}
        {taskComposerOpen ? (
          <Panel
            description={durableWorkspace ? "Create a saved task for this workspace." : "Add a task to the fixture queue."}
            title="Add a team task"
          >
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(14rem,1fr)_13rem_10rem_11rem] xl:items-end">
              <label className="text-xs font-medium text-muted-foreground">
                Task
                <Input
                  className="mt-1.5"
                  maxLength={160}
                  onChange={(event) => setNewTaskTitle(event.target.value)}
                  placeholder="Describe the next action"
                  value={newTaskTitle}
                />
              </label>
              <TaskClientTypeahead
                clients={taskClientOptions}
                id="new-task-client"
                key={newTaskClientId ?? "no-client"}
                label="Client (optional)"
                onChange={setNewTaskClientId}
                value={newTaskClientId}
              />
              <span className="block text-xs font-medium text-muted-foreground">
                Assign to
                <BrandSelect
                  ariaLabel="Assign the new task to"
                  className="mt-1.5"
                  onValueChange={(value) => setNewTaskAssigneeId(value === unassignedValue ? null : value)}
                  options={assigneeOptions}
                  value={newTaskAssigneeId ?? unassignedValue}
                />
              </span>
              <span className="block text-xs font-medium text-muted-foreground">
                Priority
                <BrandSelect
                  ariaLabel="New task priority"
                  className="mt-1.5"
                  onValueChange={(next) =>
                    setNewTaskPriority(next as "high" | "medium" | "low")
                  }
                  options={[
                    { label: "High", value: "high" },
                    { label: "Medium", value: "medium" },
                    { label: "Low", value: "low" },
                  ]}
                  value={newTaskPriority}
                />
              </span>
              <label className="text-xs font-medium text-muted-foreground">
                Due date (optional)
                <Input
                  className="mt-1.5 tabular-nums"
                  onChange={(event) => setNewTaskDueOn(event.target.value)}
                  type="date"
                  value={newTaskDueOn}
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground lg:col-span-2 xl:col-span-4">
                Context (optional)
                <Textarea
                  className="mt-1.5"
                  maxLength={4000}
                  onChange={(event) => setNewTaskNotes(event.target.value)}
                  placeholder="Add context for whoever picks this up next."
                  rows={3}
                  value={newTaskNotes}
                />
              </label>
              <div className="flex gap-2 xl:justify-end">
                <Button
                  disabled={!newTaskTitle.trim() || taskBusy}
                  onClick={() => void handleCreateTask()}
                >
                  {taskMutationKey === "create" ? "Creating…" : "Create task"}
                </Button>
                <Button
                  disabled={taskBusy}
                  onClick={resetTaskComposer}
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Panel>
        ) : null}
        <Panel title="Task list">
          {durableWorkspace && (taskReadState === "idle" || taskReadState === "loading") ? (
            <p className="text-sm text-muted-foreground" role="status">Loading tasks…</p>
          ) : durableWorkspace && taskReadState === "failed" ? (
            <EmptyState
              action={
                <Button onClick={() => void refreshDurableTasks()} size="sm" variant="outline">
                  Retry
                </Button>
              }
              description={taskReadError || "The task list could not be loaded."}
              title="Tasks unavailable"
            />
          ) : visibleTasks.length ? (
              <div className="divide-y divide-border">
                {visibleTasks.map((task) => (
                <div className="py-3 first:pt-0 last:pb-0" key={task.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    aria-label={
                      task.status === "completed"
                        ? `Reopen ${task.title}`
                        : `Complete ${task.title}`
                    }
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      task.status === "completed"
                        ? "border-[color-mix(in_srgb,var(--consumer-positive),transparent_74%)] bg-[color-mix(in_srgb,var(--consumer-positive),transparent_92%)] text-[var(--consumer-positive)]"
                        : "border-border bg-background text-muted-foreground",
                    )}
                    disabled={taskBusy}
                    onClick={() => void handleTaskStatus(task)}
                    type="button"
                  >
                    {task.status === "completed" ? (
                      <Check aria-hidden className="size-4" />
                    ) : (
                      <Clock3 aria-hidden className="size-4" />
                    )}
                  </button>
                  <button
                    aria-expanded={expandedTaskId === task.id}
                    className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        setExpandedTaskId((current) => current === task.id ? null : task.id);
                        setConfirmingTaskDeleteId(null);
                      }}
                    type="button"
                  >
                    <p
                      className={cn(
                        "text-sm font-medium",
                        task.status === "completed" &&
                          "text-muted-foreground line-through",
                      )}
                    >
                      {task.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {task.type} · {task.assignee} · {task.dueAt}
                      {task.notes ? " · has context notes" : ""}
                    </p>
                  </button>
                  <StatusPill
                    tone={
                      task.status === "completed"
                        ? "success"
                        : task.status === "overdue"
                          ? "danger"
                          : task.priority === "high"
                            ? "warning"
                            : "neutral"
                    }
                  >
                    {titleCase(
                      task.status === "pending" ? task.priority : task.status,
                    )}
                  </StatusPill>
                </div>
                {expandedTaskId === task.id ? (
                  <div className="mt-3 space-y-4 rounded-lg border border-border bg-muted/25 p-4 sm:ml-12">
                    {editingTaskId !== task.id ? (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <dl className="grid min-w-0 flex-1 gap-3 text-sm sm:grid-cols-3">
                            <div>
                              <dt className="text-xs text-muted-foreground">Linked client</dt>
                              <dd className="mt-1 font-medium">
                                {task.clientId
                                  ? taskClientOptions.find((item) => item.id === task.clientId)?.name ?? "Client record unavailable"
                                  : "Workspace task"}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">Assigned to</dt>
                              <dd className="mt-1 font-medium">{task.assignee || "Unassigned"}</dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">Due</dt>
                              <dd className="mt-1 font-medium tabular-nums">{task.dueAt}</dd>
                            </div>
                          </dl>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button disabled={taskBusy} onClick={() => beginTaskEdit(task)} size="sm" variant="outline">
                              Edit task
                            </Button>
                            {deleteTaskControls(task)}
                          </div>
                        </div>
                        <div className="border-t border-border pt-3">
                          <p className="text-xs font-medium text-muted-foreground">Context</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                            {task.notes || "No context notes saved."}
                          </p>
                        </div>
                        {task.clientId ? (
                          (() => {
                            const linkedClient = taskClientOptions.find((item) => item.id === task.clientId);
                            if (!linkedClient) return null;
                            return (
                              <Button
                                onClick={() => durableWorkspace ? openTrackerClient(linkedClient.id) : openClient(linkedClient.id)}
                                size="sm"
                                variant="ghost"
                              >
                                <Users aria-hidden /> Open {linkedClient.name}&apos;s profile
                              </Button>
                            );
                          })()
                        ) : null}
                      </div>
                    ) : (() => {
                      const draft = taskEditDrafts[task.id];
                      if (!draft) return null;
                      return (
                        <div className="space-y-4">
                          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-5">
                            <label className="text-xs font-medium text-muted-foreground xl:col-span-2">
                              Task
                              <Input
                                className="mt-1.5"
                                maxLength={160}
                                onChange={(event) => setTaskEditDrafts((current) => ({
                                  ...current,
                                  [task.id]: { ...draft, title: event.target.value },
                                }))}
                                value={draft.title}
                              />
                            </label>
                            <div className="min-w-0">
                              <TaskClientTypeahead
                                clients={taskClientOptions}
                                id={`task-client-${task.id}`}
                                key={`${task.id}:${draft.clientId ?? "no-client"}`}
                                label="Linked client (optional)"
                                onChange={(clientId) => setTaskEditDrafts((current) => ({
                                  ...current,
                                  [task.id]: { ...draft, clientId },
                                }))}
                                value={draft.clientId}
                              />
                            </div>
                            <span className="block text-xs font-medium text-muted-foreground">
                              Assign to
                              <BrandSelect
                                ariaLabel={`Assign ${task.title}`}
                                className="mt-1.5"
                                onValueChange={(value) => setTaskEditDrafts((current) => ({
                                  ...current,
                                  [task.id]: {
                                    ...draft,
                                    assigneeProfileId: value === unassignedValue ? null : value,
                                  },
                                }))}
                                options={assigneeOptions}
                                value={draft.assigneeProfileId ?? unassignedValue}
                              />
                            </span>
                            <span className="block text-xs font-medium text-muted-foreground">
                              Priority
                              <BrandSelect
                                ariaLabel={`Priority for ${task.title}`}
                                className="mt-1.5"
                                onValueChange={(value) => setTaskEditDrafts((current) => ({
                                  ...current,
                                  [task.id]: { ...draft, priority: value as TaskPriority },
                                }))}
                                options={[
                                  { label: "High", value: "high" },
                                  { label: "Medium", value: "medium" },
                                  { label: "Low", value: "low" },
                                ]}
                                value={draft.priority}
                              />
                            </span>
                            <label className="text-xs font-medium text-muted-foreground">
                              Due date (optional)
                              <Input
                                className="mt-1.5 tabular-nums"
                                onChange={(event) => setTaskEditDrafts((current) => ({
                                  ...current,
                                  [task.id]: { ...draft, dueOn: event.target.value },
                                }))}
                                type="date"
                                value={draft.dueOn}
                              />
                            </label>
                          </div>
                          <div>
                            <label
                              className="text-xs font-medium text-muted-foreground"
                              htmlFor={`task-notes-${task.id}`}
                            >
                              Text context
                            </label>
                            <Textarea
                              className="mt-1.5"
                              id={`task-notes-${task.id}`}
                              maxLength={4000}
                              onChange={(event) => setTaskEditDrafts((current) => ({
                                ...current,
                                [task.id]: { ...draft, notes: event.target.value },
                              }))}
                              placeholder="Add context for whoever picks this up next."
                              rows={3}
                              value={draft.notes}
                            />
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <Button
                                disabled={!draft.title.trim() || taskBusy}
                                onClick={() => void handleSaveTask(task)}
                                size="sm"
                              >
                                {taskMutationKey === `edit:${task.id}` ? "Saving…" : "Save task"}
                              </Button>
                              <Button
                                disabled={taskBusy}
                                onClick={() => closeTaskEdit(task.id)}
                                size="sm"
                                variant="ghost"
                              >
                                Cancel
                              </Button>
                              {deleteTaskControls(task)}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : null}
                </div>
                ))}
              </div>
            ) : (
              <EmptyState
                description={
                  taskRows.length === 0
                    ? "Create a task to give the workspace its first next action."
                    : "Change the status, priority, or person filters to see another part of the task queue."
                }
                title={taskRows.length === 0 ? "No tasks yet" : "No tasks match these filters"}
              />
            )}
        </Panel>
      </div>
    );
  }

  function renderPlatformSupport() {
    return (
      <div className="space-y-5">
        <SheetSectionHeader
          // The pill described the fixture seed this panel used to render. The
          // durable arm renders no conversation and no ticket list at all, so on
          // a signed-in workspace there is nothing left for it to be about, and
          // labelling a truthful empty state "Simulated" is its own small lie.
          action={durableWorkspace ? undefined : <StatusPill tone="warning">Simulated</StatusPill>}
          description="Operator-to-platform technical support. Client conversations stay in Inbox."
          icon={LifeBuoy}
          title="Platform support"
        />
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <Panel className="xl:col-span-2" description="Suggestions stay inside the current composer and require an operator action." title="Current conversation">
            {/* `selectedSupport` is a SUPPORT_SEED row: a fabricated consumer
                question with a fabricated confidence score. Rendering it to a
                signed-in operator states that somebody asked this and that a
                model scored the answer, and neither happened. */}
            {durableWorkspace ? (
              <p className="text-sm text-muted-foreground" role="status">
                No platform support conversation is open for this workspace.
                Start one below.
              </p>
            ) : selectedSupport ? (
              <SupportThreadView
                busy={false}
                canDraft
                draft={{
                  body: supportDraft,
                  confidence: 0.62,
                  confidenceThreshold: 0.78,
                  guardrailFlags: [selectedSupport.reason],
                  id: selectedSupport.id,
                  status: "draft",
                }}
                messages={[{
                  authorKind: "consumer",
                  body: selectedSupport.question,
                  id: `${selectedSupport.id}-question`,
                  origin: "human",
                  sentAt: "2026-08-17T09:12:00Z",
                }]}
                onDiscard={discardFixtureSupportDraft}
                onGenerate={() => undefined}
                onSend={(body) => {
                  setPlatformSupportDraft(body);
                  setPlatformSupportNotice("Reply copied into the local composer. Nothing was sent.");
                }}
                subject="Platform support"
              />
            ) : <p className="text-sm text-muted-foreground">No suggested draft is open. Start or continue a platform support request below.</p>}
          </Panel>
          {/* The seeded tickets belong to the fixture workspace and are
              selected by its name, so a signed-in operator was being shown
              another company's support history as their own. No route reports
              operator-to-platform requests, so the durable path says so. */}
          <Panel
            description={durableWorkspace
              ? "Operator-to-platform requests raised by this workspace."
              : "Requests raised by this workspace, from the same fixture seed as the platform's simulated support queue. Statuses here don't update live in this demo."}
            title="Support requests"
          >
            {durableWorkspace ? (
              <p className="text-sm text-muted-foreground" role="status">
                No platform support request from this workspace is readable
                here, so none are listed.
              </p>
            ) : (
            <div className="space-y-3">
              {SUPPORT_TICKET_FIXTURES.filter(
                (ticket) => ticket.operatorName === "Apex Funding Partners",
              ).map((ticket) => (
                <div
                  className="rounded-lg border border-border p-4"
                  key={ticket.id}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">
                      {ticket.id}
                    </span>
                    <StatusPill
                      tone={ticket.status === "resolved" ? "success" : "warning"}
                    >
                      {ticket.status === "resolved"
                        ? "Resolved"
                        : "Awaiting reply"}
                    </StatusPill>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold leading-5">
                    {ticket.summary}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Opened {ticket.openedAt}
                  </p>
                </div>
              ))}
            </div>
            )}
          </Panel>
          <Panel
            description="This fixture records a draft only."
            title="New platform request"
          >
            <Textarea
              aria-label="Platform support request"
              onChange={(event) => setPlatformSupportDraft(event.target.value)}
              placeholder="Describe the technical issue"
              value={platformSupportDraft}
            />
            <Button
              className="mt-3"
              disabled={!platformSupportDraft.trim()}
              onClick={() => {
                setPlatformSupportNotice(
                  "Platform support request saved as a local draft. Nothing was sent.",
                );
                setPlatformSupportDraft("");
              }}
            >
              <Plus aria-hidden /> Draft request
            </Button>
            {platformSupportNotice ? (
              <p className="mt-3 text-xs text-primary-ink">
                {platformSupportNotice}
              </p>
            ) : null}
          </Panel>
        </div>
      </div>
    );
  }

  /**
   * The fee tab reading the org's own receivables (#7).
   *
   * Two things are durable here and one is honestly refused. The rows and their
   * money come from `/api/fees`, and "Mark paid" records a payment against the
   * balance through `/api/fees/[clientId]/payments`, which is bookkeeping
   * rather than a transfer — payouts happen off platform. The per-client model
   * select is disabled because there is no route to write one: the handler
   * exists but `src/app/api/fees/[clientId]/route.ts` exports a `GET` and
   * nothing else, so a browser has no way to reach it.
   *
   * "Funded" is the ledger's recorded outcome basis, which is the same input
   * the database used to calculate percentage and triggered fees.
   */
  function durableFeeTotals(receivables: readonly OrgReceivable[]) {
    return receivables.reduce(
      (sum, row) => ({
        balance: sum.balance + Math.max(0, row.balanceCents),
        paid: sum.paid + row.paidCents,
        total: sum.total + row.totalCents,
      }),
      { balance: 0, paid: 0, total: 0 },
    );
  }

  function renderDurableFeeTracking(receivables: readonly OrgReceivable[]) {
    const modelLabel = (model: OrgReceivable["model"]) =>
      model === "percentage"
        ? "Success fee · % of funded"
        : model === "custom"
          ? "Success fee · flat amount"
          // A stored `package` agreement cleared the trigger in migration 091
          // when it was written, so labelling the record as pending review said
          // something false about a row that is already in the ledger.
          : model === "package"
            ? "Admin upfront"
            : "Not configured";
    return (
        <Panel
          description="Total fee − paid = balance. All client records remain visible, including unconfigured new clients."
          title="Client fee tracking"
        >
          {receivables.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No fee records for this workspace yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[920px]" containerLabel="Client fee tracking">
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Funded</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Total fee</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receivables.map((row) => {
                    const balance = Math.max(0, row.balanceCents);
                    return (
                      <TableRow key={row.clientId}>
                        <TableCell className="font-medium">
                          {row.displayName}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {formatDemoMoney(row.outcomeBasisCents / 100)}
                        </TableCell>
                        <TableCell>
                          {modelLabel(row.model)}
                        </TableCell>
                        <TableCell>
                          <span className="font-semibold tabular-nums">
                            {formatDemoMoney(row.totalCents / 100)}
                          </span>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {formatDemoMoney(row.paidCents / 100)}
                        </TableCell>
                        <TableCell className="font-semibold tabular-nums">
                          {formatDemoMoney(balance / 100)}
                        </TableCell>
                        <TableCell>
                          <Button
                            onClick={() => {
                              setEditingFeeClient({
                                clientId: row.clientId,
                                name: row.displayName,
                              });
                            }}
                            size="sm"
                            variant="outline"
                          >
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>
    );
  }

  function renderFees() {
    // The durable rows when FEATURE_FEES is on and the read landed; `null`
    // otherwise, which covers both the flag being off (the fixture book below)
    // and the read having failed (the notice, never a healthy table).
    const durableReceivables =
      feesEnabled && receivablesRead.state === "ready"
        ? receivablesRead.receivables
        : null;
    /**
     * When this tab may show no money at all.
     *
     * Widened from "the flag is on and the read has not landed" to "there is no
     * durable ledger to read from". With FEATURE_FEES off, the flag-off branch
     * used to hand a signed-in workspace eight fixture clients with
     * $21,900 of fees and an editable model select — the worst numbers on the
     * surface, and every one of them from a file. There is no ledger either
     * way; the difference between the two is only whether anyone asked.
     */
    const feesUnreadable =
      durableReceivables === null
      && (durableWorkspace
        || (feesEnabled
          && (receivablesRead.state === "loading" || receivablesRead.state === "failed")));
    const feesUnavailableReason =
      !feesEnabled
        ? "Fee records are not enabled for this workspace."
        : receivablesRead.state === "failed"
          ? "Unable to load fee records."
          : receivablesRead.state === "disabled"
            ? "Fee records are not enabled for this workspace."
            : "Loading fee records…";
    const feesUnavailableIsFailure =
      feesEnabled && receivablesRead.state === "failed";

    function applyWorkspaceFeeModel(
      model: Exclude<FeeModel, "package" | "unconfigured">,
    ) {
      setDefaultFeeModel(model);
      setFeeDefaultChosen(true);
      // The one fee write on this tab with a durable subject: the workspace
      // default belongs to the org, and the org id comes from the session.
      if (feesEnabled) {
        void persistWorkspaceFeeDefault(
          model,
          defaultCustomFee,
          defaultUpfrontFee,
        );
      }
      setFeeRows((current) =>
        current.map((fee) => {
          if (feeModelOverrides.has(fee.clientId)) return fee;
          const funded = getClientFundedAmount(fee.clientId);
          return {
            ...fee,
            model,
            totalFee:
              model === "percent"
                ? parseMoney(funded * SUCCESS_FEE_RATE)
                : defaultCustomFee,
          };
        }),
      );
    }
    return (
      <div className="space-y-5">
        <p className="text-sm leading-6 text-muted-foreground">
          Success-fee tracking and payables for this workspace. Consumer
          platform-plan revenue lives in the Platform rev tab.
        </p>
        <MetricStrip
          items={(() => {
            // An unreadable ledger shows no money at all. Falling back to the
            // fixture totals here would put six figures on the screen sourced
            // from a file, which is the failure this tab was fixed for.
            const money = durableReceivables
              ? durableFeeTotals(durableReceivables)
              : null;
            const cell = (fixture: number, durable: number | undefined) =>
              feesUnreadable
                ? "—"
                : formatDemoMoney(money ? (durable ?? 0) / 100 : fixture);
            return [
              { label: "Total fees", value: cell(feeMetrics.total, money?.total) },
              { label: "Paid", value: cell(feeMetrics.paid, money?.paid) },
              { label: "Balance", value: cell(feeMetrics.balance, money?.balance) },
              {
                label: "Default success fee",
                value: feeDefaultChosen
                  ? defaultFeeModel === "percent"
                    ? `${defaultSuccessFeePct}% funded`
                    : defaultFeeModel === "custom"
                      ? "Flat amount"
                      : "Package"
                  : "—",
              },
            ];
          })()}
        />
        <Panel
          description="New clients appear automatically and inherit this default until an operator sets a per-client override below."
          title="Default fee model"
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Admin upfront</h3>
                {upfrontFeeApproved ? (
                  <StatusPill tone="success">Legal sign-off recorded</StatusPill>
                ) : (
                  <StatusPill tone="warning">Pending legal review</StatusPill>
                )}
              </div>
              <label className="mt-3 block max-w-52 text-xs font-medium text-muted-foreground">
                Upfront amount
                <Input
                  aria-label="Default upfront admin fee"
                  className="mt-1 tabular-nums"
                  disabled={!upfrontFeeApproved}
                  min="0"
                  onBlur={() => {
                    // A default write names a success-fee model, so an amount
                    // typed before one is chosen rides along with the next
                    // model click rather than being sent on its own — the same
                    // way the flat amount beside it behaves.
                    if (
                      feesEnabled
                      && (defaultFeeModel === "percent" || defaultFeeModel === "custom")
                    ) {
                      void persistWorkspaceFeeDefault(
                        defaultFeeModel,
                        defaultCustomFee,
                        defaultUpfrontFee,
                      );
                    }
                  }}
                  onChange={(event) =>
                    setDefaultUpfrontFee(parseMoney(event.target.value))
                  }
                  placeholder="0.00"
                  step="0.01"
                  type="number"
                  value={
                    defaultUpfrontFee !== null
                      ? defaultUpfrontFee
                      : ""
                  }
                />
              </label>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {upfrontFeeApproved
                  ? `This workspace carries a recorded legal sign-off for charging an administrative fee before services are delivered${upfrontSignoffRef ? ` (${upfrontSignoffRef})` : ""}. Nothing here is a legal opinion.`
                  : "Charging an administrative fee before services are delivered carries advance-fee exposure, so this option stays disabled until counsel clears it. Nothing here is a legal opinion."}
              </p>
            </section>
            <section className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Success fee · backend</h3>
                {feeDefaultChosen ? (
                  <StatusPill tone="success">Active default</StatusPill>
                ) : workspaceFeeDefaultsRead.state === "loading" ? (
                  <StatusPill>Loading</StatusPill>
                ) : (
                  <StatusPill>Not configured</StatusPill>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  aria-pressed={feeDefaultChosen && defaultFeeModel === "percent"}
                  onClick={() => applyWorkspaceFeeModel("percent")}
                  size="sm"
                  variant={feeDefaultChosen && defaultFeeModel === "percent" ? "secondary" : "outline"}
                >
                  % of funded
                </Button>
                <Button
                  aria-pressed={feeDefaultChosen && defaultFeeModel === "custom"}
                  onClick={() => applyWorkspaceFeeModel("custom")}
                  size="sm"
                  variant={feeDefaultChosen && defaultFeeModel === "custom" ? "secondary" : "outline"}
                >
                  Flat amount
                </Button>
              </div>
              {feeDefaultChosen && defaultFeeModel === "custom" ? (
                <label className="mt-4 block max-w-52 text-xs font-medium text-muted-foreground">
                  Default flat amount
                  <Input
                    className="mt-1 tabular-nums"
                    min="0"
                    onChange={(event) => {
                      const amount = parseMoney(event.target.value);
                      setDefaultCustomFee(amount);
                      setFeeRows((current) =>
                        current.map((fee) =>
                          !feeModelOverrides.has(fee.clientId) &&
                          fee.model === "custom"
                            ? { ...fee, totalFee: amount }
                            : fee,
                        ),
                      );
                    }}
                    step="0.01"
                    type="number"
                    value={defaultCustomFee}
                  />
                </label>
              ) : feeDefaultChosen && defaultFeeModel === "package" ? (
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  A package default is stored for this workspace. Choose a
                  percentage or flat amount above to replace it.
                </p>
              ) : (
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                  Success fees are charged against recorded funded amounts, so
                  they carry no advance-fee exposure.
                </p>
              )}
            </section>
          </div>
          {feeDefaultFailed ? (
            <p className="mt-4 text-xs text-destructive" role="alert">
              The workspace default could not be saved. Nothing was changed.
            </p>
          ) : null}
          {workspaceFeeDefaultsRead.state === "failed" ? (
            <p className="mt-4 text-xs text-destructive" role="alert">
              The saved workspace default could not be loaded. No stored value
              is being shown.
            </p>
          ) : workspaceFeeDefaultsRead.state === "disabled" ? (
            <p className="mt-4 text-xs leading-5 text-muted-foreground" role="status">
              Workspace fee defaults are not enabled.
            </p>
          ) : workspaceFeeDefaultsRead.state === "ready"
            && workspaceFeeDefaultsRead.orgDefault === null
            && !feeDefaultChosen ? (
            <p className="mt-4 text-xs leading-5 text-muted-foreground" role="status">
              No workspace default has been configured yet.
            </p>
          ) : null}
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Operators are responsible for confirming that any enabled fee model
            is permitted for their services and clients. Tracking does not
            create invoices, charges, or transfers.
          </p>
        </Panel>
        {durableReceivables ? (
          renderDurableFeeTracking(durableReceivables)
        ) : feesUnreadable ? (
          <Panel
            description="Total fee − paid = balance. All client records remain visible, including unconfigured new clients."
            title="Client fee tracking"
          >
            <p
              className={cn(
                "text-sm",
                feesUnavailableIsFailure ? "text-destructive" : "text-muted-foreground",
              )}
              role={feesUnavailableIsFailure ? "alert" : "status"}
            >
              {feesUnavailableReason}
            </p>
          </Panel>
        ) : (
        <Panel
          description="Total fee − paid = balance. All client records remain visible, including unconfigured new clients."
          title="Client fee tracking"
        >
          <div className="hidden overflow-x-auto md:block">
            <Table className="min-w-[920px]" containerLabel="Client fee tracking">
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Funded</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Total fee</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => {
                  const fee = currentFeeRows.find(
                    (row) => row.clientId === client.clientId,
                  ) ?? {
                    adminUpfront: 0,
                    clientId: client.clientId,
                    model: defaultFeeModel,
                    paid: 0,
                    totalFee:
                      defaultFeeModel === "percent"
                        ? parseMoney(getClientFundedAmount(client.clientId) * SUCCESS_FEE_RATE)
                        : defaultCustomFee,
                    triggerAmount: 0,
                  };
                  const funded = getClientFundedAmount(client.clientId);
                  const balance = Math.max(0, fee.totalFee - fee.paid);
                  return (
                    <TableRow key={client.clientId}>
                      <TableCell>
                        <button
                          onClick={() => openClient(client.clientId, "fees")}
                          type="button"
                        >
                          <ClientIdentity client={client} />
                        </button>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatDemoMoney(funded)}
                      </TableCell>
                      <TableCell>
                        {fee.model === "percent"
                          ? "Success fee · % of funded"
                          : fee.model === "custom"
                            ? "Success fee · flat amount"
                            : "Not configured"}
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold tabular-nums">
                          {formatDemoMoney(fee.totalFee)}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatDemoMoney(fee.paid)}
                      </TableCell>
                      <TableCell className="font-semibold tabular-nums">
                        {formatDemoMoney(balance)}
                      </TableCell>
                      <TableCell>
                        <Button
                          onClick={() =>
                            setEditingFeeClient({
                              clientId: client.clientId,
                              name: client.name,
                            })
                          }
                          size="sm"
                          variant="outline"
                        >
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="divide-y divide-border md:hidden">
            {clients.map((client) => {
              const fee = currentFeeRows.find(
                (row) => row.clientId === client.clientId,
              ) ?? {
                adminUpfront: 0,
                clientId: client.clientId,
                model: defaultFeeModel,
                paid: 0,
                totalFee:
                  defaultFeeModel === "percent"
                    ? parseMoney(getClientFundedAmount(client.clientId) * SUCCESS_FEE_RATE)
                    : defaultCustomFee,
                triggerAmount: 0,
              };
              return (
                <article
                  className="py-4 first:pt-0 last:pb-0"
                  key={client.clientId}
                >
                  <ClientIdentity client={client} />
                  <dl className="mt-4 grid grid-cols-2 gap-3">
                    <MobileField label="Total">
                      {formatDemoMoney(fee.totalFee)}
                    </MobileField>
                    <MobileField label="Paid">
                      {formatDemoMoney(fee.paid)}
                    </MobileField>
                    <MobileField label="Balance">
                      {formatDemoMoney(Math.max(0, fee.totalFee - fee.paid))}
                    </MobileField>
                    <MobileField label="Model">
                      {feeModelOverrides.has(client.clientId)
                        ? fee.model
                        : `Workspace · ${defaultFeeModel}`}
                    </MobileField>
                  </dl>
                  <Button
                    className="mt-3 w-full"
                    onClick={() =>
                      setEditingFeeClient({
                        clientId: client.clientId,
                        name: client.name,
                      })
                    }
                    variant="outline"
                  >
                    Edit
                  </Button>
                </article>
              );
            })}
          </div>
        </Panel>
        )}
      </div>
    );
  }

  function renderPlatformRev() {
    if (durableWorkspace) {
      if (!platformRevenueCanRead) {
        return (
          <div className="space-y-5">
            <p className="text-sm leading-6 text-muted-foreground">
              Consumer platform-plan revenue shared with this workspace. This
              financial view is limited to workspace owners and admins.
            </p>
            <Panel title="Platform revenue access">
              <p className="text-sm text-muted-foreground" role="status">
                The signed-in workspace role does not have access to platform revenue.
              </p>
            </Panel>
          </div>
        );
      }

      if (platformRevenueRead.state === "idle" || platformRevenueRead.state === "loading") {
        return (
          <div className="space-y-5">
            <p className="text-sm leading-6 text-muted-foreground">
              Consumer platform-plan revenue shared with this workspace.
            </p>
            <Panel title="Platform revenue">
              <p className="text-sm text-muted-foreground" role="status">
                Loading the current-month revenue ledger and plan roster…
              </p>
            </Panel>
          </div>
        );
      }

      if (platformRevenueRead.state === "failed") {
        return (
          <div className="space-y-5">
            <p className="text-sm leading-6 text-muted-foreground">
              Consumer platform-plan revenue shared with this workspace.
            </p>
            <Panel title="Platform revenue unavailable">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-destructive" role="alert">
                  {platformRevenueRead.message}
                </p>
                <Button
                  onClick={() => setPlatformRevenueReload((current) => current + 1)}
                  size="sm"
                  variant="outline"
                >
                  Retry
                </Button>
              </div>
            </Panel>
          </div>
        );
      }

      const { revenue } = platformRevenueRead;
      const { ledger } = revenue;
      const activePlanRows = revenue.roster.filter((row) => row.status === "active");
      const monthLabel = new Intl.DateTimeFormat("en-US", {
        month: "long",
        timeZone: "UTC",
        year: "numeric",
      }).format(new Date(`${revenue.month}-01T00:00:00Z`));
      const settlementLabel = ledger === null ? "Not posted" : titleCase(ledger.settlementStatus);
      return (
        <div className="space-y-5">
          <p className="text-sm leading-6 text-muted-foreground">
            Consumer platform-plan revenue shared with this workspace. The
            roster and {monthLabel} ledger below are read-only billing records;
            this tab does not create invoices, charges, or payouts.
          </p>
          <MetricStrip
            items={[
              {
                change: `${revenue.roster.length} active workspace clients`,
                label: "Active on plan",
                value: activePlanRows.length,
              },
              {
                change: ledger === null ? "No ledger posted" : `${ledger.sourceRowCount} source rows`,
                label: "Collected basis this month",
                value: ledger === null ? "—" : formatRevenueMoney(ledger.baseAmountCents),
              },
              {
                change: ledger === null
                  ? "No ledger posted"
                  : ledger.isComplete
                    ? settlementLabel
                    : "Ledger incomplete",
                label: "Your share this month",
                value: ledger === null ? "—" : formatRevenueMoney(ledger.amountCents),
              },
              {
                change: ledger === null ? "No ledger posted" : monthLabel,
                label: "Share rate",
                value: ledger?.pctSnapshot === null || ledger === null
                  ? "—"
                  : `${ledger.pctSnapshot}%`,
              },
            ]}
          />
          <Panel
            description={`Posted earnings ledger for ${monthLabel}. A missing or incomplete row is never treated as zero.`}
            title="Current-month ledger"
            trailing={
              <StatusPill tone={ledger === null ? "neutral" : ledger.isComplete ? "success" : "warning"}>
                {ledger === null ? "Not posted" : ledger.isComplete ? "Complete" : "Incomplete"}
              </StatusPill>
            }
          >
            {ledger === null ? (
              <EmptyState
                description="No current-month earnings row has been posted, so the collected basis and share remain unavailable."
                title="Ledger not posted"
              />
            ) : (
              <div className="space-y-4">
                {!ledger.isComplete ? (
                  <p className="rounded-lg border border-[var(--consumer-warning-border)] bg-[var(--consumer-warning)]/40 p-3 text-sm text-[var(--consumer-warning-ink)]" role="status">
                    {platformRevenueIncompleteMessage(ledger.incompleteCode)}
                  </p>
                ) : null}
                <dl className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <dt className="text-xs text-muted-foreground">Collected basis</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{formatRevenueMoney(ledger.baseAmountCents)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Revenue share</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{ledger.pctSnapshot === null ? "—" : `${ledger.pctSnapshot}%`}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Your share</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{formatRevenueMoney(ledger.amountCents)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Source plan rows</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{ledger.sourceRowCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Settlement</dt>
                    <dd className="mt-1 font-semibold">{settlementLabel}</dd>
                  </div>
                </dl>
              </div>
            )}
          </Panel>
          <Panel
            description="Active workspace clients and their recorded consumer-plan state. A missing subscription remains visible as no plan record."
            title="Active client plan roster"
          >
            {revenue.roster.length === 0 ? (
              <EmptyState
                description="No active client records are attached to this workspace."
                title="No active clients"
              />
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <Table className="min-w-[760px]" containerLabel="Active client plan roster">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Plan status</TableHead>
                        <TableHead>Monthly plan</TableHead>
                        <TableHead>Plan activity</TableHead>
                        <TableHead>Last updated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {revenue.roster.map((row) => (
                        <TableRow key={row.clientId}>
                          <TableCell>
                            <button
                              className="inline-flex min-h-6 items-center text-left font-semibold underline-offset-4 hover:text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => openTrackerClient(row.clientId)}
                              type="button"
                            >
                              {row.clientName}
                            </button>
                          </TableCell>
                          <TableCell>
                            <StatusPill tone={platformPlanStatusTone(row.status)}>
                              {platformPlanStatusLabel(row.status)}
                            </StatusPill>
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {row.priceCents === null || row.currency === null
                              ? "—"
                              : formatRevenueMoney(row.priceCents, row.currency)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.cancelledAt !== null
                              ? `Cancelled ${formatDurableTimestamp(row.cancelledAt)}`
                              : row.activatedAt !== null
                                ? `Activated ${formatDurableTimestamp(row.activatedAt)}`
                                : "Not activated"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {row.updatedAt === null ? "—" : formatDurableTimestamp(row.updatedAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="divide-y divide-border md:hidden">
                  {revenue.roster.map((row) => (
                    <article className="py-4 first:pt-0 last:pb-0" key={row.clientId}>
                      <div className="flex items-start justify-between gap-3">
                        <button
                          className="min-h-6 text-left text-sm font-semibold underline-offset-4 hover:text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => openTrackerClient(row.clientId)}
                          type="button"
                        >
                          {row.clientName}
                        </button>
                        <StatusPill tone={platformPlanStatusTone(row.status)}>
                          {platformPlanStatusLabel(row.status)}
                        </StatusPill>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-3">
                        <MobileField label="Monthly plan">
                          {row.priceCents === null || row.currency === null
                            ? "—"
                            : formatRevenueMoney(row.priceCents, row.currency)}
                        </MobileField>
                        <MobileField label="Last updated">
                          {row.updatedAt === null ? "—" : formatDurableTimestamp(row.updatedAt)}
                        </MobileField>
                      </dl>
                    </article>
                  ))}
                </div>
              </>
            )}
          </Panel>
        </div>
      );
    }

    const activeRows = CLIENT_PLATFORM_PLAN_RECORDS.filter(
      (row) => row.status === "active",
    );
    const overdueRows = CLIENT_PLATFORM_PLAN_RECORDS.filter(
      (row) => row.status === "overdue",
    );
    const shareRate = monitoringShareRate ?? PLATFORM_REV_SHARE;
    const monthlyShare = parseMoney(
      activeRows.length * PLATFORM_PLAN_PRICE * shareRate,
    );
    return (
      <div className="space-y-5">
        <p className="text-sm leading-6 text-muted-foreground">
          Consumer platform-plan revenue shared with this workspace.
          Illustrative fixture assumptions match the platform SaaS ledger: the
          consumer plan is {formatDemoMoney(PLATFORM_PLAN_PRICE)}/mo and the
          operator monitoring share is {monitoringShareLabel}. Final revenue-share terms remain
          TBD pending the billing session; nothing here creates invoices or
          charges.
        </p>
        <StatStrip
          stats={[
            [
              "Active on plan",
              String(activeRows.length),
              `${formatDemoMoney(PLATFORM_PLAN_PRICE)}/mo consumer plan`,
            ],
            [
              "Overdue",
              String(overdueRows.length),
              overdueRows.length
                ? `${formatDemoMoney(overdueRows.length * PLATFORM_PLAN_PRICE)} outstanding`
                : "No missed payments",
            ],
            [
              "Your share this month",
              formatDemoMoney(monthlyShare, { minimumFractionDigits: 2 }),
              `${monitoringShareLabel} share of active plans`,
            ],
            ["Share rate", monitoringShareLabel, "Terms TBD · billing session"],
          ]}
        />
        <Panel
          description="Enrollment status comes from each client's consumer subscription. Share amounts are illustrative fixture math only."
          title="Platform plan roster"
        >
          <div className="hidden overflow-x-auto md:block">
            <Table className="min-w-[820px]" containerLabel="Platform plan roster">
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Plan status</TableHead>
                  <TableHead>Monthly plan</TableHead>
                  <TableHead>Your share / mo</TableHead>
                  <TableHead>Earnings this month</TableHead>
                  <TableHead>Last payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {CLIENT_PLATFORM_PLAN_RECORDS.map((row) => {
                  const client = clients.find(
                    (item) => item.clientId === row.clientId,
                  );
                  if (!client) return null;
                  const share = parseMoney(PLATFORM_PLAN_PRICE * shareRate);
                  return (
                    <TableRow key={row.clientId}>
                      <TableCell>
                        <button
                          className="inline-flex min-h-6 items-center text-left font-semibold underline-offset-4 hover:text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => openClient(row.clientId, "fees")}
                          type="button"
                        >
                          {client.name}
                        </button>
                        <p className="text-xs text-muted-foreground">
                          {client.business}
                        </p>
                      </TableCell>
                      <TableCell>
                        <StatusPill
                          tone={row.status === "active" ? "success" : "danger"}
                        >
                          {row.status === "active" ? "Active" : "Overdue"}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatDemoMoney(PLATFORM_PLAN_PRICE)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatDemoMoney(share, { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="font-semibold tabular-nums">
                        {row.status === "active"
                          ? formatDemoMoney(share, { minimumFractionDigits: 2 })
                          : formatDemoMoney(0)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.lastPayment}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="divide-y divide-border md:hidden">
            {CLIENT_PLATFORM_PLAN_RECORDS.map((row) => {
              const client = clients.find(
                (item) => item.clientId === row.clientId,
              );
              if (!client) return null;
              const share = parseMoney(PLATFORM_PLAN_PRICE * shareRate);
              return (
                <article className="py-4 first:pt-0 last:pb-0" key={row.clientId}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">{client.name}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {client.business}
                      </p>
                    </div>
                    <StatusPill
                      tone={row.status === "active" ? "success" : "danger"}
                    >
                      {row.status === "active" ? "Active" : "Overdue"}
                    </StatusPill>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3">
                    <MobileField label="Your share / mo">
                      {formatDemoMoney(share, { minimumFractionDigits: 2 })}
                    </MobileField>
                    <MobileField label="Last payment">
                      {row.lastPayment}
                    </MobileField>
                  </dl>
                </article>
              );
            })}
          </div>
        </Panel>
      </div>
    );
  }

  function renderTeam() {
    function openTeamMember(memberId: string) {
      setClientAssignmentDraft(new Set(
        clients
          .filter((client) => getClientOwnerId(client) === memberId)
          .map((client) => client.clientId),
      ));
      setClientAssignmentQuery("");
      setSelectedTeamMemberId(memberId);
    }

    function closeTeamMember() {
      setClientAssignmentDraft(new Set());
      setClientAssignmentQuery("");
      setTeamDeactivateCandidateId(null);
      setSelectedTeamMemberId(null);
    }

    /**
     * How many clients a member owns.
     *
     * On a signed-in workspace this counts the same `/api/clients` directory the
     * roster itself came from, so the number and the names agree; `null` is
     * "the directory did not load", which renders an em dash rather than the
     * "None" a zero would.
     */
    function memberClientCount(memberId: string): number | null {
      if (!durableWorkspace) {
        return clients.filter((client) => getClientOwnerId(client) === memberId)
          .length;
      }
      if (teamDirectory.state !== "ready") return null;
      return teamDirectory.clients.filter(
        (client) => client.assignedToId === memberId,
      ).length;
    }

    const normalizedAssignmentQuery = clientAssignmentQuery.trim().toLowerCase();
    const assignmentClients = clients
      .filter((client) => !normalizedAssignmentQuery || `${client.name} ${client.business}`.toLowerCase().includes(normalizedAssignmentQuery))
      .sort((left, right) => {
        const selectionOrder = Number(clientAssignmentDraft.has(right.clientId)) - Number(clientAssignmentDraft.has(left.clientId));
        return selectionOrder || left.name.localeCompare(right.name);
      });
    const canDeactivateSelectedTeamMember = Boolean(
      durableWorkspace
      && tenancyEnabled
      && (sessionIdentity?.orgRole === "owner" || sessionIdentity?.orgRole === "admin")
      && selectedTeamMember
      && isTrackerUuid(selectedTeamMember.id)
      && selectedTeamMember.active
      && !selectedTeamMember.isCurrentUser
      && selectedTeamMember.role !== null
      && selectedTeamMember.role !== "Owner",
    );
    const canChangeSelectedTeamMemberRole = Boolean(
      durableWorkspace
      && tenancyEnabled
      && (sessionIdentity?.orgRole === "owner" || sessionIdentity?.orgRole === "admin")
      && selectedTeamMember
      && isTrackerUuid(selectedTeamMember.id)
      && selectedTeamMember.active
      && selectedTeamMember.role !== null,
    );

    async function changeSelectedTeamMemberRole(next: string) {
      const member = selectedTeamMember;
      const orgRole = TEAM_ROLE_BY_LABEL[next as TeamRole];
      if (
        !canChangeSelectedTeamMemberRole
        || member === undefined
        || orgRole === undefined
        || teamRolePendingId !== null
      ) return;

      setTeamRolePendingId(member.id);
      setTeamRoleFeedback(null);
      try {
        const result = await updateOperatorTeamMemberRole(member.id, orgRole);
        const readback = await readSupportInboxDirectory();
        if (readback.state !== "ready") {
          setTeamRoleFeedback({
            kind: "error",
            message: "The server accepted the role change, but the workspace roster could not be read back. Reload before changing another role.",
          });
          return;
        }
        const stored = inboxTeamOptions(readback.clients).find((row) => row.id === member.id);
        if (stored?.orgRole !== result.orgRole) {
          setTeamRoleFeedback({
            kind: "error",
            message: "The saved role did not match the server roster, so the change was not confirmed.",
          });
          return;
        }
        setTeamDirectory(readback);
        setTeamDirectoryLoaded(true);
        setTeamRoleFeedback({
          kind: "success",
          message: `${member.name}'s role is now ${TEAM_ROLE_LABELS[result.orgRole]}.`,
        });
      } catch (error) {
        setTeamRoleFeedback({
          kind: "error",
          message: error instanceof Error ? error.message : "The member role could not be changed.",
        });
      } finally {
        setTeamRolePendingId(null);
      }
    }

    async function deactivateSelectedTeamMember() {
      const member = selectedTeamMember;
      if (
        !canDeactivateSelectedTeamMember
        || member === undefined
        || teamDeactivateCandidateId !== member.id
        || teamDeactivatePendingId !== null
      ) return;

      setTeamDeactivatePendingId(member.id);
      setTeamDeactivateFeedback(null);
      const result = await deactivateOperatorTeamMember(member.id);
      if (result.outcome === "failed") {
        setTeamDeactivateFeedback({ kind: "error", message: result.message });
        setTeamDeactivatePendingId(null);
        return;
      }

      const readback = await readSupportInboxDirectory();
      if (readback.state !== "ready") {
        closeTeamMember();
        setTeamDeactivateFeedback({
          kind: "error",
          message: "The server accepted the deactivation, but the workspace roster could not be read back. Reload before removing anyone else.",
        });
        setTeamDeactivatePendingId(null);
        return;
      }
      setTeamDirectory(readback);
      setTeamDirectoryLoaded(true);
      if (inboxTeamOptions(readback.clients).some((row) => row.id === member.id)) {
        setTeamDeactivateCandidateId(null);
        setTeamDeactivateFeedback({
          kind: "error",
          message: "The member is still present in the server roster, so deactivation was not confirmed.",
        });
        setTeamDeactivatePendingId(null);
        return;
      }

      closeTeamMember();
      setTeamDeactivateFeedback({
        kind: "success",
        message: result.applied
          ? `${member.name} was deactivated, their client assignments were cleared, and the roster read-back confirmed deactivation.`
          : `${member.name} was already inactive, and the roster read-back confirmed deactivation.`,
      });
      setTeamDeactivatePendingId(null);
    }

    async function invite() {
      const email = inviteEmail.trim();
      if (!email || !email.includes("@")) return;
      const name = email
        .split("@")[0]
        .split(/[._-]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      if (tenancyEnabled) {
        if (invitePending) return;
        setInvitePending(true);
        setTeamNotice("");
        await createOperatorTeamInvite({ email, fullName: name }, {
          created(invite) {
            // The invite is real and recorded; the roster is not the place it
            // lands. Appending the invitee here used to push a durable person
            // into the fixture seat list, where they sat beside seven people
            // this workspace has never employed and carried an invented role.
            // The roster comes back from `/api/clients` when the invitee is
            // assigned work.
            setInviteEmail("");
            setInviteOpen(false);
            setTeamNotice(
              `Invitation sent to ${invite.email} and recorded. They appear on the roster once a client is assigned to them.`,
            );
          },
          failed(failure) {
            setTeamNotice(tenantFailureMessage(failure));
          },
        });
        setInvitePending(false);
        return;
      }
      setFixtureTeamRows((rows) => [
        ...rows,
        {
          active: true,
          email,
          id: `member-${Date.now()}`,
          isCurrentUser: false,
          lastActive: "Invite pending",
          name,
          role: "Prep specialist",
        },
      ]);
      setInviteEmail("");
      setInviteOpen(false);
    }

    const canManageAffiliateLifecycle = Boolean(
      durableWorkspace
      && affiliatesEnabled
      && tenancyEnabled
      && (sessionIdentity?.orgRole === "owner" || sessionIdentity?.orgRole === "admin"),
    );
    const selectedAffiliate = affiliateRoster.find(
      (row) => row.affiliateId === selectedAffiliateId,
    ) ?? null;
    const sharedClientIds = new Set(affiliateStatement.map((row) => row.clientId));
    const shareableAffiliateClients = trackerClients.clients.filter(
      (client) => client.status === "active" && !sharedClientIds.has(client.id),
    );

    async function runAffiliateMutation(
      key: string,
      action: () => Promise<unknown>,
      successMessage: string,
    ) {
      if (affiliateMutationPending !== null) return;
      setAffiliateMutationPending(key);
      setAffiliateFeedback(null);
      try {
        await action();
        setAffiliateFeedback({ kind: "success", message: successMessage });
        setAffiliateRosterReload((current) => current + 1);
      } catch (error) {
        setAffiliateFeedback({
          kind: "error",
          message: error instanceof Error ? error.message : "The affiliate change could not be completed.",
        });
      } finally {
        setAffiliateMutationPending(null);
      }
    }

    async function inviteAffiliate() {
      const email = affiliateInviteEmail.trim();
      if (!canManageAffiliateLifecycle || !email.includes("@") || affiliateInvitePending) return;
      const fullName = email
        .split("@")[0]
        .split(/[._-]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      setAffiliateInvitePending(true);
      setAffiliateFeedback(null);
      await createOperatorAffiliateInvite({ email, fullName }, {
        created(invite) {
          setAffiliateInviteEmail("");
          setAffiliateInviteOpen(false);
          setAffiliateFeedback({
            kind: "success",
            message: `Invitation sent to ${invite.email}. The partner appears here after accepting it.`,
          });
        },
        failed(failure) {
          setAffiliateFeedback({ kind: "error", message: tenantFailureMessage(failure) });
        },
      });
      setAffiliateInvitePending(false);
    }

    function saveAffiliateDefault(affiliate: AffiliateRosterEntry) {
      if (!canManageAffiliateLifecycle) return;
      const raw = affiliateDefaultCommissionDraft[affiliate.affiliateId]
        ?? String(affiliate.defaultCommissionBps / 100);
      const percent = Number(raw);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        setAffiliateFeedback({
          kind: "error",
          message: "Default commission must be between 0 and 100 percent.",
        });
        return;
      }
      const defaultCommissionBps = Math.round(percent * 100);
      void runAffiliateMutation(
        `commission:${affiliate.affiliateId}`,
        () => updateOperatorAffiliateLifecycle(affiliate.affiliateId, { defaultCommissionBps }),
        `${affiliate.name}'s default commission is now ${(defaultCommissionBps / 100).toFixed(2)}%.`,
      );
    }

    function changeAffiliateActive(affiliate: AffiliateRosterEntry, active: boolean) {
      if (!canManageAffiliateLifecycle) return;
      void runAffiliateMutation(
        `lifecycle:${affiliate.affiliateId}`,
        () => updateOperatorAffiliateLifecycle(affiliate.affiliateId, { active }),
        `${affiliate.name} was ${active ? "reactivated" : "deactivated"}.`,
      );
      setAffiliateDeactivateCandidateId(null);
    }

    function shareSelectedAffiliateClient() {
      if (selectedAffiliate === null || affiliateShareClientId === "choose") return;
      const client = trackerClients.clients.find((row) => row.id === affiliateShareClientId);
      if (client === undefined) return;
      void runAffiliateMutation(
        `share:${client.id}`,
        () => shareOperatorAffiliateClient(selectedAffiliate.affiliateId, client.id),
        `${client.displayName} is now shared with ${selectedAffiliate.name}.`,
      );
      setAffiliateShareClientId("choose");
    }

    function saveAffiliateShareCommission(row: AffiliateStatementRow) {
      const raw = affiliateCommissionOverrideDraft[row.clientId]
        ?? String(row.expectedCommissionCents / 100);
      const dollars = Number(raw);
      if (!Number.isFinite(dollars) || dollars < 0 || dollars > Number.MAX_SAFE_INTEGER / 100) {
        setAffiliateFeedback({ kind: "error", message: "Expected commission must be a valid non-negative amount." });
        return;
      }
      void runAffiliateMutation(
        `share-commission:${row.clientId}`,
        () => updateOperatorAffiliateShare(row.affiliateId, row.clientId, {
          expectedCommissionCents: Math.round(dollars * 100),
        }),
        `${row.clientName}'s commission override was saved.`,
      );
    }

    return (
      <div className="space-y-5">
        <CompactHeader
          action={
            <Button
              disabled={teamTab === "affiliates" && durableWorkspace && !canManageAffiliateLifecycle}
              onClick={() => {
                if (teamTab === "affiliates" && durableWorkspace) {
                  setAffiliateInviteOpen(true);
                  return;
                }
                setInviteOpen((open) => !open);
              }}
            >
              <Plus aria-hidden /> {teamTab === "affiliates" ? "Invite affiliate" : "Invite teammate"}
            </Button>
          }
          icon={UserCog}
          title="Team & Affiliates"
        />
        <Segmented
          onChange={setTeamTab}
          options={[
            { icon: Users, label: "Team", value: "members" },
            { icon: Share2, label: "Affiliate access", value: "affiliates" },
          ]}
          value={teamTab}
        />
        <Dialog onOpenChange={setInviteOpen} open={inviteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite teammate</DialogTitle>
            <DialogDescription>
                {tenancyEnabled ? "Send and record a workspace invitation." : "Prepare an invitation. Nothing is sent or stored."}
              </DialogDescription>
            </DialogHeader>
            <Input
              aria-label="Teammate email"
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@example.com"
              type="email"
              value={inviteEmail}
            />
            <DialogFooter>
              <Button onClick={() => setInviteOpen(false)} variant="outline">
                Cancel
              </Button>
              <Button disabled={!inviteEmail.includes("@") || invitePending} onClick={() => { void invite(); }}>
                {invitePending ? "Sending…" : "Send invite"}
              </Button>
            </DialogFooter>
            {teamNotice ? <p className="text-xs text-muted-foreground" role={teamNotice.includes(":") ? "alert" : "status"}>{teamNotice}</p> : null}
          </DialogContent>
        </Dialog>
        <Dialog onOpenChange={setAffiliateInviteOpen} open={affiliateInviteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite affiliate</DialogTitle>
              <DialogDescription>
                Send a governed affiliate invitation. The partner joins this directory after accepting it.
              </DialogDescription>
            </DialogHeader>
            <Input
              aria-label="Affiliate email"
              onChange={(event) => setAffiliateInviteEmail(event.target.value)}
              placeholder="partner@example.com"
              type="email"
              value={affiliateInviteEmail}
            />
            <DialogFooter>
              <Button onClick={() => setAffiliateInviteOpen(false)} variant="outline">Cancel</Button>
              <Button
                disabled={!affiliateInviteEmail.includes("@") || affiliateInvitePending || !canManageAffiliateLifecycle}
                onClick={() => { void inviteAffiliate(); }}
              >
                {affiliateInvitePending ? "Sending…" : "Send invite"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          onOpenChange={(open) => {
            if (!open && teamDeactivatePendingId === null) closeTeamMember();
          }}
          open={Boolean(selectedTeamMember)}
        >
          <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
            {selectedTeamMember ? (
              <>
                <DialogHeader>
                  <DialogTitle>{selectedTeamMember.name}</DialogTitle>
                  <DialogDescription>
                    {durableWorkspace
                      ? "Change this seat's stored access role here. Client ownership is managed from the Clients tracker."
                      : "Manage this seat and its client assignments. Nothing here is stored."}
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-5 lg:grid-cols-[15rem_1fr]">
                  <div className="space-y-4">
                    <div className="rounded-xl border border-border bg-muted/25 p-4">
                      <span className="grid size-10 place-items-center rounded-full bg-background text-xs font-semibold">
                        {initials(selectedTeamMember.name)}
                      </span>
                      {/* The client directory now carries the assignee's durable
                          role and active state. It still carries no email or
                          last-active instant, so those remain explicitly absent. */}
                      <p className="mt-3 text-sm font-semibold">
                        {selectedTeamMember.email ?? selectedTeamMember.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedTeamMember.lastActive === null
                          ? "Last active not recorded"
                          : `Last active ${selectedTeamMember.lastActive}`}
                      </p>
                    </div>
                    <span className="block text-xs font-medium text-muted-foreground">
                      Role
                      <BrandSelect
                        ariaLabel={`Role for ${selectedTeamMember.name}`}
                        className="mt-1.5"
                        disabled={
                          (durableWorkspace && !canChangeSelectedTeamMemberRole)
                          || teamRolePendingId !== null
                          || selectedTeamMember.role === null
                        }
                        onValueChange={(next) => {
                          if (durableWorkspace) {
                            void changeSelectedTeamMemberRole(next);
                            return;
                          }
                          setFixtureTeamRows((current) =>
                            current.map((member) =>
                              member.id === selectedTeamMember.id
                                ? { ...member, role: next as TeamRole }
                                : member,
                            ),
                          );
                        }}
                        options={
                          selectedTeamMember.role === null
                            ? [{ label: "Not recorded", value: "unrecorded" }]
                            : durableWorkspace
                              ? TEAM_ROLE_VALUES.map((value) => ({
                                  label: TEAM_ROLE_LABELS[value],
                                  value: TEAM_ROLE_LABELS[value],
                                }))
                              : [...TEAM_ROLES]
                        }
                        value={selectedTeamMember.role ?? "unrecorded"}
                      />
                      {teamRolePendingId === selectedTeamMember.id ? (
                        <span className="mt-1 block text-xs text-muted-foreground" role="status">
                          Saving role…
                        </span>
                      ) : null}
                    </span>
                  </div>
                  {/* The grid below is the fixture book, and the Save writes a
                      local ownership map. The durable dialog names the missing
                      reassignment control without directing operators to a
                      different surface that does not have one yet. */}
                  {durableWorkspace ? (
                    <div>
                      <p className="text-sm font-semibold">Client assignments</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Open Clients, select a client, then use Manage client to
                        reassign it to an active workspace member.
                      </p>
                    </div>
                  ) : (
                  <div>
                    <p className="text-sm font-semibold">Client assignments</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Select the clients this member owns, then save the complete assignment set.
                    </p>
                    <Input
                      aria-label="Search clients to assign"
                      className="mt-3"
                      onChange={(event) => setClientAssignmentQuery(event.target.value)}
                      placeholder="Search client or business"
                      value={clientAssignmentQuery}
                    />
                    <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                      {assignmentClients.map((client) => {
                        const assigned = clientAssignmentDraft.has(client.clientId);
                        return (
                          <button
                            aria-pressed={assigned}
                            className={cn(
                              "rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              assigned
                                ? "border-primary-ink bg-primary/5"
                                : "border-border hover:bg-muted/40",
                            )}
                            key={client.clientId}
                            onClick={() => setClientAssignmentDraft((current) => {
                              const next = new Set(current);
                              if (next.has(client.clientId)) next.delete(client.clientId);
                              else next.add(client.clientId);
                              return next;
                            })}
                            type="button"
                          >
                            <span className="block text-sm font-medium">
                              {client.name}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {client.business} · {assigned ? "Assigned" : "Not assigned"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    disabled={teamDeactivatePendingId !== null}
                    onClick={closeTeamMember}
                    variant="outline"
                  >
                    {durableWorkspace ? "Close" : "Cancel"}
                  </Button>
                  {canDeactivateSelectedTeamMember ? (
                    teamDeactivateCandidateId === selectedTeamMember.id ? (
                      <>
                        <span className="self-center text-xs text-destructive">
                          Remove this member and unassign their clients?
                        </span>
                        <Button
                          disabled={teamDeactivatePendingId !== null}
                          onClick={() => setTeamDeactivateCandidateId(null)}
                          variant="ghost"
                        >
                          Keep member
                        </Button>
                        <Button
                          disabled={teamDeactivatePendingId !== null}
                          onClick={() => { void deactivateSelectedTeamMember(); }}
                          variant="destructive"
                        >
                          {teamDeactivatePendingId === selectedTeamMember.id
                            ? "Removing…"
                            : "Confirm deactivation"}
                        </Button>
                      </>
                    ) : (
                      <Button
                        onClick={() => {
                          setTeamDeactivateFeedback(null);
                          setTeamDeactivateCandidateId(selectedTeamMember.id);
                        }}
                        variant="destructive"
                      >
                        Remove member
                      </Button>
                    )
                  ) : durableWorkspace ? null : (
                  <Button
                    onClick={() => {
                      setClientOwnerOverrides((current) => {
                        const next = { ...current };
                        for (const client of clients) {
                          const currentOwner = current[client.clientId] ?? client.ownerId;
                          if (clientAssignmentDraft.has(client.clientId)) next[client.clientId] = selectedTeamMember.id;
                          else if (currentOwner === selectedTeamMember.id) next[client.clientId] = "unassigned";
                        }
                        return next;
                      });
                      setTeamNotice(`${selectedTeamMember.name}'s client assignments saved.`);
                      closeTeamMember();
                    }}
                  >Save assignments</Button>
                  )}
                </DialogFooter>
              </>
            ) : null}
          </DialogContent>
        </Dialog>
        {teamNotice ? <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm" role={teamNotice.includes(":") ? "alert" : "status"}>{teamNotice}</p> : null}
        {teamDeactivateFeedback ? (
          <p
            className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              teamDeactivateFeedback.kind === "error"
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "border-primary/20 bg-primary/5 text-primary-ink",
            )}
            role={teamDeactivateFeedback.kind === "error" ? "alert" : "status"}
          >
            {teamDeactivateFeedback.message}
          </p>
        ) : null}
        {teamRoleFeedback ? (
          <p
            className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              teamRoleFeedback.kind === "error"
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "border-primary/20 bg-primary/5 text-primary-ink",
            )}
            role={teamRoleFeedback.kind === "error" ? "alert" : "status"}
          >
            {teamRoleFeedback.message}
          </p>
        ) : null}

        {teamTab === "members" ? (
          <>
            <Panel
              title="Workspace seats"
              trailing={
                // The seat allowance lives on `orgs.seats_included`, which is
                // platform-governed and not on any read this surface can make,
                // so the literal 5 was the fixture plan's number attached to a
                // real roster. The count of people is the part we know.
                <span className="text-xs text-muted-foreground tabular-nums">
                  {teamRows.length} used
                  {durableWorkspace ? "" : " · 5 included"}
                </span>
              }
            >
              {teamRows.length === 0 ? (
                <p className="text-sm text-muted-foreground" role="status">
                  {teamRosterPending
                    ? "Loading the workspace roster…"
                    : teamRosterUnavailable
                      ? "The workspace roster could not be loaded."
                      : "No team members are recorded for this workspace yet. A member appears here once a client is assigned to them."}
                </p>
              ) : null}
              <div className="hidden overflow-x-auto md:block">
                <Table className="min-w-[640px]" containerLabel="Workspace seats">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Clients</TableHead>
                      <TableHead>Last active</TableHead>
                      <TableHead className="text-right">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teamRows.map((member) => {
                      const clientCount = memberClientCount(member.id);
                      return (
                        <TableRow key={member.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <span className="grid size-8 place-items-center rounded-full bg-muted text-[0.68rem] font-semibold">
                                {initials(member.name)}
                              </span>
                              <div>
                                <p className="font-medium">{member.name}</p>
                                {member.email === null ? null : (
                                  <p className="text-xs text-muted-foreground">
                                    {member.email}
                                  </p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {member.role ?? "—"}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {clientCount === null ? "—" : clientCount || "None"}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {member.lastActive ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {/* TODO(#191: referent inferred — confirm which control Alec meant) */}
                            <Button aria-label={`Manage ${member.name}`} className="min-h-11" onClick={() => openTeamMember(member.id)} size="sm" variant="outline">Manage member</Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y divide-border md:hidden">
                {teamRows.map((member) => {
                  const clientCount = memberClientCount(member.id);
                  return (
                    <article
                      className="py-4 first:pt-0 last:pb-0"
                      key={member.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{member.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {member.role ?? "Role not recorded"}
                          </p>
                        </div>
                        {member.lastActive === null ? null : (
                          <StatusPill>{member.lastActive}</StatusPill>
                        )}
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground tabular-nums">
                        {clientCount === null
                          ? "Assigned clients not available"
                          : `${formatDemoNumber(clientCount)} assigned clients`}
                      </p>
                      <Button className="mt-3 min-h-11 w-full" onClick={() => openTeamMember(member.id)} variant="outline">Manage member</Button>
                    </article>
                  );
                })}
              </div>
            </Panel>
          </>
        ) : (
          <Panel
            description={durableWorkspace
              ? "Invite partners, set their default commission, control access, and reconcile each statement."
              : "Choose exactly which client records each affiliate may see. Payment stays off platform."}
            title={durableWorkspace ? "Affiliate directory and statements" : "Share client with affiliate"}
          >
            {durableWorkspace ? (
              <div className="space-y-5">
                {affiliateFeedback ? (
                  <p
                    className={cn(
                      "rounded-lg border px-4 py-3 text-sm",
                      affiliateFeedback.kind === "error"
                        ? "border-destructive/30 bg-destructive/5 text-destructive"
                        : "border-primary/20 bg-primary/5 text-primary-ink",
                    )}
                    role={affiliateFeedback.kind === "error" ? "alert" : "status"}
                  >
                    {affiliateFeedback.message}
                  </p>
                ) : null}
                {!affiliatesEnabled ? (
                  <p className="text-sm text-muted-foreground" role="status">
                    Affiliate management is not enabled for this workspace.
                  </p>
                ) : affiliateRosterState === "idle" || affiliateRosterState === "loading" ? (
                  <p className="text-sm text-muted-foreground" role="status">Loading affiliate directory…</p>
                ) : affiliateRosterState === "failed" ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm text-destructive" role="alert">The affiliate directory could not be loaded.</p>
                    <Button onClick={() => setAffiliateRosterReload((current) => current + 1)} size="sm" variant="outline">
                      Try again
                    </Button>
                  </div>
                ) : affiliateRoster.length === 0 ? (
                  <EmptyState
                    action={canManageAffiliateLifecycle
                      ? <Button onClick={() => setAffiliateInviteOpen(true)}><UserPlus aria-hidden /> Invite affiliate</Button>
                      : undefined}
                    description="Invite a referral partner to create the first durable affiliate record."
                    title="No affiliates yet"
                  />
                ) : (
                  <>
                    <div className="grid gap-3 xl:grid-cols-2">
                      {affiliateRoster.map((affiliate) => {
                        const defaultPercent = affiliateDefaultCommissionDraft[affiliate.affiliateId]
                          ?? String(affiliate.defaultCommissionBps / 100);
                        const selected = affiliate.affiliateId === selectedAffiliateId;
                        const pending = affiliateMutationPending?.endsWith(affiliate.affiliateId) === true;
                        return (
                          <article
                            className={cn(
                              "rounded-xl border p-4",
                              selected ? "border-primary/40 bg-primary/5" : "border-border",
                            )}
                            key={affiliate.affiliateId}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold">{affiliate.name}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">{affiliate.email}</p>
                                <p className="mt-1 text-xs text-muted-foreground">Referral code {affiliate.referralSlug}</p>
                              </div>
                              <StatusPill tone={affiliate.active ? "success" : "danger"}>
                                {affiliate.active ? "Active" : "Inactive"}
                              </StatusPill>
                            </div>
                            <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
                              <div><dt className="text-muted-foreground">Clients</dt><dd className="mt-1 font-semibold tabular-nums">{affiliate.sharedClients}</dd></div>
                              <div><dt className="text-muted-foreground">Expected</dt><dd className="mt-1 font-semibold tabular-nums">{formatDemoMoney(affiliate.expectedCommissionCents / 100)}</dd></div>
                              <div><dt className="text-muted-foreground">Paid</dt><dd className="mt-1 font-semibold tabular-nums">{formatDemoMoney(affiliate.paidCommissionCents / 100)}</dd></div>
                            </dl>
                            <div className="mt-4 flex flex-wrap items-end gap-2">
                              <label className="text-xs text-muted-foreground">
                                Default commission %
                                <Input
                                  aria-label={`Default commission for ${affiliate.name}`}
                                  className="mt-1 w-32 tabular-nums"
                                  disabled={!canManageAffiliateLifecycle || pending}
                                  max="100"
                                  min="0"
                                  onChange={(event) => setAffiliateDefaultCommissionDraft((current) => ({
                                    ...current,
                                    [affiliate.affiliateId]: event.target.value,
                                  }))}
                                  step="0.01"
                                  type="number"
                                  value={defaultPercent}
                                />
                              </label>
                              <Button disabled={!canManageAffiliateLifecycle || pending} onClick={() => saveAffiliateDefault(affiliate)} size="sm" variant="outline">
                                Save rate
                              </Button>
                              <Button onClick={() => setSelectedAffiliateId(affiliate.affiliateId)} size="sm" variant={selected ? "default" : "outline"}>
                                View statement
                              </Button>
                            </div>
                            {canManageAffiliateLifecycle ? (
                              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                                {affiliate.active && affiliateDeactivateCandidateId === affiliate.affiliateId ? (
                                  <>
                                    <span className="text-xs text-destructive">Revoke this affiliate’s portal access?</span>
                                    <Button disabled={pending} onClick={() => setAffiliateDeactivateCandidateId(null)} size="sm" variant="ghost">Keep active</Button>
                                    <Button disabled={pending} onClick={() => changeAffiliateActive(affiliate, false)} size="sm" variant="destructive">Confirm deactivation</Button>
                                  </>
                                ) : (
                                  <Button
                                    disabled={pending}
                                    onClick={() => affiliate.active
                                      ? setAffiliateDeactivateCandidateId(affiliate.affiliateId)
                                      : changeAffiliateActive(affiliate, true)}
                                    size="sm"
                                    variant={affiliate.active ? "ghost" : "outline"}
                                  >
                                    {affiliate.active ? "Deactivate" : "Reactivate"}
                                  </Button>
                                )}
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>

                    {selectedAffiliate ? (
                      <div className="rounded-xl border border-border p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                          <div>
                            <p className="text-sm font-semibold">Affiliate statement</p>
                            <p className="mt-1 text-xs text-muted-foreground">Funding and commission values come from this affiliate’s durable client shares.</p>
                          </div>
                          <BrandSelect
                            ariaLabel="Affiliate statement"
                            className="w-auto min-w-56"
                            onValueChange={(value) => {
                              setSelectedAffiliateId(value);
                              setAffiliateShareClientId("choose");
                            }}
                            options={affiliateRoster.map((affiliate) => ({
                              label: affiliate.active ? affiliate.name : `${affiliate.name} (inactive)`,
                              value: affiliate.affiliateId,
                            }))}
                            value={selectedAffiliate.affiliateId}
                          />
                        </div>

                        {selectedAffiliate.active ? (
                          <div className="mt-4 flex flex-col gap-2 rounded-lg bg-muted/30 p-3 sm:flex-row sm:items-end">
                            <span className="block flex-1 text-xs text-muted-foreground">
                              Share another client
                              <BrandSelect
                                ariaLabel={`Client to share with ${selectedAffiliate.name}`}
                                className="mt-1 w-full"
                                disabled={trackerClients.loading || shareableAffiliateClients.length === 0}
                                onValueChange={setAffiliateShareClientId}
                                options={[
                                  { label: shareableAffiliateClients.length === 0 ? "No unshared active clients" : "Choose a client", value: "choose" },
                                  ...shareableAffiliateClients.map((client) => ({ label: client.displayName, value: client.id })),
                                ]}
                                value={affiliateShareClientId}
                              />
                            </span>
                            <Button
                              disabled={affiliateShareClientId === "choose" || affiliateMutationPending !== null}
                              onClick={shareSelectedAffiliateClient}
                            >
                              <Share2 aria-hidden /> Share client
                            </Button>
                          </div>
                        ) : null}

                        {affiliateStatementForId !== selectedAffiliate.affiliateId || affiliateStatementState === "loading" || affiliateStatementState === "idle" ? (
                          <p className="mt-4 text-sm text-muted-foreground" role="status">Loading statement…</p>
                        ) : affiliateStatementState === "failed" ? (
                          <p className="mt-4 text-sm text-destructive" role="alert">This affiliate statement could not be loaded.</p>
                        ) : affiliateStatement.length === 0 ? (
                          <p className="mt-4 text-sm text-muted-foreground" role="status">No clients are shared with this affiliate.</p>
                        ) : (
                          <div className="mt-4 space-y-3">
                            {affiliateStatement.map((row) => {
                              const commission = affiliateCommissionOverrideDraft[row.clientId]
                                ?? String(row.expectedCommissionCents / 100);
                              const pending = affiliateMutationPending?.endsWith(row.clientId) === true;
                              return (
                                <article className="rounded-lg border border-border p-3" key={row.clientId}>
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-semibold">{row.clientName}</p>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {titleCase(row.stage)} · Funded {formatDemoMoney(row.fundedAmountCents / 100)} · Started {formatDate(row.startedAt)}
                                      </p>
                                    </div>
                                    <StatusPill>{affiliatePaymentStatusLabel(row.paymentStatus)}</StatusPill>
                                  </div>
                                  <div className="mt-3 flex flex-wrap items-end gap-2">
                                    <label className="text-xs text-muted-foreground">
                                      Expected commission
                                      <Input
                                        aria-label={`Expected commission for ${row.clientName}`}
                                        className="mt-1 w-36 tabular-nums"
                                        disabled={pending}
                                        min="0"
                                        onChange={(event) => setAffiliateCommissionOverrideDraft((current) => ({
                                          ...current,
                                          [row.clientId]: event.target.value,
                                        }))}
                                        step="0.01"
                                        type="number"
                                        value={commission}
                                      />
                                    </label>
                                    <Button disabled={pending} onClick={() => saveAffiliateShareCommission(row)} size="sm" variant="outline">Save amount</Button>
                                    {row.commissionOverride ? (
                                      <Button
                                        disabled={pending}
                                        onClick={() => { void runAffiliateMutation(
                                          `share-commission:${row.clientId}`,
                                          () => updateOperatorAffiliateShare(row.affiliateId, row.clientId, { expectedCommissionCents: null }),
                                          `${row.clientName} now uses the affiliate's default commission.`,
                                        ); }}
                                        size="sm"
                                        variant="ghost"
                                      >
                                        Use default
                                      </Button>
                                    ) : null}
                                    <BrandSelect
                                      ariaLabel={`Payment status for ${row.clientName}`}
                                      className="w-auto min-w-36"
                                      disabled={pending}
                                      onValueChange={(value) => { void runAffiliateMutation(
                                        `share-status:${row.clientId}`,
                                        () => updateOperatorAffiliateShare(row.affiliateId, row.clientId, { paymentStatus: value as DurableAffiliatePaymentStatus }),
                                        `${row.clientName}'s payment status was updated.`,
                                      ); }}
                                      options={[
                                        { label: "Not ready", value: "not_ready" },
                                        { label: "Pending", value: "pending" },
                                        { label: "Submitted", value: "submitted" },
                                        { label: "Paid", value: "paid" },
                                      ]}
                                      value={row.paymentStatus}
                                    />
                                    <Button
                                      aria-label={`Stop sharing ${row.clientName} with ${selectedAffiliate.name}`}
                                      disabled={pending}
                                      onClick={() => { void runAffiliateMutation(
                                        `unshare:${row.clientId}`,
                                        () => unshareOperatorAffiliateClient(row.affiliateId, row.clientId),
                                        `${row.clientName} is no longer shared with ${selectedAffiliate.name}.`,
                                      ); }}
                                      size="sm"
                                      variant="ghost"
                                    >
                                      Stop sharing
                                    </Button>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : (
            <div className="space-y-4">
              {affiliateControlsDisabled ? (
                <p className="text-xs leading-5 text-muted-foreground" role="status">
                  {affiliateWritesDurable
                    ? "Sharing changes here are not saved to the affiliate portal, so these controls are disabled."
                    : "The affiliate portal is not connected, so these controls are disabled."}
                </p>
              ) : null}
              {clients.map((client) => {
                const share = affiliateShares.find(
                  (row) => row.clientId === client.clientId,
                );
                const affiliateId =
                  shareAffiliateChoice[client.clientId] ?? "aff-northstar";
                const affiliate = AFFILIATES.find(
                  (row) => row.id === affiliateId,
                )!;
                const commission =
                  shareCommissionDraft[client.clientId] ?? "750";
                return (
                  <div
                    className="rounded-lg border border-border p-4"
                    key={client.clientId}
                  >
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
                      <ClientIdentity client={client} />
                      {share ? (
                        <>
                          <div className="min-w-0 xl:ml-auto">
                            <p className="text-xs text-muted-foreground">
                              Shared with
                            </p>
                            <p className="mt-1 text-sm font-medium">
                              {share.affiliateName}
                            </p>
                          </div>
                          <label className="text-xs text-muted-foreground">
                            Expected commission
                            <Input
                              className="mt-1 w-36 tabular-nums"
                              disabled={affiliateControlsDisabled}
                              min="0"
                              onChange={(event) =>
                                setExpectedCommission(
                                  share.id,
                                  parseMoney(event.target.value),
                                )
                              }
                              step="0.01"
                              type="number"
                              value={share.expectedCommission}
                            />
                          </label>
                          <span className="block text-xs text-muted-foreground">
                            Payment status
                            <BrandSelect
                              ariaLabel={`Payment status for ${client.name}`}
                              className="mt-1"
                              disabled={affiliateControlsDisabled}
                              onValueChange={(next) =>
                                setAffiliatePaymentStatus(
                                  share.id,
                                  next as AffiliatePaymentStatus,
                                )
                              }
                              options={[
                                { label: "Not ready", value: "not-ready" },
                                { label: "Pending", value: "pending" },
                                { label: "Submitted", value: "submitted" },
                                { label: "Paid", value: "paid" },
                              ]}
                              value={share.paymentStatus}
                            />
                          </span>
                          <Button
                            aria-label={`Stop sharing ${client.name} with ${share.affiliateName}`}
                            disabled={affiliateControlsDisabled}
                            onClick={() => unshareClientFromAffiliate(share.id)}
                            variant="ghost"
                          >
                            Stop sharing
                          </Button>
                        </>
                      ) : (
                        <>
                          <BrandSelect
                            ariaLabel={`Affiliate for ${client.name}`}
                            className="w-auto min-w-44 xl:ml-auto"
                            disabled={affiliateControlsDisabled}
                            onValueChange={(next) =>
                              setShareAffiliateChoice((current) => ({
                                ...current,
                                [client.clientId]: next,
                              }))
                            }
                            options={AFFILIATES.map((row) => ({
                              label: row.name,
                              value: row.id,
                            }))}
                            value={affiliateId}
                          />
                          <Input
                            aria-label={`Expected commission for ${client.name}`}
                            className="w-40 tabular-nums"
                            disabled={affiliateControlsDisabled}
                            min="0"
                            onChange={(event) => {
                              const value = event.target.value;
                              if (!/^\d*(\.\d{0,2})?$/.test(value)) return;
                              setShareCommissionDraft((current) => ({
                                ...current,
                                [client.clientId]: value,
                              }));
                            }}
                            step="0.01"
                            type="number"
                            value={commission}
                          />
                          <Button
                            aria-label={`Share ${client.name} with ${affiliate.name}`}
                            disabled={affiliateControlsDisabled}
                            onClick={() =>
                              shareClientWithAffiliate({
                                affiliateId,
                                affiliateName: affiliate.name,
                                clientId: client.clientId,
                                expectedCommission: parseMoney(commission),
                              })
                            }
                          >
                            <Share2 aria-hidden /> Share client
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </Panel>
        )}
      </div>
    );
  }

  async function chooseBrandAccent(name: string) {
    if (tenancyEnabled) {
      if (brandPending) return;
      const accentColor = name === "emerald" ? "#065f46" : name === "blue" ? "#1d4ed8" : "#6d28d9";
      setBrandPending(true);
      setBrandNotice("");
      await updateOperatorBrand(accentColor, {
        changed(brand) {
          setLiveTenantBrand(brand);
          setBrandAccent(name);
          setBrandPublished(false);
          setBrandNotice("Draft brand saved.");
        },
        failed(failure) {
          setBrandNotice(tenantFailureMessage(failure));
        },
      });
      setBrandPending(false);
      return;
    }
    setBrandAccent(name);
    setBrandPublished(false);
  }

  async function publishBrandChanges() {
    if (!tenancyEnabled) {
      // No publish happened, so no date is stamped. `formatDate(DEMO_TODAY)`
      // printed "Jul 21, 2026" as the moment somebody published this brand.
      setBrandPublished(true);
      setBrandPublishedAt(null);
      return;
    }
    if (brandPending) return;
    setBrandPending(true);
    setBrandNotice("");
    await publishOperatorBrand({
      failed(failure) {
        setBrandNotice(tenantFailureMessage(failure));
      },
      published(publishedAt) {
        setBrandPublished(true);
        setBrandPublishedAt(new Intl.DateTimeFormat("en-US", {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
          year: "numeric",
        }).format(new Date(publishedAt)));
        setBrandNotice("Brand published.");
      },
    });
    setBrandPending(false);
  }

  function renderBrand() {
    // Workspace Setup can publish a portal name that intentionally differs
    // from the legal workspace name, so previews use the current published
    // identity instead of reverting to the session bootstrap value.
    const brandName = workspaceBrandName;
    const brandInitials = displayInitials(workspaceBrandName);
    const brandSitePreviewUrl = durableWorkspace
      ? "your-site.example/site-preview"
      : "apexfundingpartners.example/site-preview";
    const accentClass = brandAccent === "emerald" ? "bg-emerald-800" : brandAccent === "blue" ? "bg-blue-700" : "bg-violet-700";
    const publishedLogoStyle = publishedBrand.logoUrl
      ? { backgroundImage: `url(${JSON.stringify(publishedBrand.logoUrl)})`, backgroundPosition: "center", backgroundSize: "cover" }
      : undefined;
    const siteTemplate =
      MARKETING_SITE_TEMPLATES.find(
        (template) => template.id === siteTemplateId,
      ) ?? MARKETING_SITE_TEMPLATES[0];
    return (
      <div className="space-y-5">
        <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
          <Panel
            description={brandPublished ? (brandPublishedAt === null ? "No draft changes" : `Published ${brandPublishedAt}, no draft changes`) : "Draft changes are ready to publish"}
            title="Published theme"
            trailing={<Button disabled={brandPublished || brandPending} onClick={() => { void publishBrandChanges(); }}>{brandPending ? "Saving…" : "Publish changes"}</Button>}
          >
            <div className="space-y-5">
              {/* Every row here reads the workspace's own published brand or
                  says it is not recorded. `PublishedBrand` carries the accent,
                  the primary colour and the logo URL and nothing else, and the
                  organization's slug does not reach this component at all, so
                  the subdomain and the support address are absences rather than
                  the fixture workspace's. */}
              <div className="grid gap-2 sm:grid-cols-[8rem_1fr] sm:items-center"><span className="text-xs text-muted-foreground">Subdomain</span><span className="font-mono text-sm">{durableWorkspace ? "Not shown here" : "apex.mostfundable.com"}</span></div>
              <div className="grid gap-2 sm:grid-cols-[8rem_1fr] sm:items-center"><span className="text-xs text-muted-foreground">Logo</span>{publishedBrand.logoUrl ? <span aria-label="Published logo" className="grid size-10 place-items-center rounded-lg bg-muted" style={{ backgroundImage: `url(${JSON.stringify(publishedBrand.logoUrl)})`, backgroundPosition: "center", backgroundSize: "cover" }} /> : <span className="grid size-10 place-items-center rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: publishedBrand.previewColor ?? "var(--primary)" }}>{brandInitials}</span>}</div>
              <div className="grid gap-2 sm:grid-cols-[8rem_1fr] sm:items-center"><span className="text-xs text-muted-foreground">Type</span><span className="text-sm">Inter</span></div>
              <div className="grid gap-2 sm:grid-cols-[8rem_1fr] sm:items-center"><span className="text-xs text-muted-foreground">Support email</span><span className="text-sm">{durableWorkspace ? "Not recorded" : "help@apexfunding.co"}</span></div>
              <fieldset>
                <legend className="text-xs text-muted-foreground">Accent color</legend>
                <div className="mt-2 flex gap-1">
                  {[["emerald", "bg-emerald-800"], ["blue", "bg-blue-700"], ["violet", "bg-violet-700"]].map(([name, swatch]) => (
                    <button
                      aria-label={`Use ${name} accent`}
                      aria-pressed={brandAccent === name}
                      className="grid size-11 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      key={name}
                      disabled={brandPending}
                      onClick={() => { void chooseBrandAccent(name); }}
                      type="button"
                    >
                      <span aria-hidden className={cn("size-8 rounded-full", swatch, brandAccent === name && "ring-2 ring-foreground ring-offset-2")} />
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
            {brandNotice ? <p className="text-xs text-muted-foreground" role={brandNotice.includes(":") ? "alert" : "status"}>{brandNotice}</p> : null}
          </Panel>
          <Panel title="Live client preview">
            <div className="overflow-hidden rounded-xl border border-border bg-background">
              {/* The brand and the name are this workspace's; the client
                  content underneath is a layout sample and says so. It used to
                  read "Verified readiness · Jul 14", "Readiness reached 62" and
                  "Pay Chase Ink below 29%" beside a real operator's colour,
                  which is an analysis of a client who does not exist. */}
              <div className="flex items-center gap-3 border-b border-border px-5 py-4"><span className={cn("grid size-8 place-items-center rounded-lg text-xs font-semibold text-white", accentClass)} style={{ ...publishedLogoStyle, backgroundColor: publishedBrand.previewColor }}>{publishedBrand.logoUrl ? null : brandInitials}</span><span className="font-semibold">{brandName}</span></div>
              <div className={cn("m-5 rounded-xl p-5 text-white", accentClass)} style={{ backgroundColor: publishedBrand.previewColor }}><p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-75">Layout sample</p><h2 className="mt-3 max-w-lg text-2xl font-semibold">Your client&rsquo;s latest verified analysis appears here.</h2><p className="mt-3 text-sm opacity-80">Their next approved action appears underneath it.</p></div>
              <div className="grid gap-3 p-5 pt-0 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Readiness</p><p className="mt-1 text-2xl font-semibold tabular-nums">—</p></div><div><p className="text-xs text-muted-foreground">Stage</p><p className="mt-1 font-semibold">—</p></div><div><p className="text-xs text-muted-foreground">Next step</p><p className="mt-1 text-sm">—</p></div></div>
            </div>
          </Panel>
        </div>
        <Panel
          description="Pick a layout and see the published brand applied. Template copy is pre-approved and cannot be edited here."
          title="Branded marketing site"
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {MARKETING_SITE_TEMPLATES.map((template) => (
                <button
                  aria-pressed={siteTemplate.id === template.id}
                  className={cn(
                    "min-h-11 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    siteTemplate.id === template.id
                      ? "border-primary-ink bg-primary/8"
                      : "border-border hover:border-primary/30",
                  )}
                  key={template.id}
                  onClick={() => setSiteTemplateId(template.id)}
                  type="button"
                >
                  <span className="block text-sm font-semibold">
                    {template.name}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {template.description}
                  </span>
                </button>
              ))}
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-background">
              <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
                <span aria-hidden className="flex gap-1">
                  <span className="size-2 rounded-full bg-muted-foreground/30" />
                  <span className="size-2 rounded-full bg-muted-foreground/30" />
                  <span className="size-2 rounded-full bg-muted-foreground/30" />
                </span>
                <span className="truncate rounded-md border border-border bg-background px-2 py-1 font-mono text-[0.62rem] text-muted-foreground">
                  {brandSitePreviewUrl}
                </span>
              </div>
              <div className={cn("px-5 py-8 text-white", accentClass)}>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-75">
                  {brandName}
                </p>
                <h3 className="mt-3 max-w-xl text-2xl font-semibold tracking-[-0.02em]">
                  {siteTemplate.headline}
                </h3>
                <p className="mt-3 max-w-xl text-sm leading-6 opacity-80">
                  {siteTemplate.subheadline}
                </p>
              </div>
              <nav
                aria-label="Marketing site sections"
                className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border px-5 py-3 text-xs font-medium text-muted-foreground"
              >
                {siteTemplate.sections.map((section) => (
                  <span key={section}>{section}</span>
                ))}
              </nav>
              <p className="px-5 py-3 text-[0.68rem] text-muted-foreground">
                Powered by MostFundable
              </p>
            </div>

            <p className="text-sm">
              Your site, in your color — generated from your published brand.
            </p>
            <p className="rounded-lg border border-dashed border-border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground">
              Preview only. Site generation, hosting, domains, and publishing
              are not connected.
            </p>
          </div>
        </Panel>
      </div>
    );
  }

  function renderSettings() {
    const operator = OPERATOR_FIXTURES.find(
      (entry) => entry.id === "op-apex",
    )!;
    const additionalSeats = Math.max(
      0,
      teamRows.length - operator.includedSeats,
    );
    const additionalSeatFee = additionalSeats * 29;
    const durablePreferences = workspacePreferencesRead.state === "ready"
      ? workspacePreferencesRead.preferences
      : null;
    const preferencesLoading = durableWorkspace
      && (workspacePreferencesRead.state === "idle" || workspacePreferencesRead.state === "loading");
    const preferencesFailed = durableWorkspace && workspacePreferencesRead.state === "failed";
    const preferencesSaving = workspacePreferencesSaving !== null;
    return (
      <div className="space-y-5">
        <CompactHeader icon={Settings} title="Settings & Billing" />
        {workspacePreferencesFeedback ? (
          <p
            className={workspacePreferencesFeedback.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
            role={workspacePreferencesFeedback.kind === "error" ? "alert" : "status"}
          >
            {workspacePreferencesFeedback.message}
          </p>
        ) : null}
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Workspace">
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium" htmlFor="workspace-name">
                  Workspace name
                </label>
                {/* Not on `/api/org/settings`'s allow-list — `orgs` has no
                    column either route would write it to — so the field is
                    disabled rather than collecting text nothing reads. */}
                {/* The field stays disabled because no route writes it; what
                    changed is whose name sits in it. `sessionIdentity.orgName`
                    is the workspace this session belongs to, and an empty field
                    is the answer when the session carries no org — never the
                    fixture workspace's name presented as this one's. */}
                <Input
                  className="mt-2"
                  disabled
                  id="workspace-name"
                  key={sessionIdentity?.orgName ?? "workspace-name"}
                  defaultValue={
                    sessionIdentity?.orgName
                    ?? (durableWorkspace ? "" : "Apex Funding Partners")
                  }
                  placeholder="Not recorded"
                />
              </div>
              <div>
                <label className="text-xs font-medium" htmlFor="support-email">
                  Support email
                </label>
                {/* No column and no route carries a support address, so there is
                    nothing to show a signed-in workspace here. */}
                <Input
                  className="mt-2"
                  defaultValue={durableWorkspace ? "" : "help@apexfunding.co"}
                  disabled
                  id="support-email"
                  placeholder="Not recorded"
                  type="email"
                />
              </div>
            </div>
          </Panel>
          <Panel
            description="Controls what your clients see inside their portal."
            title="Client portal customization"
          >
            {preferencesLoading ? (
              <p className="text-sm text-muted-foreground" role="status">
                Loading saved client portal preferences…
              </p>
            ) : preferencesFailed ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-destructive" role="alert">
                  Client portal preferences are unavailable right now.
                </p>
                <Button
                  onClick={() => setWorkspacePreferencesReload((current) => current + 1)}
                  size="sm"
                  variant="outline"
                >
                  Retry
                </Button>
              </div>
            ) : (
            <div aria-busy={preferencesSaving} className="space-y-5">
              <div>
                <label className="text-xs font-medium" htmlFor="workspace-application-visibility">
                  Application-tab visibility · workspace default
                </label>
                <BrandSelect
                  className="mt-2"
                  disabled={durableWorkspace ? preferencesSaving || durablePreferences === null : applicationControlsDisabled}
                  id="workspace-application-visibility"
                  onValueChange={(next) => {
                    const visibility = next as PortalApplicationVisibility;
                    if (durableWorkspace) {
                      void persistWorkspacePreferences("portal_application_visibility", {
                        portal_application_visibility: visibility,
                      });
                    } else {
                      setWorkspaceApplicationPresentation(visibility);
                    }
                  }}
                  options={[
                    { label: "Show bank details and steps", value: "details" },
                    { label: "Show status only", value: "status-only" },
                  ]}
                  value={durablePreferences?.portal.applicationVisibility ?? workspaceApplicationPresentation}
                />
                {/* The fixture shell keeps its historical route-local provider,
                    while a signed-in workspace reads and writes the durable
                    workspace preference above. */}
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {durableWorkspace
                    ? "This workspace default is saved and returned by the portal preference service."
                    : "This default is not stored yet, so the control is disabled."}
                  Per-client overrides live in each client’s Funding tab.
                  Consumers still see no Matches page until the Cinderella
                  profile reaches 100 unless you unlock it per client.
                </p>
              </div>
              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="block text-sm font-medium">
                    Funding-goal progress on the client Overview
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Show the goal meter and funded-to-date amount.
                  </span>
                </span>
                <Switch
                  checked={durablePreferences?.portal.showFundingProgress ?? portalShowProgress}
                  disabled={preferencesSaving}
                  onCheckedChange={(checked) => {
                    if (durableWorkspace) {
                      void persistWorkspacePreferences("portal_show_funding_progress", {
                        portal_show_funding_progress: checked,
                      });
                    } else {
                      setPortalShowProgress(checked);
                    }
                  }}
                />
              </label>
              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="block text-sm font-medium">
                    Client document uploads
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Let clients add files to their onboarding sections.
                  </span>
                </span>
                <Switch
                  checked={durablePreferences?.portal.allowDocumentUploads ?? portalAllowUploads}
                  disabled={preferencesSaving}
                  onCheckedChange={(checked) => {
                    if (durableWorkspace) {
                      void persistWorkspacePreferences("portal_allow_document_uploads", {
                        portal_allow_document_uploads: checked,
                      });
                    } else {
                      setPortalAllowUploads(checked);
                    }
                  }}
                />
              </label>
              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="block text-sm font-medium">
                    Trainings library
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Show your published client-facing trainings.
                  </span>
                </span>
                <Switch
                  checked={durablePreferences?.portal.showTrainings ?? portalShowTrainings}
                  disabled={preferencesSaving}
                  onCheckedChange={(checked) => {
                    if (durableWorkspace) {
                      void persistWorkspacePreferences("portal_show_trainings", {
                        portal_show_trainings: checked,
                      });
                    } else {
                      setPortalShowTrainings(checked);
                    }
                  }}
                />
              </label>
              <p className="text-xs leading-5 text-muted-foreground">
                {durableWorkspace
                  ? "These client portal preferences are saved for this workspace."
                  : "These portal toggles are not stored: they change this page only, and the client portal is unaffected."}
              </p>
            </div>
            )}
          </Panel>
          <Panel title="Notifications">
            {preferencesLoading ? (
              <p className="text-sm text-muted-foreground" role="status">
                Loading saved notification preferences…
              </p>
            ) : preferencesFailed ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-destructive" role="alert">
                  Notification preferences are unavailable right now.
                </p>
                <Button
                  onClick={() => setWorkspacePreferencesReload((current) => current + 1)}
                  size="sm"
                  variant="outline"
                >
                  Retry
                </Button>
              </div>
            ) : (
            <div aria-busy={preferencesSaving} className="space-y-5">
              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="block text-sm font-medium">
                    Held-reply alerts
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Email me when a suggested reply requires human review.
                  </span>
                </span>
                <Switch
                  checked={durablePreferences?.notifications.emailHolds ?? emailHolds}
                  disabled={preferencesSaving}
                  onCheckedChange={(checked) => {
                    if (durableWorkspace) {
                      void persistWorkspacePreferences("notification_email_holds", {
                        notification_email_holds: checked,
                      });
                    } else {
                      setEmailHolds(checked);
                    }
                  }}
                />
              </label>
              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="block text-sm font-medium">
                    Book digest
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Send pipeline and attention totals on a schedule.
                  </span>
                </span>
                <Switch
                  checked={durablePreferences?.notifications.digestEnabled ?? weeklyDigest}
                  disabled={preferencesSaving}
                  onCheckedChange={(checked) => {
                    if (durableWorkspace) {
                      void persistWorkspacePreferences("notification_digest_enabled", {
                        notification_digest_enabled: checked,
                      });
                    } else {
                      setWeeklyDigest(checked);
                    }
                  }}
                />
              </label>
              {(durablePreferences?.notifications.digestEnabled ?? weeklyDigest) ? (
                <label className="flex items-center justify-between gap-4">
                  <span className="text-xs font-medium text-muted-foreground">
                    Digest frequency
                  </span>
                  <BrandSelect
                    ariaLabel="Digest frequency"
                    className="w-auto min-w-40"
                    disabled={preferencesSaving}
                    onValueChange={(next) => {
                      const frequency = next as NotificationDigestFrequency;
                      if (durableWorkspace) {
                        void persistWorkspacePreferences("notification_digest_frequency", {
                          notification_digest_frequency: frequency,
                        });
                      } else {
                        setDigestFrequency(frequency);
                      }
                    }}
                    options={[
                      { label: "Daily", value: "daily" },
                      { label: "Weekly · Monday", value: "weekly" },
                      { label: "Monthly", value: "monthly" },
                    ]}
                    value={durablePreferences?.notifications.digestFrequency ?? digestFrequency}
                  />
                </label>
              ) : null}
              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="block text-sm font-medium">
                    Task due reminders
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Remind assignees the morning a task is due and when it goes
                    overdue.
                  </span>
                </span>
                <Switch
                  checked={durablePreferences?.notifications.taskDue ?? notifyTaskDue}
                  disabled={preferencesSaving}
                  onCheckedChange={(checked) => {
                    if (durableWorkspace) {
                      void persistWorkspacePreferences("notification_task_due", {
                        notification_task_due: checked,
                      });
                    } else {
                      setNotifyTaskDue(checked);
                    }
                  }}
                />
              </label>
              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="block text-sm font-medium">
                    Client plan payment failures
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Alert me when a client’s platform-plan payment fails.
                  </span>
                </span>
                <Switch
                  checked={durablePreferences?.notifications.paymentFailed ?? notifyPaymentFailed}
                  disabled={preferencesSaving}
                  onCheckedChange={(checked) => {
                    if (durableWorkspace) {
                      void persistWorkspacePreferences("notification_payment_failed", {
                        notification_payment_failed: checked,
                      });
                    } else {
                      setNotifyPaymentFailed(checked);
                    }
                  }}
                />
              </label>
              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="block text-sm font-medium">
                    Every client message
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Email each inbound client message, including ones with a suggested response.
                  </span>
                </span>
                <Switch
                  checked={durablePreferences?.notifications.clientMessages ?? notifyClientMessages}
                  disabled={preferencesSaving}
                  onCheckedChange={(checked) => {
                    if (durableWorkspace) {
                      void persistWorkspacePreferences("notification_client_messages", {
                        notification_client_messages: checked,
                      });
                    } else {
                      setNotifyClientMessages(checked);
                    }
                  }}
                />
              </label>
              <p className="text-xs leading-5 text-muted-foreground">
                {durableWorkspace
                  ? "These preferences are saved. Email delivery is not connected, so enabling an email preference does not send email yet."
                  : "No email or messaging service is connected, and these preferences are not stored."}
              </p>
            </div>
            )}
          </Panel>
          {/* The subscription panel.
              Nothing on this surface reads an organization's billing state:
              `OPERATOR_FIXTURES["op-apex"]` is where the Agency plan, the
              $497/mo, the 214 active clients and the five included seats all
              came from, and every one of them rendered as this workspace's
              own. `/api/billing/subscription` exists and could source a real
              version of this panel; wiring it is a change beyond removing the
              fabrication, so a signed-in workspace gets the honest absence.
              The renewal date, the card, and the three paid invoices are gone
              in both paths — a payment record is not something to invent. */}
          {durableWorkspace ? (
            <Panel title="Plan &amp; billing">
              <p className="text-sm text-muted-foreground" role="status">
                This workspace&rsquo;s plan, seat allowance, and billing history
                are not readable from this screen, so none of them are shown.
              </p>
            </Panel>
          ) : (
          <Panel
            title={`${operator.plan} plan · ${formatDemoMoney(operator.platformFee)}/mo`}
            trailing={<StatusPill tone="success">Current</StatusPill>}
          >
            <div className="space-y-4 text-sm">
              <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                Illustrative placeholder: $497 base + $29 per additional seat, pending the pricing session.
              </p>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Active clients</span>
                <span className="font-medium tabular-nums">
                  {operator.clientCount}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Seats</span>
                <span className="font-medium tabular-nums">
                  {teamRows.length} used · {operator.includedSeats} included
                </span>
              </div>
              <div className="rounded-lg border border-border">
                <div className="flex justify-between gap-4 px-4 py-3">
                  <span className="text-muted-foreground">
                    {operator.plan} base plan
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatDemoMoney(operator.platformFee)}
                  </span>
                </div>
                <div className="flex justify-between gap-4 border-t border-border px-4 py-3">
                  <span className="text-muted-foreground">
                    Additional seats · {additionalSeats} ×{" "}
                    {formatDemoMoney(29)}
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatDemoMoney(additionalSeatFee)}
                  </span>
                </div>
                <div className="flex justify-between gap-4 border-t border-border bg-muted/40 px-4 py-3">
                  <span className="font-semibold">Monthly total</span>
                  <span className="font-semibold tabular-nums">
                    {formatDemoMoney(operator.platformFee + additionalSeatFee)}
                    /mo
                  </span>
                </div>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Included
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusPill>White-label client portal</StatusPill>
                  <StatusPill>Team chat suggestions</StatusPill>
                  <StatusPill>Bank Vault</StatusPill>
                  <StatusPill>Monitoring included</StatusPill>
                </div>
              </div>
              <Button
                disabled
                onClick={() =>
                  setSettingsNotice(
                    "Invoice detail is not available. No payment action was taken.",
                  )
                }
                variant="outline"
              >
                <FileText aria-hidden /> View invoices
              </Button>
            </div>
          </Panel>
          )}
          <Panel
            description="Definition pending the billing working session."
            title="Credits · TBD"
          >
            <p className="text-sm leading-6 text-muted-foreground">
              No allowance, prepaid balance, or usage meaning is assigned in this
              demo.
            </p>
          </Panel>
        </div>
        {settingsNotice ? (
          <div
            className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary-ink"
            role="status"
          >
            {settingsNotice}
          </div>
        ) : null}
      </div>
    );
  }

  function renderWorkspaceSetup() {
    const accessLoading = durableWorkspace
      && (workspaceAccessState === "idle" || workspaceAccessState === "loading");
    const accessHasConfirmedValues = !durableWorkspace || workspaceAccessConfirmed !== null;
    const accessControlsDisabled = durableWorkspace
      && (workspaceAccessState !== "ready" || workspaceAccessSaving !== null);
    return (
      <div className="space-y-5">
        <CompactHeader
          description={durableWorkspace
            ? "Configure enrollment, branding, access, and assignment defaults. Brand setup saves and publishes the portal theme and logo, client invitations use the governed invite flow, and access settings are saved to this workspace."
            : "Configure enrollment, branding, access, and assignment defaults in this fixture workspace. Changes last for this visit only."}
          icon={UserPlus}
          title="Workspace Setup"
        />
        <Segmented
          onChange={setWorkspaceSetupTab}
          options={[
            { label: "Setup", value: "setup" },
            { label: "Brand Studio", value: "brand" },
            { label: "Access & assignment", value: "access" },
          ]}
          value={workspaceSetupTab}
        />
        {workspaceSetupTab === "setup" ? (
          <OperatorOnboarding
            brandLabel={workspaceBrandName}
            embedded
            initialBrand={liveTenantBrand}
            initialBusinessName={liveWorkspaceName}
            onComplete={(setup) => {
              setLiveTenantBrand(setup.brand);
              setLiveWorkspaceName(setup.businessName);
              setBrandPublished(true);
              setBrandPublishedAt(null);
              setSettingsNotice(durableWorkspace
                ? setup.inviteEmail
                  ? `Brand saved and published. Client invitation sent to ${setup.inviteEmail}. Access and assignment defaults remain editable in their own tab.`
                  : "Brand saved and published. No client invitation was entered. Access and assignment defaults remain editable in their own tab."
                : "Workspace setup recorded for this fixture visit.");
            }}
            onExit={() => setView("home")}
            onInviteClient={(email) =>
              setSettingsNotice(
                `Invitation sent to ${email} through the governed client invite flow. The client record will be created after acceptance.`,
              )
            }
          />
        ) : null}
        {workspaceSetupTab === "brand" ? renderBrand() : null}
        {workspaceSetupTab === "access" ? (
          <div className="space-y-4">
            {accessLoading ? (
              <p className="text-sm text-muted-foreground" role="status">
                Loading saved access and assignment settings…
              </p>
            ) : null}
            {workspaceAccessSaving !== null ? (
              <p className="text-sm text-muted-foreground" role="status">
                Saving access and assignment settings…
              </p>
            ) : null}
            {workspaceAccessFeedback ? (
              <div
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm",
                  workspaceAccessFeedback.kind === "error"
                    ? "border-destructive/30 bg-destructive/5 text-destructive"
                    : "border-primary/20 bg-primary/5 text-primary-ink",
                )}
                role={workspaceAccessFeedback.kind === "error" ? "alert" : "status"}
              >
                <span>{workspaceAccessFeedback.message}</span>
                {workspaceAccessFeedback.kind === "error" ? (
                  <Button
                    onClick={() => setWorkspaceAccessReload((current) => current + 1)}
                    size="sm"
                    variant="outline"
                  >
                    Retry
                  </Button>
                ) : null}
              </div>
            ) : null}
            {accessHasConfirmedValues ? (
              <div aria-busy={accessLoading || workspaceAccessSaving !== null} className="grid gap-5 xl:grid-cols-2">
                <Panel
                  description={durableWorkspace
                    ? "Saved for this workspace and enforced by the backend."
                    : "This fixture control changes the current page only."}
                  title="Client access"
                >
                  <label className="flex items-start justify-between gap-4">
                    <span>
                      <span className="block text-sm font-medium">
                        Team sees all clients
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        Turn this off to limit team views to assigned clients.
                      </span>
                    </span>
                    <Switch
                      checked={teamSeesAllClients}
                      disabled={accessControlsDisabled}
                      onCheckedChange={(checked) => {
                        if (durableWorkspace) {
                          void persistWorkspaceAccess("team_sees_all_clients", {
                            assignmentMode: clientAssignmentMode,
                            teamSeesAllClients: checked,
                          }).then((saved) => {
                            if (saved) inbox.setReplyDraft("");
                          });
                        } else {
                          setTeamSeesAllClients(checked);
                          // Changing the access scope can filter away the conversation the
                          // half-written reply belongs to, so its local fixture draft goes too.
                          inbox.setReplyDraft("");
                        }
                      }}
                    />
                  </label>
                </Panel>
                <Panel
                  description={durableWorkspace
                    ? "Choose and save the workspace default for newly added clients."
                    : "Choose how newly added fixture clients enter this visit."}
                  title="Client assignment"
                >
                  <Segmented
                    disabled={accessControlsDisabled}
                    onChange={(mode) => {
                      if (durableWorkspace) {
                        void persistWorkspaceAccess("assignment_mode", {
                          assignmentMode: mode,
                          teamSeesAllClients,
                        });
                      } else {
                        setClientAssignmentMode(mode);
                      }
                    }}
                    options={[
                      { label: "Round robin", value: "round-robin" },
                      { label: "Manual", value: "manual" },
                    ]}
                    value={clientAssignmentMode}
                  />
                  <p className="mt-4 text-sm leading-6 text-muted-foreground">
                    {durableWorkspace
                      ? clientAssignmentMode === "round-robin"
                        ? "Round robin is the saved workspace assignment default."
                        : "Manual assignment is the saved workspace default."
                      : clientAssignmentMode === "round-robin"
                        ? "New clients are queued for round-robin assignment in this fixture."
                        : "New clients stay unassigned in this fixture."}
                  </p>
                </Panel>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function renderCurrentView() {
    if (view === "home") return renderHome();
    if (view === "clients") return renderClients();
    if (view === "bank-vault") return renderBankVault();
    if (view === "knowledge") return renderKnowledge();
    if (view === "tasks") return renderTasks();
    if (view === "inbox")
      return (
        <OperatorInbox
          clients={clients.map((client) => ({
            business: client.business,
            clientId: client.clientId,
            name: client.name,
            ownerId: getClientOwnerId(client),
            // The fixture body gets the same stage chip and Details rail the durable body reads
            // off `/api/clients`, rather than the two halves of one view disagreeing about how
            // much they can say about a client.
            stage: client.stage,
          }))}
          durableWorkspace={durableWorkspace}
          inbox={inbox}
          onOpenClient={openClient}
          teamMembers={teamRows}
          teamSeesAllClients={teamSeesAllClients}
          timelineEnabled={false}
          workspaceBrandName={workspaceBrandName}
        />
      );
    if (view === "team") return renderTeam();
    if (view === "onboarding") return renderWorkspaceSetup();
    return renderSettings();
  }

  const drawerSteps = selectedClient
    ? [
        ...selectedClient.plan,
        ...(addedSteps[selectedClient.clientId] ?? []).map((title) => ({
          state: "proposed" as const,
          title,
        })),
      ]
    : [];
  const editingFixtureFee = !durableWorkspace && editingFeeClient
    ? feeRows.find((fee) => fee.clientId === editingFeeClient.clientId) ?? null
    : null;

  const shell = (
    <DemoShell
      activeView={view}
      brand={workspaceBrandName}
      currentRole="operator"
      eyebrow="Operator Console"
      footer={
        <div className="mx-3 rounded-lg border border-sidebar-border bg-background/70 p-3 text-left">
          <span className="block text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Powered by MostFundable
          </span>
          <span className="mt-1 block text-[0.7rem] leading-5 text-sidebar-foreground">
            Platform logic, bank history, and guardrails are managed centrally.
          </span>
        </div>
      }
      initials={sessionIdentity ? displayInitials(sessionIdentity.name) : (durableWorkspace ? "" : "AR")}
      onNavigate={(next) => setView(next as View)}
      onOpenProfiles={onOpenProfiles}
      profileName={sessionIdentity?.name ?? (durableWorkspace ? "Signed-in operator" : "Alec Rivera")}
      roleLabel={sessionIdentity ? displayRoleLine(sessionIdentity) : (durableWorkspace ? "Operator" : "Owner · Apex Funding Partners")}
      sections={navSections}
      theme="workspace"
    >
      <div className="mb-5 flex justify-end">
        <CommandPalette
          actions={commandActions}
          onNavigate={(pageId) => setView(pageId as View)}
          pages={commandPages}
          records={commandRecords}
          triggerLabel="Search pages, records, and actions"
        />
      </div>
      {renderCurrentView()}

      <ScopedAssistantCompanion scope="operator" view={view} viewerName={sessionIdentity?.name ?? null} />

      <Button
        aria-label="Open Platform support"
        className={cn(ASSISTANT_LAUNCHER_ADJACENT_CLASS, "min-h-12 rounded-full px-4 shadow-[0_8px_24px_color-mix(in_srgb,var(--consumer-brand-tile),transparent_76%)]")}
        onClick={() => setSupportBubbleOpen(true)}
      >
        <LifeBuoy aria-hidden /> Platform support
      </Button>

      <Sheet onOpenChange={setSupportBubbleOpen} open={supportBubbleOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-3xl" side="right">
          <SheetHeader className="border-b border-border px-5 py-4 pr-14">
            <SheetTitle>Support</SheetTitle>
            <SheetDescription>
              A suggestion stays inside its current composer and is only ever sent when you press send.
            </SheetDescription>
          </SheetHeader>
          {supportState === "ready" ? (
            <SupportBubblePanel />
          ) : supportState === "disabled" ? (
            <div className="p-5">{renderPlatformSupport()}</div>
          ) : (
            <div className="p-5 text-sm text-muted-foreground">
              {supportState === "loading"
                ? "Loading support…"
                : "Support is unavailable right now. No message can be submitted until it reconnects."}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet
        onOpenChange={(open) => {
          if (!open) setSelectedClientId(null);
        }}
        open={Boolean(selectedClient)}
      >
        <SheetContent
          className="w-full gap-0 p-0"
          side="right"
          style={{ maxWidth: `min(92vw, ${drawerWidth}px)` }}
        >
          {selectedClient ? (
            <>
              <div
                aria-label="Drag to resize the client panel"
                className="absolute inset-y-0 left-0 z-10 hidden w-2 cursor-col-resize touch-none hover:bg-primary/20 sm:block"
                onPointerDown={(event) => {
                  drawerResizeState.current = {
                    startWidth: drawerWidth,
                    startX: event.clientX,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const resize = drawerResizeState.current;
                  if (!resize) return;
                  const next = Math.min(
                    Math.round(window.innerWidth * 0.92),
                    Math.max(420, resize.startWidth + (resize.startX - event.clientX)),
                  );
                  setDrawerWidth(next);
                }}
                onPointerUp={(event) => {
                  drawerResizeState.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                role="separator"
              />
              <SheetHeader className="border-b border-border px-5 py-4 pr-14">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold">
                    {initials(selectedClient.name)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SheetTitle>{selectedClient.name}</SheetTitle>
                      <StatusPill tone={healthTone(selectedClient.health)}>
                        {selectedClient.health}
                      </StatusPill>
                      {selectedEnrollment?.status === "parked" && selectedEnrollment.parkedUntil ? (
                        <StatusPill tone="warning">
                          Parked · retry opens {formatDate(selectedEnrollment.parkedUntil.slice(0, 10))}
                        </StatusPill>
                      ) : null}
                    </div>
                    <SheetDescription>
                      {selectedClient.business} · {selectedClient.stage}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="overflow-x-auto border-b border-border px-4">
                <Segmented
                  onChange={setDrawerTab}
                  options={[
                    { label: "Overview", value: "overview" },
                    { label: "Credit & Plan", value: "plan" },
                    { label: "Funding", value: "funding" },
                    { label: "Fees", value: "fees" },
                    { label: "Activity", value: "activity" },
                  ]}
                  value={drawerTab}
                />
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                {drawerTab === "overview" ? (
                  <div className="space-y-5">
                    <ClientProgress
                      client={selectedClient}
                      fundedAmount={getClientFundedAmount(
                        selectedClient.clientId,
                      )}
                      goal={getGoal(selectedClient)}
                    />
                    <Panel title="Client profile">
                      <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
                        <dt className="text-muted-foreground">Business</dt>
                        <dd>{selectedClient.business}</dd>
                        <dt className="text-muted-foreground">Funding goal</dt>
                        <dd>
                          <div className="flex flex-wrap items-center gap-2">
                            <Input
                              aria-label={`Funding goal for ${selectedClient.name}`}
                              className="w-40 tabular-nums"
                              min="0"
                              onChange={(event) =>
                                setGoalOverrides((current) => ({
                                  ...current,
                                  [selectedClient.clientId]: parseMoney(
                                    event.target.value,
                                  ),
                                }))
                              }
                              step="0.01"
                              type="number"
                              value={goalOverrides[selectedClient.clientId] ?? ""}
                            />
                            <Button
                              onClick={() =>
                                setGoalOverrides((current) => {
                                  const next = { ...current };
                                  delete next[selectedClient.clientId];
                                  return next;
                                })
                              }
                              size="sm"
                              variant="ghost"
                            >
                              Clear goal
                            </Button>
                          </div>
                        </dd>
                        <dt className="text-muted-foreground">Started</dt>
                        <dd>{formatDate(selectedClient.startedAt)}</dd>
                        <dt className="text-muted-foreground">Team member</dt>
                        <dd>
                          {teamRows.find(
                            (member) =>
                              member.id === getClientOwnerId(selectedClient),
                          )?.name ?? "Unassigned"}
                        </dd>
                      </dl>
                    </Panel>
                    <Panel title="Current decision">
                      <p className="text-sm leading-6">{selectedClient.next}</p>
                    </Panel>
                  </div>
                ) : null}

                {drawerTab === "plan" ? (
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-muted/50 p-4">
                        <p className="text-xs text-muted-foreground">
                          Cinderella profile
                        </p>
                        <p className="mt-1 text-xl font-semibold tabular-nums">
                          {selectedClient.profileCompletion} / 100
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-4">
                        <p className="text-xs text-muted-foreground">
                          Utilization
                        </p>
                        <p className="mt-1 text-xl font-semibold tabular-nums">
                          {selectedClient.utilization}
                        </p>
                      </div>
                    </div>
                    <Panel
                      title="Action checklist"
                      trailing={
                        <Button
                          onClick={() =>
                            setAddedSteps((current) => ({
                              ...current,
                              [selectedClient.clientId]: [
                                ...(current[selectedClient.clientId] ?? []),
                                "New operator-authored plan action",
                              ],
                            }))
                          }
                          size="sm"
                          variant="ghost"
                        >
                          <Plus aria-hidden /> Add action
                        </Button>
                      }
                    >
                      <div className="space-y-4">
                        {drawerSteps.map((step, index) => {
                          const key = `${selectedClient.clientId}-${index}`;
                          const approved = approvedSteps.has(key);
                          return (
                            <div className="flex items-start gap-3" key={key}>
                              <StatusPill
                                tone={approved ? "success" : stepTone(step.state)}
                              >
                                {approved ? "approved" : step.state}
                              </StatusPill>
                              <p className="min-w-0 flex-1 text-sm leading-5">
                                {step.title}
                              </p>
                              {step.state === "proposed" && !approved ? (
                                <Button
                                  onClick={() =>
                                    toggleSet(setApprovedSteps, key)
                                  }
                                  size="sm"
                                >
                                  Approve
                                </Button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </Panel>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Suggested actions remain internal until an operator
                      approves them.
                    </p>
                  </div>
                ) : null}

                {drawerTab === "funding" ? (
                  <div className="space-y-5">
                    {/* Shown in both rail states, which is the correction: this
                        used to appear only while `applicationWritesDurable` was
                        true, so with the rail off the controls looked live and
                        the disclosure was hidden — exactly backwards. */}
                    <p
                      className="text-xs leading-5 text-muted-foreground"
                      role="status"
                    >
                      {applicationWritesDurable
                        ? "Application records for this client are not stored, so the controls below are disabled."
                        : "Application records are not connected, so nothing entered below is stored and the controls are disabled."}
                    </p>
                    <Panel title="Consumer application-tab visibility">
                      <label
                        className="text-xs font-medium"
                        htmlFor="client-application-visibility"
                      >
                        Per-client setting
                      </label>
                      <BrandSelect
                        className="mt-2"
                        disabled={applicationControlsDisabled}
                        id="client-application-visibility"
                        onValueChange={(next) =>
                          setClientApplicationPresentation(
                            selectedClient.clientId,
                            next as ApplicationPresentationOverride,
                          )
                        }
                        options={[
                          {
                            label: `Use workspace default · ${
                              workspaceApplicationPresentation === "details"
                                ? "details and steps"
                                : "status only"
                            }`,
                            value: "inherit",
                          },
                          {
                            label: "Show details and steps",
                            value: "details",
                          },
                          { label: "Show status only", value: "status-only" },
                        ]}
                        value={
                          clientApplicationPresentation[
                            selectedClient.clientId
                          ] ?? "inherit"
                        }
                      />
                      <p className="mt-3 text-xs text-muted-foreground">
                        Resolved presentation:{" "}
                        {resolveApplicationPresentation(
                          selectedClient.clientId,
                        ) === "details"
                          ? "bank details and steps"
                          : "status only"}
                      </p>
                    </Panel>

                    {(selectedClient.profileCompletion >=
                      READY_PROFILE_COMPLETION ||
                      matchesUnlocked[selectedClient.clientId]) &&
                    onPreviewConsumerApplications ? (
                      <Panel
                        description={`Open ${selectedClient.name}’s application tracker as the client sees it in ${selectedClient.stage}, without changing the Cinderella profile.`}
                        title="Consumer portal preview"
                      >
                        <Button
                          onClick={() => {
                            setSelectedClientId(null);
                            onPreviewConsumerApplications(
                              selectedClient.clientId,
                            );
                          }}
                          variant="outline"
                        >
                          Preview consumer applications
                          <ArrowUpRight aria-hidden />
                        </Button>
                      </Panel>
                    ) : null}

                    {selectedClient.profileCompletion <
                    READY_PROFILE_COMPLETION ? (
                      <Panel
                        description={
                          matchesUnlocked[selectedClient.clientId]
                            ? "You unlocked the consumer Matches page early. The client sees the application sequence with an unlocked-by-your-team label."
                            : `By default the consumer Matches page stays hidden until the profile reaches ${READY_PROFILE_COMPLETION}. You can unlock it early for this client.`
                        }
                        title={
                          matchesUnlocked[selectedClient.clientId]
                            ? "Consumer view unlocked early"
                            : "Consumer view locked"
                        }
                      >
                        <div className="space-y-4">
                          <ReadinessBar
                            label="Cinderella profile"
                            value={selectedClient.profileCompletion}
                          />
                          <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                            <span>
                              <span className="block text-sm font-medium">
                                Unlock Matches for this client
                              </span>
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                Operator override · applies to this demo
                                session only
                              </span>
                            </span>
                            <Switch
                              checked={
                                matchesUnlocked[selectedClient.clientId] ??
                                false
                              }
                              onCheckedChange={(checked) =>
                                setMatchesUnlocked(
                                  selectedClient.clientId,
                                  checked,
                                )
                              }
                            />
                          </label>
                        </div>
                      </Panel>
                    ) : null}

                    {selectedClientApplications.length ? (
                      selectedClientApplications.map((application) => {
                        const outcomeDraft =
                          applicationOutcomeDrafts[application.id] ?? {
                            amount:
                              application.approvedAmount?.toString() ?? "",
                            outcome: application.outcome ?? "pending",
                          };
                        const noteDraft =
                          applicationNoteDrafts[application.id] ?? "";
                        return (
                          <Panel
                            key={application.id}
                            title={`${application.sequence}. ${application.bankName} · ${application.product}`}
                            trailing={
                              application.outcome ? (
                                <StatusPill
                                  tone={
                                    application.outcome === "approved"
                                      ? "success"
                                      : application.outcome === "denied"
                                        ? "danger"
                                        : "warning"
                                  }
                                >
                                  {titleCase(application.outcome)}
                                  {application.approvedAmount
                                    ? ` · ${formatDemoMoney(application.approvedAmount)}`
                                    : ""}
                                </StatusPill>
                              ) : (
                                <StatusPill>
                                  {application.operatorStatus === "wait"
                                    ? "WAIT"
                                    : application.operatorStatus === "done"
                                      ? "DONE"
                                      : "TO DO"}
                                </StatusPill>
                              )
                            }
                          >
                            <div className="space-y-5">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <span className="block text-xs font-medium">
                                  Operator status
                                  <BrandSelect
                                    ariaLabel={`Operator status for ${application.bankName}`}
                                    className="mt-2"
                                    disabled={applicationControlsDisabled}
                                    onValueChange={(next) =>
                                      setOperatorApplicationStatus(
                                        application.id,
                                        next as ApplicationOperatorStatus,
                                      )
                                    }
                                    options={[
                                      { label: "WAIT", value: "wait" },
                                      { label: "TO DO", value: "to-do" },
                                      { label: "DONE", value: "done" },
                                    ]}
                                    value={application.operatorStatus}
                                  />
                                </span>
                                <div>
                                  <p className="text-xs font-medium">
                                    Criteria
                                  </p>
                                  <p className="mt-2 text-sm">
                                    {application.criteriaSummary}
                                  </p>
                                </div>
                              </div>
                              <div>
                                <p className="text-xs font-medium">
                                  Application steps
                                </p>
                                <ol className="mt-3 space-y-2">
                                  {application.applicationProcess.map(
                                    (step, index) => (
                                      <li
                                        className="flex gap-3 text-sm"
                                        key={step}
                                      >
                                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[0.68rem] font-semibold">
                                          {index + 1}
                                        </span>
                                        <span className="pt-0.5">{step}</span>
                                      </li>
                                    ),
                                  )}
                                </ol>
                              </div>
                              <div className="rounded-lg border border-border bg-muted/25 p-4">
                                <p className="text-xs font-semibold">
                                  Record outcome
                                </p>
                                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                                  <BrandSelect
                                    ariaLabel={`Outcome for ${application.bankName}`}
                                    disabled={applicationControlsDisabled}
                                    onValueChange={(next) =>
                                      setApplicationOutcomeDrafts((current) => ({
                                        ...current,
                                        [application.id]: {
                                          ...outcomeDraft,
                                          outcome: next as ApplicationOutcome,
                                        },
                                      }))
                                    }
                                    options={[
                                      { label: "APPROVED", value: "approved" },
                                      { label: "PENDING", value: "pending" },
                                      { label: "DENIED", value: "denied" },
                                    ]}
                                    value={outcomeDraft.outcome}
                                  />
                                  <Input
                                    aria-label={`Approved amount for ${application.bankName}`}
                                    disabled={
                                      applicationControlsDisabled
                                      || outcomeDraft.outcome !== "approved"
                                    }
                                    min="0"
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      if (!/^\d*(\.\d{0,2})?$/.test(value)) {
                                        return;
                                      }
                                      setApplicationOutcomeDrafts((current) => ({
                                        ...current,
                                        [application.id]: {
                                          ...outcomeDraft,
                                          amount: value,
                                        },
                                      }));
                                    }}
                                    placeholder="Approved amount"
                                    className="tabular-nums"
                                    step="0.01"
                                    type="number"
                                    value={outcomeDraft.amount}
                                  />
                                  <Button
                                    disabled={
                                      applicationControlsDisabled ||
                                      (outcomeDraft.outcome === "approved" &&
                                        (!/^\d+(\.\d{1,2})?$/.test(
                                          outcomeDraft.amount,
                                        ) ||
                                          !(Number(outcomeDraft.amount) > 0)))
                                    }
                                    onClick={() =>
                                      recordApplicationOutcome({
                                        actor: "operator",
                                        amount:
                                          outcomeDraft.outcome === "approved"
                                            ? parseMoney(outcomeDraft.amount)
                                            : null,
                                        applicationId: application.id,
                                        outcome: outcomeDraft.outcome,
                                      })
                                    }
                                  >
                                    Save result
                                  </Button>
                                </div>
                                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                  Recording an outcome here changes nothing
                                  outside this page.
                                </p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold">
                                  Shared notes
                                </p>
                                <div className="mt-3 space-y-2">
                                  {application.notes.map((note) => (
                                    <div
                                      className="rounded-lg border border-border p-3"
                                      key={note.id}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold">
                                          {note.authorName}
                                        </span>
                                        <StatusPill>{note.authorRole}</StatusPill>
                                        <span className="ml-auto text-[0.68rem] text-muted-foreground">
                                          {note.createdAt}
                                        </span>
                                      </div>
                                      <p className="mt-2 text-sm leading-6">
                                        {note.body}
                                      </p>
                                    </div>
                                  ))}
                                  {application.notes.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">
                                      No shared notes yet.
                                    </p>
                                  ) : null}
                                </div>
                                <div className="mt-3 flex gap-2">
                                  <Input
                                    aria-label={`Shared note for ${application.bankName}`}
                                    className="flex-1"
                                    disabled={applicationControlsDisabled}
                                    onChange={(event) =>
                                      setApplicationNoteDrafts((current) => ({
                                        ...current,
                                        [application.id]: event.target.value,
                                      }))
                                    }
                                    placeholder="Add a note visible to the client"
                                    value={noteDraft}
                                  />
                                  <Button
                                    disabled={
                                      applicationControlsDisabled
                                      || !noteDraft.trim()
                                    }
                                    onClick={() => {
                                      addApplicationNote({
                                        applicationId: application.id,
                                        // Whoever is signed in, never the
                                        // fixture owner's name over a real
                                        // person's words.
                                        authorName:
                                          sessionIdentity?.name ?? "Alec Rivera",
                                        authorRole: "operator",
                                        body: noteDraft,
                                      });
                                      setApplicationNoteDrafts((current) => ({
                                        ...current,
                                        [application.id]: "",
                                      }));
                                    }}
                                  >
                                    Add note
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </Panel>
                        );
                      })
                    ) : (
                      <EmptyState
                        description="No bank sequence is prepared for this client."
                        title="No applications yet"
                      />
                    )}
                  </div>
                ) : null}

                {drawerTab === "fees" ? (
                  <Panel title="Client fee">
                    {(() => {
                      const fee = currentFeeRows.find(
                        (row) => row.clientId === selectedClient.clientId,
                      ) ?? {
                        clientId: selectedClient.clientId,
                        model: "unconfigured" as const,
                        paid: 0,
                        totalFee: 0,
                      };
                      const balance = Math.max(0, fee.totalFee - fee.paid);
                      return (
                        <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
                          <dt className="text-muted-foreground">Model</dt>
                          <dd>{fee.model}</dd>
                          <dt className="text-muted-foreground">Funded</dt>
                          <dd>
                            {formatDemoMoney(
                              getClientFundedAmount(selectedClient.clientId),
                            )}
                          </dd>
                          <dt className="text-muted-foreground">Total fee</dt>
                          <dd className="font-semibold tabular-nums">
                            {formatDemoMoney(fee.totalFee)}
                          </dd>
                          <dt className="text-muted-foreground">Paid</dt>
                          <dd className="tabular-nums">
                            {formatDemoMoney(fee.paid)}
                          </dd>
                          <dt className="text-muted-foreground">Balance</dt>
                          <dd className="font-semibold tabular-nums">
                            {formatDemoMoney(balance)}
                          </dd>
                        </dl>
                      );
                    })()}
                    <p className="mt-5 text-xs leading-5 text-muted-foreground">
                      Tracking only. No invoice, charge, or transfer is created.
                    </p>
                  </Panel>
                ) : null}

                {drawerTab === "activity" ? (
                  <Panel title="Activity log">
                    <div className="space-y-4">
                      {selectedClient.activity.map(([date, event]) => (
                        <div
                          className="grid gap-1 text-sm sm:grid-cols-[5rem_1fr]"
                          key={`${date}-${event}`}
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {date}
                          </span>
                          <span>{event}</span>
                        </div>
                      ))}
                    </div>
                  </Panel>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Durable tracker client peek, sourced from the tracker row instead of
          the fixture book. It is a second sheet rather than a branch inside the
          one above because the two share no field: everything the fixture
          drawer renders — plan steps, fee rows, application history — is a
          literal, and a real client must never pick one up. */}
      <Sheet
        onOpenChange={(open) => {
          if (!open) {
            setSelectedTrackerClientId(null);
            setTrackerEditDraft(null);
          }
        }}
        open={Boolean(selectedTrackerClient)}
      >
        <SheetContent
          className="w-full gap-0 p-0"
          side="right"
          style={{ maxWidth: `min(92vw, ${drawerWidth}px)` }}
        >
          {selectedTrackerClient ? (
            <>
              <SheetHeader className="border-b border-border px-5 py-4 pr-14">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold">
                    {initials(selectedTrackerClient.displayName)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SheetTitle>
                        {selectedTrackerClient.displayName}
                      </SheetTitle>
                      {trackerClients.consoleOpsEnabled ? (
                        <StatusPill
                          tone={trackerHealthTone(selectedTrackerClient.health)}
                        >
                          {selectedTrackerClient.health}
                        </StatusPill>
                      ) : null}
                      <StatusPill
                        tone={selectedTrackerClient.status === "archived" ? "neutral" : "success"}
                      >
                        {selectedTrackerClient.status}
                      </StatusPill>
                    </div>
                    <SheetDescription>
                      {selectedTrackerClient.businessName
                        ? `${selectedTrackerClient.businessName} · `
                        : ""}
                      {TRACKER_STAGE_LABELS[selectedTrackerClient.stage]}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="overflow-x-auto border-b border-border px-4">
                <Segmented
                  onChange={setTrackerDrawerTab}
                  options={[
                    { label: "Overview", value: "overview" },
                    { label: "Credit & Plan", value: "plan" },
                    { label: "Funding", value: "funding" },
                    { label: "Fees", value: "fees" },
                    { label: "Notes", value: "notes" },
                    { label: "Activity", value: "activity" },
                  ]}
                  value={trackerDrawerTab}
                />
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                {trackerDrawerTab === "overview" ? (
                  <div className="space-y-5">
                    <Panel
                      description={
                        selectedTrackerClient.status === "archived"
                          ? "Reactivate this client before editing their record or assignment."
                          : "Names, business details, and team ownership are saved to this workspace."
                      }
                      title="Client management"
                      trailing={
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button
                            disabled={
                              selectedTrackerClient.status !== "active"
                              || trackerMutationPending !== null
                            }
                            onClick={() => {
                              setTrackerMutationFeedback(null);
                              setTrackerEditDraft({
                                assignedToId: selectedTrackerClient.assignedToId,
                                businessName: selectedTrackerClient.businessName ?? "",
                                displayName: selectedTrackerClient.displayName,
                                id: selectedTrackerClient.id,
                                originalAssignedToId: selectedTrackerClient.assignedToId,
                              });
                            }}
                            size="sm"
                            variant="outline"
                          >
                            <Pencil aria-hidden /> Edit client
                          </Button>
                          <Button
                            disabled={
                              !trackerClients.consoleOpsEnabled
                              || trackerMutationPending !== null
                            }
                            onClick={() => {
                              setTrackerMutationFeedback(null);
                              setTrackerStatusCandidate({
                                id: selectedTrackerClient.id,
                                name: selectedTrackerClient.displayName,
                                status: selectedTrackerClient.status === "active"
                                  ? "archived"
                                  : "active",
                              });
                            }}
                            size="sm"
                            variant={
                              selectedTrackerClient.status === "active"
                                ? "destructive"
                                : "outline"
                            }
                          >
                            {selectedTrackerClient.status === "active" ? (
                              <Archive aria-hidden />
                            ) : (
                              <RotateCcw aria-hidden />
                            )}
                            {selectedTrackerClient.status === "active" ? "Archive" : "Reactivate"}
                          </Button>
                        </div>
                      }
                    >
                      {trackerEditDraft?.id === selectedTrackerClient.id ? (
                        <div className="space-y-4">
                          <label className="block space-y-2 text-sm font-medium">
                            Client name
                            <Input
                              disabled={trackerMutationPending !== null}
                              maxLength={160}
                              onChange={(event) => {
                                setTrackerEditDraft((current) => current?.id === selectedTrackerClient.id
                                  ? { ...current, displayName: event.target.value }
                                  : current);
                              }}
                              value={trackerEditDraft.displayName}
                            />
                          </label>
                          <label className="block space-y-2 text-sm font-medium">
                            Business name
                            <Input
                              disabled={trackerMutationPending !== null}
                              maxLength={160}
                              onChange={(event) => {
                                setTrackerEditDraft((current) => current?.id === selectedTrackerClient.id
                                  ? { ...current, businessName: event.target.value }
                                  : current);
                              }}
                              placeholder="No business name"
                              value={trackerEditDraft.businessName}
                            />
                          </label>
                          <div className="space-y-2">
                            <span className="block text-sm font-medium">Team member</span>
                            <BrandSelect
                              ariaLabel="Assign client to team member"
                              className="w-full"
                              disabled={trackerMutationPending !== null}
                              onValueChange={(value) => {
                                setTrackerEditDraft((current) => current?.id === selectedTrackerClient.id
                                  ? {
                                      ...current,
                                      assignedToId: value === "unassigned" ? null : value,
                                    }
                                  : current);
                              }}
                              options={[
                                { label: "Unassigned", value: "unassigned" },
                                ...trackerClients.assignableMembers.map((member) => ({
                                  label: member.isCurrentUser
                                    ? `${member.fullName} (you)`
                                    : member.fullName,
                                  value: member.id,
                                })),
                                ...(trackerEditDraft.assignedToId !== null
                                  && !trackerClients.assignableMembers.some(
                                    (member) => member.id === trackerEditDraft.assignedToId,
                                  )
                                  ? [{
                                      label: `${selectedTrackerClient.assignedToName ?? "Previous team member"} (unavailable)`,
                                      value: trackerEditDraft.assignedToId,
                                    }]
                                  : []),
                              ]}
                              value={trackerEditDraft.assignedToId ?? "unassigned"}
                            />
                          </div>
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              disabled={trackerMutationPending !== null}
                              onClick={() => setTrackerEditDraft(null)}
                              variant="outline"
                            >
                              Cancel
                            </Button>
                            <Button
                              disabled={
                                !trackerEditDraft.displayName.trim()
                                || trackerMutationPending !== null
                              }
                              onClick={() => void saveTrackerClientEdit()}
                            >
                              {trackerMutationPending === `edit:${selectedTrackerClient.id}`
                                ? "Saving…"
                                : "Save client"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <dl className="grid gap-3 text-sm sm:grid-cols-[9rem_1fr]">
                          <dt className="text-muted-foreground">Business</dt>
                          <dd>{selectedTrackerClient.businessName ?? "Not recorded"}</dd>
                          <dt className="text-muted-foreground">Team member</dt>
                          <dd>{selectedTrackerClient.assignedToName ?? "Unassigned"}</dd>
                          <dt className="text-muted-foreground">Lifecycle</dt>
                          <dd className="capitalize">{selectedTrackerClient.status}</dd>
                        </dl>
                      )}
                      {trackerMutationFeedback ? (
                        <p
                          className={cn(
                            "mt-4 text-sm",
                            trackerMutationFeedback.kind === "error"
                              ? "text-destructive"
                              : "text-primary-ink",
                          )}
                          role={trackerMutationFeedback.kind === "error" ? "alert" : "status"}
                        >
                          {trackerMutationFeedback.message}
                        </p>
                      ) : null}
                    </Panel>
                    <Panel title="Client record">
                      <TrackerDetailFields
                        fields={trackerOverviewFields(
                          selectedTrackerClient,
                          new Date(),
                        )}
                      />
                    </Panel>
                  </div>
                ) : null}

                {trackerDrawerTab === "plan" ? (
                  <Panel title="Funding readiness">
                    <TrackerDetailFields
                      fields={trackerPlanFields(selectedTrackerClient, trackerCreditScores)}
                    />
                    <p className="mt-5 text-xs leading-5 text-muted-foreground">
                      {TRACKER_PLAN_STEPS_NOTE}
                    </p>
                  </Panel>
                ) : null}

                {trackerDrawerTab === "funding" ? (
                  <Panel title="Funding">
                    <TrackerDetailFields
                      fields={trackerFundingFields(selectedTrackerClient)}
                    />
                    <TrackerFundingPipeline
                      clientId={selectedTrackerClient.id}
                      enabled={applicationsEnabled}
                    />
                  </Panel>
                ) : null}

                {trackerDrawerTab === "fees" ? (
                  <Panel title="Fees">
                    <TrackerDetailFields
                      fields={trackerFeesFields(trackerFeesSource)}
                    />
                    <p className="mt-5 text-xs leading-5 text-muted-foreground">
                      Tracking only. No invoice, charge, or transfer is created.
                    </p>
                  </Panel>
                ) : null}

                {trackerDrawerTab === "notes" ? (
                  <ClientNotesPanel clientId={selectedTrackerClient.id} />
                ) : null}

                {trackerDrawerTab === "activity" ? (
                  <div className="space-y-5">
                    <Panel title="Stage history">
                      {selectedTrackerClient.history.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No stage changes recorded yet.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          {trackerActivityEntries(selectedTrackerClient).map(
                            (entry) => (
                              <div
                                className="grid gap-1 text-sm sm:grid-cols-[9rem_1fr]"
                                key={entry.key}
                              >
                                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                  {formatTrackerDate(entry.at)}
                                </span>
                                <span>{entry.text}</span>
                              </div>
                            ),
                          )}
                        </div>
                      )}
                    </Panel>
                    <Panel title="Client updates">
                      <TrackerClientTimeline
                        clientId={selectedTrackerClient.id}
                        enabled={timelineEnabled}
                      />
                    </Panel>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog
        onOpenChange={(open) => {
          if (!open && trackerMutationPending === null) {
            setTrackerStatusCandidate(null);
          }
        }}
        open={trackerStatusCandidate !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {trackerStatusCandidate?.status === "archived"
                ? `Archive ${trackerStatusCandidate.name}?`
                : `Reactivate ${trackerStatusCandidate?.name ?? "client"}?`}
            </DialogTitle>
            <DialogDescription>
              {trackerStatusCandidate?.status === "archived"
                ? "The client will leave the default active tracker. Their record and history stay stored, and an operator can reactivate them later."
                : "The client will return to the active tracker with their existing history and assignment intact."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={trackerMutationPending !== null}
              onClick={() => setTrackerStatusCandidate(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={
                !trackerClients.consoleOpsEnabled
                || trackerStatusCandidate === null
                || trackerMutationPending !== null
              }
              onClick={() => void confirmTrackerStatusChange()}
              variant={trackerStatusCandidate?.status === "archived" ? "destructive" : "default"}
            >
              {trackerMutationPending !== null
                ? "Saving…"
                : trackerStatusCandidate?.status === "archived"
                  ? "Archive client"
                  : "Reactivate client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* End durable tracker client peek. */}

      <FeeEditSheet
        clientId={editingFeeClient?.clientId ?? null}
        clientName={editingFeeClient?.name ?? "Client"}
        fixture={editingFixtureFee && editingFeeClient
          ? {
              fundedAmount: getClientFundedAmount(editingFeeClient.clientId),
              model: editingFixtureFee.model,
              paid: editingFixtureFee.paid,
              totalFee: editingFixtureFee.totalFee,
              triggerAmount: editingFixtureFee.triggerAmount,
              upfrontAmount: editingFixtureFee.adminUpfront,
            }
          : undefined}
        key={editingFeeClient?.clientId ?? "closed"}
        onFixtureSave={(value) => {
          if (!editingFeeClient) return;
          setFeeModelOverrides((current) => new Set(current).add(editingFeeClient.clientId));
          setFeeRows((current) =>
            current.map((fee) =>
              fee.clientId === editingFeeClient.clientId
                ? {
                    ...fee,
                    adminUpfront: value.upfrontAmount,
                    model: value.model,
                    paid: value.paid,
                    totalFee: value.totalFee,
                    triggerAmount: value.triggerAmount,
                  }
                : fee,
            ),
          );
        }}
        onOpenChange={(open) => {
          if (!open) setEditingFeeClient(null);
        }}
        onSaved={() => {
          if (feesEnabled) void readReceivables().then(setReceivablesRead);
        }}
        open={editingFeeClient !== null}
        upfrontApproved={upfrontFeeApproved}
      />

      <Dialog
        onOpenChange={(open) => {
          if (!open) setSettingsNotice("");
        }}
        open={Boolean(
          settingsNotice &&
            (settingsNotice.startsWith("Meeting") ||
              settingsNotice.startsWith("AI assistant")),
        )}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nothing was scheduled</DialogTitle>
            <DialogDescription>{settingsNotice}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setSettingsNotice("")}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DemoShell>
  );

  if (!publishedBrand.shellStyle) return shell;
  return <div style={publishedBrand.shellStyle as CSSProperties}>{shell}</div>;
}
