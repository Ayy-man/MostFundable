// One definition of "looks like a stored key", used by everything that has to
// keep one away from a person or a provider.
//
// It was written twice before this file existed — once in `chat-driver.ts` to
// strip a citation label, once in the head of every reviewer who checked a
// grounding payload by eye. Two copies of a regex like this drift in the
// direction that matters: the strip stays strict, the check that nobody wrote
// gets skipped. So the pattern lives here, and the three callers that care
// import it.
//
// The shape is deliberately wider than a canonical uuid. It matches the
// hyphenated form with or without its final group, and the bare 32-hex form,
// because both appear in this tree — PostgREST returns the first and a
// fingerprint column carries the second.

const UUID_SHAPED_SOURCE = String.raw`\b[0-9a-f]{8}(?:-[0-9a-f]{4})+(?:-[0-9a-f]{12})?\b|\b[0-9a-f]{32}\b`;

/**
 * A fresh regex per call.
 *
 * `RegExp` objects with the `g` flag carry `lastIndex` across calls, so a shared
 * instance makes `test` alternate true and false on the same input. That is a
 * bug this repo has no way to notice from a passing suite, because the first
 * call in a test file is always the one that passes.
 */
function uuidShaped(): RegExp {
  return new RegExp(UUID_SHAPED_SOURCE, "gi");
}

export function containsUuidShaped(value: string): boolean {
  return uuidShaped().test(value);
}

/**
 * Remove every uuid-shaped run, leaving a single space behind.
 *
 * The replacement is a space rather than nothing so that two identifiers either
 * side of a separator do not fuse into a third token that looks like a word.
 * Callers that care about tidy prose collapse the whitespace themselves; a JSON
 * payload on its way to a provider does not care.
 */
export function stripUuidShaped(value: string): string {
  return value.replace(uuidShaped(), " ");
}
