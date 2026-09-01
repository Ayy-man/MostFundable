import { type NextRequest } from "next/server";

import { RESET_PASSWORD_PATH } from "@/lib/auth/roles";
import { featureFlag } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const ACCEPTED = { status: "accepted" } as const;

type ResetClient = {
  auth: {
    resetPasswordForEmail(
      email: string,
      options: { redirectTo: string },
    ): Promise<{ error: { code?: string } | null }>;
  };
};

export type PasswordResetRequestDependencies = {
  createClient(): Promise<ResetClient>;
  enabled(): boolean;
};

const productionDependencies: PasswordResetRequestDependencies = {
  async createClient() {
    return createClient();
  },
  enabled() {
    return featureFlag("FEATURE_REAL_AUTH");
  },
};

function readEmail(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const email = (value as Record<string, unknown>).email;
  if (typeof email !== "string") return null;
  const normalized = email.trim();
  return normalized !== "" && normalized.length <= 320 && normalized.includes("@")
    ? normalized
    : null;
}

export async function handlePasswordResetRequest(
  request: NextRequest,
  dependencies: PasswordResetRequestDependencies = productionDependencies,
): Promise<Response> {
  if (!dependencies.enabled()) return new Response(null, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const email = readEmail(body);
  if (email === null) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const callback = new URL("/api/auth/confirm", request.nextUrl);
  callback.searchParams.set("next", RESET_PASSWORD_PATH);

  const client = await dependencies.createClient();
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: callback.toString(),
  });

  // The response is deliberately identical for known, unknown and throttled
  // addresses. Provider detail is useful in logs, but exposing it would turn
  // this public endpoint into an account directory.
  if (error) console.error("password reset request rejected", { code: error.code });

  return Response.json(ACCEPTED, {
    headers: { "Cache-Control": "no-store" },
    status: 202,
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return handlePasswordResetRequest(request);
}
