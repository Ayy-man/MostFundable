"use client";

import {
  Fragment,
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  BookOpen,
  Building2,
  Check,
  FileText,
  FlaskConical,
  Landmark,
  LayoutDashboard,
  Lock,
  MessageSquareText,
  Play,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import {
  AdminAssistant,
  AdminAssistantWorkspace,
} from "@/components/assistant/admin-assistant";
import { ScopedAssistantCompanion } from "@/components/assistant/scoped-companion";
import { AdminBankCatalogManagement } from "@/components/admin/bank-catalog-management";
import { AdminPrivacyRequests } from "@/components/admin/privacy-requests";
import { BankDetailSheet } from "@/components/demo/bank-detail-sheet";
import {
  CommandPalette,
  type CommandPalettePage,
  type CommandPaletteRecord,
} from "@/components/demo/command-palette";
import { DemoShell } from "@/components/demo/demo-shell";
import { useFeedbackSession } from "@/components/demo/feedback-session";
import {
  EmptyState,
  MetricStrip,
  PageHeader,
  Panel,
  StatusPill,
} from "@/components/demo/shared";
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
import { HEALTH_ELEMENTS } from "@/lib/demo/co-fixtures";
import { readSupportInbox } from "@/lib/operator/support-inbox.client";
import type { SupportInboxThread } from "@/lib/operator/support-inbox.client";
import {
  OUTCOME_PERIODS,
  deriveAdminOverview,
  deriveAnalyticsMetrics,
  formatDemoMoney,
  formatDemoNumber,
  formatDemoPercent,
  type BankHistoricalStat,
  type OutcomePeriod,
} from "@/lib/demo/feedback-fixtures";
import { bankVaultSource } from "@/lib/vault/read-model";
import {
  toBankDetail,
  useVaultBankDetail,
  useVaultBanks,
} from "@/lib/vault/read.client";
import { displayInitials } from "@/lib/auth/display-identity";
import type { SessionDisplayIdentity } from "@/lib/auth/display-identity";
import type { NavSection, SurfaceProps } from "@/lib/demo/types";
import type { AdminPricingCatalog } from "@/lib/pricing/http";
import {
  activateAdminPromptVersion,
  adminReadNotEnabled,
  createAdminPromptVersion,
  evaluateAdminPromptVersion,
  loadAdminAnalytics,
  loadAdminEvals,
  loadAdminLayout,
  loadAdminPrompts,
  loadAdminPromptVersions,
  loadAdminSetting,
  saveAdminLayout,
  saveAdminSetting,
} from "@/lib/admin/client";
import { KPI_METRIC_KEYS } from "@/lib/admin/analytics-types";
import { GOVERNED_SETTING_KEYS } from "@/lib/admin/settings-types";
import { MANDATORY_PROMPT_EVALUATORS } from "@/lib/admin/prompt-types";
import type { KpiMetricKey, KpiRollupRow } from "@/lib/admin/analytics-types";
import type { EvalRunRow, PromptKey, PromptVersionRow } from "@/lib/admin/prompt-types";
import type { GovernedSettingKey } from "@/lib/admin/settings-types";
import {
  AdminTrainingClientError,
  adminTrainingSourcePath,
  createAdminTraining,
  deleteAdminTraining,
  loadAdminTrainingConfig,
  loadAdminTrainings,
  publishAdminTraining,
  unpublishAdminTraining,
  updateAdminTraining,
  type AdminTraining,
  type AdminTrainingAudience,
  type AdminTrainingConfig,
  type AdminTrainingInput,
} from "@/lib/admin/training-client";
import { trainingSourceAccept } from "@/lib/ancillary/training-source-contract";
import {
  isAdminAuditReady,
  useAdminAudit,
} from "@/lib/admin/audit-client";
import {
  revenuePresentation,
  useRevenueKpis,
} from "@/lib/revenue/client";
import {
  adminReadReason,
  isAdminReady,
  parseAdminFundedSeries,
  parseAdminReviewQueue,
  parseAdminSaasMetrics,
  parseAdminTenants,
  useAdminResource,
} from "@/lib/admin/platform-client";
import type { AdminRead, AdminTenantView } from "@/lib/admin/platform-client";
import {
  AdminWorkspaceClientError,
  changeAdminWorkspaceLifecycle,
  loadAdminWorkspaceRoster,
  provisionAdminWorkspace,
  type AdminWorkspace,
  type AdminWorkspaceLifecycleAction,
} from "@/lib/admin/tenant-lifecycle-client";
import { cn } from "@/lib/utils";

/**
 * What the shell shows a real session whose profile row could not be read.
 *
 * Not a person: the failure mode this replaces is a signed-in administrator
 * reading "Alec Rivera" in their own header and on every line they record, and
 * a second invented name would be the same defect with different letters.
 */
const PLACEHOLDER_ADMIN_NAME = "Platform admin";
const PLACEHOLDER_ADMIN_INITIALS = "PA";

/**
 * The release gate, described from the policy that actually decides it.
 *
 * `MANDATORY_PROMPT_EVALUATORS` is what `/api/admin/prompts/[key]/activate`
 * consults, so the sentence is composed from that object at module load rather
 * than transcribed. The line it replaces read "Current gate: 75% · 4 enabled"
 * off a slider and four illustrative evaluator cards that no activation has
 * ever consulted — a governance figure invented by the page describing it.
 */
const GOVERNED_GATE_SUMMARY = `Code-owned gate · ${
  Object.values(MANDATORY_PROMPT_EVALUATORS).reduce((total, keys) => total + keys.length, 0)
} required evaluators across ${Object.keys(MANDATORY_PROMPT_EVALUATORS).length} prompt families`;

type AdminView =
  | "overview"
  | "tenants"
  | "lenders"
  | "trainings"
  | "billing"
  | "security"
  | "support"
  | "ai-brain"
  | "ai-chat";

// Fixture enums are lowercase tokens; nothing user-facing may render them raw.
function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// `orgs.membership` and `orgs.plan` are snake_case tokens. Module scope because
// the Operators view and the SaaS ledger now render the same roster and must
// spell a plan or a membership state identically.
function membershipLabel(value: string) {
  return titleCase(value.replace(/_/g, " "));
}

// Same shape the operator workspace uses, so a date means the same thing on
// both surfaces instead of admin showing raw ISO next to operator prose.
function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * A complete database instant in a stable, readable timezone.
 *
 * PostgreSQL may return six fractional-second digits and an explicit offset;
 * `Date` accepts that shape and normalizes it before formatting. The guard is
 * still necessary because these values cross a JSON boundary: a malformed row
 * must render an honest fallback, never `Invalid Date` or the raw database
 * value that failed to parse.
 */
function formatInstant(value: unknown): string {
  if (typeof value !== "string") return "Time unavailable";
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return "Time unavailable";
  return `${new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    hour12: true,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(instant)} UTC`;
}

type IntelItem = {
  bank: string;
  confidence: number;
  id: string;
  sources: number;
  source: string;
  tier: "confirmed" | "probable" | "speculating";
  title: string;
  type: "data point" | "policy change" | "pattern" | "gotcha";
};

type BankComment = {
  author: string;
  bankName: string;
  body: string;
  createdAt: string;
  id: string;
  status: "In review";
};

type AuditRisk = "Blocked" | "High" | "Normal" | "Review";
type AuditEvent = {
  action: string;
  actor: string;
  risk: AuditRisk;
  target: string;
  time: string;
};

type KnowledgePage = {
  audience: "Client-facing" | "Platform training";
  category: string;
  status: "Draft" | "Published";
  title: string;
  updated: string;
  visibility: string;
};

type PlatformConfig = {
  coach: boolean;
  escalate: boolean;
  purge: boolean;
  sandbox: boolean;
  trialCoach: boolean;
};

/**
 * The staged-intel queue is empty because no intel pipeline exists.
 *
 * It used to carry eight findings written as sourced fact — "Bluevine approved
 * $45k · 720 FICO · FL", "Slack intel · Jul 20" — with confidence percentages
 * and source counts, presented to a signed-in platform administrator as work
 * waiting on their decision. Nothing ingests Slack, no call is transcribed, and
 * promoting a finding writes to no table, so every row was an invented claim
 * about a lender's underwriting. There is no read to point the list at, and an
 * honest empty queue is the answer an absent pipeline has: the panel's own
 * empty state already says new findings appear here before publication.
 */
const INTEL_ITEMS: IntelItem[] = [];

function nextBankCommentId(current: BankComment[]) {
  const max = current.reduce((highest, comment) => {
    const numeric = Number(comment.id.replace("bc-", ""));
    return Number.isFinite(numeric) && numeric > highest ? numeric : highest;
  }, 0);
  return `bc-${max + 1}`;
}

/**
 * What the governed admin sections say when `FEATURE_ADMIN` is off.
 *
 * Distinct from their failure copy on purpose: nothing broke, so nobody should
 * be sent looking for a fault. Distinct from rendering the fixture twin too —
 * with a real session behind the page, "Four operator workspaces will receive
 * the change", "v14 · 1,284 conversations" and a 30-day blended score of 0.98
 * are claims about a platform, and there is no platform behind them.
 */
const ADMIN_GOVERNANCE_ABSENT =
  "Platform governance records are not enabled on this deployment, so there is nothing to show here yet. Nothing failed.";

/**
 * The same distinction for the training library, which is governed by its own
 * flag and so needs its own sentence: an administrator reading "could not be
 * loaded" goes looking for an outage, and there is no outage.
 */
const TRAINING_LIBRARY_ABSENT =
  "The training library is not enabled on this deployment, so there are no trainings to show here yet. Nothing failed.";

const KNOWLEDGE_PAGES: KnowledgePage[] = [
  { title: "Bluevine application playbook", audience: "Platform training", category: "Playbook", status: "Published", visibility: "All operators", updated: "Jul 20" },
  { title: "Utilization: the 29% rail explained", audience: "Client-facing", category: "Lesson", status: "Published", visibility: "Published to clients", updated: "Jul 18" },
  { title: "Chase Ink apply script", audience: "Platform training", category: "Script", status: "Published", visibility: "All operators", updated: "Jul 18" },
  { title: "Vendor tradelines that report", audience: "Client-facing", category: "Lesson", status: "Published", visibility: "Published to clients", updated: "Jul 12" },
  { title: "Reading your readiness score", audience: "Client-facing", category: "Lesson", status: "Published", visibility: "Published to clients", updated: "Jun 30" },
  { title: "After approval: managing the line", audience: "Platform training", category: "Lesson", status: "Draft", visibility: "Private draft", updated: "Jul 19" },
];

const PROMPTS = [
  { id: "master", name: "Master system prompt", version: "v14", score: "0.91", traffic: "all agents", description: "Global guardrails, tone, grounding, and AI self-identification.", text: "You are the MostFundable platform supervisor. Stay within funding readiness. Never provide tactics intended to alter furnished credit records. Ground every claim in the CCA VAULT knowledge base and live lender database. If there is no source, say so. Identify every response as AI-generated." },
  { id: "coach", name: "Funding coach", version: "v9", score: "0.94", traffic: "1,284 conversations", description: "Client-facing readiness guidance grounded in approved knowledge.", text: "Guide clients toward funding readiness using derived plan data. Redirect restricted record-change requests to lawful readiness actions. Hold low-confidence responses for the funding team. Cite the approved knowledge source when grounded." },
  { id: "plan", name: "Plan generator", version: "v12", score: "0.92", traffic: "312 plans", description: "Creates sequenced readiness plans from transient analysis outputs.", text: "Generate three to five sequenced readiness steps. Each step names the metric, threshold, and target date. Every number must trace to the current analysis snapshot. Never invent balances, limits, scores, or lending decisions." },
];

const EVALUATORS = [
  { id: "compliance", name: "Compliance boundary", description: "Fails restricted record-change guidance and missing AI identification.", score: "0.98", type: "Deterministic + model" },
  { id: "grounding", name: "Grounding and accuracy", description: "Verifies that every number and lender claim traces to the supplied source.", score: "0.94", type: "Source comparison" },
  { id: "confidence", name: "Confidence calibration", description: "Checks whether uncertain answers are held or escalated at the correct threshold.", score: "0.89", type: "Threshold grader" },
  { id: "tone", name: "Plain-language tone", description: "Flags jargon, hype, guarantees, and language that obscures the next action.", score: "0.92", type: "Rubric grader" },
];

const ADMIN_SECTIONS: NavSection[] = [
  {
    label: "Performance",
    items: [
      { id: "overview", label: "Overview", icon: LayoutDashboard },
      { id: "tenants", label: "Operators", icon: Building2 },
      { id: "lenders", label: "Bank Vault", icon: Landmark },
    ],
  },
  {
    label: "Platform",
    items: [
      { id: "billing", label: "SaaS", icon: FileText },
      { id: "trainings", label: "Client Trainings", icon: BookOpen },
      { id: "security", label: "Access & audit log", icon: Lock },
      // No badge: the count was the literal 2 that matched the deleted ticket
      // fixtures. ADMIN_SECTIONS is a module constant rendered outside the
      // session state, so it cannot see the durable support read; a static
      // number over a queue this nav cannot count is a claim, not a count.
      { id: "support", label: "Support", icon: MessageSquareText },
    ],
  },
  {
    label: "Platform AI",
    items: [
      { id: "ai-brain", label: "AI Brain", icon: FlaskConical },
      { id: "ai-chat", label: "AI Chat", icon: MessageSquareText },
    ],
  },
];

const ADMIN_VIEW_IDS = ADMIN_SECTIONS.flatMap((section) => section.items.map((item) => item.id));
const adminCommandPages: CommandPalettePage[] = ADMIN_SECTIONS.flatMap((section) =>
  section.items.map((item) => ({
    description: section.label ? `${section.label} page` : undefined,
    icon: item.icon,
    id: item.id,
    label: item.label,
  })),
);

type AdminSessionContextValue = {
  actorName: string;
  auditEvents: AuditEvent[];
  bankComments: BankComment[];
  coachDecisions: Record<string, "acknowledged" | "returned">;
  config: PlatformConfig;
  configConfidence: string;
  evaluatorEnabled: Record<string, boolean>;
  evaluatorThreshold: number;
  extraCases: Record<string, number>;
  forcePullPrice: string;
  intelDecisions: Record<string, "promoted" | "rejected">;
  knowledgePages: KnowledgePage[];
  promptDrafts: Record<string, string>;
  // The actor is stamped by the recorder from the session, never passed in: a
  // caller that could name the actor is a caller that could name the wrong one.
  recordAudit: (event: Omit<AuditEvent, "actor" | "time"> & { time?: string }) => void;
  setBankComments: Dispatch<SetStateAction<BankComment[]>>;
  setCoachDecisions: Dispatch<SetStateAction<Record<string, "acknowledged" | "returned">>>;
  setConfig: Dispatch<SetStateAction<PlatformConfig>>;
  setConfigConfidence: Dispatch<SetStateAction<string>>;
  setEvaluatorEnabled: Dispatch<SetStateAction<Record<string, boolean>>>;
  setEvaluatorThreshold: Dispatch<SetStateAction<number>>;
  setExtraCases: Dispatch<SetStateAction<Record<string, number>>>;
  setForcePullPrice: Dispatch<SetStateAction<string>>;
  setIntelDecisions: Dispatch<SetStateAction<Record<string, "promoted" | "rejected">>>;
  setKnowledgePages: Dispatch<SetStateAction<KnowledgePage[]>>;
  setPromptDrafts: Dispatch<SetStateAction<Record<string, string>>>;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

function useAdminSession() {
  const value = useContext(AdminSessionContext);
  if (!value) throw new Error("Admin session is unavailable.");
  return value;
}

function MobileRecord({
  action,
  fields,
  status,
  subtitle,
  title,
}: {
  action?: ReactNode;
  fields: Array<{ label: string; value: ReactNode; wide?: boolean }>;
  status?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  return (
    <article className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-5">{title}</h3>
          {subtitle ? <div className="mt-1 text-xs leading-5 text-muted-foreground">{subtitle}</div> : null}
        </div>
        {status ? <div className="shrink-0">{status}</div> : null}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        {fields.map((field) => (
          <div className={field.wide ? "col-span-2" : undefined} key={field.label}>
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd className="mt-1 break-words font-medium">{field.value}</dd>
          </div>
        ))}
      </dl>
      {action ? <div className="mt-4 flex flex-wrap gap-2">{action}</div> : null}
    </article>
  );
}

function AdminSelect({
  ariaLabel,
  className,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  className?: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  // Every admin filter and form picker routes through the one shared combobox,
  // so `AdminSelect` is now a thin adapter that keeps the surface's existing
  // `options: string[]` call shape rather than eighteen rewritten call sites.
  return (
    <BrandSelect
      ariaLabel={ariaLabel}
      className={cn("w-auto min-w-44", className)}
      onValueChange={onChange}
      options={options}
      value={value}
    />
  );
}

function SearchField({ onChange, placeholder, value }: { onChange: (value: string) => void; placeholder: string; value: string }) {
  return (
    <label className="relative block min-w-0 flex-1 sm:max-w-xs">
      <span className="sr-only">{placeholder}</span>
      <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input className="min-h-11 pl-8" onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />
    </label>
  );
}

function ProgressMeter({ label, value }: { label: string; value: number }) {
  const width = value >= 90 ? "w-full" : value >= 75 ? "w-4/5" : value >= 60 ? "w-3/5" : value >= 45 ? "w-1/2" : value >= 25 ? "w-1/3" : "w-1/5";
  return (
    <div className="flex min-w-32 items-center gap-2">
      <div aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full bg-primary", width)} />
      </div>
      <span className="w-9 text-right text-xs font-medium tabular-nums">{value}%</span>
      <span className="sr-only">{label}: {value}%</span>
    </div>
  );
}

function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "success" | "warning" }) {
  return (
    <div
      aria-live="polite"
      className={cn(
        "rounded-lg border px-3 py-2 text-xs leading-5",
        tone === "success" && "border-[color-mix(in_srgb,var(--consumer-positive),transparent_74%)] bg-[color-mix(in_srgb,var(--consumer-positive),transparent_92%)] text-[var(--consumer-positive)]",
        tone === "warning" && "border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_68%)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_55%)] text-[var(--consumer-warning-ink)]",
        tone === "info" && "border-primary/20 bg-primary/8 text-primary-ink",
      )}
    >
      {children}
    </div>
  );
}

function ViewToolbar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>;
}

function PillTabs<T extends string>({
  onChange,
  tabs,
  value,
}: {
  onChange: (value: T) => void;
  tabs: Array<{ label: string; value: T }>;
  value: T;
}) {
  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <Button
          aria-pressed={value === tab.value}
          key={tab.value}
          onClick={() => onChange(tab.value)}
          size="sm"
          variant={value === tab.value ? "secondary" : "outline"}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * Durable money arrives as integer cents. `null` means the figure has no
 * recorded source — the flag that owns it is off, or nothing was recorded —
 * and renders as a dash, never as $0. A $0 would be a claim about the book;
 * a dash is a statement about the record.
 */
const centsMoney = (value: number | null, compact = true) =>
  value === null ? "—" : formatDemoMoney(value / 100, compact ? { compact: true } : { minimumFractionDigits: 2 });

// A recorded zero and an absent figure are different statements, so they get
// different words: `—` means there is no source, `None` means the source says
// nothing was funded.
const recordedMoney = (value: number | null) =>
  value === null ? "—" : value ? centsMoney(value) : "None";

// The mean recorded funded outcome for one workspace: the recorded total over
// the number of recorded outcomes, not over the client count.
const averageFundedCents = (tenant: AdminTenantView): number | null =>
  tenant.fundedAllTimeCents === null || !tenant.fundedOutcomes
    ? null
    : Math.round(tenant.fundedAllTimeCents / tenant.fundedOutcomes);

function OverviewView({ onNavigate }: { onNavigate: (view: AdminView) => void }) {
  const [leaderboardMetric, setLeaderboardMetric] = useState<"funded" | "funding-ready" | "average">("funded");
  // Platform-wide headline figures, read durable rather than derived from
  // fixtures (G-HOST-20, mirroring the operator Dashboard swap). `null` is the
  // route's flag-off answer (FEATURE_ADMIN off — a known disabled state, not a
  // failure); "failed" keeps a broken read from rendering as a healthy figure.
  // funded/cash are cents that are durable only behind FEATURE_APPLICATIONS /
  // FEATURE_FEES, so they arrive as `number | null` and render `—` with the
  // not-enabled reason when their flag is off (or no outcome is recorded).
  const [overviewRead, setOverviewRead] = useState<
    { operators: number; consumers: number; analyses: number; funded: number | null; cash: number | null } | "loading" | "failed" | null
  >("loading");
  useEffect(() => {
    let active = true;
    void fetch("/api/admin/overview", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) return "failed" as const;
        const body = (await response.json()) as Record<string, unknown>;
        const ok = (value: unknown): value is number =>
          typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
        const okOrNull = (value: unknown): value is number | null => value === null || ok(value);
        if (!ok(body.operators) || !ok(body.consumers) || !ok(body.analyses)
          || !okOrNull(body.funded) || !okOrNull(body.cash)) return "failed" as const;
        return {
          operators: body.operators, consumers: body.consumers, analyses: body.analyses,
          funded: body.funded, cash: body.cash,
        };
      })
      .then((result) => { if (active) setOverviewRead(result); })
      .catch(() => { if (active) setOverviewRead("failed"); });
    return () => { active = false; };
  }, []);
  const overviewReason = overviewRead === "loading"
    ? "Loading platform totals"
    : overviewRead === "failed"
      ? "Platform totals unavailable"
      : overviewRead === null
        ? "Platform totals not enabled"
        : "Platform totals not enabled";
  type OverviewFigures = { operators: number; consumers: number; analyses: number; funded: number | null; cash: number | null };
  const overviewCount = (pick: (counts: OverviewFigures) => number, descriptor: string) =>
    typeof overviewRead === "object" && overviewRead !== null
      ? { value: formatDemoNumber(pick(overviewRead)), change: descriptor }
      : { value: "—", change: overviewReason };
  // funded/cash arrive in cents. A number renders as money; `null` (flag off,
  // or no recorded outcome for funded) renders `—` with its own not-enabled
  // reason, distinct from the loading/failed/disabled reasons above.
  const overviewMoney = (pick: (counts: OverviewFigures) => number | null, recordedLabel: string, offReason: string) => {
    if (typeof overviewRead !== "object" || overviewRead === null) return { value: "—", change: overviewReason };
    const cents = pick(overviewRead);
    return cents === null
      ? { value: "—", change: offReason }
      : { value: formatDemoMoney(cents / 100, { compact: true }), change: recordedLabel };
  };
  const liveRevenue = useRevenueKpis();
  const revenue = revenuePresentation(liveRevenue);
  // The operator roster and its recorded figures, read across every tenant
  // (G-HOST-20 pattern). The workspaces on this list are the ones the platform
  // database holds — not the demo roster — so an unready read renders no rows
  // and says why rather than falling back to fixture operators.
  const { read: tenantRead } = useAdminResource("/api/admin/tenants", parseAdminTenants);
  const { read: saasRead } = useAdminResource("/api/admin/saas-metrics", parseAdminSaasMetrics);
  const leaderboardReason = adminReadReason(tenantRead, "Operator records not enabled");
  const leaderboard = (isAdminReady(tenantRead) ? [...tenantRead] : []).sort((left, right) => {
    if (leaderboardMetric === "funding-ready") {
      // A workspace with no client at funding-ready has no time to compare, so
      // it sorts last instead of sorting first on a stand-in zero.
      const leftDays = left.fundingReadyDays ?? Number.POSITIVE_INFINITY;
      const rightDays = right.fundingReadyDays ?? Number.POSITIVE_INFINITY;
      return leftDays - rightDays;
    }
    if (leaderboardMetric === "average") {
      return (averageFundedCents(right) ?? -1) - (averageFundedCents(left) ?? -1);
    }
    return (right.fundedYtdCents ?? -1) - (left.fundedYtdCents ?? -1);
  }).slice(0, 10);

  // The roster is shorter than the cap, so the caption counts what actually
  // renders instead of promising ten rows the panel never shows.
  const leaderboardDescription = !isAdminReady(tenantRead)
    ? leaderboardReason
    : leaderboardMetric === "funding-ready"
      ? `Top ${leaderboard.length} by shortest recorded time to funding-ready`
      : leaderboardMetric === "average"
        ? `Top ${leaderboard.length} by average recorded funded outcome`
        : `Top ${leaderboard.length} by recorded funded outcomes year to date`;

  // Monitoring share and SaaS referral share come from posted ledger rows; with
  // the revenue read disabled or broken there is no recorded value at all, so
  // they dash. The monthly recurring total needs monitoring subscription
  // revenue on top of the platform subscription total, and no table records it
  // — that row therefore has no durable value to show at any flag setting.
  const monitoringShareCents = typeof liveRevenue === "object" && liveRevenue !== null
    ? liveRevenue.monitoringShareTotalCents : null;
  const referralShareCents = typeof liveRevenue === "object" && liveRevenue !== null
    ? liveRevenue.saasReferralTotalCents : null;
  const earningsDescription = [
    isAdminReady(saasRead)
      ? "Platform subscription total from recorded plan and seat records"
      : adminReadReason(saasRead, "Subscription records not enabled"),
    revenue.enabled
      ? revenue.complete
        ? "monitoring-share and SaaS-referral values from posted ledger rows"
        : "revenue ledger data is incomplete · missing inputs are shown as zero"
      : revenue.failed
        ? "the revenue read did not complete, so monitoring and referral values are unavailable"
        : "monitoring-share and referral terms remain TBD pending the billing session",
    "monthly recurring total needs monitoring subscription revenue, which has no recorded source",
  ].join(" · ");

  return (
    <>
      <PageHeader
        eyebrow="Platform command center"
        title="Overview"
        description="Funded volume detail lives in Analytics; system health lives in Support."
      />
      <MetricStrip items={[
        { label: "Operators", ...overviewCount((counts) => counts.operators, "Operator tenants") },
        // "Consumer accounts", not "clients": this counts consumer login
        // profiles, and the operator leaderboard below counts client records,
        // which is the larger number whenever a client has no login yet. The
        // two are read from different tables and are meant to differ.
        { label: "Consumers", ...overviewCount((counts) => counts.consumers, "Consumer accounts") },
        { label: "Funded All-Time", ...overviewMoney((counts) => counts.funded, "Recorded funded outcomes", "Recorded outcomes not enabled") },
        { label: "Cash All-Time", ...overviewMoney((counts) => counts.cash, "Recorded fee payments", "Fee records not enabled") },
        { label: "AI Analyses", ...overviewCount((counts) => counts.analyses, "Completed analyses") },
      ]} />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.75fr)]">
        {/*
          min-w-0: a grid item defaults to min-width:auto, so this single-column
          track resolves to the panel's min-content width and overflows the
          viewport at 390px. Durable operator names ("Cedar Harbor Fictional
          Cooperative") are longer than the fixture names were, and the
          truncated name span is whitespace-nowrap, so the min-content width
          crossed 390 once the leaderboard started reading real orgs.
        */}
        <Panel
          className="min-w-0"
          title="Operator leaderboard"
          description={`${leaderboardDescription} · historical record, not offers`}
        >
          <PillTabs
            onChange={setLeaderboardMetric}
            tabs={[
              { label: "YTD funded", value: "funded" },
              { label: "Funding-ready time", value: "funding-ready" },
              { label: "Avg funding", value: "average" },
            ]}
            value={leaderboardMetric}
          />
          <div className="divide-y divide-border">
            {leaderboard.map((operator, index) => (
              <button
                className="flex w-full items-center gap-4 rounded-sm py-3.5 text-left outline-none transition first:pt-0 last:pb-0 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                key={operator.id}
                onClick={() => onNavigate("tenants")}
                type="button"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{operator.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {titleCase(operator.plan)} plan · {formatDemoNumber(operator.clients)} client records
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold tabular-nums">
                    {leaderboardMetric === "funding-ready"
                      ? operator.fundingReadyDays === null
                        ? "No history"
                        : `${operator.fundingReadyDays} days`
                      : leaderboardMetric === "average"
                        ? recordedMoney(averageFundedCents(operator))
                        : recordedMoney(operator.fundedYtdCents)}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {leaderboardMetric === "funding-ready"
                      ? "to funding-ready"
                      : leaderboardMetric === "average"
                        ? "average funding"
                        : "funded YTD"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel
          className="min-w-0"
          title="Platform earnings"
          description={earningsDescription}
        >
          <dl className="space-y-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Monthly recurring total</dt>
              <dd className="font-semibold tabular-nums">—</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Platform fees + seats</dt>
              <dd className="font-medium tabular-nums">{centsMoney(isAdminReady(saasRead) ? saasRead.platformMrrCents : null, false)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{revenue.enabled ? "Monthly monitoring share" : "Monitoring profit"}</dt>
              <dd className="font-medium tabular-nums">{centsMoney(monitoringShareCents, false)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{revenue.enabled ? "Monthly SaaS referral share" : "Referral split"}</dt>
              <dd className="font-medium tabular-nums">{centsMoney(referralShareCents, false)}</dd>
            </div>
          </dl>
          <div className="mt-5 border-t border-border pt-4">
            <Button onClick={() => onNavigate("billing")} size="sm" variant="outline">
              Open the SaaS ledger
            </Button>
          </div>
        </Panel>
      </div>
    </>
  );
}
function workspaceFailureMessage(error: unknown): string {
  if (!(error instanceof AdminWorkspaceClientError)) {
    return "The workspace request could not be completed.";
  }
  if (error.code === "INVALID_WORKSPACE_INPUT" || error.code === "INVALID_TENANT_INPUT") {
    return "Check the owner name and email, then use a unique 3–40 character subdomain made from lowercase letters, numbers, or hyphens.";
  }
  if (error.code === "TENANT_CONFLICT") {
    return "That owner, workspace, or subdomain conflicts with an existing tenant record.";
  }
  if (error.code === "TENANT_INVITE_DELIVERY_FAILED") {
    return "The workspace was provisioned, but its owner invitation was not delivered.";
  }
  if (error.code === "TENANT_REACTIVATION_REQUIRES_TRIAL_EXTENSION") {
    return "Reactivation is blocked until the trial is extended or an active subscription exists.";
  }
  if (error.code === "FEATURE_DISABLED" || error.code === "HTTP_404") {
    return "Workspace lifecycle writes are not enabled on this deployment.";
  }
  if (error.code === "forbidden" || error.code === "unauthenticated") {
    return "This signed-in account cannot manage operator workspaces.";
  }
  if (error.code === "NETWORK_UNAVAILABLE") {
    return "The workspace request lost its connection before an answer was received.";
  }
  if (error.code === "INVALID_RESPONSE") {
    return "The workspace endpoint returned an invalid response.";
  }
  return "The workspace request could not be completed.";
}

function TenantsView() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All statuses");
  const [showProvision, setShowProvision] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newOwnerName, setNewOwnerName] = useState("");
  const [newOwnerEmail, setNewOwnerEmail] = useState("");
  const [provisionKey, setProvisionKey] = useState<string | null>(null);
  const [provisionLocked, setProvisionLocked] = useState(false);
  const [pendingSuspension, setPendingSuspension] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "success" | "warning" } | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [tenantRead, setTenantRead] = useState<AdminRead<readonly AdminWorkspace[]>>("loading");

  // The first read and every post-mutation read use the same strict parser. A
  // malformed or refused roster replaces the old rows instead of leaving stale
  // state on screen as if it confirmed the write.
  useEffect(() => {
    let active = true;
    void loadAdminWorkspaceRoster()
      .then((rows) => { if (active) setTenantRead(rows); })
      .catch(() => { if (active) setTenantRead("failed"); });
    return () => { active = false; };
  }, []);

  async function readBackTenantRoster(): Promise<AdminRead<readonly AdminWorkspace[]>> {
    setTenantRead("loading");
    try {
      const rows = await loadAdminWorkspaceRoster();
      setTenantRead(rows);
      return rows;
    } catch {
      setTenantRead("failed");
      return "failed";
    }
  }

  const tenants = useMemo(() => (isAdminReady(tenantRead) ? tenantRead : []), [tenantRead]);
  const tenantsReason = tenantRead === "loading"
    ? "Loading operator workspaces"
    : tenantRead === "failed"
      ? "Operator workspaces are unavailable"
      : "Operator records are not enabled";

  const filtered = useMemo(() => tenants.filter((tenant) =>
    tenant.name.toLowerCase().includes(query.toLowerCase()) &&
    (status === "All statuses" || membershipLabel(tenant.membership) === status),
  ), [query, status, tenants]);
  const managedTenant = pendingSuspension
    ? tenants.find((tenant) => tenant.id === pendingSuspension)
    : undefined;
  const provisionComplete = [newName, newSlug, newOwnerName, newOwnerEmail]
    .every((value) => value.trim().length > 0);

  function resetProvision(close = true): void {
    setNewName("");
    setNewSlug("");
    setNewOwnerName("");
    setNewOwnerEmail("");
    setProvisionKey(null);
    setProvisionLocked(false);
    if (close) setShowProvision(false);
  }

  function toggleProvision(): void {
    if (showProvision) {
      resetProvision();
      return;
    }
    setProvisionKey(crypto.randomUUID());
    setShowProvision(true);
    setNotice(null);
  }

  async function provisionWorkspace(): Promise<void> {
    if (!provisionKey || !provisionComplete || !isAdminReady(tenantRead)) return;
    setPendingAction("provision");
    setNotice(null);
    let created: Awaited<ReturnType<typeof provisionAdminWorkspace>> | null = null;
    let failure: unknown = null;
    try {
      created = await provisionAdminWorkspace({
        email: newOwnerEmail,
        fullName: newOwnerName,
        name: newName,
        plan: "trial",
        slug: newSlug,
      }, provisionKey);
    } catch (error) {
      failure = error;
    }

    const readback = await readBackTenantRoster();
    const normalizedSlug = newSlug.trim().toLowerCase();
    if (!isAdminReady(readback)) {
      if (
        created
        || (
          failure instanceof AdminWorkspaceClientError
          && ["NETWORK_UNAVAILABLE", "TENANT_INVITE_DELIVERY_FAILED"].includes(failure.code)
        )
      ) setProvisionLocked(true);
      setNotice({
        message: created
          ? "The server accepted the provision request, but the workspace roster could not be read back. Reload before making another workspace change."
          : `${workspaceFailureMessage(failure)} The roster also could not be read back, so the current state is unknown.`,
        tone: "warning",
      });
    } else {
      const confirmed = created
        ? readback.find((tenant) => tenant.id === created.orgId)
        : readback.find((tenant) => tenant.slug === normalizedSlug);
      if (created && confirmed?.plan === "trial") {
        setNotice({
          message: `${confirmed.name} was provisioned on Trial, its owner invite was handed to the authentication provider, and the workspace was confirmed by server read-back.`,
          tone: "success",
        });
        resetProvision();
      } else if (
        failure instanceof AdminWorkspaceClientError
        && failure.code === "TENANT_INVITE_DELIVERY_FAILED"
        && confirmed
      ) {
        setProvisionLocked(true);
        setNotice({
          message: `${confirmed.name} exists, but owner invitation delivery failed. Retry Create to resend the same durable invite; the retained idempotency key prevents a second workspace.`,
          tone: "warning",
        });
      } else if (created) {
        setProvisionLocked(true);
        setNotice({
          message: "Provisioning returned success, but roster read-back did not confirm the new Trial workspace. Reload before retrying.",
          tone: "warning",
        });
      } else if (failure instanceof AdminWorkspaceClientError && failure.code === "NETWORK_UNAVAILABLE" && confirmed) {
        setProvisionLocked(true);
        setNotice({
          message: `${confirmed.name} now occupies that subdomain, but invitation delivery could not be confirmed. Retry with the same form to reuse the durable provision request.`,
          tone: "warning",
        });
      } else {
        setNotice({ message: workspaceFailureMessage(failure), tone: "warning" });
      }
    }
    setPendingAction(null);
  }

  async function actOnTenant(tenant: AdminWorkspace, action: AdminWorkspaceLifecycleAction): Promise<void> {
    setPendingAction(`${action}:${tenant.id}`);
    setNotice(null);
    let result: Awaited<ReturnType<typeof changeAdminWorkspaceLifecycle>> | null = null;
    let failure: unknown = null;
    try {
      result = await changeAdminWorkspaceLifecycle(tenant.id, action);
    } catch (error) {
      failure = error;
    }

    const readback = await readBackTenantRoster();
    if (!isAdminReady(readback)) {
      setNotice({
        message: result
          ? "The lifecycle endpoint accepted the change, but the roster could not be read back. Reload before making another workspace change."
          : `${workspaceFailureMessage(failure)} The roster also could not be read back, so access state is unknown.`,
        tone: "warning",
      });
    } else {
      const confirmed = readback.find((candidate) => candidate.id === tenant.id);
      const expected = action === "deactivate"
        ? confirmed?.membership === "deactivated"
        : confirmed?.membership === "trial" || confirmed?.membership === "current";
      if (confirmed && expected) {
        setNotice({
          message: failure
            ? `${confirmed.name} now reads ${membershipLabel(confirmed.membership)} in the server roster, although the action response did not complete cleanly.`
            : `${confirmed.name} is ${action === "deactivate" ? "suspended" : "reactivated"} as ${membershipLabel(confirmed.membership)}. The governed change is stored in Access & audit log.`,
          tone: failure ? "warning" : "success",
        });
        setPendingSuspension(null);
      } else if (failure) {
        setNotice({ message: workspaceFailureMessage(failure), tone: "warning" });
      } else {
        setNotice({
          message: `The lifecycle endpoint returned ${membershipLabel(result?.membership ?? "unknown")}, but roster read-back did not confirm that state. Reload before retrying.`,
          tone: "warning",
        });
      }
    }
    setPendingAction(null);
  }

  return (
    <>
      <PageHeader eyebrow="Operator operations" title="Operators" actions={<Button disabled={!isAdminReady(tenantRead) || pendingAction !== null} onClick={toggleProvision} title={isAdminReady(tenantRead) ? undefined : "The operator roster must load before provisioning."}><Plus aria-hidden />Provision operator</Button>} />
      {showProvision ? (
        <Panel className="mb-5" title="Provision operator" description="Create the workspace and its owner invitation as one idempotent tenancy request.">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium">Workspace name<Input aria-label="Workspace name" className="mt-1 min-h-11" disabled={pendingAction !== null || provisionLocked} maxLength={120} onChange={(event) => setNewName(event.target.value)} placeholder="Operator business name" value={newName} /></label>
            <label className="text-xs font-medium">Workspace subdomain<Input aria-label="Workspace subdomain" autoCapitalize="none" className="mt-1 min-h-11" disabled={pendingAction !== null || provisionLocked} maxLength={40} onChange={(event) => setNewSlug(event.target.value)} placeholder="northbridge-funding" spellCheck={false} value={newSlug} /></label>
            <label className="text-xs font-medium">Owner name<Input aria-label="Workspace owner name" autoComplete="name" className="mt-1 min-h-11" disabled={pendingAction !== null || provisionLocked} maxLength={120} onChange={(event) => setNewOwnerName(event.target.value)} placeholder="First owner" value={newOwnerName} /></label>
            <label className="text-xs font-medium">Owner email<Input aria-label="Workspace owner email" autoComplete="email" className="mt-1 min-h-11" disabled={pendingAction !== null || provisionLocked} maxLength={320} onChange={(event) => setNewOwnerEmail(event.target.value)} placeholder="owner@example.com" type="email" value={newOwnerEmail} /></label>
            <label className="text-xs font-medium">Initial plan<Input aria-label="Workspace initial plan" className="mt-1 min-h-11" disabled value="Trial" /></label>
            <div className="flex items-end gap-2"><Button disabled={!provisionComplete || pendingAction !== null || !provisionKey} onClick={() => void provisionWorkspace()}>{pendingAction === "provision" ? "Creating…" : "Create and invite owner"}</Button><Button disabled={pendingAction !== null} onClick={() => resetProvision()} variant="outline">Cancel</Button></div>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{provisionLocked ? "These values are locked so a delivery retry reuses the exact durable provision request and cannot redirect its invite." : "Every workspace created by this route starts on Trial. Paid plan, seat, fee, and payment-provider changes need a provider-first governed update path; this form does not simulate them."}</p>
        </Panel>
      ) : null}
      {pendingSuspension ? (
        <section aria-labelledby="operator-suspension-title" className="mb-5 rounded-xl border border-destructive/25 bg-destructive/5 p-4 sm:p-5">
          <h2 className="text-sm font-semibold" id="operator-suspension-title">Manage access for {managedTenant?.name ?? ""}</h2>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
            {managedTenant?.membership === "deactivated"
              ? "Reactivate this operator workspace and its client portals. The governed state machine restores Current only for an active subscription, or Trial while its stored trial remains valid."
              : "Suspending applies the governed deactivated state, which stops client portals and operator access while retaining billing history and the workspace record."}
          </p>
          <dl className="mt-3 grid max-w-xl grid-cols-2 gap-3 text-xs"><div><dt className="text-muted-foreground">Recorded plan</dt><dd className="mt-1 font-semibold">{managedTenant ? membershipLabel(managedTenant.plan) : "—"}</dd></div><div><dt className="text-muted-foreground">Membership</dt><dd className="mt-1 font-semibold">{managedTenant ? membershipLabel(managedTenant.membership) : "—"}</dd></div></dl>
          <p className="mt-3 max-w-2xl text-xs leading-5 text-muted-foreground">Permanent deletion is not offered because no governed retention and evidence-deletion workflow exists. Plan, seat, fee, and provider changes stay read-only until a provider-first update path is available.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {managedTenant?.membership === "deactivated" ? (
              <Button className="min-h-11" disabled={pendingAction !== null} onClick={() => { if (managedTenant) void actOnTenant(managedTenant, "reactivate"); }}>{pendingAction?.startsWith("reactivate:") ? "Reactivating…" : "Reactivate operator access"}</Button>
            ) : (
              <Button className="min-h-11" disabled={pendingAction !== null || !managedTenant} onClick={() => { if (managedTenant) void actOnTenant(managedTenant, "deactivate"); }} variant="destructive">{pendingAction?.startsWith("deactivate:") ? "Suspending…" : "Suspend operator access"}</Button>
            )}
            <Button className="min-h-11" disabled={pendingAction !== null} onClick={() => setPendingSuspension(null)} variant="outline">Cancel</Button>
          </div>
        </section>
      ) : null}
      {notice ? <div className="mb-4"><Notice tone={notice.tone}>{notice.message}</Notice></div> : null}
      {tenantRead === "loading" ? <div className="mb-4"><Notice>Loading operator workspaces.</Notice></div> : null}
      {tenantRead === null ? <div className="mb-4"><Notice>Operator records are not enabled on this deployment.</Notice></div> : null}
      {tenantRead === "failed" ? <div className="mb-4"><Notice tone="warning">Operator workspaces could not be loaded, so this is not an empty roster.</Notice></div> : null}
      <ViewToolbar><SearchField onChange={setQuery} placeholder="Search operators" value={query} /><AdminSelect ariaLabel="Operator status" onChange={setStatus} options={["All statuses", "Current", "Trial", "Past due", "Grace", "Deactivated"]} value={status} /><span className="text-xs text-muted-foreground sm:ml-auto">{isAdminReady(tenantRead) ? <><span className="tabular-nums">{filtered.length}</span> of {tenants.length}</> : tenantsReason}</span></ViewToolbar>
      <Panel className="min-w-0" title="Operator workspaces" description={isAdminReady(tenantRead) ? "Stored plan, membership state, active consumers, and recorded funded outcomes" : tenantsReason}>
          {isAdminReady(tenantRead) && tenants.length === 0 ? <EmptyState title="No operator workspaces" description="Provision the first Trial workspace and owner invitation above." /> : null}
          {isAdminReady(tenantRead) && tenants.length > 0 && filtered.length === 0 ? <EmptyState title="No matching workspaces" description="Change the search or membership filter." /> : null}
          {isAdminReady(tenantRead) && filtered.length > 0 ? <>
          <div className="hidden overflow-x-auto md:block">
            <Table className="min-w-[1040px]">
              <TableHeader><TableRow><TableHead>Operator</TableHead><TableHead>Plan</TableHead><TableHead>Clients</TableHead><TableHead>Started</TableHead><TableHead>Membership</TableHead><TableHead>Avg time to optimize</TableHead><TableHead>Avg funding / client</TableHead><TableHead>Funded YTD</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
              <TableBody>{filtered.map((tenant) => {
                const membership = membershipLabel(tenant.membership);
                const perClient = tenant.fundedYtdCents !== null && tenant.clients
                  ? Math.round(tenant.fundedYtdCents / tenant.clients)
                  : null;
                return (
                  <TableRow key={tenant.id}>
                    <TableCell><p className="font-semibold">{tenant.name}</p><p className="mt-1 text-xs text-muted-foreground">{tenant.slug}.mostfundable.com</p></TableCell>
                    <TableCell>{membershipLabel(tenant.plan)}</TableCell>
                    <TableCell className="tabular-nums">{tenant.clients}</TableCell><TableCell>{tenant.startedAt ? formatDate(tenant.startedAt) : "—"}</TableCell>
                    <TableCell><StatusPill tone={tenant.membership === "current" ? "success" : tenant.membership === "trial" ? "info" : "danger"}>{membership}</StatusPill></TableCell>
                    <TableCell className="tabular-nums">{tenant.fundingReadyDays === null ? "No history" : `${tenant.fundingReadyDays} days`}</TableCell>
                    <TableCell className="tabular-nums">{recordedMoney(perClient)}</TableCell>
                    <TableCell className="font-semibold tabular-nums">{recordedMoney(tenant.fundedYtdCents)}</TableCell>
                    <TableCell className="text-right"><Button aria-label={`Manage access for ${tenant.name}`} onClick={() => setPendingSuspension(tenant.id)} size="sm" variant="outline">Manage</Button></TableCell>
                  </TableRow>
                );
              })}</TableBody>
            </Table>
          </div>
          <div className="divide-y divide-border md:hidden">
            {filtered.map((tenant) => {
              const membership = membershipLabel(tenant.membership);
              const perClient = tenant.fundedYtdCents !== null && tenant.clients
                ? Math.round(tenant.fundedYtdCents / tenant.clients)
                : null;
              return (
                <MobileRecord
                  action={<Button aria-label={`Manage access for ${tenant.name}`} className="min-h-11" onClick={() => setPendingSuspension(tenant.id)} variant="outline">Manage</Button>}
                  fields={[{ label: "Plan", value: membershipLabel(tenant.plan) }, { label: "Clients", value: tenant.clients }, { label: "Started", value: tenant.startedAt ? formatDate(tenant.startedAt) : "—" }, { label: "Avg time to optimize", value: tenant.fundingReadyDays === null ? "No history" : `${tenant.fundingReadyDays} days` }, { label: "Avg funding / client", value: recordedMoney(perClient) }, { label: "Funded YTD", value: recordedMoney(tenant.fundedYtdCents) }]}
                  key={tenant.id}
                  status={<StatusPill tone={tenant.membership === "current" ? "success" : tenant.membership === "trial" ? "info" : "danger"}>{membership}</StatusPill>}
                  subtitle={`${tenant.slug}.mostfundable.com`}
                  title={tenant.name}
                />
              );
            })}
          </div>
          </> : null}
      </Panel>
    </>
  );
}

/** No lender catalog to read from: five empty windows, so the tables render nothing rather than a shorter fixture. */
const EMPTY_BANK_STATS: Record<OutcomePeriod, BankHistoricalStat[]> = Object.fromEntries(
  OUTCOME_PERIODS.map((period) => [period.id, [] as BankHistoricalStat[]]),
) as Record<OutcomePeriod, BankHistoricalStat[]>;

function LendersView({ vaultEnabled = false }: { vaultEnabled?: boolean }) {
  const [bankVaultTab, setBankVaultTab] = useState<"banks" | "industry-updates">("banks");
  // FEATURE_VAULT (Phase 8), the same swap the operator Bank Vault made — the
  // admin caller is the one that never adopted it, so both of its bank tables
  // and every trend panel underneath them were computed from seven illustrative
  // lenders and the fixture provider's invented outcome book, on a page whose
  // whole subject is the canonical lender record.
  //
  // Fixtures remain the answer for exactly one case, the flag being off, which
  // is the fixture shell. A read that is loading or refused renders no rows and
  // says which, because illustrative approval rates shown to a platform
  // administrator reviewing lender policy are worse than an empty table.
  const { bankStatsByPeriod: fixtureBankStats } = useFeedbackSession();
  const vaultBanks = useVaultBanks(vaultEnabled, true);
  const source = bankVaultSource(vaultEnabled, vaultBanks.state);
  const bankStatsByPeriod =
    source === "durable" && vaultBanks.byPeriod
      ? vaultBanks.byPeriod
      : source === "fixtures"
        ? fixtureBankStats
        : EMPTY_BANK_STATS;
  const unreadableReason =
    source === "loading"
      ? "Loading the lender catalog"
      : source === "failed"
        ? "The lender catalog could not be read, so no bank outcome is shown"
        : null;
  return (
    <>
      <PageHeader title="Bank Vault" />
      <PillTabs
        onChange={setBankVaultTab}
        tabs={[
          { label: "Banks", value: "banks" },
          { label: "Industry updates", value: "industry-updates" },
        ]}
        value={bankVaultTab}
      />
      <div hidden={bankVaultTab !== "banks"}><LendersBody bankStatsByPeriod={bankStatsByPeriod} unreadableReason={unreadableReason} vaultEnabled={vaultEnabled} /></div>
      <div hidden={bankVaultTab !== "industry-updates"}><IndustryUpdatesBody bankStatsByPeriod={bankStatsByPeriod} unreadableReason={unreadableReason} /></div>
    </>
  );
}

function LendersBody({
  bankStatsByPeriod,
  unreadableReason,
  vaultEnabled = false,
}: {
  bankStatsByPeriod: Record<OutcomePeriod, BankHistoricalStat[]>;
  unreadableReason: string | null;
  vaultEnabled?: boolean;
}) {
  const { actorName, bankComments, recordAudit, setBankComments } = useAdminSession();
  // The pending correction queue, read from `outcome_reviews` rather than from
  // the demo session. Nothing here decides anything on load: a row leaves the
  // queue only when an admin posts a decision on it.
  const { read: reviewRead, reload: reloadReviews } = useAdminResource("/api/admin/outcome-reviews", parseAdminReviewQueue);
  const reviewQueue = isAdminReady(reviewRead) && reviewRead.enabled ? reviewRead.reviews : null;
  const reviewReason = isAdminReady(reviewRead) && !reviewRead.enabled
    ? "Recorded outcomes not enabled"
    : adminReadReason(reviewRead, "Recorded outcomes not enabled");
  const [deciding, setDeciding] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<OutcomePeriod>("30d");
  const [detailBankId, setDetailBankId] = useState<string | null>(null);
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  const [commentBank, setCommentBank] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [note, setNote] = useState("");
  const filtered = bankStatsByPeriod[period].filter((bank) =>
    bank.bankName.toLowerCase().includes(query.toLowerCase()),
  );
  // Every lender name on this page now comes from whichever catalog rendered
  // the table above, so the comment picker cannot offer a lender the vault does
  // not hold — which is what listing the seven fixture banks here did.
  const catalog = bankStatsByPeriod["30d"];
  const commentTarget = catalog.find((bank) => bank.bankId === commentBank) ?? catalog[0] ?? null;
  const vaultBankDetail = useVaultBankDetail(vaultEnabled, detailBankId);
  const detailSource = bankVaultSource(vaultEnabled, vaultBankDetail.state);
  const durableBankDetail =
    detailSource === "durable" && vaultBankDetail.detail
      ? toBankDetail(vaultBankDetail.detail)
      : null;

  function stageComment() {
    if (!comment.trim() || !commentTarget) return;
    const bankName = commentTarget.bankName;
    const body = comment.trim();
    setBankComments((current) => [
      { author: actorName, bankName, body, createdAt: "Today", id: nextBankCommentId(current), status: "In review" },
      ...current,
    ]);
    setComment("");
    setCommentDialogOpen(false);
    setNote(`${bankName} comment saved to staged review. Published BANK VAULT data is unchanged.`);
    recordAudit({ action: `Staged BANK VAULT comment for ${bankName}`, target: `bank_review.${commentTarget.bankId}`, risk: "Review" });
  }

  /**
   * Post the platform admin's correction and re-read the queue.
   *
   * `approved` and `removed` are the only two decisions `/api/outcomes/[id]/review`
   * accepts; the route's own message says what actually happened to the record,
   * so it is shown verbatim rather than restated in words this surface guessed.
   */
  async function decideOutcome(outcomeId: string, operatorName: string, decision: "approved" | "removed") {
    setDeciding(outcomeId);
    setNote("");
    try {
      const response = await fetch(`/api/outcomes/${outcomeId}/review`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) {
        setNote("The correction did not complete. The recorded outcome is unchanged.");
        return;
      }
      const body = (await response.json()) as { message?: unknown };
      reloadReviews();
      setNote(typeof body.message === "string" && body.message
        ? `${operatorName}: ${body.message}`
        : "The correction is recorded.");
      recordAudit({ action: `${decision === "approved" ? "Approved" : "Corrected"} recorded outcome ${outcomeId}`, target: `outcomes.${outcomeId}`, risk: decision === "approved" ? "Review" : "High" });
    } catch {
      setNote("The correction did not complete. The recorded outcome is unchanged.");
    } finally {
      setDeciding(null);
    }
  }

  return (
    <>
      <div className="mb-4"><Notice>{vaultEnabled
        ? "Bank details read a lender catalog synced nightly from CCA VAULT. Historical outcomes are records, not offers, and this page performs no automatic writes."
        : "Bank details use illustrative local fixtures. Historical outcomes are records, not offers, and this page performs no automatic writes."}</Notice></div>
      {unreadableReason ? <div className="mb-4"><Notice tone="warning">{unreadableReason}</Notice></div> : null}
      {note ? <div className="mb-4"><Notice>{note}</Notice></div> : null}
      <AdminBankCatalogManagement enabled={vaultEnabled} onMutation={recordAudit} />
      <ViewToolbar>
        <SearchField onChange={setQuery} placeholder="Search banks" value={query} />
        <AdminSelect
          ariaLabel="Outcome period"
          onChange={(value) => setPeriod(OUTCOME_PERIODS.find((item) => item.label === value)?.id ?? "30d")}
          options={OUTCOME_PERIODS.map((item) => item.label)}
          value={OUTCOME_PERIODS.find((item) => item.id === period)?.label ?? "30 days"}
        />
        <span className="text-xs text-muted-foreground sm:ml-auto">{OUTCOME_PERIODS.find((item) => item.id === period)?.label} · <span className="tabular-nums">{filtered.length}</span> banks</span>
      </ViewToolbar>
      <Panel
        title="Historical bank outcomes"
        description="Selected-period rates and funded averages recompute when a reviewed outcome is removed"
        trailing={
          <Button
            aria-label="Leave a bank comment"
            className="min-h-11"
            disabled={commentTarget === null}
            onClick={() => setCommentDialogOpen(true)}
            size="sm"
            variant="outline"
          >
            <MessageSquareText aria-hidden /> Leave a comment
          </Button>
        }
      >
        <div className="hidden overflow-x-auto md:block">
          <Table className="min-w-[980px]">
            <TableHeader><TableRow><TableHead>Bank</TableHead><TableHead>Products</TableHead><TableHead>Outcomes</TableHead><TableHead>Historical approval rate</TableHead><TableHead>Average funded</TableHead><TableHead>Heat Level</TableHead><TableHead className="text-right">Comments</TableHead></TableRow></TableHeader>
            <TableBody>{filtered.map((bank) => {
              const commentCount = bankComments.filter((entry) => entry.bankName === bank.bankName).length;
              return (
                <TableRow key={bank.bankId}>
                  <TableCell>
                    <button
                      className="inline-flex min-h-6 items-center text-left font-semibold underline-offset-4 hover:text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setDetailBankId(bank.bankId)}
                      type="button"
                    >
                      {bank.bankName}
                    </button>
                  </TableCell>
                  <TableCell>{bank.products.join(", ")}</TableCell>
                  <TableCell className="tabular-nums">{bank.outcomes}</TableCell>
                  <TableCell>{bank.outcomes ? <ProgressMeter label={`${bank.bankName} historical approval rate`} value={bank.approvalRate} /> : <span className="text-xs text-muted-foreground">No decided outcomes</span>}</TableCell>
                  <TableCell className="font-semibold tabular-nums">{bank.fundedCount ? formatDemoMoney(bank.averageFundedAmount) : "No funded outcomes"}</TableCell>
                  <TableCell><StatusPill tone={bank.momentum === "hot" ? "success" : bank.momentum === "fair" ? "warning" : "neutral"}>{titleCase(bank.momentum)}</StatusPill></TableCell>
                  <TableCell className="text-right"><Button aria-label={`Comment on ${bank.bankName}`} onClick={() => { setCommentBank(bank.bankId); setCommentDialogOpen(true); }} size="sm" variant="outline">{commentCount ? `Comment (${commentCount})` : "Comment"}</Button></TableCell>
                </TableRow>
              );
            })}</TableBody>
          </Table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {filtered.map((bank) => (
            <MobileRecord
              action={<><Button className="min-h-11" onClick={() => setDetailBankId(bank.bankId)} variant="outline">Open bank detail</Button><Button className="min-h-11" onClick={() => { setCommentBank(bank.bankId); setCommentDialogOpen(true); }} variant="outline">Add comment</Button></>}
              fields={[{ label: "Outcomes", value: bank.outcomes }, { label: "Historical approval rate", value: formatDemoPercent(bank.approvalRate) }, { label: "Average funded", value: bank.fundedCount ? formatDemoMoney(bank.averageFundedAmount) : "No funded outcomes" }, { label: "Comments in review", value: String(bankComments.filter((entry) => entry.bankName === bank.bankName).length) }]}
              key={bank.bankId}
              status={<StatusPill tone={bank.momentum === "hot" ? "success" : bank.momentum === "fair" ? "warning" : "neutral"}>{titleCase(bank.momentum)}</StatusPill>}
              subtitle={bank.products.join(", ")}
              title={bank.bankName}
            />
          ))}
        </div>
      </Panel>

      <div className="mt-5">
        <Panel title="Application outcome review" description={reviewQueue === null ? reviewReason : "Approve an outcome into the demo knowledge context or deny and delete it; the operator is notified either way"}>
          {reviewQueue === null ? <p className="text-sm leading-6 text-muted-foreground">{reviewReason}</p> : (
          <div className="divide-y divide-border">
            {reviewQueue.map((review) => (
                <MobileRecord
                  action={
                    <>
                      <Button disabled={deciding !== null} onClick={() => void decideOutcome(review.outcomeId, review.operatorName, "approved")} size="sm">Approve &amp; notify</Button>
                      <Button disabled={deciding !== null} onClick={() => void decideOutcome(review.outcomeId, review.operatorName, "removed")} size="sm" variant="outline">Deny &amp; delete</Button>
                    </>
                  }
                  fields={[
                    { label: "Result", value: review.kind ? titleCase(review.kind) : "—" },
                    { label: "Amount", value: centsMoney(review.amountCents, false) },
                    { label: "Recorded by", value: review.recordedBy ?? "—" },
                    { label: "Recorded", value: review.decidedOn ? formatDate(review.decidedOn) : "—" },
                  ]}
                  key={review.outcomeId}
                  status={<StatusPill tone="warning">Review</StatusPill>}
                  subtitle={`${review.bankRef} · ${review.operatorName}`}
                  title={review.clientName}
                />
            ))}
          </div>
          )}
        </Panel>
      </div>

      <Dialog onOpenChange={setCommentDialogOpen} open={commentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Comment · {commentTarget?.bankName ?? "Select a bank"}
            </DialogTitle>
            <DialogDescription>
              Approved comments would join the CCA VAULT Supabase as knowledge
              the AI uses. Nothing here publishes: a saved comment stays in
              staged review and alters no lender record and no AI context.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground" htmlFor="admin-bank-comment-target">Bank</label>
              <AdminSelect
                ariaLabel="Comment bank"
                className="mt-1 w-full"
                onChange={(value) => setCommentBank(catalog.find((bank) => bank.bankName === value)?.bankId ?? null)}
                options={catalog.map((bank) => bank.bankName)}
                value={commentTarget?.bankName ?? ""}
              />
            </div>
            {bankComments
              .filter((entry) => entry.bankName === commentTarget?.bankName)
              .map((entry) => (
                <div className="rounded-lg border border-border bg-muted/30 p-3" key={entry.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{entry.author} · {entry.createdAt}</span>
                    <StatusPill tone="warning">{entry.status}</StatusPill>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{entry.body}</p>
                </div>
              ))}
            <Textarea aria-label="Bank comment" onChange={(event) => setComment(event.target.value)} placeholder="Add sourced context for review" value={comment} />
          </div>
          <DialogFooter>
            <Button onClick={() => setCommentDialogOpen(false)} variant="outline">Close</Button>
            <Button disabled={!comment.trim()} onClick={stageComment}>Save to staged review</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        Phase 8's two props, which this caller never adopted: without them the
        sheet fell back to `BANK_DETAILS[bank.bankId]` for every lender, so a
        platform administrator opening a synced lender read an invented deposit
        minimum and an "Open illustrative online application" link to
        example.com. With them, the fixture map is reachable only on the
        flag-off shell, and a failed detail read says so instead.
      */}
      <BankDetailSheet
        bank={bankStatsByPeriod["30d"].find((bank) => bank.bankId === detailBankId) ?? null}
        durableDetail={durableBankDetail}
        durableState={vaultEnabled ? vaultBankDetail.state : null}
        fixtureDetailAllowed={false}
        onClose={() => setDetailBankId(null)}
      />
    </>
  );
}

function BankTrendsSection({
  bankStatsByPeriod,
  unreadableReason,
}: {
  bankStatsByPeriod: Record<OutcomePeriod, BankHistoricalStat[]>;
  unreadableReason: string | null;
}) {
  const recent = bankStatsByPeriod["30d"];
  const yearly = bankStatsByPeriod["12mo"];
  const rows = yearly
    .map((year) => {
      const month = recent.find((bank) => bank.bankId === year.bankId);
      const monthlyAverageOutcomes = year.outcomes / 12;
      const recentOutcomes = month?.outcomes ?? 0;
      const volumeTrend: "up" | "down" | "flat" =
        recentOutcomes > monthlyAverageOutcomes * 1.15
          ? "up"
          : recentOutcomes < monthlyAverageOutcomes * 0.85
            ? "down"
            : "flat";
      const approvalDelta =
        month && month.outcomes && year.outcomes
          ? month.approvalRate - year.approvalRate
          : null;
      return {
        approvalDelta,
        bankName: year.bankName,
        monthApproval: month?.outcomes ? month.approvalRate : null,
        recentOutcomes,
        volumeTrend,
        yearApproval: year.outcomes ? year.approvalRate : null,
      };
    })
    .sort((left, right) => right.recentOutcomes - left.recentOutcomes);
  const totalRecent = rows.reduce((total, row) => total + row.recentOutcomes, 0);
  const risers = rows.filter((row) => (row.approvalDelta ?? 0) > 2);
  const fallers = rows.filter((row) => (row.approvalDelta ?? 0) < -2);

  return (
    <div className="space-y-5">
      <Panel
        title="This period in the vault"
        description="Recorded outcomes over the last 30 days compared with the trailing 12-month pace · history, not offers or predictions"
      >
        {unreadableReason ? <p className="text-sm leading-6 text-muted-foreground">{unreadableReason}</p> : <p className="text-sm leading-6 text-muted-foreground">
          Operators recorded {formatDemoNumber(totalRecent)} bank outcomes in
          the last 30 days.{" "}
          {risers.length
            ? `${risers.map((row) => row.bankName).join(" and ")} ${risers.length === 1 ? "is" : "are"} approving at a higher rate than the trailing year. `
            : "No bank is approving meaningfully above its trailing-year rate. "}
          {fallers.length
            ? `${fallers.map((row) => row.bankName).join(" and ")} ${fallers.length === 1 ? "is" : "are"} running below the trailing-year approval rate.`
            : "No bank is running meaningfully below its trailing-year approval rate."}
        </p>}
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {rows.map((row) => (
          <Panel
            key={row.bankName}
            title={row.bankName}
            trailing={
              <StatusPill tone={row.volumeTrend === "up" ? "success" : row.volumeTrend === "down" ? "warning" : "neutral"}>
                {row.volumeTrend === "up" ? "Funding more" : row.volumeTrend === "down" ? "Funding less" : "Steady"}
              </StatusPill>
            }
          >
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Outcomes · 30 days</dt>
                <dd className="mt-1 font-semibold tabular-nums">{formatDemoNumber(row.recentOutcomes)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Approval · 30 days</dt>
                <dd className="mt-1 font-semibold tabular-nums">{row.monthApproval === null ? "None" : formatDemoPercent(row.monthApproval)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Approval · 12 months</dt>
                <dd className="mt-1 font-medium tabular-nums">{row.yearApproval === null ? "None" : formatDemoPercent(row.yearApproval)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Direction</dt>
                <dd className="mt-1 font-medium">
                  {row.approvalDelta === null
                    ? "Not enough recent outcomes"
                    : row.approvalDelta > 2
                      ? "Approvals trending up"
                      : row.approvalDelta < -2
                        ? "Approvals trending down"
                        : "Approvals steady"}
                </dd>
              </div>
            </dl>
          </Panel>
        ))}
      </div>
      <p className="font-mono text-[0.62rem] uppercase leading-5 tracking-[0.08em] text-muted-foreground">
        Derived from recorded historical outcomes · not offers, predictions, or approval odds
      </p>
    </div>
  );
}

function IndustryUpdatesBody({
  bankStatsByPeriod,
  unreadableReason,
}: {
  bankStatsByPeriod: Record<OutcomePeriod, BankHistoricalStat[]>;
  unreadableReason: string | null;
}) {
  const { actorName, bankComments, intelDecisions, recordAudit, setBankComments, setIntelDecisions } = useAdminSession();
  const [intelMode, setIntelMode] = useState<"trends" | "findings">("trends");
  const [bank, setBank] = useState("All banks");
  const [tier, setTier] = useState("All tiers");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [commentFor, setCommentFor] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const banks = ["All banks", ...Array.from(new Set(INTEL_ITEMS.map((item) => item.bank)))];
  const visibleItems = INTEL_ITEMS.filter((item) => !intelDecisions[item.id] && (bank === "All banks" || item.bank === bank) && (tier === "All tiers" || item.tier === tier));

  function toggleSelected(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function decide(ids: string[], decision: "promoted" | "rejected") {
    setIntelDecisions((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, decision])) }));
    ids.forEach((id) => {
      const item = INTEL_ITEMS.find((candidate) => candidate.id === id);
      recordAudit({ action: `${decision === "promoted" ? "Promoted" : "Rejected"} staged finding ${id}`, target: `intel.${item?.bank.toLowerCase().replace(/[^a-z0-9]+/g, "_") ?? id}`, risk: "Review" });
    });
    setSelected([]);
    setConfirmBulk(false);
    setNote(`${ids.length} ${ids.length === 1 ? "finding" : "findings"} ${decision}. The audit trail records source and reviewer.`);
  }

  function commentsFor(bankName: string) {
    return bankComments.filter((entry) => entry.bankName === bankName);
  }

  function addComment(item: IntelItem) {
    const body = (drafts[item.id] ?? "").trim();
    if (!body) return;
    setBankComments((current) => [
      { author: actorName, bankName: item.bank, body, createdAt: "Today", id: nextBankCommentId(current), status: "In review" },
      ...current,
    ]);
    setDrafts((current) => ({ ...current, [item.id]: "" }));
    recordAudit({ action: `Added review comment on ${item.bank}`, target: `bank_review.${item.bank.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, risk: "Review" });
    setNote(`Comment noted for ${item.bank} in this session. Published lender records and AI context are unchanged.`);
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <StatusPill tone="warning">{INTEL_ITEMS.length - Object.keys(intelDecisions).length} pending</StatusPill>
      </div>
      <PillTabs
        onChange={setIntelMode}
        tabs={[
          { label: "Bank trends", value: "trends" },
          { label: `Staged findings · ${INTEL_ITEMS.length - Object.keys(intelDecisions).length}`, value: "findings" },
        ]}
        value={intelMode}
      />
      {intelMode === "trends" ? <BankTrendsSection bankStatsByPeriod={bankStatsByPeriod} unreadableReason={unreadableReason} /> : (
      <>
      {/*
        The three ingestion tiles are gone. They reported "Slack ingestion ·
        Synced 4 min ago · #lender-intel" and "Last call processed · Today 1:42
        PM · Bluevine underwriting debrief" — a live pipeline with a recent
        timestamp, on a platform that ingests no Slack channel and transcribes
        no call. Only the third tile was true, and a review gate over an empty
        queue is what the queue below already shows.
      */}
      {note ? <div className="mb-4"><Notice tone="success">{note}</Notice></div> : null}
      <ViewToolbar><AdminSelect ariaLabel="Intel bank" onChange={setBank} options={banks} value={bank} /><AdminSelect ariaLabel="Intel confidence tier" onChange={setTier} options={["All tiers", "confirmed", "probable", "speculating"]} value={tier} /><Button onClick={() => setSelected(visibleItems.filter((item) => item.sources >= 2).map((item) => item.id))} size="sm" variant="link">Select confirmed with 2+ sources</Button><span className="text-xs text-muted-foreground sm:ml-auto"><span className="tabular-nums">{visibleItems.length}</span> findings</span></ViewToolbar>

      {selected.length > 0 ? (
        <div className="mb-4 rounded-lg border border-primary/20 bg-primary/8 p-3">
          {!confirmBulk ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center"><p className="text-sm font-semibold"><span className="tabular-nums">{selected.length}</span> selected</p><div className="flex flex-wrap gap-2 sm:ml-auto"><Button onClick={() => setConfirmBulk(true)} size="sm">Promote selected</Button><Button onClick={() => decide(selected, "rejected")} size="sm" variant="destructive">Reject selected</Button><Button onClick={() => setSelected([])} size="sm" variant="ghost">Clear</Button></div></div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center"><p className="text-sm"><span className="font-semibold">Confirm promotion.</span> Promotion is recorded against this browser session only; no canonical lender record is written from this page.</p><div className="flex gap-2 sm:ml-auto"><Button onClick={() => decide(selected, "promoted")} size="sm"><Check aria-hidden />Confirm</Button><Button onClick={() => setConfirmBulk(false)} size="sm" variant="outline">Cancel</Button></div></div>
          )}
        </div>
      ) : null}

      <Panel title="Staged findings" description="Confidence is evidence strength, not a lending prediction">
        {visibleItems.length ? (
          <>
            <div className="hidden md:block">
              <Table className="min-w-[1120px]">
                <TableHeader><TableRow><TableHead className="w-10"><span className="sr-only">Select</span></TableHead><TableHead>Finding</TableHead><TableHead>Type</TableHead><TableHead>Bank</TableHead><TableHead>Source</TableHead><TableHead>Confidence</TableHead><TableHead>Sources</TableHead><TableHead>Tier</TableHead><TableHead className="text-right">Decision</TableHead></TableRow></TableHeader>
                <TableBody>{visibleItems.map((item) => (
                  <Fragment key={item.id}>
                    <TableRow>
                      <TableCell><input aria-label={`Select ${item.title}`} checked={selected.includes(item.id)} className="size-4 rounded border-input accent-primary focus-visible:ring-2 focus-visible:ring-ring" onChange={() => toggleSelected(item.id)} type="checkbox" /></TableCell>
                      <TableCell className="max-w-sm whitespace-normal"><p className="font-semibold leading-5">{item.title}</p>{item.bank === "Truist" ? <p className="mt-1 text-xs text-[var(--consumer-warning-ink)]">Conflicts with published policy</p> : null}</TableCell>
                      <TableCell><StatusPill tone="neutral">{titleCase(item.type)}</StatusPill></TableCell><TableCell>{item.bank}</TableCell><TableCell className="text-xs text-muted-foreground">{item.source}</TableCell><TableCell><ProgressMeter label={`${item.title} confidence`} value={item.confidence} /></TableCell><TableCell className="tabular-nums">{item.sources}</TableCell>
                      <TableCell><StatusPill tone={item.tier === "confirmed" ? "success" : item.tier === "probable" ? "info" : "warning"}>{titleCase(item.tier)}</StatusPill></TableCell>
                      <TableCell><div className="flex justify-end gap-1"><Button aria-label={`Promote ${item.title}`} onClick={() => decide([item.id], "promoted")} size="xs">Promote</Button><Button aria-label={`Edit ${item.title}`} onClick={() => setNote(`Editing ${item.bank}. Changes remain staged until promotion.`)} size="xs" variant="outline">Edit</Button><Button aria-expanded={commentFor === item.id} aria-label={`Comment on ${item.title}`} onClick={() => setCommentFor((current) => (current === item.id ? null : item.id))} size="xs" variant="outline">Comment{commentsFor(item.bank).length ? ` (${commentsFor(item.bank).length})` : ""}</Button><Button aria-label={`Reject ${item.title}`} onClick={() => decide([item.id], "rejected")} size="icon-xs" variant="ghost"><X aria-hidden /></Button></div></TableCell>
                    </TableRow>
                    {commentFor === item.id ? (
                      <TableRow>
                        <TableCell className="bg-muted/30" colSpan={9}>
                          <div className="space-y-3 py-1">
                            {commentsFor(item.bank).length ? (
                              <div className="space-y-2">
                                {commentsFor(item.bank).map((entry) => (
                                  <div className="rounded-lg border border-border bg-card p-3" key={entry.id}>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-semibold">{entry.author} · {entry.createdAt}</span>
                                      <StatusPill tone="warning">{entry.status}</StatusPill>
                                    </div>
                                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{entry.body}</p>
                                  </div>
                                ))}
                              </div>
                            ) : <p className="text-xs text-muted-foreground">No comments on {item.bank} yet.</p>}
                            <Textarea aria-label={`Comment on ${item.bank}`} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Add sourced context for review" value={drafts[item.id] ?? ""} />
                            <Button disabled={!(drafts[item.id] ?? "").trim()} onClick={() => addComment(item)} size="sm">Save to review</Button>
                            <p className="text-xs leading-5 text-muted-foreground">This comment stays in this browser session. No reviewer, lender record, AI context, or external system receives it, because no staged-intel review queue exists yet.</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}</TableBody>
              </Table>
            </div>
            <div className="divide-y divide-border md:hidden">
              {visibleItems.map((item) => (
                <MobileRecord
                  action={<><label className="flex min-h-11 items-center gap-2 pr-2 text-sm font-medium"><input aria-label={`Select ${item.title}`} checked={selected.includes(item.id)} className="size-4 rounded border-input accent-primary" onChange={() => toggleSelected(item.id)} type="checkbox" />Select</label><Button aria-label={`Promote ${item.title}`} className="min-h-11" onClick={() => decide([item.id], "promoted")}>Promote</Button><Button aria-label={`Reject ${item.title}`} className="min-h-11" onClick={() => decide([item.id], "rejected")} variant="outline">Reject</Button></>}
                  fields={[{ label: "Bank", value: item.bank }, { label: "Confidence", value: `${item.confidence}%` }, { label: "Sources", value: item.sources }, { label: "Type", value: item.type }, { label: "Comments in review", value: String(commentsFor(item.bank).length) }, { label: "Source", value: item.source, wide: true }]}
                  key={item.id}
                  status={<StatusPill tone={item.tier === "confirmed" ? "success" : item.tier === "probable" ? "info" : "warning"}>{titleCase(item.tier)}</StatusPill>}
                  subtitle={item.bank === "Truist" ? "Conflicts with published policy" : undefined}
                  title={item.title}
                />
              ))}
            </div>
          </>
        ) : <EmptyState title="Queue clear" description="No staged findings match these filters. New Slack and call findings will appear here before publication." />}
        <p className="mt-4 border-t border-border pt-4 font-mono text-[0.62rem] uppercase leading-5 tracking-[0.08em] text-muted-foreground">Staged intel and review comments → human review → canonical lender records</p>
      </Panel>
      </>
      )}
    </>
  );
}

type TrainingEditor = AdminTrainingInput & {
  id: string | null;
  source: AdminTraining["source"];
  sourceFile: File | null;
  storedSourceFile: AdminTraining["sourceFile"];
};

function emptyTrainingEditor(): TrainingEditor {
  return { audience: "operator", body: "", id: null, source: "platform", sourceFile: null, storedSourceFile: null, title: "", videoUrl: "" };
}

function trainingEditorFor(training: AdminTraining): TrainingEditor {
  return {
    audience: training.audience,
    body: training.body,
    id: training.id,
    source: training.source,
    sourceFile: null,
    storedSourceFile: training.sourceFile,
    title: training.title,
    videoUrl: training.videoUrl,
  };
}

function trainingFailureMessage(error: unknown, action: string): string {
  if (error instanceof AdminTrainingClientError) {
    if (error.code === "console_ops_disabled") return "Platform takedowns are unavailable because console operations are disabled.";
    if (error.code.includes("attestation_required")) return "Publishing is unavailable because the platform attestation is not configured.";
    if (error.code.includes("training_published")) return "Published trainings must be unpublished before deletion.";
    if (error.code.includes("source_required")) return "Choose a PDF, Word, or text source before publishing this platform training.";
    if (error.code.includes("source_size_invalid")) return "The source file must be between 1 byte and 6 MB.";
    if (error.code.includes("source_type_invalid")) return "Use a PDF, DOC, DOCX, or TXT source file whose extension matches its file type.";
    if (error.code.includes("source_name_invalid")) return "Choose a source file with a usable filename.";
    if (error.code.includes("video_invalid")) return "Use an HTTPS YouTube, Vimeo, or Loom video URL.";
  }
  return `${action} could not be confirmed. No browser-only change was applied.`;
}

function trainingMutationConfirmed(
  rows: readonly AdminTraining[],
  mutationRow: AdminTraining,
  matchesTarget: (training: AdminTraining) => boolean,
): boolean {
  const readBack = rows.find((training) => training.id === mutationRow.id);
  return matchesTarget(mutationRow)
    && readBack !== undefined
    && matchesTarget(readBack)
    && JSON.stringify(readBack) === JSON.stringify(mutationRow);
}

function TrainingsView({ durableWorkspace }: { durableWorkspace: boolean }) {
  const { knowledgePages } = useAdminSession();
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("All sources");
  const [audienceFilter, setAudienceFilter] = useState("All audiences");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [config, setConfig] = useState<AdminTrainingConfig | null>(null);
  const [trainings, setTrainings] = useState<readonly AdminTraining[]>([]);
  const [editor, setEditor] = useState<TrainingEditor | null>(null);
  const [attested, setAttested] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "success" | "warning" } | null>(null);
  const [unpublishDraft, setUnpublishDraft] = useState<{ id: string; reason: string; title: string } | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<AdminTraining | null>(null);
  /**
   * Whether the rows below are the platform's trainings or the seeded library.
   *
   * The effect below replaced `KNOWLEDGE_PAGES` only when the config read
   * succeeded, reported `enabled`, AND the list read also succeeded. Every other
   * path — a 500 on either request, a network failure, a malformed body — left
   * the seeded titles on screen with no mark on them, so an outage looked like a
   * healthy library and a platform administrator could not tell that the six
   * trainings in front of them were nobody's (the G-HOST-14 class). Now every
   * path lands in one of five named states, and only `ready` and `fixture` put
   * rows on the page.
   *
   * `fixture` is reachable only without a session. A signed-in administrator on
   * a deployment where `FEATURE_ANCILLARY` is off gets `not-enabled` instead,
   * because the six seeded titles below are nobody's trainings and a flag being
   * off is not a reason to attribute them to the platform (the browser walk of
   * this lane found exactly that: six lessons and "5 published" over a workspace
   * that has published none).
   */
  const [libraryState, setLibraryState] = useState<"loading" | "ready" | "fixture" | "not-enabled" | "unavailable">("loading");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTrainings = libraryState === "ready" ? trainings.filter((training) =>
    `${training.title} ${training.body} ${training.videoUrl}`.toLowerCase().includes(normalizedQuery)
      && (sourceFilter === "All sources" || training.source === sourceFilter.toLowerCase())
      && (audienceFilter === "All audiences" || training.audience === (audienceFilter === "Clients" ? "client" : "operator"))
      && (statusFilter === "All statuses" || training.published === (statusFilter === "Published"))) : [];
  const filteredFixtures = libraryState === "fixture"
    ? knowledgePages.filter((page) => page.title.toLowerCase().includes(normalizedQuery))
    : [];
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loadedConfig = await loadAdminTrainingConfig();
        if (!active) return;
        setConfig(loadedConfig);
        if (!loadedConfig.enabled) {
          setLibraryState(durableWorkspace ? "not-enabled" : "fixture");
          return;
        }
        const rows = await loadAdminTrainings();
        if (!active) return;
        setTrainings(rows);
        setLibraryState("ready");
      } catch {
        if (active) setLibraryState("unavailable");
      }
    })();
    return () => { active = false; };
  }, [durableWorkspace]);

  async function mutateTrainingAndReadBack<Result>(
    key: string,
    action: () => Promise<Result>,
    confirmsTarget: (rows: readonly AdminTraining[], result: Result) => boolean,
    successMessage: string,
    actionLabel: string,
  ): Promise<"confirmed" | "failed" | "unconfirmed"> {
    setBusy(key);
    setNotice(null);
    try {
      const actionResult = await action();
      try {
        const rows = await loadAdminTrainings();
        setTrainings(rows);
        setLibraryState("ready");
        setAttested(new Set());
        if (!confirmsTarget(rows, actionResult)) {
          setNotice({
            message: `${actionLabel} returned without the requested state in the durable training library. The latest server rows are shown, and no success was recorded.`,
            tone: "warning",
          });
          return "unconfirmed";
        }
        setNotice({ message: successMessage, tone: "success" });
        return "confirmed";
      } catch {
        setTrainings([]);
        setLibraryState("unavailable");
        setNotice({
          message: "The server accepted the change, but the training library could not be read back. Reload before making another change.",
          tone: "warning",
        });
        return "unconfirmed";
      }
    } catch (error) {
      if (!(error instanceof AdminTrainingClientError)) {
        setTrainings([]);
        setLibraryState("unavailable");
      }
      setNotice({ message: trainingFailureMessage(error, actionLabel), tone: "warning" });
      return "failed";
    } finally {
      setBusy(null);
    }
  }

  async function saveEditor(): Promise<void> {
    if (!editor || libraryState !== "ready") return;
    const input: AdminTrainingInput = {
      audience: editor.audience,
      body: editor.body.trim(),
      title: editor.title.trim(),
      videoUrl: editor.videoUrl.trim(),
    };
    const creating = editor.id === null;
    const selectedSourceFile = editor.sourceFile;
    let save: () => Promise<AdminTraining>;
    if (creating) {
      if (selectedSourceFile === null) return;
      save = () => createAdminTraining({ ...input, sourceFile: selectedSourceFile });
    } else {
      save = () => updateAdminTraining(editor.id as string, { ...input, ...(selectedSourceFile ? { sourceFile: selectedSourceFile } : {}) });
    }
    const result = await mutateTrainingAndReadBack(
      creating ? "create" : `edit:${editor.id}`,
      save,
      (rows, saved) => trainingMutationConfirmed(rows, saved, (candidate) =>
        (creating || candidate.id === editor.id)
        && candidate.source === editor.source
        && candidate.audience === input.audience
        && candidate.title === input.title
        && candidate.videoUrl === input.videoUrl
        && candidate.body === input.body
        && (selectedSourceFile === null || (
          candidate.sourceFile?.fileName === selectedSourceFile.name
          && candidate.sourceFile.mimeType === selectedSourceFile.type
          && candidate.sourceFile.sizeBytes === selectedSourceFile.size
        ))),
      creating ? "Training draft created and confirmed by server read-back." : "Training saved and confirmed by server read-back.",
      creating ? "Creating the training" : "Saving the training",
    );
    if (result === "confirmed") setEditor(null);
  }

  async function publish(training: AdminTraining): Promise<void> {
    if (libraryState !== "ready" || !config?.attestationAvailable
        || (training.source === "platform" && !training.sourceFile)
        || !attested.has(training.id)) return;
    await mutateTrainingAndReadBack(
      `publish:${training.id}`,
      () => publishAdminTraining(training.id),
      (rows, published) => trainingMutationConfirmed(
        rows,
        published,
        (candidate) => candidate.id === training.id && candidate.published,
      ),
      "Training published and confirmed by server read-back.",
      "Publishing the training",
    );
  }

  async function unpublish(): Promise<void> {
    if (libraryState !== "ready" || !unpublishDraft?.reason.trim()) return;
    const result = await mutateTrainingAndReadBack(
      `unpublish:${unpublishDraft.id}`,
      () => unpublishAdminTraining(unpublishDraft.id, unpublishDraft.reason),
      (rows, unpublished) => trainingMutationConfirmed(
        rows,
        unpublished,
        (candidate) => candidate.id === unpublishDraft.id
          && !candidate.published
          && candidate.takedownReason === unpublishDraft.reason.trim(),
      ),
      "Training unpublished and the takedown record was confirmed by server read-back.",
      "Unpublishing the training",
    );
    if (result === "confirmed") setUnpublishDraft(null);
  }

  async function removeTraining(): Promise<void> {
    if (libraryState !== "ready" || !deleteCandidate || deleteCandidate.published) return;
    const result = await mutateTrainingAndReadBack(
      `delete:${deleteCandidate.id}`,
      () => deleteAdminTraining(deleteCandidate.id),
      (rows) => !rows.some((training) => training.id === deleteCandidate.id),
      "Training deleted and its absence confirmed by server read-back.",
      "Deleting the training",
    );
    if (result === "confirmed") setDeleteCandidate(null);
  }

  const editorComplete = editor !== null && editor.title.trim() !== ""
    && editor.videoUrl.trim() !== "" && editor.body.trim() !== ""
    && (editor.id !== null || editor.sourceFile !== null);
  const publishedCount = libraryState === "ready"
    ? trainings.filter((training) => training.published).length
    : libraryState === "fixture"
      ? knowledgePages.filter((page) => page.status === "Published").length
      : null;

  return (
    <>
      <PageHeader
        eyebrow="Platform training records"
        title="Client trainings"
        description="Create hosted-video lessons and govern the publication state of existing operator or platform records."
        actions={<Button disabled={libraryState !== "ready" || busy !== null} onClick={() => { setEditor(emptyTrainingEditor()); setNotice(null); }} title={libraryState === "ready" ? undefined : "The durable training library must load before authoring."}><Plus aria-hidden />New training</Button>}
      />
      {config?.enabled ? <p className="mb-4 text-sm text-muted-foreground">The training library below is the platform record operators read from their Trainings tab.</p> : null}
      <Panel className="mb-5 border-[color-mix(in_srgb,var(--consumer-warning-border),transparent_72%)] bg-[color-mix(in_srgb,var(--consumer-warning),transparent_88%)]" title="Platform guardrails are locked" description="Operators cannot disable these rules">
        <div className="flex items-start gap-3"><Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--consumer-warning-ink)]" /><p className="text-sm leading-6 text-muted-foreground">AI guidance stays within funding readiness and cannot provide tactics intended to alter furnished credit records. Every low-confidence response is held for human review.</p></div>
      </Panel>
      {notice ? <div className="mb-5"><Notice tone={notice.tone}>{notice.message}</Notice></div> : null}
      {editor ? (
        <Panel
          className="mb-5"
          title={editor.id === null ? "New platform training" : `Edit ${editor.title}`}
          description="Platform source and scope are fixed by the server. Saving a published record may return it to draft when console re-attestation is enabled."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs font-medium">Training title<Input aria-label="Training title" className="mt-1 min-h-11" maxLength={200} onChange={(event) => setEditor((current) => current ? { ...current, title: event.target.value } : current)} value={editor.title} /></label>
            <div className="text-xs font-medium">Source<p className="mt-1 flex min-h-11 items-center rounded-md border border-border bg-muted/30 px-3 text-sm font-normal">{titleCase(editor.source)} · set by server</p></div>
            <label className="text-xs font-medium md:col-span-2">Hosted video URL<Input aria-label="Hosted video URL" className="mt-1 min-h-11" maxLength={2048} onChange={(event) => setEditor((current) => current ? { ...current, videoUrl: event.target.value } : current)} placeholder="https://www.youtube.com/watch?v=..." type="url" value={editor.videoUrl} /></label>
            <label className="text-xs font-medium md:col-span-2">Lesson body<Textarea aria-label="Lesson body" className="mt-1 min-h-36" maxLength={20_000} onChange={(event) => setEditor((current) => current ? { ...current, body: event.target.value } : current)} value={editor.body} /></label>
            {editor.source === "platform" ? <label className="text-xs font-medium md:col-span-2">{editor.id === null ? "Source file" : "Replace source file (optional)"}<Input accept={trainingSourceAccept()} aria-label={editor.id === null ? "Source file" : "Replace source file"} className="mt-1 min-h-11" onChange={(event) => setEditor((current) => current ? { ...current, sourceFile: event.target.files?.[0] ?? null } : current)} type="file" />{editor.storedSourceFile ? <span className="mt-2 block font-normal text-muted-foreground">Stored source: <a className="font-medium text-foreground underline" download href={adminTrainingSourcePath(editor.id as string)}>{editor.storedSourceFile.fileName}</a></span> : null}</label> : <p className="text-xs leading-5 text-muted-foreground md:col-span-2">This operator-authored training keeps its existing attestation flow and does not require a platform source file.</p>}
            <div className="md:col-span-2"><p className="text-xs font-medium">Audience</p><div className="mt-2 flex flex-wrap gap-2">{(["operator", "client"] as AdminTrainingAudience[]).map((trainingAudience) => <Button aria-pressed={editor.audience === trainingAudience} key={trainingAudience} onClick={() => setEditor((current) => current ? { ...current, audience: trainingAudience } : current)} size="sm" variant={editor.audience === trainingAudience ? "secondary" : "outline"}>{trainingAudience === "operator" ? "Operators" : "Clients"}</Button>)}</div></div>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">YouTube, Vimeo, and Loom HTTPS URLs are supported. Sources must be PDF, DOC, DOCX, or TXT files no larger than 6 MB; they stay private and are downloaded through this signed-in admin page.</p>
          <div className="mt-4 flex justify-end gap-2"><Button disabled={busy !== null} onClick={() => setEditor(null)} variant="outline">Cancel</Button><Button disabled={!editorComplete || busy !== null || libraryState !== "ready"} onClick={() => { void saveEditor(); }}>{editor.id === null ? "Create draft" : "Save changes"}</Button></div>
        </Panel>
      ) : null}
      {libraryState === "ready" ? (
        <Panel className="mb-5" title="Publishing controls" description="Publishing is attested; platform-admin takedowns require a recorded reason.">
          {config?.attestationAvailable ? <p className="text-sm leading-6">{config.attestationText}</p> : <Notice tone="warning">Publishing is unavailable until TRAINING_ATTESTATION_TEXT is configured.</Notice>}
          {!config?.consoleOpsEnabled ? <p className="mt-3 text-xs leading-5 text-muted-foreground">Admin unpublishing is unavailable until FEATURE_CONSOLE_OPS is enabled. Draft editing, creation, and deletion still use their existing routes.</p> : null}
          <p className="mt-3 text-xs leading-5 text-muted-foreground">A platform training needs a stored source file before it can be published. Existing published records remain visible, but an unpublished legacy record needs a source before republishing.</p>
        </Panel>
      ) : null}
      <ViewToolbar>
        <SearchField onChange={setQuery} placeholder="Search trainings" value={query} />
        {libraryState === "ready" ? <><AdminSelect ariaLabel="Training source" onChange={setSourceFilter} options={["All sources", "Platform", "Operator"]} value={sourceFilter} /><AdminSelect ariaLabel="Training audience" onChange={setAudienceFilter} options={["All audiences", "Clients", "Operators"]} value={audienceFilter} /><AdminSelect ariaLabel="Training status" onChange={setStatusFilter} options={["All statuses", "Published", "Draft"]} value={statusFilter} /></> : null}
        <span className="text-xs text-muted-foreground sm:ml-auto">{publishedCount === null ? "— published" : `${publishedCount} published`}</span>
      </ViewToolbar>
      <Panel title="Training library" description="Every durable row shows its stored source, audience, hosted video, body, publication state, and update time.">
        {libraryState === "loading" ? <p className="text-sm text-muted-foreground">Loading the training library.</p> : null}
        {libraryState === "unavailable" ? <Notice tone="warning">The training library could not be loaded, so this is not an empty library. Reload the page, and nothing below is a platform record until it does.</Notice> : null}
        {libraryState === "not-enabled" ? <Notice>{TRAINING_LIBRARY_ABSENT}</Notice> : null}
        {libraryState === "ready" && filteredTrainings.length === 0 ? <EmptyState title={trainings.length === 0 ? "No stored trainings" : "No matching trainings"} description={trainings.length === 0 ? "Create the first platform training draft." : "Try another title, body, video URL, source, audience, or status."} /> : null}
        {libraryState === "ready" && filteredTrainings.length > 0 ? (
          <>
            <div className="hidden md:block">
              <Table className="min-w-[1260px]"><TableHeader><TableRow><TableHead>Training</TableHead><TableHead>Source</TableHead><TableHead>Source file</TableHead><TableHead>Audience</TableHead><TableHead>Video</TableHead><TableHead>Updated</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{filteredTrainings.map((training) => <TableRow key={training.id}><TableCell className="max-w-xs"><p className="font-semibold">{training.title}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{training.body}</p>{training.takedownReason ? <p className="mt-1 text-xs text-[var(--consumer-warning-ink)]">Takedown: {training.takedownReason}</p> : null}</TableCell><TableCell><StatusPill tone={training.source === "platform" ? "info" : "neutral"}>{titleCase(training.source)}</StatusPill></TableCell><TableCell>{training.sourceFile ? <a aria-label={`Download source for ${training.title}`} className="text-xs font-medium underline" download href={adminTrainingSourcePath(training.id)}>{training.sourceFile.fileName}</a> : <span className="text-xs text-muted-foreground">{training.source === "platform" ? "No source attached" : "Not required"}</span>}</TableCell><TableCell>{training.audience === "client" ? "Clients" : "Operators"}</TableCell><TableCell><a aria-label={`Open video for ${training.title}`} className="text-xs font-medium underline" href={training.videoUrl} rel="noreferrer" target="_blank">Open video</a></TableCell><TableCell className="text-xs text-muted-foreground">{formatInstant(training.updatedAt)}</TableCell><TableCell><StatusPill tone={training.published ? "success" : "neutral"}>{training.published ? "Published" : "Draft"}</StatusPill></TableCell><TableCell className="text-right"><div className="flex flex-col items-end gap-2"><div className="flex justify-end gap-1"><Button aria-label={`Edit ${training.title}`} disabled={busy !== null} onClick={() => setEditor(trainingEditorFor(training))} size="sm" variant="outline">Edit</Button>{training.published ? <Button aria-label={`Unpublish ${training.title}`} disabled={busy !== null || !config?.consoleOpsEnabled} onClick={() => setUnpublishDraft({ id: training.id, reason: "", title: training.title })} size="sm" title={config?.consoleOpsEnabled ? undefined : "FEATURE_CONSOLE_OPS is required for a platform takedown."} variant="ghost">Unpublish</Button> : <><Button aria-label={`Publish ${training.title}`} disabled={busy !== null || (training.source === "platform" && !training.sourceFile) || !config?.attestationAvailable || !attested.has(training.id)} onClick={() => { void publish(training); }} size="sm" title={training.source === "platform" && !training.sourceFile ? "Attach a source file before publishing." : undefined} variant="ghost">Publish</Button><Button aria-label={`Delete ${training.title}`} disabled={busy !== null} onClick={() => setDeleteCandidate(training)} size="sm" variant="ghost">Delete</Button></>}</div>{!training.published ? <label className="flex max-w-56 items-start gap-2 text-left text-xs leading-5 text-muted-foreground"><input checked={attested.has(training.id)} className="mt-1 size-4 accent-primary" disabled={(training.source === "platform" && !training.sourceFile) || !config?.attestationAvailable || busy !== null} onChange={(event) => setAttested((current) => { const next = new Set(current); if (event.target.checked) next.add(training.id); else next.delete(training.id); return next; })} type="checkbox" />{training.source === "platform" && !training.sourceFile ? "Attach a source before attesting" : "Confirm publishing attestation"}</label> : null}</div></TableCell></TableRow>)}</TableBody>
              </Table>
            </div>
            <div className="divide-y divide-border md:hidden">
              {filteredTrainings.map((training) => (
                <MobileRecord
                  action={<div className="flex flex-wrap gap-2"><Button disabled={busy !== null} onClick={() => setEditor(trainingEditorFor(training))} variant="outline">Edit</Button>{training.published ? <Button disabled={busy !== null || !config?.consoleOpsEnabled} onClick={() => setUnpublishDraft({ id: training.id, reason: "", title: training.title })} variant="outline">Unpublish</Button> : <><label className="flex min-h-11 items-center gap-2 text-xs"><input checked={attested.has(training.id)} className="size-4 accent-primary" disabled={(training.source === "platform" && !training.sourceFile) || !config?.attestationAvailable || busy !== null} onChange={(event) => setAttested((current) => { const next = new Set(current); if (event.target.checked) next.add(training.id); else next.delete(training.id); return next; })} type="checkbox" />Attest</label><Button disabled={busy !== null || (training.source === "platform" && !training.sourceFile) || !config?.attestationAvailable || !attested.has(training.id)} onClick={() => { void publish(training); }}>Publish</Button><Button disabled={busy !== null} onClick={() => setDeleteCandidate(training)} variant="outline">Delete</Button></>}</div>}
                  fields={[{ label: "Source", value: titleCase(training.source) }, { label: "Source file", value: training.sourceFile ? <a download href={adminTrainingSourcePath(training.id)} className="underline">{training.sourceFile.fileName}</a> : training.source === "platform" ? "No source attached" : "Not required", wide: true }, { label: "Audience", value: training.audience === "client" ? "Clients" : "Operators" }, { label: "Updated", value: formatInstant(training.updatedAt) }, { label: "Video URL", value: training.videoUrl, wide: true }, { label: "Body", value: training.body, wide: true }]}
                  key={training.id}
                  status={<StatusPill tone={training.published ? "success" : "neutral"}>{training.published ? "Published" : "Draft"}</StatusPill>}
                  title={training.title}
                />
              ))}
            </div>
          </>
        ) : null}
        {libraryState === "fixture" ? <><Notice>Illustrative training pages are read-only here; durable authoring requires the ancillary training service.</Notice>{filteredFixtures.length === 0 ? <EmptyState title="No matching pages" description="Try another title." /> : <div className="mt-4 divide-y divide-border">{filteredFixtures.map((page) => <div className="flex items-center justify-between gap-3 py-3" key={page.title}><div><p className="text-sm font-semibold">{page.title}</p><p className="mt-1 text-xs text-muted-foreground">{page.category} · {page.audience}</p></div><StatusPill tone={page.status === "Published" ? "success" : "neutral"}>{page.status}</StatusPill></div>)}</div>}</> : null}
      </Panel>
      <Dialog onOpenChange={(open) => { if (!open && busy === null) setUnpublishDraft(null); }} open={unpublishDraft !== null}>
        <DialogContent>
          <DialogHeader><DialogTitle>Unpublish {unpublishDraft?.title}?</DialogTitle><DialogDescription>Platform-admin takedowns require a reason. The server stores it with the unpublished training.</DialogDescription></DialogHeader>
          <Textarea aria-label="Takedown reason" maxLength={1000} onChange={(event) => setUnpublishDraft((current) => current ? { ...current, reason: event.target.value } : current)} placeholder="Why is this training being unpublished?" value={unpublishDraft?.reason ?? ""} />
          <DialogFooter><Button disabled={busy !== null} onClick={() => setUnpublishDraft(null)} variant="outline">Cancel</Button><Button disabled={!unpublishDraft?.reason.trim() || busy !== null || libraryState !== "ready"} onClick={() => { void unpublish(); }}>Unpublish</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog onOpenChange={(open) => { if (!open && busy === null) setDeleteCandidate(null); }} open={deleteCandidate !== null}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete {deleteCandidate?.title}?</DialogTitle><DialogDescription>This permanently removes the draft training and its private source file. Published trainings must be unpublished first.</DialogDescription></DialogHeader>
          <DialogFooter><Button disabled={busy !== null} onClick={() => setDeleteCandidate(null)} variant="outline">Cancel</Button><Button disabled={busy !== null || deleteCandidate?.published === true || libraryState !== "ready"} onClick={() => { void removeTraining(); }}>Delete draft</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FundedVolumePanel() {
  const [period, setPeriod] = useState("Last 5 weeks");
  // The series is recomputed server-side from counted approved outcomes; a
  // failed or disabled read draws no bars at all, because an empty chart with a
  // $0 total would report a book that did not exist.
  const { read } = useAdminResource("/api/admin/funded-volume", parseAdminFundedSeries);
  const series = isAdminReady(read) && read.enabled ? read : null;
  const volumeReason = isAdminReady(read) && !read.enabled
    ? "Recorded outcomes not enabled"
    : adminReadReason(read, "Recorded outcomes not enabled");
  const monthly = (series?.monthly ?? []).map((item) => ({
    amount: item.amountCents / 100,
    label: new Intl.DateTimeFormat("en-US", {
      month: "short",
      timeZone: "UTC",
      year: "numeric",
    }).format(new Date(`${item.label}-01T00:00:00Z`)),
  }));
  const weekly = (series?.weekly ?? []).map((item) => ({
    amount: item.amountCents / 100,
    label: `Week of ${new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${item.label}T00:00:00Z`))}`,
  }));
  const bars =
    period === "Last 5 weeks"
      ? weekly
      : period === "90 days"
        ? monthly.slice(-3)
        : monthly;
  const total = bars.reduce((sum, item) => sum + item.amount, 0);
  const max = Math.max(1, ...bars.map((item) => item.amount));

  return (
    <Panel
      className="mt-5 min-w-0"
      title="Funded volume"
      description={series
        ? "Recorded funded outcomes · short windows bucket by week so single periods stay readable"
        : volumeReason}
      trailing={<AdminSelect ariaLabel="Funded volume period" onChange={setPeriod} options={["Last 5 weeks", "90 days", "Year to date"]} value={period} />}
    >
      {series === null ? <p className="text-sm leading-6 text-muted-foreground">{volumeReason}</p> : <>
      <div className="flex h-56 min-w-0 max-w-full items-end gap-2 border-b border-border px-1 pb-2" aria-label={`Funded volume totals ${formatDemoMoney(total)} across ${bars.length} periods`}>
        {bars.map((item, index) => (
          <div className="group relative flex h-full min-w-0 flex-1 items-end" key={item.label}>
            <button
              aria-describedby={`funded-volume-${index}`}
              aria-label={`${item.label}: ${formatDemoMoney(item.amount)}`}
              className="group/bar flex h-full w-full items-end rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
            >
              <span
                aria-hidden
                className="w-full rounded-t-sm bg-primary/18 transition-colors group-hover/bar:bg-primary/35 group-focus-visible/bar:bg-primary/35"
                style={{ height: `${Math.max(item.amount ? 12 : 2, (item.amount / max) * 100)}%` }}
              />
            </button>
            <span
              className={cn(
                "pointer-events-none absolute bottom-[calc(100%+0.5rem)] z-10 hidden whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[0.68rem] font-medium text-background shadow-lg tabular-nums group-focus-within:block group-hover:block",
                index === 0 ? "left-0" : index === bars.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2",
              )}
              id={`funded-volume-${index}`}
              role="tooltip"
            >
              {item.label} · {formatDemoMoney(item.amount)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-between text-[0.68rem] text-muted-foreground tabular-nums"><span>{bars[0]?.label}</span><span className="font-semibold text-foreground">{formatDemoMoney(total, { compact: true })} total</span><span>{bars[bars.length - 1]?.label}</span></div>
      </>}
    </Panel>
  );
}

/**
 * `BookStatsPanel` is gone. It reported client growth this quarter, an average
 * time to optimize, an average funding per client, "the biggest optimization
 * bottleneck" and a five-lender hottest-banks ranking, all derived from the
 * in-memory fixture application book, under the heading "Recorded performance
 * across all operator workspaces". Every figure was a platform-wide claim with
 * no platform behind it, and the durable half of the same question — recorded
 * funded volume — is the chart that now renders beside the governed rollups.
 *
 * The three strings the Drop 7 IA test pinned went with it, and that test's
 * re-pin now asserts their absence instead.
 */

const GOVERNED_METRIC_LABELS: Readonly<Record<KpiMetricKey, string>> = {
  activeUsers: "Active users",
  operators: "Operators",
  currentMonitoring: "Current monitoring",
  trialConversionPct: "Trial conversion",
  averageMonthlyPlanCents: "Average monthly plan",
  averageMembershipDays: "Average membership days",
  aiUsage: "AI usage",
  fundedOutcomesCents: "Funded outcomes",
};

function governedMetricValue(key: KpiMetricKey, value: number | null): string {
  if (value === null) return "No data";
  if (key === "averageMonthlyPlanCents" || key === "fundedOutcomesCents") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
  }
  if (key === "trialConversionPct") return `${value}%`;
  return new Intl.NumberFormat("en-US").format(value);
}

function GovernedAnalyticsBody() {
  const day = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [rollups, setRollups] = useState<readonly KpiRollupRow[] | null>(null);
  const [layout, setLayout] = useState<readonly KpiMetricKey[]>(KPI_METRIC_KEYS);
  const [state, setState] = useState<"loading" | "ready" | "error" | "disabled">("loading");
  const [note, setNote] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([loadAdminAnalytics("platform", day), loadAdminLayout()])
      .then(([rows, savedLayout]) => {
        if (!active) return;
        setRollups(rows);
        if (savedLayout) setLayout(savedLayout.layout);
        setState("ready");
      })
      .catch((error: unknown) => { if (active) setState(adminReadNotEnabled(error) ? "disabled" : "error"); });
    return () => { active = false; };
  }, [day]);
  const latest = rollups?.at(-1) ?? null;
  const moveEarlier = (index: number) => {
    if (index === 0) return;
    setLayout((current) => {
      const next = [...current];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };
  const persistLayout = async () => {
    setNote("");
    try { setLayout((await saveAdminLayout(layout)).layout); setNote("Layout saved."); }
    catch { setNote("Layout could not be saved."); }
  };
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => void persistLayout()} variant="outline">Save tile order</Button>
      </div>
      {state === "loading" ? <Panel title="Loading analytics"><p className="text-sm text-muted-foreground">Loading persisted rollups.</p></Panel> : null}
      {state === "disabled" ? <Notice>{ADMIN_GOVERNANCE_ABSENT}</Notice> : state === "error" ? <Notice tone="warning">Analytics data could not be loaded.</Notice> : null}
      {state === "ready" && !latest ? <Panel title="No data" description="No persisted platform rollup is available for this 90-day window."><span /></Panel> : null}
      {note ? <div className="mb-4"><Notice>{note}</Notice></div> : null}
      {/*
        The durable funded-volume chart lives here rather than in the fixture
        twin below. It reads `/api/admin/funded-volume`, which is governed by
        FEATURE_ADMIN like every other admin read — so hanging it off the
        `adminEnabled === false` branch meant the one panel on this tab with a
        durable source disappeared the moment the durable source was switched
        on, and the fixture strip took its place. The gate was inverted.
      */}
      <FundedVolumePanel />
      {latest ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">{layout.map((key, index) => (
        <Panel key={key} title={GOVERNED_METRIC_LABELS[key]} trailing={<Button disabled={index === 0} onClick={() => moveEarlier(index)} size="sm" variant="ghost">Move earlier</Button>}>
          <p className="text-3xl font-semibold tracking-[-0.04em] tabular-nums">{governedMetricValue(key, latest.metrics[key])}</p>
          <p className="mt-2 text-xs text-muted-foreground">Persisted {latest.day}</p>
        </Panel>
      ))}</div> : null}
    </>
  );
}

const GOVERNED_SETTING_LABELS: Readonly<Record<GovernedSettingKey, string>> = {
  SUPPORT_DRAFT_CONFIDENCE_THRESHOLD: "Support draft confidence threshold",
  TRIAL_DAYS: "Trial days",
  OPERATOR_GRACE_DAYS: "Operator grace days",
  FORCE_PULL_PRICE_CENTS: "Force-pull price in cents",
};

function GovernedPlatformSettingsSection() {
  const [values, setValues] = useState<Partial<Record<GovernedSettingKey, number | null>>>({});
  const [state, setState] = useState<"loading" | "ready" | "error" | "disabled">("loading");
  const [note, setNote] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all(GOVERNED_SETTING_KEYS.map(async (key) => [key, await loadAdminSetting(key)] as const))
      .then((rows) => {
        if (!active) return;
        setValues(Object.fromEntries(rows.map(([key, row]) => [key, row?.value ?? null])));
        setState("ready");
      })
      .catch((error: unknown) => { if (active) setState(adminReadNotEnabled(error) ? "disabled" : "error"); });
    return () => { active = false; };
  }, []);
  const save = async (key: GovernedSettingKey) => {
    const value = values[key];
    if (typeof value !== "number" || !Number.isFinite(value)) { setNote("Enter a valid value before saving."); return; }
    try {
      const saved = await saveAdminSetting(key, value);
      setValues((current) => ({ ...current, [key]: saved.value }));
      setNote(`${GOVERNED_SETTING_LABELS[key]} saved.`);
    } catch { setNote("The setting could not be saved."); }
  };
  return (
    <div className="space-y-5">
      {state === "loading" ? <Panel title="Loading settings"><p className="text-sm text-muted-foreground">Loading governed values.</p></Panel> : null}
      {state === "disabled" ? <Notice>{ADMIN_GOVERNANCE_ABSENT}</Notice> : state === "error" ? <Notice tone="warning">Settings could not be loaded.</Notice> : null}
      {note ? <Notice>{note}</Notice> : null}
      {state === "ready" ? <div className="grid gap-5 xl:grid-cols-2">{GOVERNED_SETTING_KEYS.map((key) => (
        <Panel key={key} title={GOVERNED_SETTING_LABELS[key]} description={values[key] === null ? "No stored value; the environment fallback applies." : "Stored value takes precedence over the environment fallback."}>
          <div className="flex items-end gap-3"><label className="flex-1 text-sm font-medium">Value<Input className="mt-2 min-h-11 tabular-nums" onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value === "" ? null : Number(event.target.value) }))} type="number" value={values[key] ?? ""} /></label><Button onClick={() => void save(key)}>Save</Button></div>
        </Panel>
      ))}</div> : null}
      <Panel title="Supervisor and evaluator gates" description="Gate policy remains code-owned and cannot be changed here." trailing={<StatusPill tone="info">Locked</StatusPill>}>
        <p className="text-sm leading-6 text-muted-foreground"><Lock aria-hidden className="mr-1 inline size-4" />Supervisor, language, grounding, and confidence checks remain mandatory.</p>
      </Panel>
    </div>
  );
}

