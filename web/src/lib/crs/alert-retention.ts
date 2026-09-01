import { createAdminClient } from '../supabase/admin.ts';

export interface CrsAlertRetentionRepository {
  scrubExpired(now: string, limit: number): Promise<number>;
}

export function createCrsAlertRetentionRepository(): CrsAlertRetentionRepository {
  let client: ReturnType<typeof createAdminClient> | null = null;
  return {
    async scrubExpired(now, limit) {
      client ??= createAdminClient();
      const { data, error } = await client.rpc('scrub_expired_crs_alert_pointers', {
        p_now: now,
        p_limit: limit,
      });
      if (error !== null || typeof data !== 'number' || !Number.isInteger(data) || data < 0) {
        throw new Error('CRS_ALERT_POINTER_PURGE_FAILED');
      }
      return data;
    },
  };
}

export async function runCrsAlertBatch(
  subject: string,
  _window: string,
  options: {
    now?: () => Date;
    repository?: CrsAlertRetentionRepository;
  } = {},
): Promise<{ status: 'ok' | 'failed'; rows?: number; code?: string }> {
  if (subject !== 'global') {
    return { status: 'failed', code: 'CRS_ALERT_BATCH_SUBJECT_INVALID' };
  }

  try {
    const now = (options.now ?? (() => new Date()))().toISOString();
    const rows = await (options.repository ?? createCrsAlertRetentionRepository())
      .scrubExpired(now, 500);
    return { status: 'ok', rows };
  } catch {
    return { status: 'failed', code: 'CRS_ALERT_POINTER_PURGE_FAILED' };
  }
}
