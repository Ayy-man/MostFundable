import type { ComponentType, ReactNode } from "react";

import type { TrackerStage } from "@/lib/tracker/types";

export type DemoRole = "consumer" | "operator" | "admin" | "affiliate";
export type DemoTheme = "consumer" | "workspace" | "affiliate";

export const FUNDING_STAGES = [
  "Onboarding",
  "Optimization",
  "Ready",
  "Applying",
  "Funded",
  "Graduate",
] as const;

export const READY_PROFILE_COMPLETION = 100;

export type FundingStage = (typeof FUNDING_STAGES)[number];
export type ApplicationOperatorStatus = "wait" | "to-do" | "done";
export type ApplicationOutcome = "approved" | "pending" | "denied";
export type ApplicationOutcomeActor = "consumer" | "operator";
export type ApplicationPresentation = "details" | "status-only";
export type ApplicationPresentationOverride =
  | "inherit"
  | ApplicationPresentation;
export type ApplicationNoteAuthor = "consumer" | "operator";
export type ConsumerApplicationContext = {
  clientId: string;
  entryView?: "matches";
  readiness: number;
  /**
   * The durable client's display name, present only when the context was
   * resolved from the tracker (real auth). The demo shell resolves identity
   * from the fixture roster instead and leaves this unset — and when it is
   * set, the surface must never fall back to the roster, or a signed-in
   * consumer is greeted as whichever fixture shares the demo's client id.
   */
  displayName?: string;
  /**
   * The durable client's own business, from the same tracker row as
   * `displayName` and present only under real auth. Without it the surface fell
   * back to the fixture roster for the identity chip, which is how a signed-in
   * consumer was labelled with a stranger's company beside their own name.
   * `null` means the tracker row carries no business name — say nothing rather
   * than borrow one.
   */
  businessName?: string | null;
  /**
   * The durable client's tracker stage, from the same tracker row as
   * `displayName` and present only when the context was resolved from the
   * tracker under real auth. The fixture shell leaves it unset and the
   * surface falls back to the roster stage instead. `@/lib/tracker/types`
   * has no imports of its own, so this type-only import carries no
   * circular-dependency risk.
   */
  stage?: TrackerStage;
};
export type AffiliatePaymentStatus =
  | "not-ready"
  | "pending"
  | "submitted"
  | "paid";

export type ApplicationNote = {
  authorName: string;
  authorRole: ApplicationNoteAuthor;
  body: string;
  createdAt: string;
  id: string;
};

export type ApplicationRecord = {
  applicationProcess: string[];
  approvedAmount: number | null;
  bankId: string;
  bankName: string;
  clientId: string;
  clientName: string;
  criteriaSummary: string;
  id: string;
  notes: ApplicationNote[];
  operatorId: string;
  operatorStatus: ApplicationOperatorStatus;
  outcome: ApplicationOutcome | null;
  outcomeRecordedAt: string | null;
  outcomeRecordedBy: ApplicationOutcomeActor | null;
  product: string;
  sequence: number;
  sourceUpdatedAt: string;
};

export type AffiliateShare = {
  affiliateId: string;
  affiliateName: string;
  clientId: string;
  expectedCommission: number;
  id: string;
  paymentStatus: AffiliatePaymentStatus;
  sharedAt: string;
};

export type NavIcon = ComponentType<{
  "aria-hidden"?: boolean;
  className?: string;
}>;

export type NavItem = {
  badge?: string | number;
  icon: NavIcon;
  id: string;
  label: string;
};

export type NavSection = {
  items: NavItem[];
  label?: string;
};

export type DemoShellProps = {
  activeView: string;
  brand: string;
  children: ReactNode;
  currentRole: DemoRole;
  eyebrow?: string;
  footer?: ReactNode;
  initials: string;
  onNavigate: (view: string) => void;
  onOpenProfiles: () => void;
  profileName: string;
  roleLabel: string;
  sections: NavSection[];
  theme?: DemoTheme;
};

export type SurfaceProps = {
  onOpenProfiles: () => void;
};