function AnalyticsBody() {
  const { applications } = useFeedbackSession();
  const metrics = deriveAnalyticsMetrics();
  const overview = deriveAdminOverview(applications);
  // Derived from the same durable roster the Operators view renders, so the
  // breakdown cannot drift from it. Until that read lands there is no roster to
  // break down, and the strip says so instead of showing three zeroes.
  const { read: tenantRead } = useAdminResource("/api/admin/tenants", parseAdminTenants);
  const membershipMix = isAdminReady(tenantRead)
    ? tenantRead.reduce(
        (counts, tenant) => ({ ...counts, [tenant.membership]: (counts[tenant.membership] ?? 0) + 1 }),
        {} as Record<string, number>,
      )
    : null;
  const membershipChange = membershipMix === null
    ? adminReadReason(tenantRead, "Operator records not enabled")
    : `${membershipMix.current ?? 0} current · ${membershipMix.trial ?? 0} trial · ${membershipMix.deactivated ?? 0} deactivated`;

  const reports = [
    { title: "Active users", value: formatDemoNumber(metrics.activeUsers), meta: "logged in during the fixture week", bars: ["h-8", "h-10", "h-12", "h-16", "h-20", "h-24"] },
    { title: "AI usage", value: formatDemoNumber(overview.analyses), meta: "fixture analyses across operator workspaces", bars: ["h-12", "h-16", "h-14", "h-20", "h-24", "h-28"] },
    { title: "Funded outcomes", value: formatDemoMoney(overview.fundedYtd, { compact: true }), meta: "recorded year-to-date volume", bars: ["h-8", "h-12", "h-16", "h-14", "h-24", "h-28"] },
    { title: "Trial to paid", value: formatDemoPercent(metrics.trialConversion), meta: "operator conversion from the fixture cohort", bars: ["h-16", "h-14", "h-18", "h-20", "h-22", "h-24"] },
    { title: "Current monitoring", value: formatDemoNumber(metrics.currentMonitoring), meta: "monthly monitoring members", bars: ["h-18", "h-20", "h-16", "h-24", "h-20", "h-26"] },
    { title: "Average membership", value: `${formatDemoNumber(metrics.averageMembershipDays)} days`, meta: "includes canceled trials", bars: ["h-24", "h-20", "h-16", "h-14", "h-12", "h-10"] },
  ];
  return (
    <>
      <>
      <MetricStrip items={[
        { label: "Active users", value: formatDemoNumber(metrics.activeUsers), change: "logged in past week" },
        { label: "Operators", value: formatDemoNumber(metrics.operators), change: membershipChange },
        { label: "Current monitoring", value: formatDemoNumber(metrics.currentMonitoring), change: "monthly members" },
        { label: "Trial conversion", value: formatDemoPercent(metrics.trialConversion), change: "fixture cohort" },
        { label: "Average monthly plan", value: formatDemoMoney(metrics.averageMonthlyPlan, { minimumFractionDigits: 2 }), change: "active operators" },
        { label: "Average membership", value: `${formatDemoNumber(metrics.averageMembershipDays)} days`, change: "includes canceled trials" },
      ]} />
      <div className="mt-5 grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">{reports.map((report) => (
        <Panel key={report.title} title={report.title} description={report.meta}>
          <div className="flex items-end justify-between gap-5"><p className="text-3xl font-semibold tracking-[-0.04em] tabular-nums">{report.value}</p><div className="flex h-20 flex-1 items-end justify-end gap-1.5" aria-hidden>{report.bars.map((height, index) => <span className={cn("w-4 rounded-t-sm bg-primary/25", height)} key={index} />)}</div></div>
        </Panel>
      ))}</div>
      </>
    </>
  );
}

