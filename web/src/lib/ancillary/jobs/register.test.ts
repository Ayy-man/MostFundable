import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCadenceProviders, getJobHandler } from "@/lib/jobs/registry";
import {
  listQueuedNotificationTuples,
  type NotificationCadenceDb,
} from "@/lib/ancillary/jobs/register";

describe("notification job bridge", () => {
  it("keeps one handler and one cadence provider on the existing job key", () => {
    assert.equal(typeof getJobHandler("notifications.dispatch"), "function");
    assert.equal(typeof getCadenceProviders().get("notifications.dispatch"), "function");
  });

  it("reads only the exact dispatch tuple projection and maps both grammars", async () => {
    const calls: unknown[] = [];
    const db: NotificationCadenceDb = {
      from(table) {
        calls.push({ table });
        return {
          select(columns) {
            calls.push({ columns });
            return {
              async eq(column, value) {
                calls.push({ column, value });
                return {
                  data: [
                    { dispatch_subject: "client:17000000-0000-4000-8000-000000000601", dispatch_window: "notification:17000000-0000-4000-8000-000000000603" },
                    { dispatch_subject: "org:25000000-0000-4000-8000-000000000502", dispatch_window: "billing-event:25000000-0000-4000-8000-000000000503" },
                  ],
                  error: null,
                };
              },
            };
          },
        };
      },
    };

    assert.deepEqual(await listQueuedNotificationTuples(db), [
      { job: "notifications.dispatch", subject: "client:17000000-0000-4000-8000-000000000601", window: "notification:17000000-0000-4000-8000-000000000603" },
      { job: "notifications.dispatch", subject: "org:25000000-0000-4000-8000-000000000502", window: "billing-event:25000000-0000-4000-8000-000000000503" },
    ]);
    assert.deepEqual(calls, [
      { table: "notification_delivery_dispatch_view" },
      { columns: "dispatch_subject,dispatch_window" },
      { column: "status", value: "queued" },
    ]);
  });

  it("fails closed when the dispatch view cannot be read", async () => {
    const db: NotificationCadenceDb = {
      from() {
        return {
          select() {
            return {
              async eq() { return { data: null, error: { code: "read_failed" } }; },
            };
          },
        };
      },
    };
    await assert.rejects(listQueuedNotificationTuples(db), /NOTIFICATION_OUTBOX_READ_FAILED/);
  });
});
