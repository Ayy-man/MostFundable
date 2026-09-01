import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const surface = read("./affiliate.tsx");

/** The text of one top-level function, so a live assertion cannot be satisfied by fixture code. */
function functionBody(source: string, declaration: string, next: string): string {
  const start = source.indexOf(declaration);
  assert.notStrictEqual(start, -1, `${declaration} is no longer in the file`);
  const end = source.indexOf(next, start);
  assert.notStrictEqual(end, -1, `${next} no longer follows ${declaration}`);
  return source.slice(start, end);
}

/**
 * White-label means an affiliate of one operator never sees another operator's
 * brand, so the durable affiliate portal has to name the organization the
 * signed-in affiliate's profile points at. Every assertion below derives what it
 * expects — the identity field, the fixture brand, the projection the affiliate
 * is actually allowed to read — from the type, the fallback and the migration
 * rather than transcribing a literal out of the reproduction (round-5 standard).
 *
 * Watched failing on the pre-fix tree, where `LiveAffiliateSurface` printed the
 * fixture brand three times and no affiliate file mentioned the session identity.
 */
function orgNameField(): string {
  const source = read("../../lib/auth/display-identity.ts");
  const block = /export type SessionDisplayIdentity = \{([^}]+)\}/.exec(source);
  assert.ok(block, "SessionDisplayIdentity is no longer parseable from display-identity.ts");
  const field = /(\w+): string \| null;/.exec(block[1]);
  assert.ok(field, "SessionDisplayIdentity no longer carries a nullable org-name field");
  return field[1];
}

const live = functionBody(surface, "function LiveAffiliateSurface(", "export function AffiliateSurface(");
const fixture = surface.replace(live, "");

/**
 * The illustrative brand, derived from the illustrative half of the file
 * itself: every fixture page header carries it as its eyebrow, so the first one
 * defines the value the rest are checked against and no literal is transcribed
 * from the reproduction.
 *
 * Re-derived 2026-08-22 (fixture eviction, LANE D). It used to be read out of
 * the live surface's own fallback, which is exactly the coupling the eviction
 * removed: the durable portal must not carry that fallback at all.
 */
function fixtureBrand(): string {
  const first = /eyebrow="([^"]+)"/.exec(fixture);
  assert.ok(first, "the fixture affiliate views no longer carry a page-header eyebrow");
  return first[1];
}

describe("the durable affiliate portal names the affiliate's own operator", () => {
  it("prints no illustrative brand at all, resolved or otherwise", () => {
    // Changed 2026-08-22 (fixture eviction, LANE D) from "every mention sits
    // inside a session-identity fallback" to "there are no mentions". A durable
    // affiliate whose profile carries no organization used to be shown one
    // specific tenant's brand as its header, tile, eyebrow and description --
    // white-label leakage in the one place an affiliate cannot check it. Absent
    // identity now renders unbranded, so the fallback that this test used to
    // require is the defect.
    const brand = fixtureBrand();
    const firstWord = brand.split(" ")[0];
    assert.ok(
      !live.includes(firstWord),
      `LiveAffiliateSurface still names ${firstWord}; the durable portal must be unbranded when identity is absent`,
    );
    assert.match(
      live,
      new RegExp(`const operatorName = sessionIdentity\\?\\.${orgNameField()} \\?\\? null;`),
      "the durable brand no longer resolves from the session identity alone",
    );
  });

  it("renders the resolved name in the header, the eyebrow and the description", () => {
    assert.match(live, /<span className="block truncate text-sm font-semibold">\{operatorName\}<\/span>/);
    assert.match(live, /eyebrow=\{operatorName \?\? "[^"]+"\}/);
    assert.match(live, /description=\{\s*operatorName\s*\?\s*`Follow the business owners you sent to \$\{operatorName\} and see /);
  });

  it("derives the brand tile monogram from that same name", () => {
    // A tile reading "AP" beside the header name "Northbridge Funding Group" is
    // the same leak in two letters, so the monogram goes through the shell's
    // exported derivation instead of a second, fixed literal.
    assert.match(live, /\{operatorBrandInitials\(operatorName\)\}/);
    assert.doesNotMatch(live, />AP</);
    // And the tile is inside the branded arm, so an unbranded portal shows no
    // monogram rather than a monogram of nothing.
    const tile = live.indexOf("operatorBrandInitials(operatorName)");
    assert.ok(live.slice(0, tile).includes("{operatorName ? ("), "the brand tile renders without a resolved name");
  });
});

describe("the affiliate route reads and threads the identity", () => {
  it("the server page reads it under the caller's own RLS and passes it down", () => {
    const page = read("../../app/(surfaces)/affiliate/page.tsx");
    assert.match(page, /readSessionDisplayIdentity\(session\)/);
    assert.match(page, /sessionIdentity=\{sessionIdentity \?\? undefined\}/);
  });

  it("the client wrapper forwards it to the surface", () => {
    const client = read("../../app/(surfaces)/affiliate/surface-client.tsx");
    assert.match(client, /sessionIdentity\?: SessionDisplayIdentity;/);
    assert.match(client, /sessionIdentity=\{sessionIdentity\}/);
  });

  it("reads the name through the projection R2A-12 left consumers and affiliates", () => {
    // An affiliate holds no read on `public.orgs` at all, so the embedded
    // organization in the profiles self-read comes back null and the fallback
    // would silently win. The relation named here is taken from the migration
    // that creates it, so dropping or renaming the projection fails this test
    // instead of leaving a header that quietly shows the wrong operator.
    const migration = readFileSync(
      fileURLToPath(new URL("../../../../supabase/migrations/276_r2a12_public_org_projection.sql", import.meta.url)),
      "utf8",
    );
    const view = /create or replace view public\.(\w+)/.exec(migration);
    assert.ok(view, "migration 276 no longer creates the consumer and affiliate organization projection");
    assert.match(read("../../lib/auth/display-identity.server.ts"), new RegExp(`\\.from\\("${view[1]}"\\)`));
  });
});

describe("the fixture affiliate surface keeps its own branding", () => {
  it("still prints the fixture operator in every fixture page header", () => {
    const brand = fixtureBrand();
    const eyebrows = [...fixture.matchAll(/eyebrow="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(eyebrows.length > 0, "the fixture affiliate views no longer carry a page-header eyebrow");
    for (const eyebrow of eyebrows) {
      assert.strictEqual(eyebrow, brand, "a fixture page header no longer names the fixture operator");
    }
  });

  it("still carries the fixture referral and commission copy", () => {
    assert.match(fixture, /Follow the business owners you sent to Apex and see the status of operator-managed commission records\./);
    assert.match(fixture, /Attribution is retained when the Apex team shares a client directly\./);
  });
});
