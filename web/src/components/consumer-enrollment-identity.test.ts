import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { DEMO_CLIENTS } from "@/lib/demo/feedback-fixtures";
import {
  CRS_SPEC_IDV_SUBMISSION_KIND,
  CRS_SPEC_TRANSIENT_IDENTITY_KEYS,
} from "@/lib/crs/spec-catalog";

/**
 * The enrollment wizard must carry no fixture persona of its own.
 *
 * The walk that motivated this signed in as the durable consumer and was shown
 * "Maya Okafor" prefilled on step 1, "Consumer · Okafor Design Co" in the header
 * chip, and — the serious one — `Type "Maya Okafor" to sign` on step 3, which is
 * an e-signature captured under a name that is not the signer's. All four
 * symptoms had one cause: `onboarding1.tsx` held a module-level persona and the
 * surface passed no identity, so the fixture won whenever a saved draft did not
 * exist. A wizard that owns no persona cannot lose that argument.
 *
 * Every literal below is derived from the fixture roster at test time rather
 * than transcribed here, so renaming a fixture client renames what this guard
 * looks for instead of quietly retiring it — round 5's standard, and the exact
 * rot that defeated ten of round 4's own fixes.
 *
 * Watched failing on the pre-fix tree: the wizard's `defaultDraft` carried
 * `name: "Maya Okafor"` / `email: "maya@okafor.co"` / the c5 phone, and the quiz
 * transcribed `"Okafor Design Co"` and a second persona business.
 */
const wizardSource = readFileSync(
  fileURLToPath(new URL("./onboarding1.tsx", import.meta.url)),
  "utf8",
);

/** Every string the fixture roster would leak if the wizard sourced identity from it. */
function fixturePersonaStrings(): string[] {
  const strings = DEMO_CLIENTS.flatMap((client) => [
    client.name,
    client.business,
    client.email,
    client.phone,
  ]);
  assert.ok(strings.length > 0, "the fixture roster is empty, so this guard proves nothing");
  return strings;
}

describe("consumer enrollment wizard identity", () => {
  it("renders no fixture persona at any step", () => {
    // One file is the whole wizard — profile, permissions, agreement, payment
    // and verify all render from `onboarding1.tsx` — so a source-wide sweep is
    // a sweep of every step.
    for (const persona of fixturePersonaStrings()) {
      assert.ok(
        !wizardSource.includes(persona),
        `the enrollment wizard transcribes the fixture string ${JSON.stringify(persona)}; identity must come from the session profile`,
      );
    }
  });

  it("takes the account holder from a required identity prop", () => {
    assert.match(
      wizardSource,
      /identity:\s*OnboardingIdentity/,
      "the wizard no longer accepts an identity prop, so nothing supplies the signed-in profile",
    );
    assert.match(
      wizardSource,
      /\{\s*\.\.\.ENROLLMENT_DRAFT_DEFAULTS,\s*\.\.\.identity\s*\}/,
      "the wizard's opening draft no longer overlays the supplied identity over its non-identity defaults",
    );
  });

  it("keeps no identity fields on the non-identity draft defaults", () => {
    const start = wizardSource.indexOf("const ENROLLMENT_DRAFT_DEFAULTS");
    assert.notEqual(start, -1, "ENROLLMENT_DRAFT_DEFAULTS is gone; the draft shape moved without this guard");
    const end = wizardSource.indexOf("};", start);
    const defaults = wizardSource.slice(start, end);
    for (const field of ["name:", "email:", "phone:"]) {
      assert.ok(
        !defaults.includes(field),
        `the draft defaults still carry ${field}, which is how a persona re-enters the wizard`,
      );
    }
  });

  it("derives the identity quiz options from the IDV mock rather than a persona list", () => {
    // Re-pinned by the fixture-eviction lane: the catalog `MOCK_QUIZ_OPTIONS`
    // became the derivation `mockQuizOptions(businessName)`, because the fixed
    // list's graded answer was the fixture persona's own company. What this
    // guard is for is unchanged — the component must not carry a list of its
    // own — so it now checks the derivation is called with the client's row.
    assert.match(
      wizardSource,
      /mockQuizOptions\(businessName\)/,
      "the quiz options are transcribed in the component again instead of derived from the client's own business name",
    );
    assert.match(
      wizardSource,
      /mockQuizAnswer\(businessName\)/,
      "the flags-off arm grades against something other than the same derivation the server mock uses",
    );
  });

  it("collects every CRS-only identity field transiently on the existing profile step", () => {
    assert.match(wizardSource, /enroll\?\.idvDriver === "crs"/);
    for (const key of CRS_SPEC_TRANSIENT_IDENTITY_KEYS) {
      assert.match(
        wizardSource,
        new RegExp(`${key}[:,]`),
        `the existing profile step no longer submits the spec-derived transient ${key} field`,
      );
    }
    const draftType = wizardSource.slice(
      wizardSource.indexOf("export type OnboardingDraft"),
      wizardSource.indexOf("};", wizardSource.indexOf("export type OnboardingDraft")),
    );
    const exitCall = wizardSource.slice(
      wizardSource.indexOf("onExit({"),
      wizardSource.indexOf("})", wizardSource.indexOf("onExit({")),
    );
    for (const key of CRS_SPEC_TRANSIENT_IDENTITY_KEYS) {
      assert.ok(!draftType.includes(key), `transient CRS identity ${key} entered OnboardingDraft`);
      assert.ok(!exitCall.includes(key), `transient CRS identity ${key} entered the saved-draft callback`);
    }
  });

  it("uses the CRS SMFA status operation instead of the invented SMS-code and quiz flow", () => {
    assert.match(
      wizardSource,
      new RegExp(`kind:\\s*["']${CRS_SPEC_IDV_SUBMISSION_KIND}["']`),
    );
    assert.match(wizardSource, /!verified && crsIdv \? \([\s\S]{0,1200}Check verification status/);
    assert.match(
      wizardSource,
      /enrollmentView\?\.verificationUrl[\s\S]{0,500}Open secure verification/,
      "the existing Verify step discards the transient development-sandbox link",
    );
  });
});

describe("consumer surface enrollment handoff", () => {
  const surfaceSource = readFileSync(
    fileURLToPath(new URL("./surfaces/consumer.tsx", import.meta.url)),
    "utf8",
  );

  it("passes the session profile into the wizard", () => {
    const start = surfaceSource.indexOf("<Onboarding1");
    assert.notEqual(start, -1, "the surface no longer renders the enrollment wizard");
    const end = surfaceSource.indexOf("/>", start);
    const element = surfaceSource.slice(start, end);
    assert.match(
      element,
      /identity=\{\{[^}]*name:\s*profile\.name/,
      "the wizard is rendered without the surface's own profile identity",
    );
    assert.match(
      element,
      /organization:\s*profileOrganization/,
      "the wizard's header chip is rendered without an organization, so DemoRoleTrigger falls back to the fixture business",
    );
  });

  it("names the durable client's own business, never the fixture roster's", () => {
    assert.match(
      surfaceSource,
      /const profileOrganization =[\s\S]{0,240}durableWorkspace/,
      "profileOrganization no longer branches on the durable workspace, so a signed-in consumer can be labelled with a fixture business",
    );
  });
});
