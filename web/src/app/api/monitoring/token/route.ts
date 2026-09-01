import type { NextRequest } from 'next/server';

import { isAnalysisEnabled } from '@/lib/crs/feature-flag';
import { getCrsAdapter } from '@/lib/crs/adapter';
import { handleMonitoringTokenRequest } from '@/lib/crs/token';
import { getCrsRuntimePorts } from '@/lib/crs/wiring';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function GET(request: NextRequest): Promise<Response> {
  if (!isAnalysisEnabled(process.env)) {
    return new Response(null, { status: 404 });
  }

  const adapter = getCrsAdapter();
  const { session, resolver, clock } = getCrsRuntimePorts();
  const result = await handleMonitoringTokenRequest({
    url: new URL(request.url),
    headers: request.headers,
    env: process.env,
    adapter,
    session,
    resolver,
    clock,
  });

  if (result.body === null) {
    return new Response(null, { status: result.status });
  }

  return Response.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
