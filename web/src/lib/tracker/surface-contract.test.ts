import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const operator = readFileSync(new URL("../../components/surfaces/operator.tsx", import.meta.url), "utf8");

describe("operator tracker health surface", () => {
  it("guards the health label with the server capability", () => {
    const guard = operator.indexOf("trackerClients.consoleOpsEnabled");
    const label = operator.indexOf("Health: ${client.health}", guard);
    assert.ok(guard >= 0 && label > guard);
  });

  it("filters stage clients without sorting the server order", () => {
    const start = operator.indexOf("const stageClients = filteredTrackerClients.filter");
    const end = operator.indexOf("return (", start);
    assert.ok(start >= 0 && end > start);
    assert.doesNotMatch(operator.slice(start, end), /\.sort\(/);
  });

  it("renders the closed server health value and contains no client classifier", () => {
    assert.match(operator, /client\.health === "red"/);
    assert.match(operator, /client\.health === "amber"/);
    assert.doesNotMatch(operator, /FEATURE_CONSOLE_OPS|lastActivityAt.*14|stageEnteredAt.*45/);
  });
});
