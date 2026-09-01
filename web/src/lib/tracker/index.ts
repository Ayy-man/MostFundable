import "server-only";

/**
 * Tracker server API for lanes B/C and server routes.
 *
 * This is intentionally the whole public surface: scoped list/read operations,
 * one manual transition, and the two fixed automatic lifecycle events. Database
 * clients, generic RPC inputs, and table mutation helpers remain private.
 */
import type { SessionProfile } from "@/lib/auth/session";
import {
  listAssistantTrackerClients as listAssistantImpl,
  listTrackerClients as listImpl,
  readTrackerClient as readImpl,
  setTrackerClientStatus as setStatusImpl,
} from "./read.server";
import {
  onAnalysisCompleted as analysisImpl,
  onEnrollmentActivated as enrollmentImpl,
  transitionClientStage as transitionImpl,
} from "./transition.server";
import type {
  AnalysisCompletedInput,
  EnrollmentActivatedInput,
  TrackerClient,
  TrackerManualTransitionInput,
  TrackerReadFilters,
  TrackerClientStatus,
  TrackerTransitionResult,
} from "./types";

export function listAssistantTrackerClients(
  session: SessionProfile,
  filters?: TrackerReadFilters,
): Promise<TrackerClient[]> {
  return listAssistantImpl(session, filters);
}

export function listTrackerClients(
  session: SessionProfile,
  filters?: TrackerReadFilters,
): Promise<TrackerClient[]> {
  return listImpl(session, filters);
}

export function readTrackerClient(
  session: SessionProfile,
  clientId: string,
): Promise<TrackerClient | null> {
  return readImpl(session, clientId);
}

export function setTrackerClientStatus(
  session: SessionProfile,
  clientId: string,
  status: TrackerClientStatus,
): Promise<TrackerClient | null> {
  return setStatusImpl(session, clientId, status);
}

export function transitionClientStage(
  input: TrackerManualTransitionInput,
): Promise<TrackerTransitionResult> {
  return transitionImpl(input);
}

export function onEnrollmentActivated(
  input: EnrollmentActivatedInput,
): Promise<TrackerTransitionResult> {
  return enrollmentImpl(input);
}

export function onAnalysisCompleted(
  input: AnalysisCompletedInput,
): Promise<TrackerTransitionResult> {
  return analysisImpl(input);
}

export type {
  AnalysisCompletedInput,
  EnrollmentActivatedInput,
  TrackerClient,
  TrackerClientStatus,
  TrackerHistoryEntry,
  TrackerManualTransitionInput,
  TrackerReadFilters,
  TrackerReadResponse,
  TrackerStage,
  TrackerTransitionResult,
} from "./types";
