import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const surfacesDir = new URL("./", import.meta.url);
const tablePrimitivePath = new URL("../ui/table.tsx", import.meta.url);

/**
 * G-HOST-15: a multi-column data table with no `min-w-[Npx]` floor does not
 * overflow into the scroll container the `Table` primitive already provides —
 * the browser compresses columns until the trailing one clips, which is what the
 * 2026-08-18 browser walk of the deployment saw on the operator client tracker
 * ("Team member" unreadable at 1054 px and narrower).
 *
 * The assertion is derived from the source at test time rather than transcribed
 * from that reproduction: it enumerates every `<Table` in every surface file and
 * requires each one to declare a floor. A table added later without one fails
 * here, and the primitive's own scroll container is asserted separately so the
 * floor keeps meaning what it means.
 */
async function surfaceFiles() {
  const entries = await readdir(surfacesDir);
  return entries
    .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
    .sort();
}

/**
 * Which surface files mention a `Table` element at all, decided by a different
 * and deliberately dumber rule than the matcher above. The two disagreeing is
 * the signal that the matcher has gone blind to a file.
 */
async function filesMentioningTable(): Promise<Set<string>> {
  const files = await surfaceFiles();
  const named = new Set<string>();
  for (const name of files) {
    const source = await readFile(new URL(name, surfacesDir), "utf8");
    if (/<Table[\s>]/.test(source)) named.add(name);
  }
  return named;
}

describe("surface data tables carry a horizontal overflow floor", () => {
  const filesWithTableTagPromise = filesMentioningTable();

  it("keeps the scroll container on the Table primitive", async () => {
    const source = await readFile(tablePrimitivePath, "utf8");
    assert.match(source, /overflow-x-auto/);
    assert.match(source, /role="region"/);
    assert.match(source, /tabIndex=\{0\}/);
  });

  it("declares a min-w floor on every surface table", async () => {
    const files = await surfaceFiles();
    const filesWithTableTag = await filesWithTableTagPromise;
    assert.ok(files.length >= 4, `expected the four surface files, saw ${files.join(", ")}`);

    const offenders: string[] = [];
    const perFile = new Map<string, number>();
    let tables = 0;

    for (const name of files) {
      const source = await readFile(new URL(name, surfacesDir), "utf8");

      // Match the whole opening tag, not a line. `<Table` may be followed by a
      // newline (props on the next line) or by `>` with no props at all, and a
      // minified surface can carry several on one line — a line-oriented scan
      // misses all three shapes, which is how affiliate.tsx's three tables sat
      // outside this assertion while it reported green.
      for (const match of source.matchAll(/<Table(?=[\s>])[^>]*>/g)) {
        tables += 1;
        perFile.set(name, (perFile.get(name) ?? 0) + 1);
        const line = source.slice(0, match.index).split("\n").length;
        if (!/min-w-\[\d+px\]/.test(match[0])) {
          offenders.push(`${name}:${line} ${match[0].replace(/\s+/g, " ").slice(0, 80)}`);
        }
      }
    }

    // The enumerator has to keep seeing every file that has tables at all. If a
    // surface's tables become invisible to the matcher again, this fails before
    // the floor assertion can report a hollow green.
    const blind = files.filter(
      (name) => !perFile.has(name) && filesWithTableTag.has(name),
    );
    assert.deepEqual(
      blind,
      [],
      `surface files containing a Table the matcher could not see: ${blind.join(", ")}`,
    );

    assert.ok(tables >= 9, `expected the surface tables to be found, saw ${tables}`);
    assert.deepEqual(
      offenders,
      [],
      `surface tables without a min-w floor:\n${offenders.join("\n")}`,
    );
  });
});
