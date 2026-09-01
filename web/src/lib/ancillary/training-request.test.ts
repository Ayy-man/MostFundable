import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parsePlatformTrainingForm, trainingSourceInputFromFile } from "./training-request.ts";
import { TRAINING_SOURCE_MAX_BYTES } from "./training-source-contract.ts";

function validForm(): FormData {
  const form = new FormData();
  form.set("audience", "operator");
  form.set("body", "Lesson body");
  form.set("title", "Lesson title");
  form.set("videoUrl", "https://youtu.be/source");
  form.set("sourceFile", new File([new Uint8Array([1, 2])], "source.pdf", { type: "application/pdf" }));
  return form;
}

describe("platform training multipart parser", () => {
  it("accepts the exact create form and keeps file bytes separate from content fields", async () => {
    const parsed = parsePlatformTrainingForm(validForm(), true);
    assert.ok(parsed?.sourceFile);
    assert.deepEqual(parsed.input, {
      audience: "operator",
      body: "Lesson body",
      title: "Lesson title",
      videoUrl: "https://youtu.be/source",
    });
    assert.deepEqual(await trainingSourceInputFromFile(parsed.sourceFile), {
      bytes: new Uint8Array([1, 2]),
      fileName: "source.pdf",
      mimeType: "application/pdf",
    });
  });

  it("rejects missing, duplicate, and caller-invented fields", () => {
    const missing = validForm();
    missing.delete("sourceFile");
    assert.equal(parsePlatformTrainingForm(missing, true), null);

    const duplicate = validForm();
    duplicate.append("title", "Second title");
    assert.equal(parsePlatformTrainingForm(duplicate, true), null);

    const widened = validForm();
    widened.set("bucket", "public-assets");
    assert.equal(parsePlatformTrainingForm(widened, true), null);
  });

  it("allows an edit with no replacement source but rejects a second source", () => {
    const form = validForm();
    form.delete("sourceFile");
    assert.equal(parsePlatformTrainingForm(form, false)?.sourceFile, null);
    form.append("sourceFile", new File(["one"], "one.txt", { type: "text/plain" }));
    form.append("sourceFile", new File(["two"], "two.txt", { type: "text/plain" }));
    assert.equal(parsePlatformTrainingForm(form, false), null);
  });

  it("bounds a file before allocating its array buffer", async () => {
    const file = new File([new Uint8Array(TRAINING_SOURCE_MAX_BYTES + 1)], "large.pdf", { type: "application/pdf" });
    await assert.rejects(() => trainingSourceInputFromFile(file), /TRAINING_SOURCE_SIZE_INVALID/);
  });
});
