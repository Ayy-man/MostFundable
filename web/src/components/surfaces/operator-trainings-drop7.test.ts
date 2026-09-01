import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { stripComments } from "@/lib/testing/strip-comments";

const operatorPath = new URL("./operator.tsx", import.meta.url);

async function knowledgeSource() {
  // Comments out, strings kept: the last assertion here forbids a hardcoded destination, and a
  // hardcoded destination is a string literal — so blanking strings would disarm the rule, while
  // reading raw meant any background URL in a comment inside `renderKnowledge()` failed it.
  const source = stripComments(await readFile(operatorPath, "utf8"));
  const start = source.indexOf("function renderKnowledge()");
  const end = source.indexOf("function renderTasks()", start);
  assert.ok(start >= 0 && end > start);
  return { full: source, knowledge: source.slice(start, end) };
}

describe("Drop 7 operator trainings", () => {
  it("renames the destination and exposes the exact ownership tabs", async () => {
    const { full, knowledge } = await knowledgeSource();
    assert.match(full, /id: "knowledge", label: "Client Trainings"/);
    assert.match(knowledge, /title="Client Trainings"/);
    assert.match(knowledge, /label: "Your Trainings", value: "your"/);
    assert.match(knowledge, /label: "Platform Trainings", value: "platform"/);
    assert.match(full, /useState<TrainingTab>\("your"\)/);
  });

  it("renders only operator-owned client records as list rows with edit and publication actions", async () => {
    const { knowledge } = await knowledgeSource();
    assert.match(
      knowledge,
      /training\.recordSource === "operator" && training\.apiAudience === "client"/,
    );
    assert.match(knowledge, /<Panel title="Your Trainings">[\s\S]*?divide-y divide-border/);
    assert.match(knowledge, /operator-owned client training/);
    assert.match(knowledge, /editing \? "Cancel edit" : "Edit"/);
    assert.match(knowledge, /training\.published \? "Unpublish" : "Publish"/);
    assert.match(knowledge, /trainingEditDraft/);
    assert.match(knowledge, />Cancel<\/Button>/);
    assert.match(knowledge, />Save changes<\/Button>/);
    assert.doesNotMatch(knowledge, /training\.audience === trainingAudience/);
  });

  it("keeps create, edit and publication on the existing routes with attestation", async () => {
    const { full, knowledge } = await knowledgeSource();
    assert.match(knowledge, /creating \? "\/api\/trainings" : `\/api\/trainings\/\$\{trainingEditDraft\.id\}`/);
    assert.match(knowledge, /method: creating \? "POST" : "PATCH"/);
    assert.match(knowledge, /`\/api\/trainings\/\$\{encodeURIComponent\(training\.id\)\}\/publication`/);
    assert.match(knowledge, /JSON\.stringify\(\{ attested: true \}\)/);
    assert.match(knowledge, /trainingAttestations\.has\(training\.id\)/);
    assert.match(knowledge, /ancillaryConfig\?\.attestationAvailable/);
    // Re-pinned by the Tier-2 eviction lane. The refusal is unchanged in shape — no create unless
    // the config read landed — but "disabled" alone is no longer enough to license the local
    // arm: with the ancillary set off, that arm let a signed-in operator create, rename and
    // publish lessons in component state, over a library seeded with six lessons that were never
    // theirs. `trainingsLocalFixture` is `!durableWorkspace`.
    assert.match(knowledge, /ancillaryConfigState !== "enabled" && !\(ancillaryConfigState === "disabled" && trainingsLocalFixture\)/);
    assert.match(full, /const trainingsLocalFixture = !durableWorkspace;/);
    assert.match(knowledge, /current\?\.recordSource !== "operator" \|\| current\.apiAudience !== "client"/);
    assert.match(knowledge, /training\.recordSource !== "operator" \|\| training\.apiAudience !== "client"/);
  });

  it("serializes publication per training and renders only the returned durable row", async () => {
    const { full, knowledge } = await knowledgeSource();
    const start = knowledge.indexOf("async function toggleTrainingPublication");
    const end = knowledge.indexOf("    return (", start);
    assert.ok(start >= 0 && end > start, "missing operator training publication mutation");
    const publication = knowledge.slice(start, end);
    const durableEnd = publication.indexOf("        } else {");
    assert.ok(durableEnd > 0, "missing durable/local publication boundary");
    const durablePublication = publication.slice(0, durableEnd);
    assert.match(full, /trainingPublicationPendingRef = useRef<Set<string>>/);
    assert.match(publication, /trainingPublicationPendingRef\.current\.has\(training\.id\)/);
    assert.match(publication, /trainingPublicationPendingRef\.current\.add\(training\.id\)/);
    assert.match(publication, /trainingRowFromResponse\(await response\.json\(\)\.catch\(\(\) => null\)\)/);
    assert.match(publication, /saved\.published !== targetPublished/);
    assert.match(publication, /row\.id === training\.id \? saved : row/);
    assert.doesNotMatch(durablePublication, /published: !row\.published/);
    assert.match(publication, /finally \{[\s\S]*trainingPublicationPendingRef\.current\.delete\(training\.id\)/);
    assert.match(knowledge, /disabled=\{trainingDeletePendingId !== null \|\| trainingPublicationPendingIds\.has\(training\.id\)/);
  });

  it("deletes only a durable operator-owned draft after confirmation and read-back", async () => {
    const { knowledge } = await knowledgeSource();
    const start = knowledge.indexOf("async function deleteTrainingDraft()");
    const end = knowledge.indexOf("async function toggleTrainingPublication", start);
    assert.ok(start >= 0 && end > start, "missing operator training delete mutation");
    const deletion = knowledge.slice(start, end);
    assert.match(deletion, /candidate\.recordSource !== "operator"/);
    assert.match(deletion, /candidate\.apiAudience !== "client"/);
    assert.match(deletion, /candidate\.published/);
    assert.match(deletion, /!isTrackerUuid\(candidate\.id\)/);
    assert.match(deletion, /`\/api\/trainings\/\$\{encodeURIComponent\(candidate\.id\)\}`/);
    assert.match(deletion, /cache: "no-store"[\s\S]*?credentials: "same-origin"[\s\S]*?method: "DELETE"/);
    assert.match(deletion, /response\.status !== 204/);
    assert.match(deletion, /fetch\("\/api\/trainings", \{[\s\S]*?cache: "no-store"/);
    assert.match(deletion, /rows\.some\(\(training\) => training\.id === candidate\.id\)/);
    assert.match(deletion, /setTrainings\(rows\)/);
    assert.match(knowledge, /<DialogTitle>Delete \{trainingDeleteCandidate\?\.title\}\?<\/DialogTitle>/);
    assert.match(knowledge, /trainingDeleteCandidate\?\.published === true/);
    assert.match(knowledge, /trainingDeleteCandidate\?\.recordSource !== "operator"/);
    assert.match(knowledge, /durableWorkspace \? \([\s\S]*?setTrainingDeleteCandidate\(training\)/);
    assert.match(knowledge, /server accepted the deletion, but the training library could not be read back/i);
  });

  it("renders only published platform records as validated read-only lesson links", async () => {
    const { full, knowledge } = await knowledgeSource();
    const start = knowledge.indexOf('trainingTab === "platform"');
    const end = knowledge.indexOf(') : ancillaryConfigState === "loading" ? (', start);
    assert.ok(start >= 0 && end > start);
    const platform = knowledge.slice(start, end);
    assert.match(
      knowledge,
      /training\.recordSource === "platform" && training\.published/,
    );
    assert.match(platform, /platformTrainings\.map\(\(training\)/);
    assert.match(platform, /href=\{training\.videoUrl\}/);
    assert.match(platform, /target="_blank"/);
    assert.match(platform, /rel="noreferrer"/);
    assert.match(platform, /ArrowUpRight/);
    assert.match(full, /parsed\.protocol === "https:"/);
    assert.match(full, /TRAINING_VIDEO_HOSTS\.has\(parsed\.hostname\.toLowerCase\(\)\)/);
    assert.match(full, /const rows = trainingRowsFromResponse\(await response\.json\(\)\)/);
    assert.doesNotMatch(platform, /Add training|Cancel edit|Save changes|Unpublish|Delete|Textarea|Input/);
  });

  it("shows loading, error, disabled and empty states without the external-link setting", async () => {
    const { full, knowledge } = await knowledgeSource();
    const start = knowledge.indexOf('trainingTab === "platform"');
    const end = knowledge.indexOf(') : ancillaryConfigState === "loading" ? (', start);
    assert.ok(start >= 0 && end > start);
    const platform = knowledge.slice(start, end);
    assert.match(platform, /Platform trainings are loading/);
    assert.match(platform, /Platform trainings are unavailable right now/);
    assert.match(platform, /Platform trainings are not connected to this workspace yet/);
    assert.match(platform, /title="No platform trainings"/);
    assert.match(platform, />\s*Retry\s*</);
    assert.doesNotMatch(full, /platformTrainingsUrl|PLATFORM_TRAININGS_URL/);
    assert.doesNotMatch(knowledge, /NEXT_PUBLIC|notion\.so|notion\.site|https:\/\//i);
  });
});
