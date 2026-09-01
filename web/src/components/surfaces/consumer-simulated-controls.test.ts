import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/testing/strip-comments";

/**
 * The wiring-audit class: a control whose effect the platform cannot produce
 * must say so rather than move component state and claim an account record
 * changed. When a durable write arrives, this suite also verifies the surface
 * has moved onto that boundary instead of retaining the old refusal.
 * `docs/backend/UI-WIRING-BACKLOG.md` #1, #2, #3 and #4 are the four instances on
 * the consumer surface.
 *
 * Every assertion below derives its premise at test time — from the route tree,
 * the enrollment repository's exported mutations, and the grant and policy
 * statements in the migrations — and only then asserts what the surface must do
 * about it. That is deliberate, and it is the round-5 rule: an enumeration
 * transcribed from the reproduction rots the moment the platform grows the
 * missing endpoint, and a rotted enumeration is how ten of round 4's fixes were
 * defeated. Reauthorization now exists only for a previously signed and later
 * revoked permission; an initial missing signature remains an enrollment step.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../..");
const REPO = path.resolve(WEB, "..");

const consumer = fs.readFileSync(path.join(HERE, "consumer.tsx"), "utf8");

function read(relativeToRepo: string): string {
  return fs.readFileSync(path.join(REPO, relativeToRepo), "utf8");
}

function apiRouteFiles(): string[] {
  const root = path.join(WEB, "src/app/api");
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") found.push(full);
    }
  };
  walk(root);
  return found;
}

/**
 * Comments removed: every scan below is a claim about what the surface *renders*,
 * and a comment that quotes the sentence a fix deleted must not read as the
 * sentence still being there.
 */
const withoutComments = stripComments;

