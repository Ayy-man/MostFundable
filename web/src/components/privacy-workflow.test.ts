import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const consumerSurface = readFileSync(new URL("./surfaces/consumer.tsx", import.meta.url), "utf8");
const adminSurface = readFileSync(new URL("./surfaces/admin.tsx", import.meta.url), "utf8");
const consumer = readFileSync(new URL("./consumer/privacy-requests.tsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("./admin/privacy-requests.tsx", import.meta.url), "utf8");
const privacyMigration = readFileSync(
  new URL("../../../supabase/migrations/416_consumer_privacy_requests.sql", import.meta.url),
  "utf8",
);
const tasksMigration = readFileSync(
  new URL("../../../supabase/migrations/408_operator_tasks.sql", import.meta.url),
  "utf8",
);

describe("privacy workflow surface contract", () => {
  it("mounts the durable consumer workflow in Account and the admin queue in Support", () => {
    assert.match(consumerSurface, /profileDurable \? <ConsumerPrivacyRequests \/>/);
    assert.equal((consumerSurface.match(/<ConsumerPrivacyRequests/g) ?? []).length, 1);
    assert.match(adminSurface, /label: "Privacy requests", value: "privacy"/);
    assert.match(adminSurface, /supportTab === "privacy"\s*\? <AdminPrivacyRequests \/>/);
  });

  it("gives the consumer both request kinds and renders durable status details", () => {
    for (const literal of [
      "Request my data",
      "Request deletion",
      "Submitted {date(request.submittedAt)}",
      "request.denialReason",
      "request.completionNote",
    ]) assert.ok(consumer.includes(literal), `missing consumer privacy contract: ${literal}`);
    assert.match(consumer, /Intl\.DateTimeFormat/);
    assert.doesNotMatch(consumer, /toISOString\(\)/);
  });

  it("keeps completion language honest about external cancellation and retained records", () => {
    assert.match(consumer, /does not cancel billing or provider services automatically/);
    assert.match(consumer, /audit, payment, and consent records remain/);
    assert.match(admin, /fails closed until those cancellations are confirmed/);
    assert.match(admin, /Record delivery/);
    assert.match(admin, /Complete verified erasure/);
  });

  it("requires a denial reason and an access delivery record before admin completion", () => {
    assert.match(admin, /disabled=\{pendingId !== null \|\| !\(reasons\[request\.id\]/);
    assert.match(admin, /request\.kind === "access" && !\(notes\[request\.id\]/);
    assert.match(admin, /action: "deny" as const, reason:/);
    assert.match(admin, /action: "complete" as const, completionNote:/);
  });

  it("redacts client-linked workflow prose before completion and freezes it after archival", () => {
    assert.match(privacyMigration, /update public\.operator_tasks[\s\S]*title = 'Deleted client task'[\s\S]*notes = 'Task details removed following privacy request\.'/);
    assert.match(privacyMigration, /update public\.document_requests[\s\S]*name = 'Deleted document request'[\s\S]*why = 'Request details removed following privacy request\.'/);
    assert.match(privacyMigration, /create trigger document_requests_active_client_guard/);
    assert.match(privacyMigration, /message = 'DOCUMENT_REQUEST_CLIENT_INACTIVE'/);
    assert.doesNotMatch(tasksMigration, /tg_op = 'INSERT' or new\.client_id is distinct from old\.client_id/);

    const taskRedaction = privacyMigration.indexOf("update public.operator_tasks");
    const requestRedaction = privacyMigration.indexOf("update public.document_requests");
    const clientArchive = privacyMigration.indexOf("update public.clients");
    assert.ok(taskRedaction >= 0 && requestRedaction > taskRedaction && clientArchive > requestRedaction);
  });
});
