import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CONSENT_DOCUMENTS } from "@/lib/enrollment/consent-texts";
import { TRACKER_STAGE_LABELS } from "@/lib/tracker/types";

import { stripComments } from "@/lib/testing/strip-comments";

/**
 * The consumer surface must state nothing about the reader's own account that
 * it did not read.
 *
 * The walk that motivated this signed in as the durable consumer and found, on
 * four different views, a fixture person's record presented as theirs: an
 * Agreement record opening on "Funding Readiness Service Agreement · Signed Jun
 * 24 · Approved" with no source anywhere and two grants tagged Active over an
 * enrollment that carried neither; an Optimization plan listing ten checklist
 * factors and four revolving tradelines belonging to Maya Okafor; a Your Funding
 * page reporting a confident $0 that came from never reading; and a Trainings
 * page claiming the reader had completed 3 of 7 lessons. Every one is the
 * G-HOST-14 class — a fixture standing where a missing read should have shown
 * an absence.
 *
 * Round-5 standard: each guard derives its premise at test time — from
 * `CONSENT_DOCUMENTS`, from `TRACKER_STAGE_LABELS`, from the surface's own
 * fixture constants — rather than transcribing the reproduction. If a durable
 * read for one of these panels ever lands, the matching premise disappears and
 * the guard fails loudly, which is the point: it tells you which panel is now
 * yours to wire instead of quietly passing over a stale enumeration.
 *
 * Watched failing on the pre-fix tree (2b7c179^). Failure texts are recorded
 * beside each assertion group in the lane report.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../..");

/**
 * Comments are prose, not rendered output.
 *
 * Every guard below scans for a claim a consumer could read, so a comment that
 * quotes the defect it fixes must not count as the defect — the same
 * comment-prose taint that already bites the operator dashboard guard. Block
 * comments, JSX comments and whole-line `//` comments go; a `//` inside a string
 * (a URL) is left alone by only stripping lines that open with one.
 */
const withoutComments = stripComments;

const consumer = withoutComments(
  fs.readFileSync(path.join(HERE, "consumer.tsx"), "utf8"),
);
const consumerKit = fs.readFileSync(
  path.join(WEB, "src/components/consumer/consumer-kit.tsx"),
  "utf8",
);

