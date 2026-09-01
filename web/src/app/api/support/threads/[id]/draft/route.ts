// Generate a draft, or throw one away. Neither verb sends anything.
//
// There is deliberately no `GET`: a draft is only ever read as part of the
// thread payload, which is the one place the staff-only read policy is already
// enforced, and a second read path would be a second place to get that wrong.
//
// `POST` returns a stored draft whose status is `approved` or `draft`. An
// `approved` draft is a draft that cleared its gates and nothing more — no
// timer, no queue, no `after()` picks it up. Turning it into a message takes an
// explicit `POST` to `../messages` citing the draft id (SUPP-01, DEC-D10).

import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

const privateHeaders = { "Cache-Control": "private, no-store" };

// Postgres `uuid` shape, not strict RFC-4122: seeded ids carry zero version/variant nibbles (GAPS G-3B-06/07).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext<Path extends "/api/support/threads/[id]/draft"> = Path extends string
  ? { params: Promise<{ id: string }> }
  : never;

function invalid() {
  return Response.json(
    { error: "SUPPORT_REQUEST_INVALID" },
    { status: 400, headers: privateHeaders },
  );
}

function accessResponse(error: unknown): Response | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const { status } = error as { status: unknown };
  if (status === 401) {
    return Response.json(
      { error: "SUPPORT_ACTOR_REQUIRED" },
      { status: 401, headers: privateHeaders },
    );
  }
  if (status === 403) {
    return Response.json({ error: "SUPPORT_FORBIDDEN" }, { status: 403, headers: privateHeaders });
  }
  if (status === 402) return Response.json({ error: "ORG_DEACTIVATED" }, { status: 402, headers: privateHeaders });
  return null;
}

export async function POST(
  _request: Request,
  context: RouteContext<"/api/support/threads/[id]/draft">,
) {
  if (!featureFlag("FEATURE_SUPPORT")) {
    return new Response(null, { status: 404, headers: privateHeaders });
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid();

  const [{ requireRole }, { assertTenantWriteAllowed }, { generateDraft, toHttpResponse }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/tenancy/wall"),
    import("@/lib/support"),
  ]);

  try {
    const session = await requireRole("operator_member", "platform_admin");
    await assertTenantWriteAllowed(session);
    const draft = await generateDraft(id, { profileId: session.id, role: session.role });
    return Response.json({ draft }, { status: 201, headers: privateHeaders });
  } catch (error) {
    const denied = accessResponse(error);
    if (denied) return denied;
    const { status, body } = toHttpResponse(error);
    return Response.json(body, { status, headers: privateHeaders });
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/support/threads/[id]/draft">,
) {
  if (!featureFlag("FEATURE_SUPPORT")) {
    return new Response(null, { status: 404, headers: privateHeaders });
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid();

  const [{ requireRole }, { assertTenantWriteAllowed }, { discardDraft, getThread, toHttpResponse }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/tenancy/wall"),
    import("@/lib/support"),
  ]);

  try {
    const session = await requireRole("operator_member", "platform_admin");
    await assertTenantWriteAllowed(session);
    const viewer = { profileId: session.id, role: session.role };

    // The draft id comes from the thread the caller named, never from the
    // request body. A body-supplied id would let a caller aim this at a draft
    // on some other thread and lean on the RPC alone to catch it; reading it
    // back here means the only draft this route can discard is the one the
    // caller is already allowed to see.
    const payload = await getThread(id, viewer);
    if (payload === null || payload.draft === null) {
      return Response.json(
        { error: "SUPPORT_DRAFT_NOT_FOUND" },
        { status: 404, headers: privateHeaders },
      );
    }

    const draft = await discardDraft(payload.draft.id, viewer);
    return Response.json({ draft }, { status: 200, headers: privateHeaders });
  } catch (error) {
    const denied = accessResponse(error);
    if (denied) return denied;
    const { status, body } = toHttpResponse(error);
    return Response.json(body, { status, headers: privateHeaders });
  }
}
