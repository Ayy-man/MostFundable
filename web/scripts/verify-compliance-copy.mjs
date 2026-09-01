#!/usr/bin/env node
// verify-compliance-copy.mjs — the CI gate for DEV-ONBOARDING rule 4 (UNBLK-07).
//
// It scans the shipped surface of the repo for the vocabulary this product is
// contractually barred from using and fails the build with a `file:line`
// pointer when it finds any. Until now that rule was enforced by manual grep,
// which means it was enforced by whoever remembered.
//
// Dependency-free ESM by design: it imports `node:` built-ins only, so it runs
// from a bare checkout with no `npm install` and inside a pre-commit hook.
// Every API used here has shipped since Node 10, which keeps it correct on
// CI's Node 20: the fs glob helper only landed in Node 22, the recursive
// readdir option cannot prune a subtree, and the dirent path properties are
// still Experimental on the v20 line. So the walk below is manual recursion
// over `withFileTypes` entries, and the guard in the plan greps this file for
// those newer API names — keep them out of the source, comments included.
//
// Run it from `web/` or from the repo root; roots resolve from
// `import.meta.url`, never from `process.cwd()`, so both agree:
//
//   node scripts/verify-compliance-copy.mjs              scan the tree
//   node scripts/verify-compliance-copy.mjs --self-test  prove the gate itself
//
// Exit codes: 0 clean · 1 at least one unsuppressed finding · 2 a structural
// problem such as the required `web/src` root being absent.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPLIANCE_LANGUAGE_RULES, complianceLanguageCodes } from "../src/lib/compliance/language-rules.mjs";
import {
  NORMALIZED_ADVERSARIAL_LANGUAGE,
  ROUND_3_ADVERSARIAL_CASES,
  ROUND_4_ADVERSARIAL_CASES,
  ROUND_4_CLEAN_CASES,
  ROUND_5_ADVERSARIAL_CASES,
  PERCENT_MATRIX_CASES,
  PERCENT_MATRIX_CLEAN_CASES,
  OUTCOME_CERTAINTY_CASES,
  OUTCOME_CERTAINTY_CLEAN_CASES,
} from "../src/lib/compliance/__fixtures__/adversarial-language.mjs";

const SELF_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const COMPLIANCE_FIXTURE_FILE =
  "web/src/lib/llm/__fixtures__/compliance/poisoned-plan.json";

// The rule table. Adding a term means adding one row here and nothing else —
// the scanning loop below is deliberately dumb so that nobody has to touch
// control flow to extend the vocabulary.
//
// Rule ids and labels are neutral on purpose. These strings land in CI logs
// and in developers' terminals, and DEV-ONBOARDING rule 4 covers every string
// this repo writes, so a rule id naming the term it detects would put the term
// into every failure message.
//
// The anchoring on the numeric rules is load-bearing and was measured against
// this tree; see `.planning/phases/00-day-1-unblocks/00-RESEARCH.md` §1 for the
// full false-positive inventory. In short: C02 needs four assertions to survive
// currency amounts, semver segments, CSS units and Tailwind arbitrary values;
// C07 needs both the leading sign and the noun to survive `calc()` and metric
// deltas; C08/C09 need the score noun and the points noun to co-occur inside a
// single sentence; C10/C11 need the odds vocabulary to co-occur with approval
// vocabulary so that "Historical approval rate" — correct copy, used all over
// the tree — stays clean. Do not simplify one of these into a bare substring.
const LABELS = [
  "record-challenge-term", "statute-number", "paid-deletion-offer", "record-erasure-noun",
  "repair-service-term", "courtesy-letter-term", "numeric-score-promise", "numeric-score-promise",
  "numeric-score-promise", "odds-term", "odds-percentage", "agreement-label",
  "numeric-score-promise", "approval-percentage",
  "agreement-label", "numeric-score-promise", "personalized-outcome-rate",
  "personalized-outcome-rate", "personalized-outcome-promise",
  // R4D-01's compositional detectors, C20-C24.
  "personalized-outcome-rate", "numeric-score-promise", "agreement-label",
  "personalized-outcome-promise", "personalized-outcome-promise",
  // R5D-04's start-to-end and single-destination forms of the same numeric promise, C25-C26.
  "numeric-score-promise", "numeric-score-promise",
  // R5D-05's certainty-plus-percentage claim about the reader's own outcome, C27.
  "approval-percentage",
];
const RULES = COMPLIANCE_LANGUAGE_RULES.map((rule, index) => ({
  code: rule.code,
  id: rule.id,
  label: LABELS[index],
  pattern: rule.pattern,
}));

const RULE_IDS = new Set(RULES.map((rule) => rule.id));

