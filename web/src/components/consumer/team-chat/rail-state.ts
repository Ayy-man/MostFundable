/**
 * Which of the five states the context rail is in.
 *
 * This is one `if` chain and it is in its own module because the ordering is exactly the kind of
 * thing that reads correctly and is wrong. The case that caught it: `useTrackerClients` answers
 * `enabled: null` when it was never asked — `active: false`, which is what the demo shell passes —
 * and a chain that only recognises `enabled === false` as "not connected" falls through to the
 * empty state and tells the reader their funding team has not set up their record yet. That is a
 * statement about somebody's account, made because a read did not happen.
 *
 * So the rule is that only `enabled === true` means a read came back. Everything else is an
 * absence, and an absence is stated rather than interpreted.
 */

/** What the rail is handed, narrowed to the four things the decision actually turns on. */
export interface RailInput {
  /** `useTrackerClients`'s own three-valued answer: true read, false flag-off, null never asked. */
  readonly enabled: boolean | null;
  readonly error: boolean;
  readonly loading: boolean;
  /** Whether a client row was found for this reader. */
  readonly found: boolean;
}

export type RailStatus = "loading" | "error" | "disabled" | "empty" | "ready";

export function railStatusFor({ enabled, error, found, loading }: RailInput): RailStatus {
  if (loading) return "loading";
  if (error) return "error";
  // Not `enabled === false`. See the header — `null` is a read that never happened, and it has to
  // land here rather than on `empty`.
  if (enabled !== true) return "disabled";
  return found ? "ready" : "empty";
}
