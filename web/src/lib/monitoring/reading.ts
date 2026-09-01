// web/src/lib/monitoring/reading.ts — the mock monitoring reading the credit panel renders.
//
// WHY THIS DERIVES AND DOES NOT STORE.
//
// The two data rails are not symmetric. The CRS Data API analysis is server-side and may persist
// its DERIVED outputs; the monitoring widget is display-only and bureau values are never stored.
// Per-bureau scores belong to the second rail, so a `credit_snapshots` table with score columns
// would be a place real bureau values could land the day the sandbox driver is wired — exactly
// the storage the rail forbids. Instead the reading is recomputed on every read from rows that
// are already durable: one completed `analysis_runs` row per paid refresh, keyed by its own id.
//
// That gives the persistence the panel actually needs without the storage the rail forbids:
//
//   - it survives a reload and a rerun, because the run rows do;
//   - it never rerolls, because the id seeds it and the id never changes;
//   - it is server-authoritative, because the browser is sent finished numbers and no seed.
//
// This is also what the real driver will do. A real snapshot is fetched and displayed, never
// written down, so deriving here is closer to the eventual behaviour than a table would be.
//
// MOCK ONLY. `readMonitoringReading` refuses to build a reading unless the CRS driver is `mock`;
// under `sandbox` the panel renders provider data untouched. Nothing in this file is reachable
// from the real pull path.
//
// Determinism is a requirement, not a nicety — the same run ids must produce the same page on
// every load, in every process. Nothing here reads a clock, a random number or an environment
// variable: every value is a pure function of the baseline and the ordered run ids.

/** One bureau's line on the panel. */
export interface MonitoringBureauReading {
  readonly bureau: string;
  readonly score: number;
  readonly band: string;
  /** The caption under the number. The verb is per bureau and only the date moves. */
  readonly change: string;
}

export interface MonitoringReading {
  readonly bureaus: readonly MonitoringBureauReading[];
  /** What moved since the previous pull, in the vocabulary the panel already uses. */
  readonly whatChanged: string;
  /** The primary utilization watch item, kept consistent with `whatChanged`. */
  readonly utilizationPct: number;
  /** Display date of the most recent pull, e.g. `Aug 22`. */
  readonly asOfLabel: string;
  /** Display date of the next included refresh, 30 days on. */
  readonly nextRefreshLabel: string;
}

/**
 * The baseline file, and the ONE definition of it.
 *
 * The consumer surface imports these three rows rather than repeating them, so the flag-off
 * fixture and the flag-on baseline cannot drift apart: a refresh that has not happened yet
 * renders byte-identically to the frozen surface.
 */
export const MONITORING_BASELINE: readonly MonitoringBureauReading[] = [
  { bureau: "TransUnion", score: 682, band: "Good", change: "Updated Jul 14" },
  { bureau: "Equifax", score: 654, band: "Fair", change: "Snapshot Jul 14" },
  { bureau: "Experian", score: 691, band: "Good", change: "Updated Jul 14" },
];

/** The baseline pull date, matching the frozen surface's copy. */
export const MONITORING_BASELINE_LABEL = "Jul 14";

/** The baseline utilization watch item, matching the frozen surface's copy. */
export const MONITORING_BASELINE_UTILIZATION_PCT = 64;

/** The account the utilization watch item names, in both the baseline and every derived reading. */
const WATCH_ACCOUNT = "Chase Ink";

/** Included refreshes are monthly; the panel states the next one as a date. */
const INCLUDED_REFRESH_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * VantageScore 3.0 bands, which is what the panel names as its model.
 *
 * The thresholds reproduce the baseline exactly — 654 is Fair and 682/691 are Good — so a
 * refresh that lands on the same number cannot silently relabel it.
 */
const BANDS: ReadonlyArray<{ readonly floor: number; readonly band: string }> = [
  { floor: 781, band: "Excellent" },
  { floor: 661, band: "Good" },
  { floor: 601, band: "Fair" },
  { floor: 500, band: "Poor" },
  { floor: 300, band: "Very poor" },
];

function bandFor(score: number): string {
  for (const entry of BANDS) {
    if (score >= entry.floor) return entry.band;
  }
  return BANDS[BANDS.length - 1].band;
}

