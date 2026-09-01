import { handleClientNoteItem } from "@/lib/operator/client-notes-http.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; noteId: string }> };

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const { id, noteId } = await context.params;
  return handleClientNoteItem(request, id, noteId);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { id, noteId } = await context.params;
  return handleClientNoteItem(request, id, noteId);
}
