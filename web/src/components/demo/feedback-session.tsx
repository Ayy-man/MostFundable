"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  DEMO_CLIENTS,
  DEMO_TODAY,
  INITIAL_AFFILIATE_SHARES,
  INITIAL_APPLICATION_RECORDS,
  OUTCOME_PERIODS,
  deriveBankHistoricalStats,
  type BankHistoricalStat,
  type OutcomePeriod,
} from "@/lib/demo/feedback-fixtures";
import type {
  AffiliatePaymentStatus,
  AffiliateShare,
  ApplicationNoteAuthor,
  ApplicationOperatorStatus,
  ApplicationOutcome,
  ApplicationOutcomeActor,
  ApplicationPresentation,
  ApplicationPresentationOverride,
  ApplicationRecord,
} from "@/lib/demo/types";

type RecordOutcomeInput = {
  actor: ApplicationOutcomeActor;
  amount?: number | null;
  applicationId: string;
  outcome: ApplicationOutcome;
};

type AddNoteInput = {
  applicationId: string;
  authorName: string;
  authorRole: ApplicationNoteAuthor;
  body: string;
};

type ShareClientInput = {
  affiliateId: string;
  affiliateName: string;
  clientId: string;
  expectedCommission: number;
};

export type FeedbackSessionValue = {
  addApplicationNote: (input: AddNoteInput) => void;
  affiliateShares: AffiliateShare[];
  applications: ApplicationRecord[];
  bankStatsByPeriod: Record<OutcomePeriod, BankHistoricalStat[]>;
  clientApplicationPresentation: Record<
    string,
    ApplicationPresentationOverride
  >;
  getApplicationsForClient: (clientId: string) => ApplicationRecord[];
  getClientFundedAmount: (clientId: string) => number;
  matchesUnlocked: Record<string, boolean>;
  setMatchesUnlocked: (clientId: string, unlocked: boolean) => void;
  outcomeReviewQueue: ApplicationRecord[];
  recordApplicationOutcome: (input: RecordOutcomeInput) => void;
  removeApplicationOutcome: (applicationId: string) => void;
  resolveApplicationPresentation: (
    clientId: string,
  ) => ApplicationPresentation;
  setAffiliatePaymentStatus: (
    shareId: string,
    status: AffiliatePaymentStatus,
  ) => void;
  setClientApplicationPresentation: (
    clientId: string,
    presentation: ApplicationPresentationOverride,
  ) => void;
  setExpectedCommission: (shareId: string, amount: number) => void;
  setOperatorApplicationStatus: (
    applicationId: string,
    status: ApplicationOperatorStatus,
  ) => void;
  setWorkspaceApplicationPresentation: (
    presentation: ApplicationPresentation,
  ) => void;
  shareClientWithAffiliate: (input: ShareClientInput) => void;
  unshareClientFromAffiliate: (shareId: string) => void;
  workspaceApplicationPresentation: ApplicationPresentation;
};

const FeedbackSessionContext = createContext<FeedbackSessionValue | null>(null);

function normalizeMoney(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(
    0,
    Math.round(((value ?? 0) + Number.EPSILON) * 100) / 100,
  );
}

function cloneInitialApplications() {
  return INITIAL_APPLICATION_RECORDS.map((application) => ({
    ...application,
    applicationProcess: [...application.applicationProcess],
    notes: application.notes.map((note) => ({ ...note })),
  }));
}

/**
 * `seeded` is what separates the flags-OFF fixture shell from a signed-in
 * workspace, and it is a prop rather than a flag read because the provider has
 * no business knowing which flags are on.
 *
 * Seeded (the default, and what `<DemoApp />` gets): the provider opens with
 * `INITIAL_APPLICATION_RECORDS` and `INITIAL_AFFILIATE_SHARES`, and
 * `getClientFundedAmount` falls back to the fixture roster's `fundedAmount`
 * when a client has no application rows. That is the illustrative shell, where
 * an empty in-memory store would just look broken.
 *
 * Not seeded: every one of those rows is somebody else's application, share and
 * funded total, rendered inside a real operator's or admin's workspace with no
 * write path behind them. The provider starts empty and the funded-amount
 * fallback is gone, so a client with no recorded application reads as 0 instead
 * of borrowing a fixture number -- the G-HOST-14 class, where a missing record
 * silently becomes a fixture value.
 *
 * Route wrappers pass `seeded={!realAuth}`: with FEATURE_REAL_AUTH on, each of
 * the four surface pages redirects an unauthenticated visitor away, so on those
 * routes "real auth" and "there is a durable session" are the same condition.
 */
