"use client";

// A clock, and deliberately nothing else.
//
// This is the only timer in the assistant workspace, and it exists so that the file holding the
// stage state does not hold a timer. That separation is the point rather than a tidiness
// preference: "no lane may animate through stages on a timer" (contract §0 R1) is the rule most
// easily broken by accident, because the accident looks like a small convenience — an interval
// beside a `setStage` that advances the label when the server has gone quiet. With the interval in
// its own module, `rails.test.ts` can assert that no file setting a stage contains a timer at all,
// which turns the rule into a fact about the tree.
//
// What it returns is the wall clock, not an elapsed count: the caller owns the arithmetic, and a
// hook that returned "seconds since something started" would be one refactor away from being asked
// to return "percent complete".

import { useEffect, useState } from "react";

/**
 * `Date.now()`, refreshed once a second while `active`, and `0` before the first tick.
 *
 * Zero rather than `Date.now()` at mount, because an initial value read during render would differ
 * between the server pass and the browser pass and produce a hydration mismatch — and because a
 * caller that clamps against its own start time reads zero as "no time has passed yet", which is
 * true for the first second of every wait.
 */
export function useTickingClock(active: boolean): number {
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  return nowMs;
}
