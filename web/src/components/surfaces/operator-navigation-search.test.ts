import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./operator.tsx", import.meta.url), "utf8");
const searchWiring = source.slice(
  source.indexOf("const navSections = useMemo"),
  source.indexOf("useEffect(() =>", source.indexOf("const commandActions")),
);

describe("operator navigation search", () => {
  it("derives searchable pages from the exact nav sections passed to the shell", () => {
    assert.match(
      searchWiring,
      /const commandPages: CommandPalettePage\[\] = navSections\.flatMap/,
    );
    assert.match(searchWiring, /section\.items\.map/);
    assert.match(source, /sections=\{navSections\}/);
    assert.match(source, /pages=\{commandPages\}/);
    assert.equal(
      (source.match(/const commandPages: CommandPalettePage\[\]/g) ?? []).length,
      1,
    );
  });

  it("preserves the three operator quick actions through caller-owned callbacks", () => {
    assert.match(searchWiring, /label: "Create client"[\s\S]*?setView\("clients"\)[\s\S]*?setLeadCaptureOpen\(true\)/);
    assert.match(searchWiring, /label: "Ask AI assistant"[\s\S]*?openGlobalAssistant\("operator"\)/);
    assert.match(searchWiring, /label: "Schedule meeting"[\s\S]*?setView\("tasks"\)[\s\S]*?Meeting draft prepared\. No calendar event was created\./);
    assert.match(source, /<CommandPalette[\s\S]*?actions=\{commandActions\}/);
  });

  it("reads one all-status tenant-scoped client catalog without another realtime channel", () => {
    assert.match(source, /const \[searchableTrackerClients, setSearchableTrackerClients\] = useState/);
    assert.match(source, /trackerClients\.enabled !== true[\s\S]*?readTrackerClientSnapshot\(\{ scope: "all", status: "all" \}\)/);
    assert.equal((source.match(/useTrackerClients\(\{/g) ?? []).length, 1);
    assert.match(searchWiring, /const commandRecords: CommandPaletteRecord\[\] = durableWorkspace/);
    assert.match(searchWiring, /searchableTrackerClients\.map/);
    assert.match(searchWiring, /id: `client-\$\{index \+ 1\}`/);
    assert.doesNotMatch(searchWiring, /id: client\.id/);
  });

  it("opens an authorized client on the existing tracker surface", () => {
    assert.match(searchWiring, /setView\("clients"\)[\s\S]*?setClientsTab\("tracker"\)/);
    assert.match(searchWiring, /setTrackerStatusFilter\(client\.status\)/);
    assert.match(searchWiring, /openTrackerClient\(client\.id\)/);
    assert.match(source, /<CommandPalette[\s\S]*?records=\{commandRecords\}/);
    assert.match(source, /Search pages, records, and actions/);
  });
});
