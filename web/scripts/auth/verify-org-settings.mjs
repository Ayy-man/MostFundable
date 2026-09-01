import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

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

function findProperty(value, property) {
  if (!value || typeof value !== "object") return undefined;
  if (Object.hasOwn(value, property)) return value[property];
  for (const child of Object.values(value)) {
    const match = findProperty(child, property);
    if (match !== undefined) return match;
  }
  return undefined;
}

function introspectAssignmentModes(dbUrl) {
  const sql = `
    select coalesce(
      (
        select pg_get_constraintdef(constraint_row.oid)
        from pg_constraint as constraint_row
        join pg_class as relation on relation.oid = constraint_row.conrelid
        join pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = 'orgs'
          and pg_get_constraintdef(constraint_row.oid) like '%assignment_mode%'
        order by constraint_row.conname
        limit 1
      ),
      (
        select 'ENUM (' || string_agg(quote_literal(enum_value.enumlabel), ', ' order by enum_value.enumsortorder) || ')'
        from pg_attribute as attribute
        join pg_class as relation on relation.oid = attribute.attrelid
        join pg_namespace as namespace on namespace.oid = relation.relnamespace
        join pg_type as column_type on column_type.oid = attribute.atttypid
        join pg_enum as enum_value on enum_value.enumtypid = column_type.oid
        where namespace.nspname = 'public'
          and relation.relname = 'orgs'
          and attribute.attname = 'assignment_mode'
      )
    ) as definition;
  `;
  const result = spawnSync(
    "supabase",
    ["db", "query", "--db-url", dbUrl, "--output-format", "json", sql],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    "The assignment_mode constraint introspection query failed.",
  );

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    assert.fail("The assignment_mode constraint introspection was not JSON.");
  }
  const definition = findProperty(parsed, "definition");
  assert.equal(
    typeof definition,
    "string",
    "The database returned no enforced assignment_mode definition.",
  );
  const values = [
    ...new Set([...definition.matchAll(/'([^']+)'/g)].map((match) => match[1])),
  ];
  assert.ok(
    values.length >= 2,
    "The enforced assignment_mode set could not be derived from the database.",
  );
  return values;
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
const dbUrl = requireEnv("DB_URL");
const legalModes = introspectAssignmentModes(dbUrl);
const baselineMode = legalModes.includes("manual") ? "manual" : legalModes[0];
const changedMode = legalModes.find((value) => value !== baselineMode);
assert.ok(changedMode, "The database exposes no second assignment_mode for mutation testing.");
const invalidMode = "invalid_assignment_mode_contract";
assert.ok(!legalModes.includes(invalidMode), "The illegal assignment_mode probe is legal.");

const fixturePassword = `MfA!${randomUUID()}`;
const fixtures = {
  orgA: {
    name: "Funding Readiness Org Settings Verification A",
    slug: "funding-readiness-org-settings-verification-a",
  },
  orgB: {
    name: "Funding Readiness Org Settings Verification B",
    slug: "funding-readiness-org-settings-verification-b",
  },
};

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

async function findOrCreateOrg(input) {
  const lookupUrl = new URL("/rest/v1/orgs", supabaseUrl);
  lookupUrl.searchParams.set("select", "id,name,slug,assignment_mode");
  lookupUrl.searchParams.set("slug", `eq.${input.slug}`);
  const existing = await requestJson(
    lookupUrl,
    { headers: adminHeaders(serviceKey) },
    "The org-settings fixture lookup failed",
  );
  assert.ok(Array.isArray(existing), "The org-settings fixture lookup was not a list.");
  assert.ok(existing.length <= 1, "The org-settings fixture slug is not unique.");
  if (existing.length === 1) return existing[0];

  const created = await requestJson(
    new URL("/rest/v1/orgs", supabaseUrl),
    {
      body: JSON.stringify(input),
      headers: adminHeaders(serviceKey, {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      }),
      method: "POST",
    },
    "The org-settings fixture creation failed",
  );
  assert.equal(created?.length, 1, "The org-settings fixture was not created once.");
  return created[0];
}

async function listUsers() {
  const users = [];
  const pageSize = 1000;
  for (let page = 1; ; page += 1) {
    const url = new URL("/auth/v1/admin/users", supabaseUrl);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(pageSize));
    const result = await requestJson(
      url,
      { headers: adminHeaders(serviceKey) },
      "The org-settings Auth user lookup failed",
    );
    const pageUsers = Array.isArray(result) ? result : result?.users;
    assert.ok(Array.isArray(pageUsers), "The Auth user lookup was not a list.");
    users.push(...pageUsers);
    if (pageUsers.length < pageSize) break;
  }
  return users;
}

