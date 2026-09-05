#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "../src/lib/testing/strip-comments.ts";

const WEB_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_ROOT = path.join(WEB_ROOT, "src");
const TEST_ROOT = path.join(WEB_ROOT, "tests");
const EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mts"]);
const PRUNED = new Set([".next", "node_modules"]);
const TYPE_MODULES = [
  "@/lib/crs/types",
  "@/lib/db/types",
  "@/lib/billing/types",
  "@/lib/idv/types",
  "@/lib/enrollment/types",
];
// Who may hold the service-role key directly. Phase 14 adds two server
// repositories and one named local-only revenue e2e fixture owner.
//
// `tests/e2e/live-chain.test.ts` asserts tracker state — `clients.stage`, `stage_history`, the
// transition audit row, the analysis queue — that no repository exposes and none should: they are
// read by the tracker's own server module, never by a caller. The alternative is a test that builds
// its own client out of `@supabase/supabase-js` and the same environment variable, which is the
// same privilege with none of the visibility this list provides. The file never ships: it runs only
// against a local stack, and `tests/` is outside the Next build.
const ADMIN_IMPORTERS = new Set([
  "src/lib/auth/session.ts",
  "src/lib/enrollment/repository.ts",
  "src/lib/referrals/repository.ts",
  // Integrator merge glue (Phase 17): the notification-outbox bridge reads the
  // generated (subject, window) tuple columns of queued outbox rows so the
  // shared scheduler can enqueue them; it performs no writes.
  "src/lib/ancillary/jobs/register.ts",
  // Phase 10's operator billing tree, mirroring lane B: one repository holds the
  // service-role client, every write in it goes through a security-definer
  // function, and the read of an operator's own state deliberately uses the
  // caller's session-scoped client instead.
  "src/lib/billing/repository-operator.ts",
  // Phase 21's refund repository is the second narrow billing boundary: it
  // invokes one security-definer observation RPC and performs no direct write.
  "src/lib/billing/repository-refunds.ts",
  // C2's paid-invoice evidence repository is the third billing boundary: one
  // security-definer insert of webhook evidence, no read of consumer rows.
  "src/lib/billing/repository-paid-invoices.ts",
  "src/lib/revenue/repository.ts",
  "src/lib/jobs/repository.ts",
  // Phase 10's two e2e suites, on the same footing as live-chain: they seed and
  // tear down their own fixtures on the local stack, so they need the
  // service-role client. Named one file at a time rather than exempting
  // tests/e2e/ wholesale, so a new suite still has to justify itself here.
  "tests/e2e/billing-disabled.test.ts",
  "tests/e2e/live-chain.test.ts",
  "tests/e2e/operator-dunning.test.ts",
  "tests/e2e/revenue-kpis.test.ts",
  // Phase 20's local-only tenancy chain persists and reads back synthetic org,
  // member, brand, job, and enrollment evidence across real HTTP requests.
  "tests/e2e/tenancy.test.ts",
  // Deferred imports are held to the same named-file rule as module-scope
  // imports. Deferred loading is a performance boundary, never a privilege
  // bypass.
  "src/app/api/uploads/[uploadId]/review/route.ts",
  "src/lib/admin/analytics-repository.ts",
  "src/lib/admin/audit-repository.ts",
  "src/lib/admin/bank-catalog-repository.ts",
  "src/lib/admin/jobs/register.ts",
  "src/lib/admin/overview.ts",
  "src/lib/admin/platform.ts",
  "src/lib/admin/prompt-repository.ts",
  "src/lib/admin/settings-repository.ts",
  // B6's health check reads org and background-job counts with the service-role
  // client because it runs before any operator session exists; it performs no
  // writes and answers `false` on an unreachable database.
  "src/lib/admin/health.ts",
  // B2's consumer email dispatch runs inside the notifications job, where there
  // is no session: it reads the notification, the recipient profile and the
  // recipient's preferences, and writes nothing through this client.
  "src/lib/notifications/email-dispatch.server.ts",
  "src/lib/ancillary/notification-repository.ts",
  "src/lib/ancillary/repository.ts",
  "src/lib/ancillary/training-source-storage.ts",
  "src/lib/ancillary/upload-repository.ts",
  "src/lib/analysis/repository.ts",
  "src/lib/applications/consumer.server.ts",
  "src/lib/applications/repository.ts",
  "src/lib/assistant/repository.ts",
  "src/lib/billing/consumer-portal.server.ts",
  "src/lib/crs/alert-retention.ts",
  "src/lib/crs/supabase-ports.ts",
  "src/lib/email/enqueue.ts",
  "src/lib/email/repository.ts",
  "src/lib/enrollment/agreement-download.server.ts",
  "src/lib/enrollment/derived-purge.ts",
  "src/lib/enrollment/email-availability.ts",
  "src/lib/jobs/rediscovery.ts",
  "src/lib/kb/repository.ts",
  "src/lib/kb/search.ts",
  "src/lib/monitoring/read.server.ts",
  "src/lib/operator/client-notes.server.ts",
  "src/lib/operator/platform-revenue.server.ts",
  "src/lib/portal/preferences.server.ts",
  "src/lib/pricing/paid-refresh-read.server.ts",
  "src/lib/pricing/repository.ts",
  "src/lib/privacy/provider-auth.ts",
  "src/lib/privacy/repository.ts",
  "src/lib/privacy/storage.ts",
  "src/lib/support/repository.ts",
  "src/lib/tasks/repository.ts",
  "src/lib/tenancy/brand.ts",
  "src/lib/tenancy/invite-mail.ts",
  "src/lib/tenancy/member-role.ts",
  "src/lib/tenancy/repository.ts",
  "src/lib/timeline/write.server.ts",
  "src/lib/tracker/read.server.ts",
  "src/lib/tracker/transition.server.ts",
  "src/lib/vault/repository.ts",
  "tests/e2e/applications.test.ts",
]);
// Lane B (enrollment) ownership. The write-locality and RouteContext rules below are lane-B
// invariants: other lanes (tracker/, analysis/, auth/) write through their own repositories and
// may declare route-local RouteContext fallbacks, so those two rules only scan these paths.
const LANE_B_PATHS = [
  // Phase 10's operator billing routes. The two rules below are lane-B
  // invariants and this prefix is inside the same tree, so it is listed here
  // rather than exempted: a brand-new route directory outside these arrays
  // would ship with neither write-locality nor copy checks.
  "src/app/api/billing/",
  "src/app/api/enroll/",
  "src/app/api/enrollments/",
  "src/app/api/webhooks/stripe/",
  "src/components/onboarding1.tsx",
  "src/lib/billing/",
  "src/lib/enrollment/",
  "src/lib/idv/",
  "src/lib/referrals/",
  "src/app/api/referrals/",
  "src/components/consumer/referral-share-control.tsx",
];
const isLaneB = (rel) => LANE_B_PATHS.some((candidate) => rel.startsWith(candidate));
const LANE_COPY_PATHS = [
  "src/app/api/billing/",
  "src/app/api/enroll/",
  "src/app/api/enrollments/",
  "src/app/api/webhooks/stripe/",
  "src/components/onboarding1.tsx",
  "src/components/surfaces/consumer.tsx",
  "src/components/surfaces/operator.tsx",
  "src/lib/billing/",
  "src/lib/enrollment/",
  "src/lib/idv/",
];
const COPY_RULES = [
  ["copy C01", /disput/i],
  ["copy C02", /(?<![\w$£€#[])(?<!\d[.,])609(?![\w%])(?!\.\d)(?!,\d)/],
  ["copy C03", /pay[\s._-]?(for|to)[\s._-]?delete/i],
  ["copy C04", /removals?/i],
  ["copy C05", /credit[\s._-]?repair/i],
  ["copy C06", /good[\s._-]?will\b[\s\S]{0,12}?letters?\b|goodwill\s+(letter|adjustment|deletion)/i],
  ["copy C07", /[+＋]\s?\d{1,3}\s*(pts?\b|points?\b)/i],
  ["copy C08", /(raise|boost|increase|improve|add|gain|lift|jump)\w*[^.\n]{0,40}\bscores?\b[^.\n]{0,20}\bby\b[^.\n]{0,12}\d/i],
  ["copy C09", /\b\d{1,3}\s?(pts\b|points?\b)[^.\n]{0,30}\b(scores?|fico|vantage)\b|\b(scores?|fico|vantage)\b[^.\n]{0,30}\b\d{1,3}\s?(pts\b|points?\b)/i],
  ["copy C10", /(approval|approved|qualif\w*|funding)[^.\n]{0,30}\b(odds|chances?|likelihood|probability)\b|\b(odds|chances?|likelihood|probability)\b[^.\n]{0,30}\b(of|to be)\b[^.\n]{0,20}\b(approv\w*|qualif\w*|fund\w*)\b/i],
  ["copy C11", /\b(odds|chances?|likelihood|probability)\b[^.\n]{0,30}\d{1,3}\s?%|\d{1,3}\s?%[^.\n]{0,30}\b(odds|chances?|likelihood|probability)\b/i],
];

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!PRUNED.has(entry.name)) walk(path.join(directory, entry.name), files);
      continue;
    }
    if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

function relative(file) {
  return path.relative(WEB_ROOT, file).split(path.sep).join("/");
}

function isAdminModuleImport(file, specifier) {
  if (specifier === "@/lib/supabase/admin") return true;
  const resolved = path.resolve(path.dirname(file), specifier).replace(/\.(?:[cm]?ts|[cm]?js)$/, "");
  return resolved === path.join(SOURCE_ROOT, "lib/supabase/admin");
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

const files = [...walk(SOURCE_ROOT), ...walk(TEST_ROOT)];
const envExample = path.join(WEB_ROOT, ".env.example");
if (fs.existsSync(envExample)) files.push(envExample);

if (files.length === 0) {
  console.error("source gate: scanned 0 files; required roots are missing");
  process.exit(1);
}

const findings = [];
function report(file, source, index, rule) {
  findings.push(`${relative(file)}:${lineAt(source, index)} [${rule}]`);
}

for (const file of files) {
  const rel = relative(file);
  const raw = fs.readFileSync(file, "utf8");
  // Comments out, strings kept, offsets preserved so `lineOf` still points at the real line.
  //
  // `\bwaitUntil\b` is a bare word, so a comment in `kb/job.ts` explaining that the code
  // deliberately does *not* reach for it was reported as using it. The enum rule three lines below
  // already carries a note saying prose must not trip it — the lesson was written down in this
  // function and not applied to the rest of it. Strings stay because the credential rule is looking
  // for a literal and the import rules match inside quotes.
  const source = stripComments(raw);

  if (rel.startsWith("src/app/api/webhooks/")) {
    for (const match of source.matchAll(/\b(?:req|request)\.json\s*\(/g)) {
      report(file, source, match.index, "webhook body must remain raw");
    }
  }

  if (isLaneB(rel)) {
    for (const match of source.matchAll(/\bRouteContext\s*</g)) {
      report(file, source, match.index, "RouteContext is generated-only");
    }
  }
  // A real TS enum declaration is `enum Name {` (optionally const/declare/export); prose in comments
  // that merely says "the enum type" must not trip the gate.
  for (const match of source.matchAll(/(?:^|[^\w.'"`])(?:const\s+|declare\s+)?enum\s+[A-Za-z_$][\w$]*\s*\{/gm)) {
    report(file, source, match.index, "TypeScript enum is unsupported");
  }
  for (const moduleName of TYPE_MODULES) {
    const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `import\\s*\\{(?![^}]*\\btype\\b)[^}]+\\}\\s*from\\s*["']${escaped}["']`,
      "g",
    );
    for (const match of source.matchAll(pattern)) {
      report(file, source, match.index, `type-only import from ${moduleName}`);
    }
  }
  for (const match of source.matchAll(/\bwaitUntil\b/g)) {
    report(file, source, match.index, "waitUntil is not a public Next API");
  }

  const credentialPattern =
    /\b(?:sk_(?:test|live)_|pk_(?:test|live)_|whsec_|sbp_)[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
  for (const match of source.matchAll(credentialPattern)) {
    report(file, source, match.index, "credential-shaped literal");
  }

  if (
    isLaneB(rel) &&
    !rel.endsWith(".test.ts") &&
    rel !== "src/lib/enrollment/repository.ts"
  ) {
    for (const match of source.matchAll(
      /\.from\s*\([^)]*\)[\s\S]{0,300}?\.(?:insert|update|delete)\s*\(/g,
    )) {
      report(file, source, match.index, "database write outside enrollment repository");
    }
  }

  const adminImport = /(?:\bfrom\s+|\bimport\s*\(\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(adminImport)) {
    const isTypeQuery = match[0].startsWith("import")
      && /typeof\s+$/.test(source.slice(Math.max(0, match.index - 16), match.index));
    if (!isTypeQuery && isAdminModuleImport(file, match[1]) && !ADMIN_IMPORTERS.has(rel)) {
      report(file, source, match.index, "unexpected admin-client importer");
    }
  }

  const copyScoped =
    process.argv.includes("--all-copy") ||
    LANE_COPY_PATHS.some((candidate) =>
      candidate.endsWith("/") ? rel.startsWith(candidate) : rel === candidate,
    );
  if (copyScoped) {
    const lines = source.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      for (const [rule, pattern] of COPY_RULES) {
        if (pattern.test(lines[index])) {
          findings.push(`${rel}:${index + 1} [${rule}]`);
        }
      }
    }
  }
}

const laneAdminImporters = files
  .filter((file) => relative(file).startsWith("src/lib/enrollment/"))
  .filter((file) =>
    /from\s+["']@\/lib\/supabase\/admin["']/.test(stripComments(fs.readFileSync(file, "utf8"))),
  );
if (
  laneAdminImporters.length !== 1 ||
  relative(laneAdminImporters[0] ?? "") !== "src/lib/enrollment/repository.ts"
) {
  findings.push(
    "src/lib/enrollment:1 [lane B must have exactly one admin-client importer: repository.ts]",
  );
}

console.log(`source gates scanned ${files.length} file(s)`);
if (findings.length > 0) {
  for (const finding of findings) console.error(finding);
  console.error(`source gates failed with ${findings.length} finding(s)`);
  process.exit(1);
}
console.log("source gates passed with 0 findings");
