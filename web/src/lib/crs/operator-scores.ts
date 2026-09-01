import 'server-only';

import { getCrsAdapter } from './adapter.ts';
import { MonitoringInactiveError } from './ports.ts';
import { createSupabaseMemberRefResolver } from './supabase-ports.ts';

import type { CrsAdapter, ObservedCreditScore } from './types.ts';
import type { MemberRefResolver } from './ports.ts';

export type OperatorCreditScoresResult =
  | { readonly available: true; readonly scores: readonly ObservedCreditScore[] }
  | { readonly available: false; readonly reason: 'monitoring_inactive' | 'not_enrolled' | 'no_score' };

interface OperatorScoreDependencies {
  readonly adapter: Pick<CrsAdapter, 'driver' | 'getLatestScores'>;
  readonly resolver: Pick<MemberRefResolver, 'resolveForClient'>;
}

function productionDependencies(): OperatorScoreDependencies {
  return {
    adapter: getCrsAdapter(),
    resolver: createSupabaseMemberRefResolver(),
  };
}

/**
 * Read the current CRS scores without writing them anywhere. The resolver owns
 * the active-monitoring check, and the adapter returns only the three observed
 * numbers rather than the provider response that carried them.
 */
export async function readOperatorCreditScores(
  clientId: string,
  dependencies: OperatorScoreDependencies = productionDependencies(),
): Promise<OperatorCreditScoresResult> {
  let memberRef;
  try {
    memberRef = await dependencies.resolver.resolveForClient(clientId);
  } catch (error) {
    if (error instanceof MonitoringInactiveError) {
      return { available: false, reason: 'monitoring_inactive' };
    }
    throw error;
  }
  if (memberRef === null) return { available: false, reason: 'not_enrolled' };

  // Seeded workspaces created before the sandbox integration carry mock-only
  // member handles. Sending one to the provider waits through its retry budget
  // and ends as a 503, even though the durable fact is simply that this client
  // has no provider enrollment. Keep mock personas working under the mock
  // adapter, but fail closed and immediately once the real driver is selected.
  if (dependencies.adapter.driver !== 'mock' && memberRef.startsWith('mock_')) {
    return { available: false, reason: 'not_enrolled' };
  }

  const scores = await dependencies.adapter.getLatestScores(memberRef);
  return scores.length === 0
    ? { available: false, reason: 'no_score' }
    : { available: true, scores };
}