/** The body of a top-level `function Name(` declaration in consumer.tsx. */
function region(name: string): string {
  const start = consumer.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is gone from consumer.tsx; this guard moved without its subject`);
  const end = consumer.indexOf("\nfunction ", start + 1);
  assert.ok(end > start, `${name} has no following declaration to bound it`);
  return consumer.slice(start, end);
}

/**
 * Every string literal a module-level fixture array would leak, derived from the
 * surface's own source rather than listed here.
 *
 * `factors`, `accounts` and `planActions` are the three constants the
 * Optimization view rendered from. Parsing their `label:` / `account:` / `title:`
 * entries means renaming a fixture renames what this looks for.
 */
function optimizationFixtureStrings(): string[] {
  const strings: string[] = [];
  for (const constant of ["factors", "accounts", "planActions"]) {
    const start = consumer.indexOf(`const ${constant} = [`);
    assert.notEqual(start, -1, `the ${constant} fixture constant is gone; this guard has no subject`);
    const end = consumer.indexOf("\n];", start);
    assert.ok(end > start, `the ${constant} fixture constant is unterminated`);
    const body = consumer.slice(start, end);
    for (const match of body.matchAll(/(?:label|account|title):\s*"([^"]+)"/g)) {
      strings.push(match[1]);
    }
  }
  assert.ok(
    strings.length >= 10,
    `only ${strings.length} fixture strings were derived; the parse broke and this guard proves nothing`,
  );
  return strings;
}

describe("consumer agreements render the enrollment record, never a fixture", () => {
  const hub = region("OnboardingHubView");

  it("treats an absent consent row as absent, not as a grant", () => {
    // Premise, derived: `monitoringActive` and `analysisActive` are ConsumerApp
    // state that opens `true` for the fixture walkthrough's revoke control. That
    // is what made `?? monitoringActive` hand a grant to every consumer who had
    // never enrolled. If either default ever flips, this premise is gone and the
    // assertion below should be re-argued rather than left standing.
    for (const flag of ["monitoringActive", "analysisActive"]) {
      assert.match(
        consumer,
        new RegExp(`const \\[${flag}, set[A-Za-z]+\\] = useState\\(true\\)`),
        `${flag} no longer defaults to true; re-check whether the consent fallback still needs a durable guard`,
      );
    }

    for (const grant of ["monitoringGranted", "analysisGranted"]) {
      const line = hub.split("\n").find((text) => text.includes(`const ${grant} =`));
      assert.ok(line, `${grant} is gone from OnboardingHubView`);
      assert.ok(
        line.includes("durableWorkspace"),
        `${grant} still falls back to the fixture toggle, so a consumer with no consent row reads as authorized`,
      );
    }
  });

  it("takes the monitoring signature from the record, not from a default-on flag", () => {
    // Premise, derived: nothing outside this component knows about `termsSigned`
    // — it is not a projected field — so it can only ever describe the fixture
    // walkthrough's own progress.
    const projection = fs.readFileSync(path.join(WEB, "src/lib/enrollment/types.ts"), "utf8");
    assert.equal(
      projection.includes("termsSigned"),
      false,
      "termsSigned became a projected field; the surface should read it rather than guess",
    );
    assert.match(
      consumer,
      /const \[termsSigned, setTermsSigned\] = useState\(!durableWorkspace\)/,
      "termsSigned opens true on a durable workspace again, which prints a signature date nothing recorded",
    );
  });

  it("names every document from the catalog, and dates it from the record", () => {
    // Premise, derived: `CONSENT_DOCUMENTS` is the catalog of documents this
    // enrollment captures, and each has durable evidence — the two named
    // authorizations carry `signedAt` on `EnrollmentView.consents`, and the
    // service agreement is the `agreement_signed` milestone. Anything the rows
    // name outside that catalog is a claim with no record behind it.
    const titles: string[] = Object.values(CONSENT_DOCUMENTS).map((document) => document.title);
    assert.equal(titles.length, 3, `the consent document catalog holds ${titles.length} documents, not three`);

    const start = hub.indexOf("const agreementRows =");
    const end = hub.indexOf("return (", start);
    assert.ok(start !== -1 && end > start, "the agreement row array could not be located");
    const rows = hub.slice(start, end);

    // The rows are objects now because each one carries a download capability.
    // Derive the catalog keys rather than pinning the object layout: every
    // durable name expression must still reference its matching legal document,
    // while any friendly literal is allowed only in that expression's fixture
    // branch.
    const nameExpressions = [...rows.matchAll(/\n\s*name:\s*([\s\S]*?),\n\s*date:/g)]
      .map((match) => match[1]);
    assert.equal(nameExpressions.length, titles.length, "the agreement record no longer has one row per legal document");
    for (const kind of Object.keys(CONSENT_DOCUMENTS) as Array<keyof typeof CONSENT_DOCUMENTS>) {
      const catalogReference = `CONSENT_DOCUMENTS.${kind}.title`;
      const expression = nameExpressions.find((candidate) => candidate.includes(catalogReference));
      assert.ok(expression, `${catalogReference} is not the durable name of an agreement row`);
      const literals = [...expression.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      if (literals.length) {
        assert.match(
          expression,
          /durableWorkspace/,
          `${catalogReference} has a literal fallback that is not confined to the fixture branch`,
        );
      }
    }

    // Each date reads its own immutable evidence. A catalog title without its
    // matching signature timestamp would still be a fabricated agreement row.
    assert.match(
      hub,
      /agreement_signed"\)\?\.completedAt/,
      "the service-agreement row no longer reads the agreement_signed milestone's own timestamp",
    );
    assert.match(rows, /analysisConsent\?\.signedAt/);
    assert.match(rows, /monitoringConsent\?\.signedAt/);
  });

  it("hands a durable consumer no fabricated download", () => {
    // Premise, derived: the helper writes its own file body rather than fetching
    // one, so what it produces is a record the product made up.
    const helper = hub.slice(hub.indexOf("function downloadDemoDocument"));
    assert.match(
      helper.slice(0, 400),
      /new Blob\(\[content\]/,
      "downloadDemoDocument no longer synthesizes its payload; re-check whether it still needs blocking",
    );

    const rowsStart = hub.indexOf("const agreementRows =");
    const rowsEnd = hub.indexOf("return (", rowsStart);
    assert.ok(rowsStart !== -1 && rowsEnd > rowsStart, "the agreement download capabilities could not be located");
    const rows = hub.slice(rowsStart, rowsEnd);
    assert.equal(
      [...rows.matchAll(/download: durableWorkspace \? "unavailable" : "demo"/g)].length,
      2,
      "analysis and monitoring demo downloads are no longer explicitly fixture-only",
    );
    const serviceAgreementRow = rows.slice(0, rows.indexOf("download: durableWorkspace"));
    assert.doesNotMatch(
      serviceAgreementRow,
      /"demo"|downloadDemoDocument/,
      "the service agreement substitutes a demo download when signed metadata is absent",
    );

    const vaultSite = hub.indexOf("else downloadDemoDocument(name)");
    assert.notEqual(vaultSite, -1, "the document-vault download branch could not be located");
    const vaultButton = hub.slice(hub.lastIndexOf("<Button", vaultSite), vaultSite);
    assert.match(
      vaultButton,
      /disabled=\{durableWorkspace/,
      "the document-vault demo download is not disabled for durable consumers",
    );
    assert.match(
      hub,
      /download === "demo" \? \([\s\S]{0,300}downloadDemoDocument\(name\)/,
      "the agreement demo helper is callable outside its fixture-only capability branch",
    );
  });
});

describe("Optimization lists nothing it cannot read", () => {
  const optimization = region("OptimizationView");

  it("keeps every fixture tradeline and checklist factor out of the durable arm", () => {
    // Premise, derived: `public.checklist_item_state` has no consumer-side read,
    // and the analysis pipeline sends no account rows to this surface — so the
    // constants below are the only source these two sections ever had.
    const routes = path.join(WEB, "src/app/api");
    const routeFiles = fs.readdirSync(routes, { recursive: true }) as string[];
    assert.equal(
      routeFiles.some((file) => String(file).includes("checklist")),
      false,
      "a checklist route landed; Optimization should read it rather than state an absence",
    );

    for (const arm of ["CinderellaChecklist", "accounts.map"]) {
      const at = optimization.indexOf(arm);
      assert.notEqual(at, -1, `${arm} is gone from OptimizationView`);
      assert.match(
        optimization.slice(0, at),
        /durableWorkspace \? \(/,
        `${arm} renders with no durable guard ahead of it`,
      );
    }

    // Whatever the guards look like, no fixture string may survive into the arm
    // a signed-in consumer sees.
    for (const guard of [...optimization.matchAll(/durableWorkspace \? \(/g)]) {
      const armEnd = optimization.indexOf(") : (", guard.index);
      assert.ok(armEnd > guard.index, "a durable guard has no fixture fallback after it");
      const durableArm = optimization.slice(guard.index, armEnd);
      for (const fixture of optimizationFixtureStrings()) {
        assert.equal(
          durableArm.includes(fixture),
          false,
          `the durable Optimization arm carries the fixture string ${JSON.stringify(fixture)}`,
        );
      }
    }
  });
});

describe("Your Funding uses the durable application projection", () => {
  const plan = region("FundingPlanView");

  it("derives all three durable metrics and keeps an unavailable read explicit", () => {
    assert.match(plan, /consumerApplications\.status === "ready"/);
    assert.match(plan, /durableFunding\.status === "ready"/);
    assert.match(plan, /One or more approved amounts are private/);
    assert.match(plan, /durableApplications === null \? "—"/);
    assert.match(plan, /durablePending \?\? "—"/);
    assert.match(plan, /Counted approved outcomes/);
    assert.match(plan, /Application records could not be loaded/);
  });

  it("contains no duplicate Current work band or fixture action count", () => {
    assert.doesNotMatch(plan, /title="Current work"/);
    assert.doesNotMatch(plan, /planActions\.length/);
  });
});

describe("the Matches stage tag comes from the stage catalog", () => {
  it("names a stage the platform agrees on, or says it has none", () => {
    // Premise, derived: `TRACKER_STAGE_LABELS` is the one stage taxonomy, and
    // the fixture fallback was one of its values printed unconditionally.
    const labels = Object.values(TRACKER_STAGE_LABELS);
    assert.ok(labels.length > 0, "the stage catalog is empty; this guard proves nothing");

    const matches = region("MatchesView");
    assert.ok(
      matches.includes("TRACKER_STAGE_LABELS[trackerClient.stage]"),
      "the Matches stage tag no longer reads the tracker row's stage",
    );
    assert.equal(
      /const clientStage = selectedClient\?\.stage \?\? "[A-Za-z]+"/.test(matches),
      false,
      "the fixture stage fallback moved into MatchesView",
    );
    for (const label of labels) {
      assert.equal(
        matches.includes(`?? "${label}"`),
        false,
        `MatchesView falls back to the literal stage ${JSON.stringify(label)}`,
      );
    }
  });
});

describe("Trainings hands a durable row straight to its own view", () => {
  const trainingsView = stripComments(
    fs.readFileSync(path.join(WEB, "src/components/consumer/trainings-view.tsx"), "utf8"),
  );

  it("reads the row it was given instead of looking a title up in a fixture", () => {
    // Premise, derived: the live row carries its own title, body and video, so there is
    // nothing to look up. `LearningView` re-found a title in a module-level fixture array,
    // which is how every durable training opened as the fixture's own fallback lesson.
    // The view now lives in its own file and reads the row directly.
    assert.equal(
      consumer.includes("function LearningView("),
      false,
      "LearningView is back on the surface; the fixture lookup it carried needs re-checking",
    );
    assert.match(
      trainingsView,
      /\{lesson\.body\}/,
      "the lesson reader no longer renders the row's own body",
    );
    assert.match(
      trainingsView,
      /const lessons[^;]*durableWorkspace \? trainings \?\? \[\] : fixtureLessons/,
      "the fixture lessons are no longer fenced behind the fixture shell, so a signed-in consumer can be shown them",
    );
  });

  it("makes no claim about lessons this consumer completed", () => {
    // Premise, derived: no route records lesson progress, so any percentage is invented.
    const routes = fs.readdirSync(path.join(WEB, "src/app/api"), { recursive: true }) as string[];
    assert.equal(
      routeFilesMentioning(routes, "progress"),
      true,
      "a lesson-progress route landed; Trainings should read it rather than say nothing",
    );

    for (const claim of ["42%", "3 of 7 lessons completed", "Course progress", "Recommended next"]) {
      assert.equal(
        trainingsView.includes(claim),
        false,
        `Trainings renders ${JSON.stringify(claim)} to a consumer with nothing recording it`,
      );
      assert.equal(
        consumer.includes(claim),
        false,
        `the consumer surface still carries the Trainings claim ${JSON.stringify(claim)}`,
      );
    }
  });
});

/** True while no route under `src/app/api` mentions the given word. */
function routeFilesMentioning(files: string[], word: string): boolean {
  return !files.some((file) => String(file).toLowerCase().includes(word));
}

describe("no page header carries a fixture date", () => {
  it("passes no dated eyebrow, on a prop the header discards", () => {
    // Premise, derived: #207 froze page headers to title plus actions, so an
    // eyebrow renders nowhere. A literal date sitting in a discarded prop is a
    // wrong date waiting for the header to be unfrozen.
    assert.match(
      consumerKit,
      /void eyebrow;/,
      "ConsumerPageHeader renders the eyebrow again; every eyebrow value now needs its own source check",
    );
    const months = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/;
    for (const match of consumer.matchAll(/eyebrow=(?:"([^"]*)"|\{([^}]*)\})/g)) {
      const value = match[1] ?? match[2] ?? "";
      assert.doesNotMatch(
        value,
        months,
        `a consumer page header carries the dated eyebrow ${JSON.stringify(value)}`,
      );
    }
  });
});

describe("applications describe the write they actually perform", () => {
  it("refuses rather than promising a stored total to a durable consumer", () => {
    const matches = region("MatchesView");
    // Premise, derived: the outcome write goes to the in-memory provider, not to
    // the applications route, so nothing it says about stored totals is true of
    // a durable workspace.
    assert.ok(
      matches.includes("recordApplicationOutcome({"),
      "the outcome control no longer writes the feedback provider; re-check what it now claims",
    );
    assert.equal(
      matches.includes('fetch("/api/applications'),
      false,
      "MatchesView now posts to the applications route; the refusal copy should go with it",
    );

    for (const at of [...matches.matchAll(/historical demo\s*\n?\s*totals/g)]) {
      assert.match(
        matches.slice(Math.max(0, at.index - 200), at.index),
        /durableWorkspace/,
        "a durable consumer is still told their result updates historical demo totals",
      );
    }
  });
});