// The allow-list. Six entries, and every one of them suppresses a line that is
// either correct compliance copy or the source of a shipped browser-side
// guardrail — code that has to spell the terms it refuses in order to refuse
// them. INTERFACES §5.2 puts every file under `web/src/components/**` off
// limits to this phase, so these lines are suppressed here and never reworded
// there, and DEC-OWN-CI-GATE-DETAILS says the same in the other direction: do
// not weaken a rule pattern to avoid writing an entry.
//
// Each entry is keyed on the file plus a regex over the offending *line*, never
// a line number, because entry 3 covers two separate lines and every one of
// these numbers moves the moment somebody edits above them. `rules` scopes the
// suppression to the ids it names, so a different rule tripping the same line
// still fails the build — that is the difference between an exemption and a
// blind spot. `expect` pins the exemption to a hit count that is asserted in
// both directions, and `why` is asserted to be a real sentence because the
// reason is the only thing that makes this reviewable six weeks from now.
const ALLOWLIST = [
  {
    file: "web/src/components/surfaces/admin.tsx",
    line: /not offers, predictions, or approval odds/,
    rules: ["C10"],
    expect: 1,
    why: "Correct compliance copy: the panel states that its figures are recorded historical outcomes and explicitly disclaims the thing rule 4 bans. Rewording the disclaimer would remove the disclaimer; INTERFACES §5.2 forbids editing the file.",
  },
  // Entry removed 2026-08-22 with the AI Brain chat playground's four scripted
  // replies. The line it covered — "the coach never gives approval odds" — was
  // correct compliance copy inside an answer no model produced, and the
  // playground now posts to the live grounded assistant, whose refusals are
  // written by the platform guardrail rather than by this surface. The gate
  // asserts an entry's hit count in both directions, so a stale entry has to go
  // rather than sit at zero.
  {
    file: COMPLIANCE_FIXTURE_FILE,
    line: /"title":/,
    rules: ["C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08", "C09", "C10", "C11", "C21"],
    expect: 12,
    expectByRule: {
      C01: 1,
      C02: 1,
      C03: 1,
      C04: 1,
      C05: 1,
      C06: 1,
      C07: 1,
      C08: 1,
      C09: 1,
      C10: 1,
      C11: 1,
      // R5D-04. The C09 line is a promised movement of the restricted metric written with an
      // adverb rather than a verb, so the widened C21 now reaches it too. Two rules on one
      // deliberately poisoned line is the gate working; the declaration is what keeps the count
      // assertion honest about it.
      C21: 1,
    },
    why: "This exact path contains negative evaluator data, with one declared line per canonical rule so the local trust boundary and the shared copy gate prove the same blocked cases.",
  },
];

// Scan roots, resolved against the repo root. Only `web/src` is required: the
// rest do not exist yet and must be skipped in silence rather than reported as
// errors, because a gate that is red on a greenfield repo gets switched off.
//
// `web/src/**/prompts/**` needs no entry — walking `web/src` already covers it.
// `web/.env.example` is a deliberate widening beyond the roots
// DEC-OWN-CI-GATE-DETAILS enumerates: it is one line here, it only ever
// strengthens the gate, and that file grows a comment per key this sprint while
// sitting outside every other root.
const SCAN_ROOTS = [
  { kind: "directory", rel: "web/src",              required: true },
  { kind: "directory", rel: "supabase/migrations",  required: false },
  { kind: "prefixed",  rel: "supabase",             required: false, prefix: "seed" },
  { kind: "directory", rel: "web/prompts",          required: false },
  { kind: "file",      rel: "web/.env.example",     required: false },
  // The two documents a client actually reads. Both are exact paths, not a
  // directory root, and that distinction is the whole point: `crs-call-brief.md`
  // sits beside the memo in this repository and carries the regulated-category
  // vocabulary on purpose, in its don't-say/say table. Widening to the repository
  // root or to `docs/` would redden the build for a file that is doing its job,
  // and the fix would then be to weaken the rules. Two lines cost nothing and
  // only ever strengthen the gate, the same reasoning that put `.env.example`
  // above them.
  { kind: "file",      rel: "MILESTONE2-DEMO.md",                        required: false },
  { kind: "file",      rel: "docs/client/CRS-FEASIBILITY-MEMO-DRAFT.md",  required: false },
];

// This script carries the forbidden terms in its own regex sources, and that is
// only safe because `web/scripts/**` is not a scan root. Skipping its own
// absolute path is belt and braces: if anyone ever widens the roots to cover
// the scripts directory, the gate keeps working instead of failing on itself.
const SKIPPED_FILES = new Set([SELF_PATH]);

const PRUNED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".js",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".json",
]);

// A single offending line is echoed back so a developer can see what tripped
// the gate. Cap it so one minified line cannot flood a CI log.
const MAX_ECHOED_LINE = 240;

const toPosixRelative = (baseDir, absolutePath) =>
  path.relative(baseDir, absolutePath).split(path.sep).join("/");

