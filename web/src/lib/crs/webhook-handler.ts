// web/src/lib/crs/webhook-handler.ts — the whole `POST /api/webhooks/crs` behaviour, as one plain
// function over injected ports.
//
// Plan 04-03 answers "is this request authentic and what events does it carry". This module answers
// "what gets written, what do we say back, and what still has to happen afterwards". The route file
// is plan 04-08's and is a wrapper around one call to `handleCrsWebhook`.
//
// Two provider facts shape everything below, both present in the client spec updated 2026-08-27:
//
//   - The reply CRS reads is a JSON ARRAY, one entry per event, `[{hook_id, status}]`, and
//     "responses with a status other than true will cause the webhook to be resent". Retry is
//     driven by our response BODY, not by the HTTP status code, so a bare 200 with an empty body
//     asks CRS to resend the whole batch, forever. The reply is a control surface.
//   - No ACK deadline, no timeout, no retry interval and NO ATTEMPT CAP is published anywhere.
//     That absence is why a permanently malformed event is acknowledged `true` rather than `false`
//     below: answering `false` to something that will be malformed on every resend starts a loop
//     with no documented end.
//
// Two things this module deliberately does NOT do.
//
// It makes no outbound call of any kind. It awaits the injected ports and nothing else, so the
// reply cannot be held up by a network hop the self-imposed five-second ACK budget did not plan
// for. The suite proves this by stubbing the global fetch with something that fails the test.
//
// It does not schedule the fan-out. It RETURNS the list and the route decides. Next's `after()`
// runs the work it was handed "even if the response didn't complete successfully, including when
// an error is thrown" (`next/dist/docs/01-app/03-api-reference/04-functions/after.md`), so a
// handler that scheduled fan-out inline would fan out on the 401 path too — a forged request
// triggering plan refreshes is the exact shape of threat T-04-31.
//
// The module logs nothing. Not the event type, not the member ref, not the hook id, not a count.
// Every value in scope on a failure path is either a consumer identifier or a provider handle.

import { CRS_WEBHOOK_EVENT_TYPES } from './constants.ts';
import { MonitoringInactiveError } from './ports.ts';
import { parseWebhookBatchEntries } from './webhook.ts';

import type { CrsAlertPointerCodec } from './alert-pointer.ts';
import type { Clock, MemberRefResolver, MonitoringEventStore } from './ports.ts';
import type { CrsWebhookEvent, CrsWebhookParse } from './types.ts';
import type { CrsWebhookBatchEntry, CrsWebhookRequest } from './webhook.ts';

// ---------------------------------------------------------------------------------------------
// Which event types are worth a plan refresh
// ---------------------------------------------------------------------------------------------

/** The published types, as a union, so the subset below cannot name an invented event. */
type CrsPublishedEventType = (typeof CRS_WEBHOOK_EVENT_TYPES)[number];

/**
 * The subset of the published CRS event types that should trigger a plan refresh.
 *
 * LANE C'S JUDGMENT, not a provider fact. No CRS page settles which of the twelve are
 * analysis-relevant — the docs describe what each type means and say nothing about what a
 * subscriber should do with it — so this list is taken under the error-taxonomy discretion in
 * `04-CONTEXT.md` and is recorded in `.planning/lanes/C.md` as such by plan 04-08. The reasoning,
 * so a later reader can disagree with it on the merits:
 *
 *   - `ACCALERT` — a bureau alert fired, which is the whole reason the monitoring rail exists.
 *     Note it is defined as "both daily and real-time", so nothing may assume one per night.
 *   - `SCOREREF` and `REPORTREF` — the score, or the bureau file behind it, was refreshed, so the
 *     derived features a plan was computed from are now stale by definition.
 *   - `ACCNEW` and `ACCCLOSED` — the set of accounts changed, which moves utilization, average
 *     age and open-account count, all three of which are plan inputs.
 *
 * Everything else is deliberately out: `IDFAIL`, `ACCREG`, `ACCREGFAIL`, `ACCLOCKED` and
 * `ACCLOGINFAIL` are enrollment and session events that lane B acts on, `ERROR` carries provider
 * trouble rather than consumer trouble, and `TEST` is a delivery probe. Refreshing a plan on any
 * of them would spend a bureau pull to compute the same plan again.
 *
 * PHASE 5 OWNS THE ENQUEUE. This module returns a list; it does not name a job, build a key or
 * touch a queue. The job is `analysis.run` with subject `client:<uuid>` and window
 * `run:<analysis_run_id>`, keyed `(job, subject, window)` per INTERFACES §7, and the enqueue is
 * upsert-on-conflict-do-nothing so a duplicated trigger collapses to one run.
 */
