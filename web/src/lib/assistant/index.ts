// The assistant library's entire public surface.
//
// Five operations and the types a route needs to call them. Deliberately
// absent: the repository, the answer seam, the source mapper. A route that could
// import the repository could write an assistant turn without passing through
// the service, and a turn written outside `answerTurn` is a turn nobody asked a
// question to get.
//
// THIS BARREL IS SERVER-ONLY. `service.ts` imports `server-only`, so a client
// component that imports from here fails the build with a message about the
// wrong thing. The half a browser needs — `readStreamLines` — lives in
// `./stream.ts`, which imports nothing and is safe to reach directly. The
// encoder is re-exported here because the route that builds the stream is
// already on this side of the line.

export {
  answerTurn,
  deleteConversation,
  listConversations,
  openConversation,
  readConversation,
  QUESTION_MAX_LENGTH,
  QUESTION_MIN_LENGTH,
} from './service.ts';

export {
  createStageStreamWriter,
  encodeStreamEvent,
  NDJSON_CONTENT_TYPE,
} from './stream.ts';

export { assistantFooterForScope, AssistantError, assistantErrorStatus, toAssistantError } from './types.ts';

// F-09. The encoding an assistant turn's `body` is written in. The repository
// already decodes it into `headline` / `bullets` / `footer`, so a surface never
// needs the decoder — this is here for the one caller that has a body and no
// turn, and so the format has one named owner rather than being folklore.
export { ANSWER_BULLET_PREFIX, decodeAnswerBody, encodeAnswerBody } from '../kb/answer-body.ts';
export type { KbAnswerBody } from '../kb/answer-body.ts';

export type { AssistantAnswerResult } from './service.ts';
export type { AssistantStreamEvent, StageStreamWriter } from './stream.ts';
export type {
  AssistantConversation,
  AssistantErrorCode,
  AssistantScope,
  AssistantSource,
  AssistantSourceKind,
  AssistantStage,
  AssistantTurn,
  AssistantTurnRole,
} from './types.ts';
