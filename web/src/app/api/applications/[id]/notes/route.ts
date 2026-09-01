import { featureFlag } from "@/lib/env";
import {
  disabledResponse,
  failureResponse,
  hasOnlyKeys,
  invalidRequest,
  isRecord,
  isUuid,
  jsonResponse,
  notFoundResponse,
  roleForbidden,
  sessionRequired,
} from "@/lib/applications/http";
import {
  ATTESTATION_REQUIRED_CODE,
  type ApplicationNoteAuthorKind,
} from "@/lib/applications/types";

type RouteContext<Path extends "/api/applications/[id]/notes"> =
  Path extends string ? { params: Promise<{ id: string }> } : never;

const NOTE_KEYS = ["body", "attested"] as const;

/**
 * The author's kind is the session's, never the body's. Accepting it would let
 * an operator post as the consumer, or attest on someone else's behalf
 * (T-11-24).
 */
function authorKind(role: string): ApplicationNoteAuthorKind | null {
  if (role === "consumer") return "consumer";
  if (role === "operator_member" || role === "platform_admin") return "operator";
  return null;
}

export async function GET(
  _request: Request,
  context: RouteContext<"/api/applications/[id]/notes">,
) {
  if (!featureFlag("FEATURE_APPLICATIONS")) return disabledResponse();

  const { id } = await context.params;
  if (!isUuid(id)) return invalidRequest("The application id must be a UUID.");

  try {
    const [{ getSession }, { clientReachable }, { listNotes, readApplication }] =
      await Promise.all([
        import("@/lib/auth/session"),
        import("@/lib/applications/access"),
        import("@/lib/applications"),
      ]);

    const session = await getSession();
    if (!session) return sessionRequired();

    const application = await readApplication(id);
    if (application === null) return notFoundResponse();
    if (!(await clientReachable(session, application.clientId))) {
      return notFoundResponse();
    }

    // One thread, both sides, oldest first — the repository orders by
    // `created_at` ascending so the conversation reads in the order it happened.
    return jsonResponse({ notes: await listNotes(id) }, 200);
  } catch (error) {
    return failureResponse(error);
  }
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/applications/[id]/notes">,
) {
  if (!featureFlag("FEATURE_APPLICATIONS")) return disabledResponse();

  const { id } = await context.params;
  if (!isUuid(id)) return invalidRequest("The application id must be a UUID.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest("The request body must be valid JSON.");
  }
  if (!isRecord(body) || !hasOnlyKeys(body, NOTE_KEYS)) {
    return invalidRequest("The request body contains unsupported fields.");
  }
  if (
    typeof body.body !== "string" ||
    body.body.trim().length < 1 ||
    body.body.length > 4000
  ) {
    return invalidRequest("A note must be between 1 and 4000 characters.");
  }
  if (body.attested !== undefined && typeof body.attested !== "boolean") {
    return invalidRequest("attested must be true or false.");
  }
  const attested = body.attested === true;
  const text = body.body;

  try {
    const [
      { getSession },
      { assertTenantWriteAllowed },
      { clientReachable },
      { addNote, readApplication },
    ] = await Promise.all([
      import("@/lib/auth/session"),
      import("@/lib/tenancy/wall"),
      import("@/lib/applications/access"),
      import("@/lib/applications"),
    ]);

    const session = await getSession();
    if (!session) return sessionRequired();

    const kind = authorKind(session.role);
    if (kind === null) return roleForbidden();
    await assertTenantWriteAllowed(session);

    const application = await readApplication(id);
    if (application === null) return notFoundResponse();
    if (!(await clientReachable(session, application.clientId))) {
      return notFoundResponse();
    }

    // `application_notes_operator_attestation` rejects both directions, and so
    // does this. Deleting these two branches would not make either request
    // succeed — the constraint would answer with a 23514 instead of a sentence
    // that says which box is missing.
    if (kind === "operator" && !attested) {
      return jsonResponse(
        {
          error: ATTESTATION_REQUIRED_CODE,
          message: "An operator note must carry its attestation.",
        },
        400,
      );
    }
    if (kind === "consumer" && attested) {
      return invalidRequest("A consumer note does not carry an attestation.");
    }

    const note = await addNote({
      applicationId: id,
      // Both come from the session. Neither is readable from the body.
      authorProfileId: session.id,
      authorKind: kind,
      body: text,
      attested,
    });

    return jsonResponse({ note }, 201);
  } catch (error) {
    return failureResponse(error);
  }
}
