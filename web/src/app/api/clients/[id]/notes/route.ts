import { handleClientNotesCollection } from "@/lib/operator/client-notes-http.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  return handleClientNotesCollection(request, (await context.params).id);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return handleClientNotesCollection(request, (await context.params).id);
}
