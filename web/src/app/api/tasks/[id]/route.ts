import { handleTaskItem } from "@/lib/tasks/handler";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context): Promise<Response> {
  return handleTaskItem(request, (await context.params).id);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return handleTaskItem(request, (await context.params).id);
}
