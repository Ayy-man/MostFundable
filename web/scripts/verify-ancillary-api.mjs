#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const baseUrl = process.env.ANCILLARY_BASE_URL ?? "http://127.0.0.1:3003";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Local Supabase environment names are required.");
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const checks = [];
function passed(name) { checks.push(name); }
async function api(path, actorId, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { "x-mf-demo-profile-id": actorId, ...(init.headers ?? {}) } });
  const type = response.headers.get("content-type") ?? "";
  const value = type.includes("json") ? await response.json() : await response.arrayBuffer();
  return { response, value };
}
async function one(table, columns, configure) {
  let query = db.from(table).select(columns); query = configure ? configure(query) : query;
  const result = await query.limit(1).maybeSingle(); assert.equal(result.error, null); return result.data;
}

const admin = await one("profiles", "id", (query) => query.eq("role", "platform_admin"));
const operator = await one("profiles", "id,org_id,org_role", (query) => query.eq("role", "operator_member").not("org_id", "is", null).in("org_role", ["owner", "admin", "commando"]));
assert.ok(admin?.id && operator?.id && operator.org_id, "seeded admin/operator profiles are required");
const client = await one("clients", "id,org_id,consumer_profile_id", (query) => query.eq("org_id", operator.org_id));
assert.ok(client?.id && client.consumer_profile_id, "a seeded client in the operator organization is required");

const config = await api("/api/trainings/config", operator.id);
assert.equal(config.response.status, 200); assert.equal(config.value.enabled, true);
assert.equal(config.value.platformTrainingsUrl, null); assert.equal(config.value.northwestPartnerUrl, null);
passed("lazy config enabled with both optional URLs absent");

if (config.value.attestationAvailable) {
  const title = `Ancillary verifier ${randomUUID().slice(0, 8)}`;
  const created = await api("/api/trainings", operator.id, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audience: "client", title, videoUrl: "https://youtu.be/ancillary-verifier", body: "Local verifier lesson." }) });
  assert.equal(created.response.status, 201); const trainingId = created.value.id;
  const published = await api(`/api/trainings/${trainingId}/publication`, operator.id, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ attested: true }) });
  assert.equal(published.response.status, 200);
  const persisted = await db.from("trainings").select("published,attestation_text").eq("id", trainingId).single(); assert.equal(persisted.data?.published, true); assert.ok(persisted.data?.attestation_text);
  const audit = await db.from("audit_log").select("id").eq("action", "training.published").eq("subject_id", trainingId); assert.equal(audit.data?.length, 1);
  passed("training publication plus persisted attestation and audit");
} else {
  console.log("SKIPPED training publication: TRAINING_ATTESTATION_TEXT has not arrived.");
}

const companyName = `ancillary-${randomUUID()}.pdf`; const companyForm = new FormData(); companyForm.append("files", new File(["fixture company bytes"], companyName, { type: "application/pdf" }));
const company = await api(`/api/uploads/documents?clientId=${client.id}&section=other`, operator.id, { method: "POST", body: companyForm });
assert.equal(company.response.status, 201, JSON.stringify(company.value)); const companyRow = company.value.documents[0];
const companyRead = await db.from("document_uploads").select("id,lifecycle,object_path").eq("id", companyRow.id).single(); assert.equal(companyRead.data?.lifecycle, "stored");
const milestone = await db.from("enrollment_milestones").select("client_id,completed_at").eq("client_id", client.id).eq("kind", "documents_uploaded").maybeSingle(); assert.equal(milestone.data?.client_id, client.id); assert.ok(milestone.data?.completed_at);
passed("company metadata and documents_uploaded milestone read back");

await api(`/api/pull-caps/${client.id}`, admin.id, { method: "DELETE" });
async function creditUpload() { const form = new FormData(); form.append("file", new File(["MOSTFUNDABLE_FIXTURE_CREDIT_V1"], "fixture.bin", { type: "application/octet-stream" })); return api(`/api/uploads/credit-report?clientId=${client.id}`, operator.id, { method: "POST", body: form }); }
const credit = await creditUpload(); assert.equal(credit.response.status, 201, JSON.stringify(credit.value)); assert.equal(credit.value.status, "queued"); const creditId = credit.value.upload.id;
const creditRead = await db.from("document_uploads").select("lifecycle,derived_features,bucket,object_path").eq("id", creditId).single(); assert.equal(creditRead.data?.lifecycle, "purged"); assert.equal(creditRead.data?.derived_features?.schemaVersion, 1);
const parts = creditRead.data.object_path.split("/"); const objectName = parts.pop(); const storageList = await db.storage.from(creditRead.data.bucket).list(parts.join("/"), { search: objectName }); assert.equal(storageList.data?.some((item) => item.name === objectName), false);
const analysis = await db.from("analysis_jobs").select("id").eq("source_kind", "document_upload").eq("source_id", creditId); assert.equal(analysis.data?.length, 1);
passed("credit derived row, source absence, and one analysis job");

const cap = await api(`/api/pull-caps/${client.id}`, admin.id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ minIntervalSeconds: 3600, maxCount: null, countWindowSeconds: null }) }); assert.equal(cap.response.status, 200);
const blocked = await creditUpload(); assert.equal(blocked.response.status, 202); assert.equal(blocked.value.status, "blocked");
const blockedJobs = await db.from("analysis_jobs").select("id").eq("source_kind", "document_upload").eq("source_id", blocked.value.upload.id); assert.equal(blockedJobs.data?.length, 0);
const blockedAttempt = await db.from("pull_cap_attempts").select("allowed,reason").eq("source_id", blocked.value.upload.id).single(); assert.equal(blockedAttempt.data?.allowed, false); assert.equal(blockedAttempt.data?.reason, "minimum_interval");
passed("cap block persisted with zero analysis enqueue");