async function findOrCreateUser(input, existingUsers) {
  const matching = existingUsers.filter(
    (user) => user.email?.toLowerCase() === input.email.toLowerCase(),
  );
  assert.ok(matching.length <= 1, `${input.label} Auth email is not unique.`);
  const body = {
    email_confirm: true,
    password: fixturePassword,
    user_metadata: {
      app_role: "operator_member",
      full_name: input.label,
      org_id: input.orgId,
      org_role: input.orgRole,
    },
  };

  if (matching.length === 1) {
    const user = await requestJson(
      new URL(`/auth/v1/admin/users/${encodeURIComponent(matching[0].id)}`, supabaseUrl),
      {
        body: JSON.stringify(body),
        headers: adminHeaders(serviceKey, {
          "Content-Type": "application/json",
        }),
        method: "PUT",
      },
      `${input.label} Auth user refresh failed`,
    );
    return user;
  }

  const user = await requestJson(
    new URL("/auth/v1/admin/users", supabaseUrl),
    {
      body: JSON.stringify({ email: input.email, ...body }),
      headers: adminHeaders(serviceKey, {
        "Content-Type": "application/json",
      }),
      method: "POST",
    },
    `${input.label} Auth user creation failed`,
  );
  existingUsers.push(user);
  return user;
}

async function ensureProfile(user, input) {
  const url = new URL("/rest/v1/profiles", supabaseUrl);
  url.searchParams.set("on_conflict", "id");
  const rows = await requestJson(
    url,
    {
      body: JSON.stringify({
        email: input.email,
        full_name: input.label,
        id: user.id,
        org_id: input.orgId,
        org_role: input.orgRole,
        role: "operator_member",
      }),
      headers: adminHeaders(serviceKey, {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      }),
      method: "POST",
    },
    `${input.label} profile fixture could not be ensured`,
  );
  assert.equal(rows?.length, 1, `${input.label} profile fixture was not returned once.`);
}

