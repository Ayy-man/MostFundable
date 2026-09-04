import type { ChatRequest } from "../llm/chat-transport.ts";

/**
 * The one deterministic transport response used by every mock assistant entry
 * point. The same transport serves routing and grounding in one turn, so it
 * must answer both schemas or the router rejects the turn before grounding.
 */
export function assistantMockResponder(request: ChatRequest): unknown {
  if (request.operation === "assistant-route.select") {
    const body = JSON.parse(request.messages[1]?.content ?? "{}") as {
      question?: unknown;
      tools?: Array<{ name?: unknown }>;
    };
    const names = (body.tools ?? []).flatMap((tool) =>
      typeof tool.name === "string" ? [tool.name] : [],
    );
    const question =
      typeof body.question === "string" ? body.question.toLowerCase() : "";
    const dataQuestion =
      /client|application|fee|revenue|operator|audit|bank|readiness|stage|status/.test(
        question,
      );
    const preferred = dataQuestion ? names[0] : undefined;
    return preferred === undefined
      ? { route: "knowledge", tools: [] }
      : { route: "workspace", tools: [{ name: preferred }] };
  }

  if (!request.operation.endsWith("candidate")) {
    return { approved: true };
  }

  const body = JSON.parse(request.messages[1]?.content ?? "{}") as {
    documents?: Array<{ id?: unknown; title?: unknown }>;
  };
  const first = body.documents?.[0];
  if (typeof first?.id !== "string" || typeof first.title !== "string") {
    return {
      bullets: [],
      citations: [],
      headline: "No grounded answer is available.",
    };
  }
  return {
    bullets: [],
    citations: [{ id: first.id }],
    headline: "The cited workspace information supports this answer.",
  };
}
