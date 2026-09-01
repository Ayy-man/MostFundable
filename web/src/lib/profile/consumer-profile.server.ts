import "server-only";

import type {
  ConsumerProfileInput,
  ConsumerProfileRead,
  ConsumerProfileUpdate,
} from "./consumer-profile.ts";

interface ConsumerSession {
  readonly id: string;
  readonly orgId: string | null;
  readonly role: string;
}

export interface ConsumerProfileDependencies {
  readProfile(profileId: string): Promise<ConsumerProfileRead>;
  requestEmailChange(email: string): Promise<void>;
  requireConsumer(): Promise<ConsumerSession>;
  updateProfile(fullName: string, phone: string): Promise<ConsumerProfileRead>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+(). -]{7,32}$/;

function input(value: unknown): ConsumerProfileInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "email,fullName,phone") return null;
  if (typeof row.fullName !== "string" || typeof row.email !== "string" || typeof row.phone !== "string") return null;
  const fullName = row.fullName.trim();
  const email = row.email.trim().toLowerCase();
  const phone = row.phone.trim();
  if (
    !fullName
    || fullName.length > 120
    || email.length > 320
    || !EMAIL.test(email)
    || (phone !== "" && !PHONE.test(phone))
  ) return null;
  return Object.freeze({ email, fullName, phone });
}

export function mapConsumerProfileRow(value: unknown): ConsumerProfileRead | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.full_name !== "string" || !row.full_name.trim()
      || typeof row.email !== "string" || !row.email.trim()
      || !(row.phone === null || typeof row.phone === "string")) return null;
  return Object.freeze({
    email: row.email.trim(),
    name: row.full_name.trim(),
    phone: typeof row.phone === "string" ? row.phone.trim() : "",
  });
}

async function defaults(): Promise<ConsumerProfileDependencies> {
  const [{ requireRole }, { createClient }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/supabase/server"),
  ]);
  const db = await createClient();
  return {
    async readProfile(profileId) {
      const { data, error } = await db
        .from("profiles")
        .select("full_name, email, phone")
        .eq("id", profileId)
        .maybeSingle();
      const profile = mapConsumerProfileRow(data);
      if (error || profile === null) throw new Error("CONSUMER_PROFILE_READ_FAILED");
      return profile;
    },
    async requestEmailChange(email) {
      const { error } = await db.auth.updateUser({ email });
      if (error) throw new Error("CONSUMER_EMAIL_CHANGE_FAILED");
    },
    requireConsumer: () => requireRole("consumer"),
    async updateProfile(fullName, phone) {
      const { data, error } = await db.rpc("consumer_update_profile", {
        p_full_name: fullName,
        p_phone: phone,
      }).maybeSingle();
      const profile = mapConsumerProfileRow(data);
      if (error || profile === null) throw new Error("CONSUMER_PROFILE_UPDATE_FAILED");
      return profile;
    },
  };
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    headers: { "Cache-Control": "private, no-store" },
    status,
  });
}

function accessStatus(error: unknown): 401 | 403 | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  return error.status === 401 || error.status === 403 ? error.status : null;
}

export async function handleConsumerProfileUpdate(
  request: Request,
  supplied?: ConsumerProfileDependencies,
): Promise<Response> {
  let parsed: unknown;
  try { parsed = await request.json(); } catch { parsed = null; }
  const requested = input(parsed);
  if (requested === null) return json({ error: { code: "invalid_request" } }, 400);

  try {
    const dependencies = supplied ?? await defaults();
    const session = await dependencies.requireConsumer();
    if (session.role !== "consumer" || !session.orgId) return json({ error: { code: "forbidden" } }, 403);
    let profile = await dependencies.updateProfile(requested.fullName, requested.phone);
    let emailChange: ConsumerProfileUpdate["emailChange"] = "unchanged";
    if (requested.email !== profile.email.trim().toLowerCase()) {
      try {
        await dependencies.requestEmailChange(requested.email);
        profile = await dependencies.readProfile(session.id);
        emailChange = profile.email.trim().toLowerCase() === requested.email ? "confirmed" : "pending";
      } catch {
        emailChange = "failed";
      }
    }
    return json({ emailChange, profile } satisfies ConsumerProfileUpdate);
  } catch (error) {
    const status = accessStatus(error);
    if (status !== null) return json({ error: { code: status === 401 ? "unauthenticated" : "forbidden" } }, status);
    return json({ error: { code: "profile_update_failed" } }, 500);
  }
}

export async function handleConsumerProfileRead(
  supplied?: ConsumerProfileDependencies,
): Promise<Response> {
  try {
    const dependencies = supplied ?? await defaults();
    const session = await dependencies.requireConsumer();
    if (session.role !== "consumer" || !session.orgId) return json({ error: { code: "forbidden" } }, 403);
    return json({ profile: await dependencies.readProfile(session.id) });
  } catch (error) {
    const status = accessStatus(error);
    if (status !== null) return json({ error: { code: status === 401 ? "unauthenticated" : "forbidden" } }, status);
    return json({ error: { code: "profile_read_failed" } }, 500);
  }
}
