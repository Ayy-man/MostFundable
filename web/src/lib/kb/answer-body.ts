// A supervised answer, in the one shape both the live path and the stored path
// can carry.
//
// F-09: the candidate schema was `{ answer: string, citations }` and the design
// brief asks for a headline, supporting bullets and a sources row. A surface
// handed one string has to parse prose back into structure, and the first time
// the model writes a paragraph where the surface expected bullets it renders
// wrong. So the model is now asked for the parts separately.
//
// The awkward half is persistence. `assistant_turns` has `body text` and no
// structured column, and adding one is a migration this lane does not own — so
// the structure has to survive a round trip through a single string. It does,
// because the string is one **this module writes**. Decoding a format we
// serialize is not the guessing the finding is about; the guessing was reading
// model prose and hoping. Nothing here ever runs against text a model wrote:
// `encodeAnswerBody` is the only writer, and its output is the only input
// `decodeAnswerBody` is designed for.
//
// The format, in full:
//
//     <headline>
//
//     - <bullet>
//     - <bullet>
//
// Headline and bullets are normalized to single lines when they are encoded, so
// the line structure is unambiguous on the way back, and **the first line is the
// headline by position, whatever it starts with** — see `decodeAnswerBody`, where
// the reason is a defect the property test found. The decode is total: any text
// at all decodes to something, and text with no bullet lines decodes to a
// headline and nothing else — which is what a row written before this format
// existed, or restored from elsewhere, will do.
//
// **The not-advice footer is deliberately not in here**, and the first draft of
// this module had it. It cost nothing while an answer had bullets and lost the
// footer into the headline the moment one did not, because with no bullet lines
// there is no position that distinguishes a second paragraph from a first. The
// repair is not a cleverer decode: the footer is a constant per scope, product
// copy rather than anything the model produced, so the surface renders it from
// the scope and it never needs to survive a round trip at all. Storing it in
// every row would have been duplicating a literal into the database as well.

/** The bullet marker. Exported because the decode is the only other place allowed to know it. */
export const ANSWER_BULLET_PREFIX = "- ";

export interface KbAnswerBody {
  /** One sentence. Never empty on an answered result. */
  readonly headline: string;
  /** Supporting points, one line each. May be empty. */
  readonly bullets: readonly string[];
}

function line(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function encodeAnswerBody(body: KbAnswerBody): string {
  const parts: string[] = [line(body.headline)];
  const bullets = body.bullets.map(line).filter((bullet) => bullet.length > 0);
  if (bullets.length > 0) {
    parts.push(bullets.map((bullet) => `${ANSWER_BULLET_PREFIX}${bullet}`).join("\n"));
  }
  return parts.join("\n\n");
}

/**
 * Read an encoded body back.
 *
 * **The first line is always the headline, whatever it starts with.** That rule
 * is not the obvious one — "a line opening with the marker is a bullet" was, and
 * it was wrong: a model that opens its headline with a dash produces a body
 * whose first line is indistinguishable from a bullet, so the headline
 * disappeared into the bullet list and the round trip stopped being a round
 * trip. The property test found it on its first generated case. Position is what
 * the encoder actually guarantees, so position is what the decode reads.
 *
 * After the first line: a line opening with the marker is a bullet, and anything
 * else joins the headline. That last clause is what makes the decode total for
 * input this module did not write — a row from before the format existed, a
 * hand-inserted one, a truncated write. It never throws, because this is a read
 * path that renders history and a body it refused would be a conversation
 * nobody could open.
 */
export function decodeAnswerBody(body: string): KbAnswerBody {
  const [first = "", ...rest] = body.split("\n");
  const headline: string[] = [first];
  const bullets: string[] = [];

  for (const value of rest) {
    if (!value.startsWith(ANSWER_BULLET_PREFIX)) {
      headline.push(value);
      continue;
    }
    // Exactly the one marker the encoder wrote, so a bullet whose own text opens
    // with a dash keeps it.
    const bullet = line(value.slice(ANSWER_BULLET_PREFIX.length));
    if (bullet.length > 0) bullets.push(bullet);
  }

  return { bullets, headline: line(headline.join(" ")) };
}
