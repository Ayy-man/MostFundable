import assert from "node:assert/strict";

const projectRoot = process.cwd();
const argumentsList = process.argv.slice(2);

assert.ok(projectRoot, "The project root could not be resolved.");
assert.ok(
  argumentsList.length === 0 ||
    (argumentsList.length === 2 && argumentsList[0] === "--api-url"),
  "Only the optional --api-url override is supported.",
);

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

  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

const apiUrl = new URL(
  argumentsList[1] ?? requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
);
const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const devOrg = {
  name: "Funding Readiness Dev Scaffold",
  slug: "funding-readiness-dev-scaffold",
};

const roleInputs = [
  {
    appRole: "platform_admin",
    email: requireEnv("AUTH_DEV_PLATFORM_ADMIN_EMAIL"),
    fullName: "Funding Readiness Dev Admin",
    orgRole: null,
    password: requireEnv("AUTH_DEV_PLATFORM_ADMIN_PASSWORD"),
  },
  {
    appRole: "operator_member",
    email: requireEnv("AUTH_DEV_OPERATOR_EMAIL"),
    fullName: "Funding Readiness Dev Operator",
    orgRole: "owner",
    password: requireEnv("AUTH_DEV_OPERATOR_PASSWORD"),
  },
  {
    appRole: "consumer",
    email: requireEnv("AUTH_DEV_CONSUMER_EMAIL"),
    fullName: "Funding Readiness Dev Consumer",
    orgRole: null,
    password: requireEnv("AUTH_DEV_CONSUMER_PASSWORD"),
  },
  {
    appRole: "affiliate",
    email: requireEnv("AUTH_DEV_AFFILIATE_EMAIL"),
    fullName: "Funding Readiness Dev Affiliate",
    orgRole: null,
    password: requireEnv("AUTH_DEV_AFFILIATE_PASSWORD"),
  },
];

async function findOrCreateDevOrg() {
  const orgLookupUrl = new URL("/rest/v1/orgs", apiUrl);
  orgLookupUrl.searchParams.set("select", "id,name,slug");
  orgLookupUrl.searchParams.set("slug", `eq.${devOrg.slug}`);

  const existingOrgs = await requestJson(
    orgLookupUrl,
    { headers: adminHeaders(serviceKey) },
    "The dev org lookup failed",
  );
  assert.ok(Array.isArray(existingOrgs), "The dev org lookup was not a list.");
  assert.ok(existingOrgs.length <= 1, "The dev org slug is not unique.");

  if (existingOrgs.length === 1) {
    return { ...existingOrgs[0], result: "existing" };
  }

  const createdOrgs = await requestJson(
    new URL("/rest/v1/orgs", apiUrl),
    {
      body: JSON.stringify(devOrg),
      headers: adminHeaders(serviceKey, {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      }),
      method: "POST",
    },
    "The dev org creation failed",
  );
  assert.equal(createdOrgs?.length, 1, "The dev org was not created once.");
  return { ...createdOrgs[0], result: "created" };
}

async function listUsers() {
  const users = [];
  const pageSize = 1000;

  for (let page = 1; ; page += 1) {
    const usersUrl = new URL("/auth/v1/admin/users", apiUrl);
    usersUrl.searchParams.set("page", String(page));
    usersUrl.searchParams.set("per_page", String(pageSize));
    const result = await requestJson(
      usersUrl,
      { headers: adminHeaders(serviceKey) },
      "The Auth user lookup failed",
    );
    const pageUsers = Array.isArray(result) ? result : result?.users;
    assert.ok(Array.isArray(pageUsers), "The Auth user lookup was not a list.");
    users.push(...pageUsers);
    if (pageUsers.length < pageSize) break;
  }

  return users;
}

async function findOrCreateUser(input, orgId, existingUsers) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const matches = existingUsers.filter(
    (user) => user.email?.trim().toLowerCase() === normalizedEmail,
  );
  assert.ok(matches.length <= 1, `${input.appRole} email is not unique in Auth.`);

  if (matches.length === 1) {
    return {
      email: input.email,
      id: matches[0].id,
      result: "existing",
      role: input.appRole,
    };
  }

  const user = await requestJson(
    new URL("/auth/v1/admin/users", apiUrl),
    {
      body: JSON.stringify({
        app_metadata: { provenance: "lane-a dev provisioning" },
        email: input.email,
        email_confirm: true,
        password: input.password,
        user_metadata: {
          app_role: input.appRole,
          full_name: input.fullName,
          org_id: input.appRole === "platform_admin" ? null : orgId,
          org_role: input.orgRole,
        },
      }),
      headers: adminHeaders(serviceKey, {
        "Content-Type": "application/json",
      }),
      method: "POST",
    },
    `${input.appRole} Auth user creation failed`,
  );
  assert.ok(user?.id, `${input.appRole} Auth user has no id.`);

  return {
    email: input.email,
    id: user.id,
    result: "created",
    role: input.appRole,
  };
}

const org = await findOrCreateDevOrg();
const existingUsers = await listUsers();
const users = [];

for (const input of roleInputs) {
  const user = await findOrCreateUser(input, org.id, existingUsers);
  users.push(user);
  if (user.result === "created") existingUsers.push(user);
}

console.log(
  JSON.stringify(
    users.map(({ email, id }) => ({ email, id })),
    null,
    2,
  ),
);
console.log("Funding readiness dev users are provisioned.");
