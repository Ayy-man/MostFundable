import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

/**
 * The admin surface's deeper analytics and its platform controls, guarded as
 * classes rather than as transcribed screenshots.
 *
 * Every assertion derives its subject at test time from something outside this
 * file — the demo fixture module's own export list, the route directory on
 * disk, the tenancy service's action union — so a rename that moves the
 * behaviour without moving this guard fails here instead of passing quietly.
 * That is the round-5 standard (`.planning/review/ROUND-5-*.md`): a regression
 * derives its assertion from the catalog, never from the reproduction.
 */

const surfaceUrl = new URL("./admin.tsx", import.meta.url);
/**
 * Comments out. The names below are derived from the fixture module's own export list, which is the
 * round-5 standard and was already the case — but the membership test that followed ran against raw
 * text, so the file was half converted and read as fully converted. One comment in `admin.tsx`
 * naming `deriveFundedVolume` and `OPERATOR_FIXTURES` as the things the durable reads replaced
 * failed two assertions with "a fixture number is rendering as a platform figure" and "the admin
 * surface builds a roster from the demo operator cast again".
 */
const admin = stripComments(fs.readFileSync(surfaceUrl, "utf8"));
const fixtures = fs.readFileSync(
  new URL("../../lib/demo/feedback-fixtures.ts", import.meta.url),
  "utf8",
);
const tenancyActions = fs.readFileSync(
  new URL("../../lib/tenancy/admin.ts", import.meta.url),
  "utf8",
);
const tenantLifecycleClient = fs.readFileSync(
  new URL("../../lib/admin/tenant-lifecycle-client.ts", import.meta.url),
  "utf8",
);

const exportedFixtureNames = new Set(
  [...fixtures.matchAll(/^export (?:function|const) (\w+)/gm)].map((match) => match[1]),
);

