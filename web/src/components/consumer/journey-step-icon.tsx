import { cn } from "@/lib/utils";

/*
 * Bespoke stage icons for the "Your funding journey" stepper (design handoff:
 * Funding Journey Icons). Geometry and colours match the reference; the
 * keyframes live in globals.css under the `mf-journey-*` prefix.
 *
 * Motion regimes. The current stage loops (slowly) and is the only node with a
 * halo. A completed stage plays its motion once on the first mount of the
 * session and settles into the finished glyph; later mounts render the settled
 * glyph directly. Locked nodes are static grey. `prefers-reduced-motion` and the
 * `reducedMotion` prop pause the loop in place and skip the one-shot to its end.
 */

/* Which completed stages (and flowing connectors) have already played this
   session. Written only from animation-end handlers, so it stays empty on the
   server and on the client's first paint, and hydration always agrees. */
const playedOnce = new Set<string>();

export type JourneyStage = "onboarding" | "optimization" | "ready" | "applying" | "funded" | "graduate";
export type JourneyStatus = "complete" | "active" | "locked";

const NODE_STYLES: Record<JourneyStatus, string> = {
  complete: "bg-[#15803d] shadow-[0_3px_10px_rgba(21,128,61,.28)]",
  active: "border-[1.5px] border-[#22c55e] bg-[#ecfdf5]",
  locked: "border border-[#e5e7eb] bg-white",
};


type Palette = {
  ink: string; // primary stroke
  accent: string; // filled/lit parts
  accentInk: string; // stroke drawn on top of an accent fill
  faint: string; // baselines, tracks, ground
  fainter: string; // ticks, dotted rings
  ringFill: string; // graduate core fill
  tipFill: string; // optimization tip dot
};

const PALETTES: Record<JourneyStatus, Palette> = {
  complete: {
    ink: "#fff",
    accent: "#4ade80",
    accentInk: "#0b3b2e",
    faint: "rgba(255,255,255,.45)",
    fainter: "rgba(255,255,255,.28)",
    ringFill: "rgba(255,255,255,.18)",
    tipFill: "#fff",
  },
  active: {
    ink: "#15803d",
    accent: "#4ade80",
    accentInk: "#0b3b2e",
    faint: "#bbf7d0",
    fainter: "#86efac",
    ringFill: "rgba(21,128,61,.18)",
    tipFill: "#0b3b2e",
  },
  locked: {
    ink: "#9ca3af",
    accent: "#9ca3af",
    accentInk: "#fff",
    faint: "#d1d5db",
    fainter: "#e5e7eb",
    ringFill: "#e5e7eb",
    tipFill: "#9ca3af",
  },
};

function StageGlyph({ stage, status }: { stage: JourneyStage; status: JourneyStatus }) {
  const p = PALETTES[status];
  const animate = status !== "locked";
  const a = (name: string) => (animate ? `mf-journey-${name}` : undefined);

  switch (stage) {
    case "onboarding":
      return (
        <>
          <path d="M3 19.5h18" stroke={p.faint} />
          <path
            className={a("sign")}
            d="M3 15.5c1.8-3.6 3-5.2 3.6-3.6S5.4 17 7.2 16c1.8-1 2.6-6 3.8-6s.6 5 2.6 5 2.8-4.2 3.6-4.2.4 4.2 2.6 3.2"
            strokeDasharray={animate ? 62 : undefined}
          />
          <g className={a("stamp")} style={{ transformOrigin: "19px 6px" }}>
            <circle cx="19" cy="6" fill={p.accent} r="3.4" stroke="none" />
            <path d="M17.4 6l1.1 1.1 2.1-2.1" stroke={p.accentInk} strokeWidth="1.5" />
          </g>
        </>
      );
    case "optimization":
      return (
        <>
          <circle cx="12" cy="12" r="8.5" stroke={p.fainter} strokeDasharray="0.01 3.9" strokeWidth="1.8" transform="rotate(135 12 12)" />
          <path d="M5.99 18.01A8.5 8.5 0 1 1 18.01 18.01" stroke={p.faint} />
          {animate ? <path className={a("dial")} d="M5.99 18.01A8.5 8.5 0 1 1 18.01 18.01" strokeDasharray="40" /> : null}
          <g className={a("tip")} style={{ transformOrigin: "12px 12px" }}>
            <circle cx="5.99" cy="18.01" fill={p.tipFill} r="1.9" stroke="none" />
          </g>
          <circle cx="12" cy="12" fill={p.ink} r="1.3" stroke="none" />
        </>
      );
    case "ready":
      return (
        <>
          <path d="M3.5 12h13" stroke={p.faint} />
          <path d="M6 8.5v7M9.5 9.5v5M13 8.5v7" stroke={p.fainter} />
          <circle className={a("gate")} cx="19.5" cy="12" r="2.6" style={{ transformOrigin: "19.5px 12px" }} />
          <circle className={a("slide")} cx="6.5" cy="12" fill={p.accent} r="2.2" stroke="none" />
        </>
      );
    case "applying":
      return (
        <>
          <path d="M10 6h10M10 12h10M10 18h7" stroke={p.faint} />
          <circle cx="5" cy="6" r="2" stroke={p.fainter} />
          <circle cx="5" cy="12" r="2" stroke={p.fainter} />
          <circle cx="5" cy="18" r="2" stroke={p.fainter} />
          {animate ? (
            <>
              <circle className={a("dot")} cx="5" cy="6" fill={p.accent} r="2" stroke={p.accent} />
              <circle className={a("dot")} cx="5" cy="12" fill={p.accent} r="2" stroke={p.accent} style={{ animationDelay: ".6s" }} />
              <circle className={a("dot")} cx="5" cy="18" fill={p.accent} r="2" stroke={p.accent} style={{ animationDelay: "1.2s" }} />
            </>
          ) : null}
        </>
      );
    case "funded":
      return (
        <>
          <path d="M4 16.5c1.5 3 14.5 3 16 0" stroke={p.faint} />
          {animate ? <ellipse className={a("ripple")} cx="12" cy="16.5" rx="8" ry="2.4" style={{ transformOrigin: "12px 16.5px" }} /> : null}
          <g className={a("drop")}>
            <path d="M12 3.5v9.5" />
            <path d="M8.5 9.8L12 13.3l3.5-3.5" />
          </g>
        </>
      );
    case "graduate":
      return (
        <>
          <circle cx="12" cy="12" r="8.5" stroke={p.fainter} strokeDasharray="2.2 2.2" />
          <circle cx="12" cy="12" fill={p.ringFill} r="3" stroke={status === "locked" ? p.faint : p.accent} />
          <circle cx="12" cy="12" fill={status === "locked" ? p.ink : p.accent} r="1.4" stroke="none" />
          <g className={a("orbit")} style={{ transformOrigin: "12px 12px" }}>
            <circle cx="12" cy="3.5" fill={status === "locked" ? p.ink : p.accent} r="1.9" stroke="none" />
            <path d="M12 3.5A8.5 8.5 0 0 0 5 8" stroke={status === "locked" ? p.ink : p.accent} strokeOpacity=".45" />
          </g>
        </>
      );
  }
}

