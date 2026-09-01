/**
 * The consumer Account & Billing ledger, ordered by the instant each event happened.
 *
 * This used to be an array literal assembled inline in `SettingsView`, where every row was four
 * display strings and the order was wherever the row happened to be written. Two of those strings
 * were scripted demo dates that stayed in place when the panel switched to the durable arm, so a
 * signed-in consumer whose subscription started on Aug 22 was shown "Jul 21 · On-demand refresh"
 * above it: an add-on charge dated a month before the enrollment that authorized the card. That
 * reads as a charge taken before enrollment succeeded, which is the one thing this platform states
 * on the face of its own enrollment flow that it never does.
 *
 * So a row is a timestamp with a rendering, never a rendering alone, and the order is derived from
 * the timestamps rather than from the order somebody typed the rows in. A row that cannot be dated
 * carries `at: null` and sorts to the end, because an undated row cannot be claimed to precede a
 * dated one.
 *
 * The browser still never reads paid-refresh tables directly: migration 151 grants them to
 * `service_role` only. The authenticated refresh-status endpoint now projects the consumer's own
 * immutable succeeded-payment rows, while this helper continues to render the just-confirmed
 * in-session row until that durable read catches up. The scripted fixture arm keeps its own dates.
 */

/** UTC, and with the year, matching how every other durable date on the consumer surface renders. */
const DURABLE_DATE = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

/** The scripted ledger's own format: no year, because the whole script sits inside one season. */
const FIXTURE_DATE = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** Shown where a row exists but its instant does not. */
export const UNDATED = "—";

export type PaymentHistoryStatus = "Authorized" | "Paid" | "Pending";

export interface PaymentHistoryRow {
  /** Epoch milliseconds, or null when the source carries no parseable instant. */
  at: number | null;
  amount: string;
  date: string;
  item: string;
  status: PaymentHistoryStatus;
}

export interface RefreshCharge {
  /**
   * When the consumer confirmed the purchase, as an ISO instant. Null only if that instant was
   * lost, which dates the row `UNDATED` rather than borrowing a date from somewhere else.
   */
  chargedAt: string | null;
  pending: boolean;
}

export interface SubscriptionLedger {
  activatedAt: string | null;
  /** The card authorization, which is `consumer_subscriptions.created_at`. */
  authorizedAt: string;
  /** The monthly amount, already formatted by the caller that owns money formatting. */
  monthlyAmount: string;
}

export interface PaymentHistoryInput {
  /**
   * True only on the scripted demo arm. The durable arm renders the subscription row instead, and
   * the two never mix: a fixture row beside a durable one is a fabricated charge on a real account.
   */
  fixture: boolean;
  /** The fixture ledger's monthly amount. */
  fixtureMonthlyAmount: string;
  refresh: RefreshCharge | null;
  /** The on-demand refresh amount, for both arms. */
  refreshAmount: string;
  subscription: SubscriptionLedger | null;
}

/**
 * The scripted demo ledger. Each row states its instant, and its rendered date is derived from
 * that instant, so the two cannot drift apart the way a pair of hand-written strings can.
 */
export const FIXTURE_LEDGER = [
  { amount: "monthly", at: "2026-07-20T00:00:00Z", item: "Plus subscription", status: "Paid" },
  { amount: "refresh", at: "2026-07-02T00:00:00Z", item: "On-demand refresh", status: "Paid" },
  { amount: "monthly", at: "2026-06-21T00:00:00Z", item: "Plus subscription", status: "Paid" },
  { amount: "zero", at: "2026-06-20T00:00:00Z", item: "Enrollment authorization", status: "Authorized" },
] as const satisfies readonly {
  amount: "monthly" | "refresh" | "zero";
  at: string;
  item: string;
  status: PaymentHistoryStatus;
}[];

/** The instant the scripted refresh is charged, one day after the scripted ledger's newest row. */
export const FIXTURE_REFRESH_AT = "2026-07-21T00:00:00Z";

function instant(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function render(at: number | null, fixture: boolean): string {
  if (at === null) return UNDATED;
  return (fixture ? FIXTURE_DATE : DURABLE_DATE).format(new Date(at));
}

function row(
  at: number | null,
  item: string,
  amount: string,
  status: PaymentHistoryStatus,
  fixture: boolean,
): PaymentHistoryRow {
  return { amount, at, date: render(at, fixture), item, status };
}

/**
 * Newest first, undated last. `sort` is stable in every runtime this ships on, so two events that
 * share an instant keep the order they were built in.
 */
function newestFirst(rows: PaymentHistoryRow[]): PaymentHistoryRow[] {
  return rows.sort((left, right) => {
    if (left.at === right.at) return 0;
    if (left.at === null) return 1;
    if (right.at === null) return -1;
    return right.at - left.at;
  });
}

export function buildPaymentHistory(input: PaymentHistoryInput): PaymentHistoryRow[] {
  const rows: PaymentHistoryRow[] = [];

  if (input.refresh !== null) {
    const at = instant(input.fixture ? FIXTURE_REFRESH_AT : input.refresh.chargedAt);
    rows.push(row(
      at,
      "On-demand refresh",
      input.refreshAmount,
      input.refresh.pending ? "Pending" : "Paid",
      input.fixture,
    ));
  }

  if (input.fixture) {
    for (const entry of FIXTURE_LEDGER) {
      const amount = entry.amount === "monthly"
        ? input.fixtureMonthlyAmount
        : entry.amount === "refresh"
          ? input.refreshAmount
          : "$0.00";
      rows.push(row(instant(entry.at), entry.item, amount, entry.status, true));
    }
  } else if (input.subscription !== null) {
    const { activatedAt, authorizedAt, monthlyAmount } = input.subscription;
    if (activatedAt !== null) {
      rows.push(row(instant(activatedAt), "Plus subscription", monthlyAmount, "Paid", false));
    }
    rows.push(row(instant(authorizedAt), "Enrollment authorization", "$0.00", "Authorized", false));
  }

  return newestFirst(rows);
}
