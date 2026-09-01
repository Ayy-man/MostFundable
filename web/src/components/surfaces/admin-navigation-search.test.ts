import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const SOURCE = readFileSync(new URL("./admin.tsx", import.meta.url), "utf8");

describe("admin navigation search", () => {
  it("derives its page catalog from the same navigation sections the shell renders", () => {
    assert.match(SOURCE, /const adminCommandPages: CommandPalettePage\[\] = ADMIN_SECTIONS\.flatMap/);
    assert.match(SOURCE, /sections=\{ADMIN_SECTIONS\}/);
    assert.match(SOURCE, /pages=\{adminCommandPages\}/);
    assert.match(SOURCE, /onNavigate=\{navigate\}/);
  });

  it("loads platform operator records only for a signed-in enabled admin surface", () => {
    const start = SOURCE.indexOf("export function AdminSurface");
    const end = SOURCE.indexOf("const monitoringSplitLabel", start);
    const wiring = SOURCE.slice(start, end);
    assert.match(wiring, /if \(!signedIn \|\| !adminEnabled\) return undefined/);
    assert.match(wiring, /loadAdminWorkspaceRoster\(\)/);
    assert.match(wiring, /signedIn && adminEnabled \? searchableWorkspaces : \[\]/);
    assert.match(wiring, /const adminCommandRecords: CommandPaletteRecord\[\]/);
  });

  it("uses safe palette keys and routes a workspace result to Operators", () => {
    assert.match(SOURCE, /id: `workspace-\$\{index \+ 1\}`/);
    assert.doesNotMatch(SOURCE, /id: workspace\.id/);
    assert.match(SOURCE, /onSelect: \(\) => navigate\("tenants"\)/);
    assert.match(SOURCE, /records=\{adminCommandRecords\}/);
    assert.match(SOURCE, /triggerLabel="Search pages and records"/);
  });
});