function ToggleSetting({ checked, description, label, onChange }: { checked: boolean; description: string; label: string; onChange: (checked: boolean) => void }) {
  return <div className="flex items-start justify-between gap-4 border-b border-border py-4 first:pt-0 last:border-0 last:pb-0"><div><p className="text-sm font-medium">{label}</p><p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{description}</p></div><Switch aria-label={label} checked={checked} onCheckedChange={onChange} /></div>;
}

function PlatformSettingsSection() {
  const { config, configConfidence, forcePullPrice, recordAudit, setConfig, setConfigConfidence, setForcePullPrice } = useAdminSession();
  const [note, setNote] = useState("");
  const update = (key: keyof PlatformConfig, value: boolean) => setConfig((current) => ({ ...current, [key]: value }));
  function saveConfig() {
    setNote("Global defaults saved. Four operator workspaces will receive the change.");
    recordAudit({ action: `Saved global config at ${configConfidence} confidence and ${forcePullPrice} pull price`, target: "platform.global_config", risk: "High" });
  }
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-sm leading-6 text-muted-foreground">
          Operator workspaces inherit these platform defaults unless an
          approved contract override exists.
        </p>
        <Button onClick={saveConfig}>Save changes</Button>
      </div>
      {note ? <div className="mb-4"><Notice tone="success">{note}</Notice></div> : null}
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Data and privacy" description="Storage boundaries and cancellation behavior">
          <ToggleSetting checked={config.purge} description="Canceling closes monitoring access and purges persisted derived outputs after the configured window." label="Purge derived outputs on cancel" onChange={(value) => update("purge", value)} />
          <div className="grid gap-3 border-b border-border py-4 sm:grid-cols-2"><label className="text-sm font-medium">Raw report retention<Input className="mt-2 min-h-11" disabled value="0 days" /></label><label className="text-sm font-medium">Derived purge window<Input className="mt-2 min-h-11" value="30 days" readOnly /></label></div>
          <p className="pt-4 text-xs leading-5 text-muted-foreground"><Lock aria-hidden className="mr-1 inline size-3" />AES-256 at rest, TLS in transit, and workspace row-level security are enforced outside operator configuration.</p>
        </Panel>
        <Panel title="AI coach and supervisor" description="Safety controls that govern every downstream prompt">
          <ToggleSetting checked={config.coach} description="Allow supervised guidance on paid operator plans." label="AI guidance on paid plans" onChange={(value) => update("coach", value)} />
          <ToggleSetting checked={config.trialCoach} description="Keep disabled until an operator owner accepts production terms." label="AI guidance on trials" onChange={(value) => update("trialCoach", value)} />
          <ToggleSetting checked={config.escalate} description="Hold flagged replies and route them to a human operator." label="Escalate flagged replies" onChange={(value) => update("escalate", value)} />
          <label className="block pt-4 text-sm font-medium">Confidence threshold<Input className="mt-2 min-h-11 max-w-32 tabular-nums" onChange={(event) => setConfigConfidence(event.target.value)} value={configConfidence} /></label>
        </Panel>
        <Panel title="Billing and partners" description="Commercial defaults for new operator workspaces">
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Force-pull refresh price<Input className="mt-2 min-h-11 max-w-36 tabular-nums" onChange={(event) => setForcePullPrice(event.target.value)} value={forcePullPrice} /></label><label className="text-sm font-medium">Default dunning window<Input className="mt-2 min-h-11 max-w-36" readOnly value="30 days" /></label><label className="text-sm font-medium">Plan pricing<div className="mt-2 rounded-md border border-input bg-muted/30 px-3 py-2 text-xs font-normal leading-5">Agency placeholder: $497 base + $29 per additional seat, pending the pricing session. Pro: $249 unresolved fixture value.</div></label><label className="text-sm font-medium">SaaS referral share<Input className="mt-2 min-h-11" readOnly value="TBD — definition pending" /></label></div>
          <div className="mt-4"><ToggleSetting checked={config.sandbox} description="Partner tests remain isolated from production operator and consumer records." label="Partner sandbox" onChange={(value) => update("sandbox", value)} /></div>
        </Panel>
        <Panel title="Recent config changes" description="Every mutation is retained with actor and time">
          <div className="divide-y divide-border">{[["Jul 20", "Confidence threshold 0.70 → 0.75", "Devin"], ["Jul 02", "Force-pull refresh price $24 → $19", "Alec"], ["Jun 18", "Dunning window 14 days → 30 days", "Alec"]].map(([date, change, actor]) => <div className="grid grid-cols-[4rem_1fr_auto] gap-3 py-3 first:pt-0 last:pb-0" key={change}><span className="font-mono text-xs text-muted-foreground">{date}</span><span className="text-sm">{change}</span><span className="text-xs text-muted-foreground">{actor}</span></div>)}</div>
        </Panel>
      </div>
    </>
  );
}

