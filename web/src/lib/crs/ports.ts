// web/src/lib/crs/ports.ts — the three ports every persistence and every time read in this phase
// goes through, each with an in-memory implementation.
//
// Why ports at all: Phase 1 has not merged into this branch, so its Supabase client modules, its
// generated database types and its session module do not exist here and an import of any of them
// would not typecheck. (Their paths are not written out anywhere in this directory on purpose —
// the CRS-02 grep gate asserts that no file under `lib/crs/` names one, and a comment naming one
// trips the gate exactly like an import would.) The constraint is useful rather than survivable —
// nothing in `lib/crs/` holds a database client, so there is no object in this directory that
// could write a bureau body anywhere even if a future caller handed it one.
//
// Phase 5 replaces the in-memory implementations with Supabase-backed ones immediately after
// `git rebase main`: one new file per port, each exporting a factory returning the same
// interface. Nothing above the port changes and no caller learns which implementation it holds.
//
// Nothing here reads env and nothing throws on import.

import { createHash } from 'node:crypto';

import type { CrsMemberRef } from './types.ts';

// ---------------------------------------------------------------------------------------------
// Monitoring events — CRS-02 mechanism (a), the absence of a sink
// ---------------------------------------------------------------------------------------------

/**
 * The complete set of fields a CRS monitoring event may be persisted with, mirroring Phase 1's
 * `monitoring_events(id, client_id, event_type, occurred_at, received_at)` table (BACKEND-SPEC
 * §2.2). `id` is the store's to mint, so the four below are everything a caller supplies.
 *
 * This type is closed on purpose and the closure is the control, not a style preference: a bureau
 * payload leaks into a database row through a field that will accept it, so the defence is to
 * leave no such field. Do NOT add a `payload`, `raw`, `body`, `data`, `meta`, `snapshot`,
 * `alertDetail` or an index signature — and note that an OPTIONAL fifth field defeats mechanism
 * (a) exactly as completely as a required one, because the leak is a caller populating it, not a
 * caller being forced to. Widening this type is an interface ask, never a local edit.
 *
 * `eventType` is normally one of the published CRS types (`CRS_WEBHOOK_EVENT_TYPES` in
 * `constants.ts`) and `clientId` is ours; neither carries provider content. `occurredAt` is the
 * provider's instant and `receivedAt` is ours, both ISO 8601 strings — the webhook rail delivers
 * `time` as epoch seconds, and converting it is the receiver's job in plan 04-05, not this type's.
 */
export interface MonitoringEventRecord {
  clientId: string;
  eventType: string;
  /** ISO 8601 timestamp — when CRS says the event happened. */
  occurredAt: string;
  /** ISO 8601 timestamp — when we took delivery of it. */
  receivedAt: string;
}

/** The only provider pointer shape allowed across the persistence boundary. */
export interface ProtectedCrsAlertPointer {
  alertLookupKey: string;
  alertIdCiphertext: string;
  alertIdIv: string;
  alertIdTag: string;
  keyVersion: number;
  alertReportedAt: string;
  receivedAt: string;
  expiresAt: string;
}

export interface StoredCrsAlertPointer extends ProtectedCrsAlertPointer {
  clientId: string;
  monitoringEventId: string;
  providerHookKey: string;
  occurredAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  expiredAt: string | null;
}

declare const monitoringProviderEventKeyBrand: unique symbol;

/** Transient provider identity. It may be hashed into our UUID and may not be stored or returned. */
export type MonitoringProviderEventKey = string & {
  readonly [monitoringProviderEventKeyBrand]: true;
};

const MONITORING_EVENT_NAMESPACE = 'mostfundable.monitoring-event.v1';
const MISSING_PROVIDER_EVENT_KEY = 'missing-provider-event-key';

export function createMonitoringProviderEventKey(
  value: string | null,
): MonitoringProviderEventKey {
  return (value ?? MISSING_PROVIDER_EVENT_KEY) as MonitoringProviderEventKey;
}

