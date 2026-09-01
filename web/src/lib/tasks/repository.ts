import "server-only";

import { TaskError, type CreateTaskInput, type OperatorTask, type UpdateTaskInput } from "./types.ts";

const COLUMNS = "id,client_id,title,notes,priority,status,due_on,assignee_profile_id,completed_at,created_at,updated_at";

interface DbError { readonly code?: string; readonly message?: string }
interface Result<T> { readonly data: T | null; readonly error: DbError | null }
interface Query<T> extends PromiseLike<Result<T[]>> {
  eq(column: string, value: unknown): Query<T>;
  is(column: string, value: null): Query<T>;
  limit(value: number): Query<T>;
  maybeSingle(): PromiseLike<Result<T>>;
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): Query<T>;
  select(columns: string): Query<T>;
}
interface Table<T> {
  insert(value: Record<string, unknown>): Query<T>;
  select(columns: string): Query<T>;
  update(value: Record<string, unknown>): Query<T>;
}
interface Database { from<T>(table: "operator_tasks"): Table<T> }

interface TaskRow {
  readonly assignee_profile_id: string | null;
  readonly client_id: string | null;
  readonly completed_at: string | null;
  readonly created_at: string;
  readonly due_on: string | null;
  readonly id: string;
  readonly notes: string;
  readonly priority: OperatorTask["priority"];
  readonly status: OperatorTask["status"];
  readonly title: string;
  readonly updated_at: string;
}

async function defaultDatabase(): Promise<Database> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as Database;
}

function mapped(row: TaskRow): OperatorTask {
  return Object.freeze({
    assigneeProfileId: row.assignee_profile_id,
    clientId: row.client_id,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    dueOn: row.due_on,
    id: row.id,
    notes: row.notes,
    priority: row.priority,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
  });
}

function failure(error: DbError | null): TaskError {
  if (error?.code === "23503" || error?.message?.startsWith("TASK_")) return new TaskError("invalid_reference");
  return new TaskError("failed");
}

export interface TaskRepository {
  create(orgId: string, actorId: string, input: CreateTaskInput): Promise<OperatorTask>;
  list(orgId: string): Promise<readonly OperatorTask[]>;
  remove(orgId: string, taskId: string, actorId: string): Promise<void>;
  update(orgId: string, taskId: string, input: UpdateTaskInput): Promise<OperatorTask>;
}

export function createTaskRepository(
  createDatabase: () => Database | Promise<Database> = defaultDatabase,
): TaskRepository {
  let database: Promise<Database> | null = null;
  const db = () => (database ??= Promise.resolve(createDatabase()));

  return {
    async list(orgId) {
      const { data, error } = await (await db()).from<TaskRow>("operator_tasks")
        .select(COLUMNS)
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("due_on", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (error || !Array.isArray(data)) throw failure(error);
      return Object.freeze(data.map(mapped));
    },

    async create(orgId, actorId, input) {
      const { data, error } = await (await db()).from<TaskRow>("operator_tasks")
        .insert({
          assignee_profile_id: input.assigneeProfileId,
          client_id: input.clientId,
          created_by: actorId,
          due_on: input.dueOn,
          notes: input.notes,
          org_id: orgId,
          priority: input.priority,
          title: input.title,
        })
        .select(COLUMNS)
        .maybeSingle();
      if (error) throw failure(error);
      if (data === null) throw new TaskError("failed");
      return mapped(data);
    },

    async update(orgId, taskId, input) {
      const values: Record<string, unknown> = {
        ...(input.assigneeProfileId === undefined ? {} : { assignee_profile_id: input.assigneeProfileId }),
        ...(input.clientId === undefined ? {} : { client_id: input.clientId }),
        ...(input.dueOn === undefined ? {} : { due_on: input.dueOn }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.status === undefined ? {} : {
          completed_at: input.status === "completed" ? new Date().toISOString() : null,
          status: input.status,
        }),
      };
      const { data, error } = await (await db()).from<TaskRow>("operator_tasks")
        .update(values)
        .eq("org_id", orgId)
        .eq("id", taskId)
        .is("deleted_at", null)
        .select(COLUMNS)
        .maybeSingle();
      if (error) throw failure(error);
      if (data === null) throw new TaskError("not_found");
      return mapped(data);
    },

    async remove(orgId, taskId, actorId) {
      const { data, error } = await (await db()).from<TaskRow>("operator_tasks")
        .update({ deleted_at: new Date().toISOString(), deleted_by: actorId })
        .eq("org_id", orgId)
        .eq("id", taskId)
        .is("deleted_at", null)
        .select("id")
        .maybeSingle();
      if (error) throw failure(error);
      if (data === null) throw new TaskError("not_found");
    },
  };
}
