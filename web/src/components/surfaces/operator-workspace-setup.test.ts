import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const operatorPath = new URL("./operator.tsx", import.meta.url);

async function workspaceSetupSource() {
  const source = await readFile(operatorPath, "utf8");
  const renderStart = source.indexOf("function renderWorkspaceSetup()");
  const renderEnd = source.indexOf("function renderCurrentView()", renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart, "missing Workspace Setup section");
  return { setup: source.slice(renderStart, renderEnd), source };
}

describe("durable operator Workspace Setup access settings", () => {
  it("hydrates access and assignment only when the durable access view opens", async () => {
    const { source } = await workspaceSetupSource();
    assert.match(
      source,
      /if \(!durableWorkspace \|\| view !== "onboarding" \|\| workspaceSetupTab !== "access"\)/,
    );
    assert.match(source, /readWorkspaceAccessSettings\(\)/);
    assert.match(
      source,
      /setWorkspaceAccessConfirmed\(result\.settings\)[\s\S]*?setTeamSeesAllClients\(result\.settings\.teamSeesAllClients\)[\s\S]*?setClientAssignmentMode\(result\.settings\.assignmentMode\)[\s\S]*?setWorkspaceAccessState\("ready"\)/,
    );
  });

  it("shows loading, saving, unavailable, failure, and retry states honestly", async () => {
    const { setup, source } = await workspaceSetupSource();
    assert.match(setup, /Loading saved access and assignment settings/);
    assert.match(setup, /Saving access and assignment settings/);
    assert.match(source, /Workspace access settings are not available on this deployment/);
    assert.match(source, /Workspace access settings could not be loaded/);
    assert.match(setup, /role=\{workspaceAccessFeedback\.kind === "error" \? "alert" : "status"\}/);
    assert.match(setup, /setWorkspaceAccessReload\(\(current\) => current \+ 1\)/);
    assert.match(setup, />\s*Retry\s*</);
    assert.match(setup, /accessHasConfirmedValues \? \(/);
    assert.match(setup, /disabled=\{accessControlsDisabled\}/);
    assert.match(
      source,
      /function Segmented<T extends string>\(\{[\s\S]*?disabled = false,[\s\S]*?disabled\?: boolean;[\s\S]*?disabled=\{disabled\}/,
    );
  });

  it("persists both values and renders the server-confirmed read-back", async () => {
    const { setup, source } = await workspaceSetupSource();
    assert.match(source, /const result = await saveWorkspaceAccessSettings\(next\)/);
    assert.match(
      source,
      /if \(result\.outcome === "ready"\) \{[\s\S]*?setWorkspaceAccessConfirmed\(result\.settings\)[\s\S]*?setTeamSeesAllClients\(result\.settings\.teamSeesAllClients\)[\s\S]*?setClientAssignmentMode\(result\.settings\.assignmentMode\)/,
    );
    assert.match(
      setup,
      /persistWorkspaceAccess\("team_sees_all_clients", \{[\s\S]*?assignmentMode: clientAssignmentMode,[\s\S]*?teamSeesAllClients: checked/,
    );
    assert.match(
      setup,
      /persistWorkspaceAccess\("assignment_mode", \{[\s\S]*?assignmentMode: mode,[\s\S]*?teamSeesAllClients/,
    );
  });

  it("optimistically updates, then restores the last confirmed pair after a failed save", async () => {
    const { source } = await workspaceSetupSource();
    assert.match(
      source,
      /const previous = workspaceAccessConfirmed;[\s\S]*?setTeamSeesAllClients\(next\.teamSeesAllClients\)[\s\S]*?setClientAssignmentMode\(next\.assignmentMode\)[\s\S]*?await saveWorkspaceAccessSettings\(next\)/,
    );
    assert.match(
      source,
      /setTeamSeesAllClients\(previous\.teamSeesAllClients\)[\s\S]*?setClientAssignmentMode\(previous\.assignmentMode\)[\s\S]*?The last confirmed values were restored/,
    );
    assert.match(
      source,
      /workspaceAccessState !== "ready"[\s\S]*?workspaceAccessSaving !== null[\s\S]*?workspaceAccessConfirmed === null/,
    );
  });

  it("keeps fixture controls local and clears a durable inbox draft only after save succeeds", async () => {
    const { setup } = await workspaceSetupSource();
    assert.match(
      setup,
      /persistWorkspaceAccess\("team_sees_all_clients",[\s\S]*?\.then\(\(saved\) => \{[\s\S]*?if \(saved\) inbox\.setReplyDraft\(""\)/,
    );
    assert.match(
      setup,
      /\} else \{[\s\S]*?setTeamSeesAllClients\(checked\)[\s\S]*?inbox\.setReplyDraft\(""\)/,
    );
    assert.match(
      setup,
      /\} else \{[\s\S]*?setClientAssignmentMode\(mode\)/,
    );
    assert.match(setup, /This fixture control changes the current page only/);
    assert.match(setup, /Changes last for this visit only/);
  });

  it("describes durable brand publishing and governed client invitations accurately", async () => {
    const { setup, source } = await workspaceSetupSource();
    assert.match(
      setup,
      /Brand setup saves and publishes the portal theme and logo, client invitations use the governed invite flow, and access settings are saved to this workspace/,
    );
    assert.match(setup, /Brand saved and published\. Client invitation sent to/);
    assert.match(setup, /Brand saved and published\. No client invitation was entered/);
    assert.match(setup, /initialBrand=\{liveTenantBrand\}/);
    assert.match(setup, /initialBusinessName=\{liveWorkspaceName\}/);
    assert.match(setup, /setLiveTenantBrand\(setup\.brand\)/);
    assert.match(setup, /setLiveWorkspaceName\(setup\.businessName\)/);
    assert.match(
      source,
      /const workspaceBrandName = liveTenantBrand\?\.portalName \?\? liveWorkspaceName/,
    );
    assert.match(setup, /Invitation sent to \$\{email\} through the governed client invite flow/);
    assert.match(setup, /The client record will be created after acceptance/);
    assert.match(setup, /Saved for this workspace and enforced by the backend/);
    assert.match(setup, /saved workspace assignment default/);
    assert.doesNotMatch(setup, /no logo file or client invitation was stored or sent/i);
    assert.doesNotMatch(setup, /No client email was sent/i);
    assert.doesNotMatch(setup, /rest of this section is not stored/i);
    assert.doesNotMatch(setup, /access and assignment settings are not stored/i);
  });
});
