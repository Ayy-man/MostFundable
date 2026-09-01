import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const surfaceSourceDirectory = path.join(
  projectRoot,
  "src/components/surfaces",
);
const surfaceSourceFiles = fs
  .readdirSync(surfaceSourceDirectory)
  .filter((fileName) => fileName.endsWith(".tsx"))
  .map((fileName) => path.join(surfaceSourceDirectory, fileName));

const roleContracts = [
  {
    emailEnv: "AUTH_DEV_PLATFORM_ADMIN_EMAIL",
    marker: "Monitoring profit",
    passwordEnv: "AUTH_DEV_PLATFORM_ADMIN_PASSWORD",
    positiveAttribute: 'data-mf-surface="admin"',
    role: "admin",
    route: "/admin",
  },
  {
    emailEnv: "AUTH_DEV_OPERATOR_EMAIL",
    marker: "Active clients",
    passwordEnv: "AUTH_DEV_OPERATOR_PASSWORD",
    positiveAttribute: 'data-mf-surface="operator"',
    role: "operator",
    route: "/operator",
  },
  {
    emailEnv: "AUTH_DEV_CONSUMER_EMAIL",
    marker: "Account status",
    passwordEnv: "AUTH_DEV_CONSUMER_PASSWORD",
    positiveAttribute: 'data-mf-surface="consumer"',
    role: "consumer",
    route: "/consumer",
  },
  {
    emailEnv: "AUTH_DEV_AFFILIATE_EMAIL",
    marker: "Referral link",
    passwordEnv: "AUTH_DEV_AFFILIATE_PASSWORD",
    positiveAttribute: 'data-mf-surface="affiliate"',
    role: "affiliate",
    route: "/affiliate",
  },
];

function requireEnv(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is not set.`);
  return value;
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

function cookieName(setCookieHeader) {
  return setCookieHeader.slice(0, setCookieHeader.indexOf("=")).trim();
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

function redirectPath(response, invariant, baseUrl) {
  const location = response.headers.get("location");
  assert.ok(location, `${invariant} returned no redirect Location.`);
  return new URL(location, baseUrl).pathname;
}

for (const contract of roleContracts) {
  const matchingFiles = surfaceSourceFiles.filter((filePath) =>
    fs.readFileSync(filePath, "utf8").includes(contract.marker),
  );
  const names = matchingFiles.map((filePath) => path.basename(filePath));
  assert.equal(
    matchingFiles.length,
    1,
    `${contract.role} leak marker "${contract.marker}" is not source-unique; found in ${names.join(", ") || "no files"}.`,
  );
  assert.equal(
    path.basename(matchingFiles[0]),
    `${contract.role}.tsx`,
    `${contract.role} leak marker "${contract.marker}" belongs to ${names[0]}.`,
  );
}

const supabaseUrl = new URL(requireEnv("NEXT_PUBLIC_SUPABASE_URL"));
const baseUrl = new URL(
  process.env.AUTH_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:3002",
);
const credentials = new Map(
  roleContracts.map((contract) => [
    contract.role,
    {
      email: requireEnv(contract.emailEnv),
      password: requireEnv(contract.passwordEnv),
    },
  ]),
);

assert.ok(supabaseUrl.protocol, "NEXT_PUBLIC_SUPABASE_URL is not a URL.");

async function request(pathname, jar, options = {}) {
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

async function walkRole(contract) {
  const jar = new Map();
  const credential = credentials.get(contract.role);
  const signIn = await request("/api/auth/sign-in", jar, {
    body: JSON.stringify(credential),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assert.ok(
    signIn.status >= 300 && signIn.status < 400,
    `${contract.role} sign-in did not redirect; received ${signIn.status}.`,
  );
  const authCookieNames = getSetCookieHeaders(signIn.headers)
    .map(cookieName)
    .filter((name) => /^sb-[^;=]+-auth-token(?:\.\d+)?$/.test(name));
  assert.ok(
    authCookieNames.length > 0,
    `${contract.role} sign-in did not set an sb auth-token cookie.`,
  );

  const root = await request("/", jar);
  assert.equal(
    root.status,
    307,
    `${contract.role} user did not redirect from the root; received ${root.status}.`,
  );
  assert.equal(
    redirectPath(root, `${contract.role} root request`, baseUrl),
    contract.route,
    `${contract.role} user did not land on the ${contract.role} surface.`,
  );

  const ownSurface = await request(contract.route, jar);
  assert.equal(
    ownSurface.status,
    200,
    `${contract.role} surface did not return 200; received ${ownSurface.status}.`,
  );
  const ownHtml = await ownSurface.text();
  assert.ok(
    ownHtml.includes(contract.positiveAttribute),
    `${contract.role} surface did not render ${contract.positiveAttribute}.`,
  );
  assert.ok(
    ownHtml.includes(contract.marker),
    `${contract.role} default-view marker "${contract.marker}" does not render in its own first response.`,
  );

  const deniedRoutes = [];
  for (const other of roleContracts) {
    if (other.role === contract.role) continue;
    assert.ok(
      !ownHtml.includes(other.marker),
      `${contract.role} surface leaked the ${other.role} default-view marker "${other.marker}".`,
    );

    const denied = await request(other.route, jar);
    assert.equal(
      denied.status,
      307,
      `${contract.role} user reached ${other.route} without the required redirect; received ${denied.status}.`,
    );
    const location = redirectPath(
      denied,
      `${contract.role} request for ${other.route}`,
      baseUrl,
    );
    assert.equal(
      location,
      contract.route,
      `${contract.role} user was not redirected from ${other.route} to ${contract.route}.`,
    );
    deniedRoutes.push({ path: other.route, status: denied.status, location });
  }

  const signOut = await request("/api/auth/sign-out", jar, { method: "POST" });
  assert.ok(
    signOut.status >= 300 && signOut.status < 400,
    `${contract.role} sign-out did not redirect; received ${signOut.status}.`,
  );
  const signedOutRoot = await request("/", jar);
  assert.equal(
    signedOutRoot.status,
    307,
    `${contract.role} root request after sign-out did not redirect.`,
  );
  assert.equal(
    redirectPath(
      signedOutRoot,
      `${contract.role} signed-out root request`,
      baseUrl,
    ),
    "/sign-in",
    `${contract.role} user remained signed in after sign-out.`,
  );

  return {
    deniedRoutes,
    role: contract.role,
    rootLocation: contract.route,
    sessionCookieSet: true,
    surfaceStatus: ownSurface.status,
  };
}

const walks = [];
for (const contract of roleContracts) {
  walks.push(await walkRole(contract));
}

console.log(JSON.stringify({ walks }, null, 2));
console.log("Four-role login and surface isolation passed.");
