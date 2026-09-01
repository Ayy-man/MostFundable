import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./consumer.tsx", import.meta.url), "utf8");
const searchWiring = source.slice(
  source.indexOf("const visiblePlatformNavItems"),
  source.indexOf("return (", source.indexOf("const consumerCommandPages")),
);

describe("consumer navigation search", () => {
  it("builds results from the same visible navigation arrays rendered by the shell", () => {
    assert.match(
      searchWiring,
      /const visiblePlatformNavItems = trainingsVisible[\s\S]*?platformNavItems\.filter\(\(item\) => item\.id !== "learning"\)/,
    );
    assert.match(
      searchWiring,
      /const consumerPlatformItems: ConsumerNavItem\[\] = enrollLive[\s\S]*?visiblePlatformNavItems/,
    );
    assert.match(
      searchWiring,
      /const consumerCommandPages: CommandPalettePage\[\] = \[[\s\S]*?\.\.\.workspaceNavItems\.map[\s\S]*?\.\.\.consumerPlatformItems\.map/,
    );
  });

  it("adds only the signed-in consumer's application and notification reads as records", () => {
    assert.match(searchWiring, /const consumerCommandRecords: CommandPaletteRecord\[\] = \[/);
    assert.match(searchWiring, /consumerApplicationsState\.status === "ready"[\s\S]*?consumerApplicationsState\.applications\.map/);
    assert.match(searchWiring, /durableWorkspace && ancillaryLive && !liveNotificationsError[\s\S]*?liveNotifications\.map/);
    assert.match(searchWiring, /id: `application-\$\{index \+ 1\}`/);
    assert.match(searchWiring, /id: `notification-\$\{index \+ 1\}`/);
    assert.doesNotMatch(searchWiring, /id: application\.id|id: notification\.id/);
    assert.doesNotMatch(searchWiring, /DEMO_CLIENTS|uploadedFiles|teamChat/);
  });

  it("routes record results to the existing consumer surfaces", () => {
    assert.match(searchWiring, /onSelect: \(\) => navigate\("matches"\)/);
    assert.match(searchWiring, /onSelect: \(\) => navigate\("notifications"\)/);
    assert.match(source, /<CommandPalette[\s\S]*?records=\{consumerCommandRecords\}[\s\S]*?onNavigate=\{\(pageId\) => navigate\(pageId as ViewId\)\}[\s\S]*?pages=\{consumerCommandPages\}/);
    assert.match(source, /Search pages and records/);
  });
});
