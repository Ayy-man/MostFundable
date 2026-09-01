/**
 * The one place a citation URL becomes an `href`, shared by both KB assistants.
 *
 * It lived in the consumer assistant until the Team Chat extraction moved that file under
 * `components/consumer/team-chat/`; the operator assistant imported it from there, and an operator
 * component reaching into a consumer directory for a URL parser is a coupling waiting to break the
 * first time either surface is rebuilt. The function itself is unchanged.
 *
 * `new URL()` accepts `javascript:` and `data:` happily — they are valid URLs. The protocol check
 * is what refuses them, and returning `null` rather than a sanitised string is deliberate: the
 * caller then has to decide what to render for a citation it cannot link, instead of emitting an
 * anchor that quietly goes nowhere.
 */
export function safeCitationHref(value: string): string | null {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; } catch { return null; }
}