function BillingView({ adminEnabled = false, monitoringSplitLabel = "40%" }: { adminEnabled?: boolean; monitoringSplitLabel?: string }) {
  const { recordAudit } = useAdminSession();
  const [saasTab, setSaasTab] = useState<"ledger" | "settings" | "analytics">("ledger");
  const [status, setStatus] = useState("All payment states");
  const [note, setNote] = useState("");
  const [managedOperatorId, setManagedOperatorId] = useState<string | null>(null);
  // Three states, not a boolean: "unknown" is a failed or unreadable config
  // read, and it must not render like live mode. A boolean here was the
  // G-HOST-14 class one panel over — `false` hid the test-mode line, so an
  // outage was indistinguishable from live billing.
  const [stripeMode, setStripeMode] = useState<"live" | "test" | "unknown" | "loading">("loading");
  const liveRevenue = useRevenueKpis();
  const revenue = revenuePresentation(liveRevenue);
  // Platform fees and seats are recorded on `orgs` and countable; monitoring
  // subscription revenue is not recorded anywhere, so the combined recurring
  // total has no durable value and dashes at every flag setting.
  const { read: saasRead } = useAdminResource("/api/admin/saas-metrics", parseAdminSaasMetrics);
  // The ledger's rows are the platform's own operator roster, the same read the
  // Operators view renders. It used to be `deriveOperatorBillingRows()` — Apex,
  // Liberty, Northgate and Summit at $497 and $249, "Renews Aug 1" — rendered
  // on both sides of `adminEnabled`, so a platform administrator looking at a
  // database holding two real workspaces was shown four invented ones with
  // invented money against them, and could export the lot to a CSV.
  //
  // What the roster carries is the workspace, its plan and its membership
  // state. It carries no per-workspace subscription amount: `saas-metrics`
  // answers one platform-wide MRR figure and no table breaks it down by org.
  // Those three money columns therefore dash, which is the same rule the
  // Operators view already applies to funded totals.
  const { read: ledgerRead } = useAdminResource("/api/admin/tenants", parseAdminTenants);
  const monitoringShareCents = typeof liveRevenue === "object" && liveRevenue !== null
    ? liveRevenue.monitoringShareTotalCents : null;
  const referralShareCents = typeof liveRevenue === "object" && liveRevenue !== null
    ? liveRevenue.saasReferralTotalCents : null;
  const ledgerReason = adminReadReason(ledgerRead, "Operator records not enabled");
  const allRows = isAdminReady(ledgerRead) ? ledgerRead : [];
  const rows = allRows.filter((operator) =>
    status === "All payment states" || operator.membership === status,
  );
  const managedOperator = allRows.find((operator) => operator.id === managedOperatorId);
  useEffect(() => {
    let active = true;
    void fetch("/api/billing/config", { cache: "no-store" })
      .then(async (response) => {
        // 404 is the route's flag-off answer: billing is deliberately not
        // configured, which the ledger copy already describes — treat it as a
        // known (live-labelled) state rather than a failure.
        if (response.status === 404) return { testMode: false };
        if (!response.ok) return null;
        return response.json() as Promise<{ testMode?: unknown }>;
      })
      .then((result) => {
        if (!active) return;
        if (result === null) setStripeMode("unknown");
        else setStripeMode(result.testMode === true ? "test" : "live");
      })
      .catch(() => {
        if (active) setStripeMode("unknown");
      });
    return () => { active = false; };
  }, []);
  // A downloaded file outlives every caveat on the page that produced it, so
  // this exports the durable roster or refuses. The columns with no recorded
  // source are written empty rather than as a number the platform never held.
  function exportLedger() {
    if (!isAdminReady(ledgerRead)) {
      setNote(`No ledger was exported. ${ledgerReason}.`);
      return;
    }
    const escapeCsv = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const header = ["Operator", "Plan", "Platform fee", "Additional fees", "Payment", "Payment status", "Client records"];
    const body = allRows.map((operator) => [
      operator.name,
      membershipLabel(operator.plan),
      "",
      "",
      "",
      membershipLabel(operator.membership),
      operator.clients,
    ]);
    const csv = [header, ...body].map((row) => row.map(escapeCsv).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "mostfundable-saas-ledger.csv";
    link.click();
    URL.revokeObjectURL(url);
    setNote("SaaS ledger exported for finance review.");
    recordAudit({ action: "Exported operator SaaS ledger", target: "billing.operator_ledger", risk: "Review" });
  }
  function handleBillingAction(operator: AdminTenantView) {
    setManagedOperatorId(operator.id);
    setNote(`${operator.name} billing management opened. No automated invoice or payout was created.`);
    recordAudit({ action: `Reviewed next billing action for ${operator.name}`, target: `billing.${operator.id}`, risk: "Normal" });
  }
  return (
    <>
      <PageHeader eyebrow="Operator subscriptions" title="SaaS" actions={saasTab === "ledger" ? <Button onClick={exportLedger} variant="outline"><FileText aria-hidden />Export ledger</Button> : undefined} />
      {stripeMode === "test" ? <p className="mb-4 text-xs font-medium text-muted-foreground">Stripe test mode</p> : null}
      {stripeMode === "unknown" ? <p className="mb-4 text-xs font-medium text-muted-foreground">Billing configuration could not be read · test-or-live mode unknown</p> : null}
      <PillTabs
        onChange={setSaasTab}
        tabs={[
          { label: "Billing ledger", value: "ledger" },
          { label: "Platform settings", value: "settings" },
          { label: "Analytics", value: "analytics" },
        ]}
        value={saasTab}
      />
      {saasTab === "analytics" ? (
        adminEnabled ? <GovernedAnalyticsBody /> : <AnalyticsBody />
      ) : saasTab === "settings" ? (adminEnabled ? <GovernedPlatformSettingsSection /> : <PlatformSettingsSection />) : (
      <>
      {note ? <div className="mb-4"><Notice>{note}</Notice></div> : null}
      {managedOperator ? (
        <Panel
          className="mb-5"
          title={`Manage ${managedOperator.name}`}
          description="Review the recorded subscription state before any billing action"
          trailing={<Button onClick={() => setManagedOperatorId(null)} size="sm" variant="ghost">Close</Button>}
        >
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">Plan</dt><dd className="mt-1 font-semibold">{membershipLabel(managedOperator.plan)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Membership</dt><dd className="mt-1 font-semibold">{membershipLabel(managedOperator.membership)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Recorded payment</dt><dd className="mt-1 font-semibold tabular-nums">—</dd></div>
            <div><dt className="text-xs text-muted-foreground">Client records</dt><dd className="mt-1 font-semibold tabular-nums">{formatDemoNumber(managedOperator.clients)}</dd></div>
          </dl>
        </Panel>
      ) : null}
      <div className="mb-5">
        <Notice tone={(revenue.enabled && !revenue.complete) || revenue.failed ? "warning" : "info"}>
          {revenue.enabled
            ? revenue.complete
              ? "Monthly monitoring-share and SaaS-referral values come from posted ledger rows."
              : "Revenue ledger data is incomplete. Missing monitoring-share or SaaS-referral inputs are shown as zero."
            : revenue.failed
            ? "The revenue read did not complete. Monitoring-share and SaaS-referral values are unavailable rather than zero."
            : <>Illustrative fixture assumptions: Agency is a $497 base + $29 per additional seat placeholder pending the pricing session; Pro $249 is an unresolved fixture value. The operator monitoring share is {monitoringSplitLabel}. Monitoring-share and SaaS-referral terms remain TBD pending the billing session.</>}
        </Notice>
      </div>
      <MetricStrip items={[
        { label: "Monthly recurring total", value: "—", change: "monitoring subscription revenue has no recorded source" },
        { label: "Monthly platform MRR", value: centsMoney(isAdminReady(saasRead) ? saasRead.platformMrrCents : null, false), change: isAdminReady(saasRead) ? "fees + seats" : adminReadReason(saasRead, "Subscription records not enabled") },
        { label: revenue.enabled ? revenue.monitoringLabel : "Monthly monitoring profit", value: centsMoney(monitoringShareCents, false), change: revenue.enabled ? "posted ledger rows" : revenue.failed ? "the revenue read did not complete" : "revenue ledger not enabled" },
        { label: revenue.enabled ? revenue.referralLabel : "Monthly referral split", value: centsMoney(referralShareCents, false), change: revenue.enabled ? "operator referrals" : revenue.failed ? "the revenue read did not complete" : "revenue ledger not enabled" },
      ]} />
      <div className="mt-5"><ViewToolbar><AdminSelect ariaLabel="Payment status" onChange={setStatus} options={["All payment states", "current", "trial", "deactivated"]} value={status} /><span className="text-xs text-muted-foreground sm:ml-auto">{isAdminReady(ledgerRead) ? "No automated invoicing runs from this page" : ledgerReason}</span></ViewToolbar></div>
      <Panel title="Operator billing" description={isAdminReady(ledgerRead) ? "Recorded operator workspaces and their plan; per-workspace amounts have no recorded source" : ledgerReason}>
        <div className="hidden md:block">
          <Table className="min-w-[940px]"><TableHeader><TableRow><TableHead>Operator</TableHead><TableHead>Plan</TableHead><TableHead>Platform fee</TableHead><TableHead>Additional fees</TableHead><TableHead>Payment</TableHead><TableHead>Payment status</TableHead><TableHead>Manage</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((operator) => <TableRow key={operator.id}><TableCell className="font-semibold">{operator.name}</TableCell><TableCell>{membershipLabel(operator.plan)}</TableCell><TableCell className="tabular-nums">—</TableCell><TableCell className="tabular-nums">—</TableCell><TableCell className="font-semibold tabular-nums">—</TableCell><TableCell><StatusPill tone={operator.membership === "current" ? "success" : operator.membership === "trial" ? "info" : "neutral"}>{membershipLabel(operator.membership)}</StatusPill></TableCell><TableCell><Button aria-label={`Open ${operator.name} billing management`} onClick={() => handleBillingAction(operator)} size="sm" variant="outline">Open</Button></TableCell></TableRow>)}</TableBody>
          </Table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {rows.map((operator) => (
              <MobileRecord
                action={<Button aria-label={`Open ${operator.name} billing management`} className="min-h-11" onClick={() => handleBillingAction(operator)} variant="outline">Open</Button>}
                fields={[{ label: "Plan", value: membershipLabel(operator.plan) }, { label: "Platform fee", value: "—" }, { label: "Additional fees", value: "—" }, { label: "Payment", value: "—" }]}
                key={operator.id}
                status={<StatusPill tone={operator.membership === "current" ? "success" : operator.membership === "trial" ? "info" : "neutral"}>{membershipLabel(operator.membership)}</StatusPill>}
                title={operator.name}
              />
          ))}
        </div>
      </Panel>
      </>
      )}
    </>
  );
}

