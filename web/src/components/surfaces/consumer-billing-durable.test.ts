import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Account & Billing rendered module fixtures to every consumer, enrolled or not: an active $49
 * plan, a saved Visa ending 4242, four paid rows dated Jun 20 through Jul 21, and both named
 * permissions tagged Active with working Revoke buttons. On a signed-in consumer who has never
 * enrolled, those paid rows are billing history dated before any enrollment exists, which
 * contradicts the rule the enrollment flow states on its own face — the card is authorized during
 * enrollment and charged only when enrollment succeeds. That is the compliance-visible half; the
 * permission rows are the other half, because a consent nobody ever gave is not "Active".
 *
 * The guards below follow this repo's source-derived style, and follow the round-5 rule about how
 * such a guard has to be written: each one derives its premise at test time — from the migration
 * that defines `public.consumer_subscriptions`, from the grant statements on `public.plans`, from
 * the projection in `EnrollmentView` — and only then asserts what the surface must do about it. An
 * enumeration transcribed from the reproduction rots the moment the platform grows the missing
 * column or route, and a rotted enumeration is what defeated ten of round 4's fixes. Here the
 * premise going away is the point: store a card brand, or ship a consumer read of `public.plans`,
 * and the matching test fails and tells you which panel is now yours to wire.
 *
 * Watched failing on the pre-fix tree, where the fixture branch was unconditional.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../..");
const REPO = path.resolve(WEB, "..");

const consumer = fs.readFileSync(path.join(HERE, "consumer.tsx"), "utf8");
const enrollmentTypes = fs.readFileSync(
  path.join(WEB, "src/lib/enrollment/types.ts"),
  "utf8",
);
const enrollmentRepository = fs.readFileSync(
  path.join(WEB, "src/lib/enrollment/repository.ts"),
  "utf8",
);

function migration(name: string): string {
  return fs.readFileSync(path.join(REPO, "supabase/migrations", name), "utf8");
}

/** The `SettingsView` body, so an assertion about Account & Billing cannot pass on another panel. */
function settingsView(): string {
  const start = consumer.indexOf("function SettingsView({");
  assert.notEqual(start, -1, "SettingsView is gone — Account & Billing moved without this guard");
  const end = consumer.indexOf("\nfunction ", start + 1);
  assert.notEqual(end, -1);
  return consumer.slice(start, end);
}

