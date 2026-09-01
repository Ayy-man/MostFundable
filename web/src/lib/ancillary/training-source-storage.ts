import "server-only";

import type { TrainingSourceMimeType } from "./training-source-contract.ts";

export const TRAINING_SOURCE_BUCKET = "platform-training-sources" as const;

export interface TrainingSourceStorage {
  download(objectPath: string): Promise<Uint8Array>;
  exists(objectPath: string): Promise<boolean>;
  remove(objectPath: string): Promise<void>;
  replace(objectPath: string, bytes: Uint8Array, mimeType: TrainingSourceMimeType): Promise<void>;
  store(objectPath: string, bytes: Uint8Array, mimeType: TrainingSourceMimeType): Promise<void>;
}

interface StorageResult<T> {
  data: T | null;
  error: unknown;
}

interface StorageClient {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<StorageResult<Blob>>;
      list(path: string, options: { limit: number; search: string }): Promise<StorageResult<Array<{ name: string }>>>;
      remove(paths: string[]): Promise<StorageResult<unknown>>;
      upload(path: string, bytes: Uint8Array, options: {
        contentType: string;
        upsert: boolean;
      }): Promise<StorageResult<unknown>>;
    };
  };
}

async function storageClient(): Promise<StorageClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as StorageClient;
}

async function write(
  objectPath: string,
  bytes: Uint8Array,
  mimeType: TrainingSourceMimeType,
  upsert: boolean,
): Promise<void> {
  const client = await storageClient();
  const result = await client.storage.from(TRAINING_SOURCE_BUCKET).upload(objectPath, bytes, {
    contentType: mimeType,
    upsert,
  });
  if (result.error) throw new Error("TRAINING_SOURCE_STORAGE_FAILED");
}

export function createSupabaseTrainingSourceStorage(): TrainingSourceStorage {
  return {
    async download(objectPath) {
      const client = await storageClient();
      const result = await client.storage.from(TRAINING_SOURCE_BUCKET).download(objectPath);
      if (result.error || !result.data) throw new Error("TRAINING_SOURCE_DOWNLOAD_FAILED");
      return new Uint8Array(await result.data.arrayBuffer());
    },
    async exists(objectPath) {
      const slash = objectPath.lastIndexOf("/");
      const folder = objectPath.slice(0, slash);
      const name = objectPath.slice(slash + 1);
      const client = await storageClient();
      const result = await client.storage.from(TRAINING_SOURCE_BUCKET).list(folder, {
        limit: 2,
        search: name,
      });
      if (result.error || !result.data) throw new Error("TRAINING_SOURCE_VERIFY_FAILED");
      return result.data.some((entry) => entry.name === name);
    },
    async remove(objectPath) {
      const client = await storageClient();
      const result = await client.storage.from(TRAINING_SOURCE_BUCKET).remove([objectPath]);
      if (result.error) throw new Error("TRAINING_SOURCE_DELETE_FAILED");
    },
    async replace(objectPath, bytes, mimeType) {
      await write(objectPath, bytes, mimeType, true);
    },
    async store(objectPath, bytes, mimeType) {
      await write(objectPath, bytes, mimeType, false);
    },
  };
}
