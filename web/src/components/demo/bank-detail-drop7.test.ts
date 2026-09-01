import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { BANK_DETAILS } from "@/lib/demo/co-fixtures";
import { BANK_FIXTURES } from "@/lib/demo/feedback-fixtures";

const sheetSource = fs.readFileSync(
  new URL("./bank-detail-sheet.tsx", import.meta.url),
  "utf8",
);
const operatorSource = fs.readFileSync(
  new URL("../surfaces/operator.tsx", import.meta.url),
  "utf8",
);
const adminSource = fs.readFileSync(
  new URL("../surfaces/admin.tsx", import.meta.url),
  "utf8",
);

const standingQuestionIds = [
  "projected-revenue",
  "projected-personal-income",
  "projected-monthly-spend",
  "projected-employees",
];

describe("Drop 7 bank detail", () => {
  it("keeps one complete local detail row for each of the seven fixture banks", () => {
    assert.equal(BANK_FIXTURES.length, 7);
    assert.deepEqual(Object.keys(BANK_DETAILS).sort(), BANK_FIXTURES.map((bank) => bank.id).sort());

    for (const bank of BANK_FIXTURES) {
      const detail = BANK_DETAILS[bank.id];
      assert.ok(detail, `missing detail fixture for ${bank.id}`);
      assert.equal(detail.bankId, bank.id);
      assert.ok(detail.sourceUpdatedAt);
      assert.equal(typeof detail.checking.required, "boolean");
      assert.ok(detail.checking.seasoning);
      assert.ok(detail.checking.depositAmountCents === null || (Number.isInteger(detail.checking.depositAmountCents) && detail.checking.depositAmountCents >= 0));
      assert.equal(typeof detail.relationshipManager.required, "boolean");
      assert.ok(detail.relationshipManager.tip.trim());
    }
  });

  it("validates each discriminated channel without inventing an in-person destination", () => {
    for (const detail of Object.values(BANK_DETAILS)) {
      if (detail.applyChannel.type === "online") {
        assert.equal(new URL(detail.applyChannel.value).protocol, "https:");
      } else if (detail.applyChannel.type === "phone") {
        assert.match(detail.applyChannel.value, /^\+1-[0-9-]+$/);
      } else {
        assert.equal(detail.applyChannel.value, null);
      }
    }
    assert.ok(Object.values(BANK_DETAILS).some((detail) => detail.applyChannel.type === "online"));
    assert.ok(Object.values(BANK_DETAILS).some((detail) => detail.applyChannel.type === "phone"));
    assert.ok(Object.values(BANK_DETAILS).some((detail) => detail.applyChannel.type === "in-person"));
  });

  it("keeps the four standing questions first and every question id unique", () => {
    for (const detail of Object.values(BANK_DETAILS)) {
      assert.deepEqual(detail.applicationQuestions.slice(0, 4).map((question) => question.id), standingQuestionIds);
      assert.equal(new Set(detail.applicationQuestions.map((question) => question.id)).size, detail.applicationQuestions.length);
      for (const question of detail.applicationQuestions) {
        assert.ok(question.label.trim());
        assert.ok(question.responseBasis.trim());
      }
    }
  });

  it("renders the bounded sheet contract and literal inferred-referent marker", () => {
    assert.ok(sheetSource.includes("TODO(#212: confirm referent vs screenshot)"));
    assert.ok(sheetSource.includes("30-day data"));
    assert.ok(sheetSource.includes("For educational purposes only. This page does not provide an offer or decision."));
    for (const title of ["Channel", "Checking account", "Relationship manager", "Application questions"]) {
      assert.ok(sheetSource.includes(`title=\"${title}\"`), `missing ${title}`);
    }
    for (const removed of ["periodLabel", 'title="Context"', 'title="Qualification summary"', 'title="Products"', 'title="Before applying"', 'title="How to apply"', 'title="Data points"']) {
      assert.equal(sheetSource.includes(removed), false, `obsolete sheet source remains: ${removed}`);
    }

    const header = sheetSource.slice(sheetSource.indexOf("<SheetHeader"), sheetSource.indexOf("</SheetHeader>"));
    assert.ok(header.includes("<Landmark"));
    assert.ok(header.includes("<SheetTitle>{bank.bankName}</SheetTitle>"));
    assert.equal(header.includes("momentum"), false);
    assert.equal(header.includes("sourceUpdatedAt"), false);
  });

  it("pins both detail callers to the recorded 30-day outcome collection", () => {
    for (const [name, source] of [["operator", operatorSource], ["admin", adminSource]] as const) {
      const start = source.lastIndexOf("<BankDetailSheet");
      const call = source.slice(start, source.indexOf("/>", start));
      assert.ok(call.includes('bankStatsByPeriod["30d"]'), `${name} detail is not pinned to 30d`);
      assert.equal(call.includes("periodLabel"), false);
    }
  });
});
