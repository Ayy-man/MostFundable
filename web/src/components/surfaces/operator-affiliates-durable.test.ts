import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const surface = readFileSync(new URL("./operator.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../../lib/operator/affiliates.client.ts", import.meta.url), "utf8");

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing source section: ${start}`);
  return source.slice(from, to);
}

describe("durable operator affiliate management", () => {
  it("loads the tenant roster and selected statement without fixture fallback", () => {
    assert.match(surface, /loadOperatorAffiliates\(\)/);
    assert.match(surface, /const statementAffiliateId = selectedAffiliateId/);
    assert.match(surface, /loadOperatorAffiliateStatement\(statementAffiliateId\)/);
    assert.match(surface, /setAffiliateStatementForId\(statementAffiliateId\)/);
    assert.match(surface, /affiliateStatementForId !== selectedAffiliate\.affiliateId/);
    assert.match(surface, /affiliateRosterState === "failed"/);
    assert.match(surface, /The affiliate directory could not be loaded/);
    assert.match(surface, /affiliateRoster\.map/);
    assert.match(client, /credentials: "same-origin"/);
  });

  it("invites and governs affiliate lifecycle through durable routes", () => {
    const team = section(surface, "function renderTeam()", "function renderSettings()");
    assert.match(team, /createOperatorAffiliateInvite\(\{ email, fullName \}/);
    assert.match(team, /updateOperatorAffiliateLifecycle\(affiliate\.affiliateId, \{ defaultCommissionBps \}\)/);
    assert.match(team, /updateOperatorAffiliateLifecycle\(affiliate\.affiliateId, \{ active \}\)/);
    assert.match(team, /Confirm deactivation/);
    assert.match(team, /sessionIdentity\?\.orgRole === "owner"/);
    assert.match(team, /sessionIdentity\?\.orgRole === "admin"/);
  });

  it("shares only durable tracker clients and reads back every mutation", () => {
    const team = section(surface, "function renderTeam()", "function renderSettings()");
    assert.match(team, /trackerClients\.clients\.filter/);
    assert.match(team, /shareOperatorAffiliateClient\(selectedAffiliate\.affiliateId, client\.id\)/);
    assert.match(team, /updateOperatorAffiliateShare\(row\.affiliateId, row\.clientId/);
    assert.match(team, /unshareOperatorAffiliateClient\(row\.affiliateId, row\.clientId\)/);
    assert.match(team, /setAffiliateRosterReload\(\(current\) => current \+ 1\)/);
    assert.match(client, /\/shares\/\$\{encodeURIComponent\(clientId\)\}/);
  });
});