const isDirectory = (absolutePath) => {
  try {
    return fs.statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (absolutePath) => {
  try {
    return fs.statSync(absolutePath).isFile();
  } catch {
    return false;
  }
};

// Manual recursion, pruning as it descends. `readdirSync(..., { withFileTypes:
// true })` has been available since Node 10.10, and pruning during traversal is
// the reason this is hand-rolled rather than a one-line recursive readdir.
function walkDirectory(absoluteDir, collected) {
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      if (PRUNED_DIRECTORIES.has(entry.name)) continue;
      walkDirectory(entryPath, collected);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    collected.push(entryPath);
  }
  return collected;
}

function collectFiles(roots, baseDir) {
  const collected = [];
  const missingRoots = [];
  let rootCount = 0;

  for (const root of roots) {
    const absoluteRoot = path.resolve(baseDir, root.rel);

    if (root.kind === "directory") {
      if (!isDirectory(absoluteRoot)) {
        if (root.required) missingRoots.push(root.rel);
        continue;
      }
      rootCount += 1;
      walkDirectory(absoluteRoot, collected);
      continue;
    }

    if (root.kind === "file") {
      // Explicit file roots are read whatever their extension.
      if (!isFile(absoluteRoot)) {
        if (root.required) missingRoots.push(root.rel);
        continue;
      }
      rootCount += 1;
      collected.push(absoluteRoot);
      continue;
    }

    // `prefixed`: every file in one directory whose name starts with a prefix,
    // which is how `supabase/seed*` is resolved without a glob library.
    if (!isDirectory(absoluteRoot)) {
      if (root.required) missingRoots.push(root.rel);
      continue;
    }
    const matches = fs
      .readdirSync(absoluteRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith(root.prefix))
      .map((entry) => path.join(absoluteRoot, entry.name));
    if (matches.length === 0) {
      if (root.required) missingRoots.push(`${root.rel}/${root.prefix}*`);
      continue;
    }
    rootCount += 1;
    collected.push(...matches);
  }

  const files = [...new Set(collected)].filter(
    (absolutePath) => !SKIPPED_FILES.has(absolutePath),
  );
  return { files, missingRoots, rootCount };
}

function scanFile(absolutePath, relativePath, readErrors) {
  const findings = [];
  let source;
  try {
    source = fs.readFileSync(absolutePath, "utf8");
  } catch (error) {
    readErrors.push(`${relativePath}: ${error.message}`);
    return findings;
  }
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    // One evaluation per line, not one per rule per line. The battery is quadratic otherwise, and
    // R4D-01 added five rules to it.
    const codes = new Set(complianceLanguageCodes(text));
    if (codes.size === 0) continue;
    for (const rule of RULES) {
      if (!codes.has(rule.code)) continue;
      findings.push({
        file: relativePath,
        label: rule.label,
        line: index + 1,
        ruleId: rule.id,
        text: text.trim(),
      });
    }
  }
  return findings;
}

// The whole scan, as a value. Returning the result rather than printing it is
// what lets the self-test drive this over a poisoned temp directory.
function runScan(roots, baseDir = REPO_ROOT) {
  const { files, missingRoots, rootCount } = collectFiles(roots, baseDir);
  const readErrors = [];
  const findings = [];
  for (const absolutePath of files) {
    findings.push(
      ...scanFile(absolutePath, toPosixRelative(baseDir, absolutePath), readErrors),
    );
  }
  return { fileCount: files.length, files, findings, missingRoots, readErrors, rootCount };
}

const formatFinding = (finding) => {
  const text =
    finding.text.length > MAX_ECHOED_LINE
      ? `${finding.text.slice(0, MAX_ECHOED_LINE)} ...`
      : finding.text;
  return `${finding.file}:${finding.line} [${finding.ruleId} ${finding.label}] ${text}`;
};

// A finding is suppressed only when an entry matches its file, its line text
// and its rule id — all three. Every matching entry has its counter bumped
// rather than stopping at the first, so an entry that is broader than it
// declared shows up as an over-count instead of hiding behind its neighbour.
function applyAllowlist(findings, allowlist) {
  const counts = allowlist.map(() => 0);
  const countsByRule = allowlist.map(() => new Map());
  const suppressed = [];
  const unsuppressed = [];

  for (const finding of findings) {
    let matched = false;
    for (let index = 0; index < allowlist.length; index += 1) {
      const entry = allowlist[index];
      if (entry.file !== finding.file) continue;
      if (!entry.rules.includes(finding.ruleId)) continue;
      if (!entry.line.test(finding.text)) continue;
      counts[index] += 1;
      countsByRule[index].set(
        finding.ruleId,
        (countsByRule[index].get(finding.ruleId) ?? 0) + 1,
      );
      matched = true;
    }
    if (matched) suppressed.push(finding);
    else unsuppressed.push(finding);
  }

  return { counts, countsByRule, suppressed, unsuppressed };
}

function checkFixtureContainment(allowlist, baseDir) {
  const problems = [];
  if (path.resolve(baseDir) !== path.resolve(REPO_ROOT)) return problems;
  const fixtureEntries = allowlist.filter((entry) => entry.file === COMPLIANCE_FIXTURE_FILE);
  if (fixtureEntries.length !== 1) {
    problems.push("the negative evaluator fixture must have exactly one exact-path allow-list entry");
    return problems;
  }

  const sourceRoot = path.resolve(baseDir, "web/src");
  if (!isDirectory(sourceRoot)) return problems;
  const importers = walkDirectory(sourceRoot, [])
    .filter((absolutePath) => {
      const relative = toPosixRelative(baseDir, absolutePath);
      return (
        !relative.includes("/__fixtures__/") &&
        !relative.includes(".test.") &&
        /\.[cm]?[jt]sx?$/.test(relative)
      );
    })
    .filter((absolutePath) => fs.readFileSync(absolutePath, "utf8").includes("poisoned-plan"));
  if (importers.length > 0) {
    problems.push("the negative evaluator fixture is referenced by a production import path");
  }
  return problems;
}

