import { DRIVERS } from '../../env.ts';
import { CRS_REPORT_CODE_BY_BUREAU } from '../constants.ts';
import { openCrsIdvContinuation, sealCrsIdvContinuation } from '../continuation.ts';
import { resolveCrsDriver } from '../driver.ts';
import { CrsConfigError, CrsDriverError } from '../errors.ts';
import { buildCrsRequestUrl, stripCrsScoreProjectionFields } from '../policy.ts';
import { sealReport } from '../report.ts';
import { normalizeObservedCreditScores } from '../scores.ts';
import {
  CRS_SPEC_DIT_FAILURE_STATUSES,
  CRS_SPEC_DIT_PASS_STATUS,
  CRS_SPEC_ERROR_CODES,
  CRS_SPEC_HOSTS,
  CRS_SPEC_PATHS,
  CRS_SPEC_SMFA_FAILURE_STATUSES,
  CRS_SPEC_SMFA_PASS_STATUSES,
  CRS_SPEC_SMFA_PENDING_STATUS,
  CRS_SPEC_TOKEN_TTLS_SECONDS,
} from '../spec-catalog.ts';
import { buildPreauthToken } from '../token.ts';
import { verifyAndParseWebhookImpl } from '../webhook.ts';

import type { Clock } from '../ports.ts';
import type {
  BureauCode, CreateMemberResult, CrsAdapter, CrsIdentity, CrsIdvContinuation, CrsMemberRef,
  CrsWebhookParse, IdvChallengeState, IdvResult, IdvSubmission, ObservedCreditScore, PreauthToken,
  ReportCode, SoftPullReport,
} from '../types.ts';
import type { CrsWebhookConfig } from '../webhook.ts';

const DEFAULT_TIMEOUT_MS = 10_000;
const DIRECT_REFRESH_WINDOW_MS = 30_000;

export interface SandboxConfig {
  baseUrl: string;
  apiKey: string;
  exposeVerificationUrl: boolean;
  secret: string;
  timeoutMs: number;
}

export interface SandboxAdapterDeps {
  clock: Clock;
  webhookConfig: CrsWebhookConfig;
  fetchImpl?: typeof fetch;
}

type AuthSession = { token: string; refresh: string; expiresAtMs: number; originalLoginAtMs: number };

function configured(value: string | undefined): string | null {
  return value === undefined || value.trim() === '' ? null : value;
}

