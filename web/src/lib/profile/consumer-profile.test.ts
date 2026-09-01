import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseConsumerProfileRead,
  readConsumerProfile,
  parseConsumerProfileUpdate,
  updateConsumerProfile,
} from "./consumer-profile.ts";
import {
  handleConsumerProfileRead,
  handleConsumerProfileUpdate,
  mapConsumerProfileRow,
  type ConsumerProfileDependencies,
} from "./consumer-profile.server.ts";

const PROFILE = "00000000-0000-4000-8000-000000004112";
const ORG = "00000000-0000-4000-8000-000000004111";
const stored = { email: "old@test.example", name: "Jordan Newcomer", phone: "+1 555 123 4567" } as const;

function request(value: unknown): Request {
  return new Request("https://app.example.test/api/consumer/profile", {
    body: JSON.stringify(value),
    method: "PATCH",
  });
}

function dependencies(overrides: Partial<ConsumerProfileDependencies> = {}): ConsumerProfileDependencies {
  return {
    async readProfile(profileId) { assert.equal(profileId, PROFILE); return stored; },
    async requestEmailChange() {},
    async requireConsumer() { return { id: PROFILE, orgId: ORG, role: "consumer" }; },
    async updateProfile(fullName, phone) {
      assert.deepEqual([fullName, phone], ["Jordan Newcomer", "+1 555 123 4567"]);
      return stored;
    },
    ...overrides,
  };
}

describe("consumer profile update", () => {
  it("reads the signed-in consumer profile before an edit starts", async () => {
    const response = await handleConsumerProfileRead(dependencies());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { profile: stored });

    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return Response.json({ profile: stored });
    }) as typeof fetch;
    assert.deepEqual(await readConsumerProfile(fetcher), { profile: stored, status: "ready" });
    assert.equal(String(calls[0]?.input), "/api/consumer/profile");
    assert.equal(calls[0]?.init?.credentials, "same-origin");
    assert.deepEqual(parseConsumerProfileRead({ profile: stored }), stored);
    assert.deepEqual(parseConsumerProfileRead({ profile: { ...stored, phone: "" } }), {
      ...stored,
      phone: "",
    });
  });

  it("maps a seeded nullable phone to an editable empty value", () => {
    const nullablePhone = mapConsumerProfileRow({
      email: "consumer@test.example",
      full_name: "Seeded Consumer",
      phone: null,
    });
    assert.deepEqual(nullablePhone, {
      email: "consumer@test.example",
      name: "Seeded Consumer",
      phone: "",
    });
    assert.deepEqual(parseConsumerProfileRead({ profile: nullablePhone }), nullablePhone);
  });

  it("does not turn an unreadable profile into blank editable fields", async () => {
    const fetcher = (async () => new Response(null, { status: 503 })) as typeof fetch;
    assert.deepEqual(await readConsumerProfile(fetcher), { status: "unavailable" });
  });

  it("stores name and phone and reports an unchanged email", async () => {
    let emailRequests = 0;
    const response = await handleConsumerProfileUpdate(request({
      email: "OLD@test.example",
      fullName: " Jordan Newcomer ",
      phone: "+1 555 123 4567",
    }), dependencies({ async requestEmailChange() { emailRequests += 1; } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { emailChange: "unchanged", profile: stored });
    assert.equal(emailRequests, 0);
  });

  it("allows name and email edits when the optional phone is empty", async () => {
    let savedPhone: string | null = null;
    const withoutPhone = { ...stored, phone: "" };
    const response = await handleConsumerProfileUpdate(request({
      email: stored.email,
      fullName: stored.name,
      phone: "",
    }), dependencies({
      async updateProfile(fullName, phone) {
        assert.equal(fullName, stored.name);
        savedPhone = phone;
        return withoutPhone;
      },
    }));
    assert.equal(response.status, 200);
    assert.equal(savedPhone, "");
    assert.deepEqual(await response.json(), { emailChange: "unchanged", profile: withoutPhone });
  });

  it("reports provider confirmation as pending until the profile email changes", async () => {
    const response = await handleConsumerProfileUpdate(request({
      email: "new@test.example",
      fullName: "Jordan Newcomer",
      phone: "+1 555 123 4567",
    }), dependencies());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { emailChange: "pending", profile: stored });
  });

  it("returns the saved profile with a distinct email failure instead of claiming atomic rollback", async () => {
    const response = await handleConsumerProfileUpdate(request({
      email: "new@test.example",
      fullName: "Jordan Newcomer",
      phone: "+1 555 123 4567",
    }), dependencies({ async requestEmailChange() { throw new Error("provider down"); } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { emailChange: "failed", profile: stored });
  });

  it("rejects unknown fields and invalid profile input before authorization or writes", async () => {
    let calls = 0;
    const deps = dependencies({ async requireConsumer() { calls += 1; throw new Error("must not run"); } });
    for (const value of [
      { email: "bad", fullName: "Jordan", phone: "+1 555 123 4567" },
      { email: "a@test.example", fullName: "Jordan", phone: "abc", role: "admin" },
    ]) {
      assert.equal((await handleConsumerProfileUpdate(request(value), deps)).status, 400);
    }
    assert.equal(calls, 0);
  });

  it("strictly parses server success and sends same-origin JSON", async () => {
    const expected = { emailChange: "pending" as const, profile: stored };
    assert.deepEqual(parseConsumerProfileUpdate(expected), expected);
    assert.equal(parseConsumerProfileUpdate({ ...expected, emailChange: "maybe" }), null);
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return Response.json(expected);
    }) as typeof fetch;
    assert.deepEqual(await updateConsumerProfile({ email: stored.email, fullName: stored.name, phone: stored.phone }, fetcher), expected);
    assert.equal(String(calls[0]?.input), "/api/consumer/profile");
    assert.equal(calls[0]?.init?.credentials, "same-origin");
  });
});
