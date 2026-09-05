import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enqueueCrsAlertNotification, listNotifications, markNotificationRead, runNotificationDispatch } from "./notifications.ts";
import { createNotificationRepository, type AncillaryNotification, type NotificationDb, type NotificationRepository } from "./notification-repository.ts";
const CLIENT = "17000000-0000-4000-8000-000000000601", EVENT = "17000000-0000-4000-8000-000000000602", NOTICE = "17000000-0000-4000-8000-000000000603", RECIPIENT = "17000000-0000-4000-8000-000000000604";
function repo(overrides: Partial<NotificationRepository>): NotificationRepository { return overrides as NotificationRepository; }
const notice: AncillaryNotification = { id: NOTICE, clientId: CLIENT, sourceId: EVENT, kind: "crs_alert", createdAt: "2026-08-16T00:00:00Z", deliveredAt: "2026-08-16T00:00:01Z", readAt: null };
describe("ancillary notification", () => {
  it("touches no repository when disabled or when the event differs", async () => {
    let calls = 0; const repository = repo({ async insertCrsAlert() { calls += 1; return { notificationId: NOTICE, inserted: true }; } });
    assert.equal(await enqueueCrsAlertNotification({ clientId: CLIENT, monitoringEventId: EVENT, eventType: "ACCALERT" }, { env: {}, repository }), null);
    for (const eventType of ["SCOREREF", "REPORTREF", "ACCNEW", "ACCCLOSED"]) assert.equal(await enqueueCrsAlertNotification({ clientId: CLIENT, monitoringEventId: EVENT, eventType }, { env: { FEATURE_ANCILLARY: "true" }, repository }), null);
    assert.equal(calls, 0);
  });
  it("inserts one exact ACCALERT source when enabled", async () => {
    let source = "";
    const result = await enqueueCrsAlertNotification({ clientId: CLIENT, monitoringEventId: EVENT, eventType: "ACCALERT" }, { env: { FEATURE_ANCILLARY: "true" }, repository: repo({ async insertCrsAlert(id) { source = id; return { notificationId: NOTICE, inserted: true }; } }) });
    assert.equal(source, EVENT); assert.deepEqual(result, { notificationId: NOTICE, inserted: true });
  });
  it("maps a database preference suppression to no in-app notification", async () => {
    const database = {
      async rpc() {
        return { data: [{ inserted: false, notification_id: null }], error: null };
      },
      from() { throw new Error("unexpected table read"); },
    } as unknown as NotificationDb;
    assert.equal(await createNotificationRepository(database).insertCrsAlert(EVENT), null);
  });
  it("scopes list and read calls to the named recipient", async () => {
    const calls: string[] = [];
    const repository = repo({ async listDelivered(id) { calls.push(`list:${id}`); return [notice]; }, async markRead(id, recipient) { calls.push(`read:${id}:${recipient}`); return { ...notice, readAt: "now" }; } });
    assert.deepEqual(await listNotifications(RECIPIENT, repository), [notice]);
    assert.equal((await markNotificationRead(NOTICE, RECIPIENT, repository)).readAt, "now");
    assert.deepEqual(calls, [`list:${RECIPIENT}`, `read:${NOTICE}:${RECIPIENT}`]);
  });
  it("validates canonical dispatch keys and maps replay and failure", async () => {
    let calls = 0; const repository = repo({
      async readDispatchEnvelope(subject, window) { return calls === 0 ? { channel: "in_app", deliveryId: NOTICE, subject, window } : null; },
      async dispatch() { calls += 1; return { status: "ok", rows: 1 }; },
    });
    assert.deepEqual(await runNotificationDispatch(`client:${CLIENT}`, `notification:${NOTICE}`, repository), { status: "ok", rows: 1 });
    assert.deepEqual(await runNotificationDispatch(`client:${CLIENT}`, `notification:${NOTICE}`, repository), { status: "skipped", rows: 0 });
    assert.deepEqual(await runNotificationDispatch("bad", "bad", repository), { status: "failed" });
    assert.equal(calls, 1);
    assert.deepEqual(await runNotificationDispatch(`client:${CLIENT}`, `notification:${NOTICE}`, repo({ async readDispatchEnvelope() { throw new Error("x"); } })), { status: "failed" });
  });
  it("keeps in-app dispatch independent of the email operation", async () => {
    const order: string[] = [];
    const repository = repo({
      async readDispatchEnvelope(subject, window) { order.push("read"); return { channel: "in_app", deliveryId: NOTICE, subject, window }; },
      async dispatch() { order.push("acknowledge"); return { status: "ok", rows: 1 }; },
    });
    assert.deepEqual(await runNotificationDispatch(`client:${CLIENT}`, `notification:${NOTICE}`, repository, async () => { throw new Error("email must stay untouched"); }, async () => ({ status: "skipped", reason: "feature_off" })), { status: "ok", rows: 1 });
    assert.deepEqual(order, ["read", "acknowledge"]);
  });
  it("offers the delivered notification to consumer email before acknowledging it", async () => {
    const order: string[] = [];
    const seen: unknown[] = [];
    const repository = repo({
      async readDispatchEnvelope(subject, window) { order.push("read"); return { channel: "in_app", deliveryId: NOTICE, subject, window }; },
      async dispatch() { order.push("acknowledge"); return { status: "ok", rows: 1 }; },
    });
    const result = await runNotificationDispatch(
      `client:${CLIENT}`,
      `notification:${NOTICE}`,
      repository,
      async () => { throw new Error("operator email must stay untouched"); },
      async (input) => { order.push("consumer email"); seen.push(input); return { status: "skipped", reason: "preference_off" }; },
    );
    assert.deepEqual(result, { status: "ok", rows: 1 });
    assert.deepEqual(order, ["read", "consumer email", "acknowledge"]);
    assert.deepEqual(seen, [{ deliveryId: NOTICE, notificationId: NOTICE }]);
  });
  it("leaves the delivery queued when consumer email fails, so the job retries both halves", async () => {
    const order: string[] = [];
    const repository = repo({
      async readDispatchEnvelope(subject, window) { order.push("read"); return { channel: "in_app", deliveryId: NOTICE, subject, window }; },
      async dispatch() { order.push("acknowledge"); return { status: "ok", rows: 1 }; },
    });
    assert.deepEqual(
      await runNotificationDispatch(
        `client:${CLIENT}`,
        `notification:${NOTICE}`,
        repository,
        async () => { throw new Error("operator email must stay untouched"); },
        async () => ({ status: "failed", reason: "send" }),
      ),
      { status: "failed" },
    );
    assert.deepEqual(order, ["read"]);
  });
  it("sends an email before acknowledgement and never acknowledges a rejected send", async () => {
    const subject = `org:${CLIENT}`, window = `billing-event:${EVENT}`;
    const order: string[] = [];
    const repository = repo({
      async readDispatchEnvelope() { order.push("read"); return { channel: "email", deliveryId: NOTICE, subject, window, orgId: CLIENT, billingEventId: EVENT, template: "operator_card_failure" }; },
      async dispatch() { order.push("acknowledge"); return { status: "ok", rows: 1 }; },
    });
    assert.deepEqual(await runNotificationDispatch(subject, window, repository, async () => { order.push("send resolved"); }), { status: "ok", rows: 1 });
    assert.deepEqual(order, ["read", "send resolved", "acknowledge"]);
    order.length = 0;
    assert.deepEqual(await runNotificationDispatch(subject, window, repository, async () => { order.push("send rejected"); throw new Error("provider"); }), { status: "failed" });
    assert.deepEqual(order, ["read", "send rejected"]);
  });
  it("reads and maps an email envelope through the exact eight-column dispatch view", async () => {
    const calls: unknown[] = [];
    const row = {
      id: NOTICE,
      channel: "email",
      dispatch_subject: `org:${CLIENT}`,
      dispatch_window: `billing-event:${EVENT}`,
      org_id: CLIENT,
      billing_event_id: EVENT,
      email_template: "operator_card_failure",
      status: "queued",
    };
    const query = {
      eq(column: string, value: unknown) { calls.push({ column, value }); return query; },
      not() { return query; },
      in() { return query; },
      order() { return query; },
      maybeSingle() { return Promise.resolve({ data: row, error: null }); },
      then<TResult1 = unknown, TResult2 = never>(onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
        return Promise.resolve({ data: [row], error: null }).then(onfulfilled, onrejected);
      },
    };
    const database = {
      rpc() { throw new Error("unexpected rpc"); },
      from(table: string) {
        calls.push({ table });
        return {
          select(columns: string) { calls.push({ columns }); return query; },
          update() { throw new Error("unexpected update"); },
        };
      },
    } as unknown as NotificationDb;

    assert.deepEqual(
      await createNotificationRepository(database).readDispatchEnvelope(`org:${CLIENT}`, `billing-event:${EVENT}`),
      { channel: "email", deliveryId: NOTICE, subject: `org:${CLIENT}`, window: `billing-event:${EVENT}`, orgId: CLIENT, billingEventId: EVENT, template: "operator_card_failure" },
    );
    assert.deepEqual(calls, [
      { table: "notification_delivery_dispatch_view" },
      { columns: "id,channel,dispatch_subject,dispatch_window,org_id,billing_event_id,email_template,status" },
      { column: "dispatch_subject", value: `org:${CLIENT}` },
      { column: "dispatch_window", value: `billing-event:${EVENT}` },
    ]);
  });
});
