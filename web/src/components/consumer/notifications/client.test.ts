import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchNotifications, markAllRead, markRead } from "./client.ts";
import type { NotificationEventV2 } from "./types.ts";

function event(overrides: Partial<NotificationEventV2> = {}): NotificationEventV2 {
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

describe("fetchNotifications", () => {
  it("reads the window, the rows and the unread count from a healthy response", async () => {
    const row = event();
    let seen = "";
    const result = await fetchNotifications(async (path, init) => {
      seen = path;
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.credentials, "same-origin");
      return Response.json({ notifications: [row], unreadCount: 1, windowDays: 90 });
    });
    assert.equal(seen, "/api/notifications");
    assert.deepEqual(result, {
      capped: false,
      notifications: [row],
      sources: ["monitoring_alert"],
      status: "ready",
      unreadCount: 1,
      windowDays: 90,
    });
  });

  it("carries the cap flag and the tenant's source classes through unchanged", async () => {
    const result = await fetchNotifications(async () =>
      Response.json({
        capped: true,
        notifications: [event()],
        sources: ["team_message", "document", "not_a_type"],
        unreadCount: 1,
        windowDays: 90,
      }),
    );
    assert.equal(result.status, "ready");
    assert.equal(result.status === "ready" && result.capped, true);
    // An unknown class is dropped rather than carried: the empty state would have no clause for it
    // and would print "undefined" into a sentence about the account.
    assert.deepEqual(result.status === "ready" && result.sources, ["team_message", "document"]);
  });

  it("falls back to the classes it actually saw when a route predates `sources`", async () => {
    // An empty list here would teach an account that nothing can ever arrive, which is a stronger
    // and more wrong claim than naming the classes the read just returned.
    const result = await fetchNotifications(async () =>
      Response.json({ notifications: [event(), event({ id: "b", type: "document", target: "documents" })] }),
    );
    assert.deepEqual(result.status === "ready" && result.sources, ["monitoring_alert", "document"]);
    assert.equal(result.status === "ready" && result.capped, false);
  });

  it("reports a 404 as the feature being off, never as an account with no activity", async () => {
    // An empty list is a claim about the account; a switched-off read is a claim about the
    // deployment. Folding one into the other is the G-HOST-14 defect class.
    const result = await fetchNotifications(async () => Response.json({ error: "ancillary_disabled" }, { status: 404 }));
    assert.deepEqual(result, { status: "off" });
  });

  it("reports a failed read as an error, with whatever correlation id came back", async () => {
    const result = await fetchNotifications(async () =>
      Response.json({ correlationId: "req_9f2", error: { message: "boom" } }, { status: 500 }),
    );
    assert.equal(result.status, "error");
    assert.equal(result.status === "error" && result.correlationId, "req_9f2");
  });

  it("never throws at the view when the network drops or the body is not JSON", async () => {
    const thrown = await fetchNotifications(async () => {
      throw new TypeError("Failed to fetch");
    });
    assert.equal(thrown.status, "error");

    const garbage = await fetchNotifications(async () => new Response("<html>502</html>", { status: 502 }));
    assert.equal(garbage.status, "error");
    assert.equal(garbage.status === "error" && garbage.correlationId, null);

    const okButGarbage = await fetchNotifications(async () => new Response("not json", { status: 200 }));
    assert.equal(okButGarbage.status, "error", "a 200 that is not the contract shape is still a failed read");
  });

  it("refuses a malformed row rather than rendering a notification with no destination", async () => {
    const result = await fetchNotifications(async () =>
      Response.json({ notifications: [{ ...event(), target: "settings" }], unreadCount: 1, windowDays: 90 }),
    );
    assert.equal(result.status, "error");
  });

  it("accepts the analysis rows returned by production only when their deep links match the view contract", async () => {
    const analysis = event({
      id: "analysis_complete:a71d6ee2-f645-4de2-be7e-8dd00fbed3c1",
      occurredAt: "2026-08-30T15:45:06.943403+00:00",
      target: "plan",
      type: "analysis_complete",
    });
    const refresh = event({
      id: "refresh_result:7c1356d1-ee96-4242-934b-915241b2e3a3",
      occurredAt: "2026-08-31T23:00:05.787398+00:00",
      target: "plan",
      type: "refresh_result",
    });

    const healthy = await fetchNotifications(async () => Response.json({
      capped: false,
      notifications: [refresh, analysis],
      sources: ["analysis_complete", "refresh_result"],
      unreadCount: 2,
      windowDays: 90,
    }));
    assert.equal(healthy.status, "ready");

    const mismatched = await fetchNotifications(async () => Response.json({
      notifications: [{ ...analysis, target: "optimization" }],
      unreadCount: 1,
      windowDays: 90,
    }));
    assert.equal(mismatched.status, "error");
  });

  it("derives the unread count when the route omits it, so the badge is never silently zero", async () => {
    const result = await fetchNotifications(async () =>
      Response.json({ notifications: [event(), event({ id: "b", readAt: "2026-08-24T12:00:00.000Z" })] }),
    );
    assert.equal(result.status, "ready");
    assert.equal(result.status === "ready" && result.unreadCount, 1);
    assert.equal(result.status === "ready" && result.windowDays, 90);
  });
});

