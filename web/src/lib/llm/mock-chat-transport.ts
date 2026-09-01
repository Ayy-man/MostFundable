import type { ChatRequest, ChatTransport } from "./chat-transport.ts";

export type MockChatResponder = (request: ChatRequest) => unknown | Promise<unknown>;

export function createMockChatTransport(
  responder: MockChatResponder,
  model = "deterministic-chat-mock-v1",
): ChatTransport {
  return Object.freeze({
    driver: "mock" as const,
    model,
    async complete(request: ChatRequest): Promise<unknown> {
      return structuredClone(await responder(structuredClone(request)));
    },
  });
}
