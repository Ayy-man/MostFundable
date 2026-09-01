"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createTrackerRealtimeController,
  type TrackerRealtimeAudience,
  type TrackerRealtimeController,
  type TrackerSubscriptionScope,
} from "@/lib/tracker/realtime";
import {
  isTrackerAssigneeOrgRole,
  isTrackerUuid,
  type TrackerAssignableMember,
  type TrackerClient,
  type TrackerReadFilters,
  type TrackerReadResponse,
} from "@/lib/tracker/types";

export interface UseTrackerClientsInput {
  active: boolean;
  audience: TrackerRealtimeAudience;
  filters?: TrackerReadFilters;
}

export interface UseTrackerClientsResult {
  assignableMembers: TrackerAssignableMember[];
  clients: TrackerClient[];
  consoleOpsEnabled: boolean;
  empty: boolean;
  enabled: boolean | null;
  error: boolean;
  loading: boolean;
  refetch(): Promise<void>;
}

const inactiveState = {
  assignableMembers: [] as TrackerAssignableMember[],
  clients: [] as TrackerClient[],
  consoleOpsEnabled: false,
  enabled: null as boolean | null,
  error: false,
  loading: false,
};

function trackerUrl(filters: TrackerReadFilters | undefined): string {
  const params = new URLSearchParams();
  if (filters) {
    params.set("scope", filters.scope);
    if (filters.stage) params.set("stage", filters.stage);
    if (filters.member) params.set("member", filters.member);
    if (filters.affiliate) params.set("affiliate", filters.affiliate);
    if (filters.status) params.set("status", filters.status);
  }
  const query = params.toString();
  return query ? `/api/clients?${query}` : "/api/clients";
}

async function readTrackerClients(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<TrackerReadResponse> {
  const response = await fetcher(url, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("tracker_read_failed");
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("enabled" in body) ||
    typeof body.enabled !== "boolean" ||
    !("clients" in body) ||
    !Array.isArray(body.clients)
  ) {
    throw new Error("tracker_read_failed");
  }
  if (body.enabled && !body.clients.every((client) =>
    typeof client === "object" && client !== null
      && "health" in client && (client.health === "green" || client.health === "amber" || client.health === "red")
      && "status" in client && (client.status === "active" || client.status === "archived")
  )) throw new Error("tracker_read_failed");
  const assignableMembers = body.enabled && "assignableMembers" in body
    ? body.assignableMembers
    : [];
  if (
    !Array.isArray(assignableMembers)
    || !assignableMembers.every((member): member is TrackerAssignableMember =>
      typeof member === "object"
      && member !== null
      && "active" in member && member.active === true
      && "fullName" in member && typeof member.fullName === "string" && member.fullName.trim().length > 0
      && "id" in member && isTrackerUuid(member.id)
      && "isCurrentUser" in member && typeof member.isCurrentUser === "boolean"
      && "orgRole" in member && isTrackerAssigneeOrgRole(member.orgRole)
    )
  ) throw new Error("tracker_read_failed");
  return body.enabled
    ? {
        assignableMembers,
        enabled: true,
        consoleOpsEnabled: "consoleOpsEnabled" in body && body.consoleOpsEnabled === true,
        clients: body.clients as TrackerClient[],
      }
    : { enabled: false, clients: [] };
}

/**
 * One authenticated, tenant-scoped tracker read without opening another
 * realtime channel. Global record search uses this for an all-status snapshot
 * while the interactive tracker keeps its existing filtered subscription.
 */
export function readTrackerClientSnapshot(
  filters: TrackerReadFilters,
  fetcher: typeof fetch = fetch,
): Promise<TrackerReadResponse> {
  return readTrackerClients(trackerUrl(filters), fetcher);
}

async function subscribeToTracker(
  scope: TrackerSubscriptionScope,
  invalidate: () => void,
): Promise<() => void> {
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  let channel = supabase.channel(
    scope.audience === "operator"
      ? "tracker:operator"
      : `tracker:consumer:${scope.clientId}`,
  );

  if (scope.audience === "operator") {
    channel = channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "clients" },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "clients" },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "consent_revocations" },
        invalidate,
      );
  } else {
    channel = channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        filter: `id=eq.${scope.clientId}`,
        schema: "public",
        table: "clients",
      },
      invalidate,
    );
  }

  channel.subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export function useTrackerClients({
  active,
  audience,
  filters,
}: UseTrackerClientsInput): UseTrackerClientsResult {
  const [state, setState] = useState(inactiveState);
  const controllerRef = useRef<TrackerRealtimeController | null>(null);
  const url = trackerUrl(filters);

  useEffect(() => {
    controllerRef.current?.dispose();
    controllerRef.current = null;
    if (!active) return;

    const controller = createTrackerRealtimeController({
      audience,
      cancelSchedule: clearTimeout,
      fetchClients: () => readTrackerClients(url),
      onError: () => {
        setState((current) => ({ ...current, error: true, loading: false }));
      },
      replaceState: (response) => {
        setState({
          assignableMembers: response.enabled ? response.assignableMembers ?? [] : [],
          clients: response.clients,
          consoleOpsEnabled: response.enabled ? response.consoleOpsEnabled === true : false,
          enabled: response.enabled,
          error: false,
          loading: false,
        });
      },
      schedule: setTimeout,
      subscribe: subscribeToTracker,
    });
    controllerRef.current = controller;
    queueMicrotask(() => {
      if (controllerRef.current === controller) {
        setState({ ...inactiveState, loading: true });
      }
    });
    void controller.start().catch(() => {
      if (controllerRef.current === controller) {
        setState((current) => ({ ...current, error: true, loading: false }));
      }
    });

    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [active, audience, url]);

  const refetch = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller) return;
    setState((current) => ({ ...current, error: false }));
    try {
      await controller.refetch();
    } catch {
      setState((current) => ({ ...current, error: true, loading: false }));
      throw new Error("tracker_read_failed");
    }
  }, []);

  return {
    ...state,
    empty:
      state.enabled === true &&
      !state.loading &&
      !state.error &&
      state.clients.length === 0,
    refetch,
  };
}
