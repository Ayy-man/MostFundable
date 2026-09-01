import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AnalysisCompletedInput as AnalysisPortInput } from "@/lib/analysis/ports";

import { createTrackerAnalysisStageTracker } from "./analysis-adapter";
import {
  createTrackerEnrollmentPort,
  trackerEnrollmentPort,
  type EnrollmentGlueDependencies,
} from "./enrollment-adapter";

const CLIENT_ID = "7c000000-0000-4000-8000-000000000001";
const ENROLLMENT_ID = "7c000000-0000-4000-8000-000000000002";
const ANALYSIS_RUN_ID = "7c000000-0000-4000-8000-000000000003";
const ACTOR_ID = "a1000000-0000-0000-0000-000000000001";

const activation = {
  actorId: ACTOR_ID,
  clientId: CLIENT_ID,
  enrollmentId: ENROLLMENT_ID,
};

type Recorded = { call: string; input: unknown };

function recorder(
  overrides: Partial<EnrollmentGlueDependencies> = {},
): { calls: Recorded[]; dependencies: EnrollmentGlueDependencies } {
  const calls: Recorded[] = [];
  const dependencies: EnrollmentGlueDependencies = {
    async activateStage(input) {
      calls.push({ call: "activateStage", input });
      return { outcome: "transitioned" };
    },
    async enqueueAnalysis(input) {
      calls.push({ call: "enqueueAnalysis", input });
      return null;
    },
    ...overrides,
  };
  return { calls, dependencies };
}

function captureConsoleError() {
  const captured: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args);
  };
  return {
    captured,
    restore() {
      console.error = original;
    },
  };
}

describe("tracker enrollment adapter", () => {
  it("drives the stage transition first and the analysis enqueue second, with both ids", async () => {
    const { calls, dependencies } = recorder();

    await createTrackerEnrollmentPort(dependencies).enrollmentActivated(activation);

    assert.deepEqual(
      calls.map((entry) => entry.call),
      ["activateStage", "enqueueAnalysis"],
    );
    for (const entry of calls) {
      assert.deepEqual(entry.input, {
        clientId: CLIENT_ID,
        enrollmentId: ENROLLMENT_ID,
      });
    }
  });

  it("passes no provenance of its own, so the worker's scheduled default stands", async () => {
    const { calls, dependencies } = recorder();

    await createTrackerEnrollmentPort(dependencies).enrollmentActivated(activation);

    const enqueue = calls.find((entry) => entry.call === "enqueueAnalysis");
    assert.deepEqual(Object.keys(enqueue?.input as object).toSorted(), [
      "clientId",
      "enrollmentId",
    ]);
    assert.equal(JSON.stringify(enqueue?.input).includes("force_pull"), false);
  });

  it("still attempts the enqueue, and still resolves, when the transition rejects", async () => {
    const console_ = captureConsoleError();
    const { calls, dependencies } = recorder({
      async activateStage() {
        throw new Error("transition unavailable");
      },
    });

    try {
      await createTrackerEnrollmentPort(dependencies).enrollmentActivated(activation);
    } finally {
      console_.restore();
    }

    assert.deepEqual(
      calls.map((entry) => entry.call),
      ["enqueueAnalysis"],
    );
    assert.equal(console_.captured.length, 1);
  });

  it("resolves when the idempotent analysis verifier rejects after durable activation", async () => {
    const console_ = captureConsoleError();
    const { calls, dependencies } = recorder({
      async enqueueAnalysis() {
        throw new Error("queue unavailable");
      },
    });

    try {
      await createTrackerEnrollmentPort(dependencies).enrollmentActivated(activation);
    } finally {
      console_.restore();
    }

    assert.deepEqual(
      calls.map((entry) => entry.call),
      ["activateStage"],
    );
    assert.equal(console_.captured.length, 1);
  });

  it("logs metadata only: the call name, the two subjects and the error identity", async () => {
    const console_ = captureConsoleError();
    const { dependencies } = recorder({
      async activateStage() {
        throw new Error("transition unavailable");
      },
    });

    try {
      await createTrackerEnrollmentPort(dependencies).enrollmentActivated(activation);
    } finally {
      console_.restore();
    }

    const [message, metadata] = console_.captured[0] ?? [];
    assert.equal(message, "tracker enrollment glue failed");
    assert.deepEqual(Object.keys(metadata as object).toSorted(), [
      "call",
      "clientId",
      "enrollmentId",
      "errorMessage",
      "errorName",
    ]);
    assert.equal((metadata as { call: string }).call, "onEnrollmentActivated");
  });

  it("exports a frozen production instance with the single port method", () => {
    assert.equal(Object.isFrozen(trackerEnrollmentPort), true);
    assert.equal(typeof trackerEnrollmentPort.enrollmentActivated, "function");
  });
});

describe("tracker analysis adapter", () => {
  it("forwards the run and the client and drops the readiness score", async () => {
    const seen: unknown[] = [];
    const tracker = createTrackerAnalysisStageTracker(async (input) => {
      seen.push(input);
      return { outcome: "unchanged" };
    });

    await tracker.recordAnalysisCompleted({
      analysisRunId: ANALYSIS_RUN_ID,
      clientId: CLIENT_ID,
      readinessScore: 41,
    } satisfies AnalysisPortInput);

    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], {
      analysisRunId: ANALYSIS_RUN_ID,
      clientId: CLIENT_ID,
    });
    assert.equal(Object.hasOwn(seen[0] as object, "readinessScore"), false);
  });

  it("lets a rejection propagate, so the worker maps it to a retryable failure", async () => {
    const tracker = createTrackerAnalysisStageTracker(async () => {
      throw new Error("transition unavailable");
    });

    await assert.rejects(
      tracker.recordAnalysisCompleted({
        analysisRunId: ANALYSIS_RUN_ID,
        clientId: CLIENT_ID,
        readinessScore: 41,
      }),
      /transition unavailable/,
    );
  });
});
