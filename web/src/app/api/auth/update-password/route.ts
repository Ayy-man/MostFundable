import { featureFlag } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type PasswordClient = {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
    updateUser(input: { password: string }): Promise<{ error: { code?: string } | null }>;
  };
};

export type UpdatePasswordDependencies = {
  createClient(): Promise<PasswordClient>;
  enabled(): boolean;
};

const productionDependencies: UpdatePasswordDependencies = {
  async createClient() {
    return createClient();
  },
  enabled() {
    return featureFlag("FEATURE_REAL_AUTH");
  },
};

export function passwordValidationError(value: unknown): string | null {
  if (typeof value !== "string") return "invalid_request";
  if (value.length < 12) return "password_too_short";
  if (value.length > 128) return "password_too_long";
  return null;
}

export async function handleUpdatePassword(
  request: Request,
  dependencies: UpdatePasswordDependencies = productionDependencies,
): Promise<Response> {
  if (!dependencies.enabled()) return new Response(null, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const password =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).password
      : undefined;
  const invalid = passwordValidationError(password);
  if (invalid !== null) {
    return Response.json({ error: invalid }, { status: 400 });
  }

  const client = await dependencies.createClient();
  const { data, error: userError } = await client.auth.getUser();
  if (userError || !data.user) {
    return Response.json({ error: "recovery_session_required" }, { status: 401 });
  }

  const { error } = await client.auth.updateUser({ password: password as string });
  if (error) {
    console.error("password update rejected", { code: error.code });
    return Response.json({ error: "password_update_failed" }, { status: 422 });
  }

  return Response.json(
    { updated: true },
    { headers: { "Cache-Control": "private, no-store" }, status: 200 },
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleUpdatePassword(request);
}
