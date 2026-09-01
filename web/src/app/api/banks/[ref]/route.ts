import { featureFlag } from "@/lib/env";
import {
  bankNotFound,
  disabledResponse,
  failureResponse,
  invalidRequest,
  isBankRef,
  jsonResponse,
  type BankDetailPorts,
} from "@/lib/vault/http";

// Same ordering rule as the list route: the flag check precedes every import
// that could reach a database.

export async function GET(
  _request: Request,
  context: { params: Promise<{ ref: string }> },
  ports?: BankDetailPorts,
) {
  if (!featureFlag("FEATURE_VAULT")) return disabledResponse();

  const { ref } = await context.params;
  if (!isBankRef(ref)) return invalidRequest("The lender handle is not a lender handle.");

  try {
    let resolved: BankDetailPorts | undefined = ports;
    if (!resolved) {
      const [session, vault] = await Promise.all([
        import("@/lib/auth/session"),
        import("@/lib/vault"),
      ]);
      resolved = { readBank: vault.readBank, requireRole: session.requireRole };
    }
    await resolved.requireRole("operator_member", "platform_admin");
    const bank = await resolved.readBank(ref);
    // A lender that is unpublished or absent gets the same 404 as one that
    // never existed: the catalog is the same for every caller, so there is
    // nothing here for a distinction to protect and one answer is simpler to
    // reason about. It answers 404 rather than 200 with a null body, so a
    // caller cannot mistake "no such lender" for "a lender with nothing in it".
    if (bank === null) return bankNotFound();
    return jsonResponse({ bank }, 200);
  } catch (error) {
    return failureResponse(error);
  }
}
