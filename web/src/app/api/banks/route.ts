import { featureFlag } from "@/lib/env";
import {
  disabledResponse,
  failureResponse,
  invalidRequest,
  jsonResponse,
  type BankListPorts,
} from "@/lib/vault/http";

// Two module-scope imports, both pure: the flag reader and the response shapes.
// Everything that could touch a database is loaded inside the handler, after
// the flag check has already returned. `routes.test.ts` asserts that ordering
// by source position.

export async function GET(
  request: Request,
  // Next owns the second parameter of a route handler even where there is no
  // dynamic segment, so the injectable seam is third — the position
  // `enrollment-routes.test.ts` already uses for the same purpose.
  _context?: unknown,
  ports?: BankListPorts,
) {
  if (!featureFlag("FEATURE_VAULT")) return disabledResponse();

  // No filters: the catalog is the catalog. A `?q=` or `?active=` here would
  // eventually disagree with migration 381's own policy about what is served.
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    return invalidRequest("The lender list takes no parameters.");
  }

  try {
    let resolved: BankListPorts | undefined = ports;
    if (!resolved) {
      const [session, vault] = await Promise.all([
        import("@/lib/auth/session"),
        import("@/lib/vault"),
      ]);
      resolved = { listBanks: vault.listBanks, requireRole: session.requireRole };
    }
    // The Bank Vault is an operator surface. A consumer reaches lender
    // information through their plan, and an affiliate's whole portal is the
    // five columns of `affiliate_client_view`, so neither belongs here.
    await resolved.requireRole("operator_member", "platform_admin");
    return jsonResponse({ banks: await resolved.listBanks() }, 200);
  } catch (error) {
    return failureResponse(error);
  }
}
