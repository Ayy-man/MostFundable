// One conversation: read it with its turns, or delete it.
//
// `GET` returns `{ conversation, turns }` in a single response because the
// workspace needs both to render, and a conversation the viewer cannot see
// answers exactly as one that does not exist — so the response cannot be used to
// probe for ids belonging to somebody else's workspace.

import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

const privateHeaders = { "Cache-Control": "private, no-store" };

// Postgres `uuid` shape, not strict RFC-4122: seeded ids carry zero version/variant nibbles (GAPS G-3B-06/07).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext<Path extends "/api/assistant/conversations/[id]"> = Path extends string
  ? { params: Promise<{ id: string }> }
  : never;

function invalid() {
  return Response.json(
    { error: "ASSISTANT_REQUEST_INVALID" },
    { status: 400, headers: privateHeaders },
  );
}

function missing() {
  return Response.json(
    { error: "ASSISTANT_NOT_FOUND" },
    { status: 404, headers: privateHeaders },
  );
}

export async function GET(
  _request: Request,
  context: RouteContext<"/api/assistant/conversations/[id]">,
) {
  if (!featureFlag("FEATURE_KB")) {
    return new Response(null, { status: 404, headers: privateHeaders });
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid();

  const [{ getSession }, assistant] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/assistant"),
  ]);

  const session = await getSession();
  if (!session) {
    return Response.json(
      { error: "ASSISTANT_ACTOR_REQUIRED" },
      { status: 401, headers: privateHeaders },
    );
  }

  try {
    const payload = await assistant.readConversation(id, session);
    if (payload === null) return missing();
    return Response.json(payload, { status: 200, headers: privateHeaders });
  } catch (error) {
    const failure = assistant.toAssistantError(error);
    return Response.json(
      { error: failure.code },
      { status: failure.status, headers: privateHeaders },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/assistant/conversations/[id]">,
) {
  if (!featureFlag("FEATURE_KB")) {
    return new Response(null, { status: 404, headers: privateHeaders });
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid();

  const [{ getSession }, { assertTenantWriteAllowed }, { tenantErrorResponse }, assistant] =
    await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/tenancy/wall"),
      import("@/lib/tenancy/errors"),
      import("@/lib/assistant"),
    ]);

  const session = await getSession();
  if (!session) {
    return Response.json(
      { error: "ASSISTANT_ACTOR_REQUIRED" },
      { status: 401, headers: privateHeaders },
    );
  }
  try {
    await assertTenantWriteAllowed(session);
  } catch (error) {
    return tenantErrorResponse(error);
  }

  try {
    // The delete is a hard one and the turns go with it. This is a person's own
    // history and "delete" has to mean it: a soft-deleted row still holding the
    // questions they asked would be the wrong answer to the only reason anybody
    // presses this.
    await assistant.deleteConversation(id, session);
    return new Response(null, { status: 204, headers: privateHeaders });
  } catch (error) {
    const failure = assistant.toAssistantError(error);
    return Response.json(
      { error: failure.code },
      { status: failure.status, headers: privateHeaders },
    );
  }
}
