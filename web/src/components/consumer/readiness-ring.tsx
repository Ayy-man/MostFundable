"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import { useCountUp, useReducedMotion } from "@/lib/motion/hooks";
import { cn } from "@/lib/utils";

/*
 * The verified readiness figure inside a 270-degree ring. The arc and the
 * figure share one ease-out curve so they land together, and the arc only ever
 * fills to the verified value: no target, no projection, and the tick ring is
 * a scale rather than a goal. While an analysis is running the ring carries a
 * short orbiting arc and the figure shows a dash, which is the one shape that
 * cannot be read as a number.
 */

const R = 45;
const ARC = 283; // pathLength of the 270° sweep; keeps the maths in whole units

export function ReadinessRing({
  className,
  inFlight = false,
  size = 132,
  value,
}: {
  className?: string;
  /** An analysis has been authorized and has not completed. */
  inFlight?: boolean;
  size?: number;
  /** The verified readiness, or null when none is recorded. */
  value: number | null;
}) {
  const reduced = useReducedMotion();
  const shown = useCountUp(value, 1600);
  const target = value ?? 0;
  // Which value the stamp has settled on; it only shows while that is the current value.
  const [settledFor, setSettledFor] = useState<number | null>(null);
  const settled = value !== null && settledFor === value;
  // The arc starts empty on mount and transitions to the value, so the first
  // paint counts up rather than arriving already filled.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // The stamp pops only after the figure has landed, and only for a real value.
  useEffect(() => {
    if (value === null) return;
    const timer = window.setTimeout(() => setSettledFor(value), reduced ? 0 : 1720);
    return () => window.clearTimeout(timer);
  }, [reduced, value]);

  const fraction = armed || reduced ? Math.max(0, Math.min(100, target)) / 100 : 0;
  const offset = ARC - ARC * fraction;
  const tipAngle = 270 * fraction;

  return (
    <span
      aria-hidden
      className={cn("relative block shrink-0", className)}
      data-ring-state={inFlight ? "in-flight" : value === null ? "empty" : "verified"}
      style={{ height: size, width: size }}
    >
      <svg className="block h-full w-full" viewBox="0 0 120 120">
        <circle
          cx="60"
          cy="60"
          fill="none"
          r={R}
          stroke="var(--consumer-border)"
          strokeDasharray="0.01 5.88"
          strokeLinecap="round"
          strokeWidth="1.6"
          transform="rotate(135 60 60)"
        />
        <path
          d="M28.2 91.8A45 45 0 1 1 91.8 91.8"
          fill="none"
          stroke="color-mix(in srgb, var(--consumer-positive), transparent 78%)"
          strokeLinecap="round"
          strokeWidth="3.5"
        />
        {inFlight ? (
          <circle
            cx="60"
            cy="60"
            data-ring-sweep
            fill="none"
            pathLength={ARC}
            r={R}
            stroke="var(--consumer-positive)"
            strokeDasharray="36 247"
            strokeLinecap="round"
            strokeWidth="3.5"
          />
        ) : null}
        {value !== null ? (
          <>
            <path
              className="transition-[stroke-dashoffset] duration-[1600ms] ease-[var(--ease-smooth-out)] motion-reduce:transition-none"
              d="M28.2 91.8A45 45 0 1 1 91.8 91.8"
              fill="none"
              pathLength={ARC}
              stroke="var(--consumer-positive)"
              strokeDasharray={ARC}
              strokeDashoffset={offset}
              strokeLinecap="round"
              strokeWidth="3.5"
            />
            <circle
              className="transition-transform duration-[1600ms] ease-[var(--ease-smooth-out)] motion-reduce:transition-none"
              cx="28.2"
              cy="91.8"
              fill="var(--consumer-hero-ink)"
              r="4"
              style={{ transform: `rotate(${tipAngle}deg)`, transformOrigin: "60px 60px" }}
            />
          </>
        ) : null}
      </svg>
      <span className="absolute inset-0 grid place-items-center text-center">
        <span>
          <b className="block text-[2.4rem] font-semibold leading-none tracking-[-0.04em] tabular-nums">
            {inFlight || shown === null ? "—" : shown}
          </b>
          <small className="mt-1 block text-[0.68rem] font-medium text-[var(--consumer-muted)]">of 100</small>
        </span>
      </span>
      {value !== null && !inFlight ? (
        <span
          className={cn(
            "absolute right-0.5 top-0.5 grid size-[26px] place-items-center rounded-full bg-[var(--consumer-positive)] text-[var(--card)] transition-[transform,opacity] duration-[var(--duration-very-slow)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none",
            settled ? "scale-100 opacity-100" : "scale-0 opacity-0",
          )}
        >
          <Check aria-hidden className="size-3.5 stroke-[2.6]" />
        </span>
      ) : null}
    </span>
  );
}
