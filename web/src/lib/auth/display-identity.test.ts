import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  displayInitials,
  displayRoleLine,
  orgRoleLabel,
} from "./display-identity.ts";

const seed = readFileSync(
  fileURLToPath(new URL("../../../../supabase/seed.sql", import.meta.url)),
  "utf8",
);

/**
 * The expected identity is derived from the seed at test time, never
 * transcribed from a reproduction (round-5 standard): if the seeded operator
 * owner is renamed or reassigned, the assertions move with the seed.
 */
function seededOperatorOwner(): { fullName: string; orgId: string } {
  // Profile tuples look like: ('id', 'operator_member', 'org', 'owner', '{}'::uuid[], 'Full Name', 'email', null)
  const tuple = /\(\s*'[^']+',\s*'operator_member',\s*'([^']+)',\s*'owner',\s*'\{\}'::uuid\[\],\s*'([^']+)',/.exec(seed);
  assert.ok(tuple, "seed.sql no longer contains an operator owner profile tuple this test can parse");
  return { fullName: tuple[2], orgId: tuple[1] };
}

function seededOrgName(orgId: string): string {
  const tuple = new RegExp(`\\(\\s*'${orgId}',\\s*'([^']+)',`).exec(seed);
  assert.ok(tuple, `seed.sql no longer contains an org tuple for ${orgId}`);
  return tuple[1];
}

describe("display identity helpers against the seeded operator owner", () => {
  const owner = seededOperatorOwner();
  const orgName = seededOrgName(owner.orgId);

  it("derives initials from the seeded full name", () => {
    const expected = owner.fullName
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
    assert.equal(displayInitials(owner.fullName), expected);
  });

  it("renders the sidebar line as role · org for the seeded owner", () => {
    assert.equal(
      displayRoleLine({ name: owner.fullName, orgName, orgRole: "owner" }),
      `Owner · ${orgName}`,
    );
  });
});

describe("displayInitials shapes", () => {
  it("repeats the initial for single-word names", () => {
    assert.equal(displayInitials("Cher"), "CC");
  });
  it("never returns empty for whitespace", () => {
    assert.equal(displayInitials("   "), "?");
  });
});

describe("orgRoleLabel", () => {
  it("sentence-cases every enum value the schema defines", () => {
    // Derive the enum from the migration, not from a copied list.
    const migration = readFileSync(
      fileURLToPath(new URL("../../../../supabase/migrations/001_platform_tenancy.sql", import.meta.url)),
      "utf8",
    );
    const block = /create type public\.org_role as enum \(([^)]+)\)/.exec(migration);
    assert.ok(block, "org_role enum no longer parseable from 001_platform_tenancy.sql");
    const values = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.ok(values.length >= 2, "org_role enum unexpectedly small");
    for (const value of values) {
      const label = orgRoleLabel(value as never);
      assert.match(label, /^[A-Z]/, `${value} label does not start uppercase`);
      assert.ok(!label.includes("_"), `${value} label leaks an underscore`);
    }
  });
});

describe("degradation", () => {
  it("drops missing parts instead of rendering a dangling separator", () => {
    assert.equal(displayRoleLine({ name: "A", orgName: null, orgRole: "owner" }), "Owner");
    assert.equal(displayRoleLine({ name: "A", orgName: "Org", orgRole: null }), "Org");
    assert.equal(displayRoleLine({ name: "A", orgName: null, orgRole: null }), "Operator");
  });
});

describe("operator shell uses the session identity", () => {
  it("every fixture identity prop on DemoShell is a fallback behind sessionIdentity", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../components/surfaces/operator.tsx", import.meta.url)),
      "utf8",
    );
    // The four identity props of the operator DemoShell must each consult
    // sessionIdentity before falling back to the fixture persona. Watched
    // failing on the pre-fix tree, where all four were bare string literals.
    // The shell prefers the separately published portal name, then the live
    // organization identity initialized from the signed-in session. The demo
    // company is reachable only in the explicit non-durable fixture branch.
    assert.match(source, /brand=\{workspaceBrandName\}/);
    assert.match(
      source,
      /const \[liveWorkspaceName, setLiveWorkspaceName\] = useState\(\s*\(\) => sessionIdentity\?\.orgName\s*\?\?\s*\(durableWorkspace \? "Your workspace" : "Apex Funding Partners"\),\s*\);/,
    );
    assert.match(
      source,
      /const workspaceBrandName = liveTenantBrand\?\.portalName \?\? liveWorkspaceName;/,
    );
    assert.match(source, /profileName=\{sessionIdentity\?\.name \?\?/);
    assert.match(source, /initials=\{sessionIdentity \? displayInitials\(/);
    assert.match(source, /roleLabel=\{sessionIdentity \? displayRoleLine\(/);
    assert.doesNotMatch(source, /profileName="Alec Rivera"/);
    assert.doesNotMatch(source, /roleLabel="Owner · Apex Funding Partners"/);
  });
});
