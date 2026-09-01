import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const surfaceSource = readFileSync(new URL("./affiliate.tsx", import.meta.url), "utf8");
const clientSource = readFileSync(
  new URL("../../app/(surfaces)/affiliate/surface-client.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../../app/(surfaces)/affiliate/page.tsx", import.meta.url),
  "utf8",
);
const liveSource = surfaceSource.slice(
  surfaceSource.indexOf("function LivePortalTable"),
  surfaceSource.indexOf("function FixtureAffiliateSurface"),
);

describe("affiliate live surface boundary", () => {
  it("keeps the existing fixture surface as the default branch", () => {
    assert.match(surfaceSource, /if \(live !== undefined\)/);
    assert.match(surfaceSource, /return <FixtureAffiliateSurface onOpenProfiles=\{onOpenProfiles\} \/>/);
    assert.match(surfaceSource, /function FixtureAffiliateSurface\(\{ onOpenProfiles \}: SurfaceProps\)/);
    assert.doesNotMatch(surfaceSource.slice(surfaceSource.indexOf("function FixtureAffiliateSurface")), /\/api\/affiliates\/me/);
  });

  it("fetches once only after the server-provided affiliate flag is true", () => {
    const guard = clientSource.indexOf("if (!affiliatesEnabled) return;");
    const fetchCall = clientSource.indexOf('fetch("/api/affiliates/me"');
    assert.ok(guard >= 0 && guard < fetchCall);
    assert.equal(clientSource.match(/fetch\("\/api\/affiliates\/me"/g)?.length, 1);
    assert.match(clientSource, /credentials: "same-origin"/);
    assert.match(clientSource, /cache: "no-store"/);
    // Re-pinned by the Tier-2 eviction lane. `undefined` still selects the illustrative portal,
    // but it may no longer be what a signed-in affiliate gets when the flag is off — that handed
    // them another affiliate's lead book and referral link (G-R5-OWN-03), so the durable route
    // now passes an explicit `disabled` state instead.
    assert.match(
      clientSource,
      /live=\{affiliatesEnabled \? affiliateLiveState : realAuth \? \{ status: "disabled" \} : undefined\}/,
    );
    assert.match(pageSource, /affiliatesEnabled=\{featureFlag\("FEATURE_AFFILIATES"\)\}/);
  });

  it("uses only the ratified live DTO fields", () => {
    const rowFields = [...liveSource.matchAll(/row\.([A-Za-z]+)/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(rowFields)].sort(), [
      "expectedCommissionCents",
      "fundedAmountCents",
      "needsAttention",
      "paymentStatus",
      "stage",
      "startedAt",
    ]);
    const kpiFields = [...liveSource.matchAll(/live\.data\.kpis\.([A-Za-z]+)/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(kpiFields)].sort(), [
      "active",
      "fundingRecordedCents",
      "inPipeline",
      "sentLeads",
    ]);
  });

  it("does not render fixture identity, attribution, or referral-link data live", () => {
    for (const forbidden of [
      "REFERRAL_LINK",
      "Rachel",
      "Summit Referral Network",
      "attribution",
      ".client",
      "clientId",
    ]) {
      assert.equal(liveSource.includes(forbidden), false, `live branch contains ${forbidden}`);
    }
  });
});
