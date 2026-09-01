import "server-only";

import type { TenantInviteSender } from "./admin.ts";

type InviteAuthClient = {
  auth: {
    admin: {
      inviteUserByEmail(
        email: string,
        options: { data: { invite_id: string } },
      ): Promise<{ data: { user: { id?: string | null } | null }; error: unknown }>;
    };
  };
};

export function createInviteMailSender(client: InviteAuthClient): TenantInviteSender {
  return {
    async send({ email, inviteId }) {
      const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
        data: { invite_id: inviteId },
      });
      if (error || !data.user?.id) throw new Error("TENANT_INVITE_PROVIDER_UNAVAILABLE");
      return { providerUserId: data.user.id };
    },
  };
}

export async function productionInviteMailSender(): Promise<TenantInviteSender> {
  const { createAdminClient } = await import("../supabase/admin.ts");
  return createInviteMailSender(createAdminClient() as unknown as InviteAuthClient);
}

