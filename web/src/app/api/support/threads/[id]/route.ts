// One thread: read it, or move its status.
//
// The read returns `{ thread, messages, draft }` in a single response because
// the panel needs all three to render, and `draft` is `null` for a consumer by
// construction — migration 100 has no consumer read policy on `held_drafts`,
// and the repository does not even issue the query for a non-staff role. So a
// consumer's `null` is not this route filtering a value it holds.

import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

const privateHeaders = { "Cache-Control": "private, no-store" };

// Postgres `uuid` shape, not strict RFC-4122: seeded ids carry zero version/variant nibbles (GAPS G-3B-06/07).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const THREAD_STATUSES = ["open", "pending", "resolved"] as const;

type ThreadStatus = (typeof THREAD_STATUSES)[number];

// Next generates the equivalent global helper during build/typegen. Keeping
// this route-local fallback lets the repository's plain `tsc --noEmit` script
// run before the first build in a clean checkout.
type RouteContext<Path extends "/api/support/threads/[id]"> = Path extends string
  ? { params: Promise<{ id: string }> }
  : never;

function invalid() {
  return Response.json(
    { error: "SUPPORT_REQUEST_INVALID" },
    { status: 400, headers: privateHeaders },
  );
}

function isThreadStatus(value: unknown): value is ThreadStatus {
  return typeof value === "string" && (THREAD_STATUSES as readonly string[]).includes(value);
}

export async function GET(_request: Request, context: RouteContext<"/api/support/threads/[id]">) {
  if (!featureFlag("FEATURE_SUPPORT")) {
    return new Response(null, { status: 404, headers: privateHeaders });
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid();

  const [{ getSession }, { getThread, toHttpResponse }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/support"),
  ]);

  const session = await getSession();
  if (!session) {
    return Response.json(
      { error: "SUPPORT_ACTOR_REQUIRED" },
      { status: 401, headers: privateHeaders },
    );
  }

  try {
    const payload = await getThread(id, { profileId: session.id, role: session.role });
    // A thread the viewer cannot see and a thread that does not exist answer
    // identically, so the response cannot be used to probe for thread ids
    // belonging to another tenant.
    if (payload === null) {
      return Response.json(
        { error: "SUPPORT_DRAFT_NOT_FOUND" },
        { status: 404, headers: privateHeaders },
      );
    }
    return Response.json(payload, { status: 200, headers: privateHeaders });
  } catch (error) {
    const { status, body } = toHttpResponse(error);
    return Response.json(body, { status, headers: privateHeaders });
  }
}

export async function PATCH(request: Request, context: RouteContext<"/api/support/threads/[id]">) {
  if (!featureFlag("FEATURE_SUPPORT")) {
    return new Response(null, { status: 404, headers: privateHeaders });
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid();

  const [{ getSession }, { assertTenantWriteAllowed }, { tenantErrorResponse }, { setThreadStatus, toHttpResponse }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/tenancy/wall"),
    import("@/lib/tenancy/errors"),
    import("@/lib/support"),
  ]);

  const session = await getSession();
  if (!session) {
    return Response.json(
      { error: "SUPPORT_ACTOR_REQUIRED" },
      { status: 401, headers: privateHeaders },
    );
  }
  try { await assertTenantWriteAllowed(session); } catch (error) { return tenantErrorResponse(error); }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return invalid();
  }
  if (payload === null || typeof payload !== "object") return invalid();
  const { status: requested } = payload as Record<string, unknown>;
  if (!isThreadStatus(requested)) return invalid();

  try {
    const thread = await setThreadStatus(id, requested, {
      profileId: session.id,
      role: session.role,
    });
    return Response.json({ thread }, { status: 200, headers: privateHeaders });
  } catch (error) {
    const { status, body } = toHttpResponse(error);
    return Response.json(body, { status, headers: privateHeaders });
  }
}
