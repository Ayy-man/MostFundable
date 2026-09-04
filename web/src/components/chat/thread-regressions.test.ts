import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { CHAT_SCROLL_BEHAVIOR } from "./scroll-behavior";
import { EMPTY_THREAD_PREVIEW, threadPreview } from "./thread-preview";
import type { ChatThreadSummary } from "./types";

const HERE = import.meta.dirname;

describe("conversation opening", () => {
  it("anchors initial content instantly while later messages remain smooth", () => {
    assert.notEqual(
      CHAT_SCROLL_BEHAVIOR.initial,
      CHAT_SCROLL_BEHAVIOR.resize,
      "initial anchoring and later message arrival collapsed back to one behavior",
    );

    const source = fs.readFileSync(path.join(HERE, "../ai-elements/conversation.tsx"), "utf8");
    assert.match(
      source,
      /import \{ CHAT_SCROLL_BEHAVIOR \} from "@\/components\/chat\/scroll-behavior"/,
      "the conversation primitive does not read the shared scroll rule",
    );
    assert.match(
      source,
      /initial=\{CHAT_SCROLL_BEHAVIOR\.initial\}/,
      "opening a thread does not use the rule's initial anchoring",
    );
    assert.match(
      source,
      /resize=\{CHAT_SCROLL_BEHAVIOR\.resize\}/,
      "later message growth does not use the rule's resize behavior",
    );
  });
});

describe("thread list preview", () => {
  it("uses the message preview rule when a durable thread has no messages", () => {
    const empty = {
      preview: null,
      subtitle: "Business context that is not a message",
    } satisfies Pick<ChatThreadSummary, "preview" | "subtitle">;
    assert.equal(threadPreview(empty), EMPTY_THREAD_PREVIEW);
    assert.notEqual(threadPreview(empty), empty.subtitle);

    const source = fs.readFileSync(path.join(HERE, "thread-list.tsx"), "utf8");
    assert.match(
      source,
      /\{threadPreview\(thread\)\}/,
      "the rendered preview slot bypasses the rule and can fall through to non-message context",
    );
  });
});
