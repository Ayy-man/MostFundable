import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { toEmbedUrl } from "@/lib/ancillary/video-embed";
import { stripComments } from "@/lib/testing/strip-comments";
import { TRACKER_STAGES, TRACKER_STAGE_LABELS } from "@/lib/tracker/types";

/**
 * The Trainings view may render only what the platform holds.
 *
 * A `trainings` row is a title, a body and a video URL. There is no duration column, no
 * category column, no ordering and no per-consumer progress anywhere in the schema, so
 * every guard below derives its premise at test time (from the route tree, from
 * `TRACKER_STAGES`, from the surface's own `ViewId` union) and only then asserts what the
 * view must do about it. Add a lesson-progress route and the first guard fails, which is
 * the point: it tells whoever shipped it that this view is now theirs to wire, instead of
 * silently keeping a panel hidden that could have been filled.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../..");

const viewPath = path.join(HERE, "trainings-view.tsx");
const rawView = fs.readFileSync(viewPath, "utf8");
/** Comments removed: every scan is a claim about what the view renders, not about its prose. */
const view = stripComments(rawView);
const consumer = stripComments(
  fs.readFileSync(path.join(WEB, "src/components/surfaces/consumer.tsx"), "utf8"),
);

/**
 * The view with its `className` values removed.
 *
 * The copy guards below look for words the page must not print, and a Tailwind class list
 * is full of words that read like copy: `min-w-0` contains " min", `w-1/3` contains "%"
 * once the arbitrary-value brackets are counted. Scanning the class attributes would fail
 * those guards on styling that renders no text at all, so they are taken out first and the
 * guards read what is left, which is what a person sees.
 */
const copy = withoutClassNames(view);

function withoutClassNames(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const at = source.indexOf("className=", index);
    if (at === -1) {
      out += source.slice(index);
      break;
    }
    out += source.slice(index, at);
    let cursor = at + "className=".length;
    if (source[cursor] === '"') {
      cursor = source.indexOf('"', cursor + 1) + 1;
    } else if (source[cursor] === "{") {
      let depth = 0;
      do {
        if (source[cursor] === "{") depth += 1;
        else if (source[cursor] === "}") depth -= 1;
        cursor += 1;
      } while (depth > 0 && cursor < source.length);
    }
    index = cursor;
  }
  return out;
}

/** Every file under `src/app/api`, so a guard can ask what read paths exist. */
function apiTree(): string[] {
  return (fs.readdirSync(path.join(WEB, "src/app/api"), { recursive: true }) as string[]).map(String);
}

/** The consumer surface's own view union, parsed rather than transcribed. */
function viewIds(): string[] {
  const start = consumer.indexOf("type ViewId =");
  assert.notEqual(start, -1, "the consumer surface no longer declares ViewId; this guard lost its catalog");
  const end = consumer.indexOf(";", start);
  return [...consumer.slice(start, end).matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
}

describe("Trainings invents no lesson metadata", () => {
  it("claims no progress the platform records nowhere", () => {
    // Premise, derived: no route under src/app/api reads or writes lesson progress, so
    // any percentage, any "N of M", any completion count on this page is fabricated.
    const progressRoutes = apiTree().filter((file) => file.toLowerCase().includes("progress"));
    assert.deepEqual(
      progressRoutes,
      [],
      "a lesson-progress route landed; Trainings should read it rather than stay silent",
    );

    for (const claim of ["%", "of 7", "Course progress", "Recommended next", "lessons completed"]) {
      assert.equal(
        copy.includes(claim),
        false,
        `the Trainings view renders ${JSON.stringify(claim)} over a platform that records no lesson progress`,
      );
    }
  });

  it("draws no facet the trainings table has no column for", () => {
    // Premise, derived: the read path's row shape is the repository's `Training`
    // interface. Anything the view prints as a lesson facet has to be one of those fields.
    const repository = stripComments(
      fs.readFileSync(path.join(WEB, "src/lib/ancillary/repository.ts"), "utf8"),
    );
    const start = repository.indexOf("export interface Training {");
    assert.notEqual(start, -1, "the Training row interface moved; this guard lost its premise");
    const fields = [
      ...repository
        .slice(start, repository.indexOf("}", start))
        .matchAll(/^\s*([a-zA-Z]+)[?]?:/gm),
    ].map((match) => match[1]);
    for (const absent of ["duration", "category", "topic", "minutes", "stage", "position"]) {
      assert.equal(
        fields.includes(absent),
        false,
        `Training now carries ${absent}; the view may render it, and this guard should say so`,
      );
    }

    for (const invented of ["Video lesson", "Plan fundamentals", '"Training"', " min", "not recorded"]) {
      assert.equal(
        copy.includes(invented),
        false,
        `the Trainings view prints ${JSON.stringify(invented)}, which describes no column on a training row`,
      );
    }
  });

  it("counts lessons only when there are lessons to count", () => {
    assert.match(
      view,
      /trailing=\{\s*showRows \?/,
      "the lesson count pill is no longer gated on there being rows, so an empty list can render a count",
    );
    assert.match(
      view,
      /const showRows =[^;]*lessons\.length > 0/,
      "showRows no longer requires a non-empty list",
    );
  });
});

describe("Trainings navigates rather than linking out of the product", () => {
  it("sends every in-product destination through the navigator", () => {
    const targets = [...view.matchAll(/navigate\("([a-z]+)"\)/g)].map((match) => match[1]);
    assert.ok(targets.length > 0, "nothing on the Trainings view navigates; this guard has no subject");

    const ids = viewIds();
    assert.ok(ids.length > 0, "the ViewId union parsed empty; this guard proves nothing");
    for (const target of targets) {
      assert.ok(
        ids.includes(target),
        `Trainings navigates to ${JSON.stringify(target)}, which is not a consumer view`,
      );
    }
  });

  it("uses href only for the two destinations that leave the product", () => {
    const hrefs = [...view.matchAll(/href=\{([^}]+)\}|href="([^"]*)"/g)].map(
      (match) => match[1] ?? match[2],
    );
    assert.deepEqual(
      [...new Set(hrefs)].sort(),
      ["lesson.videoUrl", "platformTrainingsUrl"],
      "an href on the Trainings view points somewhere other than the lesson video or the platform library",
    );
    assert.equal(
      (view.match(/target="_blank"/g) ?? []).length,
      hrefs.length,
      "an external link on the Trainings view does not open in a new tab",
    );
    assert.equal(
      (view.match(/rel="noreferrer"/g) ?? []).length,
      hrefs.length,
      "an external link on the Trainings view does not carry rel=noreferrer",
    );
  });
});

