"use client";

import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

import type { OrbActivity } from "./activity";
import { orbDots, orbMotion } from "./geometry";

export { orbActivity, type OrbActivity, type OrbJobStatus, type OrbSource } from "./activity";
export { DRIFT_AMPLITUDE, orbDots, orbMotion, type OrbDot, type OrbMotion, type OrbState } from "./geometry";

/**
 * Dot counts, by size.
 *
 * The small orb sits inline at the x-height of a sentence, so it gets a sparser field: at 20px a
 * dense lattice stops being dots and becomes a grey smudge, which reads as a rendering artefact
 * rather than an object.
 */
const DOTS = { md: 96, sm: 42 } as const;
const VIEWBOX = 100;

const KEYFRAMES = `
@keyframes mf-orb-drift {
  from { transform: translate(calc(var(--mf-orb-dx) * -1), calc(var(--mf-orb-dy) * -1)); }
  to   { transform: translate(var(--mf-orb-dx), var(--mf-orb-dy)); }
}
@media (prefers-reduced-motion: reduce) {
  /* The field holds still and the label carries the whole message. Nothing is lost: the label was
     always the part that said what was happening. */
  [data-mf-orb] circle { animation: none !important; transform: none !important; }
}
`;

export interface ThinkingOrbProps {
  /**
   * The live claim. Only `orbActivity()` can make one, and it returns `null` when nothing is in
   * flight — so the way to not show an orb is to have nothing to show.
   */
  readonly activity: OrbActivity;
  readonly className?: string;
  /**
   * Which ground it is sitting on. The dots have to be legible against it, and there are exactly
   * two grounds in this product that an orb ever lands on.
   */
  readonly ground?: "light" | "navy";
  readonly size?: "sm" | "md";
}

/**
 * A dotted sphere that drifts while something is genuinely in flight.
 *
 * Two things make this different from a spinner. It is attached to real job state through
 * `OrbActivity`, so it cannot appear over work that is not happening; and it always shows the
 * words for that state, so the animation is the decoration and the label is the information —
 * which is why reduced-motion can drop the movement entirely and lose nothing.
 */
export function ThinkingOrb({ activity, className, ground = "light", size = "md" }: ThinkingOrbProps) {
  const dots = orbDots(DOTS[size]);
  const motion = orbMotion(activity.state);
  const px = size === "sm" ? 20 : 44;
  const baseRadius = size === "sm" ? 2.6 : 2.1;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xs font-medium",
        size === "sm" ? "align-[-0.2em]" : "gap-3 text-sm",
        ground === "navy" ? "text-[var(--accent-on-dark)]" : "text-muted-foreground",
        className,
      )}
      // Polite, not assertive: this is a status that changes while a person is reading, and an
      // assertive live region would interrupt them every time a stage arrives.
      aria-live="polite"
      role="status"
    >
      <style href="mf-thinking-orb" precedence="medium">
        {KEYFRAMES}
      </style>
      <svg
        aria-hidden
        className="shrink-0 transition-opacity duration-[var(--duration-quick)] ease-[var(--ease-smooth-out)]"
        data-mf-orb=""
        height={px}
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        width={px}
      >
        {dots.map((dot, index) => {
          // Each dot drifts along its own phase, so the field breathes instead of pulsing in
          // unison — a sphere where every dot moves together reads as one object wobbling.
          const amplitude = motion.amplitude * VIEWBOX;
          const style = {
            "--mf-orb-dx": `${(Math.cos(dot.phase) * amplitude).toFixed(3)}px`,
            "--mf-orb-dy": `${(Math.sin(dot.phase) * amplitude).toFixed(3)}px`,
            animationDelay: `${((dot.phase / (Math.PI * 2)) * motion.period).toFixed(2)}s`,
            animationDirection: "alternate",
            animationDuration: `${motion.period}s`,
            animationIterationCount: "infinite",
            animationName: "mf-orb-drift",
            animationTimingFunction: "ease-in-out",
          } as CSSProperties;
          return (
            <circle
              cx={dot.x * VIEWBOX}
              cy={dot.y * VIEWBOX}
              fill={ground === "navy" ? "var(--primary)" : "var(--primary-ink)"}
              fillOpacity={dot.opacity}
              key={index}
              r={dot.radius * baseRadius}
              style={style}
            />
          );
        })}
      </svg>
      <span className="min-w-0 truncate">{activity.label}</span>
    </span>
  );
}
