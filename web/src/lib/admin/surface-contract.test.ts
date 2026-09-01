import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const surface = readFileSync(new URL("../../components/surfaces/admin.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/(surfaces)/admin/page.tsx", import.meta.url), "utf8");
const clientWrapper = readFileSync(new URL("../../app/(surfaces)/admin/surface-client.tsx", import.meta.url), "utf8");

function region(start: string, end: string): string {
  const from = surface.indexOf(start);
  const through = surface.indexOf(end, from);
  assert.ok(from >= 0 && through > from, `${start} region is missing`);
  return surface.slice(from, through);
}

describe("admin surface contract", () => {
  it("defaults the live flag false through both client boundaries", () => {
    assert.match(surface, /adminEnabled = false/);
    assert.match(clientWrapper, /adminEnabled = false/);
    assert.doesNotMatch(clientWrapper, /from "@\/lib\/env"/);
  });

  it("selects the four existing fixture views when the flag is false", () => {
    assert.ok(surface.includes("adminEnabled ? <GovernedAnalyticsBody /> : <AnalyticsBody />"));
    assert.ok(surface.includes("adminEnabled ? <GovernedPlatformSettingsSection /> : <PlatformSettingsSection />"));
    assert.ok(surface.includes("adminEnabled ? <GovernedPromptsSection /> : <PromptsSection />"));
    assert.ok(surface.includes("adminEnabled ? <GovernedEvaluatorsSection /> : <EvaluatorsSection />"));
  });

  it("keeps live analytics on client helpers with no direct fetch or database vocabulary", () => {
    const analytics = region("function GovernedAnalyticsBody()", "const GOVERNED_SETTING_LABELS");
    assert.match(analytics, /loadAdminAnalytics\("platform", day\)/);
    assert.match(analytics, /loadAdminLayout\(\)/);
    assert.doesNotMatch(analytics, /\bfetch\(|supabase|kpi_rollups|analysis_runs/i);
    assert.match(analytics, /No data/);
  });

  it("offers four tunables and a locked gate status without a gate control", () => {
    const settings = region("function GovernedPlatformSettingsSection()", "function AnalyticsBody()");
    assert.match(settings, /GOVERNED_SETTING_KEYS\.map/);
    assert.match(settings, /Gate policy remains code-owned/);
    assert.doesNotMatch(settings, /<Switch/);
  });

  it("reads FEATURE_ADMIN server-side after the existing role gate", () => {
    assert.ok(page.indexOf('requireRole(SURFACE_ROLE)') < page.indexOf('featureFlag("FEATURE_ADMIN")'));
    assert.match(page, /<AdminSurfaceClient adminEnabled=\{adminEnabled\}/);
  });

  it("offers a staged-version evaluation action through the governed client", () => {
    const prompts = region("function GovernedPromptsSection()", "function GovernedEvaluatorsSection()");
    assert.match(prompts, /evaluateAdminPromptVersion\(selected, version\)/);
    assert.match(prompts, />Evaluate<\/Button>/);
    assert.match(prompts, /Mock evaluation evidence cannot activate a prompt/);
  });

  it("formats every governed database instant instead of rendering raw ISO values", () => {
    const formatter = region("function formatInstant", "type IntelItem");
    assert.match(formatter, /typeof value !== "string"/);
    assert.match(formatter, /Number\.isFinite\(instant\.getTime\(\)\)/);
    assert.match(formatter, /timeZone: "UTC"/);
    assert.match(formatter, /return "Time unavailable"/);

    const support = region("function SupportTicketsSection()", "function SupportView()");
    assert.match(support, /formatInstant\(thread\.lastActivityAt\)/);
    assert.doesNotMatch(support, /Last activity \{thread\.lastActivityAt\}/);

    const prompts = region("function GovernedPromptsSection()", "function GovernedEvaluatorsSection()");
    assert.match(prompts, /formatInstant\(version\.createdAt\)/);
    assert.doesNotMatch(prompts, />\{version\.createdAt\}<\/p>/);

    const evaluators = region("function GovernedEvaluatorsSection()", "function PromptsSection()");
    assert.match(evaluators, /formatInstant\(evaluation\.ranAt\)/);
    assert.doesNotMatch(evaluators, />\{evaluation\.ranAt\}<\/TableCell>/);
  });

  it("renders stored audit evidence separately from browser-session actions", () => {
    const access = region("function SecurityView()", "/**\n * Why the hold decision");
    assert.match(access, /const storedAudit = useAdminAudit\(\)/);
    assert.match(access, /title="Stored platform audit trail"/);
    assert.match(access, /title="Current browser session"/);
    assert.ok(access.indexOf('title="Stored platform audit trail"') < access.indexOf('title="Current browser session"'));
    assert.match(access, /formatInstant\(event\.occurredAt\)/);
    assert.match(access, /actorName \?\? "Actor unavailable"/);
    assert.match(access, /Stored audit events could not be loaded, so this is not an empty audit trail/);
    assert.match(access, /The stored audit trail is not enabled on this deployment/);
    assert.match(access, /ariaLabel="Current session event risk"/);
    assert.doesNotMatch(access, /Immutable retention|SESSION_AUDIT_ONLY/);

    const stored = region('title="Stored platform audit trail"', 'title="Current browser session"');
    assert.doesNotMatch(stored, /event\.risk|Risk<\/TableHead>|risk:/);
    assert.match(stored, /Metadata is excluded/);
  });

  it("authors and governs trainings through persisted routes with server read-back", () => {
    const trainings = region("function TrainingsView({", "function FundedVolumePanel()");
    const readBack = region("async function mutateTrainingAndReadBack", "async function saveEditor");
    assert.ok(readBack.indexOf("await action()") < readBack.indexOf("await loadAdminTrainings()"));
    assert.match(readBack, /server accepted the change, but the training library could not be read back/i);
    assert.match(trainings, /if \(selectedSourceFile === null\) return/);
    assert.match(trainings, /createAdminTraining\(\{ \.\.\.input, sourceFile: selectedSourceFile \}\)/);
    assert.match(trainings, /updateAdminTraining\(editor\.id as string, \{ \.\.\.input,/);
    assert.match(trainings, /publishAdminTraining\(training\.id\)/);
    assert.match(trainings, /unpublishAdminTraining\(unpublishDraft\.id, unpublishDraft\.reason\)/);
    assert.match(trainings, /deleteAdminTraining\(deleteCandidate\.id\)/);
    assert.match(trainings, /config\?\.attestationAvailable/);
    assert.match(trainings, /config\?\.consoleOpsEnabled/);
    assert.match(trainings, /Takedown reason/);
    assert.match(trainings, /No stored trainings/);
    assert.match(trainings, /training library could not be loaded, so this is not an empty library/i);
  });

  it("requires, displays, and privately downloads the platform source attachment", () => {
    const trainings = region("type TrainingEditor", "function FundedVolumePanel()");
    for (const label of ["Training title", "Hosted video URL", "Lesson body", "Audience", "Source", "Source file"]) {
      assert.ok(trainings.includes(label), `${label} is not surfaced`);
    }
    assert.match(trainings, /editor\.id !== null \|\| editor\.sourceFile !== null/);
    assert.match(trainings, /accept=\{trainingSourceAccept\(\)\}/);
    assert.match(trainings, /adminTrainingSourcePath\(training\.id\)/);
    assert.match(trainings, /!training\.sourceFile/);
    assert.match(trainings, /A platform training needs a stored source file before it can be published/);
    assert.doesNotMatch(trainings, /no source-attachment field|file-upload relationship|TRAINING_ATTACHMENT_UNSUPPORTED/);
  });
});
