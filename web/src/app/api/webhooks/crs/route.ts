import { after, type NextRequest } from 'next/server';

import { isAnalysisEnabled } from '@/lib/crs/feature-flag';
import { getCrsAdapter } from '@/lib/crs/adapter';
import { handleCrsWebhook } from '@/lib/crs/webhook-handler';
import { readWebhookConfigFromEnv } from '@/lib/crs/webhook';
import { readBoundedWebhookBody } from '@/lib/crs/webhook-body';
import { createCrsAlertPointerCodec, readCrsAlertPointerSecret } from '@/lib/crs/alert-pointer';
import { getCrsRuntimePorts, prepareWebhookAcknowledgement } from '@/lib/crs/wiring';

export const runtime = 'nodejs';
// Post-response work shares this route's invocation deadline.
export const maxDuration = 30;
// R2C-10: a durable enqueue failure returns a batch-level 503 with no successful ack entries.

export async function POST(request: NextRequest): Promise<Response> {
  if (!isAnalysisEnabled(process.env)) {
    return new Response(null, { status: 404 });
  }

  // Active traffic must construct the selected adapter, even though webhook verification itself
  // is shared by both drivers. The flag-off path above deliberately never reaches this throw.
  getCrsAdapter();

  const body = await readBoundedWebhookBody(request);
  if (!body.ok) return Response.json({ error: 'payload_too_large' }, { status: body.status });
  const rawBody = body.rawBody;
  const pointerSecret = readCrsAlertPointerSecret(process.env);
  const { store, resolver, clock, enqueueFanOut, scheduleFanOut } = getCrsRuntimePorts();
  const handled = await handleCrsWebhook({
    headers: request.headers,
    rawBody,
    remoteAddress: null,
    config: readWebhookConfigFromEnv(process.env),
    store,
    resolver,
    clock,
    pointerCodec: pointerSecret === null ? null : createCrsAlertPointerCodec(pointerSecret),
  });
  const result = await prepareWebhookAcknowledgement(handled, enqueueFanOut);

  if (result.status === 200 && result.fanOut.length > 0) {
    after(() => scheduleFanOut(result.fanOut));
  }

  return Response.json(result.body, { status: result.status });
}
