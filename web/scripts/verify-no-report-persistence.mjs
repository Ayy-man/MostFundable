import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(
  projectRoot,
  "src/lib/crs/__fixtures__/scanner-must-reject.txt",
);
const sqlFixturePath = path.join(
  projectRoot,
  "src/lib/crs/__fixtures__/scanner-migration-must-reject.sql",
);

const SINK_NAMES = new Set([
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "trace",
  "stringify",
  "insert",
  "upsert",
  "update",
  "delete",
  "rpc",
  "from",
  "record",
  "setItem",
  "write",
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "String",
  "persist",
  "save",
  "enqueue",
  "publish",
  "send",
]);

const SENSITIVE_TOKENS = new Map(
  ["report", "payload", "tradeline", "rawBody", "bureauBody", "snapshot"].map(
    (token) => [token.toLowerCase(), token],
  ),
);

// Each exception names one call, one reason, and enough source shape to consume at most one hit.
// A new exception without a name or reason is a control failure, not a shortcut around the scan.
const ALLOW_LIST = [
  {
    name: "shared-contract-proves-report-seal",
    expectedCount: 1,
    file: "src/lib/crs/adapter-contract.ts",
    kind: "sink-call",
    sink: "stringify",
    token: "report",
    snippetIncludes: "JSON.stringify(report)",
    reason:
      "The call is inside assert.throws and proves that a driver-produced report refuses serialization.",
  },
  {
    name: "shared-contract-proves-report-redaction",
    expectedCount: 1,
    file: "src/lib/crs/adapter-contract.ts",
    kind: "sink-call",
    sink: "String",
    token: "report",
    snippetIncludes: "String(report)",
    reason:
      "The call asserts the sealed report's fixed redaction marker and does not expose its body.",
  },
  {
    name: "webhook-hmac-covers-exact-request-body",
    expectedCount: 1,
    file: "src/lib/crs/webhook.ts",
    kind: "sink-call",
    sink: "update",
    token: "rawBody",
    snippetIncludes: ".update(input.rawBody, 'utf8')",
    reason:
      "The digest consumes the exact request body for signature verification and retains none of it.",
  },
  {
    name: "openrouter-sends-derived-only-request-body",
    expectedCount: 1,
    file: "src/lib/llm/chat-transport.ts",
    kind: "queue-field",
    sink: "send",
    token: "body",
    snippetIncludes: "body: JSON.stringify(body)",
    reason:
      "The shared transport serializes only the closed request body assembled by its typed adapters; no source report can enter it.",
  },
];

// This exact ledger makes every public JSON/binary column declared by migrations
// review-visible. A new generic persistence slot fails until its concrete schema
// purpose is examined and added deliberately.
const REVIEWED_PUBLIC_DATA_COLUMNS = new Map([
  ["admin_layouts.layout", "jsonb"],
  ["analysis_runs.derived", "jsonb"],
  // Reviewed 2026-08-23 (migration 387): the citation chips an assistant turn
  // renders. `private.assistant_sources_valid` refuses any element key outside
  // `kind`/`label`/`ref`, so this column cannot become a general payload: `kind`
  // is the closed set client|bank|article|operator|metric, `label` is 1-120
  // characters of the human name the surface prints, and `ref` is an opaque
  // handle that is passed back and never rendered. No bureau data, no report
  // fields, no consumer identity beyond a name already shown on the surface —
  // and `assistant_turns_user_carries_no_source` keeps a person's own question
  // from carrying any of it.
  ["assistant_turns.sources", "jsonb"],
  ["audit_log.meta", "jsonb"],
  ["bank_outcome_stats.windows", "jsonb"],
  // Reviewed 2026-09-01 (migration 420): platform-admin corrections to the
  // lender catalog. The table check calls `private.bank_catalog_payload_valid`,
  // which requires the exact 13 lender-metadata keys, validates every nested
  // question and scalar, and rejects any extra key. The write RPC also requires
  // a platform-admin actor. There is no consumer identifier, bureau response,
  // score, tradeline, or report-shaped field in this closed object.
  ["bank_catalog_overrides.payload", "jsonb"],
  // Reviewed 2026-08-20 (Phase 8): lender application questions copied from
  // VAULT `bank_application_details` plus the four standing questions — lender
  // metadata only, written by the J6 sync through `vault05-text`'s value
  // filter; no consumer identity, no bureau data, no report fields.
  ["banks_cache.application_questions", "jsonb"],
  ["bank_retrieval_index.document", "jsonb"],
  ["consumer_referrals.token_hash", "bytea"],
  ["document_uploads.derived_features", "jsonb"],
  ["eval_runs.result", "jsonb"],
  ["kb_articles.metadata", "jsonb"],
  ["kpi_rollups.metrics", "jsonb"],
  ["orgs.brand", "jsonb"],
  ["plans.body", "jsonb"],
  ["settings.value", "jsonb"],
  ["vault_writeback_outbox.payload", "jsonb"],
]);

