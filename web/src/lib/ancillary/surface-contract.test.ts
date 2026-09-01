import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
const surfaces = path.resolve(process.cwd(), "src/components/surfaces");
const operator = fs.readFileSync(path.join(surfaces, "operator.tsx"), "utf8");
const admin = fs.readFileSync(path.join(surfaces, "admin.tsx"), "utf8");
const consumer = fs.readFileSync(path.join(surfaces, "consumer.tsx"), "utf8");
const consumerBootstrap = fs.readFileSync(path.join(surfaces, "consumer-bootstrap.ts"), "utf8");
const adminTrainingClient = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/admin/training-client.ts"),
  "utf8",
);
// The notifications lane moved the three route calls out of the surface and into their own client,
// the same shape R4B-03 used for the ancillary bootstrap: the surface names the reader, the reader
// names the URL. Both halves are still asserted, so the route cannot go unwired in either place.
const notificationsClient = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/consumer/notifications/client.ts"),
  "utf8",
);
describe("ancillary surface contract", () => {
  it("keeps fixture branches and loads the shared bootstrap lazily", () => {
    assert.match(operator, /TRAINING_FIXTURES\.map/); assert.match(admin, /KNOWLEDGE_PAGES/); assert.match(consumer, /section\.fixtureFiles/);
    assert.match(operator, /fetch\("\/api\/trainings\/config"/);
    assert.match(admin, /loadAdminTrainingConfig\(\)/);
    assert.match(adminTrainingClient, /"\/api\/trainings\/config"/);
    // R4B-03 moved the consumer's read into the four-state loader; the route is unchanged.
    assert.match(consumer, /loadAncillaryBootstrap\(\)/);
    assert.match(consumerBootstrap, /fetcher\("\/api\/trainings\/config", \{ cache: "no-store" \}\)/);
  });
  it("wires only the named API surfaces and explicit training states", () => {
    assert.match(operator, /\/api\/trainings/);
    assert.match(operator, /training\.recordSource === "platform" && training\.published/);
    assert.doesNotMatch(operator, /platformTrainingsUrl|PLATFORM_TRAININGS_URL/);
    for (const route of [
      '"/api/trainings"',
      '`/api/trainings/${encodeURIComponent(id)}`',
      '`/api/trainings/${encodeURIComponent(id)}/publication`',
    ]) assert.ok(adminTrainingClient.includes(route), `${route} is not wired for admin`);
    assert.match(admin, /training library below is the platform record operators read/);
    assert.doesNotMatch(admin, /Set PLATFORM_TRAININGS_URL/);
    assert.match(admin, /\/api\/exports\?dataset=/); assert.match(consumer, /\/api\/uploads\/documents/); assert.match(consumer, /\/api\/uploads\/credit-report/); assert.match(consumer, /fetchNotifications\(\)/);
    assert.match(notificationsClient, /"\/api\/notifications"/);
    assert.match(notificationsClient, /`\/api\/notifications\/\$\{encodeURIComponent\(eventKey\)\}`/);
    assert.match(notificationsClient, /"\/api\/notifications\/read-all"/);
    assert.match(consumer, /northwestPartnerUrl \? <a/); assert.match(consumer, /northwestPartnerUrl \?\? null/);
  });
  it("retains exactly five document sections without embedded or tracked content", () => {
    const sectionBlock = consumer.slice(consumer.indexOf("const documentSections"), consumer.indexOf("function emptyDocumentUploads"));
    assert.equal((sectionBlock.match(/id: "/g) ?? []).length, 5);
    for (const key of ["articles", "ein", "tax-returns", "bank-statements", "other"]) assert.match(sectionBlock, new RegExp(`id: "${key}"`));
    for (const source of [operator, admin, consumer]) { assert.doesNotMatch(source, /<iframe/i); assert.doesNotMatch(source, /device_token|recipient_address/); }
  });
  it("uses the named attestation and neutral private-storage wording on the live branch", () => {
    assert.match(operator, /ancillaryConfig\?\.attestationText/); assert.match(consumer, /Only your funding team can see this/); assert.match(consumer, /ancillaryEnabled \? 6 : 10/);
  });
  it("renders only persisted takedown evidence under the server capability", () => {
    const guard = operator.indexOf("ancillaryConfig?.consoleOpsEnabled && training.takedownReason");
    assert.ok(guard >= 0); assert.ok(operator.indexOf("{training.takedownReason}", guard) > guard);
    assert.match(operator, /takenDownAt/); assert.match(operator, /takenDownBy/);
  });
  it("saves live edits from the persisted PATCH response and resets local attestation", () => {
    const start = operator.indexOf("async function saveTraining()");
    const end = operator.indexOf("async function toggleTrainingPublication", start);
    const block = operator.slice(start, end);
    assert.match(block, /method: creating \? "POST" : "PATCH"/); assert.match(block, /trainingRowFromResponse\(await response\.json\(\)\)/); assert.match(operator, /published: value\.published/); assert.match(block, /next\.delete\(trainingEditDraft\.id\)/);
  });
});
