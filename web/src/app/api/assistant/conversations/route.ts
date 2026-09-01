// The assistant's conversation collection: list on GET, open one on POST.
//
// Every route in this folder imports from `@/lib/assistant` and nowhere deeper.
// The barrel exports five operations and no repository, so a route cannot write
// an assistant turn except through `answerTurn` — which means a turn always has
// a question in front of it.
//
// Nothing here can reach the support tables. `@/lib/assistant` does not import
// `@/lib/support`, migration 387's functions do not name `support_messages`, and
// `supabase/tests/387_assistant_conversations.test.sql` reads that back out of
// the catalog. An assistant answer cannot become a message to a client.

import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

const privateHeaders = { "Cache-Control": "private, no-store" };

const SCOPES = ["operator", "admin"] as const;

type Scope = (typeof SCOPES)[number];

function invalid() {
  return Response.json(
    { error: "ASSISTANT_REQUEST_INVALID" },
    { status: 400, headers: privateHeaders },
  );
}

function isScope(value: unknown): value is Scope {
  return typeof value === "string" && (SCOPES as readonly string[]).includes(value);
}

/**
 * The workspace's bootstrap. It answers `200` in every reachable case.
 *
 * A disabled flag, a missing session and a failure behind the service all
 * produce an empty list rather than an error, because this is the call the
 * history rail makes on mount: an error here would put a broken panel on a page
 * that is otherwise fine. `enabled` tells the panel whether to render at all,
 * and the writing routes below are the ones that refuse properly.
 */
export async function GET() {
  let enabled = false;
  try {
    enabled = featureFlag("FEATURE_KB");
  } catch {
    enabled = false;
  }
  if (!enabled) {
    return Response.json(
      { enabled: false, conversations: [] },
      { status: 200, headers: privateHeaders },
    );
  }

  try {
    const [{ getSession }, { listConversations }] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/assistant"),
    ]);
    const session = await getSession();
    if (!session) {
      return Response.json(
        { enabled: true, conversations: [] },
        { status: 200, headers: privateHeaders },
      );
    }
    const conversations = await listConversations(session);
    return Response.json(
      { enabled: true, conversations },
      { status: 200, headers: privateHeaders },
    );
  } catch {
    return Response.json(
      { enabled: true, conversations: [] },
      { status: 200, headers: privateHeaders },
    );
  }
}

export async function POST(request: Request) {
  if (!featureFlag("FEATURE_KB")) {
    return new Response(null, { status: 404, headers: privateHeaders });
  }

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

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return invalid();
  }
  if (payload === null || typeof payload !== "object") return invalid();
  const { scope } = payload as Record<string, unknown>;
  if (!isScope(scope)) return invalid();

  try {
    // Whether this actor may hold that scope is migration 387's question. The
    // org is taken from their own profile inside the RPC and is never an
    // argument, so a caller cannot open a conversation inside another tenant.
    const conversation = await assistant.openConversation(scope, session);
    return Response.json({ conversation }, { status: 201, headers: privateHeaders });
  } catch (error) {
    const failure = assistant.toAssistantError(error);
    return Response.json(
      { error: failure.code },
      { status: failure.status, headers: privateHeaders },
    );
  }
}
