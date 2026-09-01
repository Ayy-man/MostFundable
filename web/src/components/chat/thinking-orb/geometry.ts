/**
 * The dot field, as numbers.
 *
 * `orbs.jakubantalik.com` has no licence file, so none of it is copied — this is a sphere built
 * the ordinary way and the reference was only ever for the feel.
 *
 * Points are placed by the Fibonacci lattice, which is the standard trick for spreading n points
 * on a sphere without the pole crowding you get from stepping latitude and longitude. Then they
 * are projected orthographically: x and y are the screen position, and z decides how a dot is
 * drawn. A dot on the far side of the sphere is smaller and fainter than one on the near side,
 * and that difference is the only thing that makes a flat ring of dots read as a ball.
 *
 * Kept out of the component because the component is a `.tsx` and the runner collects `.test.ts`,
 * and the part worth testing is this one: whether the field is actually a sphere, whether the
 * drift stays inside the amplitude the contract sets, and whether that amplitude is a fraction of
 * the gap between dots rather than a number that happens to look calm at one size.
 */

/** The golden angle, in radians. The lattice's whole trick. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * The contract's ceiling on continuous drift, as a fraction of the orb's radius.
 *
 * Under 0.6 in the contract's units; 0.06 of the radius here, which is what "under 0.6" looks
 * like once it is a fraction of something rather than a bare number. A dot moves by about a
 * fifteenth of its own spacing, which is visible as life and invisible as movement.
 */
export const DRIFT_AMPLITUDE = 0.06;

export interface OrbDot {
  /** −1…1, the near-far axis. Everything about how the dot is drawn comes from this. */
  readonly depth: number;
  /** Radians. Each dot drifts on its own phase so the field never pulses in unison. */
  readonly phase: number;
  /** 0…1. Farther dots are drawn fainter, which is the whole illusion. */
  readonly opacity: number;
  /** Fraction of the viewBox. */
  readonly radius: number;
  /** Fraction of the viewBox, 0…1, origin top-left. */
  readonly x: number;
  readonly y: number;
}

/**
 * `count` dots on the unit sphere, projected to the unit square.
 *
 * Deterministic: same count in, same field out. A random field would re-shuffle on every render
 * and every hydration, and a sphere that reassembles itself when React re-runs is worse than no
 * sphere.
 */
export function orbDots(count: number): OrbDot[] {
  const dots: OrbDot[] = [];
  for (let index = 0; index < count; index += 1) {
    // Offset by a half step so neither pole lands exactly on a dot.
    const depth = 1 - ((index + 0.5) / count) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - depth * depth));
    const angle = GOLDEN_ANGLE * index;

    // Orthographic: the ring radius at this depth is what shrinks the sphere towards its poles.
    const x = Math.cos(angle) * ring;
    const y = Math.sin(angle) * ring;

    // Near dots are 1.0 of the base radius, far dots 0.55 — a shallow ramp, because a steep one
    // reads as two separate clouds rather than one solid object.
    const nearness = (depth + 1) / 2;
    dots.push({
      depth,
      opacity: 0.32 + nearness * 0.68,
      phase: angle % (Math.PI * 2),
      radius: 0.55 + nearness * 0.45,
      // Map −1…1 to 0…1, leaving a margin so the outermost dots are not clipped by the viewBox.
      x: 0.5 + x * 0.44,
      y: 0.5 + y * 0.44,
    });
  }
  return dots;
}

/**
 * What each state does to the field.
 *
 * The states are the ones the contract's trigger table actually produces, and each is a different
 * kind of waiting rather than a different decoration: a queued job has not started, so its field
 * barely moves; a running job drifts; a supervisor check is a tighter, quicker motion because
 * something specific is being looked at.
 */
export type OrbState = "queued" | "running" | "reviewing";

export interface OrbMotion {
  /** Fraction of the radius. Never above `DRIFT_AMPLITUDE`. */
  readonly amplitude: number;
  /** One full drift cycle, in seconds. */
  readonly period: number;
}

const MOTION: Readonly<Record<OrbState, OrbMotion>> = {
  queued: { amplitude: DRIFT_AMPLITUDE * 0.35, period: 6.5 },
  reviewing: { amplitude: DRIFT_AMPLITUDE * 0.8, period: 2.4 },
  running: { amplitude: DRIFT_AMPLITUDE, period: 4 },
};

export function orbMotion(state: OrbState): OrbMotion {
  return MOTION[state];
}
