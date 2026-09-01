import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const operatorPath = new URL("./operator.tsx", import.meta.url);

async function operatorSource() {
  return readFile(operatorPath, "utf8");
}

function section(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing operator section ${start}`);
  return source.slice(from, to);
}

/** The tracker's own view modes, read off the Segmented it renders rather than
 * listed here — a fifth mode added without a click-through fails this. */
function trackerViewModes(durableTracker: string) {
  const options = section(durableTracker, "<Segmented", "/>");
  const modes = [...options.matchAll(/value: "([a-z]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(modes.length >= 4, "could not read the tracker view modes");
  return modes;
}

function modeBlock(
  durableTracker: string,
  mode: string,
  modes: readonly string[],
) {
  const marker = (value: string) => `clientMode === "${value}" ? (`;
  const start = durableTracker.indexOf(marker(mode));
  assert.ok(start >= 0, `the ${mode} view is not rendered`);
  const laterStarts = modes
    .map((other) => durableTracker.indexOf(marker(other)))
    .filter((index) => index > start);
  return durableTracker.slice(
    start,
    laterStarts.length > 0 ? Math.min(...laterStarts) : durableTracker.length,
  );
}

describe("operator tracker click-through", () => {
  it("opens the client peek from every durable view mode", async () => {
    const source = await operatorSource();
    const durableTracker = section(
      source,
      "function renderPersistedClientsTracker()",
      "function renderClientsTracker()",
    );
    const modes = trackerViewModes(durableTracker);
    for (const mode of modes) {
      const block = modeBlock(durableTracker, mode, modes);
      assert.match(
        block,
        /openTrackerClient\(client\.id\)/,
        `the ${mode} view has no way to open a client`,
      );
      assert.match(
        block,
        /type="button"/,
        `the ${mode} view's affordance is not a button`,
      );
      assert.match(
        block,
        /focus-visible:ring-2/,
        `the ${mode} view's affordance has no focus ring`,
      );
    }
  });

  it("never routes a durable row through the fixture drawer", async () => {
    const source = await operatorSource();
    const durableTracker = section(
      source,
      "function renderPersistedClientsTracker()",
      "function renderClientsTracker()",
    );
    // `openClient` resolves its id against DEMO_CLIENTS, so a tracker UUID
    // opens nothing. This is the defect, asserted from the other side.
    assert.doesNotMatch(durableTracker, /openClient\(/);
  });

  it("resolves the peek against the tracker read and shows every specified tab", async () => {
    const source = await operatorSource();
    const peek = section(
      source,
      "{/* Durable tracker client peek",
      "{/* End durable tracker client peek. */}",
    );
    assert.match(
      source,
      /const selectedTrackerClient =\s*\n?\s*trackerClients\.clients\.find\(/,
    );
    assert.match(peek, /open=\{Boolean\(selectedTrackerClient\)\}/);

    // The tab set is the one the surface's own DrawerTab union declares, so a
    // tab added to the fixture drawer and forgotten here fails.
    const union = section(source, "type DrawerTab =", ";");
    const tabs = [...union.matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
    assert.ok(tabs.length >= 5, "the durable client peek lost one of its core tabs");
    for (const tab of tabs) {
      assert.match(
        peek,
        new RegExp(`trackerDrawerTab === "${tab}"`),
        `the durable peek has no ${tab} tab`,
      );
    }
  });

  it("keeps fixture values out of the durable peek", async () => {
    const source = await operatorSource();
    const peek = section(
      source,
      "{/* Durable tracker client peek",
      "{/* End durable tracker client peek. */}",
    );
    for (const fixture of [
      /selectedClient\./,
      /DEMO_CLIENTS/,
      /getClientFundedAmount/,
      /getApplicationsForClient/,
      /feeRows/,
    ]) {
      assert.doesNotMatch(peek, fixture);
    }
  });
});

describe("operator sidebar badges", () => {
  it("carries no hardcoded counter in the nav definition", async () => {
    const source = await operatorSource();
    const nav = section(source, "const NAV_SECTIONS", "const BANK_TREND_PRESENTATION");
    assert.doesNotMatch(nav, /badge:\s*\d/);
    // The Inbox counter had no durable source at all, so it is gone rather
    // than guessed. `SupportInboxThread` has no unread field to read.
    assert.doesNotMatch(nav, /badge/);
  });

  it("counts clients from the same read the Clients view renders", async () => {
    const source = await operatorSource();
    const derivation = section(source, "const navSections = useMemo", "return NAV_SECTIONS.map");
    assert.match(derivation, /clientsNavBadge\(\{/);
    assert.match(derivation, /fixtureCount: clients\.length/);
    assert.match(derivation, /lastDurableCount: lastDurableClientCount/);
    assert.match(derivation, /trackerEnabled,/);
    // The count that reaches the badge is the whole book, not whatever the
    // Clients view was last filtered to.
    assert.match(
      source,
      /trackerReadIsWholeBook\s*\n?\s*\?\s*durableClientCount\(trackerClients\)/,
    );
  });
});