function finalPropertyName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression !== undefined &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }
  return null;
}

function sensitiveTokensInside(node) {
  const found = new Set();

  function visit(current) {
    if (ts.isIdentifier(current)) {
      const canonical = SENSITIVE_TOKENS.get(current.text.toLowerCase());
      if (canonical !== undefined) found.add(canonical);
    } else if (ts.isStringLiteralLike(current)) {
      const canonical = SENSITIVE_TOKENS.get(current.text.toLowerCase());
      if (canonical !== undefined) found.add(canonical);
    }
    ts.forEachChild(current, visit);
  }

  visit(node);
  return [...found];
}

function isObjectAssign(expression) {
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "Object" &&
    expression.name.text === "assign"
  );
}

function findingFor(sourceFile, node, details) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    ...details,
    line: position.line + 1,
    snippet: node.getText(sourceFile),
  };
}

function propertyName(node) {
  if (
    ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node) ||
    ts.isMethodDeclaration(node)
  ) {
    if (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) return node.name.text;
  }
  return null;
}

function isDeferredFunction(node) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function variableName(node) {
  return ts.isIdentifier(node.name) ? node.name.text : null;
}

function detectSource(source, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const findings = [];

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const importsSoftPullReport =
        node.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(node.importClause.namedBindings) &&
        node.importClause.namedBindings.elements.some(
          (element) => element.name.text === "SoftPullReport",
        );
      const normalizedFile = fileName.split(path.sep).join("/");
      if (
        importsSoftPullReport &&
        !normalizedFile.startsWith("src/lib/crs/") &&
        normalizedFile !== "src/lib/analysis/features.ts"
      ) {
        findings.push(
          findingFor(sourceFile, node, {
            kind: "forbidden-import",
            sink: "import",
            token: "SoftPullReport",
          }),
        );
      }
    }

    if (ts.isCallExpression(node)) {
      const sink = finalPropertyName(node.expression);
      const tokens = node.arguments.flatMap((argument) => sensitiveTokensInside(argument));

      if (sink !== null && SINK_NAMES.has(sink)) {
        for (const token of new Set(tokens)) {
          findings.push(
            findingFor(sourceFile, node, { kind: "sink-call", sink, token }),
          );
        }
      }

      const copySink =
        sink === "structuredClone"
          ? "structuredClone"
          : isObjectAssign(node.expression)
            ? "Object.assign"
            : null;
      if (copySink !== null) {
        for (const token of new Set(tokens)) {
          findings.push(
            findingFor(sourceFile, node, { kind: "copy-call", sink: copySink, token }),
          );
        }
      }

      const queueSink = sink !== null && /queue|enqueue|publish|send|job/i.test(sink);
      if (queueSink) {
        for (const argument of node.arguments) {
          if (!ts.isObjectLiteralExpression(argument)) continue;
          for (const property of argument.properties) {
            const name = propertyName(property);
            if (
              name !== null &&
              ["payload", "body", "meta", "message", "content", "snapshot", "report"].includes(
                name,
              )
            ) {
              findings.push(
                findingFor(sourceFile, property, {
                  kind: "queue-field",
                  sink,
                  token: name,
                }),
              );
            }
          }
        }
      }
    }

    if (ts.isNewExpression(node) && finalPropertyName(node.expression) === "Error") {
      const tokens = (node.arguments ?? []).flatMap((argument) => sensitiveTokensInside(argument));
      for (const token of new Set(tokens)) {
        findings.push(
          findingFor(sourceFile, node, { kind: "error-construction", sink: "Error", token }),
        );
      }
    }

    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const name = variableName(node);
      const tokens = sensitiveTokensInside(node.initializer);
      if (name !== null && /prompt|message|content/i.test(name)) {
        for (const token of tokens) {
          findings.push(
            findingFor(sourceFile, node, {
              kind: "prompt-construction",
              sink: name,
              token,
            }),
          );
        }
      }

      if (isDeferredFunction(node.initializer)) {
        for (const token of tokens.filter((token) => token === "report")) {
          findings.push(
            findingFor(sourceFile, node, {
              kind: "retained-closure",
              sink: "closure",
              token,
            }),
          );
        }
      }
    }

    if (ts.isSpreadAssignment(node)) {
      for (const token of sensitiveTokensInside(node.expression)) {
        findings.push(
          findingFor(sourceFile, node, {
            kind: "object-spread",
            sink: "object-spread",
            token,
          }),
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function detectSqlSource(source, fileName) {
  const findings = [];
  const columns = [];
  const tablePattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z][a-z0-9_]*)\s*\(([^;]+)\);/gis;
  const dataColumnPattern = /^"?([a-z][a-z0-9_]*)"?\s+(json|jsonb|bytea)\b/i;
  let match;

  while ((match = tablePattern.exec(source)) !== null) {
    const table = match[1];
    const tableBody = match[2];
    const tableOffset = match.index + match[0].indexOf(tableBody);
    for (const line of tableBody.split("\n")) {
      const trimmed = line.trim().replace(/,$/, "");
      if (!trimmed || /^(constraint|primary|unique|foreign|check)\b/i.test(trimmed)) continue;
      const declaration = dataColumnPattern.exec(trimmed);
      if (declaration) {
        const lineOffset = source.indexOf(line, tableOffset);
        const before = source.slice(0, lineOffset);
        const column = declaration[1];
        const type = declaration[2].toLowerCase();
        const key = `${table}.${column}`;
        columns.push({ file: fileName, key, line: before.split("\n").length, type });
        if (REVIEWED_PUBLIC_DATA_COLUMNS.get(key) !== type) {
          findings.push({
            file: fileName,
            kind: "unreviewed-public-data-column",
            sink: table,
            token: key,
            line: before.split("\n").length,
            snippet: trimmed,
          });
        }
      }
    }
  }

  return { columns, findings };
}

function collectFiles(root, predicate) {
  if (!fs.existsSync(root)) return [];

  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolute, predicate));
    } else if (predicate(absolute)) {
      files.push(absolute);
    }
  }
  return files;
}

