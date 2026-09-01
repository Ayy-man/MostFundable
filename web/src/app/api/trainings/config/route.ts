import { featureFlag } from "@/lib/env";
import { failure, json } from "@/lib/ancillary/http";
export async function GET() {
  if (!featureFlag("FEATURE_ANCILLARY")) return json({ enabled: false, attestationAvailable: false, platformTrainingsUrl: null, northwestPartnerUrl: null });
  try { const [{ getSession }, { getAuthenticatedAncillaryConfig }] = await Promise.all([import("@/lib/auth/session"), import("@/lib/ancillary/config")]); const session = await getSession(); if (!session) return json({ error: "authentication_required" }, 401); return json(getAuthenticatedAncillaryConfig(session.role)); } catch (error) { return failure(error); }
}
