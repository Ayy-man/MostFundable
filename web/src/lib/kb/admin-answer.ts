import "server-only";

// The platform-scoped answer path — the seam `lib/assistant/answer.ts` left
// named and empty.
//
// F-08 is "the admin AI page tells the reader twice that it does not work". The
// visible half of that is a component and lane 4b deletes it. The half that
// would make the deletion pointless is this one: with no grounding module the
// admin scope throws `ASSISTANT_SCOPE_UNAVAILABLE`, so 4b would replace an inert
// shell with a workspace that answers "not available here yet" — the same
// message one layer down. So the module exists, and the shell has something to
// be replaced by.
//
// It is the operator path's shape, deliberately. Same `runGroundedChat`, same
// supervisor gate, same opaque handles, same refusal vocabulary — because the
// scope that differs is what the documents are about, not how an answer is
// allowed to be produced. The design brief asks admin questions like "which
// operator grew fastest" and "any client stuck past thirty days", and says its
// chips resolve to operators and analytics; the two document kinds below are
// exactly those two.
//
// Nothing here reads a consumer record. The platform figures are rollups the
// admin surface already renders, and an operator row is a tenant's own totals —
// so this path widens what the admin can *ask*, never what the admin can see.

import type { SessionProfile } from "../auth/session.ts";
import type { ChatTransport } from "../llm/chat-transport.ts";
import type { AdminOverviewCounts } from "../admin/overview.ts";
import type { AdminFundedVolume, AdminTenantRow } from "../admin/platform.ts";
import { recordRouteFailure } from "../diagnostics/route-failure.ts";
import { encodeAnswerBody } from "./answer-body.ts";
import { runGroundedChat, type GroundingDocument, type KbCitation } from "./chat-driver.ts";
import { ADMIN_KB_PROMPT } from "./prompts.ts";
import type { KbProgressReporter } from "./progress.ts";

const MAX_ADMIN_CONTEXT = 8_000;

/** The document id prefixes this builder issues. `sources.ts` maps chips off them. */
export const ADMIN_OPERATOR_PREFIX = "operator:";
export const ADMIN_METRIC_PREFIX = "metric:";

export interface AdminKbDependencies {
  readonly readTenants: () => Promise<readonly AdminTenantRow[]>;
  readonly readCounts: () => Promise<AdminOverviewCounts>;
  readonly readFundedVolume: (today: string) => Promise<AdminFundedVolume>;
  readonly readPlatformMrrCents: () => Promise<number>;
  readonly transport: () => ChatTransport;
  /** The day the volume series is anchored on. Injected so a test is not a clock. */
  readonly today?: () => string;
  readonly onProgress?: KbProgressReporter;
}

/** Same union as `OperatorKbResult`'s answer arms, for the same reasons — see `kb/operator.ts`. */
export type AdminKbResult =
  | {
      readonly status: "answered";
      readonly headline: string;
      readonly bullets: readonly string[];
      readonly footer: null;
      readonly answer: string;
      readonly citations: readonly KbCitation[];
    }
  | {
      readonly status: "insufficient_grounding" | "unavailable";
      readonly answer: string;
      readonly citations: readonly [];
    };

function bounded(documents: readonly GroundingDocument[]): GroundingDocument[] {
  const output: GroundingDocument[] = [];
  let total = 0;
  for (const document of documents) {
    if (total >= MAX_ADMIN_CONTEXT) break;
    const content = document.content.slice(0, MAX_ADMIN_CONTEXT - total);
    if (content.length === 0) continue;
    output.push({ ...document, content });
    total += content.length;
  }
  return output;
}

