import { isKbProgressEvent, type KbProgressEvent } from "./progress.ts";

export const KB_NDJSON_CONTENT_TYPE = "application/x-ndjson";

export type KbStreamEvent<TResult = unknown> =
  | { readonly progress: KbProgressEvent }
  | { readonly result: TResult };

export function encodeKbStreamEvent<TResult>(event: KbStreamEvent<TResult>): string {
  return `${JSON.stringify(event)}\n`;
}

export function readKbStreamLines<TResult = unknown>(
  chunk: string,
  carry = "",
): { readonly events: readonly KbStreamEvent<TResult>[]; readonly carry: string } {
  const pieces = (carry + chunk).split("\n");
  const remainder = pieces.pop() ?? "";
  const events: KbStreamEvent<TResult>[] = [];

  for (const piece of pieces) {
    if (piece.trim().length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(piece);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const row = parsed as Record<string, unknown>;
      if (isKbProgressEvent(row.progress)) events.push({ progress: row.progress });
      else if (Object.hasOwn(row, "result")) events.push({ result: row.result as TResult });
    } catch {
      // A malformed progress line must not hide a valid terminal result behind it.
    }
  }

  return { carry: remainder, events };
}