// Startup assertions. A typo'd path or a missing reason would otherwise sit
// inert in this list forever, exempting nothing and telling nobody.
function checkAllowlistShape(allowlist, baseDir = REPO_ROOT) {
  const problems = [];

  allowlist.forEach((entry, index) => {
    const label = `allow-list entry ${index + 1} (${entry.file})`;

    if (typeof entry.file !== "string" || entry.file.trim().length === 0) {
      problems.push(`${label} has no file path`);
    } else if (!isFile(path.resolve(baseDir, entry.file))) {
      problems.push(`${label} points at a path that is not on disk`);
    }
    if (!(entry.line instanceof RegExp)) {
      problems.push(`${label} has no line pattern`);
    }
    if (!Array.isArray(entry.rules) || entry.rules.length === 0) {
      problems.push(`${label} names no rule ids`);
    } else {
      const unknown = entry.rules.filter((id) => !RULE_IDS.has(id));
      if (unknown.length > 0) {
        problems.push(`${label} names unknown rule id(s): ${unknown.join(", ")}`);
      }
    }
    if (!Number.isInteger(entry.expect) || entry.expect < 1) {
      problems.push(`${label} has no positive expected hit count`);
    }
    if (entry.expectByRule !== undefined) {
      const expectedRuleIds = Object.keys(entry.expectByRule).sort();
      const declaredRuleIds = [...entry.rules].sort();
      if (
        expectedRuleIds.length !== declaredRuleIds.length ||
        !expectedRuleIds.every((id, ruleIndex) => id === declaredRuleIds[ruleIndex])
      ) {
        problems.push(`${label} has a per-rule inventory that differs from its declared rules`);
      }
      if (
        Object.values(entry.expectByRule).some(
          (count) => !Number.isInteger(count) || count < 1,
        )
      ) {
        problems.push(`${label} has a non-positive per-rule expected hit count`);
      }
      const expectedTotal = Object.values(entry.expectByRule).reduce(
        (total, count) => total + count,
        0,
      );
      if (expectedTotal !== entry.expect) {
        problems.push(`${label} has a per-rule inventory that does not total ${entry.expect}`);
      }
    }
    if (typeof entry.why !== "string" || entry.why.trim().length === 0) {
      problems.push(`${label} has no why — every exemption needs a written reason`);
    }
  });

  problems.push(...checkFixtureContainment(allowlist, baseDir));

  return problems;
}

// Asserted in both directions. Fewer hits than declared means the entry is
// stale and should go; more means either a new occurrence appeared or the line
// pattern is wider than the entry claims. Either way a human has to look, and
// line numbers are free to drift underneath because the count is the assertion.
function checkAllowlistCounts(allowlist, counts, countsByRule) {
  const problems = [];

  allowlist.forEach((entry, index) => {
    const actual = counts[index];
    const label = `allow-list entry ${index + 1} (${entry.file})`;
    if (actual < entry.expect) {
      problems.push(
        `${label} declares ${entry.expect} hit(s) but suppressed ${actual} — the line it covers has changed or gone, so update or delete the entry`,
      );
    }
    if (actual > entry.expect) {
      problems.push(
        `${label} declares ${entry.expect} hit(s) but suppressed ${actual} — a new occurrence appeared or the line pattern is broader than declared`,
      );
    }
    if (entry.expectByRule !== undefined) {
      for (const [ruleId, expected] of Object.entries(entry.expectByRule)) {
        const ruleActual = countsByRule[index].get(ruleId) ?? 0;
        if (ruleActual !== expected) {
          problems.push(
            `${label} declares ${expected} ${ruleId} hit(s) but suppressed ${ruleActual}`,
          );
        }
      }
    }
  });

  return problems;
}

// The gate as a value: it decides an exit code and returns the lines it would
// print rather than printing them. `main` does the printing; the self-test
// drives this exact function over a poisoned temp directory, which is what
// makes the red path proven rather than assumed.
function runGate(roots, allowlist, baseDir = REPO_ROOT) {
  const out = [];
  const err = [];

  // Shape first: a malformed allow-list makes every later number meaningless.
  const shapeProblems = checkAllowlistShape(allowlist, baseDir);
  if (shapeProblems.length > 0) {
    err.push(...shapeProblems);
    err.push(`${shapeProblems.length} allow-list problem(s); nothing was scanned`);
    return { err, exitCode: 1, out, scan: null };
  }

  const scan = runScan(roots, baseDir);

  // Printed on every run, green or red. A gate that scanned nothing and exited
  // 0 is the failure mode that matters most here, so the count is never hidden.
  out.push(`scanned ${scan.fileCount} file(s) across ${scan.rootCount} root(s)`);

  if (scan.missingRoots.length > 0) {
    for (const rel of scan.missingRoots) {
      err.push(`required scan root not found: ${rel} (under ${baseDir})`);
    }
    return { err, exitCode: 2, out, scan };
  }

  if (scan.readErrors.length > 0) {
    for (const message of scan.readErrors) {
      err.push(`could not read a scanned file: ${message}`);
    }
    return { err, exitCode: 2, out, scan };
  }

  const { counts, countsByRule, suppressed, unsuppressed } = applyAllowlist(
    scan.findings,
    allowlist,
  );

  // Printed on green runs too. A gate that only speaks when it fails lets the
  // size of the hole drift out of view one commit at a time.
  const suppressedFiles = new Set(suppressed.map((finding) => finding.file));
  out.push(
    `${allowlist.length} allow-list entries suppressed ${suppressed.length} hit(s) in ${suppressedFiles.size} file(s)`,
  );

  const countProblems = checkAllowlistCounts(allowlist, counts, countsByRule);
  err.push(...countProblems);

  for (const finding of unsuppressed) err.push(formatFinding(finding));
  if (unsuppressed.length > 0) {
    err.push(
      `${unsuppressed.length} unsuppressed finding(s) matched the restricted vocabulary rules`,
    );
  }

  if (countProblems.length > 0 || unsuppressed.length > 0) {
    return { err, exitCode: 1, out, scan };
  }

  out.push("compliance copy gate passed with no unsuppressed findings");
  return { err, exitCode: 0, out, scan };
}