async function defaultDependencies(): Promise<AdminKbDependencies> {
  const [overview, platform] = await Promise.all([
    import("../admin/overview.ts"),
    import("../admin/platform.ts"),
  ]);
  const repository = platform.createPlatformRepository();
  return {
    readCounts: overview.readAdminOverviewCounts,
    readFundedVolume: (today) => repository.readFundedVolume(today),
    readPlatformMrrCents: () => repository.readPlatformMrrCents(),
    readTenants: () => repository.readTenants(),
    // Same refusal `kb/operator.ts` uses: a caller that forgot to supply a
    // transport gets a named failure rather than a silent mock answer.
    transport: () => {
      throw new Error("KB_ANSWER_UNAVAILABLE");
    },
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * One document per operator tenant, plus two platform figures.
 *
 * The operator documents carry the tenant's own recorded totals — the same
 * numbers `AdminTenantRow` puts on the admin surface's roster — because the
 * questions the brief names are comparisons across that roster and a model
 * cannot compare rows it was not given. The two metric documents are the
 * platform aggregates, so a question about the whole book has something to cite
 * rather than being answered by summing operator rows in prose.
 */
export async function buildAdminGrounding(
  supplied?: AdminKbDependencies,
): Promise<GroundingDocument[]> {
  const deps = supplied ?? (await defaultDependencies());
  const today = (deps.today ?? todayUtc)();
  const [tenants, counts, volume, mrrCents] = await Promise.all([
    deps.readTenants(),
    deps.readCounts(),
    deps.readFundedVolume(today),
    deps.readPlatformMrrCents(),
  ]);

  const operatorDocuments = tenants.map(
    (tenant): GroundingDocument => ({
      content: JSON.stringify({
        clients: tenant.clients,
        fundedAllTimeCents: tenant.fundedAllTimeCents,
        fundedOutcomes: tenant.fundedOutcomes,
        fundedYtdCents: tenant.fundedYtdCents,
        fundingReadyDays: tenant.fundingReadyDays,
        membership: tenant.membership,
        plan: tenant.plan,
        startedAt: tenant.startedAt,
      }),
      // The phrase a chip is allowed to print, stamped at the builder exactly as
      // `buildOperatorGrounding` stamps its own.
      id: `${ADMIN_OPERATOR_PREFIX}${tenant.id}`,
      label: `Operator · ${tenant.name}`,
      metadata: { kind: "operator", orgId: tenant.id },
      title: tenant.name,
      url: `/admin/operators/${tenant.slug}`,
    }),
  );

  const metricDocuments: GroundingDocument[] = [
    {
      content: JSON.stringify({
        analyses: counts.analyses,
        consumers: counts.consumers,
        operators: counts.operators,
        platformMrrCents: mrrCents,
      }),
      id: `${ADMIN_METRIC_PREFIX}platform-totals`,
      label: "Platform metric · Totals",
      metadata: { kind: "metric", subject: "platform-totals" },
      title: "Platform totals",
      url: "/admin",
    },
    {
      content: JSON.stringify({ anchorDay: today, monthly: volume.monthly, weekly: volume.weekly }),
      id: `${ADMIN_METRIC_PREFIX}funded-volume`,
      label: "Platform metric · Funded volume",
      metadata: { kind: "metric", subject: "funded-volume" },
      title: "Funded volume",
      url: "/admin",
    },
  ];

  // Metrics first, and the reason is the bound rather than importance. `bounded`
  // truncates from the end, and the roster grows without limit while these two
  // documents are a few hundred bytes between them — so putting the roster first
  // means the platform totals silently disappear on the day a tenant number
  // crosses a threshold, and every question about the whole book starts being
  // answered by summing whatever rows survived.
  return bounded([...metricDocuments, ...operatorDocuments]);
}

export async function createAdminKbAnswer(
  question: string,
  session: SessionProfile,
  supplied?: AdminKbDependencies,
): Promise<AdminKbResult> {
  // The route gates on the role too. This is the second refusal, and it is here
  // because the grounding below is cross-tenant by construction: a caller that
  // reached this function without the role must not get platform figures back
  // because one gate was edited.
  if (session.role !== "platform_admin") {
    return { answer: "This question cannot be processed.", citations: [], status: "unavailable" };
  }
  const trimmed = question.trim();
  if (trimmed.length < 1 || trimmed.length > 800) {
    return { answer: "This question cannot be processed.", citations: [], status: "unavailable" };
  }
  const deps = supplied ?? (await defaultDependencies());
  try {
    deps.onProgress?.({ stage: "searching" });
    const documents = await buildAdminGrounding(deps);
    // Not `documents.length === 0`, which cannot happen: the two platform
    // figures are unconditional, so a length check would be an arm nothing can
    // reach. The condition that actually matters is a roster with no operator in
    // it — every question this scope exists for is a comparison across tenants,
    // and two totals with nothing to attribute them to answers none of them.
    if (!documents.some((document) => document.id.startsWith(ADMIN_OPERATOR_PREFIX))) {
      return {
        answer: "There is not enough recorded platform data to answer that.",
        citations: [],
        status: "insufficient_grounding",
      };
    }
    const answer = await runGroundedChat({
      documents,
      prompt: ADMIN_KB_PROMPT,
      question: trimmed,
      transport: deps.transport(),
      onProgress: deps.onProgress,
    });
    if (answer === null) {
      return {
        answer: "A grounded answer is unavailable right now.",
        citations: [],
        status: "unavailable",
      };
    }
    const body = { bullets: answer.bullets, headline: answer.headline };
    return {
      ...body,
      answer: encodeAnswerBody(body),
      citations: answer.citations,
      footer: null,
      status: "answered",
    };
  } catch (cause) {
    // Four reads run before a token is generated, and a failure in any of them
    // looks identical to a model refusal from the surface. F-04's lesson, in the
    // one place this lane adds a new read path.
    recordRouteFailure({
      cause,
      code: "KB_ADMIN_GROUNDING_FAILED",
      status: 200,
      surface: "kb.admin",
    });
    return {
      answer: "A grounded answer is unavailable right now.",
      citations: [],
      status: "unavailable",
    };
  }
}
