import "server-only";

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { ReferralEvidence } from "./types.ts";

export const REFERRAL_FIXTURE = {
  alternateClientId: "f3000000-0000-0000-0000-000000000012",
  destinationClientId: "f3000000-0000-0000-0000-000000000011",
  destinationConsumerId: "f1000000-0000-0000-0000-000000000011",
  platformOrgId: "f0000000-0000-0000-0000-000000000001",
  sourceClientId: "a3000000-0000-0000-0000-000000000001",
  sourceConsumerId: "a1000000-0000-0000-0000-000000000011",
  sourceOrgId: "a0000000-0000-0000-0000-000000000001",
} as const;

function fixtureGuard() {
  if (process.env.REFERRAL_E2E !== "1") throw new Error("Referral fixture is disabled.");
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!apiUrl) throw new Error("Referral fixture has no local database URL.");
  const host = new URL(apiUrl).hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("Referral fixture requires a loopback database URL.");
  }
}

function projectId(): string {
  const config = readFileSync(path.resolve(process.cwd(), "../supabase/config.toml"), "utf8");
  const id = config.match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
  if (!id) throw new Error("Referral fixture project ID is unavailable.");
  return id;
}

function database(sql: string): string {
  fixtureGuard();
  const result = spawnSync(
    "docker",
    ["exec", "-i", `supabase_db_${projectId()}`, "psql", "-X", "-U", "postgres", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1"],
    { encoding: "utf8", input: sql, maxBuffer: 2 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const detail = result.stderr.trim().split("\n").at(-1) ?? "unknown database error";
    throw new Error(`Referral fixture database operation failed: ${detail}`);
  }
  return result.stdout.trim();
}

export function provisionReferralFixture(): void {
  const id = REFERRAL_FIXTURE;
  database(`
begin;
set local session_replication_role = replica;
delete from public.audit_log where subject_type = 'consumer_referral' and subject_id in (
  select id from public.consumer_referrals where source_client_id = '${id.sourceClientId}' and platform_org_id = '${id.platformOrgId}'
);
delete from public.consumer_referrals where source_client_id = '${id.sourceClientId}' and platform_org_id = '${id.platformOrgId}';
delete from public.clients where id in ('${id.destinationClientId}', '${id.alternateClientId}');
delete from public.profiles where id = '${id.destinationConsumerId}';
delete from auth.users where id = '${id.destinationConsumerId}';
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('${id.destinationConsumerId}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'referral-fixture@platform.example', '', now(), now(), now());
insert into public.profiles (id, role, org_id, org_role, manages, full_name, email)
values ('${id.destinationConsumerId}', 'consumer', '${id.platformOrgId}', null, '{}'::uuid[], 'Referral Fixture Consumer', 'referral-fixture@platform.example')
on conflict (id) do update set role = excluded.role, org_id = excluded.org_id, org_role = null, manages = '{}'::uuid[], full_name = excluded.full_name, email = excluded.email;
insert into public.clients (id, org_id, consumer_profile_id, display_name)
values ('${id.destinationClientId}', '${id.platformOrgId}', '${id.destinationConsumerId}', 'Referral Fixture Client');
insert into public.clients (id, org_id, display_name)
values ('${id.alternateClientId}', '${id.platformOrgId}', 'Referral Alternate Fixture Client');
commit;
`);
}

export function clearReferralFixture(): void {
  const id = REFERRAL_FIXTURE;
  database(`
begin;
set local session_replication_role = replica;
delete from public.audit_log where subject_type = 'consumer_referral' and subject_id in (
  select id from public.consumer_referrals where source_client_id = '${id.sourceClientId}' and platform_org_id = '${id.platformOrgId}'
);
delete from public.consumer_referrals where source_client_id = '${id.sourceClientId}' and platform_org_id = '${id.platformOrgId}';
delete from public.clients where id in ('${id.destinationClientId}', '${id.alternateClientId}');
delete from public.profiles where id = '${id.destinationConsumerId}';
delete from auth.users where id = '${id.destinationConsumerId}';
commit;
`);
}

export function readReferralFixtureEvidence(referralId: string): ReferralEvidence | null {
  if (!/^[0-9a-f-]{36}$/i.test(referralId)) throw new Error("Referral evidence ID is invalid.");
  const json = database(`
select coalesce(jsonb_build_object(
  'referralId', referral.id,
  'sourceClientId', referral.source_client_id,
  'sourceOrgId', referral.source_org_id,
  'platformOrgId', referral.platform_org_id,
  'createdAt', referral.created_at,
  'clickedAt', referral.clicked_at,
  'convertedAt', referral.converted_at,
  'convertedClientId', referral.converted_client_id,
  'auditActions', coalesce((select jsonb_agg(a.action order by a.occurred_at) from public.audit_log a where a.subject_type = 'consumer_referral' and a.subject_id = referral.id), '[]'::jsonb)
)::text, '')
from public.consumer_referrals referral
where referral.id = '${referralId}';
`);
  return json ? JSON.parse(json) as ReferralEvidence : null;
}
