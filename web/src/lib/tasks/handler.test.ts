import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleTaskCollection, handleTaskItem, type TaskHandlerDependencies } from "./handler.ts";
import { TaskError, type OperatorTask } from "./types.ts";

const ORG = "00000000-0000-4000-8000-000000004084";
const ACTOR = "00000000-0000-4000-8000-000000004081";
const TASK = "00000000-0000-4000-8000-000000004088";
const task: OperatorTask = {
  assigneeProfileId: null,
  clientId: null,
  completedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  dueOn: null,
  id: TASK,
  notes: "",
  priority: "medium",
  status: "pending",
  title: "Review packet",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function harness(overrides: Partial<TaskHandlerDependencies> = {}) {
  const calls: Array<readonly unknown[]> = [];
  const dependencies: TaskHandlerDependencies = {
    async assertWrite() { calls.push(["write"]); },
    repository: {
      async create(orgId, actorId, input) { calls.push(["create", orgId, actorId, input]); return task; },
      async list(orgId) { calls.push(["list", orgId]); return [task]; },
      async remove(orgId, taskId, actorId) { calls.push(["remove", orgId, taskId, actorId]); },
      async update(orgId, taskId, input) { calls.push(["update", orgId, taskId, input]); return { ...task, ...input }; },
    },
    async requireOperator() {
      calls.push(["auth"]);
      return { disabledAt: null, id: ACTOR, manages: [], orgId: ORG, orgMembership: "current", orgRole: "owner", role: "operator_member" };
    },
    ...overrides,
  };
  return { calls, dependencies };
}

describe("task collection handler", () => {
  it("lists only after resolving the operator organization", async () => {
    const test = harness();
    const response = await handleTaskCollection(new Request("https://example.test/api/tasks"), test.dependencies);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { tasks: [task] });
    assert.deepEqual(test.calls, [["auth"], ["list", ORG]]);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  it("derives tenant and creator on create", async () => {
    const test = harness();
    const response = await handleTaskCollection(new Request("https://example.test/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Review packet" }),
    }), test.dependencies);
    assert.equal(response.status, 201);
    assert.deepEqual(test.calls[0], ["auth"]);
    assert.deepEqual(test.calls[1], ["write"]);
    assert.deepEqual(test.calls[2], ["create", ORG, ACTOR, {
      assigneeProfileId: null,
      clientId: null,
      dueOn: null,
      notes: "",
      priority: "medium",
      title: "Review packet",
    }]);
  });

  it("does not let a body name tenant, creator, or status", async () => {
    const test = harness();
    const response = await handleTaskCollection(new Request("https://example.test/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Review packet", orgId: ORG }),
    }), test.dependencies);
    assert.equal(response.status, 400);
    assert.equal(test.calls.some(([name]) => name === "create"), false);
  });
});

describe("task item handler", () => {
  it("updates through the scoped repository after the billing wall", async () => {
    const test = harness();
    const response = await handleTaskItem(new Request(`https://example.test/api/tasks/${TASK}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    }), TASK, test.dependencies);
    assert.equal(response.status, 200);
    assert.deepEqual(test.calls, [["auth"], ["write"], ["update", ORG, TASK, { status: "completed" }]]);
  });

  it("soft-removes through the scoped repository and returns no body", async () => {
    const test = harness();
    const response = await handleTaskItem(new Request(`https://example.test/api/tasks/${TASK}`, { method: "DELETE" }), TASK, test.dependencies);
    assert.equal(response.status, 204);
    assert.deepEqual(test.calls, [["auth"], ["write"], ["remove", ORG, TASK, ACTOR]]);
  });

  it("maps an inaccessible task to the same not-found response", async () => {
    const test = harness({
      repository: {
        async create() { throw new Error("unused"); },
        async list() { return []; },
        async remove() { throw new TaskError("not_found"); },
        async update() { throw new TaskError("not_found"); },
      },
    });
    const response = await handleTaskItem(new Request(`https://example.test/api/tasks/${TASK}`, { method: "DELETE" }), TASK, test.dependencies);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "task_not_found");
  });
});