export function JourneyStepIcon({
  reducedMotion = false,
  stage,
  status,
}: {
  reducedMotion?: boolean;
  stage: JourneyStage;
  status: JourneyStatus;
}) {
  // Locked Ready keeps a slightly darker stroke so the empty gate ring stays legible.
  const stroke = status === "locked" && stage === "ready" ? "#6b7280" : PALETTES[status].ink;
  const onceKey = `node:${stage}`;
  const once = status === "complete" ? (playedOnce.has(onceKey) ? "done" : "play") : undefined;
  return (
    <span
      aria-hidden
      className="mf-journey-node relative block size-9 shrink-0"
      data-motion={reducedMotion ? "off" : undefined}
      data-once={once}
      data-status={status}
      onAnimationEnd={once === "play" ? () => playedOnce.add(onceKey) : undefined}
    >
      {status === "active" ? <span className="mf-journey-halo absolute inset-0 box-border rounded-full bg-[#4ade80]" /> : null}
      <span className={cn("absolute inset-0 box-border flex items-center justify-center rounded-full", NODE_STYLES[status])}>
        <svg
          fill="none"
          height={status === "active" && stage === "optimization" ? 21 : 20}
          stroke={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={status === "locked" ? 1.6 : 1.7}
          viewBox="0 0 24 24"
          width={status === "active" && stage === "optimization" ? 21 : 20}
        >
          <StageGlyph stage={stage} status={status} />
        </svg>
      </span>
    </span>
  );
}

/* The vertical rule between nodes. Green out of a complete step (flowing for a
   few passes on first open, then still); a static dotted grey rule elsewhere.
   `stage` is the step the rule leaves, so each rule remembers its own play. */
export function JourneyConnector({ flowing, reducedMotion = false, stage }: { flowing: boolean; reducedMotion?: boolean; stage: JourneyStage }) {
  const onceKey = `rule:${stage}`;
  const once = flowing ? (playedOnce.has(onceKey) ? "done" : "play") : undefined;
  return (
    <span
      aria-hidden
      className={cn("mf-journey-connector my-[5px] w-[2px] flex-1 rounded-[2px]", flowing && "mf-journey-connector-flow")}
      data-motion={reducedMotion ? "off" : undefined}
      data-once={once}
      onAnimationEnd={once === "play" ? () => playedOnce.add(onceKey) : undefined}
    />
  );
}

/* The 6px breathing dot inside the Active chip. */
export function JourneyActiveDot({ reducedMotion = false }: { reducedMotion?: boolean }) {
  return <span aria-hidden className="mf-journey-breathe size-1.5 shrink-0 rounded-full bg-[#22c55e]" data-motion={reducedMotion ? "off" : undefined} />;
}