describe("Trainings frames only a video host the product already accepts", () => {
  it("takes the iframe source from the embed helper, never from the row", () => {
    assert.match(view, /const embedUrl = toEmbedUrl\(lesson\.videoUrl\)/, "the reader no longer maps the video URL through toEmbedUrl");
    assert.match(view, /src=\{embedUrl\}/, "the iframe source is no longer the mapped embed URL");
    assert.equal(
      view.includes("src={lesson.videoUrl}"),
      false,
      "the reader frames the raw row URL, so an operator can frame any page they type",
    );
    for (const attribute of ['loading="lazy"', 'allow="fullscreen"', 'referrerPolicy="no-referrer"', "sandbox="]) {
      assert.ok(view.includes(attribute), `the lesson iframe dropped ${attribute}`);
    }
  });

  it("maps the three known hosts and refuses the rest", () => {
    assert.equal(toEmbedUrl("https://www.loom.com/share/abc123"), "https://www.loom.com/embed/abc123");
    assert.equal(
      toEmbedUrl("https://www.youtube.com/watch?v=abc123"),
      "https://www.youtube-nocookie.com/embed/abc123",
    );
    assert.equal(toEmbedUrl("https://youtu.be/abc123"), "https://www.youtube-nocookie.com/embed/abc123");
    assert.equal(toEmbedUrl("https://vimeo.com/76979871"), "https://player.vimeo.com/video/76979871");
    assert.equal(toEmbedUrl("https://example.com/watch?v=abc123"), null);
    assert.equal(toEmbedUrl("http://www.loom.com/share/abc123"), null);
    assert.equal(toEmbedUrl(null), null);
  });
});

describe("the stage guide is the tracker taxonomy, not a list of its own", () => {
  it("carries one blurb and one destination for every stage the platform has", () => {
    // Premise, derived: `TRACKER_STAGES` is the one stage taxonomy. The guide is read
    // against that catalog at test time, so adding a stage fails here rather than
    // rendering a stage with no copy.
    assert.ok(TRACKER_STAGES.length > 0, "the stage catalog is empty; this guard proves nothing");
    const start = view.indexOf("const STAGE_GUIDE");
    assert.notEqual(start, -1, "STAGE_GUIDE is gone; the stage guide moved without this guard");
    const guide = view.slice(start, view.indexOf("\nconst VISIBLE_BEFORE_EXPAND", start));

    const keys = [...guide.matchAll(/^ {2}([a-z]+): \{$/gm)].map((match) => match[1]);
    assert.deepEqual(
      [...keys].sort(),
      [...TRACKER_STAGES].sort(),
      "STAGE_GUIDE and TRACKER_STAGES disagree about which stages exist",
    );

    const ids = viewIds();
    for (const stage of TRACKER_STAGES) {
      const at = guide.indexOf(`  ${stage}: {`);
      const entry = guide.slice(at, guide.indexOf("\n  },", at));
      const blurb = /blurb: "([^"]+)"/.exec(entry);
      const target = /target: "([a-z]+)"/.exec(entry);
      const label = /label: "([^"]+)"/.exec(entry);
      assert.ok(blurb && blurb[1].length > 40, `the ${stage} stage carries no blurb`);
      assert.ok(label && label[1].length > 0, `the ${stage} stage names no destination`);
      assert.ok(target && ids.includes(target[1]), `the ${stage} stage links to a view that does not exist`);
    }
  });

  it("labels the stages from the shared label map", () => {
    assert.match(
      view,
      /TRACKER_STAGE_LABELS\[entry\]/,
      "the stage guide prints its own stage names instead of the shared labels",
    );
    for (const label of Object.values(TRACKER_STAGE_LABELS)) {
      assert.equal(
        view.includes(`>${label}<`),
        false,
        `the stage guide hardcodes the stage label ${JSON.stringify(label)}`,
      );
    }
  });
});

describe("Trainings copy passes the house rules", () => {
  it("uses no em dash anywhere in the file, comments included", () => {
    assert.equal(rawView.includes("—"), false, "the Trainings view contains an em dash");
  });
});
