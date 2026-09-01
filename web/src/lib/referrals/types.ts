export type ReferralLifecycleRow = {
  referralId: string;
  sourceOrgId: string;
  platformOrgId: string;
  createdAt: string;
  clickedAt: string | null;
  convertedAt: string | null;
  convertedClientId: string | null;
};

export type ReferralConversionRow = ReferralLifecycleRow & {
  status: "converted" | "already_converted";
};

export type ReferralCreateInput = {
  consumerId: string;
  sourceClientId: string;
  platformOrgId: string;
  tokenDigest: Buffer;
};

export type ReferralEvidence = ReferralLifecycleRow & {
  auditActions: string[];
  sourceClientId: string;
};

export interface ReferralRepository {
  resolveSourceClient(consumerId: string): Promise<{ clientId: string; orgId: string }>;
  platformOrgIsMarked(platformOrgId: string): Promise<boolean>;
  createReferral(input: ReferralCreateInput): Promise<ReferralLifecycleRow>;
  markClicked(tokenDigest: Buffer): Promise<ReferralLifecycleRow>;
  markConverted(input: {
    tokenDigest: Buffer;
    convertedClientId: string;
    actorId: string;
  }): Promise<ReferralConversionRow>;
  readEvidence(referralId: string): Promise<ReferralEvidence | null>;
}
