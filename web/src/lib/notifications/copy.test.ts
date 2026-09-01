import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { complianceLanguageCodes } from "@/lib/compliance/language-rules.mjs";

import {
  analysisCompleteCopy,
  applicationUpdateCopy,
  CONSENT_LABELS,
  documentCopy,
  DOCUMENT_SECTION_LABELS,
  enrollmentMilestoneCopy,
  ENROLLMENT_MILESTONE_LABELS,
  monitoringAlertCopy,
  refreshResultCopy,
  stageChangeCopy,
  STAGE_LABELS,
  teamMessageCopy,
  type NotificationCopy,
} from "./copy.ts";

const AT = "2026-08-24T10:30:00.000Z";

function renderedCopies(): NotificationCopy[] {
  return [
    monitoringAlertCopy(),
    refreshResultCopy(),
    analysisCompleteCopy(true, AT),
    analysisCompleteCopy(false, AT),
    ...Object.keys(STAGE_LABELS).map((stage) =>
      stageChangeCopy(stage as Parameters<typeof stageChangeCopy>[0], AT)),
    ...Object.values(ENROLLMENT_MILESTONE_LABELS).map((label) =>
      enrollmentMilestoneCopy(label, AT)),
    ...Object.values(CONSENT_LABELS).map((label) => enrollmentMilestoneCopy(label, AT)),
    ...Object.keys(DOCUMENT_SECTION_LABELS).map((section) =>
      documentCopy(section as Parameters<typeof documentCopy>[0])),
    teamMessageCopy("Morgan Lee"),
    teamMessageCopy(),
    applicationUpdateCopy("first", "example-community-bank", AT),
    applicationUpdateCopy("first", null, AT),
    applicationUpdateCopy("update", "example-community-bank", AT),
    applicationUpdateCopy("update", null, AT),
  ];
}

describe("notification copy", () => {
  it("passes every rendered title and detail through the canonical language rules", () => {
    for (const copy of renderedCopies()) {
      for (const value of [copy.title, copy.detail]) {
        assert.deepEqual(complianceLanguageCodes(value), [], value);
      }
    }
  });

  it("renders the revised analysis, refresh, application, and message templates exactly", () => {
    assert.equal(analysisCompleteCopy(true, AT).title, "Your analysis is complete");
    assert.equal(analysisCompleteCopy(false, AT).title, "Your funding plan was updated");
    assert.equal(
      analysisCompleteCopy(false, AT).detail,
      "Your plan's next steps were recalculated from the Aug 24 snapshot.",
    );
    assert.deepEqual(refreshResultCopy(), {
      title: "Your credit refresh is complete",
      detail: "Your plan and next steps were updated from the new snapshot.",
    });
    assert.deepEqual(applicationUpdateCopy("first", "example-community-bank", AT), {
      title: "An application to Example Community Bank was recorded",
      detail: "Your team recorded it on Aug 24. Open Your Funding for the record.",
    });
    assert.deepEqual(applicationUpdateCopy("update", "example-community-bank", AT), {
      title: "There's an update on your Example Community Bank application",
      detail: "Your team recorded it on Aug 24. Open Your Funding for the record.",
    });
    assert.deepEqual(teamMessageCopy("Morgan Lee"), {
      title: "New message from Morgan Lee",
      detail: "Open Team Chat to read it.",
    });
    assert.equal(teamMessageCopy().title, "New message from your team");
  });

  it("keeps internal refresh, application, and version vocabulary out of rendered copy", () => {
    for (const copy of renderedCopies()) {
      assert.doesNotMatch(`${copy.title} ${copy.detail}`, /\b(?:outcome|paid|v\d+)\b/i);
    }
  });
});

// §9 (2026-08-25): the document title is number-neutral, because two of the section labels are
// plural and "Your bank statements was received" is the sentence the old template produced.
it("document titles are number-neutral for every section label", () => {
  for (const [section, label] of Object.entries(DOCUMENT_SECTION_LABELS)) {
    const copy = documentCopy(section as Parameters<typeof documentCopy>[0]);
    assert.equal(copy.title, `New ${label} received`);
    assert.doesNotMatch(copy.title, /\b(was|were) received\b/);
  }
});
