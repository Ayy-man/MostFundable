import 'server-only';

// The consumer's team chat, read on the server so the view paints with it.
//
// The defect this closes was measured signed-in against production: the browser
// chained `GET /api/support/threads` (1,144ms), `POST /api/support/threads`
// (930ms) and `GET /api/support/threads/<id>` (1,041ms), each waiting on the
// one before it, and for 3,536ms the client's lifeline rendered the sentence
// "Loading the conversation...". Three round trips is the wrong shape for a
// bootstrap: none of them needed anything the request before it produced except
// the thread id, and the page is already rendering on a server that can ask the
// database directly.
//
// So this does the same work in one server-side pass, and the surface receives
// its messages as a prop. Two database calls remain — open-or-return the thread,
// then read it — but they are in-process round trips inside a render that was
// happening anyway, not HTTP requests a browser has to make in sequence after
// paint.
//
// `support_open_thread` has been open-or-return for `team_chat` since migration
// 103, and it resolves the client from the consumer's own profile rather than
// taking a client id from the caller, which is why this needs nothing from the
// browser at all.
//
// The client bootstrap stays exactly where it is. It is the retry path — a
// person who has been sitting on the page for an hour, a realtime gap, a
// reconnect — and this read returning `null` is a first-class outcome that hands
// the work back to it rather than turning a transient server-side failure into a
// permanent error state on first paint.

import { recordRouteFailure } from '../diagnostics/route-failure.ts';
import { featureFlag } from '../env.ts';
import { getThread, openThread } from './service.ts';

import type { SessionProfile } from '../auth/session.ts';
import type { SupportMessageRow, SupportThreadRow } from './repository.ts';
import type { SupportThreadRead } from './types.ts';
import type { TimelineRead } from '../timeline/types.ts';

/** The subject an unopened consumer thread takes, matching the client bootstrap. */
const TEAM_CHAT_SUBJECT = 'Team Chat';

export type ConsumerTeamChatSnapshot =
  /** FEATURE_SUPPORT is off. The surface shows its fixture conversation and asks for nothing. */
  | { readonly state: 'disabled' }
  /**
   * Durable, and ready to render on first paint.
   *
   * `thread.id` is a handle, not a label. It is what the realtime subscription
   * filters on and what a reply POSTs to, and rail 3 forbids it reaching
   * rendered text, a `title`, an `aria-label`, or a copy button — a thread id in
   * a URL is fine, a thread id a screen reader announces is a defect. The only
   * strings here meant for a person are `thread.subject` and `message.body`.
   */
  | {
      readonly state: 'ready';
      readonly thread: SupportThreadRow;
      readonly messages: readonly SupportMessageRow[];
      readonly read: SupportThreadRead;
      readonly timeline?: TimelineRead;
    };

export interface ConsumerTeamChatDeps {
  readonly featureEnabled?: () => boolean;
  readonly open?: typeof openThread;
  readonly read?: typeof getThread;
  /**
   * Injected so the tenancy refusal is a case a test can drive. Loading the real
   * wall in a unit test would reach a database and fail for the wrong reason,
   * which is how a guard ends up untested and then quietly absent.
   */
  readonly assertWritable?: (session: SessionProfile) => Promise<void>;
}

/**
 * Read the signed-in consumer's team chat, or answer `null`.
 *
 * `null` means "the server has nothing to hand you", and every reason for it is
 * one the client bootstrap can recover from by itself: the caller is not a
 * consumer, they have no org, or a read failed. Returning a `'unavailable'`
 * state instead would freeze a transient failure into the first thing the person
 * sees, and this is a render path — throwing would take the whole page down over
 * a chat panel.
 *
 * The held draft in the payload is deliberately dropped rather than passed
 * through. A consumer's thread payload has no business carrying un-approved
 * machine text, whatever RLS would have said about it: the safest place for that
 * decision is the boundary where the shape is built for a consumer surface.
 */
export async function readConsumerTeamChat(
  session: SessionProfile,
  deps: ConsumerTeamChatDeps = {},
): Promise<ConsumerTeamChatSnapshot | null> {
  const enabled = deps.featureEnabled ?? (() => featureFlag('FEATURE_SUPPORT'));
  let on = false;
  try {
    on = enabled();
  } catch {
    on = false;
  }
  if (!on) return { state: 'disabled' };

  if (session.role !== 'consumer' || session.orgId === null) return null;

  const viewer = { profileId: session.id, role: session.role } as const;
  try {
    // A write, so it answers to the tenancy wall the same way the POST route
    // does. A deactivated tenant does not get new client-facing records opened
    // on its behalf just because the request came from a page render.
    if (deps.assertWritable !== undefined) {
      await deps.assertWritable(session);
    } else {
      const { assertTenantWriteAllowed } = await import('../tenancy/wall.ts');
      await assertTenantWriteAllowed(session);
    }

    const thread = await (deps.open ?? openThread)(
      { clientId: null, kind: 'team_chat', orgId: session.orgId, subject: TEAM_CHAT_SUBJECT },
      viewer,
    );
    const payload = await (deps.read ?? getThread)(thread.id, viewer);
    if (payload === null) return null;

    return {
      messages: payload.messages,
      read: payload.read,
      state: 'ready',
      thread: payload.thread,
      ...(payload.timeline === undefined ? {} : { timeline: payload.timeline }),
    };
  } catch (cause) {
    // F-04's lesson applied to this path. Falling back to the client bootstrap
    // is a good outcome for the person looking at the page and a terrible one
    // for anybody trying to find out why the fast path stopped working: the
    // symptom is a slow render, which looks exactly like a slow render for any
    // other reason. `status: 200` is the truth — the page is served, carrying a
    // degraded result — and the record is the only place the cause survives.
    recordRouteFailure({
      cause,
      code: 'SUPPORT_TEAM_CHAT_PRERENDER_FAILED',
      status: 200,
      surface: 'support.team_chat.server',
    });
    return null;
  }
}
