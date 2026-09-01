// payment-history.test.ts — the consumer ledger cannot show a charge before the enrollment.
//
// The defect: the on-demand refresh row carried the scripted demo date "Jul 21" on both arms of
// Account & Billing, and it was written first in the array, so a signed-in consumer whose durable
// subscription activated in August was shown "Jul 21 · On-demand refresh · $19.00" above it. An
// add-on charge dated a month before the enrollment that authorized the card contradicts what the
// enrollment flow states on its own face: the card is authorized during enrollment, and charged
// only once enrollment succeeds.
//
// These guards follow the round-5 rule about how such a guard has to be written. Nothing here
// transcribes a date from the reproduction. The scripted arm's premise comes from `FIXTURE_LEDGER`
// itself, the durable arm's from the `consumer_subscriptions` tuples parsed out of
// `supabase/seed.sql` at test time, and the ordering claim is asserted over every one of them
// rather than over the one pair that happened to be reported. Add a seeded persona whose
// subscription activates before its card authorization and this file goes red naming that persona;
// widen the ledger and the ordering assertion still holds over whatever rows it grows.
//
// Watched failing on the pre-fix tree: with the "Jul 21" literal in place, the durable arm put the
// refresh row above a subscription activated later, so both ordering assertions below fail. The
// companion source guard in `src/components/surfaces/consumer-billing-durable.test.ts`
// ("a scripted calendar date is hard-coded in Account & Billing again") fails there too.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FIXTURE_LEDGER,
  FIXTURE_REFRESH_AT,
  buildPaymentHistory,
} from "@/lib/billing/payment-history";
import type { PaymentHistoryRow } from "@/lib/billing/payment-history";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");

const MONTHLY = "$49.00";
const REFRESH = "$19.00";

interface SeededSubscription {
  activatedAt: string | null;
  authorizedAt: string;
  id: string;
}

/**
 * The seeded `consumer_subscriptions` tuples, read out of the seed rather than copied from it.
 * `created_at` is the card authorization and `activated_at` the first charge; both are what the
 * durable ledger renders, so both are what the ordering claim has to be proved against.
 */
function seededSubscriptions(): SeededSubscription[] {
  const seed = fs.readFileSync(path.join(REPO, "supabase/seed.sql"), "utf8");
  const head = seed.indexOf("insert into public.consumer_subscriptions (");
  assert.notEqual(head, -1, "the seed no longer inserts consumer_subscriptions");
  const valuesAt = seed.indexOf("\nvalues\n", head);
  const closeAt = seed.indexOf("\non conflict", valuesAt);
  assert.ok(valuesAt > head && closeAt > valuesAt, "the consumer_subscriptions insert changed shape");

  const columns = seed
    .slice(seed.indexOf("(", head) + 1, seed.lastIndexOf(")", valuesAt))
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  for (const column of ["id", "created_at", "activated_at"]) {
    assert.ok(columns.includes(column), `the seed no longer sets ${column} on consumer_subscriptions`);
  }

  const rows: SeededSubscription[] = [];
  for (const tuple of seed.slice(valuesAt, closeAt).matchAll(/\(\s*\n([\s\S]*?)\n\s*\)/g)) {
    const values = tuple[1].split(",").map((value) => value.trim().replace(/^'|'$/g, ""));
    assert.equal(values.length, columns.length, "a seeded subscription tuple does not match the column list");
    const at = (column: string): string => values[columns.indexOf(column)];
    const activated = at("activated_at");
    rows.push({
      activatedAt: activated === "null" ? null : activated,
      authorizedAt: at("created_at"),
      id: at("id"),
    });
  }
  assert.ok(rows.length > 0, "no seeded subscription was parsed — the ordering claim would be vacuous");
  return rows;
}

function instants(rows: readonly PaymentHistoryRow[]): number[] {
  return rows.map((entry) => {
    assert.notEqual(entry.at, null, `the ${entry.item} row lost its instant, so nothing can order it`);
    return entry.at as number;
  });
}

function assertNewestFirst(rows: readonly PaymentHistoryRow[], context: string): void {
  const order = instants(rows);
  for (let index = 1; index < order.length; index += 1) {
    assert.ok(
      order[index - 1] >= order[index],
      `${context}: "${rows[index - 1].item}" (${rows[index - 1].date}) renders above "${rows[index].item}" (${rows[index].date})`,
    );
  }
}

