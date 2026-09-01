import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TRAINING_SOURCE_MAX_BYTES,
  trainingSourceAccept,
  validateTrainingSource,
} from "./training-source-contract.ts";

describe("platform training source contract", () => {
  it("normalizes a display filename without carrying path syntax into storage metadata", () => {
    const source = validateTrainingSource({
      bytes: new Uint8Array([1, 2, 3]),
      fileName: "../../Policy source final.PDF",
      mimeType: "application/pdf",
    });
    assert.equal(source.fileName, "Policy-source-final.pdf");
    assert.equal(source.sizeBytes, 3);
    assert.equal(source.mimeType, "application/pdf");
    assert.doesNotMatch(source.fileName, /[\\/]|\.\./);
  });

  it("accepts only the four extension and media-type pairs", () => {
    const accepted = [
      ["source.pdf", "application/pdf"],
      ["source.doc", "application/msword"],
      ["source.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["source.txt", "text/plain"],
    ] as const;
    for (const [fileName, mimeType] of accepted) {
      assert.equal(validateTrainingSource({ bytes: new Uint8Array([1]), fileName, mimeType }).fileName, fileName);
    }
    assert.throws(
      () => validateTrainingSource({ bytes: new Uint8Array([1]), fileName: "source.txt", mimeType: "application/pdf" }),
      /TRAINING_SOURCE_TYPE_INVALID/,
    );
    assert.throws(
      () => validateTrainingSource({ bytes: new Uint8Array([1]), fileName: "source.exe", mimeType: "application/octet-stream" }),
      /TRAINING_SOURCE_TYPE_INVALID/,
    );
  });

  it("rejects empty and oversized sources before a repository write", () => {
    for (const bytes of [new Uint8Array(), new Uint8Array(TRAINING_SOURCE_MAX_BYTES + 1)]) {
      assert.throws(
        () => validateTrainingSource({ bytes, fileName: "source.pdf", mimeType: "application/pdf" }),
        /TRAINING_SOURCE_SIZE_INVALID/,
      );
    }
    assert.match(trainingSourceAccept(), /\.pdf/);
    assert.match(trainingSourceAccept(), /\.docx/);
    assert.match(trainingSourceAccept(), /\.txt/);
  });
});
