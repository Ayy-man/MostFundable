#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");
const allowedObjects = new Set(["trainings", "document_uploads", "pull_caps", "pull_cap_attempts", "notification_delivery_outbox", "publish_training", "unpublish_training", "set_pull_cap", "clear_pull_cap", "assert_pull_allowed", "insert_crs_alert_notification", "dispatch_notification", "training_audience", "training_source", "document_section", "document_upload_kind", "document_upload_lifecycle", "pull_cap_reason", "notification_delivery_status"]);
const allowedOutcomeColumns = new Set(["client_id", "monitoring_event_id", "delivered_at"]);

function findings(diff) {
  const problems = []; let object = null;
  for (const line of diff.split("\n")) {
    const content = line.startsWith("+") || line.startsWith(" ") ? line.slice(1) : "";
    const header = /^ {6}([a-z_]+):/.exec(content);
    if (header) object = header[1];
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    if (header && !allowedObjects.has(header[1]) && header[1] !== "outcome_notifications" && header[1] !== "analysis_job_source_kind" && header[1] !== "outcome_notification_kind") problems.push(`unexpected object ${header[1]}`);
    const column = /^ {10}([a-z_]+)[?:]:/.exec(content);
    if (column && object === "outcome_notifications" && !allowedOutcomeColumns.has(column[1])) problems.push(`unexpected outcome_notifications column ${column[1]}`);
    if ((content.includes('"document_upload"') && object !== "analysis_job_source_kind") || (content.includes('"crs_alert"') && object !== "outcome_notification_kind")) problems.push("shared enum value appeared outside its allowed enum");
  }
  return problems;
}

const poison = `diff --git a/types.ts b/types.ts\n@@\n   public: {\n     Tables: {\n+      sibling_private_table: {\n+          secret_value: string\n`;
assert.deepEqual(findings(poison), ["unexpected object sibling_private_table"], "poisoned types diff was not rejected");
if (process.argv.includes("--self-test")) {
  console.log("Ancillary types scope self-test passed: poisoned sibling object rejected.");
  process.exit(0);
}
const diff = execFileSync("git", ["diff", "--", "web/src/lib/db/types.ts"], { cwd: repoRoot, encoding: "utf8" });
const problems = findings(diff);
assert.equal(problems.length, 0, problems.join("; "));
console.log(diff.trim() ? "Ancillary generated type diff is bounded to Phase 17." : "Ancillary generated type scan passed with no local type diff; generation is deferred to integration.");