async function dispatchAndRead(notificationId, recipientId, label) {
  const dispatched = await api(`/api/notifications/dispatch/${notificationId}`, admin.id, { method: "POST" });
  assert.equal(dispatched.response.status, 200); assert.equal(dispatched.value.status, "ok"); assert.equal(dispatched.value.rows, 1);
  const persisted = await db.from("notification_delivery_outbox").select("status,delivered_at").eq("notification_id", notificationId).single();
  assert.equal(persisted.data?.status, "delivered"); assert.ok(persisted.data?.delivered_at);
  const listed = await api("/api/notifications", recipientId); assert.equal(listed.response.status, 200);
  assert.ok(listed.value.notifications.some((row) => row.id === notificationId));
  const read = await api(`/api/notifications/${notificationId}`, recipientId, { method: "PATCH" });
  assert.equal(read.response.status, 200); assert.ok(read.value.notification.readAt);
  passed(`${label} delivery, recipient list, and read state`);
}

const bankRef = `ancillary-verifier-${randomUUID().slice(0, 8)}`;
// Phase 8, migration 383: applications.bank_ref references banks_cache, so the
// verifier's private lender needs a catalog row. Unpublished, so it never
// appears in /api/banks.
const cachedBank = await db.from("banks_cache").upsert({
  bank_ref: bankRef,
  name: bankRef,
  application_questions: JSON.parse('[{"id":"a","label":"A","responseBasis":"x"},{"id":"b","label":"B","responseBasis":"x"},{"id":"c","label":"C","responseBasis":"x"},{"id":"d","label":"D","responseBasis":"x"}]'),
  is_active: false,
  source: "fixture",
}, { onConflict: "bank_ref" });
assert.equal(cachedBank.error, null);
const application = await db.from("applications").insert({ client_id: client.id, bank_ref: bankRef, created_by: operator.id }).select("id").single();
assert.equal(application.error, null);
const outcome = await db.from("outcomes").insert({ application_id: application.data.id, bank_ref: bankRef, client_id: client.id, kind: "denied", recorded_by: operator.id, recorded_by_kind: "operator" }).select("id").single();
assert.equal(outcome.error, null);
const reviewed = await db.rpc("review_outcome", { p_outcome_id: outcome.data.id, p_decision: "approved", p_actor: admin.id });
assert.equal(reviewed.error, null); assert.equal(reviewed.data?.[0]?.notified, true);
const reviewNotification = await db.from("outcome_notifications").select("id,recipient_profile_id").eq("outcome_id", outcome.data.id).eq("kind", "outcome_review_approved").single();
assert.equal(reviewNotification.error, null);
await dispatchAndRead(reviewNotification.data.id, reviewNotification.data.recipient_profile_id, "approved-review notification");

const alertEvent = await db.from("monitoring_events").insert({ client_id: client.id, event_type: "ACCALERT", occurred_at: new Date().toISOString() }).select("id").single();
assert.equal(alertEvent.error, null);
const alerted = await db.rpc("insert_crs_alert_notification", { p_monitoring_event_id: alertEvent.data.id });
assert.equal(alerted.error, null); assert.equal(alerted.data?.[0]?.inserted, true);
const alertNotification = await db.from("outcome_notifications").select("id,recipient_profile_id").eq("monitoring_event_id", alertEvent.data.id).single();
assert.equal(alertNotification.error, null);
await dispatchAndRead(alertNotification.data.id, alertNotification.data.recipient_profile_id, "ACCALERT notification");
const otherEvent = await db.from("monitoring_events").insert({ client_id: client.id, event_type: "OTHER", occurred_at: new Date().toISOString() }).select("id").single();
assert.equal(otherEvent.error, null);
const rejectedAlert = await db.rpc("insert_crs_alert_notification", { p_monitoring_event_id: otherEvent.data.id });
assert.ok(rejectedAlert.error);
const otherNotifications = await db.from("outcome_notifications").select("id").eq("monitoring_event_id", otherEvent.data.id);
assert.equal(otherNotifications.data?.length, 0);
passed("non-alert monitoring event produced no notification");

const beforeAudit = await db.from("audit_log").select("id", { count: "exact", head: true }).eq("action", "export.completed");
for (const format of ["csv", "json"]) { const exported = await api(`/api/exports?dataset=analysis_runs&format=${format}`, admin.id); assert.equal(exported.response.status, 200); if (format === "json") assert.ok(Array.isArray(exported.value)); else assert.match(new TextDecoder().decode(exported.value), /^id,client_id,/); }
const afterAudit = await db.from("audit_log").select("id", { count: "exact", head: true }).eq("action", "export.completed"); assert.equal(afterAudit.count, (beforeAudit.count ?? 0) + 2);
passed("CSV and JSON fully consumed with two export audits");

await api(`/api/uploads/documents/${companyRow.id}?clientId=${client.id}`, operator.id, { method: "DELETE" });
await api(`/api/pull-caps/${client.id}`, admin.id, { method: "DELETE" });
await db.from("analysis_jobs").delete().eq("source_kind", "document_upload").in("source_id", [creditId, blocked.value.upload.id]);
await db.from("document_uploads").delete().in("id", [creditId, blocked.value.upload.id]);
await db.from("outcome_refresh_jobs").delete().eq("bank_ref", bankRef);
await db.from("applications").delete().eq("id", application.data.id);
console.log(`Ancillary live API verification passed: ${checks.length} persisted checks; ${checks.join("; ")}.`);
