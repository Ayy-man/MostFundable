// Ask one question, and watch the server work.
//
// The response is NDJSON, not JSON: `{"stage":…}` lines as the pipeline moves,
// then one `{"answer":…}` or `{"error":…}`. There is no token streaming and
// there must not be — the pipeline runs candidate → compliance scan → citation
// check → supervisor and only then has an answer, so streaming tokens would put
// un-supervised text on somebody's screen and then take it back, which is the
// exact failure the supervisor gate exists to prevent.
//
// Every stage line is the consequence of real work finishing. `retrieving` is
// written when the workspace read begins, `drafting` when that read has returned
// and the candidate call is dispatched, `reviewing` when the candidate has come
// back and cleared the local scans. Nothing here is on a timer, and a candidate
// the scans reject produces no `reviewing` line at all.
//
// The status is always 200 once the stream opens, because a stream cannot change
// its status line after the first byte. The refusal rides in the last object
// instead, which is why `{"error":…}` is part of the format rather than an
// afterthought. Refusals that happen before the stream opens — a bad payload, no
// session, a deactivated org — are ordinary JSON with an ordinary status.

import { featureFlag } from "@/lib/env";

export const runtime = "nodejs";

const privateHeaders = { "Cache-Control": "private, no-store" };

// Postgres `uuid` shape, not strict RFC-4122: seeded ids carry zero version/variant nibbles (GAPS G-3B-06/07).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext<Path extends "/api/assistant/conversations/[id]/turns"> = Path extends string
  ? { params: Promise<{ id: string }> }
  : never;

function invalid() {
  return Response.json(
    { error: "ASSISTANT_REQUEST_INVALID" },
    { status: 400, headers: privateHeaders },
  );
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/assistant/conversations/[id]/turns">,
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

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return invalid();
  }
  if (payload === null || typeof payload !== "object") return invalid();
  const { question } = payload as Record<string, unknown>;
  if (typeof question !== "string") return invalid();
  const trimmed = question.trim();
  if (
    trimmed.length < assistant.QUESTION_MIN_LENGTH
    || trimmed.length > assistant.QUESTION_MAX_LENGTH
  ) {
    return invalid();
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const writer = assistant.createStageStreamWriter(
        (line) => {
          controller.enqueue(encoder.encode(line));
        },
        () => {
          controller.close();
        },
      );

      // The promise is not awaited here on purpose: `start` returning is what
      // lets the response head go out, and the stage lines are worth nothing if
      // the client cannot see them until the answer is ready.
      void assistant
        .answerTurn(id, trimmed, session, (progress) => {
          writer.stage(progress.stage, progress.stage === "reading" ? progress.titles : undefined);
        })
        .then((result) => {
          writer.answer(result.turn, result.conversation);
        })
        .catch((error: unknown) => {
          writer.fail(assistant.toAssistantError(error).code);
        });
    },
  });

  return new Response(body, {
    headers: {
      ...privateHeaders,
      "Content-Type": assistant.NDJSON_CONTENT_TYPE,
      // Nothing between here and the browser may buffer the stage lines into one
      // response; a proxy that did would turn a live progress report into a
      // silence followed by an answer.
      "X-Accel-Buffering": "no",
    },
    status: 200,
  });
}
