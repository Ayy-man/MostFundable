import "server-only";

import type { SessionProfile } from "@/lib/auth/session";
import { TaskError, type OperatorTask } from "./types.ts";
import { isTaskUuid, parseCreateTask, parseUpdateTask } from "./validate.ts";
import type { TaskRepository } from "./repository.ts";

type OrgSession = SessionProfile & { orgId: string };
const headers = { "Cache-Control": "private, no-store" };

export interface TaskHandlerDependencies {
  assertWrite(session: OrgSession): Promise<void>;
  readonly repository: TaskRepository;
  requireOperator(): Promise<OrgSession>;
}

async function defaults(): Promise<TaskHandlerDependencies> {
  const [{ requireOrgMember }, { assertTenantWriteAllowed }, { createTaskRepository }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/tenancy/wall"),
    import("./repository.ts"),
  ]);
  return { assertWrite: assertTenantWriteAllowed, repository: createTaskRepository(), requireOperator: requireOrgMember };
}

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers });
}

function accessStatus(error: unknown): 401 | 402 | 403 | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 402 || status === 403 ? status : null;
}

function failed(error: unknown): Response {
  const access = accessStatus(error);
  if (access !== null) {
    return response({ error: { code: access === 401 ? "session_required" : access === 402 ? "org_deactivated" : "role_forbidden", message: access === 401 ? "Sign in to use tasks." : access === 402 ? "This workspace is deactivated." : "This account cannot use operator tasks." } }, access);
  }
  if (error instanceof TaskError) {
    if (error.code === "not_found") return response({ error: { code: "task_not_found", message: "The task was not found." } }, 404);
    if (error.code === "invalid_reference") return response({ error: { code: "task_reference_invalid", message: "The selected client or assignee is unavailable." } }, 409);
  }
  return response({ error: { code: "tasks_unavailable", message: "Tasks are temporarily unavailable." } }, 500);
}

async function json(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return Symbol.for("invalid-json"); }
}

export async function handleTaskCollection(
  request: Request,
  supplied?: TaskHandlerDependencies,
): Promise<Response> {
  const dependencies = supplied ?? await defaults();
  try {
    const session = await dependencies.requireOperator();
    if (request.method === "GET") {
      if ([...new URL(request.url).searchParams.keys()].length > 0) return response({ error: { code: "invalid_request", message: "Task filters are not supported." } }, 400);
      return response({ tasks: await dependencies.repository.list(session.orgId) });
    }
    if (request.method !== "POST") return response({ error: { code: "method_not_allowed", message: "The task method is not supported." } }, 405);
    await dependencies.assertWrite(session);
    const parsed = parseCreateTask(await json(request));
    if (!parsed.ok) return response({ error: { code: "invalid_request", message: parsed.message } }, 400);
    const task = await dependencies.repository.create(session.orgId, session.id, parsed.value);
    return response({ task }, 201);
  } catch (error) {
    return failed(error);
  }
}

export async function handleTaskItem(
  request: Request,
  taskId: string,
  supplied?: TaskHandlerDependencies,
): Promise<Response> {
  if (!isTaskUuid(taskId)) return response({ error: { code: "invalid_request", message: "Task id must be a UUID." } }, 400);
  const dependencies = supplied ?? await defaults();
  try {
    const session = await dependencies.requireOperator();
    await dependencies.assertWrite(session);
    if (request.method === "DELETE") {
      await dependencies.repository.remove(session.orgId, taskId, session.id);
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "PATCH") return response({ error: { code: "method_not_allowed", message: "The task method is not supported." } }, 405);
    const parsed = parseUpdateTask(await json(request));
    if (!parsed.ok) return response({ error: { code: "invalid_request", message: parsed.message } }, 400);
    const task: OperatorTask = await dependencies.repository.update(session.orgId, taskId, parsed.value);
    return response({ task });
  } catch (error) {
    return failed(error);
  }
}