export const CRS_ANALYSIS_RELEVANT_EVENT_TYPES = [
  'ACCALERT',
  'SCOREREF',
  'REPORTREF',
  'ACCNEW',
  'ACCCLOSED',
] as const satisfies readonly CrsPublishedEventType[];

/**
 * Whether a stored event should be handed back for a plan refresh.
 *
 * Takes a `string` rather than the published union on purpose: plan 04-03 accepts an unpublished
 * unpublished type rather than putting it in a resend loop, so an event type outside the catalog
 * genuinely can reach here. It is stored and it is not fanned out, which is the correct
 * pair — we keep the row and we do not spend an analysis run on a type nobody has defined.
 */
function isAnalysisRelevant(eventType: string): boolean {
  const relevant: readonly string[] = CRS_ANALYSIS_RELEVANT_EVENT_TYPES;
  return relevant.includes(eventType);
}

// ---------------------------------------------------------------------------------------------
// The wire shapes
// ---------------------------------------------------------------------------------------------

/**
 * One element of the reply array CRS reads.
 *
 * `hook_id` and `status` are SNAKE_CASE DELIBERATELY. This is the vendor's wire shape, not our
 * internal convention, and a well-meaning rename to `hookId` would produce a reply CRS cannot
 * match to anything — every event would come back as unacknowledged and resend forever, with the
 * endpoint returning a cheerful 200 the whole time. The one place in this codebase where our own
 * naming convention loses.
 *
 * `hook_id` is nullable because the vendor `id` is nullable in practice: an element that arrived
 * with no usable `id` still earns an entry, so the array stays one-to-one with the batch and CRS
 * cannot read a short array as "some events were dropped".
 */
export interface WebhookAckEntry {
  hook_id: string | null;
  status: boolean;
}

/**
 * One unit of post-response work, handed back to the caller rather than started here.
 *
 * Carries the frozen three-field envelope and the client it resolved to — everything Phase 5's
 * enqueue needs and nothing else. There is no field here a bureau body could occupy, for the same
 * reason `MonitoringEventRecord` has none: a queue message is persistent storage wearing a
 * different hat.
 */
export interface WebhookFanOutItem {
  event: CrsWebhookEvent;
  clientId: string;
  monitoringEventId: string;
}

/**
 * Everything the handler needs.
 *
 * Extends `CrsWebhookRequest` rather than restating its four fields, so the request half of this
 * signature cannot drift from the one plan 04-03's verifier reads — the headers, the exact body
 * string `await request.text()` returned, the optional connecting address and the resolved config.
 */
export interface CrsWebhookHandlerInput extends CrsWebhookRequest {
  store: MonitoringEventStore;
  resolver: MemberRefResolver;
  clock: Clock;
  pointerCodec: CrsAlertPointerCodec | null;
}

/** What the route turns into a `Response`, plus the work it must schedule after sending one. */
export interface CrsWebhookHandlerResult {
  status: number;
  body: WebhookAckEntry[];
  fanOut: WebhookFanOutItem[];
}

// ---------------------------------------------------------------------------------------------
// Batch-level rejection
// ---------------------------------------------------------------------------------------------

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