export function readSandboxConfigFromEnv(env: NodeJS.ProcessEnv): SandboxConfig {
  const missing = ['CRS_BASE_URL', 'CRS_API_KEY', 'CRS_SECRET'].filter(
    (key) => configured(env[key]) === null,
  );
  if (missing.length > 0) {
    throw new CrsConfigError(`The sandbox CRS driver requires ${missing.join(', ')}.`, missing);
  }
  let parsedBase: URL;
  try {
    parsedBase = new URL(env.CRS_BASE_URL as string);
  } catch {
    throw new CrsConfigError('CRS_BASE_URL must be an absolute URL.', ['CRS_BASE_URL']);
  }
  if (parsedBase.protocol !== 'https:' && !(parsedBase.protocol === 'http:' && env.CRS_ALLOW_INSECURE_BASE_URL === 'true')) {
    throw new CrsConfigError(
      'CRS_BASE_URL must use HTTPS. CRS_ALLOW_INSECURE_BASE_URL may be true only for local work.',
      ['CRS_BASE_URL'],
    );
  }
  const timeoutValue = configured(env.CRS_HTTP_TIMEOUT_MS);
  const timeoutMs = timeoutValue === null ? DEFAULT_TIMEOUT_MS : Number(timeoutValue);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new CrsConfigError('CRS_HTTP_TIMEOUT_MS must be a positive integer.', ['CRS_HTTP_TIMEOUT_MS']);
  }
  const selectedDriver = resolveCrsDriver(env);
  return {
    baseUrl: parsedBase.toString().replace(/\/$/, ''),
    apiKey: env.CRS_API_KEY as string,
    // A development host alone is insufficient. The canonical registry must also resolve an
    // explicit non-fallback CRS driver; an absent selector stays mock and an unknown one throws.
    exposeVerificationUrl:
      selectedDriver !== DRIVERS.crs.fallback &&
      parsedBase.toString().replace(/\/$/, '') === CRS_SPEC_HOSTS.development.api,
    secret: env.CRS_SECRET as string,
    timeoutMs,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: unknown, keys: readonly string[]): string | null {
  if (!isObject(source)) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

function readPositiveInteger(source: unknown, keys: readonly string[]): number | null {
  if (!isObject(source)) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

/** CRS publishes SMFA `date-time` values without an offset; its token lifetime is UTC-based. */
function normalizeCrsDateTime(value: string): string | null {
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const instant = Date.parse(hasOffset ? value : `${value}Z`);
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}

function readErrorCodes(source: unknown): string[] {
  if (!isObject(source) || !Array.isArray(source.codes)) return [];
  return source.codes.filter((value): value is string => typeof value === 'string' && /^SC\d{3}$/.test(value));
}

function readSmsVerificationUrl(source: unknown): string | null {
  const message = readString(source, ['smsMessage']);
  const candidate = message?.match(/https:\/\/[^\s]+/)?.[0];
  if (candidate === undefined) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function path(template: string, key: string, value: string): string {
  return template.replace(`{${key}}`, encodeURIComponent(value));
}

function providerBureau(provider: unknown): BureauCode | null {
  if (provider === 'EFX' || provider === 'EQF') return 'EQF';
  if (provider === 'EXP') return 'EXP';
  if (provider === 'TU' || provider === 'TUC') return 'TUC';
  return null;
}

function dollarsToCents(value: unknown): number | null {
  if (!isObject(value) || typeof value.amount !== 'number' || !Number.isFinite(value.amount)) return null;
  return Math.max(0, Math.round(value.amount * 100));
}

function monthsBetween(earlier: unknown, laterMs: number): number | null {
  const earlierMs = typeof earlier === 'number' ? earlier : Date.parse(String(earlier));
  if (!Number.isFinite(earlierMs) || earlierMs > laterMs) return null;
  return Math.floor((laterMs - earlierMs) / (30.4375 * 24 * 60 * 60 * 1000));
}

function isoFromProviderDate(value: unknown): string | null {
  const instant = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}

function scoreModel(value: unknown): string {
  const provider = readString({ provider: value }, ['provider'])?.toUpperCase().replace(/[ -]+/g, '_');
  if (provider === 'VANTAGE' || provider === 'VANTAGE_SCORE_4' || provider === 'FICO' || provider === 'ERS') return provider;
  return 'UNKNOWN';
}

function accountIsLate(value: Record<string, unknown>, pulledAtMs: number): boolean {
  const status = readString(value, ['accountStatus']) ?? '';
  if (status !== 'PAYS_AS_AGREED' && /(?:PAST[ -]?DUE|LATE|DELINQUENT)/i.test(status)) return true;
  if ((dollarsToCents(value.pastDueAmount) ?? 0) > 0) return true;
  const comments = Array.isArray(value.comments) ? value.comments : [];
  return comments.some((comment) => {
    if (!isObject(comment)) return false;
    const description = readString(comment, ['description']);
    const match = description?.match(/LAST REPORTED DELINQUENCIES:\s*(\d{1,2})\/(\d{4})=R[2-9]/i);
    if (match === null || match === undefined) return false;
    const month = Number(match[1]);
    const year = Number(match[2]);
    if (month < 1 || month > 12) return false;
    const delinquencyMs = Date.UTC(year, month - 1, 1);
    const cutoffMs = Date.UTC(new Date(pulledAtMs).getUTCFullYear(), new Date(pulledAtMs).getUTCMonth() - 24, 1);
    return delinquencyMs >= cutoffMs && delinquencyMs <= pulledAtMs;
  });
}

function normalizeAccount(value: unknown, kind: string, pulledAtMs: number): Record<string, unknown> | null {
  if (!isObject(value)) return null;
  const accountRef = readString(value, ['id']);
  const balanceCents = dollarsToCents(value.balanceAmount);
  if (accountRef === null || balanceCents === null) return null;
  return {
    accountRef,
    kind,
    balanceCents,
    limitCents: dollarsToCents(value.creditLimitAmount),
    ageMonths: monthsBetween(value.dateOpened, pulledAtMs),
    label: (readString(value, ['accountName']) ?? '').trim().slice(0, 64) || null,
    pastDueCents: dollarsToCents(value.pastDueAmount) ?? 0,
    lateWithin24Months: accountIsLate(value, pulledAtMs),
    isOpen: value.accountOpen === true,
    isNegative: value.isNegative === true,
    openedAt: isoFromProviderDate(value.dateOpened),
  };
}

export function normalizeReportBody(body: unknown, reportCodes: readonly ReportCode[], pulledAt: string) {
  const root = Array.isArray(body) ? { providerViews: body } : isObject(body) ? body : {};
  const providerViews = Array.isArray(root.providerViews) ? root.providerViews : [];
  const requested = new Set(
    reportCodes.map((code) => Object.entries(CRS_REPORT_CODE_BY_BUREAU)
      .find(([, candidate]) => candidate === code)?.[0]),
  );
  const pulledAtMs = Date.parse(pulledAt);
  const perBureau = providerViews.flatMap((view): Array<Record<string, unknown>> => {
    if (!isObject(view)) return [];
    const bureau = providerBureau(view.provider);
    if (bureau === null || !requested.has(bureau)) return [];
    const summary = isObject(view.summary) ? view.summary : {};
    const groups: Array<[string, unknown]> = [
      ['revolving', view.revolvingAccounts], ['mortgage', view.mortgageAccounts],
      ['installment', view.installmentAccounts], ['other', view.otherAccounts],
    ];
    const accounts = groups.flatMap(([kind, group]) => Array.isArray(group)
      ? group.flatMap((account) => {
          const normalized = normalizeAccount(account, kind, pulledAtMs);
          return normalized === null ? [] : [normalized];
        })
      : []);
    const inquiries = Array.isArray(view.inquiries) ? view.inquiries.flatMap((inquiry) => {
      if (!isObject(inquiry)) return [];
      const inquiryRef = readString(inquiry, ['id']);
      const monthsAgo = monthsBetween(inquiry.reportedDate, pulledAtMs);
      const reportedAt = isoFromProviderDate(inquiry.reportedDate);
      if (inquiryRef === null || monthsAgo === null || reportedAt === null) return [];
      const inquiryMs = Date.parse(reportedAt);
      return [{
        inquiryRef,
        monthsAgo,
        reportedAt,
        matchedNewAccountWithin45Days: accounts.some((account) => {
          const openedAt = typeof account.openedAt === 'string' ? Date.parse(account.openedAt) : Number.NaN;
          return Number.isFinite(openedAt) && openedAt >= inquiryMs && openedAt <= inquiryMs + 45 * 24 * 60 * 60 * 1000;
        }),
      }];
    }) : [];
    // `openedAt` is transient matching input; the normalized report must not retain it.
    const normalizedAccounts = accounts.map(({ openedAt: _openedAt, ...account }) => account);
    const monthlyDebtPaymentsCents = ['revolvingAccounts', 'mortgageAccounts', 'installmentAccounts', 'otherAccounts']
      .reduce((total, key) => {
        const group = isObject(summary[key]) ? summary[key] : {};
        return total + (dollarsToCents(group.monthlyPaymentAmount) ?? 0);
      }, 0);
    const subject = isObject(summary.subject) ? summary.subject : {};
    const employmentHistory = Array.isArray(subject.employmentHistory) ? subject.employmentHistory : [];
    const previousAddresses = Array.isArray(subject.previousAddresses) ? subject.previousAddresses : [];
    const creditScore = isObject(summary.creditScore) ? summary.creditScore : {};
    const score = typeof creditScore.score === 'number' && Number.isInteger(creditScore.score) && creditScore.score >= 300 && creditScore.score <= 850
      ? { bureau, model: scoreModel(creditScore.provider), score: creditScore.score }
      : null;
    return [{
      bureau,
      reportCode: CRS_REPORT_CODE_BY_BUREAU[bureau],
      pulledAt,
      subjectRef: readString(summary, ['id']) ?? readString(root, ['id']) ?? `${bureau}-report`,
      accounts: normalizedAccounts,
      inquiries,
      scores: score === null ? [] : [score],
      identity: {
        namesOnFile: readString(subject, ['currentName']) === null ? null : 1,
        addressesOnFile: readString(subject, ['currentAddress']) === null ? null : 1 + previousAddresses.length,
        employersOnFile: employmentHistory.length,
      },
      summaryCounts: {
        totalCollections: typeof summary.totalCollections === 'number' && summary.totalCollections >= 0 ? summary.totalCollections : 0,
        totalPublicRecords: typeof summary.totalPublicRecords === 'number' && summary.totalPublicRecords >= 0 ? summary.totalPublicRecords : 0,
        totalNegativeAccounts: typeof summary.totalNegativeAccounts === 'number' && summary.totalNegativeAccounts >= 0 ? summary.totalNegativeAccounts : 0,
      },
      monthlyDebtPaymentsCents,
    }];
  });
  return { noHit: perBureau.length === 0, perBureau };
}

export function createSandboxAdapter(config: SandboxConfig, deps: SandboxAdapterDeps): CrsAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const closedAtByMember = new Map<string, string>();
  const inFlightByMember = new Map<string, Promise<SoftPullReport>>();
  let directSession: AuthSession | null = null;

  function urlFor(requestPath: string): string {
    return buildCrsRequestUrl(config.baseUrl, requestPath);
  }

  async function requestJson(operation: string, requestPath: string, method: 'GET' | 'POST', token: string | null, body?: unknown): Promise<unknown> {
    const headers = new Headers({ Accept: 'application/json' });
    if (token !== null) headers.set('Authorization', `Bearer ${token}`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const requestUrl = urlFor(requestPath);
    let response: Response;
    try {
      response = await fetchImpl(requestUrl, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch {
      throw CrsDriverError.fromTransport('sandbox', operation);
    }
    if (response.status === 204) return null;
    let decoded: unknown;
    try {
      decoded = stripCrsScoreProjectionFields(await response.json());
    } catch {
      throw new CrsDriverError('sandbox', operation, response.status);
    }
    if (!response.ok) throw new CrsDriverError('sandbox', operation, response.status, readErrorCodes(decoded));
    return decoded;
  }

  function sessionFrom(body: unknown, nowMs: number, originalLoginAtMs: number): AuthSession {
    const token = readString(body, ['token']);
    const refresh = readString(body, ['refresh']);
    const expires = readPositiveInteger(body, ['expires']);
    if (token === null || refresh === null || expires === null) throw new CrsDriverError('sandbox', 'login', 502);
    return { token, refresh, expiresAtMs: nowMs + expires * 1000, originalLoginAtMs };
  }

  async function directToken(): Promise<string> {
    const nowMs = deps.clock.now().getTime();
    if (directSession === null) {
      const loggedIn = await requestJson('login', CRS_SPEC_PATHS.directLogin, 'POST', null, {
        apikey: config.apiKey, secret: config.secret,
      });
      directSession = sessionFrom(loggedIn, nowMs, nowMs);
      return directSession.token;
    }
    if (nowMs < directSession.expiresAtMs - DIRECT_REFRESH_WINDOW_MS) return directSession.token;
    if (nowMs < directSession.originalLoginAtMs + CRS_SPEC_TOKEN_TTLS_SECONDS.directRefresh * 1000) {
      const refreshed = await requestJson(
        'refreshToken', `${CRS_SPEC_PATHS.directRefresh}?token=${encodeURIComponent(directSession.refresh)}`,
        'GET', directSession.token,
      );
      directSession = sessionFrom(refreshed, nowMs, directSession.originalLoginAtMs);
      return directSession.token;
    }
    directSession = null;
    return directToken();
  }

  async function userTokenFor(memberRef: CrsMemberRef): Promise<string> {
    const direct = await directToken();
    const preauth = await requestJson('getPreauthToken', path(CRS_SPEC_PATHS.directPreauthToken, 'id', memberRef), 'GET', direct);
    const preauthToken = readString(preauth, ['token', 'Token']);
    if (preauthToken === null) throw new CrsDriverError('sandbox', 'getPreauthToken', 502);
    const exchanged = await requestJson(
      'exchangePreauthToken', path(CRS_SPEC_PATHS.userPreauthExchange, 'preauthToken', preauthToken), 'GET', null,
    );
    const token = readString(exchanged, ['token']);
    if (token === null) throw new CrsDriverError('sandbox', 'exchangePreauthToken', 502);
    return token;
  }

  async function performSoftPull(memberRef: CrsMemberRef, reportCodes: ReportCode[]): Promise<SoftPullReport> {
    if (reportCodes.length === 0) throw new CrsDriverError('sandbox', 'softPull', 400);
    const userToken = await userTokenFor(memberRef);
    // This integration is provisioned for the Equifax 3B product. Despite the name, that product
    // is served by the Equifax endpoint and returns EFX, EXP and TU provider views in one US_3B
    // response. `/users/latest-report` belongs to CRS's separately provisioned multi-bureau
    // product; choosing it from the number of requested report codes produced SC402 for this host.
    const raw = await requestJson('softPull', CRS_SPEC_PATHS.latestEquifaxReport, 'GET', userToken);
    const pulledAt = deps.clock.now().toISOString();
    const body = normalizeReportBody(raw, reportCodes, pulledAt);
    return sealReport({
      bureaus: body.perBureau.map((record) => record.bureau as BureauCode),
      reportCodes: [...reportCodes], pulledAt, body,
    });
  }

  async function lifecycle(operation: string, endpoint: string): Promise<void> {
    await requestJson(operation, endpoint, 'POST', await directToken());
  }

  return {
    driver: 'sandbox',
    pullBilling: 'cached-read',

    async createMember(identity: CrsIdentity): Promise<CreateMemberResult> {
      const registered = await requestJson('registerUser', CRS_SPEC_PATHS.directUserRegistration, 'POST', await directToken(), {
        email: identity.email, mobile: identity.phone, fname: identity.firstName, lname: identity.lastName,
        smsMsg: false, emailMsg: false, pushMsg: false,
      });
      const memberId = readString(registered, ['userId', 'id']);
      const preauth = readString(registered, ['token', 'Token']);
      if (memberId === null || preauth === null) throw new CrsDriverError('sandbox', 'registerUser', 502);
      const memberRef = memberId as CrsMemberRef;
      try {
      const exchanged = await requestJson('exchangePreauthToken', path(CRS_SPEC_PATHS.userPreauthExchange, 'preauthToken', preauth), 'GET', null);
      const userToken = readString(exchanged, ['token']);
      if (userToken === null) throw new CrsDriverError('sandbox', 'exchangePreauthToken', 502);
      const dit = await requestJson('submitDit', CRS_SPEC_PATHS.ditIdentity, 'POST', userToken, {
        fname: identity.firstName, lname: identity.lastName, dob: identity.dateOfBirth,
        ssn: identity.ssn, mobile: identity.phone, street1: identity.address.line1,
        ...(identity.address.line2 ? { street2: identity.address.line2 } : {}),
        city: identity.address.city, state: identity.address.state, zip: identity.address.postalCode,
        email: identity.email,
      });
      // The published 200 schema does not require `details`, and both documented mocked EFX hosts
      // omit it while returning the DIT token that the operation defines as the SMFA handoff.
      // When decision metadata is present, still enforce it and fail closed on malformed content.
      const details = isObject(dit) ? dit.details : undefined;
      if (details !== undefined) {
        if (!isObject(details)) throw new CrsDriverError('sandbox', 'submitDit', 502);
        if (
          details.decision === false ||
          CRS_SPEC_DIT_FAILURE_STATUSES.some((status) => status === details.status)
        ) {
          throw new CrsDriverError('sandbox', 'submitDit', 400, [CRS_SPEC_ERROR_CODES.ditRejected]);
        }
        if (details.status !== CRS_SPEC_DIT_PASS_STATUS || details.decision !== true) {
          throw new CrsDriverError('sandbox', 'submitDit', 502);
        }
      }
      const ditToken = readString(dit, ['token']);
      if (ditToken === null) throw new CrsDriverError('sandbox', 'submitDit', 502);
      const sent = await requestJson(
        'sendSmfaLink', `${path(CRS_SPEC_PATHS.smfaSendLink, 'ditToken', ditToken)}?type=phone`, 'POST', userToken,
      );
      const smfaToken = readString(sent, ['token']);
      // Sandbox returns the link a user actually receives inside `smsMessage`; `linkUrl` is the
      // upstream Equifax session URL and may not be directly navigable. Production can omit the
      // message, so retain `linkUrl` as the documented fallback.
      const verificationUrl = readSmsVerificationUrl(sent) ?? readString(sent, ['linkUrl']);
      const expires = readString(sent, ['expires']);
      const expiresAt = expires === null ? null : normalizeCrsDateTime(expires);
      if (
        smfaToken === null || verificationUrl === null || expiresAt === null ||
        Date.parse(expiresAt) <= deps.clock.now().getTime()
      ) throw new CrsDriverError('sandbox', 'sendSmfaLink', 502);
      const continuationChallenge: IdvChallengeState = {
        kind: 'smfa_link', attemptsRemaining: 1, expiresAt, verificationUrl,
      };
      const challenge: IdvChallengeState =
        config.exposeVerificationUrl && config.baseUrl === CRS_SPEC_HOSTS.development.api
        ? continuationChallenge
        : { kind: 'smfa_link', attemptsRemaining: 1, expiresAt };
      const continuation = sealCrsIdvContinuation(
        { challenge: continuationChallenge, memberRef, smfaToken },
        config.secret,
      );
      return { memberRef, idpass: false, challenge, continuation };
      } catch (error) {
        try { await lifecycle('cleanupMember', path(CRS_SPEC_PATHS.closeAccount, 'id', memberRef)); } catch {}
        throw error;
      }
    },

    async submitIdvStep(
      memberRef: CrsMemberRef,
      submission: IdvSubmission,
      continuation?: CrsIdvContinuation,
    ): Promise<IdvResult> {
      if (continuation === undefined || submission.kind !== 'smfa_status') {
        throw new CrsDriverError('sandbox', 'submitIdvStep', 400);
      }
      const active = openCrsIdvContinuation({ continuation, memberRef, now: deps.clock.now(), secret: config.secret });
      try {
        const statusResult = await requestJson(
          'submitIdvStep', `${path(CRS_SPEC_PATHS.smfaVerifyStatus, 'smfaToken', active.smfaToken)}?type=phone`,
          'POST', await userTokenFor(memberRef),
        );
        const status = readString(statusResult, ['status']);
        if (status !== null && CRS_SPEC_SMFA_PASS_STATUSES.some((value) => value === status)) {
          return { outcome: 'pass', verifiedAt: deps.clock.now().toISOString() };
        }
        // Proven against efx-dev on 2026-09-05: once the consumer opens the SMFA link the
        // verify-status call answers 200 with the member record (`idpass: true`) and no colour
        // status. That is the pass signal for a completed link, so accept it explicitly.
        if (status === null && isObject(statusResult) && statusResult.idpass === true) {
          return { outcome: 'pass', verifiedAt: deps.clock.now().toISOString() };
        }
        if (status === CRS_SPEC_SMFA_PENDING_STATUS) return { outcome: 'retry', challenge: active.challenge };
        if (status !== null && CRS_SPEC_SMFA_FAILURE_STATUSES.some((value) => value === status)) {
          return { outcome: 'failed', code: status as 'ORANGE' | 'RED' };
        }
        throw new CrsDriverError('sandbox', 'submitIdvStep', 502);
      } catch (error) {
        if (error instanceof CrsDriverError && error.codes.includes(CRS_SPEC_ERROR_CODES.alreadyIdentified)) {
          return { outcome: 'pass', verifiedAt: deps.clock.now().toISOString() };
        }
        if (error instanceof CrsDriverError && error.codes.includes(CRS_SPEC_ERROR_CODES.smfaIncomplete)) {
          return { outcome: 'retry', challenge: active.challenge };
        }
        throw error;
      }
    },

    async getPreauthToken(memberRef: CrsMemberRef): Promise<PreauthToken> {
      const response = await requestJson(
        'getPreauthToken', path(CRS_SPEC_PATHS.directPreauthToken, 'id', memberRef), 'GET', await directToken(),
      );
      const token = readString(response, ['token', 'Token']);
      if (token === null) throw new CrsDriverError('sandbox', 'getPreauthToken', 502);
      return buildPreauthToken({ token, ttlSeconds: CRS_SPEC_TOKEN_TTLS_SECONDS.preauth }, deps.clock.now());
    },

    async getLatestScores(memberRef: CrsMemberRef): Promise<readonly ObservedCreditScore[]> {
      const raw = await requestJson(
        'getLatestScores', CRS_SPEC_PATHS.latestEquifaxScores, 'GET', await userTokenFor(memberRef),
      );
      return normalizeObservedCreditScores(raw);
    },

    async closeMember(memberRef: CrsMemberRef): Promise<{ closedAt: string }> {
      const existing = closedAtByMember.get(memberRef);
      if (existing !== undefined) return { closedAt: existing };
      try {
        await lifecycle('closeMember', path(CRS_SPEC_PATHS.closeAccount, 'id', memberRef));
      } catch (error) {
        if (!(error instanceof CrsDriverError) || !error.codes.some((code) =>
          code === CRS_SPEC_ERROR_CODES.alreadyClosed || code === CRS_SPEC_ERROR_CODES.unenrollmentQueued)) throw error;
      }
      const closedAt = deps.clock.now().toISOString();
      closedAtByMember.set(memberRef, closedAt);
      return { closedAt };
    },

    async pauseMember(memberRef: CrsMemberRef): Promise<{ pausedAt: string }> {
      await lifecycle('pauseMember', path(CRS_SPEC_PATHS.pauseEnrollment, 'userId', memberRef));
      return { pausedAt: deps.clock.now().toISOString() };
    },

    async resumeMember(memberRef: CrsMemberRef): Promise<{ resumedAt: string }> {
      await lifecycle('resumeMember', path(CRS_SPEC_PATHS.resumeEnrollment, 'userId', memberRef));
      return { resumedAt: deps.clock.now().toISOString() };
    },

    softPull(memberRef: CrsMemberRef, reportCodes: ReportCode[]): Promise<SoftPullReport> {
      const existing = inFlightByMember.get(memberRef);
      if (existing !== undefined) return existing;
      const operation = performSoftPull(memberRef, reportCodes);
      inFlightByMember.set(memberRef, operation);
      const clear = () => { if (inFlightByMember.get(memberRef) === operation) inFlightByMember.delete(memberRef); };
      void operation.then(clear, clear);
      return operation;
    },

    verifyAndParseWebhook(input: { headers: Headers; rawBody: string }): CrsWebhookParse {
      return verifyAndParseWebhookImpl({ headers: input.headers, rawBody: input.rawBody, config: deps.webhookConfig });
    },
  };
}
