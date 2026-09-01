// The one HTTP path that puts a message in a thread.
//
// `POST` is the only export. There is no `GET` (messages come back with the
// thread), no `PUT`, and no batch form, because every extra verb here would be
// another shape that plan 13-06's scanner has to prove cannot fire without a
// person behind it. One verb, one caller, one audited RPC underneath.

import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

const privateHeaders = { "Cache-Control": "private, no-store" };

// Postgres `uuid` shape, not strict RFC-4122: seeded ids carry zero version/variant nibbles (GAPS G-3B-06/07).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BODY_MIN = 1;
const BODY_MAX = 4000;

// The two values migration 385's enum carries. A third string is refused here
// and would be refused again by the enum cast, which is the arrangement worth
// having: a typo in a client is a 400 rather than a 500 from Postgres.
const VISIBILITIES = ["participants", "internal"] as const;

type Visibility = (typeof VISIBILITIES)[number];

// Fields the schema derives and a client may not assert. Sending one is a
// mistake worth naming rather than dropping quietly, because a client that
// believes it chose the author kind has misread the model: migration 100's
// trigger checks the author kind against the sender's real role, and the RPC
// sets the origin from whether a draft was cited.
const DERIVED_FIELDS = ["authorKind", "authorProfileId", "origin", "sentAt"] as const;

type RouteContext<Path extends "/api/support/threads/[id]/messages"> = Path extends string
  ? { params: Promise<{ id: string }> }
  : never;

function invalid() {
  return Response.json(
    { error: "SUPPORT_REQUEST_INVALID" },
    { status: 400, headers: privateHeaders },
  );
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/support/threads/[id]/messages">,
) {
  if (!featureFlag("FEATURE_SUPPORT")) {
    return new Response(null, { status: 404, headers: privateHeaders });
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid();

  const [{ getSession }, { assertTenantWriteAllowed }, { tenantErrorResponse }, { sendMessage, toHttpResponse }] = await Promise.all([
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
  const fields = payload as Record<string, unknown>;

  for (const name of DERIVED_FIELDS) {
    if (name in fields) return invalid();
  }

  const body = typeof fields.body === "string" ? fields.body.trim() : "";
  if (body.length < BODY_MIN || body.length > BODY_MAX) return invalid();

  // Absent means client-facing. Whether this actor may write a note at all is
  // migration 385's question, not this route's: the RPC refuses a consumer by
  // name and a check constraint refuses the row underneath it, so re-deriving
  // the rule from `session.role` here would be a third definition to keep in
  // step with the other two.
  let visibility: Visibility | undefined;
  if (fields.visibility !== undefined && fields.visibility !== null) {
    if (
      typeof fields.visibility !== "string"
      || !(VISIBILITIES as readonly string[]).includes(fields.visibility)
    ) {
      return invalid();
    }
    visibility = fields.visibility as Visibility;
  }

  let draftId: string | undefined;
  if (fields.draftId !== undefined && fields.draftId !== null) {
    if (typeof fields.draftId !== "string" || !UUID_PATTERN.test(fields.draftId)) return invalid();
    draftId = fields.draftId;
  }

  try {
    // The author kind is derived inside the service from `session.role`, and
    // the actor is the session profile. Nothing in the request body reaches
    // either one, so a client cannot post as somebody else even if migration
    // 100's trigger were removed.
    const message = await sendMessage(
      id,
      { profileId: session.id, role: session.role },
      body,
      draftId,
      visibility,
    );
    return Response.json({ message }, { status: 201, headers: privateHeaders });
  } catch (error) {
    const { status, body: failure } = toHttpResponse(error);
    return Response.json(failure, { status, headers: privateHeaders });
  }
}