function SecurityView() {
  const { auditEvents, recordAudit } = useAdminSession();
  const storedAudit = useAdminAudit();
  const [securityTab, setSecurityTab] = useState<"audit" | "runs">("audit");
  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState("All events");
  const [note, setNote] = useState("");
  const [rotationReviewOpen, setRotationReviewOpen] = useState(false);
  const [exportDataset, setExportDataset] = useState("analysis_runs");
  const [exportFormat, setExportFormat] = useState("csv");
  const [ancillaryEnabled, setAncillaryEnabled] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const sessionEvents = auditEvents.filter((event) =>
    `${event.actor} ${event.action} ${event.target}`.toLowerCase().includes(normalizedQuery)
      && (risk === "All events" || event.risk === risk));
  const storedEvents = isAdminAuditReady(storedAudit)
    ? storedAudit.filter((event) =>
      `${event.actorName ?? ""} ${event.action} ${event.subjectType} ${event.subjectId}`
        .toLowerCase().includes(normalizedQuery))
    : [];
  useEffect(() => { let active = true; void fetch("/api/trainings/config").then((response) => response.ok ? response.json() : null).then((config: { enabled?: boolean } | null) => { if (active) setAncillaryEnabled(config?.enabled === true); }).catch(() => undefined); return () => { active = false; }; }, []);
  async function downloadExport() { const response = await fetch(`/api/exports?dataset=${encodeURIComponent(exportDataset)}&format=${encodeURIComponent(exportFormat)}`); if (!response.ok) { setNote("Export is unavailable."); return; } const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = `${exportDataset}.${exportFormat}`; link.click(); URL.revokeObjectURL(url); setNote("Export completed and was recorded in the audit trail."); }
  function recordProductionKeyRotationReview() {
    setRotationReviewOpen(false);
    setNote("Production key-rotation review recorded. No credential was changed in this demo.");
    recordAudit({ action: "Reviewed production service-key rotation", target: "environment.production", risk: "Review" });
  }
  return (
    <>
      <PageHeader eyebrow="Access and evidence" title="Access & audit log" actions={securityTab === "audit" ? <Button onClick={() => setRotationReviewOpen(true)} variant="outline"><RefreshCw aria-hidden />Review key rotation</Button> : undefined} />
      <PillTabs
        onChange={setSecurityTab}
        tabs={[
          { label: "Audit log", value: "audit" },
          { label: "Eval runs", value: "runs" },
        ]}
        value={securityTab}
      />
      {securityTab === "runs" ? <RunsSection /> : (
      <>
      {rotationReviewOpen ? (
        <section aria-labelledby="production-rotation-title" className="mb-5 rounded-xl border border-border bg-muted/25 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold" id="production-rotation-title">Review production service-key rotation?</h2>
            <StatusPill tone="neutral">Production</StatusPill>
          </div>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">This demo records the review only. Rotating the production service key requires coordinated replacement across every production job and integration.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="min-h-11" onClick={recordProductionKeyRotationReview}>Record review</Button>
            <Button className="min-h-11" onClick={() => setRotationReviewOpen(false)} variant="outline">Close without recording</Button>
          </div>
        </section>
      ) : null}
      {note ? <div className="mb-4"><Notice tone="success">{note}</Notice></div> : null}
      {ancillaryEnabled ? <Panel className="mb-5" title="Derived data export" description="Choose one fixed dataset and consume the audited CSV or JSON stream"><div className="flex flex-wrap gap-2"><AdminSelect ariaLabel="Export dataset" onChange={setExportDataset} options={["analysis_runs", "plans", "checklist_item_state", "bank_outcome_stats", "bank_retrieval_index"]} value={exportDataset} /><AdminSelect ariaLabel="Export format" onChange={setExportFormat} options={["csv", "json"]} value={exportFormat} /><Button onClick={() => void downloadExport()} variant="outline"><FileText aria-hidden />Export</Button></div></Panel> : null}
      <div className="mb-5 grid gap-4 md:grid-cols-2"><Panel title="Workspace isolation" description="Row-level access"><StatusPill tone="success">Enforced</StatusPill><p className="mt-3 text-xs leading-5 text-muted-foreground">Cross-workspace reads are denied and written to the audit stream.</p></Panel><Panel title="Deployment model" description="Single production environment"><StatusPill tone="neutral">One environment</StatusPill><p className="mt-3 text-xs leading-5 text-muted-foreground">main deploys to production. No separate staging project, database, key set, or deployment target is configured.</p></Panel></div>
      <ViewToolbar><SearchField onChange={setQuery} placeholder="Search audit events" value={query} /><span className="text-xs text-muted-foreground sm:ml-auto">Latest 100 stored events, newest first</span></ViewToolbar>
      <Panel title="Stored platform audit trail" description="Recorded platform actions. Metadata is excluded from this list, and actor identities use display names only.">
        {storedAudit === "loading" ? <Notice>Loading stored audit events.</Notice> : null}
        {storedAudit === null ? <Notice>The stored audit trail is not enabled on this deployment.</Notice> : null}
        {storedAudit === "failed" ? <Notice tone="warning">Stored audit events could not be loaded, so this is not an empty audit trail.</Notice> : null}
        {isAdminAuditReady(storedAudit) && storedEvents.length === 0 ? (
          <EmptyState
            title={storedAudit.length === 0 ? "No stored audit events" : "No matching stored audit events"}
            description={storedAudit.length === 0 ? "The platform has not recorded an audit event yet." : "Try another actor, action, subject type, or subject ID."}
          />
        ) : null}
        {isAdminAuditReady(storedAudit) && storedEvents.length > 0 ? (
          <>
            <div className="hidden md:block">
              <Table className="min-w-[940px]"><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Subject type</TableHead><TableHead>Subject ID</TableHead></TableRow></TableHeader><TableBody>{storedEvents.map((event) => <TableRow key={event.id}><TableCell className="text-xs text-muted-foreground">{formatInstant(event.occurredAt)}</TableCell><TableCell className="font-semibold">{event.actorName ?? "Actor unavailable"}</TableCell><TableCell>{event.action}</TableCell><TableCell className="font-mono text-xs">{event.subjectType}</TableCell><TableCell className="font-mono text-xs">{event.subjectId}</TableCell></TableRow>)}</TableBody></Table>
            </div>
            <div className="divide-y divide-border md:hidden">
              {storedEvents.map((event) => (
                <MobileRecord
                  fields={[{ label: "Actor", value: event.actorName ?? "Actor unavailable" }, { label: "Time", value: formatInstant(event.occurredAt) }, { label: "Subject type", value: event.subjectType }, { label: "Subject ID", value: event.subjectId, wide: true }]}
                  key={event.id}
                  title={event.action}
                />
              ))}
            </div>
          </>
        ) : null}
      </Panel>
      <Panel className="mt-5" title="Current browser session" description="Local UI actions recorded since this page loaded. They are separate from the stored platform audit trail.">
        <ViewToolbar><AdminSelect ariaLabel="Current session event risk" onChange={setRisk} options={["All events", "Normal", "Review", "High", "Blocked"]} value={risk} /><span className="text-xs text-muted-foreground sm:ml-auto">Session labels only</span></ViewToolbar>
        {sessionEvents.length === 0 ? <EmptyState title="No session actions" description="Nothing matching these filters has been recorded in this browser session." /> : null}
        {sessionEvents.length > 0 ? (
          <>
            <div className="hidden md:block">
              <Table className="min-w-[820px]"><TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead><TableHead>Session label</TableHead></TableRow></TableHeader><TableBody>{sessionEvents.map((event) => <TableRow key={event.time + event.action}><TableCell className="font-mono text-xs text-muted-foreground">{event.time}</TableCell><TableCell className="font-semibold">{event.actor}</TableCell><TableCell>{event.action}</TableCell><TableCell className="font-mono text-xs">{event.target}</TableCell><TableCell><StatusPill tone={event.risk === "Blocked" ? "danger" : event.risk === "High" ? "warning" : event.risk === "Review" ? "info" : "neutral"}>{event.risk}</StatusPill></TableCell></TableRow>)}</TableBody></Table>
            </div>
            <div className="divide-y divide-border md:hidden">
              {sessionEvents.map((event) => (
                <MobileRecord
                  fields={[{ label: "Actor", value: event.actor }, { label: "Time", value: event.time }, { label: "Target", value: event.target, wide: true }]}
                  key={event.time + event.action}
                  status={<StatusPill tone={event.risk === "Blocked" ? "danger" : event.risk === "High" ? "warning" : event.risk === "Review" ? "info" : "neutral"}>{event.risk}</StatusPill>}
                  title={event.action}
                />
              ))}
            </div>
          </>
        ) : null}
      </Panel>
      </>
      )}
    </>
  );
}

