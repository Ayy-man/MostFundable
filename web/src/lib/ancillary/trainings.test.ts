import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTraining, listTrainings, publishTraining, unpublishTraining, updateTraining } from "./trainings.ts";
import type { AncillaryRepository, Training } from "./repository.ts";

const ADMIN = { id: "17000000-0000-4000-8000-000000000001", role: "platform_admin" as const, orgId: null };
const OPERATOR = { id: "17000000-0000-4000-8000-000000000002", role: "operator_member" as const, orgId: "17000000-0000-4000-8000-000000000010" };
const ROW: Training = { id: "17000000-0000-4000-8000-000000000020", orgId: OPERATOR.orgId, audience: "client", source: "operator", sourceFile: null, title: "One", videoUrl: "https://youtu.be/example", body: "Body", published: false, publishedAt: null, publishedBy: null, attested: false, attestedAt: null, attestationText: null, takedownReason: null, takenDownBy: null, takenDownAt: null, createdBy: OPERATOR.id, createdAt: "2026-08-16T00:00:00Z", updatedAt: "2026-08-16T00:00:00Z" };
function repo(overrides: Partial<AncillaryRepository>): AncillaryRepository { return overrides as AncillaryRepository; }

describe("training service", () => {
  it("maps validated operator input to an org-scoped draft", async () => {
    let captured: unknown;
    const result = await createTraining(OPERATOR, { audience: "client", title: " Title ", videoUrl: "https://www.youtube.com/watch?v=x", body: " Body " }, repo({ async createTraining(input) { captured = input; return ROW; } }));
    assert.equal(result, ROW);
    assert.deepEqual(captured, { audience: "client", title: "Title", videoUrl: "https://www.youtube.com/watch?v=x", body: "Body", orgId: OPERATOR.orgId, source: "operator", createdBy: OPERATOR.id });
  });

  it("rejects an unapproved video host before repository access", async () => {
    let calls = 0;
    await assert.rejects(() => createTraining(ADMIN, { audience: "operator", title: "T", videoUrl: "https://example.test/video", body: "B" }, repo({ async createTraining() { calls += 1; return ROW; } })), /TRAINING_VIDEO_INVALID/);
    assert.equal(calls, 0);
  });

  it("refuses publication before its RPC when copy or confirmation is absent", async () => {
    let calls = 0;
    const repository = repo({ async publishTraining() { calls += 1; return ROW; } });
    await assert.rejects(() => publishTraining(OPERATOR, ROW.id, true, {}, repository), /TRAINING_ATTESTATION_REQUIRED/);
    await assert.rejects(() => publishTraining(OPERATOR, ROW.id, false, { TRAINING_ATTESTATION_TEXT: "Approved" }, repository), /TRAINING_ATTESTATION_REQUIRED/);
    assert.equal(calls, 0);
  });

  it("passes the exact named copy and scopes consumer listings", async () => {
    let copy = "";
    const published = { ...ROW, published: true };
    const repository = repo({
      async publishTraining(_id, _actor, attestation) { copy = attestation; return published; },
      async listTrainings() { return [published, { ...published, id: "17000000-0000-4000-8000-000000000021", audience: "operator" }]; },
    });
    await publishTraining(OPERATOR, ROW.id, true, { TRAINING_ATTESTATION_TEXT: " Exact approved copy " }, repository);
    assert.equal(copy, "Exact approved copy");
    assert.equal((await listTrainings({ id: "17000000-0000-4000-8000-000000000003", role: "consumer", orgId: OPERATOR.orgId }, repository)).length, 1);
  });

  it("uses the legacy update while console operations is absent and the RPC when enabled", async () => {
    const calls: string[] = [];
    const repository = repo({
      async listTrainings() { return [ROW]; },
      async updateTraining() { calls.push("legacy"); return ROW; },
      async updateTrainingWithReattestation(_id, actorId) { calls.push(`rpc:${actorId}`); return ROW; },
    });
    const value = { audience: "client" as const, title: "Updated", videoUrl: "https://youtu.be/updated", body: "Updated" };
    await updateTraining(OPERATOR, ROW.id, value, repository, {});
    await updateTraining(OPERATOR, ROW.id, value, repository, { FEATURE_CONSOLE_OPS: "true" });
    assert.deepEqual(calls, ["legacy", `rpc:${OPERATOR.id}`]);
  });

  it("requires a bounded admin reason and keeps operator compatibility", async () => {
    const reasons: Array<string | null> = [];
    const repository = repo({ async listTrainings() { return [ROW, { ...ROW, id: "17000000-0000-4000-8000-000000000030", source: "platform", orgId: null }]; }, async unpublishTraining(_id, _actor, reason) { reasons.push(reason); return ROW; } });
    await assert.rejects(() => unpublishTraining(ADMIN, "17000000-0000-4000-8000-000000000030", undefined, repository), /TRAINING_TAKEDOWN_REASON_REQUIRED/);
    await assert.rejects(() => unpublishTraining(ADMIN, "17000000-0000-4000-8000-000000000030", "x".repeat(1001), repository), /TRAINING_TAKEDOWN_REASON_REQUIRED/);
    await unpublishTraining(ADMIN, "17000000-0000-4000-8000-000000000030", "  Review required  ", repository);
    await unpublishTraining(OPERATOR, ROW.id, "ignored operator text", repository);
    assert.deepEqual(reasons, ["Review required", null]);
  });
});
