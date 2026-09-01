import { buildConsumerOptimization } from "./map.ts";

import type { SessionProfile } from "../auth/session.ts";
import type { ConsumerChecklistStateRow, ConsumerOptimizationSourceV1 } from "./map.ts";
import type { ConsumerOptimizationV1 } from "./types.ts";

export type OptimizationErrorCode = "forbidden" | "read_failed";

export class OptimizationDataError extends Error {
  readonly name = "OptimizationDataError";
  readonly code: OptimizationErrorCode;

  // Not a constructor parameter property: Node's strip-only TypeScript mode rejects those, and
  // this module is reachable from `node --test`.
  constructor(code: OptimizationErrorCode) {
    super("Optimization read failed");
    this.code = code;
  }
}

/**
 * The rows this read needs, and the only way it can obtain them.
 *
 * Every method takes the client id rather than a filter, and the id is never a caller's to choose:
 * `readConsumerOptimizationWith` resolves it from the session first and passes that one value to
 * everything. The seam exists so the orchestration below is testable without a database; it is not
 * a place to widen scope.
 */
export interface OptimizationGateway {
  /** Client rows this session's own RLS predicate lets it see. A consumer should have exactly one. */
  resolveConsumerClientIds(session: SessionProfile): Promise<string[]>;
  readLatestPlan(clientId: string): Promise<ConsumerOptimizationSourceV1["plan"]>;
  readLatestRun(clientId: string): Promise<ConsumerOptimizationSourceV1["run"]>;
  readChecklistStates(clientId: string): Promise<ConsumerChecklistStateRow[]>;
}

/**
 * Read the signed-in consumer's Optimization view.
 *
 * Two guards, in this order, before any row is touched:
 *
 *  1. The role must be `consumer`. An operator or admin reading this shape would be reading one
 *     named consumer's derived credit picture through a route built for self-service, so it is
 *     refused here as well as at the route, not only at the route.
 *  2. The session must scope to exactly one client. Zero means there is nothing to show; more than
 *     one means we do not know whose view this is, and a guess would show one consumer another
 *     consumer's file. Both answer null.
 *
 * Failures THROW. They are never folded into a null, because null is the healthy "no workspace
 * yet" answer and the surface renders it as an empty state; mapping an outage onto it would draw a
 * blank Optimization view over a broken read.
 */
export async function readConsumerOptimizationWith(
  session: SessionProfile,
  gateway: OptimizationGateway,
): Promise<ConsumerOptimizationV1 | null> {
  if (session.role !== "consumer") throw new OptimizationDataError("forbidden");

  const clientIds = await gateway.resolveConsumerClientIds(session);
  if (clientIds.length !== 1) return null;
  const clientId = clientIds[0];

  const [plan, run, checklistStates] = await Promise.all([
    gateway.readLatestPlan(clientId),
    gateway.readLatestRun(clientId),
    gateway.readChecklistStates(clientId),
  ]);

  return buildConsumerOptimization({ checklistStates, clientId, plan, run });
}