function defaultScanFiles() {
  const crsRoot = path.join(projectRoot, "src/lib/crs");
  const analysisRoot = path.join(projectRoot, "src/lib/analysis");
  const llmRoot = path.join(projectRoot, "src/lib/llm");
  const ancillaryRoot = path.join(projectRoot, "src/lib/ancillary");
  const apiRoot = path.join(projectRoot, "src/app/api");
  const supabaseRoot = path.resolve(projectRoot, "../supabase");
  const isIncludedTypeScript = (file) => {
    const normalized = file.split(path.sep).join("/");
    return (
      file.endsWith(".ts") &&
      !file.endsWith(".test.ts") &&
      !normalized.includes("/__fixtures__/")
    );
  };

  return [
    ...collectFiles(crsRoot, isIncludedTypeScript),
    ...collectFiles(analysisRoot, isIncludedTypeScript),
    ...collectFiles(llmRoot, isIncludedTypeScript),
    ...collectFiles(ancillaryRoot, isIncludedTypeScript),
    ...collectFiles(apiRoot, (file) => file.endsWith(`${path.sep}route.ts`)),
    ...collectFiles(
      path.join(supabaseRoot, "migrations"),
      (file) => file.endsWith(".sql"),
    ),
  ].sort();
}

function validateAllowList() {
  const names = new Set();
  for (const entry of ALLOW_LIST) {
    assert.ok(entry.name.trim(), "Every scanner exception needs a name.");
    assert.ok(entry.reason.trim(), `Scanner exception ${entry.name} needs a reason.`);
    assert.equal(entry.expectedCount, 1, `Scanner exception ${entry.name} must consume one hit.`);
    assert.ok(!names.has(entry.name), `Duplicate scanner exception name: ${entry.name}`);
    names.add(entry.name);
  }
}

