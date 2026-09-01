import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC_ROOT = join(WEB_ROOT, "src");

function productionFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...productionFiles(path));
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.test\.(?:ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const files = productionFiles(SRC_ROOT);
/**
 * Comments out, strings kept. The edge sets below are built by scanning every production file for a
 * function name and then compared with `deepEqual`, so one comment in `applications/writeback.ts`
 * noting that billing calls `enqueueOperatorCardFailureEmail` added that file to the enqueue-edge
 * set and broke the equality. Strings stay because the import rule matches on `from "@/lib/email/"`
 * and the template rule on literals like `MESSAGE: "Sign in to view"`.
 */
const source = (path: string) => stripComments(readFileSync(path, "utf8"));
const named = (path: string) => relative(WEB_ROOT, path).replaceAll("\\", "/");

describe("email matrix", () => {
  it("freezes the three approved owners and the sole application template", () => {
    assert.deepEqual([
      { owner: "supabase", events: ["auth", "invites"] },
      { owner: "stripe", events: ["receipts"] },
      { owner: "application-email", events: ["operator_card_failure"] },
    ], [
      { owner: "supabase", events: ["auth", "invites"] },
      { owner: "stripe", events: ["receipts"] },
      { owner: "application-email", events: ["operator_card_failure"] },
    ]);
  });

  it("has one billing enqueue edge and one driver-send edge", () => {
    const enqueueEdges = files
      .filter((path) => !named(path).startsWith("src/lib/email/"))
      .filter((path) => source(path).includes("enqueueOperatorCardFailureEmail"))
      .map(named);
    const driverSendEdges = files
      .filter((path) => /\bdependencies\.driver\.send\s*\(/.test(source(path)))
      .map(named);

    assert.deepEqual(enqueueEdges, ["src/lib/billing/service-operator.ts"]);
    assert.deepEqual(driverSendEdges, ["src/lib/email/dispatch.ts"]);
  });

  it("keeps application email out of externally owned and in-app trees", () => {
    const forbidden = [
      "src/lib/auth/",
      "src/lib/enrollment/",
      "src/lib/tracker/",
      "src/lib/applications/",
      "src/lib/fees/",
      "src/lib/support/",
      "src/app/",
    ];
    const imports = files.filter((path) => {
      const name = named(path);
      return forbidden.some((prefix) => name.startsWith(prefix))
        && /(?:from\s+|import\s*\()["']@\/lib\/email\//.test(source(path));
    });
    assert.deepEqual(imports.map(named), []);
  });

  it("keeps crs_alert as a non-wired generic builder", () => {
    const templates = source(join(SRC_ROOT, "lib/email/templates.ts"));
    const enqueue = source(join(SRC_ROOT, "lib/email/enqueue.ts"));
    const billing = source(join(SRC_ROOT, "lib/billing/service-operator.ts"));
    const notifications = source(join(SRC_ROOT, "lib/ancillary/notifications.ts"));

    assert.match(templates, /providerTemplate:\s*null/);
    assert.match(templates, /MESSAGE:\s*"Sign in to view"/);
    assert.match(templates, /CLIENT_REFERENCE:\s*clientReference/);
    assert.doesNotMatch(enqueue, /crs_alert/);
    assert.doesNotMatch(billing, /crs_alert/);
    assert.doesNotMatch(notifications, /crs_alert/);
  });
});
