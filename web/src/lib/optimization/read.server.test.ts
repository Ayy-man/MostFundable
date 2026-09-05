import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * `read.server.ts` imports `server-only`, so it cannot be loaded under `node --test`; this file
 * asserts its contract against the source, the way `tracker/read.server.test.ts` does.
 *
 * The assertions are derived rather than transcribed: the table list comes from scanning the
 * module's own `.from(...)` calls, so a query added tomorrow is covered by the same rule without
 * anyone remembering to extend a list here.
 */
const raw = readFileSync(new URL("./read.server.ts", import.meta.url), "utf8");

/**
 * Comments are stripped before any assertion runs. This module documents at length WHY it never
 * takes the service-role client, so a scan of the raw text finds the very names the rule forbids
 * and reports the explanation as the violation. The rule is about code, so it reads code.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const source = stripComments(raw);

/** Tables with no client column of their own. Everything else must be scoped to one client. */
const CLIENT_SCOPED_EXEMPT = new Set(["checklist_templates"]);

function queriedTables(): { table: string; statement: string }[] {
  const found: { table: string; statement: string }[] = [];
  for (const match of source.matchAll(/\.from\("([a-z_]+)"\)/g)) {
    const rest = source.slice(match.index);
    const end = rest.indexOf(";");
    found.push({ statement: end === -1 ? rest : rest.slice(0, end), table: match[1] });
  }
  return found;
}

describe("consumer optimization server read contract", () => {
  it("scopes every table it reads to one client, except the ones with no client column", () => {
    const tables = queriedTables();
    assert.ok(tables.length > 0, "no queries were found to check");
    for (const { statement, table } of tables) {
      if (CLIENT_SCOPED_EXEMPT.has(table)) continue;
      const scoped =
        /\.eq\("client_id", clientId\)/.test(statement) ||
        /\.eq\("consumer_profile_id", session\.id\)/.test(statement);
      assert.ok(scoped, `${table} is read without a client predicate`);
    }
  });

  it("never reaches for the service-role client", () => {
    assert.doesNotMatch(source, /createAdminClient|supabase\/admin|service_role/);
  });

  it("refuses the read outright when there is no real session to scope by", () => {
    assert.ok(
      source.indexOf('featureFlag("FEATURE_REAL_AUTH")') < source.indexOf("createClient"),
      "the real-auth gate must precede the client construction",
    );
    assert.match(source, /if \(!featureFlag\("FEATURE_REAL_AUTH"\)\) throw new OptimizationDataError\("forbidden"\)/);
  });

  it("selects named columns only, so a new derived column cannot ride along", () => {
    assert.doesNotMatch(source, /\.select\("\*"\)/);
  });

  it("reads the narrative from the same row as the plan body", () => {
    // Two queries could pair a narrative with a body from a different analysis run if a worker
    // wrote between them, so the prose and the plan it describes must come off one row.
    assert.match(source, /"body, readiness_score, narrative"/);
  });

  it("falls back to the pre-435 column list instead of failing the whole read", () => {
    assert.match(source, /isMissingColumnError\(error, "narrative"\)/);
    assert.match(source, /"body, readiness_score"/);
    // The fallback keeps the same predicates, so it cannot widen scope while it narrows columns.
    const fallback = source.slice(source.indexOf("isMissingColumnError"));
    assert.match(fallback, /\.eq\("client_id", clientId\)/);
  });

  it("takes the newest plan and the newest run rather than an arbitrary row", () => {
    assert.match(source, /\.order\("version", \{ ascending: false \}\)[\s\S]{0,40}\.limit\(1\)/);
    assert.match(source, /\.order\("ran_at", \{ ascending: false \}\)[\s\S]{0,40}\.limit\(1\)/);
  });
});
