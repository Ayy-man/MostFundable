import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { DemoRole } from "@/lib/demo/types";

import {
  DEMO_CONSUMER_PERSONA_EMAILS,
  DEMO_PROFILE_EMAILS,
  DEMO_PROFILE_IDENTITIES,
  DEMO_PROFILE_IDS,
  DEMO_SESSION_COOKIE,
  demoInitials,
  demoProfileId,
  writeDemoSessionCookie,
} from "./demo-session";

const ROLES: DemoRole[] = ["admin", "affiliate", "consumer", "operator"];
const seed = readFileSync(
  fileURLToPath(new URL("../../../../supabase/seed.sql", import.meta.url)),
  "utf8",
);
const sessionSource = readFileSync(
  fileURLToPath(new URL("../auth/session.ts", import.meta.url)),
  "utf8",
);

describe("demo session identity map", () => {
  it("covers all four demo roles with distinct profile ids", () => {
    assert.deepEqual(Object.keys(DEMO_PROFILE_IDS).toSorted(), ROLES);
    assert.equal(new Set(Object.values(DEMO_PROFILE_IDS)).size, ROLES.length);
  });

  it("maps every role to a profile the seed actually inserts", () => {
    for (const role of ROLES) {
      const id = demoProfileId(role);
      assert.match(
        id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        `${role} is not a UUID`,
      );
      assert.ok(seed.includes(`'${id}'`), `${role} profile ${id} is absent from supabase/seed.sql`);
    }
  });

  it("gives every role the sign-in address the seed pairs with its profile id", () => {
    // Derived from the seed's own (id, email) pairs rather than transcribed from
    // it: the assertion looks each role's profile id up in the seed text and
    // reads whatever address sits beside it, so renaming an account in the seed
    // fails here instead of shipping a quick-sign-in button that cannot sign in.
    const pairs = new Map<string, string>();
    for (const [, id, email] of seed.matchAll(
      /\('([0-9a-f-]{36})'::uuid,\s*'([^']+)'\)/g,
    )) {
      if (!pairs.has(id)) pairs.set(id, email);
    }

    assert.ok(pairs.size >= ROLES.length, `seed yielded only ${pairs.size} (id, email) pairs`);

    for (const role of ROLES) {
      const id = DEMO_PROFILE_IDS[role];
      const seeded = pairs.get(id);
      assert.ok(seeded, `${role} profile ${id} has no seeded sign-in address`);
      assert.equal(
        DEMO_PROFILE_EMAILS[role],
        seeded,
        `${role} quick-sign-in address disagrees with the seed`,
      );
    }
  });

  it("names the same person the seed names, so the chrome and the tracker agree", () => {
    for (const role of ROLES) {
      const identity = DEMO_PROFILE_IDENTITIES[role];
      assert.ok(
        seed.includes(`'${identity.name}'`),
        `${role} display name ${identity.name} is absent from supabase/seed.sql`,
      );
    }
    assert.equal(DEMO_PROFILE_IDENTITIES.operator.organization, "Northbridge Funding Group");
  });

  it("writes the cookie name getSession reads", () => {
    assert.equal(DEMO_SESSION_COOKIE, "mf_demo_profile_id");
    assert.ok(sessionSource.includes(`"${DEMO_SESSION_COOKIE}"`));
  });
});

describe("writeDemoSessionCookie", () => {
  it("is inert with no document, so a server context can import the module", () => {
    assert.equal(typeof globalThis.document, "undefined");
    assert.doesNotThrow(() => writeDemoSessionCookie("operator"));
  });

  it("sets the seeded id, a root path and a lax same-site policy, and no Secure flag", () => {
    const written: string[] = [];
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        set cookie(value: string) {
          written.push(value);
        },
        get cookie() {
          return written.join("; ");
        },
      },
    });

    try {
      writeDemoSessionCookie("consumer");
    } finally {
      Reflect.deleteProperty(globalThis, "document");
    }

    assert.equal(written.length, 1);
    assert.equal(
      written[0],
      `mf_demo_profile_id=${DEMO_PROFILE_IDS.consumer}; path=/; SameSite=Lax`,
    );
    assert.equal(written[0]?.includes("Secure"), false);
  });
});

describe("demoInitials", () => {
  it("takes the first two word initials, upper-cased", () => {
    assert.equal(demoInitials("Avery Northbridge Demo"), "AN");
    assert.equal(demoInitials("Parker Platform Demo"), "PP");
  });

  it("offers only seeded consumer accounts as quick-sign-in personas", () => {
    // Derived from the seed's own (id, email) pairs: every persona address must be
    // one the seed inserts, its profile id must be a consumer (a1…001x), and the
    // role's default consumer must be among them so the list is a superset.
    const pairs = new Map(
      [...seed.matchAll(/\('(a1000000-0000-0000-0000-0000000000\d\d)'::uuid, '([^']+)'\)/g)].map((m) => [m[2], m[1]] as const),
    );
    assert.ok(DEMO_CONSUMER_PERSONA_EMAILS.length >= 2, "the persona list is empty");
    for (const email of DEMO_CONSUMER_PERSONA_EMAILS) {
      const id = pairs.get(email);
      assert.ok(id !== undefined, `${email} is not a seeded account`);
      assert.match(id, /-0000000000(1\d)$/, `${email} (${id}) is not a seeded consumer profile`);
    }
    assert.ok(DEMO_CONSUMER_PERSONA_EMAILS.includes(DEMO_PROFILE_EMAILS.consumer));
  });
});
