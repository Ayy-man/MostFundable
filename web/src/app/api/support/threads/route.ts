// The support thread collection: bootstrap on GET, open a thread on POST.
//
// Every route in this folder imports from `@/lib/support` and nowhere deeper.
// The barrel exports seven functions and no repository, so a route physically
// cannot reach the send RPC except through `sendMessage`, which is the whole
// no-auto-send claim (SUPP-01, DEC-D10) expressed as an import graph rather
// than a convention. `web/scripts/verify-no-auto-send.mjs` checks it holds.

import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

const privateHeaders = { "Cache-Control": "private, no-store" };

// Postgres `uuid` shape, not strict RFC-4122: seeded ids carry zero version/variant nibbles (GAPS G-3B-06/07).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const THREAD_KINDS = ["team_chat", "platform_support"] as const;
const SUBJECT_MIN = 1;
const SUBJECT_MAX = 160;

type ThreadKind = (typeof THREAD_KINDS)[number];

function invalid() {
  return Response.json(
    { error: "SUPPORT_REQUEST_INVALID" },
    { status: 400, headers: privateHeaders },
  );
}

function isThreadKind(value: unknown): value is ThreadKind {
  return typeof value === "string" && (THREAD_KINDS as readonly string[]).includes(value);
}

function readOptionalUuid(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === "string" && UUID_PATTERN.test(value)) return { ok: true, value };
  return { ok: false };
}

/**
 * The client's bootstrap. It answers `200` in every reachable case.
 *
 * A disabled flag, a missing session, and a failure behind the service all
 * produce an empty list rather than an error, because this is the call the
 * support panel makes on mount: an error here would put a broken widget on a
 * page that is otherwise fine. `enabled` tells the panel whether to render at
 * all, and the writing routes below are the ones that refuse properly.
 */
export async function GET() {
  let enabled = false;
  try {
    enabled = featureFlag("FEATURE_SUPPORT");
  } catch {
    enabled = false;
  }
  if (!enabled) {
    return Response.json({ enabled: false, threads: [] }, { status: 200, headers: privateHeaders });
  }

  try {
    const [{ getSession }, { listThreads }] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/support"),
    ]);
    const session = await getSession();
    if (!session) {
      return Response.json(
        { enabled: true, threads: [] },
        { status: 200, headers: privateHeaders },
      );
    }
    const threads = await listThreads({ profileId: session.id, role: session.role });
    return Response.json({ enabled: true, threads }, { status: 200, headers: privateHeaders });
  } catch {
    return Response.json({ enabled: true, threads: [] }, { status: 200, headers: privateHeaders });
  }
}

export async function POST(request: Request) {
  if (!featureFlag("FEATURE_SUPPORT")) {
    return new Response(null, { status: 404, headers: privateHeaders });
  }

  const [{ getSession }, { assertTenantWriteAllowed }, { tenantErrorResponse }, { openThread, toHttpResponse }] = await Promise.all([
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
  const body = payload as Record<string, unknown>;

  if (!isThreadKind(body.kind)) return invalid();

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (subject.length < SUBJECT_MIN || subject.length > SUBJECT_MAX) return invalid();

  const clientId = readOptionalUuid(body.clientId);
  if (!clientId.ok) return invalid();

  // An operator's org comes from their session, never from the request, so one
  // tenant cannot name another tenant's org id. A platform admin has no org of
  // their own and must say which org the thread belongs to; migration 101
  // re-checks that they are allowed to either way.
  const requestedOrgId = readOptionalUuid(body.orgId);
  if (!requestedOrgId.ok) return invalid();
  const orgId = session.orgId ?? requestedOrgId.value;
  if (orgId === null) return invalid();

  try {
    const thread = await openThread(
      { kind: body.kind, orgId, clientId: clientId.value, subject },
      { profileId: session.id, role: session.role },
    );
    return Response.json({ thread }, { status: 201, headers: privateHeaders });
  } catch (error) {
    const { status, body: failure } = toHttpResponse(error);
    return Response.json(failure, { status, headers: privateHeaders });
  }
}
