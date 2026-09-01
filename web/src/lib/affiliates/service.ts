import { summarizeAffiliateRows } from "@/lib/affiliates/kpis";
import {
  createAffiliateRepository,
  type AffiliateRepository,
} from "@/lib/affiliates/repository";
import type { AffiliateLifecyclePatch, UpdateShareBody } from "@/lib/affiliates/types";

export async function affiliateReferralValid(
  code: string,
  repository: AffiliateRepository = createAffiliateRepository(),
): Promise<boolean> {
  return repository.referralValid(code);
}

export async function getAffiliatePortal(
  now: Date,
  repository: AffiliateRepository = createAffiliateRepository(),
) {
  return summarizeAffiliateRows(await repository.listPortalRows(), now);
}

export async function getOperatorAffiliateRoster(
  repository: AffiliateRepository = createAffiliateRepository(),
) {
  return repository.listOperatorRoster();
}

export async function getOperatorAffiliateStatement(
  affiliateId: string,
  repository: AffiliateRepository = createAffiliateRepository(),
) {
  return repository.getOperatorStatement(affiliateId);
}

export async function updateOperatorAffiliate(
  affiliateId: string,
  patch: AffiliateLifecyclePatch,
  repository: AffiliateRepository = createAffiliateRepository(),
) {
  return repository.updateAffiliate(affiliateId, patch);
}

export async function shareClient(
  affiliateId: string,
  clientId: string,
  repository: AffiliateRepository = createAffiliateRepository(),
) {
  return repository.shareClient(affiliateId, clientId);
}

export async function unshareClient(
  affiliateId: string,
  clientId: string,
  repository: AffiliateRepository = createAffiliateRepository(),
) {
  return repository.unshareClient(affiliateId, clientId);
}

export async function updateShare(
  affiliateId: string,
  clientId: string,
  patch: UpdateShareBody,
  repository: AffiliateRepository = createAffiliateRepository(),
) {
  return repository.updateShare(affiliateId, clientId, patch);
}
