import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AdminTrainingClientError,
  adminTrainingSourcePath,
  createAdminTraining,
  deleteAdminTraining,
  loadAdminTrainingConfig,
  loadAdminTrainings,
  parseAdminTraining,
  parseAdminTrainingConfig,
  publishAdminTraining,
  unpublishAdminTraining,
  updateAdminTraining,
} from "./training-client.ts";

const ID = "17000000-0000-4000-8000-000000000020";
const ACTOR = "17000000-0000-4000-8000-000000000001";
const TRAINING = {
  attestationText: null,
  attested: false,
  attestedAt: null,
  audience: "operator",
  body: "Funding-readiness lesson body",
  createdAt: "2026-08-16T00:00:00Z",
  createdBy: ACTOR,
  id: ID,
  orgId: null,
  published: false,
  publishedAt: null,
  publishedBy: null,
  source: "platform",
  sourceFile: {
    fileName: "source.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    uploadedAt: "2026-08-16T00:00:00Z",
  },
  takedownReason: null,
  takenDownAt: null,
  takenDownBy: null,
  title: "Platform lesson",
  updatedAt: "2026-08-16T00:00:00Z",
  videoUrl: "https://www.youtube.com/watch?v=example",
} as const;

const INPUT = {
  audience: "operator",
  body: "Funding-readiness lesson body",
  title: "Platform lesson",
  videoUrl: "https://www.youtube.com/watch?v=example",
} as const;

type RequestCall = { init?: RequestInit; path: string };

