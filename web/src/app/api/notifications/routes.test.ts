import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  handleNotificationPatch,
  type NotificationPatchDependencies,
} from "./[id]/route.ts";
import {
  handleNotificationsReadAll,
  type NotificationsReadAllDependencies,
} from "./read-all/route.ts";
import {
  handleNotificationsGet,
  type NotificationsGetDependencies,
} from "./route.ts";

import type { SessionProfile } from "@/lib/auth/session";
import type { NotificationEventV2, NotificationFeedV2 } from "@/lib/notifications/types";

const root = path.resolve(process.cwd(), "src/app/api/notifications");
const read = (name: string): string => fs.readFileSync(path.join(root, name), "utf8");
const SOURCE_ID = "39400000-0000-4000-8000-000000000201";

function session(): SessionProfile {
  return {
    disabledAt: null,
    id: "39400000-0000-4000-8000-000000000111",
    manages: [],
    orgId: "39400000-0000-4000-8000-000000000001",
    orgMembership: null,
    orgRole: null,
    role: "consumer",
  };
}

function notification(overrides: Partial<NotificationEventV2> = {}): NotificationEventV2 {
  return {
    id: `monitoring_alert:${SOURCE_ID}`,
    type: "monitoring_alert",
    occurredAt: "2026-08-24T10:00:00.000Z",
    title: "A credit source alert is ready",
    detail: "Open Credit Monitoring to see what changed on the source record.",
    target: "credit",
    readAt: null,
    ...overrides,
  };
}

async function body(response: Response): Promise<unknown> {
  return response.json();
}

describe("notification route contracts", () => {
  it("keeps every consumer route behind FEATURE_ANCILLARY and the consumer role", () => {
    for (const file of ["route.ts", "[id]/route.ts", "read-all/route.ts"]) {
      const source = read(file);
      assert.match(source, /featureFlag\("FEATURE_ANCILLARY"\)/, file);
      assert.match(source, /requireRole\("consumer"\)/, file);
      assert.ok(
        source.indexOf('featureFlag("FEATURE_ANCILLARY")') < source.indexOf("await Promise.all"),
        `${file}: dependencies load before the flag check`,
      );
    }
  });

  it("leaves the platform dispatch route and its tuple unchanged", () => {
    const dispatch = read("dispatch/[id]/route.ts");
    assert.match(dispatch, /requireRole\("platform_admin"\)/);
    assert.match(dispatch, /`client:\$\{clientId\}`/);
    assert.match(dispatch, /`notification:\$\{id\}`/);
    assert.doesNotMatch(dispatch, /readConsumerNotificationFeed|markConsumerNotificationRead/);
  });

  it("GET authenticates as a consumer and returns the complete feed envelope", async () => {
    const calls: string[] = [];
    const expected: NotificationFeedV2 = {
      notifications: [notification()], unreadCount: 1, windowDays: 90, capped: false,
      sources: ["monitoring_alert", "document"],
    };
    const dependencies: NotificationsGetDependencies = {
      async requireConsumer() { calls.push("auth"); return session(); },
      async readFeed(actor) { calls.push(`read:${actor.id}`); return expected; },
    };

    const response = await handleNotificationsGet(dependencies);

    assert.equal(response.status, 200);
    assert.deepEqual(await body(response), expected);
    assert.deepEqual(calls, ["auth", `read:${session().id}`]);
  });

  it("all three handlers preserve the shared authentication-required error", async () => {
    const refusal = async (): Promise<SessionProfile> => {
      throw { status: 401 };
    };
    const get = await handleNotificationsGet({
      requireConsumer: refusal,
      async readFeed() { throw new Error("unreachable"); },
    });
    const patch = await handleNotificationPatch(`monitoring_alert:${SOURCE_ID}`, {
      requireConsumer: refusal,
      async markRead() { throw new Error("unreachable"); },
    });
    const readAll = await handleNotificationsReadAll({
      requireConsumer: refusal,
      async markAllRead() { throw new Error("unreachable"); },
    });

    for (const response of [get, patch, readAll]) {
      assert.equal(response.status, 401);
      assert.deepEqual(await body(response), { error: "authentication_required" });
    }
  });

  it("PATCH decodes a stable event key and returns its newly read event", async () => {
    const key = `monitoring_alert:${SOURCE_ID}`;
    let received = "";
    const dependencies: NotificationPatchDependencies = {
      async requireConsumer() { return session(); },
      async markRead(_actor, eventKey) {
        received = eventKey;
        return notification({ id: eventKey, readAt: "2026-08-24T11:00:00.000Z" });
      },
    };

    const response = await handleNotificationPatch(encodeURIComponent(key), dependencies);

    assert.equal(response.status, 200);
    assert.equal(received, key);
    assert.deepEqual(await body(response), {
      notification: notification({ id: key, readAt: "2026-08-24T11:00:00.000Z" }),
    });
  });

  it("PATCH returns 422 before auth for malformed keys and 404 for a key outside the window", async () => {
    let authCalls = 0;
    const dependencies: NotificationPatchDependencies = {
      async requireConsumer() { authCalls += 1; return session(); },
      async markRead() { return null; },
    };

    for (const key of ["not-an-event-key", "%E0%A4%A", `Monitoring_alert:${SOURCE_ID}`]) {
      const response = await handleNotificationPatch(key, dependencies);
      assert.equal(response.status, 422);
      assert.deepEqual(await body(response), { error: "invalid_request" });
    }
    assert.equal(authCalls, 0);

    const missing = await handleNotificationPatch(`stage_change:${SOURCE_ID}`, dependencies);
    assert.equal(missing.status, 404);
    assert.deepEqual(await body(missing), { error: "not_found" });
    assert.equal(authCalls, 1);
  });

  it("POST read-all returns the one bulk write count and a cleared unread count", async () => {
    const calls: string[] = [];
    const dependencies: NotificationsReadAllDependencies = {
      async requireConsumer() { calls.push("auth"); return session(); },
      async markAllRead(actor) { calls.push(`write:${actor.id}`); return 7; },
    };

    const response = await handleNotificationsReadAll(dependencies);

    assert.equal(response.status, 200);
    assert.deepEqual(await body(response), { updated: 7, unreadCount: 0 });
    assert.deepEqual(calls, ["auth", `write:${session().id}`]);
  });
});