// ---------------------------------------------------------------------------
// Self-test fixtures.
//
// The literals below carry the restricted vocabulary verbatim. That is only
// safe because `web/scripts/**` is not a scan root, and it is the invariant
// somebody breaks while tidying SCAN_ROOTS six weeks from now: if the scripts
// directory ever becomes a root, the fix is to take it back out again, never
// to water the fixtures down. The gate skips its own path as well, so it stays
// green on itself either way.
//
// The negative cases are not invented. Every one of them is a shape that lives
// in this tree today — Tailwind arbitrary values, `calc()` expressions, semver
// segments, bureau score displays, aggregate historical approval rates — and a
// gate that fired on any of them would be switched off inside a week, which is
// why zero noise is a property worth this much fixture code.
// ---------------------------------------------------------------------------

const RULE_CASES = [
  { rule: "C01", match: true, text: "if (handleDispute(request)) {" },
  { rule: "C01", match: true, text: "The dispute window closes in 30 days." },
  { rule: "C01", match: false, text: "const disposition = record.disposition;" },
  { rule: "C01", match: false, text: "Deposit displayed on the statement." },

  { rule: "C02", match: true, text: "Section 609 letter template" },
  { rule: "C02", match: true, text: "609" },
  { rule: "C02", match: true, text: "Read 609." },
  { rule: "C02", match: true, text: "const N = 609;" },
  { rule: "C02", match: false, text: "Total due $609" },
  { rule: "C02", match: false, text: "Balance £609.00 outstanding" },
  { rule: "C02", match: false, text: "invoice 1609 settled" },
  { rule: "C02", match: false, text: "see issue #609" },
  { rule: "C02", match: false, text: 'className="z-[609]"' },
  { rule: "C02", match: false, text: "pinned at v1.609.0" },
  { rule: "C02", match: false, text: "1,609 clients onboarded" },
  { rule: "C02", match: false, text: "height: 609px;" },
  { rule: "C02", match: false, text: "port 54609 is already taken" },
  { rule: "C02", match: false, text: "coverage sits at 609%" },
  { rule: "C02", match: false, text: "Total 609.50 due" },
  { rule: "C02", match: false, text: "609,000 records imported" },

  { rule: "C03", match: true, text: "we do not offer pay for delete" },
  { rule: "C03", match: true, text: "const payForDelete = false;" },
  { rule: "C03", match: true, text: "pay-to-delete asks are refused" },
  { rule: "C03", match: true, text: "flag: pay_for_delete" },
  {
    rule: "C03",
    match: false,
    text: "/dispute|609|pay.?(for|to).?delete|late.?payment.?off/i;",
  },
  { rule: "C03", match: false, text: "pay the balance, then delete the draft" },

  { rule: "C04", match: true, text: "const REMOVAL_INTENT_PATTERN = /wipe/i;" },
  { rule: "C04", match: true, text: "the removal request was logged" },
  { rule: "C04", match: true, text: "Removals are not what this product does." },
  { rule: "C04", match: false, text: "removeApplicationOutcome(applicationId);" },
  { rule: "C04", match: false, text: "window.removeEventListener('scroll', onScroll);" },
  { rule: "C04", match: false, text: "link.remove();" },
  { rule: "C04", match: false, text: "Renewal is removed from the demo context." },

  { rule: "C05", match: true, text: "positioned as a credit repair service" },
  { rule: "C05", match: true, text: "const creditRepair = false;" },
  { rule: "C05", match: true, text: "credit-repair framing is out of bounds" },
  { rule: "C05", match: false, text: "the credit report refreshed overnight" },
  { rule: "C05", match: false, text: "repair the broken migration" },

  { rule: "C06", match: true, text: "send a goodwill letter to the furnisher" },
  { rule: "C06", match: true, text: "good will letters are off the table" },
  { rule: "C06", match: true, text: "goodwill adjustment requests" },
  { rule: "C06", match: false, text: "goodwill on the balance sheet is amortized" },
  { rule: "C06", match: false, text: "the letter of intent was signed" },

  { rule: "C07", match: true, text: "+40 pts in the first quarter" },
  { rule: "C07", match: true, text: "expect + 25 points" },
  { rule: "C07", match: false, text: "min-h-[calc(3.75rem+env(safe-area-inset-bottom))]" },
  { rule: "C07", match: false, text: "li:nth-last-child(-n+2)" },
  { rule: "C07", match: false, text: 'change: "+9"' },
  { rule: "C07", match: false, text: 'className="bottom-[calc(100%+0.5rem)]"' },

  { rule: "C08", match: true, text: "we can raise your score by 40 points" },
  { rule: "C08", match: true, text: "boost the score by 30 within a quarter" },
  { rule: "C08", match: false, text: "score: 682," },
  { rule: "C08", match: false, text: 'score: "0.91",' },
  { rule: "C08", match: false, text: "30-day blended score for the cohort" },
  { rule: "C08", match: false, text: 'id: "score-tu-jul-14",' },

  { rule: "C09", match: true, text: "gain 25 points on your score" },
  { rule: "C09", match: true, text: "score up 25 pts after the plan" },
  { rule: "C09", match: false, text: "Data points collected this month" },
  { rule: "C09", match: false, text: "detail.dataPoints.map((entry) => entry.id)" },
  { rule: "C09", match: false, text: "score: 691," },
  { rule: "C09", match: false, text: "the entry point for the flow" },

  { rule: "C10", match: true, text: "approval odds shown per lender" },
  { rule: "C10", match: true, text: "the likelihood of being approved this month" },
  { rule: "C10", match: true, text: "chances of qualifying for the tier" },
  { rule: "C10", match: false, text: "const approvalRate = approved / total;" },
  { rule: "C10", match: false, text: "Historical approval rate across the book" },
  {
    rule: "C10",
    match: false,
    text: 'if (text.includes("guarantee") || text.includes("odds") || text.includes("will i")) {',
  },
  { rule: "C10", match: false, text: "Approval · 30 days" },

  { rule: "C11", match: true, text: "approval odds 82% for this lender" },
  { rule: "C11", match: true, text: "82% likelihood on the next application" },
  { rule: "C11", match: false, text: "Compliance 98%" },
  { rule: "C11", match: false, text: "Utilization 29% across revolving lines" },
  { rule: "C11", match: false, text: "conversion 12% month over month" },

  { rule: "C12", match: true, text: "Sign the Credit Services Agreement." },
  { rule: "C12", match: false, text: "Review the enrollment agreement." },

  { rule: "C13", match: true, text: "A 40-point score increase is expected." },
  { rule: "C13", match: true, text: "A gain of 25 points is expected." },
  { rule: "C13", match: false, text: "There are 40 data points in the trend." },
  { rule: "C13", match: false, text: "Complete the 40-point checklist." },

  { rule: "C14", match: true, text: "You are 82% likely to be approved." },
  { rule: "C14", match: true, text: "Approval likelihood: 82%." },
  { rule: "C14", match: false, text: "Compliance measured 82%." },
  { rule: "C14", match: false, text: "82% of applications were approved historically." },

  ...NORMALIZED_ADVERSARIAL_LANGUAGE.slice(0, 6).map((text, index) => ({
    rule: index < 2 ? "C15" : index === 2 ? "C16" : "C17",
    match: true,
    text,
  })),
  ...ROUND_3_ADVERSARIAL_CASES.map(({ expectedCode, text }) => ({
    rule: expectedCode.replace("LANGUAGE_", ""), match: true, text,
  })),
  { rule: "C15", match: false, text: "Review the enrollment agreement." },
  { rule: "C16", match: false, text: "There are forty data points in the trend." },
  { rule: "C17", match: false, text: "82 percent of applications were approved historically." },
  { rule: "C18", match: false, text: "Seven in ten historical applications were approved." },
  { rule: "C19", match: false, text: "The service does not guarantee a specific processing date." },
  // R4D-01's compositional detectors. Positives come from the externally owned corpus; the
  // negatives are the shapes that make the rules survive the tree they run over.
  ...ROUND_4_ADVERSARIAL_CASES.map(({ expectedCode, text }) => ({
    rule: expectedCode.replace("LANGUAGE_", ""), match: true, text,
  })),
  { rule: "C20", match: false, text: "Your funding plan is 40 percent complete." },
  { rule: "C21", match: false, text: "There are forty data points in the trend." },
  { rule: "C22", match: false, text: "Sign the Funding Readiness Service Agreement." },
  { rule: "C23", match: false, text: "Lenders are more likely to approve a complete file." },
  { rule: "C24", match: false, text: "You will receive an email when the analysis completes." },
  // R5D-04 / R5D-05. The round-4 rows above are one form per rule, which is exactly how two P0
  // bypasses survived a green battery. The round-5 corpus is the cross-product instead, and it
  // carries the positives for C25 and C26 as well as the widened forms of C20, C21, C23 and C24.
  ...ROUND_5_ADVERSARIAL_CASES.map(({ expectedCode, text }) => ({
    rule: expectedCode.replace("LANGUAGE_", ""), match: true, text,
  })),
  // R5D-05 third pass. C20's decision vocabulary and its percentage-unit vocabulary as two axes,
  // composed here rather than transcribed, so a unit or a verb added to either axis extends this
  // battery on its own instead of waiting for someone to remember to write the sentences out.
  ...PERCENT_MATRIX_CASES.map(({ expectedCode, text }) => ({
    rule: expectedCode.replace("LANGUAGE_", ""), match: true, text,
  })),
  // The negative half of the same axes: ordinary progress copy in every unit and every casing.
  ...PERCENT_MATRIX_CLEAN_CASES.map(({ text }) => ({ rule: "C20", match: false, text })),
  // C27's family, composed over outcome x certainty x unit x casing x spacing in both orderings,
  // with the same subjects in ordinary progress copy as its negative half.
  ...OUTCOME_CERTAINTY_CASES.map(({ expectedCode, text }) => ({
    rule: expectedCode.replace("LANGUAGE_", ""), match: true, text,
  })),
  ...OUTCOME_CERTAINTY_CLEAN_CASES.map(({ text }) => ({ rule: "C27", match: false, text })),
  // The false-positive shapes the two new rules reach for first. An eligibility band is ordinary
  // and legitimate copy; a three-digit number with a unit noun after it is a viewport or a count.
  { rule: "C25", match: false, text: "Scores from 620 to 700 sit in the middle tier." },
  { rule: "C25", match: false, text: "Move the list from 400 to 500 rows." },
  { rule: "C26", match: false, text: "Resize the panel to a 720 pixel width." },
  { rule: "C26", match: false, text: "We will take you to a 768 pixel breakpoint." },
];