describe("the consumer payment history is ordered by when each charge happened", () => {
  it("orders the durable ledger newest first for every seeded subscription, refresh included", () => {
    for (const seeded of seededSubscriptions()) {
      // The refresh is a live in-session purchase, so its instant is now: strictly after anything
      // the seed holds. It is also the row that used to carry a scripted July date.
      const chargedAt = new Date().toISOString();
      const rows = buildPaymentHistory({
        fixture: false,
        fixtureMonthlyAmount: MONTHLY,
        refresh: { chargedAt, pending: false },
        refreshAmount: REFRESH,
        subscription: {
          activatedAt: seeded.activatedAt,
          authorizedAt: seeded.authorizedAt,
          monthlyAmount: MONTHLY,
        },
      });
      assertNewestFirst(rows, `seeded subscription ${seeded.id}`);
      assert.equal(
        rows[0].item,
        "On-demand refresh",
        `seeded subscription ${seeded.id}: a refresh bought just now does not render at the top of the ledger`,
      );
    }
  });

  it("dates no durable row before the enrollment that authorized the card", () => {
    for (const seeded of seededSubscriptions()) {
      const authorized = Date.parse(seeded.authorizedAt);
      assert.ok(Number.isFinite(authorized), `seeded subscription ${seeded.id} has an unparseable created_at`);
      const rows = buildPaymentHistory({
        fixture: false,
        fixtureMonthlyAmount: MONTHLY,
        refresh: { chargedAt: new Date().toISOString(), pending: false },
        refreshAmount: REFRESH,
        subscription: {
          activatedAt: seeded.activatedAt,
          authorizedAt: seeded.authorizedAt,
          monthlyAmount: MONTHLY,
        },
      });
      for (const entry of rows) {
        assert.ok(
          (entry.at as number) >= authorized,
          `seeded subscription ${seeded.id}: "${entry.item}" is dated ${entry.date}, before the card was authorized`,
        );
      }
      // The seed's own consistency, which the ordering above depends on: nothing is charged before
      // the authorization that made charging possible.
      if (seeded.activatedAt !== null) {
        assert.ok(
          Date.parse(seeded.activatedAt) >= authorized,
          `seeded subscription ${seeded.id} activates before it is authorized`,
        );
      }
    }
  });

  it("keeps every scripted date inside the scripted arm", () => {
    const fixtureRows = buildPaymentHistory({
      fixture: true,
      fixtureMonthlyAmount: MONTHLY,
      refresh: { chargedAt: null, pending: false },
      refreshAmount: REFRESH,
      subscription: null,
    });
    assertNewestFirst(fixtureRows, "the scripted ledger");
    assert.equal(fixtureRows.length, FIXTURE_LEDGER.length + 1, "the scripted ledger lost or gained a row");
    assert.ok(
      Date.parse(FIXTURE_REFRESH_AT) > Date.parse(FIXTURE_LEDGER[0].at),
      "the scripted refresh is no longer the newest scripted event",
    );

    // The durable arm renders no scripted date, whatever the scripted arm holds. This is the
    // reported defect stated as a property: the refresh row is dated from the purchase, and the
    // purchase is the only thing that can date it.
    const scripted = new Set(fixtureRows.map((entry) => entry.date));
    const seeded = seededSubscriptions()[0];
    const chargedAt = new Date().toISOString();
    const durableRows = buildPaymentHistory({
      fixture: false,
      fixtureMonthlyAmount: MONTHLY,
      refresh: { chargedAt, pending: true },
      refreshAmount: REFRESH,
      subscription: {
        activatedAt: seeded.activatedAt,
        authorizedAt: seeded.authorizedAt,
        monthlyAmount: MONTHLY,
      },
    });
    for (const entry of durableRows) {
      assert.ok(
        !scripted.has(entry.date),
        `the durable ledger renders the scripted date ${entry.date} on its "${entry.item}" row`,
      );
    }
    assert.equal(
      durableRows[0].at,
      Date.parse(chargedAt),
      "the durable refresh row is not dated from the purchase that produced it",
    );
  });

  it("sorts a row that carries no instant to the end rather than to the top", () => {
    const seeded = seededSubscriptions()[0];
    const rows = buildPaymentHistory({
      fixture: false,
      fixtureMonthlyAmount: MONTHLY,
      // The purchase instant was lost. An undated charge cannot be claimed to precede a dated one.
      refresh: { chargedAt: null, pending: true },
      refreshAmount: REFRESH,
      subscription: {
        activatedAt: seeded.activatedAt,
        authorizedAt: seeded.authorizedAt,
        monthlyAmount: MONTHLY,
      },
    });
    assert.equal(rows[rows.length - 1].item, "On-demand refresh");
    assert.equal(rows[rows.length - 1].at, null);
  });
});