describe("Account & Billing renders the durable record, never a fixture", () => {
  it("carries the subscription row into the view the browser reads", () => {
    // Premise, derived: the columns exist on `public.consumer_subscriptions` and the repository
    // already selects the row for its settlement paths. Nothing new had to be stored; the row
    // simply was not projected, which is why the surface had nothing durable to render.
    const billing = migration("022_billing_tables.sql");
    for (const column of ["price_cents", "currency", "status", "payment_method_ref", "activated_at", "cancelled_at"]) {
      assert.ok(
        new RegExp(`^\\s+${column}\\b`, "m").test(billing),
        `consumer_subscriptions no longer declares ${column} — the billing projection reads it`,
      );
    }

    assert.match(
      enrollmentTypes,
      /export type SubscriptionView = \{/,
      "the consumer-safe subscription projection is gone",
    );
    assert.match(
      enrollmentTypes,
      /subscription: SubscriptionView \| null;/,
      "EnrollmentView no longer carries the subscription, so the surface has nothing durable to read",
    );
    assert.match(
      enrollmentRepository,
      /subscription: subscriptionRow\s*\n\s*\? \{/,
      "the repository stopped projecting the subscription row into the view",
    );
  });

  it("keeps every provider reference server-side", () => {
    // A consumer's own browser needs the money facts, not the Stripe ids. `SubscriptionState` keeps
    // the references; `SubscriptionView` must not gain them.
    const start = enrollmentTypes.indexOf("export type SubscriptionView = {");
    assert.notEqual(start, -1, "SubscriptionView is gone, so this guard would pass on an empty slice");
    const view = enrollmentTypes.slice(start, enrollmentTypes.indexOf("};", start));
    for (const reference of ["customerRef", "setupIntentRef", "paymentMethodRef", "priceRef", "subscriptionRef", "idempotencyKey"]) {
      assert.ok(
        !view.includes(reference),
        `SubscriptionView exposes ${reference} to the browser`,
      );
    }
  });

  it("runs the fixture plan, ledger and card only on an explicit flag-off bootstrap", () => {
    const view = settingsView();
    // `enrollmentFixture` is `enrollState === "disabled"`, which `consumer-bootstrap.ts` produces
    // only from a successful `{ enabled: false }`. Loading, a 503 and a malformed body are all
    // `unavailable`, and none of them may select the fixture.
    assert.match(
      consumer,
      /enrollmentFixture=\{enrollFixture\}/,
      "SettingsView no longer receives the flag-off discriminator",
    );
    assert.match(
      view,
      /const billingDurable = !enrollmentFixture && !enrollmentPending;/,
      "the durable/fixture split in Account & Billing is gone",
    );

    // The fixture ledger rows are the paid rows dated before an enrollment, and they are exactly
    // the ones that must never reach a durable session. They no longer live in this file at all:
    // `buildPaymentHistory` owns them, gated on its `fixture` flag, and the behavioural guard for
    // that gate lives in `src/lib/billing/payment-history.test.ts`. What this file still has to
    // prove is that the panel routes the flag-off discriminator into it.
    assert.match(
      view,
      /fixture: enrollmentFixture,/,
      "the ledger no longer branches on the flag-off discriminator",
    );
    assert.doesNotMatch(
      view,
      /"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}"/,
      "a scripted calendar date is hard-coded in Account & Billing again — it renders on the durable arm too",
    );
    assert.ok(
      view.indexOf("Visa ending {cardLast4}") > view.indexOf("{!enrollmentFixture ? ("),
      "the fixture card renders outside the flag-off arm",
    );
  });

  it("derives the ledger from the subscription row's own timestamps", () => {
    const view = settingsView();
    assert.match(
      view,
      /subscription: subscription\s*\n\s*\? \{/,
      "the durable ledger no longer derives from the subscription row",
    );
    for (const field of ["subscription.activatedAt", "subscription.authorizedAt", "subscription.priceCents"]) {
      assert.ok(view.includes(field), `the durable ledger does not read ${field}`);
    }
    // No invoice table exists, so no monthly renewal may be listed. If one ever lands, this
    // assertion is the reminder that the ledger can finally show more than two events.
    const migrationNames = fs.readdirSync(path.join(REPO, "supabase/migrations"));
    const invoiceTables = migrationNames.filter((name) =>
      /create table (?:if not exists )?public\.(consumer_invoices|consumer_payments|consumer_charges)\b/.test(
        migration(name),
      ),
    );
    assert.deepEqual(
      invoiceTables,
      [],
      "a consumer invoice table exists now — the payment history can list real renewals instead of two events",
    );
  });

  it("says a payment method is on file without inventing which card", () => {
    // Premise, derived: migration 022 stores a provider reference and no brand or last four digits,
    // so the brand shown for years — "Visa ending 4242" — could not have come from any record.
    const billing = migration("022_billing_tables.sql");
    const subscriptionTable = billing.slice(
      billing.indexOf("create table if not exists public.consumer_subscriptions"),
      billing.indexOf(");", billing.indexOf("create table if not exists public.consumer_subscriptions")),
    );
    assert.doesNotMatch(
      subscriptionTable,
      /card_brand|card_last4|last_four|brand text/,
      "the card brand is stored now — render it instead of the unavailable notice",
    );

    const view = settingsView();
    assert.ok(
      view.includes("PAYMENT_METHOD_DETAIL_UNAVAILABLE"),
      "the durable card panel no longer explains why the brand is missing",
    );
    assert.ok(
      view.includes("PAYMENT_METHOD_ABSENT_NOTICE"),
      "a consumer with no card on file is not told so",
    );
    assert.ok(
      view.includes("subscription?.paymentMethodOnFile"),
      "the card panel no longer reads the durable payment-method presence",
    );
  });

  it("opens the actor-scoped hosted portal for both card edits and invoice management", () => {
    const view = settingsView();
    assert.match(
      view,
      /fetch\("\/api\/consumer\/billing-portal", \{\s*\n\s*cache: "no-store",\s*\n\s*credentials: "same-origin",\s*\n\s*method: "POST",/,
      "Account & Billing no longer requests its signed-in consumer portal session",
    );
    assert.match(
      view,
      /parsed\.protocol === "https:" && !parsed\.username && !parsed\.password/,
      "the browser follows an unvalidated provider URL",
    );
    assert.match(view, /window\.location\.assign\(hostedUrl\);/);
    assert.ok(view.includes("Manage billing &amp; invoices"), "invoice access is not visible in Payment history");
    assert.equal(
      [...view.matchAll(/onClick=\{\(\) => \{ void openBillingPortal\(\); \}\}/g)].length,
      2,
      "the card Edit and invoice-management actions no longer share the hosted portal boundary",
    );

    // A provider session needs a durable subscription/customer source. Pending bootstrap and a
    // genuinely absent subscription keep both controls inert, and the fixture keeps its local demo
    // card form without ever rendering the provider action.
    assert.match(view, /const billingPortalAvailable = billingDurable && subscription !== null;/);
    assert.equal(
      [...view.matchAll(/disabled=\{!billingPortalAvailable \|\| billingPortalPending\}/g)].length,
      2,
    );
    assert.match(view, /trailing=\{!enrollmentFixture \? \(/);
    assert.ok(view.indexOf("Manage billing &amp; invoices") > view.indexOf("{!enrollmentFixture ? ("));
    assert.ok(view.includes("BILLING_PORTAL_UNAVAILABLE"));
    assert.match(
      view,
      /!enrollmentFixture && !enrollmentPending && subscription === null \? \([\s\S]*?\{BILLING_PORTAL_UNAVAILABLE\}/,
      "the disabled billing action has no visible durable reason",
    );
    assert.ok(view.includes("Nothing was changed."));
  });

  it("treats an absent consent as absent rather than as an active permission", () => {
    const view = settingsView();
    // The fallback that produced the defect: component state initialised to `true`, which is right
    // for the fixture persona and wrong for everybody else.
    assert.match(
      view,
      /\?\? \(enrollmentFixture \? analysisActive : false\)/,
      "a missing analysis grant falls back to component state again",
    );
    assert.match(
      view,
      /\?\? \(enrollmentFixture \? monitoringActive : false\)/,
      "a missing monitoring grant falls back to component state again",
    );
    // And a read that has not landed is its own state — never "Revoked", which would be an outage
    // rendered as a settled fact about somebody's permissions (the G-HOST-14 class).
    assert.match(view, /enrollmentPending\s*\n?\s*\? "Not shown"/, "the pending consent state is gone");
    assert.ok(view.includes("CONSENT_ABSENT_DETAIL"), "the pre-enrollment consent explanation is gone");
  });

  it("offers no cancellation and no billed plan before an enrollment exists", () => {
    const view = settingsView();
    assert.ok(view.includes("SUBSCRIPTION_ABSENT_NOTICE"), "the pre-enrollment plan notice is gone");
    assert.match(
      view,
      /disabled=\{canceled \|\| enrollmentPending \|\| \(billingDurable && subscription === null\)\}/,
      "Cancel subscription is offered again against an account that was never billed",
    );
  });
});

describe("Overview states one analysis fact, not two contradictory ones", () => {
  it("the journey's onboarding line reads the same analysis fact the hero reads", () => {
    // The hero said "Awaiting your first completed analysis" while the journey row two panels below
    // said the first authorized analysis was complete. Both derive from `trackerClient.analysisAt`
    // now, so they cannot disagree.
    assert.match(
      consumer,
      /Onboarding: durable && !durable\.analysisComplete/,
      "the onboarding journey line asserts a completed analysis unconditionally again",
    );
    assert.match(
      consumer,
      /durable=\{\{ analysisComplete: trackerClient\.analysisAt !== null,/,
      "the journey's analysis fact no longer comes from the tracker read",
    );
    assert.match(
      consumer,
      /\? "Awaiting your first completed analysis"/,
      "the hero's waiting headline moved without this guard moving with it",
    );
  });

  it("removes the duplicate action-plan and credit-monitoring row from Overview", () => {
    const start = consumer.indexOf("function DashboardView");
    const end = consumer.indexOf("function useConsumerTracker", start);
    assert.ok(start !== -1 && end > start, "the Overview implementation could not be located");
    const overview = consumer.slice(start, end);
    assert.doesNotMatch(overview, /title="Your action plan"/);
    assert.doesNotMatch(overview, /title="Credit monitoring"/);
    assert.doesNotMatch(overview, /Open credit snapshot/);
  });
});