/**
 * Why the hold decision is disabled rather than persisted.
 *
 * A supervisor hold is a `public.held_drafts` row, and its `held_draft_status`
 * enum offers draft, approved, sent and discarded — none of which records
 * "acknowledged as a correct hold" or "returned to the operator". Neither is
 * there a cross-tenant queue endpoint for a platform admin to act through: the
 * support barrel exports thread-scoped functions only. Writing either decision
 * into a column that means something else, or leaving the buttons changing
 * local state while the copy says the operator was told, are both worse than
 * saying so. A new state column is a migration this lane may not write.
 */
const HOLD_REVIEW_UNAVAILABLE = "Recording a hold decision needs a supervisor review record, which the support tables do not keep yet.";

type HeldReply = {
  age: string;
  client: string;
  evidence: string;
  id: string;
  operator: string;
  reason: string;
  request: string;
  response: string;
};

/**
 * The hold queue is empty because no cross-tenant hold queue is readable.
 *
 * The two entries this replaces were whole conversations, each naming a client
 * and the operator workspace they belong to, carrying an age, an evidence line
 * and a confidence figure, rendered under a pill counting them as awaiting
 * review. None of the four people in them exists.
 * The buttons were correctly disabled, but the queue itself was the claim: a
 * platform administrator was being shown two clients waiting on them. Held
 * drafts are thread-scoped rows a platform admin has no endpoint to list, so
 * there is nothing to read and an empty queue is the true one.
 */
