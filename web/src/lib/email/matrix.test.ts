import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";
import { CONSUMER_NOTIFICATION_EMAIL_TEMPLATES } from "@/lib/notifications/email-dispatch";
import { EMAIL_TEMPLATE_REGISTRY } from "./templates.ts";

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
  it("gives every declared application template one product sender and a provider contract", () => {
    const operatorDispatcher = source(join(SRC_ROOT, "lib/email/dispatch.ts"));
    const consumerDispatcher = source(join(SRC_ROOT, "lib/notifications/email-dispatch.ts"));
    const consumerTemplates = Object.values(CONSUMER_NOTIFICATION_EMAIL_TEMPLATES);
    const senderByTemplate = new Map<string, string>([
      ["operator_card_failure", "src/lib/email/dispatch.ts"],
      ...consumerTemplates.map((template) => [template, "src/lib/notifications/email-dispatch.ts"] as const),
    ]);

    assert.equal(
      (operatorDispatcher.match(/dependencies\.driver\.send\(\{[\s\S]*?template:\s*"operator_card_failure"/) ?? []).length,
      1,
    );
    assert.equal(
      (consumerDispatcher.match(/dependencies\.driver\(\)\.send\(\{/) ?? []).length,
      1,
    );
    assert.equal(new Set(consumerTemplates).size, consumerTemplates.length);
    assert.deepEqual(
      [...senderByTemplate.keys()].sort(),
      Object.keys(EMAIL_TEMPLATE_REGISTRY).sort(),
    );
    assert.equal(senderByTemplate.size, Object.keys(EMAIL_TEMPLATE_REGISTRY).length);
    for (const definition of Object.values(EMAIL_TEMPLATE_REGISTRY)) {
      if (
        typeof definition.providerTemplate !== "string"
        || definition.providerTemplate.length === 0
      ) {
        assert.fail(`${definition.template} lacks a provider template`);
      }
    }
  });

  it("has one billing enqueue edge and exactly two driver-send edges", () => {
    const enqueueEdges = files
      .filter((path) => !named(path).startsWith("src/lib/email/"))
      .filter((path) => source(path).includes("enqueueOperatorCardFailureEmail"))
      .map(named);
    const driverSendEdges = files
      .filter((path) => /\bdependencies\.driver(?:\(\))?\.send\s*\(/.test(source(path)))
      .map(named);

    assert.deepEqual(enqueueEdges, ["src/lib/billing/service-operator.ts"]);
    // Two send edges and no more: the operator card-failure dispatcher, and the consumer event
    // dispatcher that hangs off an already-created in-app notification.
    assert.deepEqual(driverSendEdges.sort(), [
      "src/lib/email/dispatch.ts",
      "src/lib/notifications/email-dispatch.ts",
    ]);
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

  it("routes consumer event email through the one dispatcher, off the in-app delivery row", () => {
    const dispatcher = source(join(SRC_ROOT, "lib/notifications/email-dispatch.ts"));
    const wiring = source(join(SRC_ROOT, "lib/ancillary/notifications.ts"));
    const callers = files
      .filter((path) => !named(path).startsWith("src/lib/notifications/"))
      .filter((path) => /\bdispatchConsumerNotificationEmail\w*/.test(source(path)))
      .map(named);

    assert.deepEqual(callers, ["src/lib/ancillary/notifications.ts"]);
    assert.match(wiring, /envelope\.channel === "in_app"/);
    assert.match(wiring, /deliveryId: envelope\.deliveryId/);
    // Configuration gate before any send, and the whole send wrapped so it cannot throw outward.
    assert.match(dispatcher, /if \(gate !== null\) return skipped\(gate\)/);
    assert.match(dispatcher, /return \{ status: "failed", reason: "send" \}/);
    assert.doesNotMatch(dispatcher, /\bthrow\b/);
  });

  it("routes a CRS alert to the consumer monitoring-alert template", () => {
    const serverDispatcher = source(join(SRC_ROOT, "lib/notifications/email-dispatch.server.ts"));
    const consumerDispatcher = source(join(SRC_ROOT, "lib/notifications/email-dispatch.ts"));

    assert.match(serverDispatcher, /crs_alert:\s*"monitoring_alert"/);
    assert.match(consumerDispatcher, /monitoring_alert:\s*"consumer_monitoring_alert"/);
    assert.equal(Object.hasOwn(EMAIL_TEMPLATE_REGISTRY, "crs_alert"), false);
  });
});
