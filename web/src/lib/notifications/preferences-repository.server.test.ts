import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ConsumerNotificationPreferencesRepositoryError,
  createConsumerNotificationPreferencesRepository,
  type ConsumerNotificationPreferencesDatabase,
} from "./preferences-repository.server.ts";

const PROFILE = "41300000-0000-4000-8000-000000000111";

interface Result<T> {
  data: T | null;
  error: { message: string } | null;
}

class FakeQuery<T extends Record<string, unknown>> implements PromiseLike<Result<T[]>> {
  private readonly rows: T[];
  private readonly calls: Array<readonly unknown[]>;
  private readonly error: { message: string } | null;

  constructor(
    rows: T[],
    calls: Array<readonly unknown[]>,
    error: { message: string } | null = null,
  ) {
    this.rows = rows;
    this.calls = calls;
    this.error = error;
  }

  eq(column: string, value: unknown): this {
    this.calls.push(["eq", column, value]);
    return this;
  }

  maybeSingle(): PromiseLike<Result<T>> {
    this.calls.push(["maybeSingle"]);
    return Promise.resolve({ data: this.rows[0] ?? null, error: this.error });
  }

  order(column: string, options: { ascending: boolean }): this {
    this.calls.push(["order", column, options]);
    return this;
  }

  select(columns: string): this {
    this.calls.push(["select", columns]);
    return this;
  }

  then<TResult1 = Result<T[]>, TResult2 = never>(
    onfulfilled?: ((value: Result<T[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: this.error }).then(onfulfilled, onrejected);
  }
}

function database(
  initial: Array<Record<string, unknown>>,
  error: { message: string } | null = null,
) {
  const calls: Array<readonly unknown[]> = [];
  let rows = [...initial];
  const db = {
    from(table: string) {
      calls.push(["from", table]);
      return {
        select(columns: string) {
          calls.push(["table.select", columns]);
          return new FakeQuery(rows, calls, error);
        },
        upsert(value: Record<string, unknown>, options: { onConflict: string }) {
          calls.push(["upsert", value, options]);
          rows = [value];
          return new FakeQuery(rows, calls, error);
        },
      };
    },
  } as unknown as ConsumerNotificationPreferencesDatabase;
  return { calls, db };
}

describe("consumer notification preference repository", () => {
  it("uses the session database, scopes reads to the authenticated profile and fills sparse defaults", async () => {
    const { calls, db } = database([{
      email_enabled: false,
      event_type: "team_message",
      in_app_enabled: false,
    }]);
    const repository = createConsumerNotificationPreferencesRepository(() => db);
    const preferences = await repository.list(PROFILE);

    assert.equal(preferences.length, 8);
    assert.deepEqual(
      preferences.find((preference) => preference.eventType === "team_message"),
      { email: false, eventType: "team_message", inApp: false },
    );
    assert.ok(calls.some((call) => call[0] === "eq" && call[1] === "profile_id" && call[2] === PROFILE));
    assert.equal(calls.filter((call) => call[0] === "from").length, 1);
  });

  it("upserts only the caller profile and canonical event identity, then requires full readback", async () => {
    const { calls, db } = database([]);
    const repository = createConsumerNotificationPreferencesRepository(() => db);
    const preferences = await repository.save(PROFILE, {
      email: false,
      eventType: "document",
      inApp: false,
    });

    const upsert = calls.find((call) => call[0] === "upsert");
    assert.deepEqual(upsert, [
      "upsert",
      {
        email_enabled: false,
        event_type: "document",
        in_app_enabled: false,
        profile_id: PROFILE,
      },
      { onConflict: "profile_id,event_type" },
    ]);
    assert.equal(preferences.length, 8);
    assert.equal(calls.filter((call) => call[0] === "from").length, 2);

    const opted = await repository.save(PROFILE, {
      email: true,
      eventType: "document",
      inApp: true,
    });
    assert.deepEqual(
      calls.filter((call) => call[0] === "upsert").at(-1),
      [
        "upsert",
        {
          email_enabled: true,
          event_type: "document",
          in_app_enabled: true,
          profile_id: PROFILE,
        },
        { onConflict: "profile_id,event_type" },
      ],
    );
    assert.equal(opted.length, 8);
  });

  it("fails closed on database errors and malformed persisted rows", async () => {
    const failed = createConsumerNotificationPreferencesRepository(
      () => database([], { message: "offline" }).db,
    );
    await assert.rejects(() => failed.list(PROFILE), ConsumerNotificationPreferencesRepositoryError);

    const malformed = createConsumerNotificationPreferencesRepository(
      () => database([{
        email_enabled: false,
        event_type: "invented",
        in_app_enabled: true,
      }]).db,
    );
    await assert.rejects(() => malformed.list(PROFILE), ConsumerNotificationPreferencesRepositoryError);

    // Email opt-in is a live choice now, so a persisted true reads back rather than failing closed.
    const optedIn = createConsumerNotificationPreferencesRepository(
      () => database([{
        email_enabled: true,
        event_type: "team_message",
        in_app_enabled: true,
      }]).db,
    );
    assert.deepEqual(
      (await optedIn.list(PROFILE)).find((preference) => preference.eventType === "team_message"),
      { email: true, eventType: "team_message", inApp: true },
    );

    const malformedEmail = createConsumerNotificationPreferencesRepository(
      () => database([{
        email_enabled: "yes",
        event_type: "team_message",
        in_app_enabled: true,
      } as unknown as { email_enabled: boolean; event_type: string; in_app_enabled: boolean }]).db,
    );
    await assert.rejects(
      () => malformedEmail.list(PROFILE),
      ConsumerNotificationPreferencesRepositoryError,
    );
  });
});
