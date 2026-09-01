import "server-only";

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export const PAID_REFRESH_FIXTURE = {
  orgId: "f8000000-0000-4000-8000-000000000001",
  adminId: "f8100000-0000-4000-8000-000000000001",
  operatorId: "f8100000-0000-4000-8000-000000000002",
  cases: {
    success: {
      consumerId: "f8100000-0000-4000-8000-000000000011",
      clientId: "f8300000-0000-4000-8000-000000000011",
      enrollmentId: "f8400000-0000-4000-8000-000000000011",
      subscriptionId: "f8500000-0000-4000-8000-000000000011",
      idempotencyKey: "f8600000-0000-4000-8000-000000000011",
    },
    capDenied: {
      consumerId: "f8100000-0000-4000-8000-000000000012",
      clientId: "f8300000-0000-4000-8000-000000000012",
      enrollmentId: "f8400000-0000-4000-8000-000000000012",
      subscriptionId: "f8500000-0000-4000-8000-000000000012",
      idempotencyKey: "f8600000-0000-4000-8000-000000000012",
    },
    paymentFailed: {
      consumerId: "f8100000-0000-4000-8000-000000000013",
      clientId: "f8300000-0000-4000-8000-000000000013",
      enrollmentId: "f8400000-0000-4000-8000-000000000013",
      subscriptionId: "f8500000-0000-4000-8000-000000000013",
      idempotencyKey: "f8600000-0000-4000-8000-000000000013",
    },
    actionRequired: {
      consumerId: "f8100000-0000-4000-8000-000000000014",
      clientId: "f8300000-0000-4000-8000-000000000014",
      enrollmentId: "f8400000-0000-4000-8000-000000000014",
      subscriptionId: "f8500000-0000-4000-8000-000000000014",
      idempotencyKey: "f8600000-0000-4000-8000-000000000014",
    },
  },
  capSeedSourceId: "f8700000-0000-4000-8000-000000000012",
} as const;

export type PaidRefreshFixtureCase = keyof typeof PAID_REFRESH_FIXTURE.cases;

export interface PaidRefreshFixtureEvidence {
  requestCount: number;
  requestId: string | null;
  requestState: string | null;
  providerPaymentRef: string | null;
  paymentEventCount: number;
  succeededEventCount: number;
  latestPaymentOutcome: string | null;
  latestPaymentOccurredAt: string | null;
  analysisCount: number;
  analysisJobId: string | null;
  analysisRunId: string | null;
  analysisCreatedAt: string | null;
  backgroundCount: number;
  backgroundJobId: string | null;
  backgroundSubject: string | null;
  backgroundWindow: string | null;
  backgroundAuditCount: number;
  capAttemptCount: number;
  capAllowedCount: number;
  capDeniedCount: number;
}

function fixtureGuard(): void {
  if (process.env.PAID_REFRESH_E2E !== "1") {
    throw new Error("Paid-refresh fixture is disabled.");
  }
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!apiUrl) throw new Error("Paid-refresh fixture has no local database URL.");
  const host = new URL(apiUrl).hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("Paid-refresh fixture requires a loopback database URL.");
  }
}

function projectId(): string {
  const config = readFileSync(path.resolve(process.cwd(), "../supabase/config.toml"), "utf8");
  const id = config.match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
  if (!id) throw new Error("Paid-refresh fixture project ID is unavailable.");
  return id;
}

