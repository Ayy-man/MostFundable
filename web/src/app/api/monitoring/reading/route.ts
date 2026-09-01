export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The credit panel's durable read.
 *
 * Purchase and analysis switches govern new money and new work. They do not
 * govern this authenticated durable read, because an outage or kill switch
 * must not erase an included-refresh schedule the account already owns.
 *
 * The response is derived per request and never cached: two viewers of the same workspace must
 * agree, and a cached body would let a completed refresh keep serving the file it replaced.
 */
export async function GET(): Promise<Response> {
  const [{ requireRole }, { readMonitoringReading }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/monitoring/read.server"),
  ]);

  let session;
  try {
    session = await requireRole("consumer");
  } catch {
    return Response.json({ error: "unauthorized" }, {
      headers: { "Cache-Control": "private, no-store" },
      status: 401,
    });
  }

  // A read that cannot be built is reported as unavailable, never as a healthy empty panel: the
  // surface has to be able to tell "no refresh has happened" from "this read failed", because the
  // first keeps the fixture and the second has to say so on screen. The cause stays off the wire
  // and goes to the diagnostics seam; the caller gets the id that joins its 503 to that record.
  let result;
  try {
    result = await readMonitoringReading(session);
  } catch (error) {
    const { recordRouteFailure, withCorrelationId } = await import("@/lib/diagnostics/route-failure");
    const id = recordRouteFailure({
      cause: error,
      code: "reading_unavailable",
      status: 503,
      surface: "monitoring.reading",
    });
    return Response.json(withCorrelationId({ enabled: true, error: "reading_unavailable" }, id), {
      headers: { "Cache-Control": "private, no-store" },
      status: 503,
    });
  }

  return Response.json({ enabled: true, ...result }, {
    headers: { "Cache-Control": "private, no-store" },
    status: 200,
  });
}