describe("markRead", () => {
  it("URL-encodes the event key, because the key carries a colon", async () => {
    const row = event({ readAt: "2026-08-24T12:00:00.000Z" });
    let seen = "";
    const result = await markRead(row.id, async (path, init) => {
      seen = path;
      assert.equal(init?.method, "PATCH");
      return Response.json({ notification: row });
    });
    assert.equal(seen, `/api/notifications/${encodeURIComponent(row.id)}`);
    assert.deepEqual(result, { notification: row, ok: true });
  });

  it("refuses a response that reports the row as still unread", async () => {
    // The optimistic tint is reconciled against this; accepting readAt: null would leave the row
    // looking read on screen and unread everywhere else.
    const result = await markRead(event().id, async () => Response.json({ notification: event() }));
    assert.equal(result.ok, false);
  });

  it("refuses a response about some other notification", async () => {
    const result = await markRead(event().id, async () =>
      Response.json({ notification: event({ id: "team_message:other", readAt: "2026-08-24T12:00:00.000Z" }) }),
    );
    assert.equal(result.ok, false);
  });

  it("carries a message the surface can show, and never throws", async () => {
    const failed = await markRead(event().id, async () =>
      Response.json({ error: { message: "This notification is no longer in your window." } }, { status: 404 }),
    );
    assert.deepEqual(failed, {
      message: "This notification is no longer in your window.",
      ok: false,
    });

    const dropped = await markRead(event().id, async () => {
      throw new TypeError("Failed to fetch");
    });
    assert.equal(dropped.ok, false);
    assert.equal(dropped.ok === false && dropped.message.length > 0, true);
  });
});

describe("markAllRead", () => {
  it("is one request, not one request per row", async () => {
    let calls = 0;
    const result = await markAllRead(async (path, init) => {
      calls += 1;
      assert.equal(path, "/api/notifications/read-all");
      assert.equal(init?.method, "POST");
      return Response.json({ unreadCount: 0, updated: 7 });
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, { ok: true, unreadCount: 0, updated: 7 });
  });

  it("returns an honest failure rather than a silent success", async () => {
    const result = await markAllRead(async () => Response.json({ error: "write_failed" }, { status: 500 }));
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.message.length > 0, true);

    const thrown = await markAllRead(async () => {
      throw new TypeError("Failed to fetch");
    });
    assert.equal(thrown.ok, false);
  });

  it("refuses a success body that does not say what it did", async () => {
    const result = await markAllRead(async () => Response.json({ ok: true }));
    assert.equal(result.ok, false);
  });
});
