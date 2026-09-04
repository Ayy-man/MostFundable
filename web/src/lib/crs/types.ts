// web/src/lib/crs/types.ts — FROZEN. Changes go through .planning/INTERFACES.md.

export type CrsDriver = 'mock' | 'sandbox';

/** Driver selection: env CRS_DRIVER; absent CRS creds (§10) ⇒ 'mock'. Never branch on
 *  the driver anywhere outside lib/crs — callers see one interface. */
// DEVIATION (interface ask-3, mechanical): the frozen block declares this body-less, which is
// error TS2391 in a .ts module. Re-exported from the identically-signed implementation instead;
// importers see no difference. `driver.ts` imports from here type-only, so there is no cycle.
export { resolveCrsDriver } from './driver.ts';

export type BureauCode = 'EQF' | 'EXP' | 'TUC';

/** UNVERIFIED (CRS public docs, not confirmed for this account) — BACKEND-SPEC §3. */
export type ReportCode = 'EQF1001' | 'EXP1001' | 'TUC3002';

/** Opaque handle to a CRS member. Store on enrollments.crs_member_ref (§2.1). */
export type CrsMemberRef = string & { readonly __brand: 'CrsMemberRef' };

/** Encrypted, short-lived CRS SMFA state. Safe to persist; only the server-side CRS secret opens it. */
export type CrsIdvContinuation = string & { readonly __brand: 'CrsIdvContinuation' };

/** Identity fields ONLY — no consent text, no payment data, no client_id. */
export interface CrsIdentity {
  firstName: string;
  lastName: string;
  /** ISO date, YYYY-MM-DD */
  dateOfBirth: string;
  ssn: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    /** 2-letter USPS code */
    state: string;
    postalCode: string;
  };
  email: string;
  /** E.164 — the SMS step delivers here. */
  phone: string;
}

export type IdvChallengeKind = 'sms' | 'quiz' | 'smfa_link';

export interface IdvChallengeState {
  kind: IdvChallengeKind;
  attemptsRemaining: number;
  /** ISO timestamp */
  expiresAt: string;
  /** quiz only; absent on the SMS step */
  questionCount?: number;
  /** CRS-hosted device verification URL. Present only for the SMFA flow. */
  verificationUrl?: string;
}

export interface CreateMemberResult {
  memberRef: CrsMemberRef;
  /** UNVERIFIED — returning members pass idpass=true to skip re-verification (§2.1).
   *  Persist to enrollments.idpass. */
  idpass: boolean;
  challenge: IdvChallengeState;
  /** Encrypted provider state required to finish SMFA across serverless requests. */
  continuation?: CrsIdvContinuation;
}

export type IdvSubmission =
  | { kind: 'sms'; code: string }
  | { kind: 'quiz'; answers: Array<{ questionId: string; answerId: string }> }
  | { kind: 'smfa_status' };

export type IdvResult =
  | { outcome: 'pass'; verifiedAt: string }
  | { outcome: 'retry'; challenge: IdvChallengeState }
  /** The provider completed SMFA but rejected the identity verification. */
  | { outcome: 'failed'; code: 'ORANGE' | 'RED' }
  /** Maps to enrollments.status='parked' + parked_until (72h, §2.1). NO charge. */
  | { outcome: 'locked'; lockedUntil: string };

export interface PreauthToken {
  token: string;
  /** ISO timestamp. UNVERIFIED: preauth TTL ~30s; the widget upgrades it to a
   *  user session token of ~15min, which our servers never see (§2.1). */
  expiresAt: string;
  ttlSeconds: number;
}

/**
 * One observed bureau score returned by CRS's current-score product.
 *
 * This value is display-only and must never be persisted. It deliberately omits
 * score factors, risk ranges and every score-projection field: the operator
 * tracker needs the current observed number and nothing else.
 */
export interface ObservedCreditScore {
  readonly bureau: BureauCode;
  readonly model: 'VANTAGE' | 'VANTAGE_SCORE_4' | 'FICO' | 'ERS' | 'UNKNOWN';
  readonly observedAt: string | null;
  readonly score: number;
}

/** Webhook envelope AFTER verify+parse. Everything else in the request body is
 *  discarded before this value exists — §2.2 stores event type + timestamps only.
 *  `memberRef` is a routing key (it resolves client_id), not report content. */
export interface CrsWebhookEvent {
  eventType: string;
  /** ISO timestamp from the provider */
  occurredAt: string;
  /** Null on host-level events, which carry an explicit null user_id. */
  memberRef: CrsMemberRef | null;
}

