// AUTH-04 / D-36: proves the magic-link CODE path end to end with no mail
// catcher, no template override and no manual step.
//
// `[local_smtp] enabled = false` on this stack and the Mailpit on :54324
// belongs to a different project, so there is nothing to read a message out of.
// There does not need to be: `POST /auth/v1/admin/generate_link` returns the
// same `hashed_token` the email template would carry, and that value IS the
// `token_hash` the confirm route feeds to `verifyOtp`. So this script exercises
// exactly the bytes a real link would deliver.
//
// The split of ownership this script respects: lane A owns the code path
// checked here — request a link, confirm it, get a session cookie, land on the
// role's surface. Integration owns the email TEMPLATE that must emit
// `{{ .TokenHash }}` instead of the default fragment-bearing link, which is
// G-02-02 and is not exercised here because it is not this lane's file.
//
// Run it from `web/` against a running app:
//   AUTH_VERIFY_BASE_URL=… NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=…
//   node scripts/auth/verify-magic-link.mjs

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

function sessionCookieNames(response) {
  return getSetCookieHeaders(response.headers)
    .map((header) => header.split("=", 1)[0].trim())
    .filter((name) => /^sb-.*-auth-token(?:\.\d+)?$/.test(name));
}

const baseUrl = new URL(requireEnv("AUTH_VERIFY_BASE_URL"));
const supabaseUrl = new URL(requireEnv("NEXT_PUBLIC_SUPABASE_URL"));
const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const runId = randomUUID().replaceAll("-", "");
const createdUserIds = [];

async function appRequest(pathname, options = {}) {
  return fetch(new URL(pathname, baseUrl), { ...options, redirect: "manual" });
}

async function requestLink(email) {
  const response = await appRequest("/api/auth/magic-link", {
    body: JSON.stringify({ email }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  return { body: await response.text(), status: response.status };
}

async function createUser(label) {
  const user = await requestJson(
    new URL("/auth/v1/admin/users", supabaseUrl),
    {
      body: JSON.stringify({
        email: `${label}.${runId}@test.example`,
        email_confirm: true,
        password: `MfA!${randomUUID()}`,
      }),
      headers: adminHeaders(serviceKey, { "Content-Type": "application/json" }),
      method: "POST",
    },
    `${label} Auth user creation failed`,
  );
  assert.ok(user?.id, `${label} Auth user has no id.`);
  createdUserIds.push(user.id);
  return user;
}

async function generateLink(email) {
  return requestJson(
    new URL("/auth/v1/admin/generate_link", supabaseUrl),
    {
      body: JSON.stringify({ email, type: "magiclink" }),
      headers: adminHeaders(serviceKey, { "Content-Type": "application/json" }),
      method: "POST",
    },
    "generate_link failed",
  );
}

async function deleteUser(userId) {
  const response = await fetch(
    new URL(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, supabaseUrl),
    { headers: adminHeaders(serviceKey), method: "DELETE" },
  );
  assert.ok(response.ok, `Auth user cleanup failed with HTTP ${response.status}.`);
}

const report = {
  confirmedWithTokenHash: false,
  noAccountEnumeration: false,
  offSiteNextIgnored: false,
  rejectedLinkIsGeneric: false,
};

try {
  const user = await createUser("magic-link");

  const known = await requestLink(user.email);
  const unknown = await requestLink(`absent.${runId}@test.example`);
  assert.equal(
    known.status,
    202,
    `A link request for a known address returned ${known.status}.`,
  );
  assert.equal(
    unknown.status,
    known.status,
    "The link request distinguished a known address from an unknown one by status.",
  );
  assert.equal(
    unknown.body,
    known.body,
    "The link request distinguished a known address from an unknown one by body.",
  );
  report.noAccountEnumeration = true;

  const link = await generateLink(user.email);
  assert.ok(link?.hashed_token, "generate_link returned no hashed_token.");
  assert.equal(
    link.verification_type,
    "magiclink",
    "generate_link did not mint a magiclink token.",
  );

  const confirmUrl = `/api/auth/confirm?token_hash=${encodeURIComponent(link.hashed_token)}&type=magiclink`;
  const confirmed = await appRequest(confirmUrl);
  assert.ok(
    confirmed.status >= 300 && confirmed.status < 400,
    `The confirm route did not redirect; received ${confirmed.status}.`,
  );
  assert.equal(
    new URL(confirmed.headers.get("location"), baseUrl).pathname,
    "/consumer",
    "The confirm route did not land the caller on the role's own surface.",
  );
  assert.ok(
    sessionCookieNames(confirmed).length > 0,
    "The confirm route did not establish a session cookie.",
  );
  report.confirmedWithTokenHash = true;

  const replayed = await appRequest(confirmUrl);
  const forged = await appRequest(
    "/api/auth/confirm?token_hash=not-a-real-token&type=magiclink",
  );
  const missing = await appRequest("/api/auth/confirm");
  for (const [label, response] of [
    ["a spent link", replayed],
    ["a forged token", forged],
    ["a token-less request", missing],
  ]) {
    assert.ok(
      response.status >= 300 && response.status < 400,
      `${label} produced ${response.status} rather than a redirect.`,
    );
    const target = new URL(response.headers.get("location"), baseUrl);
    assert.equal(
      target.pathname,
      "/sign-in",
      `${label} did not send the caller back to sign-in.`,
    );
    assert.equal(
      target.searchParams.get("error"),
      "link_invalid",
      `${label} did not use the one generic failure marker.`,
    );
    assert.equal(
      sessionCookieNames(response).length,
      0,
      `${label} established a session cookie.`,
    );
  }
  report.rejectedLinkIsGeneric = true;

  const secondLink = await generateLink(user.email);
  const offSite = await appRequest(
    `/api/auth/confirm?token_hash=${encodeURIComponent(secondLink.hashed_token)}&type=magiclink&next=${encodeURIComponent("//evil.example/take-over")}`,
  );
  const offSiteTarget = new URL(offSite.headers.get("location"), baseUrl);
  assert.equal(
    offSiteTarget.host,
    baseUrl.host,
    "A protocol-relative next= sent the browser to another host.",
  );
  assert.equal(
    offSiteTarget.pathname,
    "/consumer",
    "A rejected next= did not fall back to the role's own surface.",
  );
  report.offSiteNextIgnored = true;
} finally {
  for (const userId of createdUserIds.toReversed()) {
    await deleteUser(userId);
  }
}

console.log(JSON.stringify(report, null, 2));
console.log("Magic-link verification passed.");
