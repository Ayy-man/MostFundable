import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCreateTask, parseTask, parseUpdateTask } from "./validate.ts";

const ID = "00000000-0000-4000-8000-000000004081";

describe("task request validation", () => {
  it("normalizes a complete create request and supplies honest defaults", () => {
    assert.deepEqual(parseCreateTask({ title: "  Review packet  " }), {
      ok: true,
      value: {
        assigneeProfileId: null,
        clientId: null,
        dueOn: null,
        notes: "",
        priority: "medium",
        title: "Review packet",
      },
    });
  });

  it("rejects invalid dates, unknown fields and empty updates", () => {
    assert.equal(parseCreateTask({ title: "Task", dueOn: "2026-02-30" }).ok, false);
    assert.equal(parseCreateTask({ title: "Task", status: "completed" }).ok, false);
    assert.equal(parseUpdateTask({}).ok, false);
  });

  it("accepts nullable tenant links and the two durable statuses", () => {
    assert.deepEqual(parseUpdateTask({ assigneeProfileId: ID, clientId: null, status: "completed" }), {
      ok: true,
      value: { assigneeProfileId: ID, clientId: null, status: "completed" },
    });
  });
});

describe("task response parsing", () => {
  const task = {
    assigneeProfileId: ID,
    clientId: null,
    completedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    dueOn: "2026-09-02",
    id: "00000000-0000-4000-8000-000000004088",
    notes: "",
    priority: "high",
    status: "pending",
    title: "Review packet",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };

  it("accepts the exact durable contract", () => {
    assert.deepEqual(parseTask(task), task);
  });

  it("rejects widened rows and contradictory completion evidence", () => {
    assert.equal(parseTask({ ...task, orgId: ID }), null);
    assert.equal(parseTask({ ...task, status: "completed" }), null);
  });
});
