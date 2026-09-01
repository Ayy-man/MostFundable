import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const operatorPath = new URL("./operator.tsx", import.meta.url);

async function preferenceSections() {
  const source = await readFile(operatorPath, "utf8");
  const settingsStart = source.indexOf("function renderSettings()");
  const settingsEnd = source.indexOf("function renderWorkspaceSetup()", settingsStart);
  assert.ok(settingsStart >= 0 && settingsEnd > settingsStart, "missing Settings & Billing section");
  return { settings: source.slice(settingsStart, settingsEnd), source };
}

describe("durable operator workspace preferences", () => {
  it("loads saved preferences only when a durable workspace opens Settings", async () => {
    const { source } = await preferenceSections();
    assert.match(source, /if \(!durableWorkspace \|\| view !== "settings"\) return undefined/);
    assert.match(source, /readWorkspacePreferences\(\)/);
    assert.match(source, /setWorkspacePreferencesRead\(preferences === null[\s\S]*?state: "failed"[\s\S]*?preferences, state: "ready"/);
  });

  it("renders honest loading, failure, and retry states instead of fixture values", async () => {
    const { settings } = await preferenceSections();
    assert.match(settings, /Loading saved client portal preferences/);
    assert.match(settings, /Loading saved notification preferences/);
    assert.match(settings, /Client portal preferences are unavailable right now/);
    assert.match(settings, /Notification preferences are unavailable right now/);
    assert.equal((settings.match(/setWorkspacePreferencesReload\(\(current\) => current \+ 1\)/g) ?? []).length, 2);
    assert.equal((settings.match(/>\s*Retry\s*</g) ?? []).length, 2);
  });

  it("saves each portal and notification field through the allow-listed patch contract", async () => {
    const { settings } = await preferenceSections();
    const fields = [
      "portal_application_visibility",
      "portal_show_funding_progress",
      "portal_allow_document_uploads",
      "portal_show_trainings",
      "notification_email_holds",
      "notification_digest_enabled",
      "notification_digest_frequency",
      "notification_task_due",
      "notification_payment_failed",
      "notification_client_messages",
    ];
    for (const field of fields) {
      assert.match(
        settings,
        new RegExp(`persistWorkspacePreferences\\("${field}",[\\s\\S]*?${field}:`),
        `${field} is no longer persisted by its control`,
      );
    }
  });

  it("renders only server-confirmed readback and blocks overlapping saves", async () => {
    const { settings, source } = await preferenceSections();
    assert.match(source, /if \(!durableWorkspace \|\| workspacePreferencesSaving !== null\) return/);
    assert.match(source, /const saved = await saveWorkspacePreferences\(patch\)/);
    assert.match(source, /setWorkspacePreferencesRead\(\{ preferences: saved, state: "ready" \}\)/);
    assert.doesNotMatch(source, /setWorkspacePreferencesRead\(\{ preferences:.*patch/);
    assert.match(source, /The previous saved values remain shown/);
    assert.match(settings, /aria-busy=\{preferencesSaving\}/);
    assert.ok(
      (settings.match(/disabled=\{preferencesSaving\}/g) ?? []).length >= 9,
      "preference controls no longer stay disabled while a save is in flight",
    );
  });

  it("keeps the explicit fixture shell local while durable values come from the server", async () => {
    const { settings } = await preferenceSections();
    const durableReads = [
      "durablePreferences?.portal.applicationVisibility",
      "durablePreferences?.portal.showFundingProgress",
      "durablePreferences?.portal.allowDocumentUploads",
      "durablePreferences?.portal.showTrainings",
      "durablePreferences?.notifications.emailHolds",
      "durablePreferences?.notifications.digestEnabled",
      "durablePreferences?.notifications.digestFrequency",
      "durablePreferences?.notifications.taskDue",
      "durablePreferences?.notifications.paymentFailed",
      "durablePreferences?.notifications.clientMessages",
    ];
    for (const read of durableReads) assert.ok(settings.includes(read), `missing saved readback: ${read}`);

    const fixtureSetters = [
      "setWorkspaceApplicationPresentation(visibility)",
      "setPortalShowProgress(checked)",
      "setPortalAllowUploads(checked)",
      "setPortalShowTrainings(checked)",
      "setEmailHolds(checked)",
      "setWeeklyDigest(checked)",
      "setDigestFrequency(frequency)",
      "setNotifyTaskDue(checked)",
      "setNotifyPaymentFailed(checked)",
      "setNotifyClientMessages(checked)",
    ];
    for (const setter of fixtureSetters) assert.ok(settings.includes(setter), `fixture shell lost ${setter}`);
  });

  it("distinguishes persisted notification choices from unavailable email delivery", async () => {
    const { settings } = await preferenceSections();
    assert.match(settings, /These preferences are saved\. Email delivery is not connected/);
    assert.match(settings, /enabling an email preference does not send email yet/);
    assert.match(settings, /No email or messaging service is connected, and these preferences are not stored/);
  });
});
