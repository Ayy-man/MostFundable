"use client";

import type { CreateTaskInput, OperatorTask, UpdateTaskInput } from "./types.ts";
import { parseTask } from "./validate.ts";

export class TaskClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "TaskClientError";
  }
}

async function body(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function exact(value: unknown, key: "task" | "tasks"): value is Record<typeof key, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 1 && Object.hasOwn(value, key);
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...init });
  if (response.ok) return response;
  const payload = await body(response);
  const error = typeof payload === "object" && payload !== null && "error" in payload
    ? (payload as { error?: unknown }).error : null;
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "tasks_unavailable";
  const message = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "Tasks are temporarily unavailable.";
  throw new TaskClientError(code, message);
}

export async function loadTasks(): Promise<readonly OperatorTask[]> {
  const payload = await body(await request("/api/tasks"));
  if (!exact(payload, "tasks") || !Array.isArray(payload.tasks)) throw new TaskClientError("tasks_invalid", "The tasks response was invalid.");
  const tasks = payload.tasks.map(parseTask);
  if (tasks.some((task) => task === null)) throw new TaskClientError("tasks_invalid", "The tasks response was invalid.");
  return Object.freeze(tasks as OperatorTask[]);
}

export async function createTask(input: CreateTaskInput): Promise<OperatorTask> {
  const payload = await body(await request("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }));
  if (!exact(payload, "task")) throw new TaskClientError("tasks_invalid", "The task response was invalid.");
  const task = parseTask(payload.task);
  if (task === null) throw new TaskClientError("tasks_invalid", "The task response was invalid.");
  return task;
}

export async function updateTask(taskId: string, input: UpdateTaskInput): Promise<OperatorTask> {
  const payload = await body(await request(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }));
  if (!exact(payload, "task")) throw new TaskClientError("tasks_invalid", "The task response was invalid.");
  const task = parseTask(payload.task);
  if (task === null) throw new TaskClientError("tasks_invalid", "The task response was invalid.");
  return task;
}

export async function removeTask(taskId: string): Promise<void> {
  await request(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}
