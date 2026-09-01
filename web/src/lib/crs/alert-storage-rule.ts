/**
 * The Phase 0 alert-storage ruling approved on 2026-08-31.
 *
 * Alert detail remains fetch-on-read from CRS. The durable row is a pointer and operational
 * state only: provider identifiers are one-way keyed or encrypted, and the encrypted alert id
 * stops being readable after 90 days. Cancellation or monitoring-consent withdrawal purges the
 * row earlier through the existing derived-data purge rail.
 */
export const CRS_ALERT_POINTER_RETENTION_DAYS = 90 as const;
export const CRS_ALERT_POINTER_KEY_VERSION = 1 as const;

export const CRS_ALERT_POINTER_OPERATIONAL_FIELDS = [
  'client_id',
  'monitoring_event_id',
  'provider_hook_key',
  'provider_alert_key',
  'alert_id_ciphertext',
  'alert_id_iv',
  'alert_id_tag',
  'key_version',
  'occurred_at',
  'alert_reported_at',
  'received_at',
  'expires_at',
  'delivered_at',
  'read_at',
  'expired_at',
] as const;

export const CRS_ALERT_POINTER_FORBIDDEN_RAW_FIELDS = [
  'alert_id',
  'user_id',
  'host_id',
  'alert_source',
  'error_code',
  'error_msg',
  'creditor',
  'account_number',
  'balance',
  'narrative',
] as const;