function database(sql: string): string {
  fixtureGuard();
  const result = spawnSync(
    "docker",
    [
      "exec", "-i", `supabase_db_${projectId()}`, "psql", "-X", "-U", "postgres",
      "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1",
    ],
    { encoding: "utf8", input: sql, maxBuffer: 2 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const detail = result.stderr.trim().split("\n").at(-1) ?? "unknown database error";
    throw new Error(`Paid-refresh fixture database operation failed: ${detail}`);
  }
  return result.stdout.trim();
}

function clientIds(): string {
  return Object.values(PAID_REFRESH_FIXTURE.cases).map((entry) => `'${entry.clientId}'`).join(",");
}

function consumerIds(): string {
  return Object.values(PAID_REFRESH_FIXTURE.cases).map((entry) => `'${entry.consumerId}'`).join(",");
}

function cleanupSql(): string {
  const fixture = PAID_REFRESH_FIXTURE;
  return `
delete from public.audit_log
where org_id = '${fixture.orgId}'
   or client_id in (${clientIds()})
   or actor_profile_id in (${consumerIds()}, '${fixture.adminId}', '${fixture.operatorId}')
   or subject_id in (
     select id from public.background_jobs
     where subject in (${Object.values(fixture.cases).map((entry) => `'client:${entry.clientId}'`).join(",")})
   );
delete from public.background_jobs
where subject in (${Object.values(fixture.cases).map((entry) => `'client:${entry.clientId}'`).join(",")});
delete from public.paid_refresh_payment_events where request_id in (
  select id from public.paid_refresh_requests where client_id in (${clientIds()})
);
delete from public.paid_refresh_requests where client_id in (${clientIds()});
delete from public.analysis_runs where client_id in (${clientIds()});
delete from public.analysis_jobs where client_id in (${clientIds()});
delete from public.pull_cap_attempts where client_id in (${clientIds()});
delete from public.pull_caps where client_id in (${clientIds()});
delete from public.consumer_subscriptions where client_id in (${clientIds()});
-- Consent evidence is append-only for every role (ALWAYS triggers); this local-only fixture
-- runs as the stack superuser and lifts the guard for its own rows inside this transaction only.
alter table public.consent_revocations disable trigger consent_revocations_append_only;
alter table public.consents disable trigger consents_append_only;
delete from public.consent_revocations where client_id in (${clientIds()});
delete from public.consents where client_id in (${clientIds()});
alter table public.consents enable always trigger consents_append_only;
alter table public.consent_revocations enable always trigger consent_revocations_append_only;
delete from public.enrollments where client_id in (${clientIds()});
delete from public.clients where id in (${clientIds()});
delete from public.profiles where id in (${consumerIds()}, '${fixture.adminId}', '${fixture.operatorId}');
delete from auth.users where id in (${consumerIds()}, '${fixture.adminId}', '${fixture.operatorId}');
delete from public.orgs where id = '${fixture.orgId}';`;
}

export function provisionPaidRefreshFixture(): void {
  const fixture = PAID_REFRESH_FIXTURE;
  const entries = Object.entries(fixture.cases);
  const userRows = [
    [fixture.adminId, "paid-refresh-admin@fixture.example"],
    [fixture.operatorId, "paid-refresh-operator@fixture.example"],
    ...entries.map(([name, entry]) => [entry.consumerId, `paid-refresh-${name}@fixture.example`]),
  ].map(([id, email]) => `('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}', '', now(), now(), now())`).join(",\n");
  const consumerProfiles = entries.map(([name, entry]) =>
    `('${entry.consumerId}', 'consumer', '${fixture.orgId}', null, '{}'::uuid[], 'Paid Refresh ${name}', 'paid-refresh-${name}@fixture.example')`,
  ).join(",\n");
  const clients = entries.map(([name, entry]) =>
    `('${entry.clientId}', '${fixture.orgId}', '${entry.consumerId}', 'Paid Refresh ${name}', 'optimization', '${fixture.operatorId}')`,
  ).join(",\n");
  const enrollments = entries.map(([name, entry]) =>
    `('${entry.enrollmentId}', '${entry.clientId}', 'mock_clean_phase18_${name}', 'active', now(), now(), 'phase18-${name}', true, 'clean')`,
  ).join(",\n");
  // Analysis authorization (migration 260) reads the consents table, not the
  // enrollment's consent timestamps, so the fixture grants both named consents.
  const consents = entries.flatMap(([name, entry]) =>
    ["monitoring", "analysis"].map((kind) =>
      `('${entry.clientId}', '${kind}', 'granted', 'phase18-${kind}-v1', now(), '127.0.0.1', 'phase18-${name}-${kind}')`,
    ),
  ).join(",\n");
  const sourceByCase: Record<PaidRefreshFixtureCase, string> = {
    success: "mock_payment_success_phase18",
    capDenied: "mock_payment_cap_phase18",
    paymentFailed: "mock_payment_failed_phase18",
    actionRequired: "mock_payment_requires_action_phase18",
  };
  const subscriptions = entries.map(([name, entry]) =>
    `('${entry.subscriptionId}', '${entry.clientId}', '${entry.enrollmentId}', 'mock', 'mock_customer_${name}', '${sourceByCase[name as PaidRefreshFixtureCase]}', 'mock_subscription_${name}', 'mock_price_monitoring', 4900, 'usd', 'active', 'phase18-subscription-${name}', now())`,
  ).join(",\n");

  database(`
begin;
set local session_replication_role = replica;
${cleanupSql()}
insert into public.orgs (id, name, slug)
values ('${fixture.orgId}', 'Phase 18 Fixture', 'phase-18-paid-refresh-fixture');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ${userRows};
insert into public.profiles (id, role, org_id, org_role, manages, full_name, email)
values
('${fixture.adminId}', 'platform_admin', null, null, '{}'::uuid[], 'Paid Refresh Admin', 'paid-refresh-admin@fixture.example'),
('${fixture.operatorId}', 'operator_member', '${fixture.orgId}', 'owner', '{}'::uuid[], 'Paid Refresh Operator', 'paid-refresh-operator@fixture.example'),
${consumerProfiles};
insert into public.clients (id, org_id, consumer_profile_id, display_name, stage, assigned_to)
values ${clients};
insert into public.enrollments (
  id, client_id, crs_member_ref, status, monitoring_consent_at,
  analysis_consent_at, esig_doc_id, idpass, persona_hint
)
values ${enrollments};
insert into public.consents (client_id, kind, action, text_version, signed_at, ip, esig_ref)
values ${consents};
insert into public.consumer_subscriptions (
  id, client_id, enrollment_id, provider, customer_ref, payment_method_ref,
  subscription_ref, price_ref, price_cents, currency, status, idempotency_key, activated_at
)
values ${subscriptions};
insert into public.pull_caps (
  client_id, org_id, min_interval_seconds, max_count, count_window_seconds, updated_by
)
values ('${fixture.cases.capDenied.clientId}', '${fixture.orgId}', null, 1, 3600, '${fixture.adminId}');
insert into public.pull_cap_attempts (
  client_id, org_id, cause, source_id, allowed, reason, decided_at
)
values (
  '${fixture.cases.capDenied.clientId}', '${fixture.orgId}', 'scheduled',
  '${fixture.capSeedSourceId}', true, null, clock_timestamp()
);
commit;
`);
}

export function clearPaidRefreshFixture(): void {
  database(`begin; set local session_replication_role = replica; ${cleanupSql()} commit;`);
}

export function readPaidRefreshFixtureEvidence(
  caseName: PaidRefreshFixtureCase,
): PaidRefreshFixtureEvidence {
  const entry = PAID_REFRESH_FIXTURE.cases[caseName];
  const json = database(`
with request as (
  select * from public.paid_refresh_requests
  where actor_profile_id = '${entry.consumerId}'
    and idempotency_key = '${entry.idempotencyKey}'
), analysis as (
  select job.* from public.analysis_jobs as job
  join request on request.id = job.source_id
  where job.client_id = '${entry.clientId}'
    and job.source_kind = 'force_pull'
    and job.trigger = 'force_pull'
), background as (
  select queued.* from public.background_jobs as queued
  join analysis on queued.job = 'analysis.run'
    and queued.subject = analysis.subject
    and queued."window" = analysis."window"
)
select jsonb_build_object(
  'requestCount', (select count(*) from request),
  'requestId', (select id from request limit 1),
  'requestState', (select state from request limit 1),
  'providerPaymentRef', (select provider_payment_ref from request limit 1),
  'paymentEventCount', (select count(*) from public.paid_refresh_payment_events where request_id in (select id from request)),
  'succeededEventCount', (select count(*) from public.paid_refresh_payment_events where request_id in (select id from request) and outcome = 'succeeded'),
  'latestPaymentOutcome', (select outcome from public.paid_refresh_payment_events where request_id in (select id from request) order by occurred_at desc, id desc limit 1),
  'latestPaymentOccurredAt', (select occurred_at from public.paid_refresh_payment_events where request_id in (select id from request) order by occurred_at desc, id desc limit 1),
  'analysisCount', (select count(*) from analysis),
  'analysisJobId', (select id from analysis limit 1),
  'analysisRunId', (select analysis_run_id from analysis limit 1),
  'analysisCreatedAt', (select created_at from analysis limit 1),
  'backgroundCount', (select count(*) from background),
  'backgroundJobId', (select id from background limit 1),
  'backgroundSubject', (select subject from background limit 1),
  'backgroundWindow', (select "window" from background limit 1),
  'backgroundAuditCount', (select count(*) from public.audit_log where action = 'background_job.transition' and subject_id in (select id from background)),
  'capAttemptCount', (select count(*) from public.pull_cap_attempts where client_id = '${entry.clientId}' and cause = 'force_pull'),
  'capAllowedCount', (select count(*) from public.pull_cap_attempts where client_id = '${entry.clientId}' and cause = 'force_pull' and allowed),
  'capDeniedCount', (select count(*) from public.pull_cap_attempts where client_id = '${entry.clientId}' and cause = 'force_pull' and not allowed)
)::text;
`);
  return JSON.parse(json) as PaidRefreshFixtureEvidence;
}
