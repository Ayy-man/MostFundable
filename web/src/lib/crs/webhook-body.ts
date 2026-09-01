import { CRS_WEBHOOK_MAX_BATCH_COUNT, CRS_WEBHOOK_MAX_BODY_BYTES } from './constants.ts';

export type BoundedWebhookBody =
  | { ok: true; rawBody: string }
  | { ok: false; status: 413 };

export async function readBoundedWebhookBody(request: Request): Promise<BoundedWebhookBody> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const bytes = Number(declared);
    if (Number.isFinite(bytes) && bytes > CRS_WEBHOOK_MAX_BODY_BYTES) {
      return { ok: false, status: 413 };
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: true, rawBody: '' };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > CRS_WEBHOOK_MAX_BODY_BYTES) {
      await reader.cancel();
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const rawBody = new TextDecoder().decode(bytes);
  try {
    const decoded: unknown = JSON.parse(rawBody);
    if (Array.isArray(decoded) && decoded.length > CRS_WEBHOOK_MAX_BATCH_COUNT) {
      return { ok: false, status: 413 };
    }
  } catch {
    // Shape errors stay with the authenticated webhook parser.
  }
  return { ok: true, rawBody };
}
