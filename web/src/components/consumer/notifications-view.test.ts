import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { TYPE_META } from "./notifications/view-model.ts";
import type { NotificationEventType } from "./notifications/types.ts";
import type { NotificationIconName } from "./notifications/view-model.ts";

/**
 * The view itself is `.tsx`, and this suite runs on Node's native type stripping, which does not
 * compile JSX — so these are source assertions rather than rendered ones. Every assertion below is
 * therefore derived from a module the component actually imports (the type-metadata map, the
 * client's exported functions) rather than transcribed from the component: an event type added to
 * the contract, or a state removed from the read path, fails here instead of quietly rendering.
 *
 * Real behaviour coverage lives in `notifications/view-model.test.ts` and
 * `notifications/client.test.ts`, which exercise the functions this file only wires together.
 */
const view = readFileSync(new URL("./notifications-view.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("./notifications/client.ts", import.meta.url), "utf8");

describe("the notifications view renders every event type", () => {
  it("maps every icon name the metadata offers to a component, with no spare entries", () => {
    // Derived: the keys of the ICONS record in the component are compared against the icon names
    // the metadata actually emits. A ninth type with a new icon name fails here rather than
    // rendering `undefined` as a React element.
    const block = /const ICONS: Readonly<Record<NotificationIconName, typeof Activity>> = \{([\s\S]*?)\n\};/.exec(view);
    assert.ok(block, "the icon map is no longer a named record");
    const mapped = new Set<string>(
      [...block[1].matchAll(/^\s*"?([a-z-]+)"?:/gm)].map((match) => match[1]),
    );
    const needed = new Set(Object.values(TYPE_META).map((meta) => meta.icon));
    for (const name of needed) assert.ok(mapped.has(name as string), `no component for icon "${name}"`);
    for (const name of mapped) assert.ok(needed.has(name as NotificationIconName), `ICONS carries "${name}", which no type uses`);
  });

  it("reads the row label, destination and icon from the metadata rather than from a second list", () => {
    for (const key of ["TYPE_META[row.event.type]", "TYPE_META[row.type]", "TYPE_META[child.type]"]) {
      assert.ok(view.includes(key), `${key} is gone; the row is deriving its own labels again`);
    }
    for (const type of Object.keys(TYPE_META) as NotificationEventType[]) {
      assert.ok(
        !new RegExp(`case "${type}"`).test(view),
        `the view switches on "${type}" instead of reading the metadata map`,
      );
    }
  });
});

describe("the notifications view distinguishes its states", () => {
  it("renders a distinct branch for absent, loading, error and ready", () => {
    // The G-HOST-14 class: an outage rendered as a healthy zero-notification page. Each of these
    // is a separate early return with its own copy.
    for (const branch of ['state.status === "absent"', 'state.status === "loading"', 'state.status === "error"']) {
      assert.ok(view.includes(branch), `the ${branch} branch is gone`);
    }
    assert.ok(view.includes("Your notifications could not be loaded"), "the failed read lost its own screen");
    assert.ok(view.includes("No notifications yet"), "the teaching empty state is gone");
    assert.ok(view.includes("Retry"), "the error state has no way to try again");
    assert.ok(view.includes("onClick={retry}"), "the Retry control is not wired to anything");
  });

  it("separates never-had from cleared-out, and keeps the chips in the cleared-out state", () => {
    const emptyFilter = view.slice(view.indexOf("if (visible.length === 0)"));
    assert.ok(emptyFilter.includes("chipRow"), "the empty-filter state drops the chips");
    assert.ok(emptyFilter.includes("Show all notifications"), "the empty-filter state has no way back to All");
    assert.ok(
      !emptyFilter.includes("No notifications yet"),
      "an empty filter renders the teaching copy, so a filtered view reads as an empty account",
    );
  });

  it("previews only event types the read path can produce", () => {
    // The mockup's teaching copy said the team would request a document. Nothing in the contract
    // produces that event, and a previewed notification with no source behind it is a dead
    // promise. §9 turned the sentence into three rows, so the rule is enforced where the rows are
    // built: the view renders whatever `emptyStatePreview` returns from the read's own `sources`,
    // and never a literal list of its own.
    const teaching = view.slice(view.indexOf("if (events.length === 0)"), view.indexOf('title="No notifications yet"'));
    assert.ok(teaching.length > 0, "the teaching state is gone");
    assert.ok(
      teaching.includes("emptyStatePreview(state.sources ?? [])"),
      "the empty state builds its preview from something other than the sources the read reported",
    );
    assert.doesNotMatch(teaching, /\brequest/i, "the empty state previews a request event that has no source");
    // Every label and sub-line comes off the row object, so the view cannot write copy for a class
    // the model did not hand it.
    for (const literal of [/"Analysis complete"/, /"Document received"/, /"Message from your team"/]) {
      assert.doesNotMatch(teaching, literal, "the view hard-codes a preview label instead of rendering the model's");
    }
    assert.ok(teaching.includes("{row.label}") && teaching.includes("{row.when}"), "the preview rows stopped rendering the model's own text");
  });

  it("puts the retention line under the action, and the disclosure at the head of the list", () => {
    // §9: one disclosure line, at the top of the card, wherever there are events -- it used to be
    // a banner above the card AND a footer under 200 rows, which is the same fact twice with the
    // half a capped consumer needs most below the fold.
    assert.ok(view.includes("footnote={`Kept for ${windowDays} days.`}"), "the empty state lost its retention footnote");
    assert.ok(view.includes("<Section>\n        {disclosure}"), "the disclosure is not the first thing in the list card");
    assert.equal(view.split("Showing the last").length - 1, 1, "the retention statement is written in more than one place");
    assert.ok(!view.includes("capNote"), "the separate cap banner is still being rendered");
  });

  it("mounts persisted notification preferences only when the durable workspace enables them", () => {
    assert.match(view, /ConsumerNotificationPreferences/);
    assert.match(view, /enabled=\{preferencesEnabled\}/);
    assert.match(view, /onSaved=\{onPreferencesSaved\}/);
    assert.match(view, /onPreferencesSaved: \(preferences: ConsumerNotificationPreferenceList\) => void/);
    assert.match(view, /preferencesEnabled: boolean/);
  });
});

describe("the notifications view is reachable and honest about its writes", () => {
  it("disables Mark all read at zero unread rather than hiding it once the account has events", () => {
    // R1: the control is `aria-disabled`, never `disabled`, so it keeps its tab stop and can still
    // be reached and read; the state it is in lives in the accessible name rather than in a
    // greyed-out box a screen reader would skip past.
    assert.ok(view.includes("aria-disabled={markAllInert}"), "the bulk control lost its aria-disabled rule");
    assert.ok(
      view.includes("const markAllInert = unreadCount === 0 || markingAll"),
      "the inert rule no longer covers both nothing-to-mark and a write already in flight",
    );
    assert.doesNotMatch(
      view.slice(view.indexOf("aria-disabled={markAllInert}") - 400, view.indexOf("Mark all read</span>")),
      /\sdisabled=/,
      "the bulk control took the native disabled attribute back and left the tab order",
    );
    for (const name of ["Mark all read, nothing unread", "`Mark all read, ${unreadCount} unread`"]) {
      assert.ok(view.includes(name), `the bulk control's accessible name no longer states: ${name}`);
    }
    assert.ok(
      view.includes('const showMarkAll = state.status === "ready" && events.length > 0'),
      "the bulk control is rendered while loading or after a failure, where it would have nothing to act on",
    );
  });

  it("starts the list at the same y in every state, so the read landing never moves the first row", () => {
    // R2 B7 / R3 C3. The offset is a rendered-pixel fact and this suite cannot mount JSX, so the
    // assertion is made at the class the pixels come from: there is exactly one declaration of the
    // chip strip's box, and every site that reserves or fills that box reads it rather than
    // writing its own height. Derived from the source, not transcribed from a measurement -- a
    // fourth render site, or a hard-coded height at any of them, fails here.
    const declaration = /^const CHIP_STRIP_BOX = "([^"]+)";$/m.exec(view);
    assert.ok(declaration, "the chip strip's box no longer has a single declaration to align against");
    const box = declaration[1];
    assert.match(box, /\bh-\[\d+px\]/, "the reserved box has no height, so it reserves nothing");

    const sites = view.split("CHIP_STRIP_BOX").length - 1;
    assert.ok(sites >= 4, `only ${sites - 1} render sites read the shared box; one of them is guessing its own height`);

    // The three consumers, named: the skeleton's strip, the real strip, and the placeholder that
    // stands in when B26 says there is nothing to filter.
    assert.ok(
      view.includes('<div aria-hidden className={cn("flex gap-2 overflow-hidden pb-1.5", CHIP_STRIP_BOX)}>'),
      "the loading skeleton stopped reserving the chip strip",
    );
    assert.ok(
      view.includes('<div className={cn("relative", CHIP_STRIP_BOX)}>'),
      "the real chip strip stopped using the shared box",
    );
    assert.ok(
      view.includes("<div aria-hidden className={CHIP_STRIP_BOX} />"),
      "a feed with too few events to filter drops the box, so its one row rides up when the read lands",
    );

    // And no site re-states the height beside the shared one.
    const strays = [...view.matchAll(/h-\[\d+px\][^"]*"\s*\/>/g)].filter((match) => !match[0].includes("CHIP_STRIP_BOX"));
    assert.equal(strays.length, 0, `a spacer hard-codes its own height instead of the shared box: ${strays.map((m) => m[0]).join(", ")}`);
  });

  it("runs the bundle's children the full width of the row above them", () => {
    // Ayman, on the desktop capture: the children were a narrow block floating inside a full-width
    // row, which reads as a rendering fault. Two edges now, deliberately different -- the child's
    // BOX is edge to edge so its tint matches the header's, and its CONTENT sits between the
    // parent title's x and the row's right padding edge. Both numbers are DERIVED from the parent
    // row's own grid class rather than transcribed, so changing the row's padding or its gutter
    // columns fails here instead of silently sliding the children out of alignment.
    const grid = /grid-cols-\[(\d+)px_(\d+)px_minmax\(0,1fr\)\][^"]*?gap-x-(\d+(?:\.\d+)?)[^"]*?\spx-(\d+)/.exec(view);
    assert.ok(grid, "the row's grid no longer states its gutter columns, gap and padding in one class");
    const rem = (step: string) => Number(step) * 4;
    const [, dot, glyph, gap, pad] = grid;
    const titleX = rem(pad) + Number(dot) + rem(gap) + Number(glyph) + rem(gap);

    // The list itself reserves nothing horizontally: padding on it would inset the tint.
    const list = /<ul className="list-none pb-[\d.]+ lg:pb-[\d.]+">/.exec(view);
    assert.ok(list, "the children list took horizontal padding back, which insets every child's tint");
    assert.ok(!view.includes("max-w-[46rem]"), "the children block is capped to a width narrower than its row");

    // The padding lives on the child, so the box is full-bleed and the content is inset.
    const child = view.slice(view.indexOf("row.children.map"), view.indexOf("</button>", view.indexOf("row.children.map")));
    const box = /"block w-full pl-\[(\d+)px\] pr-(\d+) text-left lg:pl-\[(\d+)px\] lg:pr-(\d+)"/.exec(child);
    assert.ok(box, "the child no longer carries the row's padding, so its content is not aligned to the row");
    assert.equal(Number(box[1]), titleX, `the child's content starts at ${box[1]}px but the row's title starts at ${titleX}px`);
    assert.equal(box[2], pad, "the child's content stops short of the row's right padding edge");
    assert.equal(box[4], "5", "the child's content stops short of the row's right padding edge at lg");

    // The hairline is drawn by the inner content box, so it stops where the text does rather than
    // running the full bleed under the tint.
    assert.ok(
      /data-child-line/.test(child) && /border-t border-dashed[^"]*"\s*\n\s*data-child-line/.test(child),
      "the hairline moved off the content box and now runs under the tint",
    );
    assert.ok(
      view.includes('"[&:first-child_[data-child-line]]:border-t-0"'),
      "the first child draws a hairline against the row above it",
    );

    // Each child paints its own tint, and the wrapper paints none -- a tint on the wrapper is what
    // used to paint over children that had already been read.
    assert.match(
      child,
      /childUnread\s*\n?\s*\?\s*"bg-\[var\(--consumer-accent-tint\)\]/,
      "an unread child no longer tints itself",
    );
    assert.doesNotMatch(
      view.slice(view.indexOf("const meta = TYPE_META[row.type];"), view.indexOf("row.children.map")),
      /row\.unread && "bg-/,
      "the bundle wrapper is tinting again, which paints over its read children",
    );
  });

  it("marks read optimistically and takes the tint back when the write fails", () => {
    assert.match(view, /next\.delete\(event\.id\)/, "a failed PATCH leaves the row looking read");
    assert.match(view, /for \(const key of keys\) next\.delete\(key\)/, "a failed mark-all leaves every row looking read");
  });

  it("uses only the client's exported write paths, never a hand-rolled fetch", () => {
    assert.doesNotMatch(view, /fetch\(/, "the view is talking to the network directly");
    for (const exported of ["fetchNotifications", "markRead", "markAllRead"]) {
      assert.match(client, new RegExp(`export async function ${exported}\\b`), `${exported} is no longer exported`);
    }
  });

  it("keeps every row and child at the 44px touch floor, and every control keyboard reachable", () => {
    assert.ok(view.includes("min-h-11"), "a control dropped below the 44px touch minimum");
    // R2 B11: the chips are a radiogroup with a roving tab index, so the whole strip is one tab
    // stop and the arrows move within it -- not eight stops between the header and the first row.
    assert.ok(
      view.includes('role="radiogroup"') && view.includes('role="radio"'),
      "the chips lost their radiogroup semantics",
    );
    assert.ok(view.includes("aria-checked={active}"), "a chip no longer reports whether it is the chosen filter");
    for (const tabRole of ['role="tablist"', 'role="tab"', 'role="tabpanel"']) {
      assert.ok(!view.includes(tabRole), `the chips went back to tab semantics: ${tabRole}`);
    }
    // R2 B12: the feed is a real list, so a screen reader counts the notifications before reading
    // them and a bundle's children are a list nested inside their row.
    assert.ok(view.includes("<ul className=") && view.includes("<li"), "the feed is no longer a real list");
    assert.ok(view.includes("ArrowRight") && view.includes("ArrowLeft"), "the chips are not arrow-key reachable");
    assert.ok(view.includes("tabIndex={active ? 0 : -1}"), "the chip strip does not use a roving tab index");
    assert.ok(view.includes("focus-visible:ring-2"), "the focus ring is gone");
  });

  it("animates only through the build's motion tokens, and yields to prefers-reduced-motion", () => {
    assert.doesNotMatch(view, /duration-\[\d+ms\]/, "an ad-hoc duration was written instead of a token");
    assert.match(view, /duration-\[var\(--duration-medium\)\]/);
    assert.match(view, /ease-\[var\(--ease-smooth-out\)\]/);
    assert.ok(view.includes("motion-reduce:transition-none"), "the row transitions ignore reduced motion");
    // Derived per occurrence rather than "the string appears somewhere": every looping animation
    // has to carry its own opt-out, so adding a sixth skeleton bar without one fails here.
    const pulses = view.match(/animate-pulse/g) ?? [];
    const opted = view.match(/animate-pulse[^"]*motion-reduce:animate-none/g) ?? [];
    assert.ok(pulses.length > 0, "the loading skeleton no longer animates at all");
    assert.equal(opted.length, pulses.length, "a looping animation does not yield to reduced motion");
  });
});
