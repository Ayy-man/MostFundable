import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/testing/strip-comments";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = stripComments(readFileSync(path.join(here, "consumer.tsx"), "utf8"));
const matchesView = source.slice(
  source.indexOf("function MatchesView"),
  source.indexOf("function CreditScoreCard"),
);
const onboardingView = source.slice(
  source.indexOf("function OnboardingHubView"),
  source.indexOf("function SettingsView"),
);
const consumerSurface = source.slice(source.indexOf("export function ConsumerSurface"));

describe("consumer workspace portal preferences", () => {
  it("reads preferences only for a durable consumer and never opens on a failed read", () => {
    assert.match(
      consumerSurface,
      /useState<PortalPreferencesReadState>\(\s*durableWorkspace \? "loading" : "fixture"/,
    );
    assert.match(
      consumerSurface,
      /if \(!durableWorkspace\) return;[\s\S]{0,500}readWorkspacePreferences\(\)/,
    );
    assert.match(
      consumerSurface,
      /setPortalPreferencesState\(preferences \? "ready" : "unavailable"\)/,
    );
    assert.doesNotMatch(source, /DEFAULT_WORKSPACE_PREFERENCES/);
    assert.match(
      consumerSurface,
      /portalPreferencesState === "unavailable"[\s\S]{0,900}PORTAL_PREFERENCES_UNAVAILABLE/,
    );
  });

  it("keeps the fixture shell open while every durable feature waits for a valid read", () => {
    assert.match(
      consumerSurface,
      /const trainingsVisible = !durableWorkspace\s*\|\| \(portalPreferencesReady && portalPreferences\.portal\.showTrainings\)/,
    );
    assert.match(
      consumerSurface,
      /const documentUploadsAllowed = !durableWorkspace\s*\|\| \(portalPreferencesReady && portalPreferences\.portal\.allowDocumentUploads\)/,
    );
    assert.match(
      consumerSurface,
      /const showFundingProgress = !durableWorkspace\s*\|\| \(portalPreferencesReady && portalPreferences\.portal\.showFundingProgress\)/,
    );
    assert.match(
      consumerSurface,
      /const applicationVisibility:[\s\S]{0,180}portalPreferencesReady \? portalPreferences\.portal\.applicationVisibility : null/,
    );
  });

  it("removes hidden trainings from navigation, fetching, and the selected surface", () => {
    assert.match(
      consumerSurface,
      /if \(!trainingsEnabled \|\| !trainingsVisible\) return;/,
    );
    assert.match(
      consumerSurface,
      /platformNavItems\.filter\(\(item\) => item\.id !== "learning"\)/,
    );
    assert.match(consumerSurface, /content = trainingsVisible \? \(/);
    assert.match(
      consumerSurface,
      /if \(trainingsVisible \|\| activeView !== "learning"\) return;[\s\S]{0,240}setActiveView\("dashboard"\)/,
    );
  });

  it("removes every upload picker and also guards each upload action", () => {
    assert.equal(
      [...onboardingView.matchAll(/if \(!documentUploadsAllowed\)/g)].length,
      4,
      "chooseFiles, uploadLive, uploadReport, and openFilePicker must all refuse",
    );
    assert.match(onboardingView, /documentUploadsAllowed \? <input/);
    assert.match(onboardingView, /ancillaryEnabled && documentUploadsAllowed \? <input/);
    assert.match(onboardingView, /ancillaryEnabled && documentUploadsAllowed \? <div/);
    assert.match(onboardingView, /documentUploadsAllowed \? <Button/);
    assert.match(onboardingView, /DOCUMENT_UPLOADS_DISABLED/);
    assert.match(onboardingView, /DOCUMENT_UPLOADS_LOADING/);
    assert.match(onboardingView, /DOCUMENT_UPLOADS_UNAVAILABLE/);
  });

  it("hides the durable funded-to-date metric when funding progress is off", () => {
    assert.match(
      source,
      /trackerOverviewMetrics\?\.bottom\.filter\(\s*\(metric\) => showFundingProgress \|\| metric\.label !== "Funding approved"/,
    );
    assert.equal(
      [...consumerSurface.matchAll(/showFundingProgress=\{showFundingProgress\}/g)].length,
      2,
      "both the normal Overview and the hidden-training fallback must use the preference",
    );
  });

  it("uses the persisted Matches default and withholds details when it is unknown", () => {
    assert.match(
      matchesView,
      /const presentation = durableWorkspace\s*\? applicationVisibility \?\? "status-only"\s*: resolveApplicationPresentation\(clientId\)/,
    );
    assert.match(
      matchesView,
      /applicationVisibility === null[\s\S]{0,300}bank and product details stay hidden/,
    );
    assert.match(matchesView, /Visibility unavailable/);
    assert.match(matchesView, /presentation === "details"/);
  });
});
