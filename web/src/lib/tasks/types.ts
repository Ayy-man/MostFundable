export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export const TASK_STATUSES = ["pending", "completed"] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface OperatorTask {
  readonly assigneeProfileId: string | null;
  readonly clientId: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly dueOn: string | null;
  readonly id: string;
  readonly notes: string;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly title: string;
  readonly updatedAt: string;
}

export interface CreateTaskInput {
  readonly assigneeProfileId: string | null;
  readonly clientId: string | null;
  readonly dueOn: string | null;
  readonly notes: string;
  readonly priority: TaskPriority;
  readonly title: string;
}

export type UpdateTaskInput = Partial<CreateTaskInput> & {
  readonly status?: TaskStatus;
};

export type TaskErrorCode =
  | "failed"
  | "invalid_reference"
  | "not_found";

export class TaskError extends Error {
  readonly code: TaskErrorCode;

  constructor(code: TaskErrorCode) {
    super(code);
    this.code = code;
    this.name = "TaskError";
  }
}
