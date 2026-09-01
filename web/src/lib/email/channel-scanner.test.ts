import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

type Finding = Readonly<{ code: string; file: string }>;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SMS_MODULES = ["twilio", "@vonage/server-sdk", "messagebird", "plivo", "telnyx", "@aws-sdk/client-sns"];
// `.claude` and `coverage` can hold harness worktrees — full checkouts of this tree. Scanning
// them counts every registration once per generated checkout, which reports the one real
// `notifications.dispatch` handler as a duplicate whenever a QA lane is open.
const SKIP_DIRS = new Set([".claude", ".git", ".next", ".planning", "coverage", "node_modules", "tests"]);

function candidateFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...candidateFiles(path));
    else if (
      /(?:package(?:-lock)?\.json|\.(?:ts|tsx|js|mjs|cjs|sql))$/.test(entry.name)
      && !/\.test\.(?:ts|tsx|js)$/.test(entry.name)
    ) files.push(path);
  }
  return files;
}

export function scanChannels(root: string): Finding[] {
  const findings: Finding[] = [];
  let notificationHandlers = 0;
  let notificationCadences = 0;

  for (const path of candidateFiles(root)) {
    const text = readFileSync(path, "utf8");
    const file = relative(root, path).replaceAll("\\", "/");
    const isManifest = /^package(?:-lock)?\.json$/.test(basename(path));

    for (const moduleName of SMS_MODULES) {
      const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const modulePattern = isManifest
        ? new RegExp(`["']${escaped}["']\\s*:`)
        : new RegExp(`(?:from\\s+|import\\s*\\(|require\\s*\\()["']${escaped}(?:["'/])`);
      if (modulePattern.test(text)) findings.push({ code: "SMS_SDK", file });
    }

    if (/notification_delivery|src\/lib\/email|lib\/email/.test(text)) {
      for (const match of text.matchAll(/\bchannel\s*[:=]\s*["']([^"']+)["']/g)) {
        if (match[1] !== "in_app" && match[1] !== "email") {
          findings.push({ code: "CHANNEL_LITERAL", file });
        }
      }
    }

    if (/register(?:JobHandler|CadenceProvider)\(\s*["'][^"']*(?:email|mail)[^"']*["']/i.test(text)) {
      findings.push({ code: "EMAIL_JOB", file });
    }
    notificationHandlers += text.match(/registerJobHandler\(\s*["']notifications\.dispatch["']/g)?.length ?? 0;
    notificationCadences += text.match(/registerCadenceProvider\(\s*["']notifications\.dispatch["']/g)?.length ?? 0;
  }

  if (notificationHandlers > 1) findings.push({ code: "DUPLICATE_NOTIFICATION_HANDLER", file: "<tree>" });
  if (notificationCadences > 1) findings.push({ code: "DUPLICATE_NOTIFICATION_CADENCE", file: "<tree>" });
  return findings;
}

describe("channel scanner", () => {
  it("self-tests every channel rule with planted breaches", () => {
    const root = mkdtempSync(join(tmpdir(), "phase-25-channel-scanner-"));
    try {
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { twilio: "1.0.0" } }));
      writeFileSync(join(root, "src/queue.ts"), "const notification_delivery_outbox = { channel: 'push' };\n");
      writeFileSync(join(root, "src/jobs.ts"), "registerJobHandler('email.dispatch', handler);\n");
      writeFileSync(join(root, "src/duplicate.ts"), "registerJobHandler('notifications.dispatch', first); registerJobHandler('notifications.dispatch', second);\n");

      const codes = new Set(scanChannels(root).map((finding) => finding.code));
      assert.deepEqual(
        [...codes].sort(),
        ["CHANNEL_LITERAL", "DUPLICATE_NOTIFICATION_HANDLER", "EMAIL_JOB", "SMS_SDK"].sort(),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("finds no unapproved channel, SMS SDK or second email loop in the real tree", () => {
    assert.deepEqual(scanChannels(REPO_ROOT), []);

    const migration = readFileSync(join(REPO_ROOT, "supabase/migrations/220_email_delivery.sql"), "utf8");
    assert.match(
      migration,
      /create type public\.notification_delivery_channel as enum \('in_app', 'email'\)/,
    );
  });
});
