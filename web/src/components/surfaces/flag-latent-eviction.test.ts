import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/testing/strip-comments";

/**
 * The same Tier-2 rule as `consumer-flag-latent-eviction.test.ts`, on the other
 * three surfaces: a feature flag decides whether a read happens, and a session
 * decides whether a fixture may stand in for the answer. A signed-in user never
 * gets the fixture.
 *
 * Three panels broke it. `FEATURE_AFFILIATES` off handed a signed-in affiliate
 * the whole illustrative portal — another affiliate's lead book and a referral
 * link at `apply.apexfundingpartners.com` (G-R5-OWN-03). `FEATURE_ADMIN` off
 * swapped each of the four governed admin sections for a fixture twin, so
 * switching the governed read off did not degrade the page, it repopulated it
 * with invented platform figures. And `/api/trainings/config` answering
 * `enabled: false` gave a signed-in operator six lessons they never made with
 * working-looking Publish controls over them.
 *
 * Every scan walks `web/src` rather than reading a path, because these bodies
 * move — the chat extraction relocated surface internals mid-lane — and a
 * relocated module is not a deleted one.
 *
 * Watched failing on the pre-fix tree (4ef499a); failure texts are in the lane
 * report.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");

const withoutComments = stripComments;

function sources(): Array<{ relative: string; text: string }> {
  const out: Array<{ relative: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      out.push({ relative: path.relative(SRC, full), text: withoutComments(fs.readFileSync(full, "utf8")) });
    }
  };
  walk(SRC);
  return out;
}

const MODULES = sources();

function moduleContaining(anchor: string, subject: string): { relative: string; text: string } {
  const hits = MODULES.filter((module) => module.text.includes(anchor));
  assert.equal(
    hits.length,
    1,
    `${subject}: expected exactly one module under web/src containing ${JSON.stringify(anchor)}, found ${hits.length}${hits.length ? ` (${hits.map((hit) => hit.relative).join(", ")})` : ""}`,
  );
  return hits[0];
}

describe("the illustrative affiliate portal is unreachable from a real session", () => {
  it("the durable route never selects it", () => {
    // Derived: find whichever module renders the illustrative surface, read the
    // name of the prop value that selects it out of the surface's own ternary,
    // then require the route that mounts it to have a real-session arm.
    const surface = moduleContaining("function FixtureAffiliateSurface(", "the illustrative affiliate portal");
    const selector = /if \(live !== undefined\) \{[\s\S]*?\}\s+return <FixtureAffiliateSurface/.exec(surface.text);
    assert.ok(selector, `${surface.relative}: the illustrative portal is no longer selected by an absent live state`);

    const route = moduleContaining('live={affiliatesEnabled ?', "the affiliate route");
    const wiring = route.text.split("\n").find((line) => line.includes("live={affiliatesEnabled ?"));
    assert.ok(wiring, `${route.relative}: the live-state wiring moved`);
    assert.ok(
      wiring.includes("realAuth"),
      `${route.relative}: the flag alone still decides whether an affiliate sees the illustrative portal: ${wiring.trim()}`,
    );
    assert.ok(
      wiring.includes('{ status: "disabled" }'),
      `${route.relative}: a signed-in affiliate with the flag off has no named live state to render`,
    );
  });

  it("the live surface renders that state as an absence, not as an outage", () => {
    const surface = moduleContaining("function LiveAffiliateSurface(", "the durable affiliate portal");
    assert.match(
      surface.text,
      /\| \{ status: "disabled" \}/,
      `${surface.relative}: the live state union no longer carries the flag-off case`,
    );
    const branch = /live\.status === "disabled" \? \(([\s\S]*?)\) : live\.status === "error"/.exec(surface.text);
    assert.ok(branch, `${surface.relative}: the flag-off case has no branch of its own`);
    assert.doesNotMatch(
      branch[1],
      /could not be loaded/i,
      `${surface.relative}: the flag-off case describes itself as a failure, which sends the reader chasing an outage that is not happening`,
    );
  });
});

describe("no governed admin section falls back to its fixture twin for a signed-in admin", () => {
  /**
   * Derived, not enumerated. Each governed section is a `Governed<Name>`
   * component whose fixture twin is `<Name>` in the same module; the pairs come
   * out of the source, so a fifth pair added later is covered without anybody
   * editing this test.
   */
  function twinnedSections(): Array<{ fixture: string; governed: string; relative: string }> {
    const pairs: Array<{ fixture: string; governed: string; relative: string }> = [];
    for (const { relative, text } of MODULES) {
      for (const match of text.matchAll(/function Governed(\w+)\(/g)) {
        if (text.includes(`function ${match[1]}(`)) {
          pairs.push({ fixture: match[1], governed: `Governed${match[1]}`, relative });
        }
      }
    }
    return pairs;
  }

  it("there are twinned sections to guard", () => {
    assert.ok(
      twinnedSections().length >= 3,
      `found only ${twinnedSections().length} governed/fixture pairs; this scan has lost its subject`,
    );
  });

  it("every twin ternary is decided by a value the surface threaded, not by a raw flag read", () => {
    for (const { fixture, governed, relative } of twinnedSections()) {
      const owner = MODULES.find((candidate) => candidate.relative === relative);
      assert.ok(owner);
      const ternary = new RegExp(`(\\w+) \\? <${governed} \\/> : <${fixture} \\/>`).exec(owner.text);
      assert.ok(ternary, `${relative}: ${governed}/${fixture} are no longer chosen by a single-identifier ternary`);
      // Whatever the deciding identifier is, it must arrive as a parameter the
      // surface computed. A section reading the flag for itself would route
      // around the widening below and reinstate the defect locally.
      assert.doesNotMatch(
        owner.text,
        new RegExp(`const ${ternary[1]} = featureFlag\\(`),
        `${relative}: ${governed}/${fixture} is decided by a flag read of its own, bypassing the session`,
      );
    }
  });

  it("nothing inside the surface uses the admin flag without session context", () => {
    const surface = moduleContaining("export function AdminSurface(", "the admin surface entry point");
    const body = surface.text.slice(surface.text.indexOf("export function AdminSurface("));
    const handoffs = body
      .split("\n")
      .filter((line) => /\badminEnabled\b/.test(line))
      // The destructured parameter and its type are the declaration, not a handoff.
      .filter((line) => !/adminEnabled = false,|adminEnabled\?: boolean;/.test(line));
    assert.ok(handoffs.length > 0, `${surface.relative}: the surface no longer passes the admin flag anywhere`);
    for (const line of handoffs) {
      assert.ok(
        /\bsignedIn\b/.test(line),
        `${surface.relative}: the bare flag is used without the signed-in state, so fixture and governed behavior can diverge: ${line.trim()}`,
      );
    }
  });

  it("the surface widens the flag with the session exactly once", () => {
    const surface = moduleContaining("function renderAdminView(", "the admin surface");
    assert.match(
      surface.text,
      /renderAdminView\([^)]*adminEnabled \|\| signedIn/,
      `${surface.relative}: the admin view router no longer consults the session`,
    );
  });

  it("a governed read refused by the flag says so instead of reporting a failure", () => {
    // Derived from the client module: the 404 predicate is exported there, and
    // every governed section that has a failure branch must consult it.
    const client = moduleContaining("export function adminReadNotEnabled(", "the admin client");
    assert.match(
      client.text,
      /ADMIN_HTTP_404/,
      `${client.relative}: the not-enabled predicate stopped recognising the routes' flag-off answer`,
    );
    const surface = moduleContaining("function renderAdminView(", "the admin surface");
    const failureBranches = surface.text.split("\n").filter((line) => /setState\("error"\)|setFailed\(/.test(line));
    assert.ok(failureBranches.length > 0, `${surface.relative}: the governed sections have no failure branch left`);
    for (const line of failureBranches) {
      assert.ok(
        line.includes("adminReadNotEnabled"),
        `${surface.relative}: a governed read reports "could not be loaded" for a route that answered 404 on purpose: ${line.trim()}`,
      );
    }
  });
});