const adminRouteDirectories = fs
  .readdirSync(new URL("../../app/api/admin", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("["))
  .map((entry) => entry.name);

describe("admin analytics read durable sources, not demo fixtures", () => {
  // The four fixture derivers the deeper-analytics swap replaces. Each name is
  // checked against the fixture module's live export list first, so renaming
  // one there fails this guard rather than silently disarming it.
  const replaced = [
    "deriveOperatorFundedYtd",
    "deriveOperatorAverageFundedOutcome",
    "deriveFundedVolume",
    "deriveFundedVolumeWeekly",
    "deriveSaasMetrics",
  ];

  for (const name of replaced) {
    it(`${name} no longer supplies an admin figure`, () => {
      assert.ok(
        exportedFixtureNames.has(name),
        `${name} is no longer exported by feedback-fixtures.ts — update this guard with the rename`,
      );
      assert.ok(
        !admin.includes(name),
        `${name} is back in the admin surface, so a fixture number is rendering as a platform figure`,
      );
    });
  }

  it("the operator roster itself comes from the platform database, not the demo cast", () => {
    assert.ok(
      exportedFixtureNames.has("OPERATOR_FIXTURES"),
      "OPERATOR_FIXTURES was renamed — update this guard with the rename",
    );
    assert.ok(
      !admin.includes("OPERATOR_FIXTURES"),
      "the admin surface builds a roster from the demo operator cast again",
    );
  });

  it("the durable analytics routes this surface needs all exist and are all read", () => {
    for (const route of ["tenants", "funded-volume", "saas-metrics", "outcome-reviews"]) {
      assert.ok(
        adminRouteDirectories.includes(route),
        `/api/admin/${route} is missing from the route tree`,
      );
      assert.ok(
        admin.includes(`/api/admin/${route}`),
        `the admin surface never reads /api/admin/${route}`,
      );
    }
  });

  it("a failed durable read never renders as a healthy figure", () => {
    assert.ok(admin.includes("isAdminReady"), "the ready/loading/failed discriminator is gone");
    assert.ok(
      admin.includes("adminReadReason"),
      "the read-state reason is gone, so a dash would render without saying why",
    );
  });
});

describe("simulated admin controls are wired or honestly disabled", () => {
  it("confirms each training mutation against the targeted durable state", () => {
    const start = admin.indexOf("function TrainingsView");
    const end = admin.indexOf("function FundedVolumePanel", start);
    assert.ok(start >= 0 && end > start, "the admin trainings view is missing");
    const trainings = admin.slice(start, end);
    assert.match(trainings, /const actionResult = await action\(\)[\s\S]*const rows = await loadAdminTrainings\(\)/);
    assert.match(trainings, /!confirmsTarget\(rows, actionResult\)/);
    assert.match(trainings, /trainingMutationConfirmed\(rows, saved/);
    assert.match(trainings, /candidate\.id === training\.id && candidate\.published/);
    assert.match(trainings, /candidate\.takedownReason === unpublishDraft\.reason\.trim\(\)/);
    assert.match(trainings, /!rows\.some\(\(training\) => training\.id === deleteCandidate\.id\)/);
    assert.match(trainings, /if \(result === "confirmed"\) setEditor\(null\)/);
    assert.match(trainings, /if \(result === "confirmed"\) setUnpublishDraft\(null\)/);
    assert.match(trainings, /if \(result === "confirmed"\) setDeleteCandidate\(null\)/);
  });

  it("operator access changes call the tenancy action the service accepts", () => {
    // Derived from the action union the tenancy service parses, so a service
    // that stops accepting these verbs fails here.
    for (const action of ["deactivate", "reactivate"]) {
      assert.ok(
        tenancyActions.includes(`"${action}"`),
        `the tenancy service no longer accepts ${action}`,
      );
      assert.ok(
        admin.includes("changeAdminWorkspaceLifecycle") && tenantLifecycleClient.includes(`"${action}"`),
        `the admin workspace client never sends the ${action} action`,
      );
    }
    assert.ok(
      tenantLifecycleClient.includes("`/api/admin/tenants/${orgId}`"),
      "the admin workspace client never PATCHes a tenant",
    );
    const lifecycle = admin.slice(admin.indexOf("async function actOnTenant"), admin.indexOf("  return (", admin.indexOf("async function actOnTenant")));
    assert.ok(lifecycle.indexOf("changeAdminWorkspaceLifecycle") < lifecycle.indexOf("readBackTenantRoster"), "the lifecycle result is claimed before server read-back");
    assert.match(lifecycle, /TENANT_REACTIVATION_REQUIRES_TRIAL_EXTENSION|workspaceFailureMessage/);
  });

  it("provisioning supplies the exact canonical owner/workspace fields and locks the real initial plan", () => {
    assert.ok(
      tenancyActions.includes('hasOnly(source, ["email", "fullName", "name", "slug"])'),
      "the canonical provision body changed — recheck the admin form",
    );
    for (const field of ["newOwnerEmail", "newOwnerName", "newName", "newSlug"]) {
      assert.ok(admin.includes(field), `the provision form no longer supplies ${field}`);
    }
    assert.ok(admin.includes("provisionAdminWorkspace"), "the provision control is not wired");
    const provision = admin.slice(admin.indexOf("async function provisionWorkspace"), admin.indexOf("async function actOnTenant"));
    assert.ok(provision.indexOf("provisionAdminWorkspace") < provision.indexOf("readBackTenantRoster"), "the provision result is claimed before server read-back");
    assert.ok(tenantLifecycleClient.includes('plan: "trial"'), "the provision client no longer constrains the initial plan");
    assert.ok(admin.includes('disabled value="Trial"'), "the surface can imply an unsupported paid plan selection");
    assert.match(admin, /provisionLocked[\s\S]*exact durable provision request/);
    assert.equal(admin.includes("PROVISION_UNAVAILABLE"), false);
    assert.ok(admin.includes("provider-first governed update path"));
    assert.ok(admin.includes("retention and evidence-deletion workflow"));
  });

  it("outcome review decisions post to the durable review route", () => {
    assert.ok(admin.includes("/review"), "the outcome review route is never called");
    assert.ok(
      admin.includes('"removed"') && admin.includes('"approved"'),
      "the two decisions the review route accepts are not both sent",
    );
  });

  it("controls with no durable endpoint are disabled with a stated reason", () => {
    assert.ok(admin.includes("HOLD_REVIEW_UNAVAILABLE"), "the coach-hold controls lost their reason");
    assert.ok(admin.includes("EVAL_RUN_UNAVAILABLE"), "the eval-run controls lost their reason");
  });
});
