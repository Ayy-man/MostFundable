import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * The fixture-eviction sprint's LANE D, 2026-08-22.
 *
 * Every assertion here derives what it expects from the module it is guarding —
 * the exported notice constant, the illustrative roster, the source of the
 * component under test — rather than transcribing the string that reproduced
 * the defect. That is the round-5 standard, and it is what makes these tests
 * survive a rewording that keeps the property.
 *
 * Watched failing on the pre-fix tree: see the per-suite notes.
 */

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const CHROME = read("./demo-chrome.tsx");
const PALETTE = read("./command-palette.tsx");
const SESSION = read("./feedback-session.tsx");
const SHEET = read("./bank-detail-sheet.tsx");

/**
 * The approved notice, read out of the constant the component exports rather
 * than imported: the runner cannot load a .tsx module, and reading the source
 * is what keeps this test derived from the module under guard.
 */
function demoEnvironmentNotice(): string {
  const declared = /export const DEMO_ENVIRONMENT_NOTICE =\s*\n?\s*"([^"]+)";/.exec(CHROME);
  assert.ok(declared, "demo-chrome no longer exports the approved notice as a constant");
  return declared[1];
}

/**
 * A claim the bar is not allowed to make any more, expressed as the property
 * rather than as a list: with nineteen flags on, the surfaces round-trip to
 * Supabase and persist, so no variant may promise that nothing contacts an
 * external system or that changes reset on reload.
 */
const FORBIDDEN_BAR_CLAIMS = [
  /contacts? no external systems/i,
  /reset on reload/i,
  /sign-in is live/i,
];

describe("the disclosure bar says one thing, and it is the approved thing", () => {
  // Pre-fix failure: "the bar composes a claim outside the approved notice:
  // 'Illustrative data only · sign-in is live, every other action contacts no
  // external systems · demo changes reset on reload · ...'".
  it("carries the approved sentence as its accessible name", () => {
    assert.match(
      CHROME,
      /aria-label=\{DEMO_ENVIRONMENT_NOTICE\}/,
      "the bar's accessible name is no longer the approved notice constant",
    );
    assert.equal(
      demoEnvironmentNotice(),
      "Demo environment · illustrative data · payments and credit checks are simulated.",
    );
  });

  it("composes every visible variant out of that same sentence", () => {
    // The bar renders no copy literal of its own: every variant is built from a
    // DEMO_ENVIRONMENT_NOTICE_* constant, and each of those is a substring of
    // the approved sentence. So a truncated variant can shorten but can never
    // say something the full one does not.
    const bar = CHROME.slice(
      CHROME.indexOf("export function DemoEnvironmentBar"),
      CHROME.indexOf("export function DemoRoleTrigger"),
    );
    assert.doesNotMatch(
      bar,
      /^\s*(\?|:)?\s*"[A-Z][^"]{10,}"/m,
      "the bar renders a copy literal inline instead of a notice constant",
    );

    const constants = [...CHROME.matchAll(/^const (DEMO_ENVIRONMENT_NOTICE_\w+) =\s*\n?\s*"([^"]+)";/gm)];
    assert.ok(constants.length >= 2, "the bar's variants no longer come from named constants");
    const canonical = demoEnvironmentNotice().toLowerCase();
    for (const [, name, value] of constants) {
      assert.ok(
        canonical.includes(value.toLowerCase()),
        `${name} is "${value}", which the approved notice does not contain`,
      );
    }
  });

  it("makes none of the claims the flags have falsified", () => {
    for (const claim of FORBIDDEN_BAR_CLAIMS) {
      assert.doesNotMatch(
        CHROME,
        claim,
        `the disclosure bar still asserts ${claim} to a signed-in durable user`,
      );
    }
  });

  it("says the same thing on both sides of FEATURE_REAL_AUTH", () => {
    // A disclosure that changes with a flag is one nobody can verify, so the
    // prop no longer selects copy.
    const bar = CHROME.slice(
      CHROME.indexOf("export function DemoEnvironmentBar"),
      CHROME.indexOf("export function DemoRoleTrigger"),
    );
    assert.doesNotMatch(bar, /realAuth\s*$/m);
    assert.doesNotMatch(bar, /\{realAuth\s*\n?\s*\?/);
  });
});

