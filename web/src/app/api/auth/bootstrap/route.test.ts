import assert from "node:assert/strict";
import test from "node:test";

import { readBootstrapClaims } from "./route.ts";

test("bootstrap claims use only server-controlled app metadata", () => {
  const claims = readBootstrapClaims({
    app_role: "affiliate",
    org_id: "22222222-2222-4222-8222-222222222222",
    org_role: "owner",
  });

  assert.deepEqual(claims, {
    orgId: "22222222-2222-4222-8222-222222222222",
    orgRole: "owner",
    role: "affiliate",
  });
});

test("caller-writable metadata cannot supply bootstrap authorization claims", () => {
  assert.deepEqual(readBootstrapClaims(undefined), {
    orgId: null,
    orgRole: null,
    role: null,
  });
});
