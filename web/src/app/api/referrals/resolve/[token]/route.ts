import { NextResponse } from "next/server";

import { parseReferralConfiguration } from "@/lib/referrals/config";
import { parseReferralToken } from "@/lib/referrals/token";

export const runtime = "nodejs";

function notFound(): Response {
  return Response.json(
    { error: "not_found" },
    { status: 404, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  const parsedToken = parseReferralToken(token);
  const config = parseReferralConfiguration(process.env);
  if (!parsedToken || !config.enabled || new URL(request.url).origin !== config.intakeOrigin) {
    return notFound();
  }

  try {
    const { resolveConsumerReferral } = await import("@/lib/referrals");
    const result = await resolveConsumerReferral(parsedToken);
    if (new URL(result.intakeUrl).origin !== config.intakeOrigin) return notFound();

    const response = NextResponse.redirect(result.intakeUrl, 303);
    response.cookies.set("mf_referral_token", parsedToken, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return notFound();
  }
}
