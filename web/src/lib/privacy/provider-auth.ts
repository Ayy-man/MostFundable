import "server-only";

interface ProviderUser {
  banned_until?: string;
  email?: string;
  id: string;
  phone?: string;
  user_metadata?: Record<string, unknown>;
}

type ProviderResult = PromiseLike<{
  data: { user: ProviderUser | null } | null;
  error: unknown;
}>;

interface ProviderAuthClient {
  auth: {
    admin: {
      getUserById(id: string): ProviderResult;
      updateUserById(id: string, attributes: {
        ban_duration: string;
        email: string;
        email_confirm: boolean;
        phone: string;
        user_metadata: { privacy_erased: true };
      }): ProviderResult;
    };
  };
}

export interface PrivacyProviderAuth {
  disable(profileId: string, pseudonymEmail: string): Promise<void>;
}

async function productionClient(): Promise<ProviderAuthClient> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as ProviderAuthClient;
}

function erasedMetadata(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as Record<string, unknown>).privacy_erased === true;
}

function verified(user: ProviderUser | null, profileId: string, pseudonymEmail: string): boolean {
  return user?.id === profileId
    && user.email === pseudonymEmail
    && !user.phone
    && typeof user.banned_until === "string"
    && Date.parse(user.banned_until) > Date.now()
    && erasedMetadata(user.user_metadata);
}

export function createPrivacyProviderAuth(
  createClient: () => ProviderAuthClient | Promise<ProviderAuthClient> = productionClient,
): PrivacyProviderAuth {
  let clientPromise: Promise<ProviderAuthClient> | null = null;
  const client = () => (clientPromise ??= Promise.resolve(createClient()));
  return {
    async disable(profileId, pseudonymEmail) {
      const admin = (await client()).auth.admin;
      const updated = await admin.updateUserById(profileId, {
        ban_duration: "876000h",
        email: pseudonymEmail,
        email_confirm: true,
        phone: "",
        user_metadata: { privacy_erased: true },
      });
      if (updated.error || !verified(updated.data?.user ?? null, profileId, pseudonymEmail)) {
        throw new Error("PRIVACY_AUTH_DISABLE_FAILED");
      }
      const readBack = await admin.getUserById(profileId);
      if (readBack.error || !verified(readBack.data?.user ?? null, profileId, pseudonymEmail)) {
        throw new Error("PRIVACY_AUTH_VERIFY_FAILED");
      }
    },
  };
}
