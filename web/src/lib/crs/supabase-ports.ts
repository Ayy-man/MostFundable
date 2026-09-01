import {
  monitoringEventIdForProviderKey,
  MonitoringInactiveError,
} from './ports.ts';

import type {
  MemberRefResolver,
  MonitoringEventRecord,
  MonitoringEventStore,
  MonitoringProviderEventKey,
  ProtectedCrsAlertPointer,
} from './ports.ts';
import type { CrsMemberRef } from './types.ts';

export type CrsAdminClient = ReturnType<
  (typeof import('../supabase/admin.ts'))['createAdminClient']
>;

interface SupabasePortOptions {
  createClient?: () => CrsAdminClient | Promise<CrsAdminClient>;
}

async function createProductionClient(): Promise<CrsAdminClient> {
  const { createAdminClient } = await import('../supabase/admin.ts');
  return createAdminClient();
}

function lazyClient(options: SupabasePortOptions): () => Promise<CrsAdminClient> {
  let client: Promise<CrsAdminClient> | null = null;
  return () => {
    if (client === null) {
      client = Promise.resolve((options.createClient ?? createProductionClient)());
    }
    return client;
  };
}

function monitoringRowsEqual(
  row: {
    id: string;
    client_id: string;
    event_type: string;
    occurred_at: string;
    received_at: string;
  },
  expected: {
    id: string;
    client_id: string;
    event_type: string;
    occurred_at: string;
    received_at: string;
  },
): boolean {
  return (
    row.id === expected.id &&
    row.client_id === expected.client_id &&
    row.event_type === expected.event_type &&
    row.occurred_at === expected.occurred_at
  );
}

interface StoredAlertPointerRow {
  id: string;
  client_id: string;
  monitoring_event_id: string;
  provider_hook_key: string;
  provider_alert_key: string;
  alert_id_ciphertext: string | null;
  alert_id_iv: string | null;
  alert_id_tag: string | null;
  key_version: number;
  occurred_at: string;
  alert_reported_at: string;
  received_at: string;
  expires_at: string;
  delivered_at: string | null;
  read_at: string | null;
  expired_at: string | null;
}

function alertPointerRowsMatch(
  row: StoredAlertPointerRow,
  expected: Omit<StoredAlertPointerRow, 'id' | 'delivered_at' | 'read_at' | 'expired_at'>,
): boolean {
  return row.client_id === expected.client_id
    && row.monitoring_event_id === expected.monitoring_event_id
    && row.provider_hook_key === expected.provider_hook_key
    && row.provider_alert_key === expected.provider_alert_key
    && row.key_version === expected.key_version
    && row.occurred_at === expected.occurred_at
    && row.alert_reported_at === expected.alert_reported_at;
}

export function createSupabaseMonitoringEventStore(
  options: SupabasePortOptions = {},
): MonitoringEventStore {
  const getClient = lazyClient(options);

  return {
    async record(
      event: MonitoringEventRecord,
      providerKey: MonitoringProviderEventKey,
      alertPointer?: ProtectedCrsAlertPointer,
    ) {
      const client = await getClient();
      const row = {
        id: monitoringEventIdForProviderKey(providerKey),
        client_id: event.clientId,
        event_type: event.eventType,
        occurred_at: event.occurredAt,
        received_at: event.receivedAt,
      };
      const write = await client
        .from('monitoring_events')
        .upsert(row, { onConflict: 'id', ignoreDuplicates: true });
      if (write.error !== null) throw new Error('MONITORING_EVENT_STORE_FAILED');

      const result = await client
        .from('monitoring_events')
        .select('id,client_id,event_type,occurred_at,received_at')
        .eq('id', row.id)
        .maybeSingle();
      if (result.error !== null || result.data === null) {
        throw new Error('MONITORING_EVENT_STORE_FAILED');
      }
      if (!monitoringRowsEqual(result.data, row)) {
        throw new Error('MONITORING_EVENT_MISMATCH');
      }

      if (alertPointer !== undefined) {
        const pointerRow = {
          client_id: event.clientId,
          monitoring_event_id: row.id,
          provider_hook_key: providerKey,
          provider_alert_key: alertPointer.alertLookupKey,
          alert_id_ciphertext: alertPointer.alertIdCiphertext,
          alert_id_iv: alertPointer.alertIdIv,
          alert_id_tag: alertPointer.alertIdTag,
          key_version: alertPointer.keyVersion,
          occurred_at: event.occurredAt,
          alert_reported_at: alertPointer.alertReportedAt,
          received_at: alertPointer.receivedAt,
          expires_at: alertPointer.expiresAt,
        };
        const pointerWrite = await client
          .from('crs_alert_pointers')
          .upsert(pointerRow, { onConflict: 'provider_hook_key', ignoreDuplicates: true });
        if (pointerWrite.error !== null) throw new Error('CRS_ALERT_POINTER_STORE_FAILED');

        const pointerResult = await client
          .from('crs_alert_pointers')
          .select('id,client_id,monitoring_event_id,provider_hook_key,provider_alert_key,alert_id_ciphertext,alert_id_iv,alert_id_tag,key_version,occurred_at,alert_reported_at,received_at,expires_at,delivered_at,read_at,expired_at')
          .eq('provider_hook_key', providerKey)
          .maybeSingle();
        if (pointerResult.error !== null || pointerResult.data === null) {
          throw new Error('CRS_ALERT_POINTER_STORE_FAILED');
        }
        if (!alertPointerRowsMatch(pointerResult.data, pointerRow)) {
          throw new Error('CRS_ALERT_POINTER_MISMATCH');
        }
      }
      return { id: row.id };
    },
  };
}

export function createSupabaseMemberRefResolver(
  options: SupabasePortOptions = {},
): MemberRefResolver {
  const getClient = lazyClient(options);

  async function requireMonitoring(client: CrsAdminClient, clientId: string): Promise<void> {
    const result = await (client as unknown as {
      rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
    }).rpc('monitoring_is_authorized', { p_client_id: clientId });
    if (result.error !== null) throw new Error('MEMBER_REF_LOOKUP_FAILED');
    if (result.data !== true) throw new MonitoringInactiveError();
  }

  return {
    async resolveForClient(clientId: string): Promise<CrsMemberRef | null> {
      const client = await getClient();
      const result = await client
        .from('enrollments')
        .select('client_id,crs_member_ref,status')
        .eq('client_id', clientId)
        .maybeSingle();
      if (result.error !== null) throw new Error('MEMBER_REF_LOOKUP_FAILED');
      if (result.data === null || result.data.crs_member_ref === null) return null;
      if (result.data.status === 'cancelled') throw new MonitoringInactiveError();
      await requireMonitoring(client, result.data.client_id);
      return result.data.crs_member_ref as CrsMemberRef;
    },

    async resolveClientForMember(memberRef: CrsMemberRef): Promise<string | null> {
      const client = await getClient();
      const result = await client
        .from('enrollments')
        .select('client_id,crs_member_ref,status')
        .eq('crs_member_ref', memberRef)
        .maybeSingle();
      if (result.error !== null) throw new Error('MEMBER_REF_LOOKUP_FAILED');
      if (result.data === null || result.data.crs_member_ref !== memberRef) return null;
      if (result.data.status === 'cancelled') throw new MonitoringInactiveError();
      await requireMonitoring(client, result.data.client_id);
      return result.data.client_id;
    },
  };
}
