import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.AFFILIATES_E2E_BASE_URL?.trim() ?? "";
const operatorPassword = process.env.AUTH_DEV_OPERATOR_PASSWORD?.trim() ?? "";
const affiliatePassword = process.env.AUTH_DEV_AFFILIATE_PASSWORD?.trim() ?? "";

const AFFILIATE_ID = "a2000000-0000-0000-0000-000000000001";
const CLIENT_ID = "a3000000-0000-0000-0000-000000000002";
const KNOWN_CODE = "northbridge-fictional-partner";
const OPERATOR_EMAIL = "owner@northbridge.example";
const AFFILIATE_EMAIL = "affiliate@northbridge.example";

const skip = baseUrl === ""
  ? "AFFILIATES_E2E_BASE_URL is unset"
  : operatorPassword === "" || affiliatePassword === ""
    ? "AUTH_DEV_OPERATOR_PASSWORD / AUTH_DEV_AFFILIATE_PASSWORD are unset"
    : false;

function setCookies(headers: Headers): string {
  const entries = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie") ?? ""];
  return entries
    .map((entry) => entry.split(";", 1)[0])
    .filter((entry) => entry.includes("=") && !entry.endsWith("="))
    .join("; ");
}

async function signIn(email: string, password: string): Promise<string> {
  const signInUrl = new URL("/api/auth/sign-in", baseUrl);
  const response = await fetch(signInUrl, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", origin: signInUrl.origin },
    body: JSON.stringify({ email, password }),
  });
  assert.ok([200, 302, 303, 307].includes(response.status), `sign-in for ${email} returned ${response.status}`);
  const cookie = setCookies(response.headers);
  assert.notEqual(cookie, "", `sign-in for ${email} set no session cookie`);
  return cookie;
}

async function request(
  path: string,
  options: { body?: unknown; cookie?: string; method?: string } = {},
): Promise<{ body: Record<string, unknown>; response: Response }> {
  const method = options.method ?? "GET";
  const target = new URL(path, baseUrl);
  const response = await fetch(target, {
    method,
    redirect: "manual",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(!["GET", "HEAD"].includes(method) ? { origin: target.origin } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  const isJson = (response.headers.get("content-type") ?? "").includes("json");
  return {
    body: text === "" || !isJson ? {} : JSON.parse(text) as Record<string, unknown>,
    response,
  };
}

test("affiliate attribution, operator mutation, and exact portal read persist over HTTP", { skip }, async () => {
  const operatorCookie = await signIn(OPERATOR_EMAIL, operatorPassword);
  const affiliateCookie = await signIn(AFFILIATE_EMAIL, affiliatePassword);
  const sharePath = `/api/affiliates/${AFFILIATE_ID}/share`;
  const updatePath = `/api/affiliates/${AFFILIATE_ID}/shares/${CLIENT_ID}`;

  try {
    // Under FEATURE_REAL_AUTH the proxy guard answers an unauthenticated
    // non-public path with a redirect to /sign-in before the route can 401
    // (route-guard.ts, D-18/D-47); the route's own 401 is only reachable when
    // the guard steps aside. Either is the refusal this test wants to see.
    const unauthenticatedPortal = await request("/api/affiliates/me");
    const unauthenticatedLocation = unauthenticatedPortal.response.headers.get("location") ?? "";
    assert.ok(
      unauthenticatedPortal.response.status === 401
        || ([302, 303, 307, 308].includes(unauthenticatedPortal.response.status)
          && unauthenticatedLocation.includes("/sign-in")),
      `unauthenticated portal read returned ${unauthenticatedPortal.response.status} ${unauthenticatedLocation}`,
    );
    const wrongRolePortal = await request("/api/affiliates/me", { cookie: operatorCookie });
    assert.equal(wrongRolePortal.response.status, 403);
    const wrongRoleMutation = await request(sharePath, {
      body: { clientId: CLIENT_ID },
      cookie: affiliateCookie,
      method: "POST",
    });
    assert.equal(wrongRoleMutation.response.status, 403);

    const known = await request(`/api/enroll?aff=${KNOWN_CODE}`);
    assert.deepEqual(known.body.affiliate, { code: KNOWN_CODE, valid: true });
    const unknown = await request("/api/enroll?aff=unknown-affiliate-code");
    assert.deepEqual(unknown.body.affiliate, { code: "unknown-affiliate-code", valid: false });

    const created = await request(sharePath, {
      body: { clientId: CLIENT_ID },
      cookie: operatorCookie,
      method: "POST",
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.inserted, true);
    const replay = await request(sharePath, {
      body: { clientId: CLIENT_ID },
      cookie: operatorCookie,
      method: "POST",
    });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.inserted, false);

    const states = ["not_ready", "pending", "submitted", "paid"] as const;
    for (const [index, paymentStatus] of states.entries()) {
      const updated = await request(updatePath, {
        body: index === 0
          ? { paymentStatus }
          : { expectedCommissionCents: 2500 + index, paymentStatus },
        cookie: operatorCookie,
        method: "PATCH",
      });
      assert.equal(updated.response.status, 200);
      assert.equal(updated.body.paymentStatus, paymentStatus);
      // A fresh share defaults to not_ready (migration 001), so the first
      // patch is a no-op and the RPC honestly reports changed:false; every
      // later transition changes the row.
      assert.equal(updated.body.changed, index > 0);
    }

    const portal = await request("/api/affiliates/me", { cookie: affiliateCookie });
    assert.equal(portal.response.status, 200);
    assert.equal(portal.response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(Object.keys(portal.body).sort(), ["kpis", "rows"]);
    const kpis = portal.body.kpis as Record<string, unknown>;
    assert.deepEqual(Object.keys(kpis).sort(), ["active", "fundingRecordedCents", "inPipeline", "sentLeads"]);
    const rows = portal.body.rows as Array<Record<string, unknown>>;
    assert.ok(rows.length >= 1);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), [
        "expectedCommissionCents",
        "fundedAmountCents",
        "needsAttention",
        "paymentStatus",
        "stage",
        "startedAt",
      ]);
    }
    const serialized = JSON.stringify(portal.body);
    for (const privateValue of [AFFILIATE_ID, CLIENT_ID, "Lighthouse Ledger Fictional Works", "Devon Derog Demo", "/r/"]) {
      assert.equal(serialized.includes(privateValue), false);
    }
    assert.ok(rows.some((row) => row.paymentStatus === "paid" && row.expectedCommissionCents === 2503));

    const deleted = await request(sharePath, {
      body: { clientId: CLIENT_ID },
      cookie: operatorCookie,
      method: "DELETE",
    });
    assert.equal(deleted.response.status, 204);
    const deleteReplay = await request(sharePath, {
      body: { clientId: CLIENT_ID },
      cookie: operatorCookie,
      method: "DELETE",
    });
    assert.equal(deleteReplay.response.status, 204);
    const afterDelete = await request("/api/affiliates/me", { cookie: affiliateCookie });
    assert.equal(afterDelete.response.status, 200);
    const remainingRows = afterDelete.body.rows as Array<Record<string, unknown>>;
    assert.equal(remainingRows.some((row) => row.expectedCommissionCents === 2503), false);
  } finally {
    await request(sharePath, {
      body: { clientId: CLIENT_ID },
      cookie: operatorCookie,
      method: "DELETE",
    });
  }
});