describe("the role trigger never borrows an illustrative organization", () => {
  // Pre-fix failure: "the organization falls back to the roster default even
  // when a caller supplied an identity" — `demo-shell` passes {detail,
  // initials, name} with no organization, so a signed-in admin's trigger read
  // the illustrative operator's business in its accessible name.
  it("falls back to the roster only when no identity was supplied at all", () => {
    const trigger = CHROME.slice(CHROME.indexOf("export function DemoRoleTrigger"));
    assert.doesNotMatch(
      trigger,
      /identity\?\.organization \?\? role\.organization/,
      "an identity without an organization is still labelled with the roster's business",
    );
    assert.match(trigger, /identity\s*\n?\s*\?\s*identity\.organization\s*\n?\s*:\s*role\.organization/);
  });

  it("omits the organization from both labels rather than inventing one", () => {
    const trigger = CHROME.slice(CHROME.indexOf("export function DemoRoleTrigger"));
    assert.match(trigger, /organization \? `\$\{role\.label\} · \$\{organization\}` : role\.label/);
    assert.match(trigger, /accessibleName = organization/);
  });
});

describe("the illustrative session store stays out of a real workspace", () => {
  // Pre-fix failure: "the provider seeds INITIAL_APPLICATION_RECORDS for every
  // caller" — a signed-in operator, admin and affiliate all opened on another
  // cast's applications and affiliate shares, with no write path behind them.
  it("takes a seeded flag and honours it for both seeds", () => {
    assert.match(SESSION, /seeded = true/);
    assert.match(SESSION, /seeded \? cloneInitialApplications\(\) : \[\]/);
    assert.match(SESSION, /seeded \? INITIAL_AFFILIATE_SHARES\.map[^:]+: \[\]/);
  });

  it("stops the funded-amount fallback from borrowing a roster number", () => {
    // The G-HOST-14 class: a client with no application rows used to inherit
    // the illustrative roster's funded total, which is a fabricated funding
    // claim about a real business.
    const getter = SESSION.slice(
      SESSION.indexOf("const getClientFundedAmount"),
      SESSION.indexOf("const shareClientWithAffiliate"),
    );
    const fallback = getter.indexOf("DEMO_CLIENTS.find");
    const guard = getter.indexOf("if (!seeded) return 0;");
    assert.ok(guard > 0, "the funded-amount fallback is no longer gated on the seed");
    assert.ok(guard < fallback, "the guard no longer precedes the roster lookup");
    assert.match(getter, /\[applications, seeded\]/, "the memo no longer depends on the seed");
  });

  it("is wired off on every route that redirects an unauthenticated visitor", () => {
    // admin/ is LANE B's file this sprint; the other three are wired here and
    // the admin one is recorded as a seam.
    for (const route of ["operator", "consumer", "affiliate"]) {
      const client = read(`../../app/(surfaces)/${route}/surface-client.tsx`);
      assert.match(
        client,
        /<FeedbackSessionProvider seeded=\{!realAuth\}>/,
        `the ${route} route still seeds the illustrative session store for a signed-in user`,
      );
    }
  });
});

describe("the command palette describes what the commands do", () => {
  // Pre-fix failure: the palette called the operator's live KB assistant "the
  // simulated workspace assistant" and gated it with "AI assistant is not
  // connected in this demo", while FEATURE_KB is on and the assistant view
  // renders OperatorKbAssistant against /api/kb/operator.
  it("does not call the live assistant simulated or unconnected", () => {
    assert.doesNotMatch(PALETTE, /simulated workspace assistant/i);
    assert.doesNotMatch(PALETTE, /not connected in this demo/i);
  });

  it("carries no command description that characterises the environment", () => {
    const actions = PALETTE.slice(
      PALETTE.indexOf("const QUICK_ACTIONS"),
      PALETTE.indexOf("function actionLabel"),
    );
    for (const description of actions.matchAll(/description: "([^"]+)"/g)) {
      assert.doesNotMatch(
        description[1],
        /\bdemo\b|\bsimulated\b/i,
        `the quick action "${description[1]}" describes the environment instead of the action`,
      );
    }
  });
});

