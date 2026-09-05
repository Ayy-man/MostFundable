#!/usr/bin/env node
// Creates or updates the nine product email templates in Resend from docs/email-templates and
// publishes them, so the alias the driver sends as `template.id` resolves. Idempotent: a template
// whose alias already exists is updated in place, then republished.
//
//   RESEND_API_KEY=re_... node scripts/publish-resend-templates.mjs [--dry-run]
//
// The key is read from the environment only; it is never written anywhere. Nothing is sent.

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const API = "https://api.resend.com";
const DIR = resolve(import.meta.dirname, "../../docs/email-templates");
const FROM = `MostFundable <${process.env.EMAIL_FROM_ADDRESS ?? "notifications@mostfundable.com"}>`;
const DRY = process.argv.includes("--dry-run");

const SUBJECTS = {
  "consumer-monitoring-alert": "There is a new credit alert on your account",
  "consumer-stage-change": "Your funding journey moved to a new stage",
  "consumer-analysis-complete": "Your plan is ready",
  "consumer-refresh-result": "Your refresh has finished",
  "consumer-enrollment-milestone": "You completed an onboarding step",
  "consumer-document": "A new document is on your account",
  "consumer-team-message": "Your team sent you a message",
  "consumer-application-update": "There is an update on one of your applications",
  "operator-card-failure": "A payment for your workspace did not go through",
};
const CONSUMER_VARIABLES = [
  { key: "GIVEN_NAME", type: "string", fallback_value: "there" },
  { key: "APP_PATH", type: "string", fallback_value: "/" },
];

const key = process.env.RESEND_API_KEY;
if (!key && !DRY) {
  console.error("RESEND_API_KEY is not set");
  process.exit(2);
}

async function api(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${json?.message ?? text.slice(0, 200)}`);
  }
  return json;
}

async function existingByAlias() {
  const byAlias = new Map();
  let after;
  do {
    const page = await api("GET", `/templates?limit=100${after ? `&after=${after}` : ""}`);
    for (const item of page?.data ?? []) if (item.alias) byAlias.set(item.alias, item.id);
    after = page?.has_more ? page.data.at(-1)?.id : undefined;
  } while (after);
  return byAlias;
}

const files = readdirSync(DIR).filter((name) => name.endsWith(".html")).sort();
const missing = files.map((f) => f.replace(/\.html$/, "")).filter((alias) => !SUBJECTS[alias]);
if (missing.length) {
  console.error(`no subject for: ${missing.join(", ")}`);
  process.exit(2);
}

const existing = DRY ? new Map() : await existingByAlias();
for (const file of files) {
  const alias = file.replace(/\.html$/, "");
  const html = readFileSync(resolve(DIR, file), "utf8");
  const body = {
    name: alias,
    alias,
    from: FROM,
    subject: SUBJECTS[alias],
    html,
    variables: alias.startsWith("consumer-") ? CONSUMER_VARIABLES : [],
  };
  if (DRY) {
    console.log(`would ${existing.has(alias) ? "update" : "create"} ${alias} (${html.length} bytes, ${body.variables.length} variables)`);
    continue;
  }
  let id = existing.get(alias);
  if (id) {
    await api("PATCH", `/templates/${id}`, body);
    console.log(`updated  ${alias} ${id}`);
  } else {
    const created = await api("POST", "/templates", body);
    id = created.id;
    console.log(`created  ${alias} ${id}`);
  }
  await api("POST", `/templates/${id}/publish`);
  console.log(`published ${alias}`);
}