function applyAllowList(findings) {
  validateAllowList();
  const remaining = [...findings];

  for (const entry of ALLOW_LIST) {
    const matches = remaining
      .map((finding, index) => ({ finding, index }))
      .filter(
        ({ finding }) =>
          finding.file === entry.file &&
          finding.kind === entry.kind &&
          finding.sink === entry.sink &&
          finding.token === entry.token &&
          finding.snippet.includes(entry.snippetIncludes),
      );

    assert.equal(
      matches.length,
      entry.expectedCount,
      `Scanner exception count changed: ${entry.name}`,
    );
    const index = matches[0]?.index ?? -1;
    remaining.splice(index, 1);
  }

  return remaining;
}

function runSelfTest() {
  const fixture = fs.readFileSync(fixturePath, "utf8");
  const findings = detectSource(fixture, "scanner-must-reject.ts");
  const sqlFixture = fs.readFileSync(sqlFixturePath, "utf8");
  const sqlResult = detectSqlSource(sqlFixture, "scanner-migration-must-reject.sql");
  const expected = [
    ["sink-call", "log", "report"],
    ["sink-call", "stringify", "payload"],
    ["sink-call", "insert", "snapshot"],
    ["sink-call", "error", "rawBody"],
    ["sink-call", "record", "tradeline"],
    ["sink-call", "update", "payload"],
    ["object-spread", "object-spread", "report"],
    ["copy-call", "structuredClone", "payload"],
    ["copy-call", "Object.assign", "snapshot"],
    ["sink-call", "persist", "report"],
    ["prompt-construction", "planPrompt", "report"],
    ["error-construction", "Error", "report"],
    ["queue-field", "enqueueAnalysisRun", "payload"],
    ["retained-closure", "closure", "report"],
    ["forbidden-import", "import", "SoftPullReport"],
  ];

  for (const [kind, sink, token] of expected) {
    assert.ok(
      findings.some(
        (finding) =>
          finding.kind === kind && finding.sink === sink && finding.token === token,
      ),
      `Scanner self-test missed ${kind}/${sink}/${token}.`,
    );
  }

  assert.ok(
    sqlResult.findings.some(
      (finding) => finding.kind === "unreviewed-public-data-column" && finding.token === "analysis_jobs.payload",
    ),
    "Scanner self-test missed the unreviewed public data column.",
  );

  return findings.length + sqlResult.findings.length;
}

function runRealScan() {
  const files = defaultScanFiles();
  const columns = [];
  const findings = files.flatMap((file) => {
    const relative = path.relative(projectRoot, file).split(path.sep).join("/");
    const source = fs.readFileSync(file, "utf8");
    if (file.endsWith(".sql")) {
      const result = detectSqlSource(source, relative);
      columns.push(...result.columns);
      return result.findings;
    }
    return detectSource(source, relative).map((finding) => ({ ...finding, file: relative }));
  });

  for (const [key, type] of REVIEWED_PUBLIC_DATA_COLUMNS) {
    const matches = columns.filter((column) => column.key === key && column.type === type);
    if (matches.length !== 1) {
      findings.push({
        file: matches[0]?.file ?? "../supabase/migrations",
        kind: "reviewed-public-data-column-count",
        sink: key.split(".")[0],
        token: key,
        line: matches[0]?.line ?? 1,
        snippet: `${key}:${type}:${matches.length}`,
      });
    }
  }

  return { columns, files, findings: applyAllowList(findings) };
}

try {
  const selfTestFindings = runSelfTest();

  if (process.argv.includes("--self-test")) {
    console.log(`No-report persistence scanner self-test passed: ${selfTestFindings} findings.`);
  } else {
    const result = runRealScan();
    if (result.findings.length > 0) {
      for (const finding of result.findings) {
        console.error(
          `${finding.file}:${finding.line} — ${finding.kind}/${finding.sink} — ${finding.token}`,
        );
      }
      throw new Error(`${result.findings.length} unapproved report-data path(s) found.`);
    }

    console.log(
      `Static report-data path scan passed: ${result.files.length} files, every migration, ${result.columns.length} reviewed public json/jsonb/bytea columns, ${SINK_NAMES.size} call sinks, ${ALLOW_LIST.length} named exceptions; production TypeScript excludes *.test.ts and __fixtures__; self-test ${selfTestFindings} findings.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
