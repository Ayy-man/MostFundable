import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * The white-label promise is that a client of one operator never sees another
 * operator's brand, so the consumer header has to name the org the signed-in
 * consumer's profile points at. These assertions derive the field they expect
 * from the SessionDisplayIdentity type itself rather than transcribing
 * "orgName" from the fix: rename the field and this test moves with it instead
 * of passing against plumbing that no longer exists (round-5 standard).
 *
 * Watched failing on the pre-fix tree, where `consumer.tsx` assigned the
 * fixture operator name to a `const` and no consumer file mentioned the
 * session identity at all.
 */
function orgNameField(): string {
  const source = read("../../lib/auth/display-identity.ts");
  const block = /export type SessionDisplayIdentity = \{([^}]+)\}/.exec(source);
  assert.ok(block, "SessionDisplayIdentity is no longer parseable from display-identity.ts");
  const field = /(\w+): string \| null;/.exec(block[1]);
  assert.ok(field, "SessionDisplayIdentity no longer carries a nullable org-name field");
  return field[1];
}

describe("the consumer surface names the signed-in consumer's own operator", () => {
  const surface = read("./consumer.tsx");

  it("derives the header brand from the session identity, keeping the fixture name only as the fallback", () => {
    assert.match(
      surface,
      new RegExp(`const operatorName = sessionIdentity\\?\\.${orgNameField()} \\?\\? "`),
    );
  });

  it("has no unconditional operator-name literal left to leak", () => {
    assert.doesNotMatch(surface, /const operatorName = "/);
  });

  it("renders no operator monogram of its own, fixed or derived", () => {
    // A tile reading "AFP" beside the header name "Northbridge Funding Group"
    // is the same leak in three letters. The queued-analysis handoff used to
    // carry a second header with its own tile; it is now an overlay inside
    // ConsumerShell, so the shell's tile is the only one on screen and the
    // derivation is asserted once, below, where it lives. This surface must
    // therefore render no monogram at all — neither a literal nor a copy of
    // the derivation that could drift from the shell's.
    assert.doesNotMatch(surface, />AFP</);
    assert.doesNotMatch(surface, /operatorBrandInitials/);
  });
});

describe("the consumer route reads and threads the identity", () => {
  it("the server page reads it under the caller's own RLS and passes it down", () => {
    const page = read("../../app/(surfaces)/consumer/page.tsx");
    assert.match(page, /readSessionDisplayIdentity\(session\)/);
    assert.match(page, /sessionIdentity=\{sessionIdentity \?\? undefined\}/);
  });

  it("the client wrapper forwards it to the surface", () => {
    const client = read("../../app/(surfaces)/consumer/surface-client.tsx");
    assert.match(client, /sessionIdentity\?: SessionDisplayIdentity;/);
    assert.match(client, /<ConsumerSurface [^>]*sessionIdentity=\{sessionIdentity\}/);
  });
});

describe("the shell owns the one initials derivation", () => {
  it("the shell exports it and consumes it rather than deriving twice", () => {
    const shell = read("../consumer/consumer-shell.tsx");
    assert.match(shell, /export function operatorBrandInitials\(operatorName: string\): string/);
    assert.match(shell, /const operatorInitials = operatorBrandInitials\(operatorName\);/);
  });
});
