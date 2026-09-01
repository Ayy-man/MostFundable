// The support library's entire public surface.
//
// Nine functions and the types a route or a server-rendered page needs to call
// them. Deliberately absent:
// the repository, the draft engine, the driver factory, the mock driver, the
// language gate, and the prompt. A route that could import the repository could
// reach `repository.sendMessage` without passing through the service, and the
// no-auto-send property is exactly the claim that no such path exists — so the
// narrowness here is load-bearing rather than tidy.
//
// Adding an export to this file means widening what a route can do. Do it on
// purpose, and check `web/scripts/verify-no-auto-send.mjs` still passes.

// `markThreadRead` is the eighth export, and it is here because the read route
// has to reach it and there is no narrower way to hand it over. It cannot widen
// what a route can do in the direction that matters: it writes one timestamp on
// one row of `support_thread_reads`, it names no message, and rule 3 of
// `web/scripts/verify-no-auto-send.mjs` still finds a single entry point to the
// send seam — this function does not mention `sendMessage` and never reaches it.
export {
  discardDraft,
  generateDraft,
  getThread,
  listThreads,
  markThreadRead,
  openThread,
  sendMessage,
  setThreadStatus,
} from './service.ts';

// `readConsumerTeamChat` is the ninth export, and it is here because the
// consumer route segment renders on the server and has to reach it. Widening
// this barrel is what the file's opening paragraph says to do on purpose, so:
// this function reads. It opens-or-returns one team-chat thread and reads it
// back, it takes no body, and it has no parameter through which a caller could
// name a message. Rule 3 of `web/scripts/verify-no-auto-send.mjs` walks the
// import graph to the send seam and this export does not lie on any path to it —
// `team-chat.server.ts` never mentions `sendMessage` and never calls it.
export { readConsumerTeamChat } from './team-chat.server.ts';

export { SupportError, toHttpResponse, toSupportError } from './errors.ts';

export type { ConsumerTeamChatSnapshot } from './team-chat.server.ts';
export type { OpenThreadRequest } from './service.ts';
export type { SupportErrorCode, SupportHttpResponse } from './errors.ts';
export type {
  HeldDraftRow,
  SupportMessageRow,
  SupportThreadPayload,
  SupportThreadRow,
  SupportThreadSummary,
  SupportViewer,
} from './repository.ts';
export type {
  HeldDraftStatus,
  SupportAuthorKind,
  SupportMessageOrigin,
  SupportMessageVisibility,
  SupportThreadKind,
  SupportThreadRead,
  SupportThreadStatus,
} from './types.ts';