describe("the admin training library never leaves a failed read looking healthy", () => {
  it("every path out of the config read names a state", () => {
    const surface = moduleContaining("function TrainingsView(", "the admin trainings view");
    const start = surface.text.indexOf("const [libraryState, setLibraryState]");
    const end = surface.text.indexOf("}, [durableWorkspace]);", start);
    assert.ok(start >= 0 && end > start, `${surface.relative}: the training-library read no longer tracks a state`);
    const effect = surface.text.slice(start, end);
    assert.match(effect, /const loadedConfig = await loadAdminTrainingConfig\(\)/);
    assert.match(effect, /if \(!loadedConfig\.enabled\)[\s\S]*?setLibraryState\(durableWorkspace \? "not-enabled" : "fixture"\)/);
    assert.match(effect, /const rows = await loadAdminTrainings\(\)[\s\S]*?setTrainings\(rows\)[\s\S]*?setLibraryState\("ready"\)/);
    assert.match(effect, /catch \{[\s\S]*?setLibraryState\("unavailable"\)/);

    const client = moduleContaining("export async function loadAdminTrainingConfig(", "the admin training client");
    assert.match(client.text, /if \(!response\.ok\) throw await errorFor\(response\)/);
    assert.match(client.text, /if \(config === null\) throw new AdminTrainingClientError/);
    assert.match(client.text, /if \(!exactRecord\(value, \["trainings"\]\) \|\| !Array\.isArray\(value\.trainings\)\)/);
  });

  it("rows and the published count come only from a settled read", () => {
    // Derived: the states that may put rows on the page are `ready` (the
    // platform's own trainings) and `fixture` (the illustrative shell, which has
    // no session). Every other member of the union — however many are added
    // later — must suppress both the rows and the counter, and this reads the
    // union out of the declaration rather than restating it.
    const surface = moduleContaining("function TrainingsView(", "the admin trainings view");
    const union = /const \[libraryState, setLibraryState\] = useState<([^>]+)>/.exec(surface.text);
    assert.ok(union, `${surface.relative}: the training-library state is no longer a named union`);
    const suppressing = union[1]
      .split("|")
      .map((member) => member.trim().replaceAll('"', ""))
      .filter((member) => member !== "ready" && member !== "fixture");
    assert.ok(suppressing.length >= 3, `${surface.relative}: the library union lost its unsettled states`);

    assert.match(surface.text, /const filteredTrainings = libraryState === "ready" \? trainings\.filter/);
    assert.match(surface.text, /const filteredFixtures = libraryState === "fixture"[\s\S]*?\? knowledgePages\.filter/);
    assert.match(surface.text, /libraryState === "ready" && filteredTrainings\.length > 0/);
    assert.match(surface.text, /libraryState === "fixture" \? <><Notice>/);

    const countStart = surface.text.indexOf("const publishedCount =");
    const countEnd = surface.text.indexOf(";", countStart);
    const counter = surface.text.slice(countStart, countEnd);
    assert.match(counter, /libraryState === "ready"/);
    assert.match(counter, /libraryState === "fixture"/);
    assert.match(counter, /: null/);
    assert.equal(suppressing.some((state) => counter.includes(`libraryState === "${state}"`)), false);
  });

  it("a signed-in administrator never gets the seeded library because a flag is off", () => {
    const surface = moduleContaining("function TrainingsView(", "the admin trainings view");
    const start = surface.text.indexOf("if (!loadedConfig.enabled)");
    const end = surface.text.indexOf("return;", start);
    const branch = surface.text.slice(start, end);
    assert.ok(start >= 0 && end > start, `${surface.relative}: the flag-off answer from /api/trainings/config is no longer handled`);
    assert.ok(
      branch.includes('setLibraryState(durableWorkspace ? "not-enabled" : "fixture")'),
      `${surface.relative}: FEATURE_ANCILLARY being off still attributes the six seeded trainings to the platform for whoever is signed in: ${branch.trim()}`,
    );
    // And the view has to be handed that answer, not guess at it.
    assert.match(
      surface.text,
      /<TrainingsView durableWorkspace=\{durableWorkspace\} \/>/,
      `${surface.relative}: the trainings view is no longer told whether this is a real session`,
    );
  });
});

describe("the operator trainings library needs the fixture shell to be a fixture", () => {
  it("the local-edit mode is a session question, not a flag question", () => {
    const surface = moduleContaining("const trainingsLocalFixture =", "the operator surface");
    assert.match(
      surface.text,
      /const trainingsLocalFixture = !durableWorkspace;/,
      `${surface.relative}: the local trainings mode stopped asking whether this is a durable workspace`,
    );
    // Every write path and the row list must consult it alongside the flag.
    const flagOnlyUses = surface.text
      .split("\n")
      .filter((line) => /ancillaryConfigState [!=]== "disabled"/.test(line))
      .filter((line) => !line.includes("trainingsLocalFixture"));
    assert.deepEqual(
      flagOnlyUses.map((line) => line.trim()),
      [],
      `${surface.relative}: a trainings path still treats the ancillary flag being off as licence to run the fixture`,
    );
  });

  it("the seeded lessons are not the durable workspace's starting library", () => {
    const surface = moduleContaining("const trainingsLocalFixture =", "the operator surface");
    const seed = /useState<TrainingRow\[\]>\(\(\) =>\s*\n\s*(.+)$/m.exec(surface.text);
    assert.ok(seed, `${surface.relative}: the trainings list no longer has a lazy initial value`);
    assert.ok(
      seed[1].includes("durableWorkspace ? []"),
      `${surface.relative}: a signed-in operator's library still starts as the illustrative set: ${seed[1].trim()}`,
    );
  });
});