const HELD_REPLIES: readonly HeldReply[] = [];

function HeldRepliesSection() {
  const { coachDecisions } = useAdminSession();
  const holds = HELD_REPLIES;

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <p className="min-w-0 flex-1 text-sm leading-6 text-muted-foreground">
          Each hold arrives with a drafted supervisor answer preloaded; review
          the draft, then acknowledge the hold or return it to the operator.
        </p>
        <StatusPill tone={holds.length ? "warning" : "success"}>{holds.filter((hold) => !coachDecisions[hold.id]).length} awaiting review</StatusPill>
      </div>
      <div className="mb-4"><Notice>{HOLD_REVIEW_UNAVAILABLE}</Notice></div>
      {holds.length === 0 ? <Panel title="Held replies"><EmptyState title="No held replies" description="No AI reply is waiting for supervisor review here. Held drafts stay with the operator thread that raised them." /></Panel> : null}
      <div className="space-y-5">
        {holds.map((hold) => {
          const decision = coachDecisions[hold.id];
          return (
            <Panel
              key={hold.id}
              title={`${hold.id} · ${hold.reason}`}
              description={`${hold.operator} · ${hold.client} · ${hold.age}`}
              trailing={<StatusPill tone={decision ? "success" : "warning"}>{decision ? (decision === "returned" ? "Returned" : "Acknowledged") : "Held"}</StatusPill>}
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-border bg-muted/25 p-4">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">Client request</p>
                  <p className="mt-2 text-sm leading-6">{hold.request}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/25 p-4">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">Preloaded drafted answer</p>
                  <p className="mt-2 text-sm leading-6">{hold.response}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1"><p className="text-xs font-semibold">Supervisor evidence</p><p className="mt-1 text-xs text-muted-foreground">{hold.evidence}</p></div>
                {!decision ? <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled title={HOLD_REVIEW_UNAVAILABLE} variant="outline">Return to operator</Button><Button className="min-h-11" disabled title={HOLD_REVIEW_UNAVAILABLE}>Acknowledge hold</Button></div> : null}
              </div>
            </Panel>
          );
        })}
      </div>
    </>
  );
}

/**
 * Why the element grid no longer reports a status, and where the tickets come from.
 *
 * The seven elements are a real inventory — portal access, monitoring display,
 * readiness analysis, the vault sync, AI reply review, e-sign, SaaS billing —
 * but nothing on this platform watches any of them. The pills that used to sit
 * beside them were computed from seven fixture tickets naming three operator
 * workspaces that do not exist, with two hardcoded exceptions: "2 awaiting
 * review" for AI reply review and "Synced 4 min ago" for the vault sync. The
 * vault sync does record a real time, in `banks_cache`, but no route serves it
 * — `/api/banks` carries per-lender rows and no sync timestamp — so there is
 * nothing here to read it from, and inventing four minutes is what this removes.
 *
 * The queue below is the durable one: `/api/support/threads` under the admin's
 * own session, narrowed to the platform-support kind, which is the escalation
 * path an operator actually has. It carries no per-element association and no
 * severity, so neither is shown.
 */
const HEALTH_NOT_MONITORED = "These platform elements have no automated health check. The platform support queue below is the recorded source.";

type AdminSupportRead =
  | { state: "loading" }
  | { state: "disabled" }
  | { state: "failed" }
  | { state: "ready"; threads: readonly SupportInboxThread[] };

