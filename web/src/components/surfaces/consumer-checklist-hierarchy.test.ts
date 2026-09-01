import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * Round-5 standard: every number here is derived at test time from a source of
 * truth — Tailwind's own theme tokens for the type scale, the spacing unit and
 * the container breakpoints, and the components' own class strings for the
 * widths and the levels. Nothing is transcribed from the fix that produced it,
 * so widening a column, lowering the threshold or re-inverting a weight fails
 * the assertion rather than sliding past it.
 */

const consumerUrl = new URL("./consumer.tsx", import.meta.url);
const kitUrl = new URL("../consumer/consumer-kit.tsx", import.meta.url);
const shellUrl = new URL("../consumer/consumer-shell.tsx", import.meta.url);
const themeUrl = new URL(
  "../../../node_modules/tailwindcss/theme.css",
  import.meta.url,
);

async function tailwindTheme() {
  const css = await readFile(themeUrl, "utf8");
  const read = (name: string) => {
    const match = css.match(new RegExp(`--${name}:\\s*([0-9.]+)rem`));
    assert.ok(match, `tailwind theme is missing --${name}`);
    return Number(match![1]);
  };
  const weight = (name: string) => {
    const match = css.match(new RegExp(`--font-weight-${name}:\\s*(\\d+)`));
    assert.ok(match, `tailwind theme is missing --font-weight-${name}`);
    return Number(match![1]);
  };
  return { read, weight, spacing: read("spacing") };
}

function classesOf(source: string, pattern: RegExp) {
  const match = source.match(pattern);
  assert.ok(match, `no class string matched ${pattern}`);
  return match![1].split(/\s+/).filter(Boolean);
}

function sizeOf(
  classes: string[],
  theme: { read: (name: string) => number },
): number {
  const arbitrary = classes.find((c) => /^text-\[[0-9.]+rem\]$/.test(c));
  if (arbitrary) return Number(arbitrary.slice(6, -4));
  const named = classes.find((c) =>
    /^text-(xs|sm|base|lg|xl|2xl|3xl)$/.test(c),
  );
  assert.ok(named, `no font size in ${classes.join(" ")}`);
  return theme.read(`text-${named!.slice(5)}`);
}

function weightOf(
  classes: string[],
  theme: { weight: (name: string) => number },
): number {
  const named = classes.find((c) =>
    /^font-(normal|medium|semibold|bold)$/.test(c),
  );
  assert.ok(named, `no font weight in ${classes.join(" ")}`);
  return theme.weight(named!.slice(5));
}

/** Sum of `p-N`-style spacing utilities, resolved through --spacing. */
function spacingOf(source: string, pattern: RegExp, spacing: number): number {
  const match = source.match(pattern);
  assert.ok(match, `no spacing matched ${pattern}`);
  return Number(match![1]) * spacing;
}

describe("Cinderella checklist hierarchy", () => {
  it("steps down in size and never gains weight as it nests", async () => {
    const source = await readFile(consumerUrl, "utf8");
    const theme = await tailwindTheme();

    const trackHeading = classesOf(
      source,
      /<h3 className="([^"]+)">\{label\}<\/h3>/,
    );
    const factorLabel = classesOf(
      source,
      /<p className="([^"]+)">\{factor\.label\}<\/p>/,
    );
    const subtaskMatch = source.match(
      /<p className=\{nested \? "([^"]+)" : "([^"]+)"\}>\s*\{item\.title\}/,
    );
    assert.ok(subtaskMatch, "subtask title no longer distinguishes nesting");
    const subtaskTitle = subtaskMatch![1].split(/\s+/);

    const levels = [
      { classes: trackHeading, name: "track heading" },
      { classes: factorLabel, name: "factor label" },
      { classes: subtaskTitle, name: "subtask title" },
    ].map((level) => ({
      name: level.name,
      size: sizeOf(level.classes, theme),
      weight: weightOf(level.classes, theme),
    }));

    for (let i = 1; i < levels.length; i += 1) {
      const parent = levels[i - 1];
      const child = levels[i];
      assert.ok(
        child.size < parent.size,
        `${child.name} (${child.size}rem) must be smaller than ${parent.name} (${parent.size}rem)`,
      );
      assert.ok(
        child.weight <= parent.weight,
        `${child.name} (${child.weight}) must not outweigh ${parent.name} (${parent.weight})`,
      );
    }

    // The nested list is the only call site that claims the child level.
    assert.match(
      source,
      /<ActionList\s+actionIndexes=\{factor\.actionIndexes\}\s+nested\b/,
    );
  });

  it("separates the two tracks with space, not a full-height rule", async () => {
    const source = await readFile(consumerUrl, "utf8");
    const grid = classesOf(
      source,
      /<div className="(grid[^"]*lg:grid-cols-2[^"]*)">\s*<CinderellaChecklist/,
    );
    assert.ok(
      !grid.some((c) => /divide-x/.test(c)),
      `the track grid must not draw a vertical rule: ${grid.join(" ")}`,
    );
    assert.ok(
      grid.some((c) => /^(lg:)?gap(-x)?-\d+$/.test(c)),
      `the track grid must carry the separation in space: ${grid.join(" ")}`,
    );
  });

  it("switches the subtask row on its own width, not the viewport", async () => {
    const source = await readFile(consumerUrl, "utf8");
    const kit = await readFile(kitUrl, "utf8");
    const shell = await readFile(shellUrl, "utf8");
    const theme = await tailwindTheme();

    const row = classesOf(
      source,
      /className="(grid grid-cols-\[1\.6rem[^"]+)"\s*\n\s*key=\{item\.title\}/,
    );
    assert.ok(
      !row.some((c) => /^sm:/.test(c)),
      `the row must not use viewport breakpoints: ${row.join(" ")}`,
    );
    assert.match(source, /<div className="@container">/);

    const variant = row.find((c) => /^@[a-z0-9]+:grid-cols-/.test(c));
    assert.ok(variant, `the row must switch on a container query: ${row.join(" ")}`);
    const thresholdRem = theme.read(
      `container-${variant!.slice(1, variant!.indexOf(":"))}`,
    );

    // Widest the nested list can ever be: the 86rem content cap, less the shell
    // gutter, the WorkspaceSection body padding, the track gap split two ways,
    // and the subtask indent — all read from the components themselves.
    const capRem = Number(
      shell.match(/mx-auto w-full max-w-\[(\d+)rem\]/)![1],
    );
    const gutter = spacingOf(shell, /xl:px-(\d+)/, theme.spacing);
    const bodyPad = spacingOf(kit, /className="p-4 sm:p-(\d+)"/, theme.spacing);
    const trackGap = spacingOf(source, /lg:gap-x-(\d+)/, theme.spacing);
    const indent = source.match(/className="ml-(\d+) mt-3 border-l[^"]*pl-(\d+)"/);
    assert.ok(indent, "the subtask indent changed shape");
    const indentRem =
      (Number(indent![1]) + Number(indent![2])) * theme.spacing;

    const widest =
      (capRem - 2 * gutter - 2 * bodyPad - trackGap) / 2 - indentRem;

    assert.ok(
      thresholdRem > widest,
      `the three-column split (${thresholdRem}rem) would still fire inside a ${widest}rem column`,
    );
  });
});