/** Every URL literal the surface actually passes to `fetch`. */
function fetchTargets(source: string): string[] {
  return [...source.matchAll(/fetch\(\s*[`"']([^`"']+)/g)].map((match) => match[1]);
}

describe("consumer controls follow their durable write boundaries", () => {
  it("#1 revoked consent reauthorization is wired while an unsigned initial consent still refuses", () => {
    // Initial grants are captured by enrollment. After a revocation, the only
    // additional grant path is the new signed, actor-scoped reauthorization RPC.
    const repository = read("web/src/lib/enrollment/repository.ts");
    const consentMutations = [
      ...repository.matchAll(/^export (?:async )?function (\w*[Cc]onsent\w*)/gm),
    ].map((match) => match[1]);
    assert.deepEqual(
      consentMutations,
      ["revokeConsent", "reauthorizeConsent"],
      "consent writes changed — verify the consumer permission controls against the new boundary",
    );

    const enrollmentRoutes = fs
      .readdirSync(path.join(WEB, "src/app/api/enrollments/[id]"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(
      enrollmentRoutes,
      ["agreement", "cancel", "idv", "reauthorize-consent", "revoke-consent"],
      "the enrollment route tree changed — check every signing and withdrawal control",
    );

    assert.ok(
      consumer.includes("/reauthorize-consent"),
      "the revoked permission control does not call the durable signing route",
    );
    assert.ok(
      consumer.includes("Sign and re-authorize"),
      "the revoked permission has no explicit signing step",
    );
    assert.ok(
      consumer.includes("accepted: true"),
      "the reauthorization request omits the affirmative authorization",
    );

    // Reauthorization cannot create a first grant. A Pending row with no prior
    // signed evidence therefore remains disabled and honest.
    assert.match(
      consumer,
      /status === "Pending" \? \([\s\S]*?<Button className="min-h-11" disabled/,
      "'Review and sign' is enabled again with no endpoint behind it",
    );
    assert.ok(
      !/notify\(`\$\{name\} signed\.`\)/.test(consumer),
      "the surface still reports a consent as signed without writing one",
    );
    assert.ok(
      consumer.includes("CONSENT_SIGNING_UNAVAILABLE"),
      "the honest-refusal notice for an unsigned authorization is gone",
    );
  });

  it("#2 the durable Optimization view is wired to the checklist write, and only the fixture shell still refuses", () => {
    // Premise, re-derived after migration 391 and the durable Optimization view:
    //
    //   still true — a browser session holds nothing but `select` on
    //     `checklist_item_state`; the write goes through one SECURITY DEFINER
    //     function that resolves the client from `auth.uid()`.
    //   true — exactly one route calls that function, and the durable view
    //     (`components/consumer/optimization-view.tsx` through
    //     `lib/optimization/client.ts`) reads `GET /api/optimization` and posts
    //     to it. `reported` on a durable workspace is hydrated from that read,
    //     never from component state.
    //   still true — the fixture shell's `toggleReported` keeps its refusal,
    //     because the fixture arm has no account to write to, and no arm may
    //     claim a report was stored anywhere it was not.
    const migration = read("supabase/migrations/003_analysis_tracker_foundation.sql");
    const grants = new Map(
      [...migration.matchAll(/grant ([a-z, ]+?) on table public\.checklist_item_state to (\w+);/g)]
        .map((match) => [match[2], match[1].trim()] as const),
    );
    assert.equal(
      grants.get("authenticated"),
      "select",
      "a browser session can write checklist state directly now — the RPC boundary is gone",
    );
    const writeRoutes = apiRouteFiles().filter((file) =>
      /report_checklist_item|reportChecklistItem/.test(fs.readFileSync(file, "utf8")),
    );
    assert.deepEqual(
      writeRoutes.map((file) => path.relative(WEB, file)),
      ["src/app/api/optimization/report/route.ts"],
      "the durable reporting route moved or vanished — this premise needs re-deriving, not patching",
    );
    const client = read("web/src/lib/optimization/client.ts");
    const clientCalls = fetchTargets(withoutComments(client));
    assert.deepEqual(
      [...new Set(clientCalls)].sort(),
      ["/api/optimization", "/api/optimization/report"],
      "the durable view no longer reads and writes through the optimization API",
    );
    const durableView = read("web/src/components/consumer/optimization-view.tsx");
    assert.match(durableView, /useConsumerOptimization\(/, "the durable view does not use the optimization client");
    assert.match(consumer, /<DurableOptimizationView\b/, "the surface does not render the durable Optimization view");

    // The fixture shell still refuses, and no arm claims persistence it does not have.
    assert.match(
      consumer,
      /if \(reportBlock === "no-durable-store"\) \{\s*\n\s*notify\(ACTION_REPORTING_UNAVAILABLE\);\s*\n\s*return;/,
      "toggleReported no longer refuses the write the fixture shell cannot persist",
    );
    for (const [name, source] of [["consumer.tsx", consumer], ["optimization-view.tsx", durableView]] as const) {
      const persistenceClaims = withoutComments(source).match(
        /report is saved|remains in the account record|saved to your account/gi,
      );
      assert.equal(persistenceClaims, null, `${name} claims a reported action was stored: ${persistenceClaims?.join(", ")}`);
    }
  });

  it("#3 nothing reads the durable applications, so the empty sequence is not blamed on the team", () => {
    // Premise, derived: the outcome and note routes take a consumer session, and
    // the surface calls neither them nor the list route — so its application list
    // is fixture state and its emptiness says nothing about the durable record.
    const notes = read("web/src/app/api/applications/[id]/notes/route.ts");
    assert.ok(
      notes.includes('if (role === "consumer") return "consumer"'),
      "the note route no longer accepts a consumer author",
    );
    const targets = fetchTargets(withoutComments(consumer));
    assert.deepEqual(
      targets.filter((url) => url.startsWith("/api/applications")),
      [],
      "the surface reads or writes durable applications now — render those rows instead of the notice",
    );

    assert.ok(
      consumer.includes("APPLICATIONS_UNAVAILABLE"),
      "the durable workspace is told again that its funding team added no sequence",
    );
  });

  it("#4 the profile editor applies durable read-back and keeps fixture changes session-only", () => {
    // The browser never updates `profiles` directly. Migration 411 introduced one actor-scoped
    // RPC for name and phone, while provider confirmation remains authoritative for email.
    const policy = read("supabase/migrations/411_consumer_profile_self_service.sql");
    assert.match(
      policy,
      /v_actor uuid := \(select auth\.uid\(\)\);/,
      "the profile RPC no longer binds the write to the authenticated actor",
    );
    assert.match(
      policy,
      /profile\.id = v_actor\s+and profile\.role = 'consumer'\s+and profile\.org_id is not null/,
      "the profile RPC no longer restricts the write to the signed-in durable consumer",
    );

    const client = read("web/src/lib/profile/consumer-profile.ts");
    assert.match(client, /fetcher\("\/api\/consumer\/profile", \{/);
    assert.match(client, /credentials: "same-origin"/);
    assert.match(client, /method: "PATCH"/);

    // A pending or failed email request returns the old durable email. The surface must display
    // that returned profile, not the optimistic draft, while naming the email state explicitly.
    assert.match(
      consumer,
      /const result = await updateConsumerProfile\(\{[\s\S]*?fullName: draft\.name,[\s\S]*?phone: draft\.phone,[\s\S]*?\}\);/,
      "the durable profile form no longer calls the scoped client helper",
    );
    assert.doesNotMatch(consumer, /!draft\.phone/, "a missing optional phone blocks unrelated profile edits");
    assert.match(consumer, /Mobile phone \(optional\)/);
    assert.match(
      consumer,
      /onUpdateProfile\(result\.profile\);\s*\n\s*setProfileDraft\(result\.profile\);/,
      "the profile form applies the draft instead of the server read-back",
    );
    assert.ok(consumer.includes('result.emailChange === "pending"'), "pending email confirmation is hidden");
    assert.ok(consumer.includes('result.emailChange === "failed"'), "failed email initiation is hidden");

    const fixtureBranch = consumer.indexOf("if (!profileDurable) {");
    const durableCall = consumer.indexOf("const result = await updateConsumerProfile", fixtureBranch);
    assert.ok(fixtureBranch >= 0 && durableCall > fixtureBranch, "the fixture editor is no longer isolated from the durable call");
    assert.ok(
      consumer.slice(fixtureBranch, durableCall).includes("Demo profile details updated for this session."),
      "the fixture editor claims an account-level save",
    );
    assert.doesNotMatch(consumer, /PROFILE_EDIT_UNAVAILABLE|disabled=\{!profileEditable\}/);
  });

  it("the durable workspace is named by the one field only the real-auth path sets", () => {
    // The discriminator every block above depends on. `DemoApp` builds its context
    // from the fixture roster and sets no displayName; the consumer route fills it
    // from the tracker client. If that stops being true, all four blocks silently
    // pick the wrong branch.
    const resolver = read("web/src/app/(surfaces)/consumer/application-context.server.ts");
    assert.match(
      resolver,
      /displayName: client\.displayName/,
      "the real-auth context no longer carries displayName",
    );
    const demoApp = read("web/src/components/demo/demo-app.tsx");
    assert.ok(
      !demoApp.includes("displayName"),
      "the fixture shell sets displayName now, so it would be treated as a durable workspace",
    );
    assert.ok(
      consumer.includes("const durableWorkspace = applicationContext.displayName !== undefined;"),
      "the durable-workspace discriminator changed without this guard changing with it",
    );
  });
});
