export interface ConsumerProfileInput {
  readonly email: string;
  readonly fullName: string;
  readonly phone: string;
}

export interface ConsumerProfileRead {
  readonly email: string;
  readonly name: string;
  readonly phone: string;
}

export type ConsumerProfileReadResult =
  | { readonly profile: ConsumerProfileRead; readonly status: "ready" }
  | { readonly status: "unavailable" };

export type ConsumerProfileUpdate = {
  readonly emailChange: "confirmed" | "failed" | "pending" | "unchanged";
  readonly profile: ConsumerProfileRead;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseConsumerProfileRead(value: unknown): ConsumerProfileRead | null {
  const body = record(value);
  const profile = record(body?.profile);
  if (profile === null
      || typeof profile.email !== "string" || !profile.email.trim()
      || typeof profile.name !== "string" || !profile.name.trim()
      || typeof profile.phone !== "string") return null;
  return Object.freeze({
    email: profile.email,
    name: profile.name,
    phone: profile.phone,
  });
}

export function parseConsumerProfileUpdate(value: unknown): ConsumerProfileUpdate | null {
  const body = record(value);
  const profile = record(body?.profile);
  const emailChange = body?.emailChange;
  if (profile === null
      || typeof profile.email !== "string" || !profile.email.trim()
      || typeof profile.name !== "string" || !profile.name.trim()
      || typeof profile.phone !== "string"
      || (emailChange !== "confirmed" && emailChange !== "failed"
        && emailChange !== "pending" && emailChange !== "unchanged")) return null;
  return Object.freeze({
    emailChange,
    profile: Object.freeze({
      email: profile.email,
      name: profile.name,
      phone: profile.phone,
    }),
  });
}

export async function updateConsumerProfile(
  input: ConsumerProfileInput,
  fetcher: typeof fetch = fetch,
): Promise<ConsumerProfileUpdate | null> {
  try {
    const response = await fetcher("/api/consumer/profile", {
      body: JSON.stringify(input),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    if (!response.ok) return null;
    return parseConsumerProfileUpdate(await response.json());
  } catch {
    return null;
  }
}

export async function readConsumerProfile(
  fetcher: typeof fetch = fetch,
): Promise<ConsumerProfileReadResult> {
  try {
    const response = await fetcher("/api/consumer/profile", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return { status: "unavailable" };
    const profile = parseConsumerProfileRead(await response.json());
    return profile === null ? { status: "unavailable" } : { profile, status: "ready" };
  } catch {
    return { status: "unavailable" };
  }
}
