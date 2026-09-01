import { handleTaskCollection } from "@/lib/tasks/handler";

export async function GET(request: Request): Promise<Response> {
  return handleTaskCollection(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleTaskCollection(request);
}