/** The rejection half of the frozen parse union, derived rather than restated. */
type CrsWebhookRejectionReason = Extract<CrsWebhookParse, { ok: false }>['reason'];

/**
 * Keyed by the frozen reason union, so a fifth reason added to `CrsWebhookParse` without a status
 * decided for it is a type error here rather than an `undefined` reaching a response.
 */
const STATUS_BY_BATCH_REJECTION: Readonly<Record<CrsWebhookRejectionReason, number>> = {
  bad_auth: HTTP_UNAUTHORIZED,
  bad_signature: HTTP_UNAUTHORIZED,
  source_ip: HTTP_FORBIDDEN,
  bad_shape: HTTP_BAD_REQUEST,
};

/**
 * The reason the WHOLE request is refused, or `null` when the batch is one to process per event.
 *
 * Plan 04-03 collapses a batch-level rejection to a single entry rather than an empty array, which
 * makes three of the four reasons unambiguous — `bad_auth`, `bad_signature` and `source_ip` are
 * all decided before the body is looked at, so any of them refuses everything.
 *
 * `bad_shape` is the ambiguous one, because it is the only reason a single ELEMENT can also earn,
 * and a one-element batch is ordinary rather than exotic (`ACCALERT` is real-time-capable). The
 * hook id is what separates them: an element carrying an `id` proves the body parsed as an array
 * and that exactly one element inside it was malformed, so that is a per-event failure and gets
 * the `status: true` treatment below. A single `bad_shape` with NO hook id is read as batch-level,
 * which is the safe reading in both directions — if the body really was unparseable, 400 with an
 * empty array is the honest answer, and if it was a lone malformed element with no `id`, there was
 * never an id to acknowledge it against and CRS would resend it whatever we replied.
 */
function readBatchRejection(entries: CrsWebhookBatchEntry[]): CrsWebhookRejectionReason | null {
  if (entries.length !== 1) return null;

  const entry = entries[0];
  if (entry.parse.ok) return null;
  if (entry.parse.reason !== 'bad_shape') return entry.parse.reason;

  return entry.hookId === null ? 'bad_shape' : null;
}

// ---------------------------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------------------------

/**
 * Persist one event and hand back the client it was stored against, or `null` when it was not
 * stored at all.
 *
 * `null` covers both failure shapes on purpose, because both earn the same answer and both are
 * transient. An unresolved member is most likely the webhook overtaking the enrollment row, and a
 * rejecting store is a database having a bad minute; a resend genuinely fixes either one, which is
 * exactly when `status: false` is the right thing to say.
 *
 * The caught value is discarded without being bound. There is nothing in a store rejection worth a
 * log line and a great deal worth leaking — the natural thing to log at this call site is the
 * argument, and the argument names a consumer. The catch is inside this function and therefore
 * inside the per-event loop, so one failure costs one entry rather than the batch (T-04-32).
 *
 * The store call below is the ONLY write in this module. Its argument is a four-key object literal
 * built one field at a time and is never derived from the parsed element — no spread, no copy, no
 * pass-through. That is what keeps `error_code`, `error_msg`, `alert_id`, `alert_date`,
 * `alert_source` and `host_id` out of a monitoring row (T-04-28); plan 04-03 already discarded
 * them at the parse, and this is the second place a future edit could put them back.
 */