function jsonFetcher(body: unknown, status = 200, calls: RequestCall[] = []): typeof fetch {
  return (async (input, init) => {
    calls.push({ init, path: String(input) });
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe("admin training client parsers", () => {
  it("accepts the canonical training shape and rejects widened or inconsistent rows", () => {
    assert.deepEqual(parseAdminTraining(TRAINING), TRAINING);
    assert.equal(parseAdminTraining({ ...TRAINING, attachmentUrl: "https://example.test/source.pdf" }), null);
    assert.equal(parseAdminTraining({ ...TRAINING, sourceFile: { ...TRAINING.sourceFile, objectPath: `${ID}/source` } }), null);
    assert.equal(parseAdminTraining({ ...TRAINING, sourceFile: { ...TRAINING.sourceFile, fileName: "source.txt" } }), null);
    assert.equal(parseAdminTraining({ ...TRAINING, source: "platform", orgId: ACTOR }), null);
    assert.equal(parseAdminTraining({ ...TRAINING, source: "operator", orgId: ACTOR }), null);
    assert.equal(parseAdminTraining({ ...TRAINING, videoUrl: "https://example.test/video" }), null);
    assert.equal(parseAdminTraining({ ...TRAINING, published: true }), null);
    assert.equal(parseAdminTraining({ ...TRAINING, takedownReason: "Removed" }), null);
  });

  it("accepts both enabled and feature-off config envelopes without inventing capabilities", () => {
    assert.deepEqual(parseAdminTrainingConfig({
      attestationAvailable: true,
      attestationText: "I attest this training.",
      consoleOpsEnabled: true,
      enabled: true,
      northwestPartnerUrl: null,
      platformTrainingsUrl: "https://example.test/trainings",
    }), {
      attestationAvailable: true,
      attestationText: "I attest this training.",
      consoleOpsEnabled: true,
      enabled: true,
      platformTrainingsUrl: "https://example.test/trainings",
    });
    assert.deepEqual(parseAdminTrainingConfig({
      attestationAvailable: false,
      enabled: false,
      northwestPartnerUrl: null,
      platformTrainingsUrl: null,
    }), {
      attestationAvailable: false,
      attestationText: null,
      consoleOpsEnabled: false,
      enabled: false,
      platformTrainingsUrl: null,
    });
    assert.equal(parseAdminTrainingConfig({ enabled: true, attestationAvailable: true }), null);
    assert.equal(parseAdminTrainingConfig({
      attestationAvailable: false,
      attestationText: "Contradictory attestation",
      consoleOpsEnabled: true,
      enabled: true,
      northwestPartnerUrl: null,
      platformTrainingsUrl: null,
    }), null);
  });
});

describe("admin training client transport", () => {
  it("loads config and a strict training list without shared caching", async () => {
    const configCalls: RequestCall[] = [];
    const config = await loadAdminTrainingConfig(jsonFetcher({
      attestationAvailable: false,
      consoleOpsEnabled: false,
      enabled: true,
      northwestPartnerUrl: null,
      platformTrainingsUrl: null,
    }, 200, configCalls));
    assert.equal(config.enabled, true);
    assert.deepEqual(configCalls, [{
      init: { cache: "no-store", credentials: "same-origin" },
      path: "/api/trainings/config",
    }]);

    const listCalls: RequestCall[] = [];
    assert.deepEqual(await loadAdminTrainings(jsonFetcher({ trainings: [TRAINING] }, 200, listCalls)), [TRAINING]);
    assert.equal(listCalls[0].path, "/api/trainings");
    assert.equal(listCalls[0].init?.cache, "no-store");
    assert.equal(listCalls[0].init?.credentials, "same-origin");
    await assert.rejects(
      () => loadAdminTrainings(jsonFetcher({ trainings: [{ id: ID }] })),
      (error: unknown) => error instanceof AdminTrainingClientError && error.code === "training_response_invalid",
    );
  });

  it("creates with an exact multipart source and edits with an optional replacement", async () => {
    const sourceFile = new File([new Uint8Array([1, 2])], "source.pdf", { type: "application/pdf" });
    const createCalls: RequestCall[] = [];
    assert.deepEqual(
      await createAdminTraining({ ...INPUT, sourceFile }, jsonFetcher(TRAINING, 201, createCalls)),
      TRAINING,
    );
    assert.equal(createCalls[0].path, "/api/trainings");
    assert.equal(createCalls[0].init?.method, "POST");
    assert.ok(createCalls[0].init?.body instanceof FormData);
    const createForm = createCalls[0].init?.body as FormData;
    assert.deepEqual([...createForm.keys()].sort(), ["audience", "body", "sourceFile", "title", "videoUrl"]);
    assert.equal(createForm.get("sourceFile"), sourceFile);
    assert.equal(createCalls[0].init?.headers, undefined, "fetch must generate the multipart boundary");

    const updateCalls: RequestCall[] = [];
    assert.deepEqual(await updateAdminTraining(ID, INPUT, jsonFetcher(TRAINING, 200, updateCalls)), TRAINING);
    assert.equal(updateCalls[0].path, `/api/trainings/${ID}`);
    assert.equal(updateCalls[0].init?.method, "PATCH");
    const updateForm = updateCalls[0].init?.body as FormData;
    assert.deepEqual([...updateForm.keys()].sort(), ["audience", "body", "title", "videoUrl"]);

    const replacementCalls: RequestCall[] = [];
    await updateAdminTraining(ID, { ...INPUT, sourceFile }, jsonFetcher(TRAINING, 200, replacementCalls));
    assert.equal((replacementCalls[0].init?.body as FormData).get("sourceFile"), sourceFile);
    assert.equal(adminTrainingSourcePath(ID), `/api/trainings/${ID}/source`);
    assert.throws(() => adminTrainingSourcePath("../source"), /training_id_invalid/);

    await assert.rejects(
      () => createAdminTraining({ ...INPUT, sourceFile }, jsonFetcher(TRAINING, 200)),
      (error: unknown) => error instanceof AdminTrainingClientError
        && error.code === "training_response_invalid",
    );
    await assert.rejects(
      () => updateAdminTraining(ID, INPUT, jsonFetcher({ id: ID }, 200)),
      (error: unknown) => error instanceof AdminTrainingClientError
        && error.code === "training_response_invalid",
    );
  });

  it("uses the exact publication and platform-takedown payloads", async () => {
    const publishCalls: RequestCall[] = [];
    assert.deepEqual(await publishAdminTraining(ID, jsonFetcher(TRAINING, 200, publishCalls)), TRAINING);
    assert.deepEqual(publishCalls[0], {
      init: {
        body: JSON.stringify({ attested: true }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      path: `/api/trainings/${ID}/publication`,
    });

    const unpublishCalls: RequestCall[] = [];
    assert.deepEqual(
      await unpublishAdminTraining(ID, "Review required", jsonFetcher(TRAINING, 200, unpublishCalls)),
      TRAINING,
    );
    assert.equal(unpublishCalls[0].init?.method, "DELETE");
    assert.deepEqual(JSON.parse(String(unpublishCalls[0].init?.body)), { reason: "Review required" });

    await assert.rejects(
      () => publishAdminTraining(ID, jsonFetcher({ ...TRAINING, published: true }, 200)),
      (error: unknown) => error instanceof AdminTrainingClientError
        && error.code === "training_response_invalid",
    );
  });

  it("deletes only on the route's empty 204 and preserves typed error codes", async () => {
    const calls: RequestCall[] = [];
    await deleteAdminTraining(ID, jsonFetcher(undefined, 204, calls));
    assert.equal(calls[0].path, `/api/trainings/${ID}`);
    assert.equal(calls[0].init?.method, "DELETE");

    await assert.rejects(
      () => deleteAdminTraining(ID, jsonFetcher({ error: "training_published" }, 422)),
      (error: unknown) => error instanceof AdminTrainingClientError
        && error.status === 422 && error.code === "training_published",
    );
    await assert.rejects(
      () => deleteAdminTraining(ID, jsonFetcher({}, 200)),
      (error: unknown) => error instanceof AdminTrainingClientError
        && error.code === "training_response_invalid",
    );
  });
});