/**
 * FNV-1a over a string, as the seed for one bureau's move in one refresh.
 *
 * A hash rather than a counter because the two inputs that must not correlate are the run id and
 * the bureau: seeding from a sequence number would move all three bureaus in lockstep, which is
 * the one shape a real tri-bureau file never has. Not a security primitive and not used as one.
 */
function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Smallest and largest absolute move a single refresh may make to one bureau. */
const MIN_DRIFT = 3;
const MAX_DRIFT = 12;

/** VantageScore 3.0's range, so a long chain of refreshes cannot walk a number out of it. */
const SCORE_FLOOR = 300;
const SCORE_CEILING = 850;

function clampScore(score: number): number {
  return Math.min(SCORE_CEILING, Math.max(SCORE_FLOOR, score));
}

/**
 * The per-bureau moves one refresh makes.
 *
 * A refresh REVEALS a file rather than improving one, so the sign is drawn per bureau and a
 * uniformly upward result is refused: when all three happen to draw positive, the bureau with
 * the lowest seed is turned negative. That tiebreak is deterministic, so the correction cannot
 * make the same run id render two different pages.
 */
function driftFor(runId: string, bureaus: readonly MonitoringBureauReading[]): readonly number[] {
  const seeds = bureaus.map((entry) => seedOf(`${runId}:${entry.bureau}`));
  const deltas = seeds.map((seed) => {
    const magnitude = MIN_DRIFT + (seed % (MAX_DRIFT - MIN_DRIFT + 1));
    // A separate bit for the sign, so magnitude and direction do not move together.
    return (seed & 0x10000) === 0 ? -magnitude : magnitude;
  });

  if (deltas.every((delta) => delta > 0)) {
    let lowest = 0;
    for (let index = 1; index < seeds.length; index += 1) {
      if (seeds[index] < seeds[lowest]) lowest = index;
    }
    return deltas.map((delta, index) => (index === lowest ? -delta : delta));
  }
  return deltas;
}

/** Apply one refresh to a file. Captions are stamped once at the end, not here. */
function applyRefresh(
  bureaus: readonly MonitoringBureauReading[],
  runId: string,
): readonly MonitoringBureauReading[] {
  const deltas = driftFor(runId, bureaus);
  return bureaus.map((entry, index) => {
    const score = clampScore(entry.score + deltas[index]);
    return { band: bandFor(score), bureau: entry.bureau, change: entry.change, score };
  });
}

/**
 * Stamp every caption with the pull date the header states.
 *
 * One date, applied once, because the panel prints it in three places — the header, the three
 * captions and the watch item — and the frozen surface already shipped them disagreeing: a
 * completed fixture refresh moved the header to Jul 21 and left all three captions on Jul 14.
 * The verb stays whatever each bureau already used; only the date moves.
 */
function stampCaptions(
  bureaus: readonly MonitoringBureauReading[],
  label: string,
): readonly MonitoringBureauReading[] {
  return bureaus.map((entry) => ({ ...entry, change: `${entry.change.split(" ")[0]} ${label}` }));
}

/** The included refresh cadence is monthly, stated as a date. */
export function nextIncludedRefreshAt(iso: string): string | null {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed + INCLUDED_REFRESH_DAYS * DAY_MS).toISOString();
}

function includedRefreshLabel(iso: string): string {
  const next = nextIncludedRefreshAt(iso);
  return next === null ? MONITORING_BASELINE_LABEL : monitoringDateLabel(next);
}

/**
 * Utilization after a refresh, derived from where the file as a whole moved.
 *
 * Tied to the average move rather than drawn independently, because the panel prints both on the
 * same screen: a page reporting an eased balance beside three lower numbers reads as broken even
 * though each half was plausible alone.
 */
function utilizationAfter(
  previousPct: number,
  before: readonly MonitoringBureauReading[],
  after: readonly MonitoringBureauReading[],
  runId: string,
): number {
  const total = after.reduce((sum, entry, index) => sum + (entry.score - before[index].score), 0);
  const step = 2 + (seedOf(`${runId}:utilization`) % 6);
  const moved = total < 0 ? previousPct + step : previousPct - step;
  // A watch item is only a watch item inside a plausible band; outside it the sentence beside it
  // would stop being true.
  return Math.min(89, Math.max(11, moved));
}