async function persistEvent(
  input: CrsWebhookHandlerInput,
  event: CrsWebhookEvent,
  providerEventKey: string | null,
  alertPointer?: { alertId: string; alertReportedAt: string },
): Promise<{ clientId: string; monitoringEventId: string } | { inactive: true } | null> {
  if (event.memberRef === null) return { inactive: true };
  if (providerEventKey === null || input.pointerCodec === null) return null;
  try {
    const clientId = await input.resolver.resolveClientForMember(event.memberRef);
    if (clientId === null) return null;

    const receivedAt = input.clock.now().toISOString();
    const protectedAlertPointer = alertPointer === undefined
      ? undefined
      : input.pointerCodec.protectAlertId({
          alertId: alertPointer.alertId,
          alertReportedAt: alertPointer.alertReportedAt,
          receivedAt,
        });

    const stored = await input.store.record(
      {
        clientId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        receivedAt,
      },
      input.pointerCodec.protectHookId(providerEventKey),
      protectedAlertPointer,
    );

    return { clientId, monitoringEventId: stored.id };
  } catch (error) {
    if (error instanceof MonitoringInactiveError) return { inactive: true };
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------------------------

/**
 * Verify, persist, acknowledge, and hand the fan-out back.
 *
 * The order of the answers:
 *
 * - **A batch-level rejection** returns its mapped status with an EMPTY body array and an empty
 *   fan-out list. Nothing is written on any of those paths and nothing is logged — the reply says
 *   only "no". An ack entry on a refused request would be us naming an event we never accepted.
 * - **Otherwise 200**, always, with one ack entry per element in the order CRS sent them. The
 *   status code is not where the outcome lives; a mixed batch is a 200 whose body carries a
 *   `false`, because that is the only thing CRS reads.
 *
 * Per element, in the order they are decided:
 *
 * 1. A **per-event `bad_shape`** is acknowledged `true` and stored nowhere. It is counted in the
 *    reply and in nothing else. THIS BRANCH IS DELIBERATE AND IS NOT A BUG: answering `false`
 *    would ask CRS to resend an event that is permanently malformed, and since no attempt cap is
 *    published, the resulting loop has no documented end. The tradeoff — we lose an event we could
 *    never have parsed, in exchange for not generating unbounded traffic against our own endpoint
 *    — is genuinely arguable, so plan 04-08 records it in `.planning/lanes/C.md` as an open
 *    question for the Kale call rather than leaving it buried here.
 * 2. An event we could not attribute or could not store is acknowledged `false`, alone. Both
 *    causes are transient and a resend is the cure for both.
 * 3. A stored event is acknowledged `true`, and joins the fan-out list only if its type is
 *    analysis-relevant. The fan-out append sits AFTER the persistence check, not beside it: an
 *    event that failed to store must not trigger a plan refresh, because the refresh would run
 *    against a monitoring history missing the very event that triggered it.
 *
 * Nothing here schedules anything. See the file header for why that is load-bearing rather than
 * stylistic.
 */
export async function handleCrsWebhook(
  input: CrsWebhookHandlerInput,
): Promise<CrsWebhookHandlerResult> {
  // `input` is structurally a `CrsWebhookRequest`; the three ports ride along and are ignored here.
  const entries = parseWebhookBatchEntries(input);

  const batchRejection = readBatchRejection(entries);
  if (batchRejection !== null) {
    return { status: STATUS_BY_BATCH_REJECTION[batchRejection], body: [], fanOut: [] };
  }

  const body: WebhookAckEntry[] = [];
  const fanOut: WebhookFanOutItem[] = [];

  for (const entry of entries) {
    if (!entry.parse.ok) {
      // See note 1 above. Acknowledged so CRS stops sending it; stored nowhere, because there is
      // no event here to store.
      body.push({ hook_id: entry.hookId, status: true });
      continue;
    }

    const event = entry.parse.event;
    const stored = await persistEvent(input, event, entry.hookId, entry.alertPointer);

    if (stored === null) {
      body.push({ hook_id: entry.hookId, status: false });
      continue;
    }

    if ('inactive' in stored) {
      body.push({ hook_id: entry.hookId, status: true });
      continue;
    }

    body.push({ hook_id: entry.hookId, status: true });

    if (isAnalysisRelevant(event.eventType)) {
      fanOut.push({
        event,
        clientId: stored.clientId,
        monitoringEventId: stored.monitoringEventId,
      });
    }
  }

  return { status: HTTP_OK, body, fanOut };
}
