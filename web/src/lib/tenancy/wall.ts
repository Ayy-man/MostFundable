import { TenantBillingWallError } from "./errors.ts";
import type { SessionContext } from "./types.ts";

export type TenantOperation = "own-book-read" | "write";

export async function assertTenantAccessAllowed(
  session: SessionContext,
  operation: TenantOperation,
): Promise<void> {
  if (
    operation === "write" &&
    (session.role === "operator_member" || session.role === "affiliate") &&
    session.orgMembership === "deactivated"
  ) {
    throw new TenantBillingWallError();
  }
}

export async function assertTenantWriteAllowed(
  session: SessionContext,
): Promise<void> {
  await assertTenantAccessAllowed(session, "write");
}

