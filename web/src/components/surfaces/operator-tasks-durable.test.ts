import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const operatorPath = new URL("./operator.tsx", import.meta.url);

async function taskSource() {
  const source = await readFile(operatorPath, "utf8");
  const start = source.indexOf("function renderTasks()");
  const end = source.indexOf("function renderPlatformSupport()", start);
  assert.ok(start >= 0 && end > start, "missing operator Tasks section");
  return { source, tasks: source.slice(start, end) };
}

describe("durable operator tasks", () => {
  it("loads the signed-in queue on entry without exposing fixture tasks", async () => {
    const { source, tasks } = await taskSource();
    assert.match(source, /view !== "tasks"/);
    assert.match(source, /await loadTasks\(\)/);
    assert.match(source, /setDurableTasks\(rows\)/);
    assert.match(source, /const \[fixtureTasks, setFixtureTasks\][\s\S]*?durableWorkspace\s*\? \[\]/);
    assert.match(tasks, /durableWorkspace[\s\S]*?trackerClients\.clients/);
    assert.doesNotMatch(tasks, /TASK_FIXTURES/);
  });

  it("creates, edits, completes, reopens and deletes through the task client", async () => {
    const { tasks } = await taskSource();
    assert.match(tasks, /createTask\(\{[\s\S]*?assigneeProfileId: newTaskAssigneeId[\s\S]*?clientId: newTaskClientId[\s\S]*?dueOn: newTaskDueOn \|\| null/);
    assert.match(tasks, /updateTask\(task\.id, \{[\s\S]*?assigneeProfileId: draft\.assigneeProfileId[\s\S]*?clientId: draft\.clientId[\s\S]*?title: draft\.title\.trim\(\)/);
    assert.match(tasks, /const status = task\.status === "completed" \? "pending" : "completed"/);
    assert.match(tasks, /updateTask\(task\.id, \{ status \}\)/);
    assert.match(tasks, /removeTask\(task\.id\)/);
    assert.match(tasks, /await refreshDurableTasks\(\)/);
    assert.match(tasks, /Delete this task\?/);
  });

  it("maps stable references and derives overdue without storing a third status", async () => {
    const { source, tasks } = await taskSource();
    assert.match(source, /teamRows\.map\(\(member\) => \[member\.id, member\.name\]\)/);
    assert.match(tasks, /teamRows\.map\(\(member\) => \(\{ label: member\.name, value: member\.id \}\)\)/);
    assert.match(tasks, /<TaskClientTypeahead/);
    assert.match(source, /task\.dueOn !== null && today !== null && task\.dueOn < today/);
    assert.match(source, /task\.status === "completed"/);
  });

  it("renders explicit loading, failure, empty and mutation feedback", async () => {
    const { tasks } = await taskSource();
    assert.match(tasks, /Loading tasks…/);
    assert.match(tasks, /Tasks unavailable/);
    assert.match(tasks, />\s*Retry\s*</);
    assert.match(tasks, /No tasks yet/);
    assert.match(tasks, /role="alert"/);
    assert.match(tasks, /saved task list could not be read back/);
    assert.doesNotMatch(tasks, /this visit|task records are not stored|persistence is not connected/i);
  });
});
