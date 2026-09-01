// Citations become source chips here, and a chip that cannot be named is dropped.
//
// `buildOperatorGrounding` builds document ids in three shapes — `tracker:<id>`,
// `application:<id>` and `lender:<ref>:<version>` — and gives each a title. Two
// of those titles are safe to render and one is not: a client's document is
// titled with the client's display name, while an application and a lender are
// titled with the lender handle the vault knows them by. Rail 3 of the lane
// contract forbids putting that on screen, so this module resolves lender
// handles to names and drops what it cannot resolve.
//
// Dropping rather than falling back is the decision worth defending. The
// alternatives are worse in both directions: a placeholder chip ("a lender")
// invites a click that opens nothing, and a chip carrying the handle is the
// exact thing the rule forbids. An answer with one fewer chip is still an
// answer; an answer with an identifier in it is a defect.

import type { KbCitation } from '../kb/chat-driver.ts';
import type { AssistantSource } from './types.ts';

const TRACKER_PREFIX = 'tracker:';
const APPLICATION_PREFIX = 'application:';
const LENDER_PREFIX = 'lender:';
// The two `buildAdminGrounding` issues. Both carry a label the builder stamped
// and neither needs resolving through the vault, because an operator's name and
// a platform figure's name are already the words a reader would use.
const OPERATOR_PREFIX = 'operator:';
const METRIC_PREFIX = 'metric:';

/**
 * `lender:<bankRef>:<statsVersion>` — the ref is everything between the first
 * and last colon, because a lender handle may itself contain one.
 */
function bankRefFromLenderId(id: string): string | null {
  const rest = id.slice(LENDER_PREFIX.length);
  const lastColon = rest.lastIndexOf(':');
  const ref = lastColon === -1 ? rest : rest.slice(0, lastColon);
  return ref.length > 0 ? ref : null;
}

/**
 * The lender handle an application document names, read from its title.
 *
 * `buildOperatorGrounding` titles an application `Application <bankRef>`, and
 * the id carries the application's own uuid rather than the lender's — so the
 * title is the only place the handle appears. Reading it back is unattractive
 * and it is what the data allows; the alternative is dropping every application
 * chip, which would cost the answer its most useful provenance.
 */
function bankRefFromApplicationTitle(title: string): string | null {
  const match = /^Application\s+(.+)$/.exec(title.trim());
  return match === null ? null : match[1].trim() || null;
}

export function toAssistantSources(
  citations: readonly KbCitation[],
  bankLabels: ReadonlyMap<string, string>,
): readonly AssistantSource[] {
  const sources: AssistantSource[] = [];
  const seen = new Set<string>();

  for (const citation of citations) {
    let source: AssistantSource | null = null;

    if (citation.id.startsWith(TRACKER_PREFIX)) {
      // `label` rather than `title`: `citationLabel` is where the KB module
      // stamps the one string a surface is meant to print, having already
      // stripped anything uuid-shaped and substituted a generic phrase when
      // nothing legible survived. Reaching past it for `title` would be a second
      // render site deciding for itself, which is the leak that stamping exists
      // to close.
      const label = citation.label.trim();
      if (label.length > 0) source = { kind: 'client', label, ref: citation.id };
    } else if (citation.id.startsWith(LENDER_PREFIX)) {
      const bankRef = bankRefFromLenderId(citation.id);
      const label = bankRef === null ? undefined : bankLabels.get(bankRef)
        ?? (citation.label.startsWith('Bank · ') ? citation.label.slice('Bank · '.length) : undefined);
      if (label !== undefined && label.trim().length > 0) {
        source = { kind: 'bank', label: label.trim(), ref: citation.id };
      }
    } else if (citation.id.startsWith(OPERATOR_PREFIX)) {
      const label = citation.label.trim();
      if (label.length > 0) source = { kind: 'operator', label, ref: citation.id };
    } else if (citation.id.startsWith(METRIC_PREFIX)) {
      const label = citation.label.trim();
      if (label.length > 0) source = { kind: 'metric', label, ref: citation.id };
    } else if (citation.id.startsWith(APPLICATION_PREFIX)) {
      const bankRef = bankRefFromApplicationTitle(citation.title);
      const label = bankRef === null ? undefined : bankLabels.get(bankRef);
      if (label !== undefined && label.trim().length > 0) {
        source = { kind: 'metric', label: `Application to ${label.trim()}`, ref: citation.id };
      } else if (
        citation.title.startsWith('Application · ')
        && citation.label.startsWith('Application · ')
        && citation.label.trim().length > 0
      ) {
        // Workspace-tool documents already carry a sanitized, human label. The
        // legacy KB builder uses `Application <bankRef>` without this marker,
        // so it still has to resolve the handle through `bankLabels` above.
        source = { kind: 'metric', label: citation.label.trim(), ref: citation.id };
      }
    }

    if (source === null) continue;
    // One chip per source. The same client can be cited twice by a multi-part
    // answer, and a row of repeated chips reads as though the answer leaned on
    // more than it did.
    const key = `${source.kind}:${source.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }

  return sources;
}
