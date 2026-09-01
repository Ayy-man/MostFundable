import type {
  CrsIdentity,
  CrsIdvContinuation,
  CrsMemberRef,
  IdvChallengeState,
  IdvResult,
  IdvSubmission,
} from "@/lib/crs/types";

export type {
  CrsIdentity,
  CrsIdvContinuation,
  CrsMemberRef,
  IdvChallengeState,
  IdvResult,
  IdvSubmission,
};

export type IdvDriver = "mock" | "crs";

export const IDV_STATES = {
  pending: "pending",
  smsSent: "sms_sent",
  retry: "retry",
  quiz: "quiz",
  passed: "passed",
  locked: "locked",
} as const;

export type IdvState = (typeof IDV_STATES)[keyof typeof IDV_STATES];

export type IdvStartRequest = {
  enrollmentId: string;
  clientId: string;
  identity: Pick<CrsIdentity, "email" | "phone"> & { fullName: string };
  /** Full CRS identity exists only for the duration of the start call and is never repository state. */
  crsIdentity?: CrsIdentity;
};

export type IdvStartResult = {
  memberRef: CrsMemberRef;
  idpass: boolean;
  challenge: IdvChallengeState;
  continuation?: CrsIdvContinuation;
};

export type IdvSubmitRequest = {
  enrollmentId: string;
  memberRef: CrsMemberRef;
  submission: IdvSubmission;
  attemptsUsed: number;
  maxAttempts: number;
  continuation?: CrsIdvContinuation;
  /**
   * The client's own `business_name`, for the knowledge quiz's one question.
   *
   * Optional because the CRS adapter has no use for it and the contract tests
   * exercise the transitions without a client row. When it is absent the mock
   * keeps its deterministic-persona fallback; when it is present the graded
   * answer is the consumer's own business rather than a fixture persona's.
   */
  businessName?: string | null;
};

export type IdvAdapter = {
  start(req: IdvStartRequest): Promise<IdvStartResult>;
  submit(req: IdvSubmitRequest): Promise<IdvResult>;
  close(memberRef: CrsMemberRef): Promise<void>;
  pause(memberRef: CrsMemberRef): Promise<void>;
  /** Resume the existing provider enrollment after a later signed monitoring grant. */
  resume(memberRef: CrsMemberRef): Promise<void>;
};
