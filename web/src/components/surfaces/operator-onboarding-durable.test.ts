import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./operator-onboarding.tsx", import.meta.url), "utf8");

describe("operator onboarding durability", () => {
  it("sends client invitations through the governed invite route", () => {
    assert.match(source, /fetch\("\/api\/invites"/);
    assert.match(source, /kind: "client"/);
    assert.match(source, /"Idempotency-Key": inviteIdempotencyKey/);
    assert.match(source, /client record will be created[\s\S]*secure invitation is accepted/);
  });

  it("uploads and publishes the workspace brand before claiming completion", () => {
    assert.match(source, /fetch\("\/api\/org\/settings"/);
    assert.match(source, /JSON\.stringify\(\{ name: nextBusinessName \}\)/);
    assert.match(source, /fetch\("\/api\/org\/brand"/);
    assert.match(source, /accentColor: normalizedColor,[\s\S]*portalName: nextPortalName,[\s\S]*primaryColor: normalizedColor/);
    assert.match(source, /form\.set\("logo", logoFile\)/);
    assert.match(source, /fetch\("\/api\/org\/brand\/publish"/);
    assert.ok(source.indexOf("await saveBrand()") < source.indexOf('setRoute("complete")'));
    assert.match(source, /Nothing is being claimed as complete/);
  });

  it("hydrates published identity and verifies each successful response body", () => {
    assert.match(source, /brandPortalName\(initialBrand\) \?\? initialBrandLabel/);
    assert.match(source, /safeLogoUrl\(initialBrand\?\.logoUrl\)/);
    assert.match(source, /const initialColor = brandColor\(initialBrand\)/);
    assert.match(source, /verifiedWorkspaceNameResponse\(settingsBody, nextBusinessName\)/);
    assert.match(source, /verifiedBrandResponse\(colorBody/);
    assert.match(source, /verifiedBrandResponse\(logoBody/);
    assert.match(source, /verifiedPublicationResponse\(publishBody\)/);
    assert.match(source, /verifiedInviteResponse\(responseBody\)/);
  });

  it("bounds workspace names and accepts only raster logo formats supported by storage", () => {
    assert.match(source, /const MAX_WORKSPACE_NAME_LENGTH = 120/);
    assert.match(source, /maxLength=\{MAX_WORKSPACE_NAME_LENGTH\}/);
    assert.match(source, /accept="image\/png,image\/jpeg,image\/webp"/);
    assert.match(source, /PNG, JPEG, and WebP files up to 2 MB/);
    assert.doesNotMatch(source, /image\/svg\+xml|JPEG, and SVG/);
  });

  it("contains none of the old preview-only disclosures", () => {
    assert.doesNotMatch(source, /Neither route stores anything yet/);
    assert.doesNotMatch(source, /This setup stores no files and sends no email/);
    assert.doesNotMatch(source, /No email was sent/);
    assert.doesNotMatch(source, /Finishing stores nothing/);
  });
});
