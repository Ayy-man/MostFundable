import "server-only";

import type { PrivacyStorageTarget } from "./types.ts";

type StorageResult<T> = PromiseLike<{ data: T | null; error: unknown }>;
interface PrivacyStorageClient {
  storage: {
    from(bucket: PrivacyStorageTarget["bucket"]): {
      list(path: string, options: { limit: number; search: string }): StorageResult<Array<{ name: string }>>;
      remove(paths: string[]): StorageResult<unknown>;
    };
  };
}

export interface PrivacyStorage {
  exists(target: PrivacyStorageTarget): Promise<boolean>;
  remove(target: PrivacyStorageTarget): Promise<void>;
}

async function productionClient(): Promise<PrivacyStorageClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as PrivacyStorageClient;
}

export function createPrivacyStorage(
  createClient: () => PrivacyStorageClient | Promise<PrivacyStorageClient> = productionClient,
): PrivacyStorage {
  let clientPromise: Promise<PrivacyStorageClient> | null = null;
  const client = () => (clientPromise ??= Promise.resolve(createClient()));
  return {
    async exists(target) {
      const slash = target.objectPath.lastIndexOf("/");
      if (slash < 1) throw new Error("PRIVACY_STORAGE_TARGET_INVALID");
      const folder = target.objectPath.slice(0, slash);
      const name = target.objectPath.slice(slash + 1);
      const result = await (await client()).storage.from(target.bucket).list(folder, {
        limit: 2,
        search: name,
      });
      if (result.error || !result.data) throw new Error("PRIVACY_STORAGE_VERIFY_FAILED");
      return result.data.some((item) => item.name === name);
    },
    async remove(target) {
      const result = await (await client()).storage.from(target.bucket).remove([target.objectPath]);
      if (result.error) throw new Error("PRIVACY_STORAGE_REMOVE_FAILED");
    },
  };
}
