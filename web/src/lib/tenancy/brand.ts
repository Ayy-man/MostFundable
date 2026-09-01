import { randomUUID } from "node:crypto";

import { TenantError } from "./errors.ts";
import { assertTenantWriteAllowed } from "./wall.ts";
import type { InviteActor } from "./invites.ts";
import type { TenancyRepository } from "./repository.ts";
import type { PublishedBrand } from "./types.ts";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
// Postgres `uuid` shape, not strict RFC-4122: seeded ids carry zero version/variant nibbles (GAPS G-3B-06/07).
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_PORTAL_NAME_LENGTH = 120;

type LogoMime = "image/jpeg" | "image/png" | "image/webp";

export type BrandStorage = {
  upload(input: {
    bytes: Uint8Array;
    contentType: LogoMime;
    objectPath: string;
  }): Promise<{ publicUrl: string }>;
};

export type BrandDependencies = {
  id?: () => string;
  repository: TenancyRepository;
  storage: BrandStorage;
  supabaseUrl?: string;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validatedLogoUrl(value: unknown, orgId: string, supabaseUrl: string | undefined): string {
  if (typeof value !== "string" || value.length > 2048 || !supabaseUrl) {
    throw new TenantError(400, "INVALID_TENANT_INPUT", "The brand input is invalid.");
  }
  let url: URL;
  let storage: URL;
  try { url = new URL(value); storage = new URL(supabaseUrl); } catch {
    throw new TenantError(400, "INVALID_TENANT_INPUT", "The brand input is invalid.");
  }
  const prefix = `/storage/v1/object/public/brand-assets/${orgId}/`;
  // Plain http is accepted only for the local stack's loopback storage origin
  // (`supabase start` serves http://127.0.0.1:54521); every hosted origin is https.
  const loopbackStorage =
    storage.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(storage.hostname);
  if (
    (url.protocol !== "https:" && !loopbackStorage) || url.origin !== storage.origin ||
    !url.pathname.startsWith(prefix) || url.pathname.length === prefix.length ||
    url.username || url.password || url.search || url.hash
  ) {
    throw new TenantError(400, "INVALID_TENANT_INPUT", "The brand input is invalid.");
  }
  return url.toString();
}

export function parseBrandPatch(
  value: unknown,
  scope?: { orgId: string; supabaseUrl: string | undefined },
): PublishedBrand {
  const source = object(value);
  const allowed = ["accentColor", "logoUrl", "portalName", "primaryColor"];
  if (!source || Object.keys(source).length === 0 || Object.keys(source).some((key) => !allowed.includes(key))) {
    throw new TenantError(400, "INVALID_TENANT_INPUT", "The brand input is invalid.");
  }
  const brand: PublishedBrand = {};
  for (const key of ["accentColor", "primaryColor"] as const) {
    if (key in source) {
      if (typeof source[key] !== "string" || !HEX_COLOR.test(source[key] as string)) {
        throw new TenantError(400, "INVALID_TENANT_INPUT", "The brand input is invalid.");
      }
      brand[key] = (source[key] as string).toLowerCase();
    }
  }
  if ("logoUrl" in source) {
    if (!scope) throw new TenantError(400, "INVALID_TENANT_INPUT", "The brand input is invalid.");
    brand.logoUrl = validatedLogoUrl(source.logoUrl, scope.orgId, scope.supabaseUrl);
  }
  if ("portalName" in source) {
    if (typeof source.portalName !== "string") {
      throw new TenantError(400, "INVALID_TENANT_INPUT", "The brand input is invalid.");
    }
    const portalName = source.portalName.trim();
    if (portalName.length < 1 || portalName.length > MAX_PORTAL_NAME_LENGTH) {
      throw new TenantError(400, "INVALID_TENANT_INPUT", "The brand input is invalid.");
    }
    brand.portalName = portalName;
  }
  return brand;
}

function detectedMime(bytes: Uint8Array): LogoMime | null {
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

function extension(mime: LogoMime): "jpg" | "png" | "webp" {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  return "webp";
}

function requireManager(actor: InviteActor): asserts actor is InviteActor & { orgId: string } {
  if (
    actor.role !== "operator_member" || actor.disabledAt !== null || !actor.orgId ||
    (actor.orgRole !== "owner" && actor.orgRole !== "admin")
  ) {
    throw new TenantError(403, "TENANT_REQUEST_FAILED", "The tenant request is not permitted.");
  }
}

export function createBrandService(dependencies: BrandDependencies) {
  const id = dependencies.id ?? randomUUID;
  async function authorize(actor: InviteActor): Promise<InviteActor & { orgId: string }> {
    requireManager(actor);
    await assertTenantWriteAllowed(actor);
    return actor;
  }
  return {
    async update(actor: InviteActor, value: unknown): Promise<PublishedBrand> {
      const authorized = await authorize(actor);
      return dependencies.repository.updateBrand({
        actorId: authorized.id,
        brand: parseBrandPatch(value, { orgId: authorized.orgId, supabaseUrl: dependencies.supabaseUrl }),
        orgId: authorized.orgId,
      });
    },

    async uploadLogo(actor: InviteActor, input: {
      bytes: Uint8Array;
      mimeType: string;
    }): Promise<PublishedBrand> {
      const authorized = await authorize(actor);
      if (input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_LOGO_BYTES) {
        throw new TenantError(400, "INVALID_TENANT_INPUT", "The logo input is invalid.");
      }
      const mime = detectedMime(input.bytes);
      if (!mime || mime !== input.mimeType) {
        throw new TenantError(400, "INVALID_TENANT_INPUT", "The logo input is invalid.");
      }
      const objectId = id();
      if (!UUID_PATTERN.test(objectId)) throw new Error("TENANT_BRAND_ID_INVALID");
      const objectPath = `${authorized.orgId}/${objectId}.${extension(mime)}`;
      const uploaded = await dependencies.storage.upload({
        bytes: input.bytes,
        contentType: mime,
        objectPath,
      });
      return dependencies.repository.updateBrand({
        actorId: authorized.id,
        brand: { logoUrl: validatedLogoUrl(uploaded.publicUrl, authorized.orgId, dependencies.supabaseUrl) },
        orgId: authorized.orgId,
      });
    },

    async publish(actor: InviteActor): Promise<{ publishedAt: string }> {
      const authorized = await authorize(actor);
      const state = await dependencies.repository.readBrand(authorized.orgId);
      if (!state?.slug) {
        throw new TenantError(409, "TENANT_CONFLICT", "The brand cannot be published.");
      }
      if (state.brand.logoUrl) {
        validatedLogoUrl(state.brand.logoUrl, authorized.orgId, dependencies.supabaseUrl);
      }
      return dependencies.repository.publishBrand({
        actorId: authorized.id,
        orgId: authorized.orgId,
      });
    },
  };
}

type StorageClient = {
  storage: {
    from(bucket: string): {
      getPublicUrl(path: string): { data: { publicUrl: string } };
      upload(path: string, bytes: Uint8Array, options: {
        contentType: string;
        upsert: boolean;
      }): Promise<{ error: unknown }>;
    };
  };
};

export function createBrandStorage(client: StorageClient): BrandStorage {
  return {
    async upload(input) {
      const bucket = client.storage.from("brand-assets");
      const { error } = await bucket.upload(input.objectPath, input.bytes, {
        contentType: input.contentType,
        upsert: false,
      });
      if (error) throw new Error("TENANT_BRAND_UPLOAD_FAILED");
      const { data } = bucket.getPublicUrl(input.objectPath);
      if (!data.publicUrl) throw new Error("TENANT_BRAND_UPLOAD_FAILED");
      return { publicUrl: data.publicUrl };
    },
  };
}

export async function productionBrandService() {
  const [{ createAdminClient }, repositoryModule] = await Promise.all([
    import("../supabase/admin.ts"),
    import("./repository.ts"),
  ]);
  return createBrandService({
    repository: await repositoryModule.productionTenancyRepository(),
    storage: createBrandStorage(createAdminClient() as unknown as StorageClient),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
}
