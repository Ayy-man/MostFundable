import { runCrsAlertBatch } from '../alert-retention.ts';
import { registerCadenceProvider, registerJobHandler } from '../../jobs/registry.ts';

export const CRS_ALERT_BATCH_OWNER_FLAGS = ['FEATURE_ANALYSIS'] as const;

function utcDate(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

registerJobHandler('crs.alert_batch', runCrsAlertBatch, CRS_ALERT_BATCH_OWNER_FLAGS);
registerCadenceProvider('crs.alert_batch', async (now) => [{
  job: 'crs.alert_batch',
  subject: 'global',
  window: utcDate(now),
}], CRS_ALERT_BATCH_OWNER_FLAGS);
