import "server-only";

interface ConsumerSession {
  readonly id: string;
  readonly orgId: string | null;
  readonly role: string;
}

interface ConsumerBillingSource {
  readonly customerRef: string;
  readonly orgId: string;
  readonly provider: "mock" | "stripe";
}

export interface ConsumerPortalDependencies {
  createPortal(input: {
    customerRef: string;
    orgId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  driver(): "mock" | "stripe";
  readSource(profileId: string, orgId: string): Promise<ConsumerBillingSource | null>;
  requireConsumer(): Promise<ConsumerSession>;
}

class ConsumerPortalError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    status: number,
    code: string,
  ) {
    super(code);
    this.name = "ConsumerPortalError";
    this.code = code;
    this.status = status;
  }
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 255 ? normalized : null;
}

async function readSource(profileId: string, orgId: string): Promise<ConsumerBillingSource | null> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();
  const { data: client, error: clientError } = await db
    .from("clients")
    .select("id")
    .eq("consumer_profile_id", profileId)
    .eq("org_id", orgId)
    .eq("status", "active")
    .maybeSingle();
  if (clientError) throw new ConsumerPortalError(500, "consumer_billing_read_failed");
  if (client === null) return null;
  const { data: subscription, error: subscriptionError } = await db
    .from("consumer_subscriptions")
    .select("customer_ref, provider")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subscriptionError) throw new ConsumerPortalError(500, "consumer_billing_read_failed");
  if (subscription === null) return null;
  const customerRef = text(subscription.customer_ref);
  if (customerRef === null || (subscription.provider !== "mock" && subscription.provider !== "stripe")) {
    throw new ConsumerPortalError(500, "consumer_billing_record_invalid");
  }
  return Object.freeze({ customerRef, orgId, provider: subscription.provider });
}

async function defaults(): Promise<ConsumerPortalDependencies> {
  const [{ requireRole }, { getBillingOperationsAdapter }] = await Promise.all([
    import("@/lib/auth/session"),
    import("@/lib/billing"),
  ]);
  const adapter = getBillingOperationsAdapter();
  return {
    createPortal: (input) => adapter.createPortalSession(input),
    driver: () => adapter.driver,
    readSource,
    requireConsumer: () => requireRole("consumer"),
  };
}

async function emptyRequest(request: Request): Promise<boolean> {
  if ([...new URL(request.url).searchParams.keys()].length !== 0) return false;
  const raw = await request.text();
  if (!raw.trim()) return true;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
  } catch {
    return false;
  }
}

function hostedUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
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

export async function handleConsumerBillingPortal(
  request: Request,
  supplied?: ConsumerPortalDependencies,
): Promise<Response> {
  if (!(await emptyRequest(request))) {
    return json({ error: { code: "invalid_request" } }, 400);
  }
  try {
    const dependencies = supplied ?? await defaults();
    const session = await dependencies.requireConsumer();
    if (session.role !== "consumer" || !session.orgId) {
      return json({ error: { code: "forbidden" } }, 403);
    }
    const source = await dependencies.readSource(session.id, session.orgId);
    if (source === null) {
      return json({ error: { code: "billing_customer_unavailable" } }, 409);
    }
    if (source.orgId !== session.orgId || source.provider !== dependencies.driver()) {
      return json({ error: { code: "billing_provider_unconfigured" } }, 503);
    }
    const returnUrl = new URL("/consumer", new URL(request.url).origin).toString();
    const portal = await dependencies.createPortal({
      customerRef: source.customerRef,
      orgId: source.orgId,
      returnUrl,
    });
    const url = hostedUrl(portal.url);
    if (url === null) throw new ConsumerPortalError(502, "billing_provider_result_invalid");
    return json({ url });
  } catch (error) {
    const auth = accessStatus(error);
    if (auth !== null) return json({ error: { code: auth === 401 ? "unauthenticated" : "forbidden" } }, auth);
    if (error instanceof ConsumerPortalError) return json({ error: { code: error.code } }, error.status);
    if (error instanceof Error && error.name === "MisconfiguredDriverError") {
      return json({ error: { code: "billing_provider_unconfigured" } }, 503);
    }
    return json({ error: { code: "billing_provider_unavailable" } }, 502);
  }
}