export type CrsWebhookParse =
  | { ok: true; event: CrsWebhookEvent }
  | { ok: false; reason: 'bad_auth' | 'bad_signature' | 'bad_shape' | 'source_ip' };

/**
 * A soft-pull bureau report. THIS VALUE IS MEMORY-ONLY.
 *
 * Do NOT: JSON.stringify it, console.log it, put it in an error message, return it
 * from a route handler, write it to Supabase, Storage, a temp file, a queue payload,
 * an LLM prompt, or an analytics event. DEV-ONBOARDING rule 2; CI greps for it.
 *
 * The ONLY legal exit is extractFeatures() in lib/analysis, which returns
 * DerivedFeatures (§3 of this file). The brand makes it impossible to fabricate one
 * outside lib/crs; the `toJSON: never` member makes any serialization attempt read as
 * an obvious defect in review. Neither is a runtime guarantee — the grep gate is.
 */
declare const softPullReportBrand: unique symbol;
export interface SoftPullReport {
  readonly [softPullReportBrand]: 'memory-only';
  readonly bureaus: BureauCode[];
  readonly reportCodes: ReportCode[];
  readonly pulledAt: string;
  /** Provider-shaped body. Never widen this to a named type — nothing should be
   *  tempted to model, log or store its fields. */
  readonly body: unknown;
  readonly toJSON: never;
}

/** Mock-only persona selection. The sandbox driver ignores personaHint entirely,
 *  which is what keeps mock→sandbox a driver change and not a rebuild. */
export type CrsPersona = 'clean' | 'derog' | 'thin_file' | 'no_hit';

export interface CreateMemberOptions {
  /** mock driver only; ignored by sandbox */
  personaHint?: CrsPersona;
}

/**
 * Compatibility bag retained for the analysis worker. CRS v3 report retrieval is a cached GET and
 * publishes no idempotency header, so both drivers ignore this value; the worker's durable
 * operation record still owns crash recovery.
 */
export interface SoftPullOptions {
  /** Stable for the lifetime of one analysis operation, across every retry of it. */
  idempotencyKey?: string;
}

export interface CrsAdapter {
  readonly driver: CrsDriver;
  /** Whether retrieving the latest report reuses the provider's cached read or bills per request. */
  readonly pullBilling: 'cached-read' | 'per-request';

  /** Identity fields only. Returns the member handle + the first IDV challenge. */
  createMember(
    identity: CrsIdentity,
    options?: CreateMemberOptions,
  ): Promise<CreateMemberResult>;

  /** One IDV step. Lane B's state machine owns the park/charge consequences. */
  submitIdvStep(
    memberRef: CrsMemberRef,
    submission: IdvSubmission,
    continuation?: CrsIdvContinuation,
  ): Promise<IdvResult>;

  /** Short-lived token handed to the browser; the widget renders bureau data
   *  directly from CRS. We never proxy the widget's traffic (§2.1). */
  getPreauthToken(memberRef: CrsMemberRef): Promise<PreauthToken>;

  /**
   * Current observed scores, held only for the lifetime of the request. Never
   * store or log the returned values.
   */
  getLatestScores(memberRef: CrsMemberRef): Promise<readonly ObservedCreditScore[]>;

  /** Cancel flow (§2.3). Idempotent — closing a closed member resolves. */
  closeMember(memberRef: CrsMemberRef): Promise<{ closedAt: string }>;

  /** Pause bureau enrollment without closing the CRS account. */
  pauseMember(memberRef: CrsMemberRef): Promise<{ pausedAt: string }>;

  /** Resume a previously paused bureau enrollment. */
  resumeMember(memberRef: CrsMemberRef): Promise<{ resumedAt: string }>;

  /** Memory-only. See the SoftPullReport doc comment before you touch the result. */
  softPull(
    memberRef: CrsMemberRef,
    reportCodes: ReportCode[],
    options?: SoftPullOptions,
  ): Promise<SoftPullReport>;

  /** UNVERIFIED: Basic auth per CRS docs, plus HMAC and/or source-IP allowlist if
   *  granted (§2.2). Production alerts arrive as a nightly batch (e.g. ACCALERT).
   *  Verify and parse in one call so no caller ever holds the raw body. */
  verifyAndParseWebhook(input: {
    headers: Headers;
    rawBody: string;
  }): CrsWebhookParse;
}

export { getCrsAdapter } from './adapter.ts';