/** One-way, deterministic RFC-4122 variant UUID with the custom version-eight marker. */
export function monitoringEventIdForProviderKey(key: MonitoringProviderEventKey): string {
  const digest = createHash('sha256')
    .update(MONITORING_EVENT_NAMESPACE, 'utf8')
    .update('\0', 'utf8')
    .update(key, 'utf8')
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export interface MonitoringEventWriteResult {
  id: string;
}

/**
 * The only write path in `lib/crs/`. One method, one parameter type, and that parameter type has
 * no field a report body could occupy — which is what makes "no bureau data is stored" a property
 * of the type system here rather than a promise in a comment.
 *
 * There is deliberately no read method on this interface. Production code holding the port can
 * append an event and can do nothing else with the events it appended; see
 * `InMemoryMonitoringEventStore.readAll`, which exists for tests and is not reachable through
 * this type.
 */
export interface MonitoringEventStore {
  record(
    event: MonitoringEventRecord,
    providerKey: MonitoringProviderEventKey,
    alertPointer?: ProtectedCrsAlertPointer,
  ): Promise<MonitoringEventWriteResult>;
}

/**
 * The in-memory store, plus the read accessor tests need.
 *
 * `readAll` is declared here and NOT on `MonitoringEventStore`, so a caller typed against the port
 * cannot reach it. A Phase 5 implementer widening the port to add a read method would undo that,
 * which is the residual risk recorded as T-04-09 and is an interface ask if it ever comes up.
 */
export interface InMemoryMonitoringEventStore extends MonitoringEventStore {
  readAll(): MonitoringEventRecord[];
  readAlertPointers(): StoredCrsAlertPointer[];
}

/**
 * An in-memory `MonitoringEventStore`. Phase 5 swaps in the Supabase-backed one.
 *
 * The stored record is rebuilt from the four named fields rather than spread from the argument.
 * Spreading would faithfully retain whatever an over-wide object carried — and `record` is
 * reachable from a webhook receiver, so "over-wide object" means "provider content that got this
 * far". Naming the fields truncates it at the boundary instead, so the store cannot retain a
 * field the type does not name even when a caller casts past the type.
 */
export function createInMemoryMonitoringEventStore(): InMemoryMonitoringEventStore {
  const recorded = new Map<string, MonitoringEventRecord>();
  const alertPointers = new Map<string, StoredCrsAlertPointer>();

  return {
    record(
      event: MonitoringEventRecord,
      providerKey: MonitoringProviderEventKey,
      alertPointer?: ProtectedCrsAlertPointer,
    ): Promise<MonitoringEventWriteResult> {
      const id = monitoringEventIdForProviderKey(providerKey);
      const next = {
        clientId: event.clientId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        receivedAt: event.receivedAt,
      };
      const existing = recorded.get(id);
      if (existing !== undefined) {
        if (
          existing.clientId !== next.clientId ||
          existing.eventType !== next.eventType ||
          existing.occurredAt !== next.occurredAt
        ) {
          return Promise.reject(new Error('MONITORING_EVENT_MISMATCH'));
        }
      } else {
        recorded.set(id, next);
      }

      if (alertPointer !== undefined) {
        const pointer = {
          clientId: event.clientId,
          monitoringEventId: id,
          providerHookKey: providerKey,
          alertLookupKey: alertPointer.alertLookupKey,
          alertIdCiphertext: alertPointer.alertIdCiphertext,
          alertIdIv: alertPointer.alertIdIv,
          alertIdTag: alertPointer.alertIdTag,
          keyVersion: alertPointer.keyVersion,
          occurredAt: event.occurredAt,
          alertReportedAt: alertPointer.alertReportedAt,
          receivedAt: alertPointer.receivedAt,
          expiresAt: alertPointer.expiresAt,
          deliveredAt: null,
          readAt: null,
          expiredAt: null,
        } satisfies StoredCrsAlertPointer;
        const existingPointer = alertPointers.get(providerKey);
        if (existingPointer !== undefined) {
          if (
            existingPointer.clientId !== pointer.clientId ||
            existingPointer.monitoringEventId !== pointer.monitoringEventId ||
            existingPointer.alertLookupKey !== pointer.alertLookupKey ||
            existingPointer.occurredAt !== pointer.occurredAt ||
            existingPointer.alertReportedAt !== pointer.alertReportedAt
          ) {
            return Promise.reject(new Error('CRS_ALERT_POINTER_MISMATCH'));
          }
        } else {
          const alertCollision = [...alertPointers.values()].find(
            (candidate) => candidate.alertLookupKey === pointer.alertLookupKey,
          );
          if (alertCollision !== undefined && alertCollision.clientId !== pointer.clientId) {
            return Promise.reject(new Error('CRS_ALERT_POINTER_MISMATCH'));
          }
          alertPointers.set(providerKey, pointer);
        }
      }

      return Promise.resolve({ id });
    },

    readAll(): MonitoringEventRecord[] {
      // A copy of the list, so a test holding the result cannot append to the store through it.
      return [...recorded.values()];
    },

    readAlertPointers(): StoredCrsAlertPointer[] {
      return [...alertPointers.values()].map((pointer) => ({ ...pointer }));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Member refs — the routing key between our client ids and CRS's opaque handles
// ---------------------------------------------------------------------------------------------

/** One client-to-member binding. Phase 1 persists this on `enrollments.crs_member_ref` (§2.1). */
export interface MemberRefLink {
  readonly clientId: string;
  readonly memberRef: CrsMemberRef;
}

/**
 * Resolves between a client id and a CRS member handle in both directions — the token endpoint
 * needs the forward direction and the webhook receiver needs the reverse.
 *
 * `null` means "this client is not enrolled yet", which is an ordinary state and not a failure:
 * the token endpoint answers 404 and logs nothing with context (pre-flight nullable-key check).
 * That distinction matters because the natural way to log "resolution failed" is to log the
 * context object, and the context object is where a report ends up sitting.
 *
 * Nothing in `lib/crs/` may resolve a `CrsMemberRef` from user input — the ref is a global handle
 * with no org scoping, so accepting one from a request is a cross-tenant read. Resolution always
 * starts from the caller's own client id.
 */
export interface MemberRefResolver {
  resolveForClient(clientId: string): Promise<CrsMemberRef | null>;
  resolveClientForMember(memberRef: CrsMemberRef): Promise<string | null>;
}

export class MonitoringInactiveError extends Error {
  constructor() {
    super('MONITORING_INACTIVE');
    this.name = 'MonitoringInactiveError';
  }
}

/** The in-memory resolver, plus the binding helper tests and fixtures need. */
export interface InMemoryMemberRefResolver extends MemberRefResolver {
  link(clientId: string, memberRef: CrsMemberRef): void;
}

/**
 * An in-memory `MemberRefResolver`, optionally pre-seeded. Phase 5 swaps in the Supabase-backed
 * one, reading `enrollments.crs_member_ref`.
 *
 * Re-linking a client drops the stale reverse entry rather than leaving it behind, so a retired
 * member ref stops resolving to a client instead of quietly continuing to — a webhook arriving on
 * the old ref must not be attributed to the client that has since moved.
 */
export function createInMemoryMemberRefResolver(
  seed: readonly MemberRefLink[] = [],
): InMemoryMemberRefResolver {
  const memberRefByClientId = new Map<string, CrsMemberRef>();
  const clientIdByMemberRef = new Map<string, string>();

  function link(clientId: string, memberRef: CrsMemberRef): void {
    const previousRef = memberRefByClientId.get(clientId);
    if (previousRef !== undefined) {
      clientIdByMemberRef.delete(previousRef);
    }
    memberRefByClientId.set(clientId, memberRef);
    clientIdByMemberRef.set(memberRef, clientId);
  }

  for (const entry of seed) {
    link(entry.clientId, entry.memberRef);
  }

  return {
    link,

    resolveForClient(clientId: string): Promise<CrsMemberRef | null> {
      return Promise.resolve(memberRefByClientId.get(clientId) ?? null);
    },

    resolveClientForMember(memberRef: CrsMemberRef): Promise<string | null> {
      return Promise.resolve(clientIdByMemberRef.get(memberRef) ?? null);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------

/**
 * Every timestamp, every TTL and every persona fixture in this phase reads time from here.
 *
 * `systemClock` below is the single wall-clock read in `lib/crs/`; everything else takes a `Clock`
 * as an argument. Two things fall out of that. The CRS-03 expiry test can stand at
 * `expiresAt - 1 ms` and then at `expiresAt` with no sleep, so the suite stays under two seconds
 * and cannot go flaky on a slow machine. And the CRS-04 personas come out byte-identical run to
 * run, which is what lets the S1.7 seed pin a `personaHint` per demo client and get the same plan
 * back every time.
 */
export interface Clock {
  now(): Date;
}

/** The one wall-clock read in `lib/crs/`. Everything else receives an injected `Clock`. */
export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
};

/** A `Clock` pinned to one instant until something moves it. */
export interface FixedClock extends Clock {
  /** Move the clock forward (or, with a negative argument, back) by exactly this many ms. */
  advance(milliseconds: number): void;
}

/**
 * A clock frozen at `iso` — the fixture clock for every test and mock persona in this phase.
 *
 * Rejects an unparseable timestamp instead of pinning to `NaN`, because an invalid clock does not
 * fail where it was built; it produces `Invalid Date` in whatever the caller writes hours later.
 * Each `now()` returns a fresh `Date`, so a caller mutating the value it received cannot move the
 * clock underneath everyone else holding it.
 */
export function createFixedClock(iso: string): FixedClock {
  const pinnedAtMs = Date.parse(iso);
  if (Number.isNaN(pinnedAtMs)) {
    throw new RangeError(
      `createFixedClock needs a parseable ISO 8601 timestamp; received ${JSON.stringify(iso)}.`,
    );
  }

  let currentMs = pinnedAtMs;

  return {
    now(): Date {
      return new Date(currentMs);
    },

    advance(milliseconds: number): void {
      if (!Number.isFinite(milliseconds)) {
        throw new RangeError('createFixedClock().advance needs a finite number of milliseconds.');
      }
      currentMs += milliseconds;
    },
  };
}
