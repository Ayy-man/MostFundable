/**
 * The types the AI Elements registry imports from the `ai` package, declared here instead.
 *
 * This is not a preference about dependency weight. Every model call in this product goes through
 * `lib/llm/chat-transport.ts`, which sends `provider: { zdr: true, data_collection: "deny" }`, and
 * through the supervisor gate in `lib/kb/chat-driver.ts` that reviews a candidate answer before
 * any of it reaches a screen. The Vercel AI SDK's `useChat` talks to its own `/api/chat` route
 * with its own transport and no supervisor anywhere in the path, so a component that quietly
 * imports from `ai` is one `npm install` away from a second, ungoverned way to reach a model.
 *
 * The package being absent is the enforcement — `import { streamText } from "ai"` does not
 * resolve. `scripts/verify-ai-transport.mjs` is the second half, because an absent package can be
 * installed by a CLI that thinks it is being helpful. It is: `shadcn add` pulled in both `ai` and
 * `streamdown` on the first attempt at this directory, which is exactly the accident the gate is
 * for.
 *
 * These declarations are ours, structurally compatible with the registry's usage and nothing more.
 */

/** Who said it. The registry writes `UIMessage["role"]`; these are the two values it renders. */
export type ChatRole = "user" | "assistant";

/**
 * One attachment on a message, standing in for the SDK's `FileUIPart`.
 *
 * `url` is a blob or object URL the browser made, never a storage path and never an id — rail 3
 * (no raw identifiers on screen) applies to `title` and `data-` attributes as much as to text.
 */
export interface AttachmentPart {
  readonly type: "file";
  /** Display name. Rendered, so it is a filename, not a key. */
  readonly filename?: string;
  /** MIME type, used only to choose between the image and the generic file presentation. */
  readonly mediaType?: string;
  readonly url?: string;
}
