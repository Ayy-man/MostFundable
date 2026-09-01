import type { PublishedBrand } from "@/lib/tenancy/types";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export type TenantSurfaceFailure = {
  code: string;
  message: string;
  status: number;
};

type FailureCallback = (failure: TenantSurfaceFailure) => void;

async function responseBody(response: Response): Promise<Record<string, unknown> | null> {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
}

function failureFrom(response: Response, body: Record<string, unknown> | null): TenantSurfaceFailure {
  const error = body?.error;
  const record = error && typeof error === "object" && !Array.isArray(error)
    ? error as Record<string, unknown>
    : null;
  return {
    code: typeof record?.code === "string" ? record.code : `HTTP_${response.status}`,
    message: typeof record?.message === "string"
      ? record.message
      : "The tenancy request could not be completed.",
    status: response.status,
  };
}

function networkFailure(): TenantSurfaceFailure {
  return {
    code: "NETWORK_UNAVAILABLE",
    message: "The tenancy request could not be completed.",
    status: 0,
  };
}

export async function createOperatorTeamInvite(
  input: { email: string; fullName: string },
  callbacks: {
    created(invite: { email: string; fullName: string; inviteId: string; orgId: string }): void;
    failed: FailureCallback;
  },
  fetcher: Fetcher = fetch,
  idempotencyKey = crypto.randomUUID(),
): Promise<void> {
  try {
    const response = await fetcher("/api/invites", {
      body: JSON.stringify({
        email: input.email,
        fullName: input.fullName,
        kind: "team",
        orgRole: "member",
      }),
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      method: "POST",
    });
    const body = await responseBody(response);
    const invite = body?.invite;
    const record = invite && typeof invite === "object" && !Array.isArray(invite)
      ? invite as Record<string, unknown>
      : null;
    if (!response.ok) {
      callbacks.failed(failureFrom(response, body));
      return;
    }
    if (typeof record?.inviteId !== "string" || typeof record.orgId !== "string") {
      callbacks.failed({ code: "INVALID_RESPONSE", message: "The invitation response was invalid.", status: response.status });
      return;
    }
    callbacks.created({ ...input, inviteId: record.inviteId, orgId: record.orgId });
  } catch {
    callbacks.failed(networkFailure());
  }
}

export async function createOperatorAffiliateInvite(
  input: { email: string; fullName: string },
  callbacks: {
    created(invite: { email: string; fullName: string; inviteId: string; orgId: string }): void;
    failed: FailureCallback;
  },
  fetcher: Fetcher = fetch,
  idempotencyKey = crypto.randomUUID(),
): Promise<void> {
  try {
    const response = await fetcher("/api/invites", {
      body: JSON.stringify({
        email: input.email,
        fullName: input.fullName,
        kind: "affiliate",
        orgRole: null,
      }),
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      method: "POST",
    });
    const body = await responseBody(response);
    const invite = body?.invite;
    const record = invite && typeof invite === "object" && !Array.isArray(invite)
      ? invite as Record<string, unknown>
      : null;
    if (!response.ok) {
      callbacks.failed(failureFrom(response, body));
      return;
    }
    if (typeof record?.inviteId !== "string" || typeof record.orgId !== "string") {
      callbacks.failed({ code: "INVALID_RESPONSE", message: "The invitation response was invalid.", status: response.status });
      return;
    }
    callbacks.created({ ...input, inviteId: record.inviteId, orgId: record.orgId });
  } catch {
    callbacks.failed(networkFailure());
  }
}

export async function updateOperatorBrand(
  accentColor: string,
  callbacks: { changed(brand: PublishedBrand): void; failed: FailureCallback },
  fetcher: Fetcher = fetch,
): Promise<void> {
  try {
    const response = await fetcher("/api/org/brand", {
      body: JSON.stringify({ accentColor }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const body = await responseBody(response);
    if (!response.ok) {
      callbacks.failed(failureFrom(response, body));
      return;
    }
    const brand = body?.brand;
    if (!brand || typeof brand !== "object" || Array.isArray(brand)) {
      callbacks.failed({ code: "INVALID_RESPONSE", message: "The brand response was invalid.", status: response.status });
      return;
    }
    callbacks.changed(brand as PublishedBrand);
  } catch {
    callbacks.failed(networkFailure());
  }
}

export async function publishOperatorBrand(
  callbacks: { failed: FailureCallback; published(publishedAt: string): void },
  fetcher: Fetcher = fetch,
): Promise<void> {
  try {
    const response = await fetcher("/api/org/brand/publish", { method: "POST" });
    const body = await responseBody(response);
    const brand = body?.brand;
    const record = brand && typeof brand === "object" && !Array.isArray(brand)
      ? brand as Record<string, unknown>
      : null;
    if (!response.ok) {
      callbacks.failed(failureFrom(response, body));
      return;
    }
    if (typeof record?.publishedAt !== "string") {
      callbacks.failed({ code: "INVALID_RESPONSE", message: "The publication response was invalid.", status: response.status });
      return;
    }
    callbacks.published(record.publishedAt);
  } catch {
    callbacks.failed(networkFailure());
  }
}
