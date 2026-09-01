// Browser-safe boundary: keep every server, provider, and database import out.
//
// R4B-02 / R4B-03. A feature bootstrap has four outcomes, not two. `disabled` is reserved for a
// successful response that says the flag is off; every transport failure, non-2xx status, malformed
// body and missing `enabled` field is `unavailable`. A nullable "config or null" bootstrap collapses
// those two into one value, and the surface then reads a 503 as flag-off and runs the local fixture
// branch — which claims a cancellation that never happened, or a stored document that was never
// uploaded. Round 3 established this shape for support chat (`openSupportTeamChat`); these are its
// two siblings.
import { getJson, type ApiResult } from "@/lib/enrollment/client";
import type { EnrollConfig } from "@/lib/enrollment/types";

export type BootstrapState = "loading" | "disabled" | "ready" | "unavailable";

// Shown wherever a bootstrap is loading or unavailable. It has to say that nothing happened,
// because the failure it covers is a surface that used to claim that something did.
export const ENROLLMENT_UNAVAILABLE_NOTICE =
  "Your subscription record could not be loaded, so nothing was changed. Reload the record and try again.";
export const ANCILLARY_UNAVAILABLE_NOTICE =
  "The document service could not be reached, so nothing can be stored or updated right now.";
export const ENROLLMENT_STEP_UNAVAILABLE_NOTICE =
  "Enrollment could not be reached, so this step was not recorded. Reload and try again.";

export type AncillaryConfig = {
  enabled: true;
  northwestPartnerUrl: string | null;
  platformTrainingsUrl: string | null;
};

export type AncillaryBootstrapResult =
  | { state: "disabled" | "unavailable" }
  | { state: "ready"; config: AncillaryConfig };

export type EnrollmentBootstrapResult =
  | { state: "disabled" | "unavailable" }
  | { state: "ready"; config: EnrollConfig };

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type EnrollmentRequest = (path: string) => Promise<ApiResult<EnrollConfig>>;

function optionalUrl(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Read `/api/trainings/config`.
 *
 * The route answers 200 `{ enabled: false, … }` when `FEATURE_ANCILLARY` is off, so the disabled
 * result is always an explicit statement from the server rather than the absence of one.
 */
export async function loadAncillaryBootstrap(
  fetcher: Fetcher = fetch,
): Promise<AncillaryBootstrapResult> {
  let response: Response;
  try {
    response = await fetcher("/api/trainings/config", { cache: "no-store" });
  } catch {
    return { state: "unavailable" };
  }
  if (!response.ok) return { state: "unavailable" };

  const body = (await response.json().catch(() => null)) as
    | { enabled?: unknown; northwestPartnerUrl?: unknown; platformTrainingsUrl?: unknown }
    | null;
  if (body === null || typeof body !== "object") return { state: "unavailable" };
  if (body.enabled === false) return { state: "disabled" };
  if (body.enabled !== true) return { state: "unavailable" };

  return {
    config: {
      enabled: true,
      northwestPartnerUrl: optionalUrl(body.northwestPartnerUrl),
      platformTrainingsUrl: optionalUrl(body.platformTrainingsUrl),
    },
    state: "ready",
  };
}

/**
 * Read `/api/enroll`.
 *
 * `getJson` maps an unparseable body to `{ ok: true, data: null }`, so the null check below is the
 * malformed-payload arm rather than defensive noise: without it `data.enabled` throws inside a
 * floating promise and the surface silently keeps its pre-bootstrap default.
 */
export async function loadEnrollmentBootstrap(
  request: EnrollmentRequest = (path) => getJson<EnrollConfig>(path),
): Promise<EnrollmentBootstrapResult> {
  let result: ApiResult<EnrollConfig>;
  try {
    result = await request("/api/enroll");
  } catch {
    return { state: "unavailable" };
  }
  if (!result.ok) return { state: "unavailable" };

  const data = result.data as (EnrollConfig & { enabled?: unknown }) | null;
  if (data === null || typeof data !== "object") return { state: "unavailable" };
  if (data.enabled === false) return { state: "disabled" };
  if (data.enabled !== true) return { state: "unavailable" };

  return { config: data, state: "ready" };
}
