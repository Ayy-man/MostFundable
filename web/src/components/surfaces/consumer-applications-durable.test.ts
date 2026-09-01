import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./consumer.tsx", import.meta.url), "utf8");

describe("durable consumer applications", () => {
  it("loads the signed-in projection and feeds both Funding and Applications", () => {
    assert.match(source, /readConsumerApplications\(\)/);
    assert.match(source, /consumerApplications=\{consumerApplicationsState\}/);
    assert.match(source, /<DurableMatchesView applicationsState=\{consumerApplications\}/);
    assert.match(source, /Counted approved outcomes/);
  });

  it("uses durable note and outcome routes, then reloads server read-back", () => {
    assert.match(source, /addConsumerApplicationNote\(applicationId, body\)/);
    assert.match(source, /recordConsumerApplicationOutcome\(applicationId, \{ amountCents, kind: submittedDraft\.kind \}\)/);
    assert.ok((source.match(/onReload\(\)/g) ?? []).length >= 4);
    assert.doesNotMatch(source.slice(source.indexOf("function DurableMatchesView"), source.indexOf("function MatchesView")), /recordApplicationOutcome\(|addApplicationNote\(/);
  });

  it("keeps drafts and pending state keyed to the application captured at submit time", () => {
    const durable = source.slice(source.indexOf("function DurableMatchesView"), source.indexOf("function MatchesView"));
    assert.match(durable, /noteDrafts, setNoteDrafts/);
    assert.match(durable, /outcomeDrafts, setOutcomeDrafts/);
    assert.match(durable, /pendingByApplication, setPendingByApplication/);
    assert.ok((durable.match(/const applicationId = selected\.id;/g) ?? []).length >= 2);
    assert.match(durable, /clearSubmittedConsumerNoteDraft\(current, applicationId, submittedDraft\)/);
    assert.match(durable, /clearSubmittedConsumerOutcomeDraft\(current, applicationId, submittedDraft\)/);
    assert.doesNotMatch(durable, /const \[noteDraft, setNoteDraft\]/);
    assert.doesNotMatch(durable, /const \[pending, setPending\]/);
  });

  it("withholds a partial funding total when an approved amount is private", () => {
    assert.match(source, /deriveConsumerApprovedFunding\(durableApplications\)/);
    assert.match(source, /One or more approved amounts are private/);
  });
});
