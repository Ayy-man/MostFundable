import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import {
  analysisCompleteCopy,
  applicationUpdateCopy,
  documentCopy,
  DOCUMENT_SECTION_LABELS,
  monitoringAlertCopy,
  refreshResultCopy,
  teamMessageCopy,
} from "@/lib/notifications/copy";

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_WINDOW_DAYS,
  type NotificationEventV2,
} from "./consumer-notifications.ts";

function notification(overrides: Partial<NotificationEventV2> = {}): NotificationEventV2 {
  return {
    detail: "Open Credit Monitoring to see what changed on the source record.",
    id: "monitoring_alert:11111111-1111-4111-8111-111111111111",
    occurredAt: "2026-08-24T11:48:00.000Z",
    readAt: null,
    target: "credit",
    title: "A credit source alert is ready",
    type: "monitoring_alert",
    ...overrides,
  };
}

describe("the consumer notifications seam", () => {
  test("re-exports the feed's read and write paths under stable names", async () => {
    assert.equal(typeof fetchNotifications, "function");
    assert.equal(typeof markNotificationRead, "function");
    assert.equal(typeof markAllNotificationsRead, "function");
    assert.equal(NOTIFICATION_WINDOW_DAYS, 90);
  });

  test("a per-item PATCH is validated before it becomes local state", async () => {
    // Carried over from the previous helper: a response that reports the row as still unread must
    // not become the local read marker, or the row looks read here and unread everywhere else.
    const item = notification();
    const malformed = await markNotificationRead(item.id, async () =>
      Response.json({ notification: { ...item, readAt: null } }),
    );
    assert.equal(malformed.ok, false, "an unpersisted read marker must not become local state");

    let calls = 0;
    const persisted = { ...item, readAt: "2026-08-24T12:00:00.000Z" };
    const result = await markNotificationRead(item.id, async (path, init) => {
      calls += 1;
      assert.equal(path, `/api/notifications/${encodeURIComponent(item.id)}`);
      assert.equal(init?.method, "PATCH");
      return Response.json({ notification: persisted });
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, { notification: persisted, ok: true });
  });

  test("mark all is one request whose partial failure is reported, never swallowed", async () => {
    // The old helper fanned out one PATCH per unread row and could half-succeed, which made the
    // badge a function of how many requests survived. The route owns the set now.
    let calls = 0;
    const ok = await markAllNotificationsRead(async (path, init) => {
      calls += 1;
      assert.equal(path, "/api/notifications/read-all");
      assert.equal(init?.method, "POST");
      return Response.json({ unreadCount: 0, updated: 9 });
    });
    assert.equal(calls, 1);
    assert.deepEqual(ok, { ok: true, unreadCount: 0, updated: 9 });

    const failed = await markAllNotificationsRead(async () =>
      Response.json({ error: "write_failed" }, { status: 500 }),
    );
    assert.equal(failed.ok, false);
  });

  test("the list and the shell badge share one lifted set of rows", async () => {
    // Unchanged in substance from the previous suite: the view must not hold its own copy of the
    // rows, because the nav badge counts the same unread events the list draws.
    const source = await readFile(new URL("./consumer.tsx", import.meta.url), "utf8");
    assert.match(source, /liveNotifications\.filter\(\(item\) => item\.readAt === null\)\.length/);
    assert.match(source, /state=\{notificationsState\}/, "the view no longer takes its rows from the surface");
    const viewFile = await readFile(
      new URL("../consumer/notifications-view.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      viewFile,
      /useState<NotificationEventV2\[\]>/,
      "the view has taken its own copy of the rows back",
    );
  });

  test("a failed read never renders as an account with no notifications", async () => {
    // Moved here from failed-read-disclosure.test.ts's consumer.tsx assertion, which the rebuild
    // would otherwise have satisfied through the unrelated documents branch.
    const source = await readFile(new URL("./consumer.tsx", import.meta.url), "utf8");
    assert.ok(source.includes("setLiveNotificationsError(true)"), "notifications reader lost its failure branch");
    const viewFile = await readFile(
      new URL("../consumer/notifications-view.tsx", import.meta.url),
      "utf8",
    );
    assert.ok(
      viewFile.includes('state.status === "error"'),
      "the notifications view no longer has a branch of its own for a failed read",
    );
  });
});

/**
 * The flags-OFF fixture is the only notification copy most reviewers will ever read, so it is held
 * to the same rules as the server templates -- which, since the feed lane merged, is literally what
 * writes it. The battery therefore splits in two: the SHAPE of the lifeline is parsed out of
 * `consumer.tsx` at test time, and the COPY is asserted against `lib/notifications/copy.ts`, the
 * module that actually produces every string the page renders. Nothing here transcribes a sentence.
 */
describe("the flags-OFF notification lifeline", () => {
  async function lifeline() {
    const text = await readFile(new URL("./consumer.tsx", import.meta.url), "utf8");
    const start = text.indexOf("const notifications: NotificationEventV2[] = [");
    assert.ok(start > 0, "the fixture array is no longer declared where the surface reads it");
    const body = text.slice(start, text.indexOf("\n];", start));
    const events = [...body.matchAll(/event\(\s*"([^"]+)",\s*"([^"]+)",\s*(null|"[^"]+"),\s*(\w+)\(([^)]*)\)/g)].map(
      (m) => ({ id: m[1], type: m[1].slice(0, m[1].indexOf(":")), occurredAt: m[2], readAt: m[3], copyFn: m[4], args: m[5] }),
    );
    assert.ok(events.length >= 20, `only ${events.length} fixture events parsed; the shape drifted from the matcher`);
    return events;
  }

  test("generates every sentence from the server's own templates, never by hand", async () => {
    const text = await readFile(new URL("./consumer.tsx", import.meta.url), "utf8");
    const start = text.indexOf("const notifications: NotificationEventV2[] = [");
    const body = text.slice(start, text.indexOf("\n];", start));
    // The whole point: no literal title or detail survives inside the fixture, so the demo cannot
    // say anything a real account would not receive.
    assert.doesNotMatch(body, /\btitle:/, "a fixture row writes its own title instead of taking the server's");
    assert.doesNotMatch(body, /\bdetail:/, "a fixture row writes its own detail instead of taking the server's");
    const events = await lifeline();
    for (const event of events) {
      assert.ok(event.copyFn.endsWith("Copy"), `${event.id} builds its copy with something other than a template: ${event.copyFn}`);
    }
  });

  test("is dated in the past, newest first, with nothing waiting in the future", async () => {
    const events = await lifeline();
    const times = events.map((event) => Date.parse(event.occurredAt));
    for (const [index, time] of times.entries()) {
      assert.ok(Number.isFinite(time), `${events[index].id} has an unparseable timestamp`);
      assert.ok(time <= Date.now(), `${events[index].id} is dated in the future: ${events[index].occurredAt}`);
    }
    for (let i = 1; i < times.length; i += 1) {
      assert.ok(times[i] <= times[i - 1], `${events[i].id} sorts after the event above it; the feed is not newest-first`);
    }
  });

  test("dates every sentence from the event's own timestamp, never from a second clock (C1)", async () => {
    const events = await lifeline();
    let checked = 0;
    for (const event of events) {
      // A template that takes a date takes THIS event's date. Nothing else is available to it, so
      // a stale date cannot be left behind by a copy edit that moves a row.
      for (const [literal] of event.args.matchAll(/"(\d{4}-\d{2}-\d{2}T[^"]+)"/g)) {
        checked += 1;
        assert.ok(literal.includes(event.occurredAt), `${event.id} passes a date its own timestamp does not carry: ${literal}`);
      }
    }
    assert.ok(checked >= 5, `only ${checked} dated templates found; the ones that take a date went missing`);
  });

  test("moves the consumer forward through the one stage taxonomy and never back", async () => {
    const events = await lifeline();
    const taxonomy = ["onboarding", "optimization", "ready", "applying", "funded", "graduate"];
    const stages = events
      .filter((event) => event.type === "stage_change")
      .map((event) => taxonomy.findIndex((stage) => event.args.includes(`"${stage}"`)))
      .reverse();
    assert.ok(stages.length > 0, "the lifeline records no stage change at all");
    for (const [index, stage] of stages.entries()) {
      assert.ok(stage >= 0, "a stage change names a stage outside the taxonomy");
      if (index > 0) assert.ok(stage > stages[index - 1], "the lifeline moves the consumer backwards through the taxonomy");
    }
  });

  test("shows several document sections, all from the uploads table's own vocabulary (C9)", async () => {
    const events = await lifeline();
    const sections = new Set(
      events.filter((event) => event.type === "document").map((event) => event.args.replaceAll('"', "")),
    );
    for (const section of sections) {
      assert.ok(
        Object.hasOwn(DOCUMENT_SECTION_LABELS, section),
        `a document names a section the uploads table does not have: ${section}`,
      );
    }
    assert.ok(sections.size >= 3, `the lifeline shows ${sections.size} document sections; a bundle of identical rows reads as a bug`);
  });

  test("records an application update that asserts no decision (B17)", async () => {
    const events = await lifeline();
    const updates = events.filter((event) => event.type === "application_update");
    assert.ok(updates.length > 0, "the lifeline records no application update");
    assert.ok(
      updates.some((event) => event.args.startsWith('"update"')),
      "every application event announces a new application; none is the neutral later update B17 asks for",
    );
  });
});

/**
 * The templates themselves. These are the strings the consumer actually reads -- on the fixture
 * shell and on a durable account alike -- so the copy rulings are asserted here rather than against
 * any one row that happens to use them.
 */
describe("the notification copy templates", () => {
  const AT = "2026-08-23T10:00:00.000Z";

  test("never prints a parenthetical, a slash, or a plan version (C4, B22)", () => {
    assert.equal(analysisCompleteCopy(true, AT).title, "Your analysis is complete");
    assert.equal(analysisCompleteCopy(false, AT).title, "Your funding plan was updated");
    for (const copy of [
      analysisCompleteCopy(true, AT),
      analysisCompleteCopy(false, AT),
      refreshResultCopy(),
      monitoringAlertCopy(),
      teamMessageCopy(null),
      applicationUpdateCopy("update", "meridian-business-lending", AT),
      ...Object.keys(DOCUMENT_SECTION_LABELS).map((section) => documentCopy(section as never)),
    ]) {
      const text = `${copy.title} ${copy.detail}`;
      assert.doesNotMatch(copy.title, /[()\/]/, `a title prints the template's alternatives: ${copy.title}`);
      for (const banned of [/\boutcome\b/i, /\bpaid\b/i, /\bv\d+\b/, /\bversion \d/i, /\bsection\b/i]) {
        assert.doesNotMatch(text, banned, `a template says something the copy rulings forbid (${banned}): ${text}`);
      }
      assert.doesNotMatch(text, /\b\d+(\.\d+)?\s*(point|%)/i, `a template puts a number beside a movement claim: ${text}`);
    }
  });

  test("titles a document without committing to a count (§9)", () => {
    for (const section of Object.keys(DOCUMENT_SECTION_LABELS)) {
      const { title } = documentCopy(section as never);
      assert.match(title, /^New .+ received$/, `a document title left the number-neutral template: ${title}`);
      assert.doesNotMatch(title, /\bwas\b|\bwere\b/, `a document title agrees in number with a label it does not control: ${title}`);
    }
  });
});
