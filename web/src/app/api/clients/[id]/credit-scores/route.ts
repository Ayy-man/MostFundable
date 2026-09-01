import { recordRouteFailure, withCorrelationId } from '@/lib/diagnostics/route-failure';
import { featureFlag } from '@/lib/env';
import { parseCreditScoresResponse } from '@/lib/operator/credit-scores.client';
import { isTrackerUuid } from '@/lib/tracker/types';

import type { SessionProfile } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

type RouteContext = { params: Promise<{ id: string }> };

interface Dependencies {
  readonly clientReachable: (session: SessionProfile, clientId: string) => Promise<boolean>;
  readonly readScores: (clientId: string) => Promise<unknown>;
  readonly requireRole: typeof import('@/lib/auth/session').requireRole;
  readonly trackerEnabled: () => boolean;
}

async function productionDependencies(): Promise<Dependencies> {
  const [{ requireRole }, { clientReachable }, { readOperatorCreditScores }] = await Promise.all([
    import('@/lib/auth/session'),
    import('@/lib/applications/access'),
    import('@/lib/crs/operator-scores'),
  ]);
  return {
    clientReachable,
    readScores: readOperatorCreditScores,
    requireRole,
    trackerEnabled: () => featureFlag('FEATURE_TRACKER'),
  };
}

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { headers: privateHeaders, status });
}

function accessStatus(error: unknown): 401 | 403 | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null;
  return error.status === 401 || error.status === 403 ? error.status : null;
}

export async function handleGetCreditScores(
  context: RouteContext,
  dependencies?: Dependencies,
): Promise<Response> {
  const resolved = dependencies ?? await productionDependencies();
  if (!resolved.trackerEnabled()) {
    return errorResponse('tracker_disabled', 'Funding readiness tracking is disabled.', 503);
  }

  const { id } = await context.params;
  if (!isTrackerUuid(id)) return errorResponse('invalid_request', 'Client id must be a UUID.', 400);

  try {
    const session = await resolved.requireRole('operator_member', 'platform_admin');
    if (!(await resolved.clientReachable(session, id))) {
      return errorResponse('client_not_found', 'The funding readiness client was not found.', 404);
    }
    const scores = parseCreditScoresResponse(await resolved.readScores(id));
    if (scores === null) throw new Error('CREDIT_SCORES_RESPONSE_INVALID');
    return Response.json(scores, { headers: privateHeaders, status: 200 });
  } catch (error) {
    const status = accessStatus(error);
    if (status !== null) {
      return errorResponse(
        status === 401 ? 'session_required' : 'role_forbidden',
        status === 401 ? 'Sign in to view credit scores.' : 'This account cannot view credit scores.',
        status,
      );
    }
    const correlationId = recordRouteFailure({
      cause: error,
      code: 'credit_scores_unavailable',
      status: 503,
      surface: 'api.clients.credit-scores',
    });
    return Response.json(
      withCorrelationId({ error: { code: 'credit_scores_unavailable', message: 'Current credit scores are unavailable.' } }, correlationId),
      { headers: privateHeaders, status: 503 },
    );
  }
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleGetCreditScores(context);
}
