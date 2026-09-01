import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  handleUpdatePassword,
  passwordValidationError,
  type UpdatePasswordDependencies,
} from "./route.ts";

function request(password: unknown): Request {
  return new Request("https://workspace.example/api/auth/update-password", {
    body: JSON.stringify({ password }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function dependencies(
  updates: string[],
  overrides: Partial<UpdatePasswordDependencies> = {},
): UpdatePasswordDependencies {
  return {
    async createClient() {
      return {
        auth: {
          async getUser() {
            return { data: { user: { id: "11111111-1111-4111-8111-111111111111" } }, error: null };
          },
          async updateUser({ password }) {
            updates.push(password);
            return { error: null };
          },
        },
      };
    },
    enabled: () => true,
    ...overrides,
  };
}

describe("password update", () => {
  it("requires a 12 to 128 character password", () => {
    assert.equal(passwordValidationError("short"), "password_too_short");
    assert.equal(passwordValidationError("x".repeat(129)), "password_too_long");
    assert.equal(passwordValidationError("long-enough-1"), null);
  });

  it("updates only after verifying the recovery session", async () => {
    const updates: string[] = [];
    const response = await handleUpdatePassword(
      request("a-new-password-123"),
      dependencies(updates),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { updated: true });
    assert.deepEqual(updates, ["a-new-password-123"]);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  it("refuses an absent session before attempting the update", async () => {
    const updates: string[] = [];
    const response = await handleUpdatePassword(
      request("a-new-password-123"),
      dependencies(updates, {
        async createClient() {
          return {
            auth: {
              async getUser() {
                return { data: { user: null }, error: new Error("expired") };
              },
              async updateUser() {
                throw new Error("must not update");
              },
            },
          };
        },
      }),
    );
    assert.equal(response.status, 401);
    assert.equal(updates.length, 0);
  });
});
