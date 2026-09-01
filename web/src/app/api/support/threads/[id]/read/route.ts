// Where this person's attention stopped in one thread.
//
// `POST` is the only export, and it writes one timestamp on one row of
// `support_thread_reads`. There is no `GET`: the watermark and the unread count
// come back with the thread list and with the thread itself, because a badge
// that fetched its own number would show a different one from the list it sits
// in for as long as the second request took.
//
// The count in the response is the database's, derived from the messages by
// `support_list_thread_digest`. Nothing here counts anything, and the request
// body cannot carry a count — a client that could assert its own unread number
// could assert zero.

import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

const privateHeaders = { "Cache-Control": "private, no-store" };

// Postgres `uuid` shape, not strict RFC-4122: seeded ids carry zero version/variant nibbles (GAPS G-3B-06/07).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fields the schema derives and a client may not assert, refused rather than
// dropped for the same reason the messages route refuses its four: a client that
// believes it chose the count has misread the model.
const DERIVED_FIELDS = ["unreadCount", "profileId", "updatedAt", "counterpartReadAt"] as const;

type RouteContext<Path extends "/api/support/threads/[id]/read"> = Path extends string
  ? { params: Promise<{ id: string }> }
  : never;

function invalid() {
  return Response.json(
    { error: "SUPPORT_REQUEST_INVALID" },
    { status: 400, headers: privateHeaders },
  );
}

/**
 * Accept an ISO instant, or nothing.
 *
 * A missing `lastReadAt` means "now", which is what an open pane is actually
 * saying. A string that is not an instant is refused rather than coerced,
 * because `new Date("yesterday")` is `Invalid Date` and passing that on would
 * reach the RPC as null and mean something different from what was asked.
 */
function readInstant(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: new Date(parsed).toISOString() };
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/support/threads/[id]/read">,
) {
  if (!featureFlag("FEATURE_SUPPORT")) {
    return new Response(null, { status: 404, headers: privateHeaders });
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return invalid();

  const [{ getSession }, { markThreadRead, toHttpResponse }] = await Promise.all([
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

  // No tenancy wall here, unlike every other write in this folder. A deactivated
  // org must stop producing new client-facing records; it must not stop the
  // people inside it from marking what they have already read, and refusing this
  // would leave a permanently unread badge on a workspace nobody can act in.
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    // An empty body is the ordinary case: "I opened this, now".
    payload = {};
  }
  if (payload === null || typeof payload !== "object") return invalid();
  const fields = payload as Record<string, unknown>;

  for (const name of DERIVED_FIELDS) {
    if (name in fields) return invalid();
  }

  const lastReadAt = readInstant(fields.lastReadAt);
  if (!lastReadAt.ok) return invalid();

  try {
    const read = await markThreadRead(
      id,
      { profileId: session.id, role: session.role },
      lastReadAt.value,
    );
    return Response.json({ read }, { status: 200, headers: privateHeaders });
  } catch (error) {
    const { status, body } = toHttpResponse(error);
    return Response.json(body, { status, headers: privateHeaders });
  }
}
