/**
 * The one place that decides whether a training video may be framed in the product.
 *
 * A training row carries an arbitrary operator-supplied URL. Dropping that URL into an
 * `<iframe src>` would frame whatever the operator typed, so this maps only the three
 * hosts the write path already accepts (`VIDEO_HOSTS` in `./trainings.ts`) onto their
 * documented embed endpoints and returns `null` for everything else. A `null` means the
 * reader shows the link and no box: an un-embeddable video is a link, never a blank frame.
 */

/** The player URL for `videoUrl`, or `null` when the host is not one we frame. */
export function toEmbedUrl(videoUrl: string | null | undefined): string | null {
  if (!videoUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (host === "loom.com") {
    if (segments.length !== 2 || segments[0] !== "share") return null;
    const id = safeId(segments[1]);
    return id ? `https://www.loom.com/embed/${id}` : null;
  }

  if (host === "youtu.be") {
    if (segments.length !== 1) return null;
    const id = safeId(segments[0]);
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }

  if (host === "youtube.com" || host === "m.youtube.com") {
    if (parsed.pathname !== "/watch") return null;
    const id = safeId(parsed.searchParams.get("v"));
    return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }

  if (host === "vimeo.com") {
    if (segments.length !== 1 || !/^\d+$/.test(segments[0])) return null;
    return `https://player.vimeo.com/video/${segments[0]}`;
  }

  return null;
}

/**
 * The id, or `null` when it carries anything that would steer the embed URL
 * somewhere else once it is concatenated. Checked on the id itself rather than on
 * the finished string, where a trailing `../evil` reads as a clean last segment.
 */
function safeId(value: string | null): string | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return value;
}
