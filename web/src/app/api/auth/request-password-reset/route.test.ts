import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";

import {
  handlePasswordResetRequest,
  type PasswordResetRequestDependencies,
} from "./route.ts";

function request(body: unknown): NextRequest {
  return new NextRequest("https://workspace.example/api/auth/request-password-reset", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function dependencies(
  calls: Array<{ email: string; redirectTo: string }>,
  overrides: Partial<PasswordResetRequestDependencies> = {},
): PasswordResetRequestDependencies {
  return {
    async createClient() {
      return {
        auth: {
          async resetPasswordForEmail(email, options) {
            calls.push({ email, redirectTo: options.redirectTo });
            return { error: null };
          },
        },
      };
    },
    enabled: () => true,
    ...overrides,
  };
}

describe("password reset request", () => {
  it("sends the provider to the recovery form and reveals no account state", async () => {
    const calls: Array<{ email: string; redirectTo: string }> = [];
    const response = await handlePasswordResetRequest(
      request({ email: "  person@example.com " }),
      dependencies(calls),
    );

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { status: "accepted" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls[0]?.email, "person@example.com");
    const callback = new URL(calls[0]!.redirectTo);
    assert.equal(callback.origin, "https://workspace.example");
    assert.equal(callback.pathname, "/api/auth/confirm");
    assert.equal(callback.searchParams.get("next"), "/reset-password");
  });

  it("returns the same accepted projection when the provider refuses", async () => {
    const calls: Array<{ email: string; redirectTo: string }> = [];
    const response = await handlePasswordResetRequest(
      request({ email: "unknown@example.com" }),
      dependencies(calls, {
        async createClient() {
          return {
            auth: {
              async resetPasswordForEmail() {
                return { error: { code: "user_not_found" } };
              },
            },
          };
        },
      }),
    );
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { status: "accepted" });
  });

  it("rejects malformed bodies and stays absent when auth is off", async () => {
    const calls: Array<{ email: string; redirectTo: string }> = [];
    assert.equal(
      (await handlePasswordResetRequest(request({ email: "bad" }), dependencies(calls))).status,
      400,
    );
    assert.equal(
      (
        await handlePasswordResetRequest(
          request({ email: "person@example.com" }),
          dependencies(calls, { enabled: () => false }),
        )
      ).status,
      404,
    );
    assert.equal(calls.length, 0);
  });
});
