export { affiliateFailure, disabledResponse, privateJson } from "@/lib/affiliates/http";
export {
  affiliateReferralValid,
  getAffiliatePortal,
  getOperatorAffiliateRoster,
  getOperatorAffiliateStatement,
  shareClient,
  unshareClient,
  updateOperatorAffiliate,
  updateShare,
} from "@/lib/affiliates/service";
export { AffiliateError } from "@/lib/affiliates/types";
export type {
  AffiliatePortal,
  AffiliatePortalRow,
  AffiliateLifecyclePatch,
  AffiliateLifecycleResult,
  AffiliateRosterEntry,
  AffiliateShare,
  AffiliateStatementRow,
  UpdateShareBody,
} from "@/lib/affiliates/types";
export {
  parseAffiliateId,
  parseAffiliateLifecyclePatch,
  parseAffiliateSlug,
  parseShareClientBody,
  parseUpdateShareBody,
} from "@/lib/affiliates/validate";
