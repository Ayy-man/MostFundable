export const ADMIN_PRIVATE_HEADERS = { "Cache-Control": "private, no-store" } as const;
// Postgres `uuid` shape, not strict RFC-4122: the seeded demo identities
// (platform admin 00000000-0000-0000-0000-000000000001 etc.) carry zero
// version/variant nibbles and are legitimate actors on the local stack.
export const ADMIN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ADMIN_DAY = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export function adminJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: ADMIN_PRIVATE_HEADERS });
}

export function adminDisabled(): Response {
  return new Response(null, { status: 404 });
}

export function adminError(code: string, status: number): Response {
  return adminJson({ error: { code } }, status);
}

export function adminFailure(error: unknown): Response {
  if (typeof error === "object" && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (status === 401) return adminError("unauthenticated", 401);
    if (status === 403) return adminError("forbidden", 403);
  }
  return adminError("admin_request_failed", 500);
}

export function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

export function isAdminDay(value: unknown): value is string {
  if (typeof value !== "string" || !ADMIN_DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export async function readExactBody(request: Request, keys: readonly string[]): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return isExactRecord(body, keys) ? body : null;
  } catch {
    return null;
  }
}