describe("the scripted workspace assistant is gone from the tree", () => {
  /**
   * It used to render on the platform-admin surface: a "Simulated" pill, a
   * claim that "No AI service, Supabase connection, or external request runs in
   * this demo" on a page whose other panels read Supabase on every load, and a
   * fallback reply beginning "In this demo I answer only from the local
   * workspace fixtures". An earlier lane unmounted it, leaving a scripted
   * assistant sitting in the tree with no caller and a full set of canned
   * replies ready for the next person who imported it.
   *
   * The guard walks `web/src` rather than reading a path, because a module that
   * has been moved is not a module that has been deleted, and the difference is
   * exactly what a clean-looking rebase can hide.
   */
  const modules = (() => {
    const out: string[] = [];
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        // Test files are excluded: this file names the deleted module and quotes
        // its claims, and a guard that fails on its own prose guards nothing.
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
      }
    };
    walk(root);
    return out;
  })();

  it("has no module left under web/src", () => {
    const survivors = modules.filter((file) => /workspace-assistant\.tsx?$/.test(file));
    assert.deepEqual(survivors, [], "the scripted workspace assistant is still on disk");
  });

  it("has no importer and no remaining mount", () => {
    for (const file of modules) {
      const text = readFileSync(file, "utf8");
      assert.doesNotMatch(
        text,
        /workspace-assistant|WorkspaceAssistant/,
        `${file} still references the scripted workspace assistant`,
      );
    }
  });

  it("leaves none of its claims anywhere in the tree", () => {
    // The strings, not just the module: a copy-paste into another component
    // reinstates the defect under a different name.
    for (const claim of [
      /No AI service, Supabase connection, or external request runs in this demo/,
      /In this demo I answer only from the local workspace fixtures/,
      // "Answers come from your workspace data" is deliberately NOT here. The
      // scripted assistant said it while answering from a canned array, which is
      // what made it a lie; the live KB assistant says the same sentence in
      // `lib/kb/prompts.ts` and there it is simply true. The claim was never the
      // problem — the thing making it was.
    ]) {
      for (const file of modules) {
        assert.doesNotMatch(readFileSync(file, "utf8"), claim, `${file} carries ${claim}`);
      }
    }
  });
});

describe("the lender panel refuses to invent a lender record", () => {
  // Pre-fix failure: `toBankDetail` coerced an unrecorded requirement to false
  // and the panel printed "No"; and the panel had no way for a caller to opt
  // out of the illustrative BANK_DETAILS map, so the admin surface — which
  // passes neither Phase-8 prop — rendered invented deposit minimums and
  // example.com application links.
  it("prints a third label for an unrecorded requirement", () => {
    assert.match(SHEET, /function requiredLabel\(required: boolean \| null\)/);
    assert.match(SHEET, /required === null\) return "Not recorded"/);
    assert.doesNotMatch(SHEET, /\.required \? "Yes" : "No"/);
  });

  it("carries the unknown through the durable projection instead of coercing it", () => {
    const client = read("../../lib/vault/read.client.ts");
    const mapper = client.slice(client.indexOf("export function toBankDetail"));
    assert.doesNotMatch(
      mapper,
      /required: payload\.\w+\.required \?\? false/,
      "an unrecorded requirement is coerced to false again, so the panel reads a confident No",
    );
    assert.match(mapper, /payload\.checking\.required \?\? null/);
    assert.match(mapper, /payload\.relationshipManager\.required \?\? null/);
  });

  it("lets a caller opt out of the illustrative detail map", () => {
    assert.match(SHEET, /fixtureDetailAllowed = true/);
    const lookup = SHEET.indexOf("BANK_DETAILS[bank.bankId]");
    const gate = SHEET.indexOf("fixtureDetailAllowed && bank");
    assert.ok(gate > 0 && gate < lookup, "the illustrative lookup is not behind the opt-out");
  });

  it("says the details are unrecorded rather than showing an illustrative one", () => {
    assert.match(SHEET, /are not recorded for this lender\./);
  });
});
