import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function requireEnv(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is not set.`);
  return value;
}

function adminHeaders(serviceKey, extraHeaders = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...extraHeaders,
  };
}

async function requestJson(url, options, invariant) {
  const response = await fetch(url, options);
  assert.ok(response.ok, `${invariant} HTTP ${response.status}.`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const combined = headers.get("set-cookie");
  return combined
    ? combined.split(/,(?=\s*[^;,=\s]+=[^;]+)/).map((value) => value.trim())
    : [];
}

function updateCookieJar(jar, response) {
  for (const setCookieHeader of getSetCookieHeaders(response.headers)) {
    const pair = setCookieHeader.split(";", 1)[0];
    const separator = pair.indexOf("=");
    assert.ok(separator > 0, "A response Set-Cookie header was malformed.");
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!value || /(?:^|;)\s*max-age=0(?:;|$)/i.test(setCookieHeader)) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
}

function cookieHeader(jar) {
  return [...jar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

const baseUrl = new URL(requireEnv("AUTH_VERIFY_BASE_URL"));
const supabaseUrl = new URL(requireEnv("NEXT_PUBLIC_SUPABASE_URL"));
const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const runId = randomUUID().replaceAll("-", "");
const password = `MfA!${randomUUID()}`;
const createdUserIds = [];
let createdOrgId = null;

async function appRequest(pathname, jar, options = {}) {
  const headers = new Headers(options.headers);
  const cookies = cookieHeader(jar);
  if (cookies) headers.set("Cookie", cookies);

  const response = await fetch(new URL(pathname, baseUrl), {
    ...options,
    headers,
    redirect: "manual",
  });
  updateCookieJar(jar, response);
  return response;
}

async function createOrg() {
  const rows = await requestJson(
    new URL("/rest/v1/orgs", supabaseUrl),
    {
      body: JSON.stringify({
        name: "Funding Readiness Bootstrap Verification",
        slug: `bootstrap-verification-${runId}`,
      }),
      headers: adminHeaders(serviceKey, {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      }),
      method: "POST",
    },
    "The bootstrap verification org could not be created",
  );
  assert.equal(rows?.length, 1, "The bootstrap verification org was not created once.");
  createdOrgId = rows[0].id;
  return rows[0];
}

async function createUser(label, userMetadata) {
  const user = await requestJson(
    new URL("/auth/v1/admin/users", supabaseUrl),
    {
      body: JSON.stringify({
        email: `${label}.${runId}@test.example`,
        email_confirm: true,
        password,
        ...(userMetadata === undefined
          ? {}
          : { user_metadata: userMetadata }),
      }),
      headers: adminHeaders(serviceKey, {
        "Content-Type": "application/json",
      }),
      method: "POST",
    },
    `${label} Auth user creation failed`,
  );
  assert.ok(user?.id, `${label} Auth user has no id.`);
  createdUserIds.push(user.id);
  return user;
}

async function updateUserMetadata(userId, userMetadata) {
  return requestJson(
    new URL(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, supabaseUrl),
    {
      body: JSON.stringify({ user_metadata: userMetadata }),
      headers: adminHeaders(serviceKey, {
        "Content-Type": "application/json",
      }),
      method: "PUT",
    },
    "The Auth user metadata update failed",
  );
}

async function readProfile(userId) {
  const url = new URL("/rest/v1/profiles", supabaseUrl);
  url.searchParams.set("id", `eq.${userId}`);
  url.searchParams.set("select", "id,role,org_id,org_role");
  const rows = await requestJson(
    url,
    { headers: adminHeaders(serviceKey) },
    "The bootstrap profile re-read failed",
  );
  assert.ok(Array.isArray(rows), "The bootstrap profile re-read was not a list.");
  return rows;
}

async function signIn(email) {
  const jar = new Map();
  const response = await appRequest("/api/auth/sign-in", jar, {
    body: JSON.stringify({ email, password }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assert.ok(
    response.status >= 300 && response.status < 400,
    `The sign-in route did not redirect; received ${response.status}.`,
  );
  assert.ok(jar.size > 0, "The sign-in route did not establish a session cookie.");
  return jar;
}

async function bootstrap(jar) {
  return appRequest("/api/auth/bootstrap", jar, { method: "POST" });
}

async function deleteUser(userId) {
  const response = await fetch(
    new URL(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, supabaseUrl),
    {
      headers: adminHeaders(serviceKey),
      method: "DELETE",
    },
  );
  assert.ok(response.ok, `Auth user cleanup failed with HTTP ${response.status}.`);
}

async function deleteOrg(orgId) {
  const url = new URL("/rest/v1/orgs", supabaseUrl);
  url.searchParams.set("id", `eq.${orgId}`);
  const response = await fetch(url, {
    headers: adminHeaders(serviceKey),
    method: "DELETE",
  });
  assert.ok(response.ok, `Verification org cleanup failed with HTTP ${response.status}.`);
}

const report = {
  completeMetadata: false,
  fallbackCorrected: false,
  operatorShapeRefused: false,
};

try {
  const org = await createOrg();
  const completeUser = await createUser("complete-bootstrap", {
    app_role: "operator_member",
    full_name: "Complete Bootstrap Verification",
    org_id: org.id,
    org_role: "owner",
  });
  const completeJar = await signIn(completeUser.email);
  const completeBootstrap = await bootstrap(completeJar);
  assert.ok(
    completeBootstrap.ok,
    `Complete-metadata bootstrap failed with HTTP ${completeBootstrap.status}.`,
  );
  assert.deepEqual(
    await readProfile(completeUser.id),
    [
      {
        id: completeUser.id,
        org_id: org.id,
        org_role: "owner",
        role: "operator_member",
      },
    ],
    "Complete metadata did not produce the expected profile role and organization.",
  );
  report.completeMetadata = true;

  const fallbackUser = await createUser("fallback-bootstrap");
  assert.deepEqual(
    await readProfile(fallbackUser.id),
    [
      {
        id: fallbackUser.id,
        org_id: null,
        org_role: null,
        role: "consumer",
      },
    ],
    "A user created without metadata did not receive the consumer fallback profile.",
  );

  await updateUserMetadata(fallbackUser.id, {
    app_role: "consumer",
    full_name: "Fallback Bootstrap Verification",
    org_id: org.id,
    org_role: null,
  });
  const fallbackJar = await signIn(fallbackUser.email);
  const correctedBootstrap = await bootstrap(fallbackJar);
  assert.ok(
    correctedBootstrap.ok,
    `Fallback correction failed with HTTP ${correctedBootstrap.status}.`,
  );
  assert.deepEqual(
    await readProfile(fallbackUser.id),
    [
      {
        id: fallbackUser.id,
        org_id: org.id,
        org_role: null,
        role: "consumer",
      },
    ],
    "The bootstrap route did not correct the fallback profile when metadata became available.",
  );
  report.fallbackCorrected = true;

  await updateUserMetadata(fallbackUser.id, {
    app_role: "operator_member",
    full_name: "Invalid Operator Bootstrap Verification",
    org_id: null,
    org_role: null,
  });
  const invalidOperator = await bootstrap(fallbackJar);
  assert.ok(
    invalidOperator.status >= 400 && invalidOperator.status < 500,
    `An operator without organization binding was not refused; received ${invalidOperator.status}.`,
  );
  assert.deepEqual(
    await readProfile(fallbackUser.id),
    [
      {
        id: fallbackUser.id,
        org_id: org.id,
        org_role: null,
        role: "consumer",
      },
    ],
    "The refused operator metadata changed the stored profile.",
  );
  report.operatorShapeRefused = true;
} finally {
  for (const userId of createdUserIds.toReversed()) {
    await deleteUser(userId);
  }
  if (createdOrgId) await deleteOrg(createdOrgId);
}

console.log(JSON.stringify(report, null, 2));
console.log("Bootstrap verification passed.");
