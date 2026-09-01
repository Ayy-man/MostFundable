"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ConsumerOptimizationV1 } from "./types.ts";

/**
 * Four answers the surface can be in, and no fifth. A failed read is never folded into "ready
 * with nothing", because an empty checklist is a claim about the account and an outage is not.
 */
export type OptimizationReadStateV1 =
  | { readonly status: "loading" }
  /** The route 404s: `FEATURE_ANALYSIS` is off in this deployment, so there is no read at all. */
  | { readonly status: "off" }
  | { readonly status: "error"; readonly correlationId: string | null; readonly at: string }
  | { readonly status: "ready"; readonly data: ConsumerOptimizationV1 | null };

export type ReportActionV1 = "report" | "undo";

export interface ConsumerOptimizationHandleV1 {
  readonly state: OptimizationReadStateV1;
  refetch(): Promise<void>;
  /**
   * Resolves to the fresh view the write returned, or throws with one of three codes the surface
   * can name: "conflict" (the row moved under us; the view is refetched), "closed" (no write path
   * on this account), or "failed".
   */
  report(factorKey: string, action: ReportActionV1): Promise<ConsumerOptimizationV1>;
}

async function readOnce(): Promise<OptimizationReadStateV1> {
  let response: Response;
  try {
    response = await fetch("/api/optimization", { cache: "no-store", credentials: "same-origin" });
  } catch {
    return { at: new Date().toISOString(), correlationId: null, status: "error" };
  }
  if (response.status === 404) return { status: "off" };
  if (!response.ok) {
    let correlationId: string | null = null;
    try {
      const body = (await response.json()) as { correlationId?: unknown };
      if (typeof body.correlationId === "string") correlationId = body.correlationId;
    } catch {
      // A non-JSON failure body has nothing to correlate; the timestamp still identifies the try.
    }
    return { at: new Date().toISOString(), correlationId, status: "error" };
  }
  const body = (await response.json()) as { data?: ConsumerOptimizationV1 | null };
  return { data: body.data ?? null, status: "ready" };
}

export class OptimizationReportError extends Error {
  readonly code: "conflict" | "closed" | "failed";
  constructor(code: "conflict" | "closed" | "failed") {
    super(code);
    this.code = code;
    this.name = "OptimizationReportError";
  }
}

export function useConsumerOptimization(active: boolean): ConsumerOptimizationHandleV1 {
  const [state, setState] = useState<OptimizationReadStateV1>({ status: "loading" });
  const generation = useRef(0);

  const refetch = useCallback(async () => {
    const mine = ++generation.current;
    const next = await readOnce();
    if (generation.current === mine) setState(next);
  }, []);

  useEffect(() => {
    if (!active) return;
    void refetch();
    return () => {
      generation.current += 1;
    };
  }, [active, refetch]);

  const report = useCallback(
    async (factorKey: string, action: ReportActionV1) => {
      let response: Response;
      try {
        response = await fetch("/api/optimization/report", {
          body: JSON.stringify({ action, factorKey }),
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
      } catch {
        throw new OptimizationReportError("failed");
      }
      if (response.status === 409) {
        await refetch();
        throw new OptimizationReportError("conflict");
      }
      if (response.status === 404 || response.status === 403) throw new OptimizationReportError("closed");
      if (!response.ok) throw new OptimizationReportError("failed");
      const body = (await response.json()) as { data?: ConsumerOptimizationV1 | null };
      if (!body.data) throw new OptimizationReportError("failed");
      generation.current += 1;
      setState({ data: body.data, status: "ready" });
      return body.data;
    },
    [refetch],
  );

  return { refetch, report, state };
}
