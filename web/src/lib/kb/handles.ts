// The boundary where a grounding document stops being a record and becomes
// something a language model is allowed to read.
//
// F-05: `buildOperatorGrounding` handed the model `id: "tracker:<uuid>"` and
// `url: "/workspace/clients/<uuid>"`, and the only thing stopping it writing one
// of those into the answer was a sentence in the prompt. That worked, and it is
// a convention where rail 3 of the lane contract asks for a mechanism — the
// difference showing up the moment somebody edits the prompt for an unrelated
// reason.
//
// So the model is handed a per-request handle instead: `doc-1`, `doc-2`, in the
// order the builder produced them. A handle is opaque in the sense that matters
// — it names nothing outside the request that issued it, so it cannot be
// correlated with a row, a url, or another request's answer. Ordinals rather
// than random strings on purpose: nothing here needs unguessability (the table
// never leaves the process), and a random handle would make every request a
// different set of tokens, which costs the eval gate its determinism for no
// gain.
//
// Two smaller decisions carried here as well:
//
//   * The url does not go out at all. The model echoed it back only so the
//     citation check could compare it, and the check now compares a handle
//     against the table, which is both stricter and cheaper.
//   * Neither does the metadata. `{ kind: "tracker", clientId: <uuid> }` is
//     bookkeeping for our own code, and it was the second uuid in every
//     document.
//
// The uuid strip over what remains is a backstop, not the mechanism. Today no
// builder puts one in a title or a body, and the guard in
// `no-model-identifiers.test.ts` derives that claim from the builders rather
// than trusting this sentence — but a title is assembled from row data, and the
// day one carries a key the request should be clean anyway.

import { stripUuidShaped } from "./identifiers.ts";

import type { GroundingDocument } from "./chat-driver.ts";

const HANDLE_PREFIX = "doc-";

/** A grounding document as the model receives it: a handle, a title, a body. */
export interface VisibleGroundingDocument {
  readonly id: string;
  readonly title: string;
  readonly content: string;
}

export interface GroundingHandleTable {
  /** The documents to put in the request, in the order the builder produced them. */
  readonly visible: readonly VisibleGroundingDocument[];
  /** The document a handle names, or null when the model invented the handle. */
  resolve(handle: string): GroundingDocument | null;
  /** True when `text` contains any handle this table issued. */
  leaks(text: string): boolean;
  /**
   * `text` with every issued-handle mention repaired to the document's own
   * title. A handle is this table's private alias for a record it can name —
   * so a mention is not a secret escaping, it is the record named in the wrong
   * vocabulary, and the table is the one thing that can translate it back
   * deterministically. A decorative wrapping like "Jordan (doc-1)" drops the
   * parenthetical rather than doubling the name; a bare mention becomes the
   * title. Handles the table never issued are left alone, and the uuid strip is
   * a separate, unrepairable gate.
   */
  rewrite(text: string): string;
}

function tidy(value: string): string {
  return stripUuidShaped(value).replace(/\s+/g, " ").trim();
}

export function issueGroundingHandles(
  documents: readonly GroundingDocument[],
): GroundingHandleTable {
  const byHandle = new Map<string, GroundingDocument>();
  const visible: VisibleGroundingDocument[] = [];

  for (const [index, document] of documents.entries()) {
    const handle = `${HANDLE_PREFIX}${index + 1}`;
    byHandle.set(handle, document);
    visible.push({
      // The body keeps its own whitespace — it is JSON or article prose, and
      // collapsing it would change what the model is reading. Only the strip
      // applies.
      content: stripUuidShaped(document.content),
      id: handle,
      title: tidy(document.title),
    });
  }

  // One pattern rather than a scan per handle: an answer is scanned once, and
  // the alternation is built from the handles actually issued so a table of
  // three cannot report a leak of a fourth. `\b` after the trailing digit is
  // what keeps `doc-1` from matching inside `doc-12`, which matters as soon as a
  // workspace has ten documents.
  const pattern =
    byHandle.size === 0
      ? null
      : new RegExp(`\\b(?:${[...byHandle.keys()].join("|")})\\b`, "i");

  // The repair patterns mirror the leak pattern's alternation and boundaries.
  // Wrapped mentions go first so "Name (doc-1)" collapses to "Name" instead of
  // repeating it; whatever survives bare becomes the title. Replacement goes
  // through a function, not a string, so a title containing `$` cannot be
  // interpreted as a replacement pattern.
  const alternation = [...byHandle.keys()].join("|");
  const wrapped = byHandle.size === 0 ? null : new RegExp(`\\s*[(\\[]\\s*(?:${alternation})\\s*[)\\]]`, "gi");
  const bare = byHandle.size === 0 ? null : new RegExp(`\\b(${alternation})\\b`, "gi");
  const titleByHandle = new Map(visible.map((document) => [document.id.toLowerCase(), document.title]));

  return {
    leaks(text) {
      return pattern !== null && pattern.test(text);
    },
    resolve(handle) {
      return byHandle.get(handle) ?? null;
    },
    rewrite(text) {
      if (wrapped === null || bare === null) return text;
      return text
        .replace(wrapped, "")
        .replace(bare, (mention) => titleByHandle.get(mention.toLowerCase()) ?? mention);
    },
    visible,
  };
}
