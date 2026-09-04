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

/*
 * Every colour below is a surface token rather than the handoff's hex so the
 * rail sits on the same green as the rest of the Overview: `--consumer-positive`
 * for a completed node, the accent ink and tint for the current one, and the
 * canvas hairline for a locked one. The halo is the positive green at reduced
 * alpha; Electric Green stays reserved for text on dark grounds.
 */
const NODE_STYLES: Record<JourneyStatus, string> = {
  complete: "bg-[var(--consumer-positive)] shadow-[0_3px_10px_color-mix(in_srgb,var(--consumer-positive),transparent_72%)]",
  active: "border-[1.5px] border-[var(--consumer-accent-ink)] bg-[var(--consumer-accent-tint)]",
  locked: "border border-[var(--consumer-border)] bg-card",
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
    ink: "var(--card)",
    accent: "var(--consumer-accent)",
    accentInk: "var(--consumer-positive)",
    faint: "color-mix(in srgb, var(--card), transparent 55%)",
    fainter: "color-mix(in srgb, var(--card), transparent 72%)",
    ringFill: "color-mix(in srgb, var(--card), transparent 82%)",
    tipFill: "var(--card)",
  },
  active: {
    ink: "var(--consumer-accent-ink)",
    accent: "var(--consumer-accent-ink)",
    accentInk: "var(--card)",
    faint: "color-mix(in srgb, var(--consumer-accent-ink), transparent 72%)",
    fainter: "color-mix(in srgb, var(--consumer-accent-ink), transparent 60%)",
    ringFill: "color-mix(in srgb, var(--consumer-accent-ink), transparent 82%)",
    tipFill: "var(--consumer-hero-ink)",
  },
  locked: {
    ink: "var(--muted-foreground)",
    accent: "var(--muted-foreground)",
    accentInk: "var(--card)",
    faint: "var(--consumer-border)",
    fainter: "color-mix(in srgb, var(--consumer-border), transparent 40%)",
    ringFill: "var(--consumer-canvas)",
    tipFill: "var(--muted-foreground)",
  },
};

/** The bare glyph for a stage, in the palette of its status. `still` draws it with no motion classes. */
export function StageGlyph({ stage, status, still = false }: { stage: JourneyStage; status: JourneyStatus; still?: boolean }) {
  const p = PALETTES[status];
  const animate = status !== "locked" && !still;
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
  const stroke = PALETTES[status].ink;
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
      {status === "active" ? <span className="mf-journey-halo absolute inset-0 box-border rounded-full bg-[color-mix(in_srgb,var(--consumer-positive),transparent_35%)]" /> : null}
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
  return <span aria-hidden className="mf-journey-breathe size-1.5 shrink-0 rounded-full bg-[var(--consumer-accent-ink)]" data-motion={reducedMotion ? "off" : undefined} />;
}

/*
 * A compact, still stage mark for dense rows: the affiliate lead track, the
 * operator client list. 20px, no halo, no motion of its own; a caller that
 * wants a pop on change wraps it with `data-mark-pop`.
 */
export function JourneyStageMark({ stage, tone }: { stage: JourneyStage; tone: "past" | "current" | "upcoming" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-full transition-[background-color,border-color] duration-[var(--duration-very-slow)] ease-[var(--ease-smooth-out)] motion-reduce:transition-none",
        tone === "past" && "bg-[color-mix(in_srgb,var(--consumer-positive),transparent_86%)] border border-[color-mix(in_srgb,var(--consumer-positive),transparent_60%)]",
        tone === "current" && "bg-[var(--consumer-positive)] border border-[var(--consumer-positive)]",
        tone === "upcoming" && "border border-[var(--consumer-border)] bg-card",
      )}
    >
      <svg
        fill="none"
        height={12}
        stroke={tone === "past" ? "var(--consumer-positive)" : tone === "current" ? "var(--card)" : "var(--muted-foreground)"}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.9}
        viewBox="0 0 24 24"
        width={12}
      >
        <StageGlyph stage={stage} status={tone === "current" ? "complete" : tone === "past" ? "active" : "locked"} still />
      </svg>
    </span>
  );
}
