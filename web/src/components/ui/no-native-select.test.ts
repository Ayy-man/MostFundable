import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
// The repository path contains a space, which `URL.pathname` percent-encodes;
// `fileURLToPath` is the only decode that survives it.
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/testing/strip-comments";

/**
 * Every dropdown in the product renders our themed combobox. Zero native ones.
 *
 * A native `<select>` hands its open list to the operating system, so the panel
 * that appears obeys none of `DESIGN.md` — on macOS it is a grey sheet with a
 * purple selection highlight, which reads as a different product the moment a
 * user opens it. It also cannot filter, which the catalog-length pickers need.
 * Twenty-six of them had leaked across the surfaces before `BrandSelect`
 * replaced them.
 *
 * This guard reads every component and route source and fails if a JSX
 * `<select>` or `<option>` element comes back anywhere. It scans the tree by
 * walking it, rather than checking a transcribed list of the files that had one
 * — a list would go stale the moment someone adds a new view, which is exactly
 * the regression shape it exists to catch.
 *
 * Comments are stripped before matching so the prose in `brand-select.tsx`,
 * which has to name the element it replaces, does not trip its own guard. If a
 * native select ever genuinely has to stay, add it to `ALLOWED` with the reason
 * — an empty allow-list is the honest state today.
 */

const ROOTS = ["src/components", "src/app"];

/**
 * Files permitted to render a native select, each with the reason it cannot use
 * `BrandSelect`. Empty on purpose: nothing in the tree needs one. A new entry is
 * a deliberate, reviewed exception, never a convenient way to make this pass.
 */
const ALLOWED: ReadonlyArray<{ file: string; reason: string }> = [];

const allowedFiles = new Set(ALLOWED.map((entry) => entry.file));

/**
 * Strips line and block comments so a docblock naming `<select>` is not read as
 * a rendered one. String contents are left alone: a native select smuggled
 * through a string literal is still a native select and should fail here.
 */
function collectSources(): Array<{ file: string; source: string }> {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const found: Array<{ file: string; source: string }> = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".tsx")) continue;
      found.push({
        file: path.relative(repoRoot, full),
        source: fs.readFileSync(full, "utf8"),
      });
    }
  }

  for (const root of ROOTS) walk(path.join(repoRoot, root));
  return found;
}

const sources = collectSources();

describe("no native select survives anywhere in the rendered tree", () => {
  it("walks a real tree rather than trusting a transcribed file list", () => {
    // Derived from the walk, so a deleted surface fails loudly instead of
    // silently shrinking the guard's coverage to nothing.
    assert.ok(
      sources.length > 40,
      `the component walk found only ${sources.length} files — the guard is no longer covering the tree`,
    );
    for (const surface of [
      "src/components/surfaces/consumer.tsx",
      "src/components/surfaces/operator.tsx",
      "src/components/surfaces/admin.tsx",
      "src/components/surfaces/affiliate.tsx",
    ]) {
      assert.ok(
        sources.some((entry) => entry.file === surface),
        `${surface} is missing from the walk — every deployed surface must be covered`,
      );
    }
  });

  it("renders no <select> element outside the named exception list", () => {
    const offenders = sources
      .filter((entry) => !allowedFiles.has(entry.file))
      .filter((entry) => /<select[\s/>]/.test(stripComments(entry.source)))
      .map((entry) => entry.file);

    assert.deepEqual(
      offenders,
      [],
      `native <select> is back in ${offenders.join(", ")} — use BrandSelect from @/components/ui/brand-select, or add the file to ALLOWED with a reason`,
    );
  });

  it("renders no <option> element outside the named exception list", () => {
    // `<option>` only ever appears inside a `<select>`, so catching it too
    // closes the case where a select is assembled from a variable-held element.
    const offenders = sources
      .filter((entry) => !allowedFiles.has(entry.file))
      .filter((entry) => /<option[\s/>]/.test(stripComments(entry.source)))
      .map((entry) => entry.file);

    assert.deepEqual(
      offenders,
      [],
      `native <option> is back in ${offenders.join(", ")} — its parent select must become a BrandSelect`,
    );
  });

  it("every exception names a file that exists and a reason", () => {
    for (const entry of ALLOWED) {
      assert.ok(
        sources.some((source) => source.file === entry.file),
        `ALLOWED names ${entry.file}, which the walk did not find — remove the stale exception`,
      );
      assert.ok(
        entry.reason.trim().length > 0,
        `the exception for ${entry.file} carries no reason`,
      );
    }
  });

  it("the shared combobox is the thing the surfaces actually import", () => {
    const importers = sources.filter((entry) =>
      entry.source.includes('from "@/components/ui/brand-select"'),
    );
    assert.ok(
      importers.length >= 2,
      "the surfaces stopped importing BrandSelect — a per-page one-off has replaced the shared control",
    );
  });
});
