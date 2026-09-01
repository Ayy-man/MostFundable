import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPrivacyProviderAuth } from "./provider-auth.ts";

const PROFILE = "41600000-0000-4000-8000-000000000002";
const EMAIL = "deleted+41600000000040008000000000000002@privacy.invalid";

describe("privacy provider auth", () => {
  it("bans, pseudonymizes, marks erasure, and requires provider read-back", async () => {
    const calls: unknown[] = [];
    const user = {
      banned_until: "2126-09-01T00:00:00.000Z",
      email: EMAIL,
      id: PROFILE,
      phone: "",
      // GoTrue may merge metadata. The provider read-back proves the marker;
      // the final database transaction strips any remaining keys.
      user_metadata: { full_name: "Provider residue", privacy_erased: true },
    };
    const auth = createPrivacyProviderAuth(() => ({
      auth: { admin: {
        async getUserById(id: string) { calls.push(["get", id]); return { data: { user }, error: null }; },
        async updateUserById(id: string, attributes: unknown) {
          calls.push(["update", id, attributes]);
          return { data: { user }, error: null };
        },
      } },
    }));
    await auth.disable(PROFILE, EMAIL);
    assert.deepEqual(calls, [
      ["update", PROFILE, {
        ban_duration: "876000h",
        email: EMAIL,
        email_confirm: true,
        phone: "",
        user_metadata: { privacy_erased: true },
      }],
      ["get", PROFILE],
    ]);
  });

  it("refuses a successful provider write whose read-back still contains identity data", async () => {
    const auth = createPrivacyProviderAuth(() => ({
      auth: { admin: {
        async getUserById() { return { data: { user: null }, error: null }; },
        async updateUserById() {
          return { data: { user: {
            banned_until: "2126-09-01T00:00:00.000Z",
            email: "old@example.test",
            id: PROFILE,
            user_metadata: { full_name: "Still here" },
          } }, error: null };
        },
      } },
    }));
    await assert.rejects(auth.disable(PROFILE, EMAIL), /PRIVACY_AUTH_DISABLE_FAILED/);
  });
});
