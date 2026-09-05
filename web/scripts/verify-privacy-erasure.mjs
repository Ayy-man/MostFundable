#!/usr/bin/env node
// Proves consumer privacy erasure end to end against a running local Supabase stack:
// real auth provider, real storage bucket, real database functions, and the production
// TypeScript service (`administerPrivacyRequest`) with its default dependencies.
//
// Requires: `supabase start` (auth + storage + db) and these environment values:
//   NEXT_PUBLIC_SUPABASE_URL      the local API URL (Kong), e.g. http://127.0.0.1:54521
//   SUPABASE_SERVICE_ROLE_KEY     the local service-role key
// Run: `npm run verify:privacy-erasure`. Every run seeds its own throwaway consumer.
// Nothing sensitive is printed: emails are synthetic, ids are random per run.

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_CONTAINER = "supabase_db_mostfundable";

function say(line) {
  process.stdout.write(`${line}\n`);
}

function sql(text) {
  const result = spawnSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-q"],
    { cwd: WEB_ROOT, encoding: "utf8", input: text, maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr.trim().split("\n").at(-1)}`);
  return result.stdout.trim();
}

function json(text) {
  const out = sql(`select coalesce((${text}), 'null'::jsonb);`);
  return JSON.parse(out || "null");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !serviceRole) {
  say("Local Supabase settings are missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exitCode = 2;
  process.exit();
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  say("Refusing to run: this proof only targets a local Supabase stack.");
  process.exitCode = 2;
  process.exit();
}

const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
const { administerPrivacyRequest, submitPrivacyRequest } = await import("../src/lib/privacy/service.ts");

const run = randomUUID().slice(0, 8);
const ids = {
  org: randomUUID(),
  adminProfile: randomUUID(),
  consumer: randomUUID(),
  operator: randomUUID(),
  client: randomUUID(),
  enrollment: randomUUID(),
  thread: randomUUID(),
  message: randomUUID(),
  task: randomUUID(),
  upload: randomUUID(),
};
const consumerEmail = `erasure-${run}@proof.invalid`;
const memberRef = `erasure_member_${run}`;
const objectPath = `${ids.org}/${ids.client}/${ids.upload}/statement-${run}.pdf`;

function snapshot() {
  return {
    authUser: json(`(select jsonb_build_object('email', email, 'phone', nullif(phone, ''), 'bannedUntil', banned_until, 'metadata', raw_user_meta_data) from auth.users where id = '${ids.consumer}')`),
    profile: json(`(select jsonb_build_object('fullName', full_name, 'email', email, 'phone', phone, 'disabled', disabled_at is not null) from public.profiles where id = '${ids.consumer}')`),
    client: json(`(select jsonb_build_object('businessName', business_name, 'displayName', display_name, 'status', status) from public.clients where id = '${ids.client}')`),
    upload: json(`(select jsonb_build_object('displayName', display_name, 'objectPath', object_path, 'lifecycle', lifecycle, 'failureCode', failure_code) from public.document_uploads where id = '${ids.upload}')`),
    storageObjects: Number(sql(`select count(*) from storage.objects where bucket_id = 'client-documents' and name like '${ids.org}/${ids.client}/%';`)),
    supportMessage: sql(`select body from public.support_messages where id = '${ids.message}';`),
    task: json(`(select jsonb_build_object('title', title, 'notes', notes) from public.operator_tasks where id = '${ids.task}')`),
    request: json(`(select jsonb_build_object('status', status, 'note', completion_note) from public.privacy_requests where client_id = '${ids.client}' and kind = 'deletion')`),
    auditActions: json(`(select jsonb_agg(action order by occurred_at) from public.audit_log where client_id = '${ids.client}' and action like 'privacy.%')`),
  };
}

async function main() {
  say(`run=${run}`);

  // 1. A real auth user through the provider, so the disable step exercises the real admin API.
  const created = await admin.auth.admin.createUser({
    email: consumerEmail,
    email_confirm: true,
    id: ids.consumer,
    password: `Proof-${randomUUID()}`,
    user_metadata: { full_name: "Erasure Proof" },
  });
  if (created.error) throw new Error(`auth createUser failed: ${created.error.message}`);
  say("seed auth-user status=created");

  // 2. Tenant, people, client, enrollment, conversation, task, and a document row.
  sql(`
    begin;
    insert into public.orgs (id, name, slug) values ('${ids.org}', 'Erasure Proof Org ${run}', 'erasure-proof-${run}');
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${ids.adminProfile}', 'erasure-admin-${run}@proof.invalid', '{}'::jsonb),
      ('${ids.operator}', 'erasure-operator-${run}@proof.invalid', '{}'::jsonb);
    insert into public.profiles (id, role, org_id, org_role, full_name, email, phone) values
      ('${ids.adminProfile}', 'platform_admin', null, null, 'Proof Admin', 'erasure-admin-${run}@proof.invalid', null),
      ('${ids.operator}', 'operator_member', '${ids.org}', 'owner', 'Proof Operator', 'erasure-operator-${run}@proof.invalid', null),
      ('${ids.consumer}', 'consumer', '${ids.org}', null, 'Erasure Proof', '${consumerEmail}', '+15550001234')
    on conflict (id) do update set
      role = excluded.role, org_id = excluded.org_id, org_role = excluded.org_role,
      full_name = excluded.full_name, email = excluded.email, phone = excluded.phone, disabled_at = null;
    insert into public.clients (id, org_id, consumer_profile_id, business_name, display_name)
      values ('${ids.client}', '${ids.org}', '${ids.consumer}', 'Proof Ventures LLC', 'Erasure Proof');
    insert into public.consents (id, client_id, kind, text_version, signed_at, ip, esig_ref) values
      ('${randomUUID()}', '${ids.client}', 'monitoring', 'v1', '2026-08-01', '127.0.0.1', 'proof-esig-${run}'),
      ('${randomUUID()}', '${ids.client}', 'analysis', 'v1', '2026-08-01', '127.0.0.1', 'proof-esig-${run}');
    insert into public.enrollments (id, client_id, crs_member_ref, status, esig_doc_id, monitoring_consent_at, analysis_consent_at)
      values ('${ids.enrollment}', '${ids.client}', '${memberRef}', 'active', 'proof-esig-${run}', '2026-08-01', '2026-08-01');
    insert into public.support_threads (id, kind, org_id, client_id, subject, created_by)
      values ('${ids.thread}', 'team_chat', '${ids.org}', '${ids.client}', 'Erasure Proof needs help', '${ids.consumer}');
    insert into public.support_messages (id, thread_id, author_profile_id, author_kind, body)
      values ('${ids.message}', '${ids.thread}', '${ids.consumer}', 'consumer', 'My private account details are in here.');
    insert into public.operator_tasks (id, org_id, client_id, title, notes, created_by)
      values ('${ids.task}', '${ids.org}', '${ids.client}', 'Call Erasure Proof', 'Discuss Proof Ventures LLC details.', '${ids.operator}');
    insert into public.document_uploads (id, org_id, client_id, kind, section, bucket, object_path, display_name, mime_type, size_bytes, lifecycle, uploaded_by)
      values ('${ids.upload}', '${ids.org}', '${ids.client}', 'company', 'tax_returns', 'client-documents', '${objectPath}', 'statement-${run}.pdf', 'application/pdf', 12, 'stored', '${ids.consumer}');
    commit;
  `);
  say("seed database status=created");

  // 3. A real object in the private bucket, through the storage API.
  const uploaded = await admin.storage.from("client-documents").upload(objectPath, Buffer.from("%PDF-1.4 proof"), {
    contentType: "application/pdf",
  });
  if (uploaded.error) throw new Error(`storage upload failed: ${uploaded.error.message}`);
  say("seed storage-object status=uploaded");

  const before = snapshot();
  say(`before storageObjects=${before.storageObjects} authEmailIsPseudonym=${String(before.authUser?.email).startsWith("deleted+")} profileName=${JSON.stringify(before.profile?.fullName)}`);

  // 4. The consumer asks for deletion; the admin picks it up.
  const submitted = await submitPrivacyRequest(ids.consumer, "deletion");
  say(`request submit status=${submitted.status}`);
  const reviewed = await administerPrivacyRequest(ids.adminProfile, submitted.id, { action: "review" });
  say(`request review status=${reviewed.status}`);

  // 5. Completion must refuse while monitoring is still live with the bureau provider.
  let blocked = null;
  try {
    await administerPrivacyRequest(ids.adminProfile, submitted.id, { action: "complete", completionNote: null });
  } catch (error) {
    blocked = error;
  }
  const blockers = Array.isArray(blocked?.blockers) ? blocked.blockers : null;
  say(`complete-while-enrolled outcome=${blocked ? `refused code=${blocked.code ?? blocked.message}` : "ALLOWED (wrong)"} blockers=${JSON.stringify(blockers)}`);
  if (!blocked) throw new Error("erasure completed while a provider obligation was still open");

  // 6. Close the provider obligations the way the app does, then complete for real.
  sql(`
    select public.enrollment_cancel_sub('${ids.enrollment}', '${ids.consumer}', 'privacy_request');
    select public.purge_derived_enrollment('${ids.enrollment}', '${memberRef}');
  `);
  say("provider-cleanup status=done");
  const completed = await administerPrivacyRequest(ids.adminProfile, submitted.id, { action: "complete", completionNote: null });
  say(`request complete status=${completed.status}`);

  const after = snapshot();
  const checks = [
    ["storage object removed", after.storageObjects === 0],
    ["auth email replaced with pseudonym", String(after.authUser?.email).startsWith("deleted+") && String(after.authUser?.email).endsWith("@privacy.invalid")],
    ["auth phone cleared", after.authUser?.phone === null],
    ["auth login banned", typeof after.authUser?.bannedUntil === "string" && Date.parse(after.authUser.bannedUntil) > Date.now()],
    ["auth metadata reduced to erasure marker", JSON.stringify(after.authUser?.metadata) === JSON.stringify({ privacy_erased: true })],
    ["profile name pseudonymised", String(after.profile?.fullName).startsWith("Deleted consumer")],
    ["profile phone cleared", after.profile?.phone === null],
    ["profile disabled", after.profile?.disabled === true],
    ["client business name removed", after.client?.businessName === null],
    ["client archived", after.client?.status === "archived"],
    ["document row tombstoned", after.upload?.displayName === "Deleted document" && after.upload?.failureCode === "privacy_erased" && !after.upload?.objectPath.includes("statement-")],
    ["support message redacted", after.supportMessage === "Message removed following privacy request."],
    ["operator task redacted", after.task?.title === "Deleted client task"],
    ["request marked completed", after.request?.status === "completed"],
    ["audit trail written", Array.isArray(after.auditActions) && after.auditActions.includes("privacy.request.deletion_completed")],
  ];
  let failed = false;
  for (const [label, ok] of checks) {
    say(`${ok ? "PASS" : "FAIL"} ${label}`);
    if (!ok) failed = true;
  }
  if (failed) {
    say(`after=${JSON.stringify(after)}`);
    process.exitCode = 1;
    say("verify status=failed");
    return;
  }
  say(`verify status=passed checks=${checks.length}`);
}

await main().catch((error) => {
  say(`verify status=failed reason=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