function SupportTicketsSection() {
  const [read, setRead] = useState<AdminSupportRead>({ state: "loading" });
  useEffect(() => {
    let active = true;
    void readSupportInbox().then((result) => {
      if (!active) return;
      setRead(result.state === "ready"
        ? { state: "ready", threads: result.threads.filter((thread) => thread.kind === "platform_support") }
        : result);
    });
    return () => { active = false; };
  }, []);
  const healthCategories = Array.from(new Set(HEALTH_ELEMENTS.map((element) => element.category)));
  const threads = read.state === "ready" ? read.threads : [];
  const openThreadCount = threads.filter((thread) => thread.status !== "resolved").length;
  const queueReason = read.state === "loading"
    ? "Loading the platform support queue"
    : read.state === "disabled"
      ? "Platform support is not enabled"
      : read.state === "failed"
        ? "The platform support queue could not be read"
        : null;

  return (
    <Panel
      title="System health"
      description={HEALTH_NOT_MONITORED}
      trailing={read.state === "ready" ? <StatusPill tone={openThreadCount ? "warning" : "success"}>{openThreadCount} open</StatusPill> : null}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {healthCategories.map((category) => (
          <section key={category}>
            <h3 className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{category}</h3>
            <div className="divide-y divide-border">
              {HEALTH_ELEMENTS.filter((element) => element.category === category).map((element) => (
                <div className="flex w-full items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0" key={element.id}>
                  <span className="text-sm font-medium">{element.label}</span>
                  <StatusPill tone="neutral">Not monitored</StatusPill>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs font-semibold">Platform support queue</p>
        {queueReason ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{queueReason}</p> : threads.length === 0
          ? <p className="mt-2 text-xs leading-5 text-muted-foreground">No operator has an open platform support conversation.</p>
          : (
            <div className="mt-2 space-y-2">
              {threads.map((thread) => (
                <div className="rounded-lg border border-border p-3" key={thread.id}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold">{thread.subject}</p>
                    <StatusPill tone={thread.status === "resolved" ? "success" : thread.status === "pending" ? "warning" : "info"}>{titleCase(thread.status)}</StatusPill>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Last activity {formatInstant(thread.lastActivityAt)}</p>
                </div>
              ))}
            </div>
          )}
      </div>
    </Panel>
  );
}

function SupportView() {
  const { coachDecisions } = useAdminSession();
  const [supportTab, setSupportTab] = useState<"tickets" | "held-replies" | "privacy">("tickets");
  // The badge counts what the tab will actually render. It was the literal 2
  // minus the decisions taken, so it promised two items over a queue this
  // surface cannot read.
  const heldCount = HELD_REPLIES.filter((hold) => !coachDecisions[hold.id]).length;

  return (
    <>
      <PageHeader
        eyebrow="Operator support"
        title="Support"
        description="Operator tickets, consumer privacy requests, ticket-driven system health, and AI replies held for supervisor review."
      />
      <PillTabs
        onChange={setSupportTab}
        tabs={[
          { label: "Support tickets", value: "tickets" },
          { label: "Privacy requests", value: "privacy" },
          { label: `Held replies · ${heldCount}`, value: "held-replies" },
        ]}
        value={supportTab}
      />
      {supportTab === "tickets"
        ? <SupportTicketsSection />
        : supportTab === "privacy"
          ? <AdminPrivacyRequests />
          : <HeldRepliesSection />}
    </>
  );
}
/**
 * The chat playground asks the platform's grounded assistant, or says it is off.
 *
 * What it replaces: a model picker offering "GPT-5 · OpenRouter", "Gemini 2.5
 * Pro · OpenRouter" and "Llama 4 Maverick · OpenRouter", a grounding switch,
 * and four scripted answers keyed on words in the question — each ending in a
 * sentence about the supervisor and the grounding state, as though a model had
 * run and a guardrail had fired. It was the default tab of AI Brain and behind
 * no flag, so this was the first thing a platform administrator saw, and the
 * only honest line on it was the caption admitting the replies were canned.
 *
 * It mounts the durable assistant workspace at admin scope. `/api/kb/operator`
 * admits `platform_admin` by role, which is why the operator's panel rendered
 * here, but "the route lets them in" is a weaker thing than the right
 * grounding: a platform administrator governing tenants should be grounded on
 * platform records rather than on whatever workspace their session resolves
 * to. The workspace reads its own availability from
 * `GET /api/assistant/conversations` and renders its own disabled state, so
 * nothing here keeps a second copy of that fact.
 */
function ChatPlaygroundSection({ viewerName }: { viewerName?: string | null }) {
  return (
    <div className="space-y-5">
      <p className="text-sm leading-6 text-muted-foreground">
        Questions go to the platform&rsquo;s grounded assistant under this
        session&rsquo;s own access. Answers cite the record they came from, and
        a request the platform guardrail refuses is refused here too.
      </p>
      <AdminAssistantWorkspace viewerName={viewerName} />
    </div>
  );
}

function GovernedPromptsSection() {
  const [families, setFamilies] = useState<readonly { key: PromptKey; fallback: { body: string } }[]>([]);
  const [selected, setSelected] = useState<PromptKey>("funding-readiness-plan");
  const [versions, setVersions] = useState<readonly PromptVersionRow[]>([]);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error" | "disabled">("loading");
  const [note, setNote] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([loadAdminPrompts(), loadAdminPromptVersions(selected)])
      .then(([loadedFamilies, loadedVersions]) => {
        if (!active) return;
        setFamilies(loadedFamilies);
        setVersions(loadedVersions);
        const activeVersion = loadedVersions.find((version) => version.active);
        const fallback = loadedFamilies.find((family) => family.key === selected)?.fallback.body ?? "";
        setDraft(activeVersion?.body ?? fallback);
        setState("ready");
      })
      .catch((error: unknown) => { if (active) setState(adminReadNotEnabled(error) ? "disabled" : "error"); });
    return () => { active = false; };
  }, [selected]);
  const append = async () => {
    setNote("");
    try {
      const created = await createAdminPromptVersion(selected, draft);
      setVersions((current) => [created, ...current]);
      setNote(`Version ${created.version} appended. Active traffic is unchanged.`);
    } catch { setNote("The prompt version could not be appended."); }
  };
  const activate = async (version: number) => {
    setNote("");
    try {
      const activation = await activateAdminPromptVersion(selected, version);
      if (activation.status === "held") {
        setNote(`Version ${activation.prompt.version} remains staged until every required evaluator has a current passing result.`);
        return;
      }
      setVersions((current) => current.map((item) => ({ ...item, active: item.version === activation.prompt.version })));
      setDraft(activation.prompt.body);
      setNote(`Version ${activation.prompt.version} is active.`);
    } catch { setNote("The prompt version could not be activated."); }
  };
  const evaluate = async (version: number) => {
    setNote("");
    try {
      const evaluation = await evaluateAdminPromptVersion(selected, version);
      setNote(evaluation.reason === "launch_driver_unavailable"
        ? "Mock evaluation evidence cannot activate a prompt. Configure the launch driver before evaluating."
        : `Version ${version} evaluation ${evaluation.passed ? "passed" : "was held"}.`);
    } catch { setNote("The prompt version could not be evaluated."); }
  };
  const activeVersion = versions.find((version) => version.active);
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center"><AdminSelect ariaLabel="Prompt family" onChange={(value) => { setState("loading"); setSelected(value as PromptKey); }} options={["funding-readiness-plan", "support-draft"]} value={selected} /><span className="text-xs text-muted-foreground">{activeVersion ? `Stored version ${activeVersion.version} active` : "Embedded code-v1 fallback active"}</span></div>
      {state === "loading" ? <Panel title="Loading prompts"><span /></Panel> : null}
      {state === "disabled" ? <Notice>{ADMIN_GOVERNANCE_ABSENT}</Notice> : state === "error" ? <Notice tone="warning">Prompt history could not be loaded.</Notice> : null}
      {note ? <Notice>{note}</Notice> : null}
      {state === "ready" ? <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel title={selected} description={activeVersion ? `Editing from stored version ${activeVersion.version}` : "Editing from the embedded fallback"}>
          <Textarea aria-label="Governed prompt body" className="min-h-[24rem] font-mono text-xs leading-6" onChange={(event) => setDraft(event.target.value)} value={draft} />
          <div className="mt-4 flex justify-end"><Button onClick={() => void append()}>Append version</Button></div>
        </Panel>
        <Panel title="Version history" description={versions.length ? "Activation requires a passing run under the current code-owned evaluator policy after the version was created." : "No persisted versions. Embedded code-v1 remains active."}>
          <div className="space-y-3">{versions.map((version) => <div className="rounded-lg border border-border p-3" key={version.version}><div className="flex items-center justify-between gap-3"><span className="font-mono text-sm">v{version.version}</span>{version.active ? <StatusPill tone="success">Active</StatusPill> : <span className="flex gap-2"><Button onClick={() => void evaluate(version.version)} size="sm" variant="outline">Evaluate</Button><Button onClick={() => void activate(version.version)} size="sm" variant="outline">Activate</Button></span>}</div><p className="mt-2 text-xs text-muted-foreground">{formatInstant(version.createdAt)}</p></div>)}</div>
        </Panel>
      </div> : null}
      <span className="hidden">{families.length}</span>
    </div>
  );
}

function GovernedEvaluatorsSection() {
  const [evaluations, setEvaluations] = useState<readonly EvalRunRow[] | null>(null);
  const [failed, setFailed] = useState<false | "error" | "disabled">(false);
  useEffect(() => {
    let active = true;
    void loadAdminEvals().then((rows) => { if (active) setEvaluations(rows); }).catch((error: unknown) => { if (active) setFailed(adminReadNotEnabled(error) ? "disabled" : "error"); });
    return () => { active = false; };
  }, []);
  if (failed === "disabled") return <Notice>{ADMIN_GOVERNANCE_ABSENT}</Notice>;
  if (failed) return <Notice tone="warning">Evaluation history could not be loaded.</Notice>;
  if (evaluations === null) return <Panel title="Loading evaluation history"><span /></Panel>;
  return (
    <>
      <Panel className="mb-5" title="Evaluator policy" description="Evaluator definitions and mandatory gates remain code-owned." trailing={<StatusPill tone="info">Locked</StatusPill>}><span /></Panel>
      {evaluations.length === 0 ? <Panel title="No evaluation history" description="No persisted evaluation result is available yet."><span /></Panel> : <Panel title="Persisted evaluation history" description="Results are written by the governed engines; this view is read-only.">
        <div className="overflow-x-auto"><Table className="min-w-[760px]"><TableHeader><TableRow><TableHead>Prompt</TableHead><TableHead>Version</TableHead><TableHead>Evaluator</TableHead><TableHead>Result</TableHead><TableHead>Ran at</TableHead></TableRow></TableHeader><TableBody>{evaluations.map((evaluation) => <TableRow key={evaluation.id}><TableCell>{evaluation.promptKey}</TableCell><TableCell className="tabular-nums">{evaluation.promptVersion}</TableCell><TableCell>{evaluation.evaluatorKey}</TableCell><TableCell><StatusPill tone={evaluation.passed ? "success" : "warning"}>{evaluation.passed ? "Passed" : "Held"}</StatusPill></TableCell><TableCell className="text-xs">{formatInstant(evaluation.ranAt)}</TableCell></TableRow>)}</TableBody></Table></div>
      </Panel>}
    </>
  );
}

function PromptsSection() {
  const { promptDrafts, recordAudit, setPromptDrafts } = useAdminSession();
  const [selectedId, setSelectedId] = useState(PROMPTS[1].id);
  const selected = PROMPTS.find((prompt) => prompt.id === selectedId) ?? PROMPTS[0];
  const [note, setNote] = useState("");
  const text = promptDrafts[selected.id] ?? selected.text;
  function saveDraft() {
    setNote("Draft saved. Production traffic remains on the active version.");
    recordAudit({ action: `Saved draft for ${selected.name}`, target: `prompts.${selected.id}`, risk: "Review" });
  }
  function requestActivation() {
    setNote("Activation requested. The prompt will stay staged until required evaluators pass.");
    recordAudit({ action: `Requested activation for ${selected.name}`, target: `prompts.${selected.id}`, risk: "High" });
  }
  return (
    <>
      {note ? <div className="mb-4"><Notice tone="success">{note}</Notice></div> : null}
      <div className="grid gap-5 xl:grid-cols-[19rem_minmax(0,1fr)]">
        <Panel title="Preloaded prompts" description="Pick a prompt, then edit the preloaded text directly"><div className="space-y-2">{PROMPTS.map((prompt) => <button aria-pressed={selected.id === prompt.id} className={cn("w-full rounded-lg border p-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-ring", selected.id === prompt.id ? "border-primary-ink bg-primary/8" : "border-border hover:bg-muted/50")} key={prompt.id} onClick={() => { setSelectedId(prompt.id); setNote(""); }} type="button"><span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{prompt.name}</span><StatusPill tone="success">{prompt.version}</StatusPill></span><span className="mt-2 block text-xs leading-5 text-muted-foreground">{prompt.description}</span><span className="mt-2 flex justify-between text-[0.68rem] text-muted-foreground"><span>{prompt.traffic}</span><span className="tabular-nums">score {prompt.score}</span></span></button>)}</div></Panel>
        <Panel title={selected.name} description={`${selected.version} active in production · last eval score ${selected.score}`} trailing={<Button onClick={() => setPromptDrafts((current) => ({ ...current, [selected.id]: selected.text }))} size="sm" variant="outline">Reset draft</Button>}>
          <Textarea aria-label={`${selected.name} prompt`} className="min-h-[24rem] font-mono text-xs leading-6" onChange={(event) => setPromptDrafts((current) => ({ ...current, [selected.id]: event.target.value }))} value={text} />
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center"><p className="text-xs text-muted-foreground">Activation requires a passing compliance and grounding run.</p><div className="flex gap-2 sm:ml-auto"><Button onClick={saveDraft} variant="outline">Save draft</Button><Button onClick={requestActivation}>Request activation</Button></div></div>
        </Panel>
      </div>
    </>
  );
}

function EvaluatorsSection() {
  const { evaluatorEnabled, evaluatorThreshold, recordAudit, setEvaluatorEnabled, setEvaluatorThreshold } = useAdminSession();
  const [draftEnabled, setDraftEnabled] = useState<Record<string, boolean>>(() => ({ ...evaluatorEnabled, compliance: true, grounding: true }));
  const [draftThreshold, setDraftThreshold] = useState(evaluatorThreshold);
  const [note, setNote] = useState("");
  const enabledCount = EVALUATORS.filter((evaluator) => draftEnabled[evaluator.id]).length;
  function saveEvaluators() {
    const committedEnabled = { ...draftEnabled, compliance: true, grounding: true };
    setEvaluatorEnabled(committedEnabled);
    setEvaluatorThreshold(draftThreshold);
    setNote(`Evaluator gate saved at ${draftThreshold}% with ${enabledCount} enabled. Future reruns will use this configuration.`);
    recordAudit({ action: `Saved evaluator gate at ${draftThreshold}% with ${enabledCount} enabled`, target: "evaluators.release_gate", risk: "High" });
  }
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-sm leading-6 text-muted-foreground">Quality checks that grade every prompt release. Eval runs live under Access &amp; audit log; reference datasets are the vault itself.</p>
        <Button onClick={saveEvaluators}>Save configuration</Button>
      </div>
      {note ? <div className="mb-4"><Notice tone="success">{note}</Notice></div> : null}
      <Panel className="mb-5" title="Release threshold" description="A required evaluator below this score blocks prompt activation"><div className="flex flex-col gap-3 sm:flex-row sm:items-center"><input aria-label="Release threshold" className="min-h-11 w-full accent-primary sm:max-w-md" max="95" min="50" onChange={(event) => setDraftThreshold(Number(event.target.value))} type="range" value={draftThreshold} /><span className="text-sm font-semibold tabular-nums">{draftThreshold}% minimum · {enabledCount} enabled</span></div></Panel>
      <div className="grid gap-5 lg:grid-cols-2">{EVALUATORS.map((evaluator) => {
        const required = evaluator.id === "compliance" || evaluator.id === "grounding";
        return <Panel key={evaluator.id} title={evaluator.name} description={evaluator.type} trailing={required ? <StatusPill tone="info">Required</StatusPill> : <Switch aria-label={`Enable ${evaluator.name}`} checked={draftEnabled[evaluator.id]} onCheckedChange={(value) => setDraftEnabled((current) => ({ ...current, [evaluator.id]: value }))} />}><p className="text-sm leading-6 text-muted-foreground">{evaluator.description}</p><div className="mt-5 flex items-center justify-between border-t border-border pt-4"><span className="text-xs text-muted-foreground">30-day blended score</span><span className="text-lg font-semibold tabular-nums">{evaluator.score}</span></div></Panel>;
      })}</div>
    </>
  );
}

function AiBrainView({ adminEnabled = false, viewerName }: { adminEnabled?: boolean; viewerName?: string | null }) {
  const [brainTab, setBrainTab] = useState<"playground" | "prompts" | "evaluators">("playground");
  return (
    <>
      <PageHeader
        eyebrow="Platform AI"
        title="AI Brain"
        description="Test the coach in chat, edit the preloaded prompts, and tune the evaluator gate. Runs live under Access & audit log; the vault is the reference dataset."
      />
      <PillTabs
        onChange={setBrainTab}
        tabs={[
          { label: "Chat playground", value: "playground" },
          { label: "Prompts", value: "prompts" },
          { label: "Evaluators", value: "evaluators" },
        ]}
        value={brainTab}
      />
      {brainTab === "playground" ? <ChatPlaygroundSection viewerName={viewerName} /> : brainTab === "prompts" ? (adminEnabled ? <GovernedPromptsSection /> : <PromptsSection />) : (adminEnabled ? <GovernedEvaluatorsSection /> : <EvaluatorsSection />)}
    </>
  );
}

/**
 * Why a rerun is disabled rather than executed, and why no run history renders.
 *
 * The one real execution path is `/api/admin/prompts/[key]/[version]/evaluate`,
 * and it evaluates a staged prompt version — it answers 409 for the active one.
 * The four rows this section used to list were not prompt versions at all: they
 * carried per-evaluator percentages, a model name and a dataset that no
 * persisted `eval_runs` row has, above a metric strip claiming 38 runs this
 * month and three blocked releases. None of it came from an engine, and a
 * caveat above a table of invented verdicts still leaves the verdicts on
 * screen. The persisted history that does exist is read from `eval_runs` and
 * rendered under AI Brain → Evaluators.
 */
const EVAL_RUN_UNAVAILABLE = "Running a suite needs a staged prompt version, and this view has no engine behind it. Persisted evaluation results are listed under AI Brain.";

function RunsSection() {
  const [status, setStatus] = useState("All statuses");

  return (
    <>
      <div className="mb-4"><Notice>{EVAL_RUN_UNAVAILABLE}</Notice></div>
      <div className="mt-5"><ViewToolbar><AdminSelect ariaLabel="Run status" onChange={setStatus} options={["All statuses", "Passed", "Needs review"]} value={status} /><Button disabled size="sm" title={EVAL_RUN_UNAVAILABLE} variant="outline"><Play aria-hidden />Run current suite</Button><span className="text-xs text-muted-foreground sm:ml-auto">{GOVERNED_GATE_SUMMARY}</span></ViewToolbar></div>
      <Panel title="Run history" description="Newest first · each run retains the gate used for its verdict">
        <EmptyState title="No run history" description="No evaluation run is recorded against this view. Results written by the governed engines are listed under AI Brain." />
      </Panel>
    </>
  );
}

function renderAdminView(
  activeView: AdminView,
  onNavigate: (view: AdminView) => void,
  monitoringSplitLabel: string,
  adminEnabled: boolean,
  vaultEnabled: boolean,
  durableWorkspace: boolean,
  // The signed-in administrator's own name, for the assistant's greeting. Threaded rather than
  // resolved a second time inside the assistant, so this surface has one answer about who is
  // looking at it.
  viewerName: string | null,
) {
  switch (activeView) {
    case "overview": return <OverviewView onNavigate={onNavigate} />;
    case "tenants": return <TenantsView />;
    case "lenders": return <LendersView vaultEnabled={vaultEnabled} />;
    case "trainings": return <TrainingsView durableWorkspace={durableWorkspace} />;
    case "billing": return <BillingView adminEnabled={adminEnabled} monitoringSplitLabel={monitoringSplitLabel} />;
    case "security": return <SecurityView />;
    case "support": return <SupportView />;
    case "ai-brain": return <AiBrainView adminEnabled={adminEnabled} viewerName={viewerName} />;
    case "ai-chat": return <AdminAssistant viewerName={viewerName} />;
  }
}

export function AdminSurface({
  adminEnabled = false,
  onOpenProfiles,
  paidRefreshEnabled = false,
  sessionIdentity,
  signedIn = false,
  vaultEnabled = false,
}: SurfaceProps & {
  adminEnabled?: boolean;
  paidRefreshEnabled?: boolean;
  /**
   * The signed-in account, read server-side by the route. Absent means either
   * the fixture shell (no session at all) or a read that did not complete, and
   * those two are told apart by `signedIn` below rather than by guessing.
   */
  sessionIdentity?: SessionDisplayIdentity;
  /**
   * Whether a real session is behind this render. The fixture shell keeps its
   * fixture persona, which is honest there; a real session with no readable
   * identity gets a neutral placeholder instead of somebody else's name.
   */
  signedIn?: boolean;
  vaultEnabled?: boolean;
}) {
  const [activeView, setActiveView] = useState<AdminView>("overview");
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [bankComments, setBankComments] = useState<BankComment[]>([]);
  const [coachDecisions, setCoachDecisions] = useState<Record<string, "acknowledged" | "returned">>({});
  const [config, setConfig] = useState<PlatformConfig>({ coach: true, escalate: true, purge: true, sandbox: true, trialCoach: false });
  const [configConfidence, setConfigConfidence] = useState("0.75");
  const [evaluatorEnabled, setEvaluatorEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(EVALUATORS.map((evaluator) => [evaluator.id, true])));
  const [evaluatorThreshold, setEvaluatorThreshold] = useState(75);
  const [extraCases, setExtraCases] = useState<Record<string, number>>({});
  const [forcePullPrice, setForcePullPrice] = useState("$19");
  const [monitoringSplitPercent, setMonitoringSplitPercent] = useState(40);
  const [intelDecisions, setIntelDecisions] = useState<Record<string, "promoted" | "rejected">>({});
  const [knowledgePages, setKnowledgePages] = useState<KnowledgePage[]>(KNOWLEDGE_PAGES);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [searchableWorkspaces, setSearchableWorkspaces] = useState<
    readonly AdminWorkspace[]
  >([]);
  // Whoever is signed in, for the two places this surface stamps a name onto
  // something: the session audit list and a staged bank comment. The fixture
  // shell has no session, so it keeps the fixture persona; a real session with
  // an unreadable profile gets a role word, never another person's name.
  const actorName = sessionIdentity?.name ?? (signedIn ? PLACEHOLDER_ADMIN_NAME : "Alec Rivera");
  useEffect(() => {
    if (!paidRefreshEnabled) return;
    let active = true;
    void fetch("/api/pricing/admin", { cache: "no-store", credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((catalog: AdminPricingCatalog | null) => {
        if (!active || !catalog?.enabled) return;
        setForcePullPrice(`$${(catalog.forcePull.amountCents / 100).toFixed(0)}`);
        setMonitoringSplitPercent(catalog.monitoringSplit.percent);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [paidRefreshEnabled]);
  useEffect(() => {
    // The fixture shell never calls the platform-wide roster. In production
    // this is the same admin-only, flag-gated tenant read used by Operators,
    // and a refused or malformed response contributes no search records.
    if (!signedIn || !adminEnabled) return undefined;
    let active = true;
    void loadAdminWorkspaceRoster()
      .then((workspaces) => {
        if (active) setSearchableWorkspaces(workspaces ?? []);
      })
      .catch(() => {
        if (active) setSearchableWorkspaces([]);
      });
    return () => {
      active = false;
    };
  }, [adminEnabled, signedIn]);
  const navigate = (view: string) => {
    if (ADMIN_VIEW_IDS.includes(view)) setActiveView(view as AdminView);
  };
  const adminCommandRecords: CommandPaletteRecord[] = (
    signedIn && adminEnabled ? searchableWorkspaces : []
  ).map((workspace, index) => ({
    description: `Operator workspace · ${workspace.plan.toUpperCase()} · ${workspace.membership.replaceAll("_", " ")}`,
    icon: Building2,
    id: `workspace-${index + 1}`,
    keywords: [workspace.slug, workspace.plan, workspace.membership],
    label: workspace.name,
    onSelect: () => navigate("tenants"),
  }));
  const monitoringSplitLabel = paidRefreshEnabled ? `${monitoringSplitPercent}%` : "40%";
  function recordAudit(event: Omit<AuditEvent, "actor" | "time"> & { time?: string }) {
    setAuditEvents((current) => [{ ...event, actor: actorName, time: event.time ?? "Just now" }, ...current]);
  }

  return (
    <AdminSessionContext.Provider
      value={{
        actorName,
        auditEvents,
        bankComments,
        coachDecisions,
        config,
        configConfidence,
        evaluatorEnabled,
        evaluatorThreshold,
        extraCases,
        forcePullPrice,
        intelDecisions,
        knowledgePages,
        promptDrafts,
        recordAudit,
        setBankComments,
        setCoachDecisions,
        setConfig,
        setConfigConfidence,
        setEvaluatorEnabled,
        setEvaluatorThreshold,
        setExtraCases,
        setForcePullPrice,
        setIntelDecisions,
        setKnowledgePages,
        setPromptDrafts,
      }}
    >
      <DemoShell
        activeView={activeView}
        brand="MostFundable"
        currentRole="admin"
        eyebrow="Platform Admin"
        footer={
          <div className="mx-3 rounded-lg border border-sidebar-border bg-background/70 p-3">
            <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">CCA VAULT</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Canonical lender, knowledge, and staged intel records.</p>
          </div>
        }
        initials={sessionIdentity ? displayInitials(sessionIdentity.name) : signedIn ? PLACEHOLDER_ADMIN_INITIALS : "AR"}
        onNavigate={navigate}
        onOpenProfiles={onOpenProfiles}
        profileName={actorName}
        roleLabel="Platform administrator"
        sections={ADMIN_SECTIONS}
        theme="workspace"
      >
        <div className="mb-5 flex justify-end">
          <CommandPalette
            className="w-full sm:w-auto"
            onNavigate={navigate}
            pages={adminCommandPages}
            records={adminCommandRecords}
            triggerLabel="Search pages and records"
          />
        </div>
        {/*
          `adminEnabled || signedIn`, not `adminEnabled`. Four tabs kept a
          fixture twin behind the governed one — an analytics strip derived from
          the in-memory application book, a settings panel whose Save toasts
          "Four operator workspaces will receive the change", a prompt library
          reporting "v14 · 1,284 conversations", and an evaluator page claiming a
          30-day blended 0.98 — and the flag alone chose between them. Switching
          FEATURE_ADMIN off therefore did not degrade the page, it repopulated it
          with invented platform figures for whoever was signed in. A flag
          decides whether the governed read happens; a session decides whether a
          fixture may stand in for it, and a real one never may. The twins stay
          reachable from the illustrative shell, which has no session and where
          they are the honest thing to show.
        */}
        {renderAdminView(activeView, setActiveView, monitoringSplitLabel, adminEnabled || signedIn, vaultEnabled, signedIn, sessionIdentity?.name ?? null)}
        {activeView !== "ai-chat" ? (
          <ScopedAssistantCompanion scope="admin" view={activeView} viewerName={sessionIdentity?.name ?? null} />
        ) : null}
      </DemoShell>
    </AdminSessionContext.Provider>
  );
}
