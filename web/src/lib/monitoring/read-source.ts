import type { EnvSource } from "@/lib/env";

/**
 * Select display provenance without validating live provider credentials.
 * A durable read remains available during an outage or incomplete provider
 * configuration, while production can never fall back to generated scores.
 */
export function monitoringReadSource(env: EnvSource = process.env): "mock" | "provider" {
  if (env.NODE_ENV === "production") return "provider";
  const configured = env.CRS_DRIVER?.trim().toLowerCase() ?? "";
  return configured === "" || configured === "mock" ? "mock" : "provider";
}
