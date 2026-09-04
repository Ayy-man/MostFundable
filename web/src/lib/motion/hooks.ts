"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/*
 * Small motion hooks shared by the consumer, operator and affiliate surfaces.
 * They exist so that a number that changes, a row that arrives, and a row that
 * leaves all move the same way everywhere, and so that reduced motion is
 * honoured in one place rather than per call site.
 *
 * Written to the React Compiler's rules: no ref is read during render and no
 * effect sets state synchronously. Where a hook needs to notice that a value
 * changed, it derives that during render with the documented "store the
 * previous prop in state" pattern, and any later clean-up runs from a timer.
 */

const REDUCE = "(prefers-reduced-motion: reduce)";

function subscribeReduce(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function readReduce(): boolean {
  return window.matchMedia(REDUCE).matches;
}
function readReduceServer(): boolean {
  return false;
}

/** True when the OS asks for reduced motion. False on the server. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduce, readReduce, readReduceServer);
}

/** The value this hook saw before `value` last changed; `undefined` until it has changed once. */
export function usePrevious<T>(value: T): T | undefined {
  const [pair, setPair] = useState<{ current: T; previous: T | undefined }>({ current: value, previous: undefined });
  if (!Object.is(pair.current, value)) {
    setPair({ current: value, previous: pair.current });
    return pair.current;
  }
  return pair.previous;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Counts from the previously shown value to `target` over `durationMs` on an
 * ease-out curve, in whole numbers. The first value a mount sees animates from
 * zero, so a figure that lands on load counts up; every later change counts
 * from where it was. `null` renders as `null` and does not animate. Reduced
 * motion jumps straight to the target.
 */
export function useCountUp(target: number | null, durationMs = 1600): number | null {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);

  useEffect(() => {
    if (target === null || reduced || typeof requestAnimationFrame !== "function") return;
    const from = shownRef.current;
    if (from === target) return;
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const next = Math.round(from + (target - from) * easeOutCubic(progress));
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [durationMs, reduced, target]);

  if (target === null) return null;
  if (reduced) return target;
  return shown;
}

type FreshState = { fresh: ReadonlySet<string>; seen: ReadonlySet<string>; signature: string };

/**
 * Keys that appeared since the list last changed. Empty on the first render,
 * so a list that mounts full does not animate every row; only rows that
 * arrive afterwards count as fresh. A key stays fresh for about the length of
 * the arrival animation, then clears.
 */
export function useFreshKeys(keys: readonly string[]): ReadonlySet<string> {
  const signature = keys.join(" ");
  const [state, setState] = useState<FreshState>(() => ({ fresh: new Set(), seen: new Set(keys), signature }));
  if (state.signature !== signature) {
    const fresh = new Set<string>();
    for (const key of keys) if (!state.seen.has(key)) fresh.add(key);
    setState({ fresh, seen: new Set(keys), signature });
  }
  const freshSignature = [...state.fresh].join(" ");
  useEffect(() => {
    if (freshSignature === "") return;
    const timer = window.setTimeout(() => {
      setState((current) => (current.fresh.size === 0 ? current : { ...current, fresh: new Set() }));
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [freshSignature]);
  return state.fresh;
}

export type LingeringItem<T> = { item: T; leaving: boolean };

type LingerState<T> = {
  leaving: ReadonlySet<string>;
  order: readonly string[];
  signature: string;
  store: ReadonlyMap<string, T>;
};

/**
 * Keeps an item on screen for `holdMs` after it drops out of `items`, marked
 * `leaving`, so the caller can play an exit rather than let the row vanish.
 * A departing row keeps its place among its neighbours; new rows append in
 * list order. Under reduced motion nothing lingers.
 */
export function useLingering<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  holdMs = 400,
): LingeringItem<T>[] {
  const reduced = useReducedMotion();
  const signature = items.map(keyOf).join(" ");
  const [state, setState] = useState<LingerState<T>>(() => ({
    leaving: new Set(),
    order: items.map(keyOf),
    signature,
    store: new Map(items.map((item) => [keyOf(item), item])),
  }));

  if (state.signature !== signature) {
    const currentKeys = new Set(items.map(keyOf));
    const departed = reduced ? [] : state.order.filter((key) => !currentKeys.has(key) && !state.leaving.has(key));
    const leaving = new Set([...state.leaving, ...departed].filter((key) => !currentKeys.has(key)));
    const keep = new Set([...currentKeys, ...leaving]);
    const order = state.order.filter((key) => keep.has(key));
    for (const key of currentKeys) if (!order.includes(key)) order.push(key);
    const store = new Map<string, T>();
    for (const key of order) {
      const previous = state.store.get(key);
      if (previous !== undefined) store.set(key, previous);
    }
    for (const item of items) store.set(keyOf(item), item);
    setState({ leaving, order, signature, store });
  }

  // Each leaving key gets one timer. When it fires the row is dropped unless the
  // item came back in the meantime, in which case it simply stops leaving.
  const leavingSignature = [...state.leaving].join(" ");
  const timers = useRef(new Map<string, number>());
  useEffect(() => {
    if (leavingSignature === "") return;
    for (const key of leavingSignature.split(" ")) {
      if (timers.current.has(key)) continue;
      timers.current.set(
        key,
        window.setTimeout(() => {
          timers.current.delete(key);
          setState((current) => {
            if (!current.leaving.has(key)) return current;
            const present = current.signature.split(" ").includes(key);
            const leaving = new Set(current.leaving);
            leaving.delete(key);
            if (present) return { ...current, leaving };
            const store = new Map(current.store);
            store.delete(key);
            return { ...current, leaving, order: current.order.filter((entry) => entry !== key), store };
          });
        }, holdMs),
      );
    }
  }, [holdMs, leavingSignature]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
    };
  }, []);

  const result: LingeringItem<T>[] = [];
  for (const key of state.order) {
    const item = state.store.get(key);
    if (item !== undefined) result.push({ item, leaving: state.leaving.has(key) });
  }
  return result;
}