/** `2026-08-22T…` → `Aug 22`, in UTC so two viewers never disagree about the date. */
export function monitoringDateLabel(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return MONITORING_BASELINE_LABEL;
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(parsed);
}

/**
 * The sentence above the numbers.
 *
 * Compliance (DEV-ONBOARDING rule 4) governs this string exactly as it governs hand-written copy,
 * and it is assembled rather than typed, so the rule is enforced on the PARTS. Nothing here names
 * a score, a point, a gain or a target outcome: every clause reports what a bureau recorded,
 * which is the same vocabulary the frozen panel already used.
 */
function changeSentence(
  before: readonly MonitoringBureauReading[],
  after: readonly MonitoringBureauReading[],
  label: string,
  utilizationRose: boolean,
): string {
  let moved = 0;
  for (let index = 1; index < after.length; index += 1) {
    const current = Math.abs(after[index].score - before[index].score);
    if (current > Math.abs(after[moved].score - before[moved].score)) moved = index;
  }
  const balance = utilizationRose ? "a higher revolving balance" : "a lower revolving balance";
  return (
    `The ${label} ${after[moved].bureau} source record includes ${balance}. ` +
    `The other two bureaus reported no new account activity. ` +
    `${WATCH_ACCOUNT} remains the primary utilization watch item.`
  );
}

export interface CompletedRefresh {
  /** The `analysis_runs` id, which is the seed and never changes. */
  readonly runId: string;
  /** When the run completed, ISO 8601. */
  readonly ranAt: string;
}

export interface DeriveMonitoringReadingOptions {
  readonly baseline?: readonly MonitoringBureauReading[];
  /**
   * When the client's most recent analysis of ANY trigger completed.
   *
   * The dates and the numbers come from different sets on purpose. Only a paid refresh moves the
   * file, but every completed analysis moves the SCHEDULE, and the tracker already derives the
   * Overview's "next refresh" as that run plus thirty days. Reading the dates from the same run
   * is what stops one signed-in user seeing the panel say July and the Overview say September.
   */
  readonly latestRunAt?: string | null;
}

/**
 * Fold every completed paid refresh over the baseline, oldest first.
 *
 * Folding rather than seeding from the latest id alone is what makes a second refresh move the
 * file a second time: the numbers are a function of the whole history, so a client who buys three
 * refreshes sees three distinct files rather than the same one rendered thrice.
 */
export function deriveMonitoringReading(
  refreshes: readonly CompletedRefresh[],
  options: DeriveMonitoringReadingOptions = {},
): MonitoringReading {
  const baseline = options.baseline ?? MONITORING_BASELINE;
  let bureaus = baseline;
  let utilizationPct = MONITORING_BASELINE_UTILIZATION_PCT;
  let asOfLabel = MONITORING_BASELINE_LABEL;
  let whatChanged =
    `The ${MONITORING_BASELINE_LABEL} TransUnion source record includes a lower revolving balance. ` +
    `Experian added the Amex Blue Business account on Jul 9. ` +
    `${WATCH_ACCOUNT} remains the primary utilization watch item.`;
  let nextRefreshLabel = "Aug 13";

  // The pull date is the LATEST completed analysis of any trigger, because every analysis run
  // pulls the file — only a paid refresh is expected to move the numbers, but a scheduled run
  // still re-read them. Taking the date from the same run the tracker does is what keeps the
  // panel and the Overview from stating two different schedules to one signed-in user.
  const scheduleAt = options.latestRunAt ?? refreshes[refreshes.length - 1]?.ranAt ?? null;
  const dated = scheduleAt !== null && !Number.isNaN(Date.parse(scheduleAt));
  if (dated) {
    asOfLabel = monitoringDateLabel(scheduleAt as string);
    nextRefreshLabel = includedRefreshLabel(scheduleAt as string);
  }

  for (const refresh of refreshes) {
    const before = bureaus;
    bureaus = applyRefresh(before, refresh.runId);
    const nextUtilization = utilizationAfter(utilizationPct, before, bureaus, refresh.runId);
    whatChanged = changeSentence(before, bureaus, asOfLabel, nextUtilization > utilizationPct);
    utilizationPct = nextUtilization;
  }

  return {
    asOfLabel,
    bureaus: dated ? stampCaptions(bureaus, asOfLabel) : bureaus,
    nextRefreshLabel,
    utilizationPct,
    whatChanged,
  };
}
