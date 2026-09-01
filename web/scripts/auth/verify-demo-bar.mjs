import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const demoChromePath = path.join(
  projectRoot,
  "src/components/demo/demo-chrome.tsx",
);
const profileSwitcherPath = path.join(
  projectRoot,
  "src/components/demo/profile-switcher.tsx",
);
const baselinePath = path.join(
  projectRoot,
  "scripts/auth/baseline/root-flag-off.html",
);
const source = fs.readFileSync(demoChromePath, "utf8");
const barStart = source.indexOf("export function DemoEnvironmentBar");
const barEnd = source.indexOf("export function DemoRoleTrigger", barStart);

assert.ok(barStart >= 0, "DemoEnvironmentBar is missing from demo-chrome.tsx.");
assert.ok(barEnd > barStart, "DemoEnvironmentBar source could not be isolated.");

const barSource = source.slice(barStart, barEnd);

function decodeHtml(value) {
  return value
    .replaceAll("&apos;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

function normalizeText(value) {
  return decodeHtml(String(value)).replace(/\s+/g, " ").trim();
}

function evaluateSourceExpression(expression, realAuth, invariant) {
  try {
    const evaluate = new Function(
      "realAuth",
      `"use strict"; return (${expression});`,
    );
    const result = evaluate(realAuth);
    assert.equal(typeof result, "string", `${invariant} did not resolve to text.`);
    return normalizeText(result);
  } catch (error) {
    assert.fail(`${invariant} could not be read from demo-chrome.tsx: ${error.message}`);
  }
}

function extractRenderedText(fragment, realAuth, invariant) {
  const trimmed = fragment.trim();
  assert.ok(trimmed, `${invariant} is empty in demo-chrome.tsx.`);
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return evaluateSourceExpression(
      trimmed.slice(1, -1),
      realAuth,
      invariant,
    );
  }
  return normalizeText(trimmed);
}

function extractBarCopies(realAuth) {
  const fullNoticeMatch = barSource.match(
    /const\s+fullNotice\s*=\s*([\s\S]*?);\s*(?:\n|$)/,
  );
  assert.ok(fullNoticeMatch, "The full demo notice could not be read from source.");

  const mobileStart = barSource.indexOf("sm:hidden");
  const mobileEnd = barSource.indexOf(
    '<span className="hidden min-w-0 items-center gap-2 sm:flex">',
    mobileStart,
  );
  assert.ok(mobileStart >= 0, "The mobile demo notice is missing from source.");
  assert.ok(mobileEnd > mobileStart, "The mobile demo notice could not be isolated.");
  const mobileSource = barSource.slice(mobileStart, mobileEnd);
  const mobileLeadMatch = mobileSource.match(
    /<strong[^>]*>([\s\S]*?)<\/strong>/,
  );
  assert.ok(mobileLeadMatch, "The mobile demo notice lead could not be read.");
  const mobileDetailMatch = mobileSource
    .slice(mobileLeadMatch.index + mobileLeadMatch[0].length)
    .match(/<span[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(mobileDetailMatch, "The mobile demo notice detail could not be read.");

  const desktopMatch = barSource.match(
    /<span\s+className="truncate">([\s\S]*?)<\/span>/,
  );
  assert.ok(desktopMatch, "The desktop demo notice could not be read from source.");

  return {
    desktop: extractRenderedText(
      desktopMatch[1],
      realAuth,
      "The desktop demo notice",
    ),
    fullNotice: evaluateSourceExpression(
      fullNoticeMatch[1],
      realAuth,
      "The full demo notice",
    ),
    mobile: [
      extractRenderedText(
        mobileLeadMatch[1],
        realAuth,
        "The mobile demo notice lead",
      ),
      extractRenderedText(
        mobileDetailMatch[1],
        realAuth,
        "The mobile demo notice detail",
      ),
    ],
  };
}

function assertHtmlContains(html, expected, invariant) {
  assert.ok(
    normalizeText(html).includes(normalizeText(expected)),
    `${invariant} is absent from the served HTML.`,
  );
}

const flagOffCopies = extractBarCopies(false);
const flagOnCopies = extractBarCopies(true);
assert.ok(fs.existsSync(baselinePath), "The flag-off HTML baseline is missing.");
const flagOffHtml = fs.readFileSync(baselinePath, "utf8");

assertHtmlContains(
  flagOffHtml,
  flagOffCopies.fullNotice,
  "The flag-off full demo notice",
);
for (const [index, copy] of flagOffCopies.mobile.entries()) {
  assertHtmlContains(
    flagOffHtml,
    copy,
    `The flag-off mobile demo notice part ${index + 1}`,
  );
}
assertHtmlContains(
  flagOffHtml,
  flagOffCopies.desktop,
  "The flag-off desktop demo notice",
);

assert.ok(fs.existsSync(profileSwitcherPath), "profile-switcher.tsx is missing.");

const roleContracts = [
  {
    emailEnv: "AUTH_DEV_PLATFORM_ADMIN_EMAIL",
    passwordEnv: "AUTH_DEV_PLATFORM_ADMIN_PASSWORD",
    role: "admin",
    route: "/admin",
  },
  {
    emailEnv: "AUTH_DEV_OPERATOR_EMAIL",
    passwordEnv: "AUTH_DEV_OPERATOR_PASSWORD",
    role: "operator",
    route: "/operator",
  },
  {
    emailEnv: "AUTH_DEV_CONSUMER_EMAIL",
    passwordEnv: "AUTH_DEV_CONSUMER_PASSWORD",
    role: "consumer",
    route: "/consumer",
  },
  {
    emailEnv: "AUTH_DEV_AFFILIATE_EMAIL",
    passwordEnv: "AUTH_DEV_AFFILIATE_PASSWORD",
    role: "affiliate",
    route: "/affiliate",
  },
];

const wrapperChecks = [];
for (const contract of roleContracts) {
  const wrapperPath = path.join(
    projectRoot,
    "src/app/(surfaces)",
    contract.role,
    "surface-client.tsx",
  );
  assert.ok(
    fs.existsSync(wrapperPath),
    `Required surface-client wrapper is missing: ${contract.role}.`,
  );
  const wrapperSource = fs.readFileSync(wrapperPath, "utf8");
  assert.match(
    wrapperSource,
    /import\s*\{\s*ProfileSwitcher\s*\}\s*from\s*["']@\/components\/demo\/profile-switcher["']/,
    `${contract.role} surface-client does not import ProfileSwitcher.`,
  );
  wrapperChecks.push({ importsProfileSwitcher: true, role: contract.role });
}

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

const baseUrl = new URL(
  process.env.AUTH_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:3002",
);

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

async function verifySurfaceDisclosure(contract) {
  const jar = new Map();
  const signIn = await request("/api/auth/sign-in", jar, {
    body: JSON.stringify({
      email: requireEnv(contract.emailEnv),
      password: requireEnv(contract.passwordEnv),
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assert.ok(
    signIn.status >= 300 && signIn.status < 400,
    `${contract.role} sign-in did not redirect; received ${signIn.status}.`,
  );

  const surface = await request(contract.route, jar);
  assert.equal(
    surface.status,
    200,
    `${contract.role} disclosure route did not return 200.`,
  );
  const html = await surface.text();
  assert.match(
    html,
    /role=["']note["']/,
    `${contract.role} surface has no role="note" landmark.`,
  );
  assertHtmlContains(
    html,
    flagOnCopies.fullNotice,
    `${contract.role} live-session demo notice`,
  );
  assert.match(
    normalizeText(html),
    /do not enter real/i,
    `${contract.role} live-session notice weakens the real-data instruction.`,
  );

  return { role: contract.role, status: surface.status };
}

const surfaceChecks = [];
for (const contract of roleContracts) {
  surfaceChecks.push(await verifySurfaceDisclosure(contract));
}

console.log(
  JSON.stringify(
    {
      flagOff: {
        desktop: true,
        fullNotice: true,
        mobileParts: flagOffCopies.mobile.length,
      },
      flagOn: surfaceChecks,
      switcher: wrapperChecks,
    },
    null,
    2,
  ),
);
console.log("Demo disclosure and switcher assertions passed.");
