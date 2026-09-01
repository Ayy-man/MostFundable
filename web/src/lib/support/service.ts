// The seven support operations, orchestrated.
//
// DEC-D10 lives here as an absence. `generateDraft` runs the driver, clears the
// three gates, and persists a `held_drafts` row — and then stops. There is no
// branch, no condition, and no draft status, `approved` included, that makes it
// call `sendMessage`. That absence is the no-auto-reply property in TypeScript,
// the same way migration 100's three-label author enum is the property in SQL.
//
// `no-auto-send.test.ts` proves it at runtime across 64 generated contexts and
// every draft status; `web/scripts/verify-no-auto-send.mjs` proves it
// statically. If you are reading this because you want the generate path to
// send something, the answer is no — a person calls `sendMessage`, and the
// audit row names them.

import { resolveDraftConfidenceThreshold } from './config.ts';
import { createSupportDraftDriver } from './driver.ts';
import { runDraftEngine } from './engine.ts';
import { SupportError, toSupportError } from './errors.ts';
import { createSupportRepository } from './repository.ts';
import { SUPPORT_DRAFT_CONTEXT_MESSAGE_LIMIT } from './types.ts';
import { resolveGovernedEnv } from '../admin/settings.ts';

import type { AppRole } from '../auth/session.ts';
import type { EnvSource } from '../env.ts';
import type { DraftEngineDependencies } from './engine.ts';
import type { SettingsReadRepository } from '../admin/settings-types.ts';
import type {
  HeldDraftRow,
  SupportMessageRow,
  SupportRepository,
  SupportThreadPayload,
  SupportThreadRow,
  SupportThreadSummary,
  SupportViewer,
} from './repository.ts';
import type {
  SupportAuthorKind,
  SupportDraftContext,
  SupportDraftDriver,
  SupportMessageVisibility,
  SupportThreadKind,
  SupportThreadRead,
  SupportThreadStatus,
} from './types.ts';

export interface OpenThreadRequest {
  readonly kind: SupportThreadKind;
  readonly orgId: string;
  readonly clientId: string | null;
  readonly subject: string;
}

export interface SupportServiceDeps {
  readonly repository?: SupportRepository;
  readonly createDriver?: (env: EnvSource) => SupportDraftDriver;
  readonly env?: EnvSource;
  readonly resolveSettings?: (fallback: EnvSource) => Promise<EnvSource>;
  readonly settingsRepository?: SettingsReadRepository;
  readonly resolvePrompt?: DraftEngineDependencies['resolvePrompt'];
  readonly recordEvaluation?: DraftEngineDependencies['recordEvaluation'];
}

/**
 * What a route may ask the support library to do.
 *
 * Seven operations, one per route method plan 13-05 defines, and the repository
 * itself is not among them. A route cannot reach `repository.sendMessage`
 * except through `SupportService.sendMessage`, which is the point of keeping
 * this interface and `index.ts` narrow.
 */
export interface SupportService {
  listThreads(viewer: SupportViewer): Promise<readonly SupportThreadSummary[]>;
  openThread(input: OpenThreadRequest, actor: SupportViewer): Promise<SupportThreadRow>;
  getThread(threadId: string, viewer: SupportViewer): Promise<SupportThreadPayload | null>;
  setThreadStatus(
    threadId: string,
    status: SupportThreadStatus,
    actor: SupportViewer,
  ): Promise<SupportThreadRow>;
  generateDraft(threadId: string, actor: SupportViewer): Promise<HeldDraftRow>;
  discardDraft(draftId: string, actor: SupportViewer): Promise<HeldDraftRow>;
  sendMessage(
    threadId: string,
    actor: SupportViewer,
    body: string,
    draftId?: string,
    visibility?: SupportMessageVisibility,
  ): Promise<SupportMessageRow>;
  markThreadRead(
    threadId: string,
    actor: SupportViewer,
    lastReadAt: string | null,
  ): Promise<SupportThreadRead>;
}

/**
 * The author kind is derived from the actor's role, never accepted from a
 * caller.
 *
 * Migration 100's `enforce_support_message_author` trigger checks the same
 * pairing independently, so a disagreement between this table and the profile
 * row raises `SUPPORT_AUTHOR_ROLE_MISMATCH`. That is a 500 rather than a 400
 * precisely because nothing a client sends can influence this value.
 */
const AUTHOR_KIND_BY_ROLE: Readonly<Partial<Record<AppRole, SupportAuthorKind>>> = {
  consumer: 'consumer',
  operator_member: 'operator',
  platform_admin: 'admin',
};

function authorKindFor(actor: SupportViewer): SupportAuthorKind {
  const kind = AUTHOR_KIND_BY_ROLE[actor.role];
  // An affiliate has no seat in either conversation, so there is no kind to
  // derive and the operation is refused before the database is touched.
  if (kind === undefined) throw new SupportError('SUPPORT_FORBIDDEN');
  return kind;
}

/**
 * Build the driver's view of the thread.
 *
 * Two fields per message and nothing else. No profile id, no display name, no
 * email, no client id, no org id — `SupportDraftContext` cannot represent them,
 * and this is the function that would have to widen for one to escape.
 */