// Extensions rotate so the poisoned-tree proof also exercises the filter.
const POISON_EXTENSIONS = [".md", ".ts", ".sql", ".txt", ".tsx", ".css"];

// Two synthetic lines used to prove the allow-list semantics. The first trips
// exactly one rule, the second trips exactly two, which is what lets the count
// assertions be checked without depending on the real tree.
const SYNTHETIC_SINGLE_RULE_LINE = "REMOVAL_INTENT_PATTERN guards the demo";
const SYNTHETIC_TWO_RULE_LINE = "the dispute path cites 609 explicitly";

// Flat by design: one level of files means cleanup needs no recursive delete,
// and the `finally` runs it on the pass path and the failure path alike.
function withTemporaryTree(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "compliance-gate-"));
  try {
    return callback(directory);
  } finally {
    for (const entry of fs.readdirSync(directory)) {
      fs.unlinkSync(path.join(directory, entry));
    }
    fs.rmdirSync(directory);
  }
}

function selfTest() {
  const failures = [];
  let total = 0;
  const check = (description, condition) => {
    total += 1;
    if (!condition) failures.push(description);
  };

  // 1. The rule battery: every rule against its positives and against the
  //    false-positive shapes measured in this tree.
  const ruleById = new Map(RULES.map((rule) => [rule.id, rule]));
  for (const testCase of RULE_CASES) {
    const rule = ruleById.get(testCase.rule);
    if (!rule) {
      check(`battery names an unknown rule id: ${testCase.rule}`, false);
      continue;
    }
    check(
      `${testCase.rule} should ${testCase.match ? "fire on" : "stay silent on"}: ${testCase.text}`,
      complianceLanguageCodes(testCase.text).includes(rule.code) === testCase.match,
    );
  }
  for (const rule of RULES) {
    const cases = RULE_CASES.filter((testCase) => testCase.rule === rule.id);
    check(
      `${rule.id} has a positive fixture`,
      cases.some((testCase) => testCase.match),
    );
    check(
      `${rule.id} has a false-positive fixture`,
      cases.some((testCase) => !testCase.match),
    );
  }

  // R4D-01. The whole battery against clean copy, not one rule at a time: a compositional detector
  // fails in the direction that breaks the build, so the negative corpus has to prove that no rule
  // fires rather than that the one rule under test stays quiet.
  for (const text of ROUND_4_CLEAN_CASES) {
    const codes = complianceLanguageCodes(text);
    check(
      `clean copy trips no rule: ${text} (${codes.join(", ")})`,
      codes.length === 0,
    );
  }

  // 2. The red path, end to end. Asserting the regexes in isolation does not
  //    prove the behaviour UNBLK-07 names, so scan a real poisoned directory
  //    through the same function CI calls and check the exit code and pointers.
  withTemporaryTree((directory) => {
    const roots = [{ kind: "directory", rel: ".", required: true }];
    const expected = [];

    RULES.forEach((rule, index) => {
      const positive = RULE_CASES.find(
        (testCase) => testCase.rule === rule.id && testCase.match,
      );
      const name = `poison-${rule.id.toLowerCase()}${POISON_EXTENSIONS[index % POISON_EXTENSIONS.length]}`;
      fs.writeFileSync(
        path.join(directory, name),
        `a clean heading line\n${positive.text}\na clean trailing line\n`,
        "utf8",
      );
      expected.push({ file: name, line: 2, ruleId: rule.id, text: positive.text });
    });

    // A non-text extension in the same directory must be skipped entirely.
    fs.writeFileSync(
      path.join(directory, "poison-ignored.png"),
      `${SYNTHETIC_TWO_RULE_LINE}\n`,
      "utf8",
    );

    const gate = runGate(roots, [], directory);
    check("a poisoned tree exits 1", gate.exitCode === 1);
    check("a poisoned tree reports its scanned-file count", gate.out.some((line) => line.startsWith("scanned ")));
    check(
      "a non-text extension is never scanned",
      !gate.scan.findings.some((finding) => finding.file.endsWith(".png")),
    );

    for (const want of expected) {
      const hit = gate.scan.findings.find(
        (finding) =>
          finding.file === want.file &&
          finding.line === want.line &&
          finding.ruleId === want.ruleId,
      );
      check(`${want.ruleId} is reported at ${want.file}:${want.line}`, Boolean(hit));
      if (!hit) continue;
      check(
        `${want.ruleId} carries a file:line pointer and the offending line`,
        formatFinding(hit) ===
          `${want.file}:${want.line} [${want.ruleId} ${hit.label}] ${want.text}`,
      );
      check(
        `${want.ruleId} appears in the failure output`,
        gate.err.includes(formatFinding(hit)),
      );
    }
  });

  // 3. Allow-list semantics, driven from synthetic entries over a synthetic
  //    file so that nothing here depends on — or mutates — the real ALLOWLIST.
  withTemporaryTree((directory) => {
    const name = "allowlist-subject.md";
    fs.writeFileSync(
      path.join(directory, name),
      `${SYNTHETIC_SINGLE_RULE_LINE}\na clean line\n${SYNTHETIC_SINGLE_RULE_LINE}\n${SYNTHETIC_TWO_RULE_LINE}\n`,
      "utf8",
    );
    const roots = [{ kind: "directory", rel: ".", required: true }];
    const erasureEntry = {
      file: name,
      line: /REMOVAL_INTENT_PATTERN/,
      rules: ["C04"],
      expect: 2,
      why: "synthetic fixture entry",
    };
    const pairEntry = {
      file: name,
      line: /cites 609 explicitly/,
      rules: ["C01", "C02"],
      expect: 2,
      why: "synthetic fixture entry",
    };

    const correct = runGate(roots, [erasureEntry, pairEntry], directory);
    check("a correct allow-list suppresses its declared hits", correct.exitCode === 0);
    check(
      "a green run prints the suppression summary",
      correct.out.some((line) =>
        line.startsWith("2 allow-list entries suppressed 4 hit(s) in 1 file(s)"),
      ),
    );

    const tooLow = runGate(
      roots,
      [{ ...erasureEntry, expect: 1 }, pairEntry],
      directory,
    );
    check("an entry that under-declares its hits fails", tooLow.exitCode === 1);
    check(
      "the under-declared entry is named in the failure",
      tooLow.err.some((line) => line.includes("declares 1 hit(s) but suppressed 2")),
    );

    const tooHigh = runGate(
      roots,
      [{ ...erasureEntry, expect: 3 }, pairEntry],
      directory,
    );
    check("a stale entry that over-declares its hits fails", tooHigh.exitCode === 1);
    check(
      "the stale entry is named in the failure",
      tooHigh.err.some((line) => line.includes("declares 3 hit(s) but suppressed 2")),
    );

    const noReason = runGate(
      roots,
      [{ ...erasureEntry, why: "   " }, pairEntry],
      directory,
    );
    check("an entry with no written reason fails", noReason.exitCode === 1);
    check(
      "the reasonless entry is named in the failure",
      noReason.err.some((line) => line.includes("has no why")),
    );
    check("a malformed allow-list scans nothing", noReason.scan === null);

    const badPath = runGate(
      roots,
      [erasureEntry, { ...pairEntry, file: "not-on-disk.md" }],
      directory,
    );
    check("an entry pointing at a missing file fails", badPath.exitCode === 1);
    check(
      "the missing-path entry is named in the failure",
      badPath.err.some((line) => line.includes("not on disk")),
    );

    const unknownRule = runGate(
      roots,
      [{ ...erasureEntry, rules: ["C99"] }, pairEntry],
      directory,
    );
    check("an entry naming an unknown rule id fails", unknownRule.exitCode === 1);

    // Rule scoping: suppress C01 on the two-rule line and C02 must still fire.
    const scoped = runGate(
      roots,
      [erasureEntry, { ...pairEntry, rules: ["C01"], expect: 1 }],
      directory,
    );
    check("suppression does not spill onto rules an entry did not name", scoped.exitCode === 1);
    check(
      "the unnamed rule still reports its own file:line",
      scoped.err.some((line) => line.startsWith(`${name}:4 [C02 `)),
    );
  });

  // 4. A misconfigured root must never read as a clean run.
  const realScan = runScan(SCAN_ROOTS);
  check("the required scan root resolves", realScan.missingRoots.length === 0);
  check(
    `the real scan reads at least 40 files (read ${realScan.fileCount})`,
    realScan.fileCount >= 40,
  );
  const realGate = runGate(SCAN_ROOTS, ALLOWLIST);
  check("the real allow-list and fixture inventory are exact", realGate.exitCode === 0);
  check(
    "the real suppression summary includes the contained fixture",
    realGate.out.some((line) =>
      // 18 before round 5; the widened C21 reaches a second rule on one already-declared line of
      // the contained fixture, which the entry's expectByRule now names. 19 → 18 on 2026-08-22,
      // when the admin chat playground's scripted replies went and took the sixth entry's single
      // suppressed line with them. 18 → 13 and five entries → two later the same day, when the
      // scripted workspace assistant was deleted: it had no caller left, and its three entries
      // covered five lines of its own guardrail source.
      line.startsWith("2 allow-list entries suppressed 13 hit(s) in 2 file(s)"),
    ),
  );

  const missingRoot = runScan(
    [{ kind: "directory", rel: "web/src", required: true }],
    os.tmpdir(),
  );
  check(
    "an absent required root is reported rather than silently skipped",
    missingRoot.missingRoots.length === 1,
  );

  console.log(`self-test: ${total - failures.length}/${total} case(s) passed`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    console.error(`${failures.length} self-test case(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log("self-test: the rule battery, the red path and the allow-list all hold");
}

function main() {
  if (process.argv.slice(2).includes("--self-test")) {
    selfTest();
    return;
  }

  const gate = runGate(SCAN_ROOTS, ALLOWLIST);
  for (const line of gate.out) console.log(line);
  for (const line of gate.err) console.error(line);
  if (gate.exitCode !== 0) process.exitCode = gate.exitCode;
}

main();
