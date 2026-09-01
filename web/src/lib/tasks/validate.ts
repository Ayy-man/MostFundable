import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type CreateTaskInput,
  type OperatorTask,
  type TaskPriority,
  type TaskStatus,
  type UpdateTaskInput,
} from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CREATE_KEYS = ["assigneeProfileId", "clientId", "dueOn", "notes", "priority", "title"] as const;
const UPDATE_KEYS = [...CREATE_KEYS, "status"] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function isTaskUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function nullableUuid(value: unknown): value is string | null {
  return value === null || isTaskUuid(value);
}

function dateOnly(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !DATE_ONLY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function title(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 160;
}

function notes(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4000;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

export function parseCreateTask(value: unknown): ValidationResult<CreateTaskInput> {
  if (!record(value) || !onlyKeys(value, CREATE_KEYS)) {
    return { ok: false, message: "The task contains unsupported fields." };
  }
  if (!title(value.title)) return { ok: false, message: "Task title must be between 1 and 160 characters." };
  if (!(value.notes === undefined || notes(value.notes))) return { ok: false, message: "Task notes must be 4,000 characters or fewer." };
  if (!(value.priority === undefined || TASK_PRIORITIES.includes(value.priority as TaskPriority))) {
    return { ok: false, message: "Task priority is not supported." };
  }
  if (!(value.clientId === undefined || nullableUuid(value.clientId))) {
    return { ok: false, message: "Task client must be a UUID or null." };
  }
  if (!(value.assigneeProfileId === undefined || nullableUuid(value.assigneeProfileId))) {
    return { ok: false, message: "Task assignee must be a UUID or null." };
  }
  if (!(value.dueOn === undefined || dateOnly(value.dueOn))) {
    return { ok: false, message: "Task due date must be a real YYYY-MM-DD date or null." };
  }
  return {
    ok: true,
    value: {
      assigneeProfileId: (value.assigneeProfileId as string | null | undefined) ?? null,
      clientId: (value.clientId as string | null | undefined) ?? null,
      dueOn: (value.dueOn as string | null | undefined) ?? null,
      notes: (value.notes as string | undefined) ?? "",
      priority: (value.priority as TaskPriority | undefined) ?? "medium",
      title: (value.title as string).trim(),
    },
  };
}

export function parseUpdateTask(value: unknown): ValidationResult<UpdateTaskInput> {
  if (!record(value) || Object.keys(value).length === 0 || !onlyKeys(value, UPDATE_KEYS)) {
    return { ok: false, message: "The task update must contain at least one supported field." };
  }
  if (!(value.title === undefined || title(value.title))) return { ok: false, message: "Task title must be between 1 and 160 characters." };
  if (!(value.notes === undefined || notes(value.notes))) return { ok: false, message: "Task notes must be 4,000 characters or fewer." };
  if (!(value.priority === undefined || TASK_PRIORITIES.includes(value.priority as TaskPriority))) return { ok: false, message: "Task priority is not supported." };
  if (!(value.status === undefined || TASK_STATUSES.includes(value.status as TaskStatus))) return { ok: false, message: "Task status is not supported." };
  if (!(value.clientId === undefined || nullableUuid(value.clientId))) return { ok: false, message: "Task client must be a UUID or null." };
  if (!(value.assigneeProfileId === undefined || nullableUuid(value.assigneeProfileId))) return { ok: false, message: "Task assignee must be a UUID or null." };
  if (!(value.dueOn === undefined || dateOnly(value.dueOn))) return { ok: false, message: "Task due date must be a real YYYY-MM-DD date or null." };
  return {
    ok: true,
    value: {
      ...(value.assigneeProfileId === undefined ? {} : { assigneeProfileId: value.assigneeProfileId as string | null }),
      ...(value.clientId === undefined ? {} : { clientId: value.clientId as string | null }),
      ...(value.dueOn === undefined ? {} : { dueOn: value.dueOn as string | null }),
      ...(value.notes === undefined ? {} : { notes: value.notes as string }),
      ...(value.priority === undefined ? {} : { priority: value.priority as TaskPriority }),
      ...(value.status === undefined ? {} : { status: value.status as TaskStatus }),
      ...(value.title === undefined ? {} : { title: (value.title as string).trim() }),
    },
  };
}

export function parseTask(value: unknown): OperatorTask | null {
  if (!record(value)) return null;
  const keys = [
    "assigneeProfileId", "clientId", "completedAt", "createdAt", "dueOn", "id",
    "notes", "priority", "status", "title", "updatedAt",
  ];
  if (Object.keys(value).sort().join(",") !== keys.sort().join(",")) return null;
  if (!isTaskUuid(value.id) || !nullableUuid(value.clientId) || !nullableUuid(value.assigneeProfileId)
      || !dateOnly(value.dueOn) || !title(value.title) || !notes(value.notes)
      || !TASK_PRIORITIES.includes(value.priority as TaskPriority)
      || !TASK_STATUSES.includes(value.status as TaskStatus)
      || !(value.completedAt === null || (typeof value.completedAt === "string" && Number.isFinite(Date.parse(value.completedAt))))
      || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
      || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) return null;
  if ((value.status === "pending") !== (value.completedAt === null)) return null;
  return Object.freeze(value as unknown as OperatorTask);
}