function buildContext(payload: SupportThreadPayload): SupportDraftContext {
  const recent = payload.messages.slice(-SUPPORT_DRAFT_CONTEXT_MESSAGE_LIMIT);
  return {
    threadKind: payload.thread.kind,
    threadSubject: payload.thread.subject,
    recentMessages: recent.map((message) => ({
      authorKind: message.authorKind,
      body: message.body,
    })),
  };
}

export function createSupportService(deps: SupportServiceDeps = {}): SupportService {
  const repository = deps.repository ?? createSupportRepository();
  const createDriver = deps.createDriver ?? createSupportDraftDriver;
  const env = deps.env ?? process.env;
  const resolveSettings = deps.resolveSettings ?? ((fallback) =>
    resolveGovernedEnv(['SUPPORT_DRAFT_CONFIDENCE_THRESHOLD'], fallback, deps.settingsRepository));

  return {
    listThreads(viewer) {
      return repository.listThreads(viewer);
    },

    openThread(input, actor) {
      return repository.openThread({
        kind: input.kind,
        orgId: input.orgId,
        clientId: input.clientId,
        subject: input.subject,
        actorProfileId: actor.profileId,
      });
    },

    getThread(threadId, viewer) {
      return repository.readThread(threadId, viewer);
    },

    setThreadStatus(threadId, status, actor) {
      return repository.setThreadStatus(threadId, status, actor.profileId);
    },

    async generateDraft(threadId, actor) {
      const payload = await repository.readThread(threadId, actor);
      // Refused here rather than at the RPC so that a thread the actor cannot
      // see never costs a provider call.
      if (payload === null) throw new SupportError('SUPPORT_FORBIDDEN');

      let decision;
      try {
        const governedEnv = await resolveSettings(env);
        const driver = createDriver(governedEnv);
        const threshold = resolveDraftConfidenceThreshold(governedEnv);
        decision = await runDraftEngine(driver, buildContext(payload), threshold, {
          env: governedEnv,
          ...(deps.resolvePrompt === undefined ? {} : { resolvePrompt: deps.resolvePrompt }),
          ...(deps.recordEvaluation === undefined ? {} : { recordEvaluation: deps.recordEvaluation }),
        });
      } catch (error) {
        // A driver or configuration failure writes no row. There is nothing to
        // persist: no candidate means no gates were evaluated, and a
        // half-populated draft would be a record of a decision nobody made.
        throw toSupportError(error);
      }

      return repository.recordDraft({
        threadId,
        actorProfileId: actor.profileId,
        decision,
      });

      // Nothing follows. See the file-top comment: `approved` is a status a
      // person acts on, not a trigger.
    },

    discardDraft(draftId, actor) {
      return repository.discardDraft(draftId, actor.profileId);
    },

    // `async` so that a refused author kind arrives as a rejection rather than
    // a synchronous throw: a caller that only attaches `.catch` must not miss
    // the one error this function raises before reaching the database.
    // `visibility` is passed through rather than checked here. A consumer
    // asking for an internal note is refused by migration 385 — by the RPC with
    // a named code, and by a check constraint underneath it — and re-deriving
    // the same rule in TypeScript would be a second definition to keep in step,
    // which is the drift this library keeps avoiding on purpose.
    async sendMessage(threadId, actor, body, draftId, visibility) {
      return repository.sendMessage({
        threadId,
        actorProfileId: actor.profileId,
        authorKind: authorKindFor(actor),
        body,
        draftId,
        ...(visibility === undefined ? {} : { visibility }),
      });
    },

    markThreadRead(threadId, actor, lastReadAt) {
      return repository.markThreadRead(threadId, actor.profileId, lastReadAt);
    },
  };
}

const defaultService = createSupportService();

export function listThreads(viewer: SupportViewer): Promise<readonly SupportThreadSummary[]> {
  return defaultService.listThreads(viewer);
}

export function openThread(
  input: OpenThreadRequest,
  actor: SupportViewer,
): Promise<SupportThreadRow> {
  return defaultService.openThread(input, actor);
}

export function getThread(
  threadId: string,
  viewer: SupportViewer,
): Promise<SupportThreadPayload | null> {
  return defaultService.getThread(threadId, viewer);
}

export function setThreadStatus(
  threadId: string,
  status: SupportThreadStatus,
  actor: SupportViewer,
): Promise<SupportThreadRow> {
  return defaultService.setThreadStatus(threadId, status, actor);
}

export function generateDraft(threadId: string, actor: SupportViewer): Promise<HeldDraftRow> {
  return defaultService.generateDraft(threadId, actor);
}

export function discardDraft(draftId: string, actor: SupportViewer): Promise<HeldDraftRow> {
  return defaultService.discardDraft(draftId, actor);
}

export function sendMessage(
  threadId: string,
  actor: SupportViewer,
  body: string,
  draftId?: string,
  visibility?: SupportMessageVisibility,
): Promise<SupportMessageRow> {
  return defaultService.sendMessage(threadId, actor, body, draftId, visibility);
}

export function markThreadRead(
  threadId: string,
  actor: SupportViewer,
  lastReadAt: string | null,
): Promise<SupportThreadRead> {
  return defaultService.markThreadRead(threadId, actor, lastReadAt);
}