export function FeedbackSessionProvider({
  children,
  seeded = true,
}: {
  children: ReactNode;
  seeded?: boolean;
}) {
  const [applications, setApplications] = useState<ApplicationRecord[]>(() =>
    seeded ? cloneInitialApplications() : [],
  );
  const [affiliateShares, setAffiliateShares] = useState<AffiliateShare[]>(() =>
    seeded ? INITIAL_AFFILIATE_SHARES.map((share) => ({ ...share })) : [],
  );
  const [
    workspaceApplicationPresentation,
    setWorkspaceApplicationPresentation,
  ] = useState<ApplicationPresentation>("details");
  const [
    clientApplicationPresentation,
    setClientApplicationPresentationState,
  ] = useState<Record<string, ApplicationPresentationOverride>>({});
  const [matchesUnlocked, setMatchesUnlockedState] = useState<
    Record<string, boolean>
  >({});
  const nextNoteId = useRef(1);
  const nextShareId = useRef(1);

  const setMatchesUnlocked = useCallback(
    (clientId: string, unlocked: boolean) => {
      setMatchesUnlockedState((current) => ({
        ...current,
        [clientId]: unlocked,
      }));
    },
    [],
  );

  const setOperatorApplicationStatus = useCallback(
    (applicationId: string, status: ApplicationOperatorStatus) => {
      setApplications((current) =>
        current.map((application) =>
          application.id === applicationId
            ? { ...application, operatorStatus: status }
            : application,
        ),
      );
    },
    [],
  );

  const recordApplicationOutcome = useCallback(
    ({ actor, amount, applicationId, outcome }: RecordOutcomeInput) => {
      const approvedAmount =
        outcome === "approved" && Number.isFinite(amount)
          ? normalizeMoney(amount)
          : null;

      setApplications((current) =>
        current.map((application) =>
          application.id === applicationId
            ? {
                ...application,
                approvedAmount,
                outcome,
                outcomeRecordedAt: DEMO_TODAY,
                outcomeRecordedBy: actor,
              }
            : application,
        ),
      );
    },
    [],
  );

  const removeApplicationOutcome = useCallback((applicationId: string) => {
    setApplications((current) =>
      current.map((application) =>
        application.id === applicationId
          ? {
              ...application,
              approvedAmount: null,
              outcome: null,
              outcomeRecordedAt: null,
              outcomeRecordedBy: null,
            }
          : application,
      ),
    );
  }, []);

  const addApplicationNote = useCallback(
    ({ applicationId, authorName, authorRole, body }: AddNoteInput) => {
      const trimmedBody = body.trim();
      if (!trimmedBody) return;

      const noteId = `session-note-${nextNoteId.current}`;
      nextNoteId.current += 1;
      setApplications((current) =>
        current.map((application) =>
          application.id === applicationId
            ? {
                ...application,
                notes: [
                  ...application.notes,
                  {
                    id: noteId,
                    authorName,
                    authorRole,
                    body: trimmedBody,
                    createdAt: "Jul 21 · now",
                  },
                ],
              }
            : application,
        ),
      );
    },
    [],
  );

  const setClientApplicationPresentation = useCallback(
    (
      clientId: string,
      presentation: ApplicationPresentationOverride,
    ) => {
      setClientApplicationPresentationState((current) => {
        if (presentation === "inherit") {
          const next = { ...current };
          delete next[clientId];
          return next;
        }
        return { ...current, [clientId]: presentation };
      });
    },
    [],
  );

  const resolveApplicationPresentation = useCallback(
    (clientId: string) => {
      const override = clientApplicationPresentation[clientId];
      return override && override !== "inherit"
        ? override
        : workspaceApplicationPresentation;
    },
    [clientApplicationPresentation, workspaceApplicationPresentation],
  );

  const getApplicationsForClient = useCallback(
    (clientId: string) =>
      applications
        .filter((application) => application.clientId === clientId)
        .sort((left, right) => left.sequence - right.sequence),
    [applications],
  );

  const getClientFundedAmount = useCallback(
    (clientId: string) => {
      const trackedApplications = applications.filter(
        (application) => application.clientId === clientId,
      );
      if (trackedApplications.length) {
        return trackedApplications.reduce(
          (total, application) =>
            total +
            (application.outcome === "approved"
              ? (application.approvedAmount ?? 0)
              : 0),
          0,
        );
      }
      // Only the illustrative shell may answer "no application rows" with the
      // fixture roster's funded total; in a real workspace that is a fabricated
      // funding claim about somebody's business.
      if (!seeded) return 0;
      return (
        DEMO_CLIENTS.find((client) => client.clientId === clientId)
          ?.fundedAmount ?? 0
      );
    },
    [applications, seeded],
  );

  const shareClientWithAffiliate = useCallback(
    ({
      affiliateId,
      affiliateName,
      clientId,
      expectedCommission,
    }: ShareClientInput) => {
      setAffiliateShares((current) => {
        const existing = current.find(
          (share) =>
            share.clientId === clientId && share.affiliateId === affiliateId,
        );
        if (existing) {
          return current.map((share) =>
            share.id === existing.id
              ? {
                  ...share,
                  affiliateName,
                  expectedCommission: normalizeMoney(expectedCommission),
                }
              : share,
          );
        }

        const shareId = `session-share-${nextShareId.current}`;
        nextShareId.current += 1;
        return [
          ...current,
          {
            id: shareId,
            affiliateId,
            affiliateName,
            clientId,
            expectedCommission: normalizeMoney(expectedCommission),
            paymentStatus: "not-ready",
            sharedAt: DEMO_TODAY,
          },
        ];
      });
    },
    [],
  );

  const unshareClientFromAffiliate = useCallback((shareId: string) => {
    setAffiliateShares((current) =>
      current.filter((share) => share.id !== shareId),
    );
  }, []);

  const setExpectedCommission = useCallback(
    (shareId: string, amount: number) => {
      setAffiliateShares((current) =>
        current.map((share) =>
          share.id === shareId
            ? { ...share, expectedCommission: normalizeMoney(amount) }
            : share,
        ),
      );
    },
    [],
  );

  const setAffiliatePaymentStatus = useCallback(
    (shareId: string, status: AffiliatePaymentStatus) => {
      setAffiliateShares((current) =>
        current.map((share) =>
          share.id === shareId ? { ...share, paymentStatus: status } : share,
        ),
      );
    },
    [],
  );

  const bankStatsByPeriod = useMemo(
    () =>
      Object.fromEntries(
        OUTCOME_PERIODS.map(({ id }) => [
          id,
          deriveBankHistoricalStats(id, applications),
        ]),
      ) as Record<OutcomePeriod, BankHistoricalStat[]>,
    [applications],
  );

  const outcomeReviewQueue = useMemo(
    () =>
      applications.filter((application) => application.outcome !== null),
    [applications],
  );

  const value = useMemo<FeedbackSessionValue>(
    () => ({
      addApplicationNote,
      affiliateShares,
      applications,
      bankStatsByPeriod,
      clientApplicationPresentation,
      getApplicationsForClient,
      getClientFundedAmount,
      matchesUnlocked,
      outcomeReviewQueue,
      recordApplicationOutcome,
      removeApplicationOutcome,
      resolveApplicationPresentation,
      setAffiliatePaymentStatus,
      setClientApplicationPresentation,
      setExpectedCommission,
      setMatchesUnlocked,
      setOperatorApplicationStatus,
      setWorkspaceApplicationPresentation,
      shareClientWithAffiliate,
      unshareClientFromAffiliate,
      workspaceApplicationPresentation,
    }),
    [
      addApplicationNote,
      affiliateShares,
      applications,
      bankStatsByPeriod,
      clientApplicationPresentation,
      getApplicationsForClient,
      getClientFundedAmount,
      matchesUnlocked,
      setMatchesUnlocked,
      outcomeReviewQueue,
      recordApplicationOutcome,
      removeApplicationOutcome,
      resolveApplicationPresentation,
      setAffiliatePaymentStatus,
      setClientApplicationPresentation,
      setExpectedCommission,
      setOperatorApplicationStatus,
      shareClientWithAffiliate,
      unshareClientFromAffiliate,
      workspaceApplicationPresentation,
    ],
  );

  return (
    <FeedbackSessionContext.Provider value={value}>
      {children}
    </FeedbackSessionContext.Provider>
  );
}

export function useFeedbackSession() {
  const value = useContext(FeedbackSessionContext);
  if (!value) {
    throw new Error(
      "useFeedbackSession must be used within FeedbackSessionProvider.",
    );
  }
  return value;
}
