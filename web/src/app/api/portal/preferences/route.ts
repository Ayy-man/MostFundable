export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { handlePortalPreferences } = await import("@/lib/portal/preferences.server");
  return handlePortalPreferences();
}
