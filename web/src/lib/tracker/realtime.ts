import type { TrackerReadResponse } from "./types";

export type TrackerRealtimeAudience = "consumer" | "operator";

export type TrackerSubscriptionScope =
  | { audience: "operator" }
  | { audience: "consumer"; clientId: string };

export interface TrackerRealtimeController {
  dispose(): void;
  refetch(): Promise<TrackerReadResponse>;
  start(): Promise<TrackerReadResponse>;
}

export interface TrackerRealtimeControllerOptions {
  audience: TrackerRealtimeAudience;
  cancelSchedule(handle: unknown): void;
  fetchClients(): Promise<TrackerReadResponse>;
  onError?(error: unknown): void;
  replaceState(response: TrackerReadResponse): void;
  schedule(callback: () => void, delayMs: number): unknown;
  subscribe(
    scope: TrackerSubscriptionScope,
    invalidate: () => void,
  ): Promise<() => void> | (() => void);
}

const INVALIDATION_DELAY_MS = 120;

export function createTrackerRealtimeController(
  options: TrackerRealtimeControllerOptions,
): TrackerRealtimeController {
  let disposed = false;
  let latestRead = 0;
  let pendingSchedule: unknown | null = null;
  let subscriptionKey: string | null = null;
  let unsubscribe: (() => void) | null = null;

  function clearSubscription() {
    unsubscribe?.();
    unsubscribe = null;
    subscriptionKey = null;
  }

  function scopeFor(
    response: TrackerReadResponse,
  ): TrackerSubscriptionScope | null {
    if (!response.enabled) return null;
    if (options.audience === "operator") return { audience: "operator" };
    const clientId = response.clients[0]?.id;
    return clientId ? { audience: "consumer", clientId } : null;
  }

  function scheduleRefetch() {
    if (disposed || pendingSchedule !== null) return;
    pendingSchedule = options.schedule(() => {
      pendingSchedule = null;
      if (disposed) return;
      void read().catch((error) => options.onError?.(error));
    }, INVALIDATION_DELAY_MS);
  }

  async function syncSubscription(response: TrackerReadResponse) {
    const scope = scopeFor(response);
    const nextKey = scope ? JSON.stringify(scope) : null;
    if (nextKey === subscriptionKey) return;

    clearSubscription();
    if (!scope || disposed) return;

    subscriptionKey = nextKey;
    let cleanup: () => void;
    try {
      cleanup = await options.subscribe(scope, scheduleRefetch);
    } catch (error) {
      if (subscriptionKey === nextKey) subscriptionKey = null;
      throw error;
    }
    if (disposed || subscriptionKey !== nextKey) {
      cleanup();
      return;
    }
    unsubscribe = cleanup;
  }

  async function read(): Promise<TrackerReadResponse> {
    const readNumber = ++latestRead;
    const response = await options.fetchClients();
    if (disposed || readNumber !== latestRead) return response;
    options.replaceState(response);
    await syncSubscription(response);
    return response;
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      latestRead += 1;
      if (pendingSchedule !== null) {
        options.cancelSchedule(pendingSchedule);
        pendingSchedule = null;
      }
      clearSubscription();
    },
    refetch: read,
    start: read,
  };
}
