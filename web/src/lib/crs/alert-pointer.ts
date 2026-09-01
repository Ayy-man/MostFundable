import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import {
  CRS_ALERT_POINTER_KEY_VERSION,
  CRS_ALERT_POINTER_RETENTION_DAYS,
} from './alert-storage-rule.ts';
import { createMonitoringProviderEventKey } from './ports.ts';

import type {
  MonitoringProviderEventKey,
  ProtectedCrsAlertPointer,
} from './ports.ts';

const KEY_NAMESPACE = 'mostfundable.crs-alert-pointer.v1';
const IV_BYTES = 12;
const MIN_SECRET_BYTES = 32;

export interface CrsAlertPointerCodec {
  protectHookId(hookId: string): MonitoringProviderEventKey;
  protectAlertId(input: {
    alertId: string;
    alertReportedAt: string;
    receivedAt: string;
  }): ProtectedCrsAlertPointer;
  openAlertId(pointer: Pick<
    ProtectedCrsAlertPointer,
    'alertIdCiphertext' | 'alertIdIv' | 'alertIdTag' | 'keyVersion'
  >): string;
}

function deriveKey(secret: string, purpose: 'alert-encryption' | 'alert-lookup' | 'hook-lookup'): Buffer {
  return createHash('sha256')
    .update(KEY_NAMESPACE, 'utf8')
    .update('\0', 'utf8')
    .update(purpose, 'utf8')
    .update('\0', 'utf8')
    .update(secret, 'utf8')
    .digest();
}

function keyedLookup(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

function validSecret(secret: string): boolean {
  return Buffer.byteLength(secret, 'utf8') >= MIN_SECRET_BYTES;
}

export function readCrsAlertPointerSecret(env: NodeJS.ProcessEnv): string | null {
  const value = env.CRS_ALERT_POINTER_SECRET;
  if (value === undefined || value.trim() === '' || !validSecret(value)) return null;
  return value;
}

export function createCrsAlertPointerCodec(secret: string): CrsAlertPointerCodec {
  if (!validSecret(secret)) throw new Error('CRS_ALERT_POINTER_SECRET_INVALID');

  const encryptionKey = deriveKey(secret, 'alert-encryption');
  const alertLookupKey = deriveKey(secret, 'alert-lookup');
  const hookLookupKey = deriveKey(secret, 'hook-lookup');
  const aad = Buffer.from(`${KEY_NAMESPACE}:${CRS_ALERT_POINTER_KEY_VERSION}`, 'utf8');

  return {
    protectHookId(hookId: string): MonitoringProviderEventKey {
      return createMonitoringProviderEventKey(keyedLookup(hookLookupKey, hookId));
    },

    protectAlertId(input): ProtectedCrsAlertPointer {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([
        cipher.update(input.alertId, 'utf8'),
        cipher.final(),
      ]);

      return {
        alertLookupKey: keyedLookup(alertLookupKey, input.alertId),
        alertIdCiphertext: ciphertext.toString('base64url'),
        alertIdIv: iv.toString('base64url'),
        alertIdTag: cipher.getAuthTag().toString('base64url'),
        keyVersion: CRS_ALERT_POINTER_KEY_VERSION,
        alertReportedAt: input.alertReportedAt,
        receivedAt: input.receivedAt,
        expiresAt: new Date(
          Date.parse(input.receivedAt)
            + CRS_ALERT_POINTER_RETENTION_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString(),
      };
    },

    openAlertId(pointer): string {
      try {
        if (pointer.keyVersion !== CRS_ALERT_POINTER_KEY_VERSION) throw new Error('version');
        const iv = Buffer.from(pointer.alertIdIv, 'base64url');
        const tag = Buffer.from(pointer.alertIdTag, 'base64url');
        if (iv.byteLength !== IV_BYTES || tag.byteLength !== 16) throw new Error('shape');
        const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
        decipher.setAAD(aad);
        decipher.setAuthTag(tag);
        return Buffer.concat([
          decipher.update(Buffer.from(pointer.alertIdCiphertext, 'base64url')),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        // Keep every corruption/wrong-key path identical and fixed; no provider value travels.
        throw new Error('CRS_ALERT_POINTER_OPEN_FAILED');
      }
    },
  };
}

export function protectedPointerMatchesAlertId(
  pointer: Pick<ProtectedCrsAlertPointer, 'alertLookupKey'>,
  alertId: string,
  secret: string,
): boolean {
  if (!validSecret(secret)) return false;
  const expected = Buffer.from(
    keyedLookup(deriveKey(secret, 'alert-lookup'), alertId),
    'hex',
  );
  const actual = Buffer.from(pointer.alertLookupKey, 'hex');
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}
