// The dot field is a sphere, and it drifts less than the contract's ceiling.
//
// Both claims are the kind that a screenshot appears to confirm and does not: a lattice with a
// sign error still looks like a cloud of dots at 20px, and a drift that is twice as large as
// intended looks fine in isolation and looks broken next to a second orb.
//
// Watched failing before it counted, one change at a time against this tree: dropping the `+ 0.5`
// half-step from the depth, so a dot lands exactly on each pole — the pole case failed; making
// every dot the same radius regardless of depth — the near/far case failed; giving `queued` the
// same motion as `running` — the per-state case failed; and raising `DRIFT_AMPLITUDE` to 0.6 —
// the spacing case failed, which is the one that matters, because 0.6 is the number the contract
// states and this test is what decides what it is 0.6 *of*.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DRIFT_AMPLITUDE, orbDots, orbMotion, type OrbState } from "./geometry.ts";

/** The counts the component actually renders, read off it rather than guessed. */
const COUNTS = [42, 96];

describe("the dot field", () => {
  it("puts every dot on the sphere, not near it", () => {
    for (const count of COUNTS) {
      for (const dot of orbDots(count)) {
        // Undo the projection: x and y are scaled to 0.44 of the unit square and centred.
        const x = (dot.x - 0.5) / 0.44;
        const y = (dot.y - 0.5) / 0.44;
        const onSphere = x * x + y * y + dot.depth * dot.depth;
        assert.ok(
          Math.abs(onSphere - 1) < 1e-9,
          `a dot sits at radius ${Math.sqrt(onSphere).toFixed(4)}, not on the unit sphere`,
        );
      }
    }
  });

  it("never lands a dot exactly on a pole, where the ring has no width", () => {
    for (const count of COUNTS) {
      for (const dot of orbDots(count)) {
        assert.ok(Math.abs(dot.depth) < 1, `a dot sits at depth ${dot.depth}, on the pole itself`);
      }
    }
  });

  it("spreads the dots instead of crowding them into bands", () => {
    // The whole reason for the golden angle. A latitude/longitude walk gives the same count with
    // dots piled at the poles, and this is what tells the two apart: the closest pair and the
    // typical pair should be within an order of magnitude of each other.
    const dots = orbDots(96);
    const spacings = nearestNeighbourSpacings(dots);
    const closest = Math.min(...spacings);
    const typical = median(spacings);
    assert.ok(closest > typical * 0.5, `closest pair ${closest.toFixed(4)} vs typical ${typical.toFixed(4)}`);
  });

  it("draws far dots smaller and fainter than near ones", () => {
    const dots = orbDots(96);
    const nearest = dots.reduce((a, b) => (a.depth > b.depth ? a : b));
    const farthest = dots.reduce((a, b) => (a.depth < b.depth ? a : b));
    assert.ok(nearest.radius > farthest.radius, "depth does not change the dot size");
    assert.ok(nearest.opacity > farthest.opacity, "depth does not change the dot opacity");
    // Nothing fully disappears: a dot at zero opacity is a hole in the sphere.
    assert.ok(farthest.opacity > 0.2, `the far side fades to ${farthest.opacity}`);
  });

  it("is the same field every time, so it does not reshuffle on a re-render", () => {
    assert.deepEqual(orbDots(42), orbDots(42));
  });
});

describe("drift", () => {
  it("stays well under a dot's own spacing, which is what the ceiling means", () => {
    // The contract says "under 0.6 amplitude" without naming a unit, and a bare number is not
    // checkable. The unit that makes it a real constraint is the gap between neighbouring dots:
    // drift larger than that and the field stops being a sphere and becomes noise. This is the
    // line that decides it, so it is derived from the field rather than transcribed.
    const spacing = median(nearestNeighbourSpacings(orbDots(96)));
    const peak = DRIFT_AMPLITUDE * 2; // the keyframe runs from −amplitude to +amplitude
    assert.ok(
      peak < 0.6 * spacing,
      `peak drift ${peak.toFixed(4)} against a dot spacing of ${spacing.toFixed(4)}`,
    );
  });

  it("gives every state a different kind of waiting, all inside the ceiling", () => {
    const states: OrbState[] = ["queued", "running", "reviewing"];
    const periods = new Set<number>();
    for (const state of states) {
      const motion = orbMotion(state);
      assert.ok(motion.amplitude > 0, `${state} does not move at all`);
      assert.ok(motion.amplitude <= DRIFT_AMPLITUDE, `${state} drifts past the ceiling`);
      assert.ok(motion.period > 1, `${state} cycles every ${motion.period}s, which reads as a twitch`);
      periods.add(motion.period);
    }
    assert.equal(periods.size, states.length, "two states are animated identically");
    // A job that has not started should be the calmest thing on screen.
    assert.ok(orbMotion("queued").amplitude < orbMotion("running").amplitude, "queued moves like running");
  });
});

function nearestNeighbourSpacings(dots: ReturnType<typeof orbDots>): number[] {
  return dots.map((dot, index) => {
    let best = Infinity;
    dots.forEach((other, otherIndex) => {
      if (index === otherIndex) return;
      const dx = dot.x - other.x;
      const dy = dot.y - other.y;
      const dz = dot.depth - other.depth;
      best = Math.min(best, Math.sqrt(dx * dx + dy * dy + dz * dz));
    });
    return best;
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
