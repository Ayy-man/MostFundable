import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(
  new URL("./command-palette.tsx", import.meta.url),
  "utf8",
);

describe("role-neutral command palette", () => {
  it("accepts caller-defined actions and authorized records instead of owning role reads", () => {
    assert.match(source, /actions\?: CommandPaletteAction\[\]/);
    assert.match(source, /actions = \[\]/);
    assert.match(source, /records\?: CommandPaletteRecord\[\]/);
    assert.match(source, /records = \[\]/);
    assert.match(source, /onSelect: \(\) => void/);
    assert.doesNotMatch(
      source,
      /onCreateLead|onScheduleMeeting|onAskAssistant|onGatedAiAction/,
    );
    assert.doesNotMatch(source, /fetch\(|\/api\//);
    assert.doesNotMatch(source, /operator (?:page|workspace)/i);
  });

  it("gives page, action, and record results stable collision-free React keys without putting source ids in the DOM", () => {
    assert.match(source, /key: `action:\$\{action\.id\}`/);
    assert.match(source, /key: `page:\$\{page\.id\}`/);
    assert.match(source, /key: `record:\$\{record\.id\}`/);
    assert.match(source, /<div key=\{entry\.key\}>/);
    assert.match(source, /id=\{`\$\{listId\}-option-\$\{index\}`\}/);
    assert.match(source, /`\$\{listId\}-option-\$\{safeActiveIndex\}`/);
    assert.doesNotMatch(source, /id=\{`\$\{listId\}-\$\{entry\.key\}`\}/);
  });

  it("searches only the page, record, and action metadata supplied by the current surface", () => {
    assert.match(
      source,
      /\[\s*entry\.label,\s*entry\.description,\s*\.\.\.entry\.keywords,\s*\]/,
    );
    assert.match(source, /group: "Records" as const/);
    assert.match(source, /kind: "record" as const/);
    assert.match(source, /Search workspace pages, records, and actions/);
    assert.match(source, /Open a workspace page or authorized record/);
  });

  it("retains the global chord and listbox keyboard navigation", () => {
    assert.match(
      source,
      /event\.key\.toLowerCase\(\) === "k"[\s\S]*?event\.metaKey \|\| event\.ctrlKey[\s\S]*?!event\.altKey/,
    );
    assert.match(source, /window\.addEventListener\("keydown", openFromKeyboard\)/);
    assert.match(source, /event\.key === "ArrowDown"/);
    assert.match(source, /event\.key === "ArrowUp"/);
    assert.match(source, /event\.key === "Enter"/);
    assert.match(source, /role="combobox"/);
    assert.match(source, /role="listbox"/);
    assert.match(source, /role="option"/);
  });
});