async function signIn(input) {
  const jar = new Map();
  const response = await appRequest("/api/auth/sign-in", jar, {
    body: JSON.stringify({ email: input.email, password: fixturePassword }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assert.ok(
    response.status >= 300 && response.status < 400,
    `${input.label} sign-in did not redirect; received ${response.status}.`,
  );
  assert.ok(jar.size > 0, `${input.label} sign-in established no session cookie.`);
  return jar;
}

async function patchSettings(jar, body) {
  return appRequest("/api/org/settings", jar, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
}

async function setOrgMode(orgId, assignmentMode) {
  const url = new URL("/rest/v1/orgs", supabaseUrl);
  url.searchParams.set("id", `eq.${orgId}`);
  const rows = await requestJson(
    url,
    {
      body: JSON.stringify({ assignment_mode: assignmentMode }),
      headers: adminHeaders(serviceKey, {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      }),
      method: "PATCH",
    },
    "The org-settings fixture mode could not be set",
  );
  assert.equal(rows?.length, 1, "The org-settings fixture update matched no row.");
}

async function readOrgMode(orgId) {
  const url = new URL("/rest/v1/orgs", supabaseUrl);
  url.searchParams.set("id", `eq.${orgId}`);
  url.searchParams.set("select", "assignment_mode");
  const rows = await requestJson(
    url,
    { headers: adminHeaders(serviceKey) },
    "The org-settings re-read failed",
  );
  assert.equal(rows?.length, 1, "The org-settings re-read matched no row.");
  return rows[0].assignment_mode;
}

async function countAuditRows(orgId, actorId) {
  const url = new URL("/rest/v1/audit_log", supabaseUrl);
  url.searchParams.set("org_id", `eq.${orgId}`);
  url.searchParams.set("actor_profile_id", `eq.${actorId}`);
  url.searchParams.set("subject_id", `eq.${orgId}`);
  url.searchParams.set("select", "id");
  const rows = await requestJson(
    url,
    { headers: adminHeaders(serviceKey) },
    "The audit_log count failed",
  );
  assert.ok(Array.isArray(rows), "The audit_log count was not a list.");
  return rows.length;
}

const orgA = await findOrCreateOrg(fixtures.orgA);
const orgB = await findOrCreateOrg(fixtures.orgB);
const existingUsers = await listUsers();
const userInputs = [
  {
    email: "org-settings-owner-a@test.example",
    label: "Org Settings Owner A",
    orgId: orgA.id,
    orgRole: "owner",
  },
  {
    email: "org-settings-prep-a@test.example",
    label: "Org Settings Prep A",
    orgId: orgA.id,
    orgRole: "prep_specialist",
  },
  {
    email: "org-settings-prep-b@test.example",
    label: "Org Settings Prep B",
    orgId: orgB.id,
    orgRole: "prep_specialist",
  },
];

const users = [];
for (const input of userInputs) {
  const user = await findOrCreateUser(input, existingUsers);
  await ensureProfile(user, input);
  users.push(user);
}

const [ownerJar, prepJar, otherOrgJar] = await Promise.all(
  userInputs.map((input) => signIn(input)),
);

await setOrgMode(orgA.id, baselineMode);
const auditBefore = await countAuditRows(orgA.id, users[0].id);
let report;

try {
  const ownerPatch = await patchSettings(ownerJar, {
    assignment_mode: changedMode,
  });
  assert.equal(ownerPatch.status, 200, "The owner settings mutation was not HTTP 200.");
  const ownerBodyText = await ownerPatch.text();
  assert.ok(ownerBodyText, "The owner settings mutation returned no affected-row representation.");
  const ownerBody = JSON.parse(ownerBodyText);
  assert.equal(
    findProperty(ownerBody, "assignment_mode"),
    changedMode,
    "The owner response did not reflect the affected assignment_mode row.",
  );
  assert.equal(
    await readOrgMode(orgA.id),
    changedMode,
    "The successful PATCH was a silent 200; the follow-up re-read did not change.",
  );

  const prepPatch = await patchSettings(prepJar, {
    assignment_mode: baselineMode,
  });
  assert.equal(prepPatch.status, 403, "The same-org prep specialist was not HTTP 403.");
  assert.equal(
    await readOrgMode(orgA.id),
    changedMode,
    "The denied same-org mutation changed the stored value.",
  );

  const otherOrgPatch = await patchSettings(otherOrgJar, {
    assignment_mode: baselineMode,
    org_id: orgA.id,
  });
  assert.equal(otherOrgPatch.status, 403, "The other-org member was not HTTP 403.");
  assert.equal(
    await readOrgMode(orgA.id),
    changedMode,
    "The denied other-org mutation changed the stored value.",
  );

  const invalidPatch = await patchSettings(ownerJar, {
    assignment_mode: invalidMode,
  });
  assert.equal(invalidPatch.status, 400, "An illegal assignment_mode was not HTTP 400.");
  assert.equal(
    await readOrgMode(orgA.id),
    changedMode,
    "The illegal assignment_mode request changed the stored value.",
  );

  const auditAfter = await countAuditRows(orgA.id, users[0].id);
  assert.equal(
    auditAfter - auditBefore,
    1,
    "A successful settings mutation did not create exactly one audit_log row.",
  );

  report = {
    auditRowsAdded: auditAfter - auditBefore,
    deniedStatuses: [prepPatch.status, otherOrgPatch.status],
    illegalStatus: invalidPatch.status,
    legalAssignmentModes: legalModes,
    rereadAssignmentMode: changedMode,
    successStatus: ownerPatch.status,
  };
} finally {
  await setOrgMode(orgA.id, baselineMode);
}

console.log(JSON.stringify(report, null, 2));
console.log("Organization settings verification passed.");
