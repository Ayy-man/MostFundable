import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerAssistantQuestion, groundedFailureOutcome } from "./orchestrator.ts";
import { KB_REFUSAL_CODES, KB_SUPERVISOR_REASONS, KB_SUPERVISOR_REVISABLE_REASONS } from "../kb/chat-driver.ts";
import { AssistantError } from "./types.ts";

import type { SessionProfile } from "../auth/session.ts";
import type { ChatRequest, ChatTransport } from "../llm/chat-transport.ts";
import type { WorkspaceToolRegistry } from "./workspace-tools.ts";

const operator: SessionProfile = { disabledAt: null, id: "operator-a", manages: [], orgId: "org-a", orgMembership: "current", orgRole: "owner", role: "operator_member" };

function transport(respond: (request: ChatRequest) => unknown): ChatTransport {
  return { driver: "mock", model: "mock", async complete(request) { return respond(request); } };
}

function tools(status: "records" | "no_matching" | "out_of_scope" = "records"): WorkspaceToolRegistry {
  return {
    namesFor: () => ["client_readiness"],
    async run() {
      return status === "records"
        ? { status, documents: [{ id: "tracker:client-a", title: "Riley Foods", label: "Client · Riley Foods", url: "", content: JSON.stringify({ readiness: 84, stage: "ready" }), metadata: { kind: "client" } }] }
        : { status, documents: [] };
    },
  };
}

function successful(request: ChatRequest): unknown {
  if (request.operation === "assistant-route.select") return { route: "workspace", tools: [{ name: "client_readiness" }] };
  if (request.operation.endsWith(".candidate")) {
    const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
    return { headline: "Riley Foods has verified readiness of 84.", bullets: [], citations: [{ id: body.documents[0]!.id }] };
  }
  return { approved: true };
}

describe("assistant orchestration", () => {
  it("lets the model choose a typed workspace read and returns its cited answer", async () => {
    const result = await answerAssistantQuestion("Who is closest to funding?", "operator", operator, { tools: tools(), transport: transport(successful) });
    assert.match(result.body, /Riley Foods/);
    assert.equal(result.sources[0]?.label, "Client · Riley Foods");
  });

  it("keeps the four terminal failures distinct", async () => {
    const noRows = () => answerAssistantQuestion("Who is in review?", "operator", operator, { tools: tools("no_matching"), transport: transport(successful) });
    await assert.rejects(noRows, (error: unknown) => error instanceof AssistantError && error.code === "ASSISTANT_NO_MATCHING_RECORDS");

    const outside = transport((request) => request.operation === "assistant-route.select" ? { route: "out_of_scope", tools: [] } : { approved: true });
    await assert.rejects(
      () => answerAssistantQuestion("Show another workspace", "operator", operator, { tools: tools(), transport: outside }),
      (error: unknown) => error instanceof AssistantError && error.code === "ASSISTANT_OUT_OF_SCOPE",
    );

    const unavailable = transport((request) => {
      if (request.operation === "assistant-route.select") return { route: "workspace", tools: [{ name: "client_readiness" }] };
      throw new Error("provider down");
    });
    await assert.rejects(
      () => answerAssistantQuestion("Who is ready?", "operator", operator, { tools: tools(), transport: unavailable }),
      (error: unknown) => error instanceof AssistantError && error.code === "ASSISTANT_PROVIDER_UNAVAILABLE",
    );

    // The supervisor declining a candidate it could read is the policy refusal.
    // An invented citation used to stand in for it here, which was the wrong
    // representative twice over: it is the parser refusing a shape, not a rule
    // being enforced, and standing it in hid the fact that the two outcomes were
    // the same code. It now has its own assertion below.
    const refused = transport((request) => {
      if (request.operation === "assistant-route.select") return { route: "workspace", tools: [{ name: "client_readiness" }] };
      if (request.operation.endsWith(".candidate")) {
        const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
        return { headline: "A grounded reading of the record.", bullets: [], citations: [{ id: body.documents[0]!.id }] };
      }
      return { approved: false };
    });
    await assert.rejects(
      () => answerAssistantQuestion("Promise approval", "operator", operator, { tools: tools(), transport: refused }),
      (error: unknown) => error instanceof AssistantError && error.code === "ASSISTANT_POLICY_REFUSED",
    );

    const invented = transport((request) => {
      if (request.operation === "assistant-route.select") return { route: "workspace", tools: [{ name: "client_readiness" }] };
      if (request.operation.endsWith(".candidate")) return { headline: "Unsupported", bullets: [], citations: [{ id: "invented" }] };
      return { approved: true };
    });
    await assert.rejects(
      () => answerAssistantQuestion("Cite something that does not exist", "operator", operator, { tools: tools(), transport: invented }),
      (error: unknown) => error instanceof AssistantError && error.code === groundedFailureOutcome(KB_REFUSAL_CODES.CITATION_UNMATCHED),
    );
  });

  it("maps a scoped repository read failure to data unavailable", async () => {
    const brokenTools = tools();
    brokenTools.run = async () => { throw new Error("database unreachable"); };

    await assert.rejects(
      () => answerAssistantQuestion("Who is ready?", "operator", operator, { tools: brokenTools, transport: transport(successful) }),
      (error: unknown) => error instanceof AssistantError && error.code === "ASSISTANT_DATA_UNAVAILABLE",
    );
  });

  it("maps a KB repository failure to data unavailable instead of a provider outage", async () => {
    const knowledge = transport((request) => request.operation === "assistant-route.select"
      ? { route: "knowledge", tools: [] }
      : { approved: true });
    const retrieval = {
      driver: "hash64" as const,
      async retrieve() { throw new Error("KB_REPOSITORY_FAILED"); },
    };

    await assert.rejects(
      () => answerAssistantQuestion("What records should I prepare?", "operator", operator, { retrieval, tools: tools(), transport: knowledge }),
      (error: unknown) => error instanceof AssistantError && error.code === "ASSISTANT_DATA_UNAVAILABLE",
    );
  });

  it("keeps grounded policy refusals separate from transport failures", () => {
    assert.equal(groundedFailureOutcome(KB_REFUSAL_CODES.SUPERVISOR_DECLINED), "ASSISTANT_POLICY_REFUSED");
    assert.equal(groundedFailureOutcome(KB_REFUSAL_CODES.LANGUAGE_BLOCKED), "ASSISTANT_POLICY_REFUSED");
    assert.equal(groundedFailureOutcome(KB_REFUSAL_CODES.ANSWER_FAILED), "ASSISTANT_PROVIDER_UNAVAILABLE");
    assert.equal(groundedFailureOutcome(null), "ASSISTANT_PROVIDER_UNAVAILABLE");
  });

  it("reports a final decline for any draft-fixable reason as retryable, and every rule as policy", () => {
    // Derived from the driver's own vocabulary: a reason the driver would hand
    // a revision note is by definition about the draft, not the question, so a
    // final decline for it must read as a malformed answer the user can retry
    // — reporting it as a policy refusal tells them retrying is pointless.
    // Measured live on 2026-08-23 (correlation 81b8f6b4): a grounded operator
    // answer died as refused_by_policy on `unsupported_statement`.
    assert.ok(KB_SUPERVISOR_REVISABLE_REASONS.length > 0);
    for (const reason of KB_SUPERVISOR_REVISABLE_REASONS) {
      assert.equal(groundedFailureOutcome(KB_REFUSAL_CODES.SUPERVISOR_DECLINED, reason), "ASSISTANT_ANSWER_MALFORMED", reason);
    }
    for (const reason of KB_SUPERVISOR_REASONS.filter((r) => r !== "approved" && !(KB_SUPERVISOR_REVISABLE_REASONS as readonly string[]).includes(r))) {
      assert.equal(groundedFailureOutcome(KB_REFUSAL_CODES.SUPERVISOR_DECLINED, reason), "ASSISTANT_POLICY_REFUSED", reason);
    }
  });

  it("passes model-selected typed arguments into the closed read", async () => {
    let received: unknown;
    const registry = tools();
    registry.run = async (_name, _session, args) => {
      received = args;
      return { status: "no_matching", documents: [] };
    };
    const selected = transport((request) => request.operation === "assistant-route.select"
      ? { route: "workspace", tools: [{ name: "client_readiness", stage: "graduate", query: "Acme" }] }
      : { approved: true });
    await assert.rejects(
      () => answerAssistantQuestion("Which Acme clients are in graduate?", "operator", operator, { tools: registry, transport: selected }),
      (error: unknown) => error instanceof AssistantError && error.code === "ASSISTANT_NO_MATCHING_RECORDS",
    );
    assert.deepEqual(received, { stage: "graduate", query: "Acme" });
  });

  it("makes document handles unique when more than one typed read is selected", async () => {
    let issued: string[] = [];
    const registry: WorkspaceToolRegistry = {
      namesFor: () => ["client_readiness", "client_fees"],
      async run(name) {
        return { status: "records", documents: [{ id: "tracker:0", title: name, label: name === "client_fees" ? "Fees · Riley Foods" : "Client · Riley Foods", url: "", content: "{}", metadata: { kind: "client" } }] };
      },
    };
    const multi = transport((request) => {
      if (request.operation === "assistant-route.select") return { route: "workspace", tools: [{ name: "client_readiness" }, { name: "client_fees" }] };
      if (request.operation.endsWith(".candidate")) {
        const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
        issued = body.documents.map((row) => row.id);
        return { headline: "Riley Foods has a recorded readiness and fee record.", bullets: [], citations: [{ id: issued[0] }] };
      }
      return { approved: true };
    });
    await answerAssistantQuestion("Show readiness and fees", "operator", operator, { tools: registry, transport: multi });
    assert.equal(issued.length, 2);
    assert.equal(new Set(issued).size, 2);
  });

  it("rejects a scope-role mismatch before routing or reading", async () => {
    let calls = 0;
    const never = transport(() => { calls += 1; return { route: "knowledge", tools: [] }; });
    await assert.rejects(
      () => answerAssistantQuestion("Show platform revenue", "admin", operator, { tools: tools(), transport: never }),
      (error: unknown) => error instanceof AssistantError && error.code === "ASSISTANT_OUT_OF_SCOPE",
    );
    assert.equal(calls, 0);
  });
});

/**
 * The completeness and honesty regressions.
 *
 * Every assertion below derives what it expects from a module rather than from a
 * transcript of the failure that motivated it: the ledger cardinality comes from
 * the handles the transport was actually handed, the refusal classification comes
 * from `KB_REFUSAL_CODES`, and the outcome vocabulary comes from
 * `ASSISTANT_ERROR_CODES`. A code renamed or a refusal reclassified fails these;
 * a rewritten sentence does not, because the sentence was never the subject.
 */
describe("assistant answers are complete or say so", () => {
  function applicationRegistry(count: number): WorkspaceToolRegistry {
    return {
      namesFor: () => ["client_applications"],
      async run() {
        return {
          status: "records",
          documents: Array.from({ length: count }, (_, index) => ({
            id: `application:secret-${index}`,
            title: `Application · Acme Bakery · Example Bank · Application ${index + 1}`,
            label: `Application · Acme Bakery · Example Bank · Application ${index + 1}`,
            url: "",
            content: JSON.stringify({ clientName: "Acme Bakery", lenderName: "Example Bank" }),
            metadata: { kind: "application" },
          })),
        };
      },
    };
  }

  it("gives every application its own bullet and citation instead of a capped summary", async () => {
    // Twelve is past both generic ceilings: six bullets and eight citations.
    const count = 12;
    let handed = 0;
    const ledger = transport((request) => {
      if (request.operation === "assistant-route.select") return { route: "workspace", tools: [{ name: "client_applications" }] };
      if (request.operation.endsWith(".candidate")) {
        const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
        handed = body.documents.length;
        return {
          headline: "Each recorded application is listed on its own.",
          items: body.documents.map((row, index) => ({ id: row.id, detail: `recorded operator status todo, entry ${index + 1}` })),
        };
      }
      return { approved: true };
    });

    const result = await answerAssistantQuestion("Where does each open application stand?", "operator", operator, { tools: applicationRegistry(count), transport: ledger });
    const bullets = result.body.split("\n").filter((line) => /recorded operator status todo/.test(line));
    assert.equal(handed, count, "the read did not reach the model whole");
    assert.equal(bullets.length, handed, "the answer described fewer records than it was given");
    assert.equal(result.citations.length, handed, "the answer cited fewer records than it described");
  });

  it("refuses a ledger candidate that merges or drops a record rather than printing part of the book", async () => {
    let supervised = 0;
    let cardinality: number | null = null;
    const merging = transport((request) => {
      if (request.operation === "assistant-route.select") return { route: "workspace", tools: [{ name: "client_applications" }] };
      if (request.operation.endsWith(".candidate")) {
        const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
        cardinality = (request.schema as { properties?: { items?: { minItems?: number } } }).properties?.items?.minItems ?? null;
        return { headline: "Both are pending.", items: [{ id: body.documents[0]!.id, detail: "merged into one line" }] };
      }
      supervised += 1;
      return { approved: true };
    });

    const failure = await answerAssistantQuestion("Where does each open application stand?", "operator", operator, { tools: applicationRegistry(4), transport: merging })
      .then(() => null, (error: unknown) => error);
    assert.ok(failure instanceof AssistantError);
    // The schema the driver sent, not a number copied from the fixture: an
    // application answer must be asked for with a closed cardinality, or nothing
    // downstream can tell a merged answer from a complete one.
    assert.equal(cardinality, 4, "the application read was not asked for as a closed ledger");
    assert.equal(supervised, 0, "an incomplete ledger reached the supervisor");
    // Derived from the classifier, not transcribed: whatever code the driver's
    // malformed-candidate refusal maps to is what an incomplete ledger must
    // raise, and it must not be the policy refusal that would tell the reader a
    // compliance rule blocked a compliant answer.
    assert.equal(failure.code, groundedFailureOutcome(KB_REFUSAL_CODES.CANDIDATE_MALFORMED));
    assert.notEqual(failure.code, groundedFailureOutcome(KB_REFUSAL_CODES.SUPERVISOR_DECLINED));
  });

  it("refuses rather than cutting a workspace record in half to fit the answer window", async () => {
    const oversized: WorkspaceToolRegistry = {
      namesFor: () => ["client_readiness"],
      async run() {
        return {
          status: "records",
          documents: [{ id: "tracker:huge", title: "Client · Huge Record", label: "Client · Huge Record", url: "", content: JSON.stringify({ note: "x".repeat(20_000) }), metadata: { kind: "client" } }],
        };
      },
    };
    let answered = 0;
    const routeOnly = transport((request) => {
      if (request.operation === "assistant-route.select") return { route: "workspace", tools: [{ name: "client_readiness" }] };
      answered += 1;
      return { approved: true };
    });
    await assert.rejects(
      () => answerAssistantQuestion("Describe the huge record", "operator", operator, { tools: oversized, transport: routeOnly }),
      (error: unknown) => error instanceof AssistantError && error.code === "ASSISTANT_RESULT_TOO_LARGE",
    );
    assert.equal(answered, 0, "a record cut mid-JSON reached the model");
  });

  it("surfaces a read that overflowed instead of grounding on its first page", async () => {
    const overflowing: WorkspaceToolRegistry = {
      namesFor: () => ["client_applications"],
      async run() {
        return { status: "records", truncated: true, documents: [{ id: "application:0", title: "Application · One", label: "Application · One", url: "", content: "{}", metadata: { kind: "application" } }] };
      },
    };
    await assert.rejects(
      () => answerAssistantQuestion("Where does each open application stand?", "operator", operator, { tools: overflowing, transport: transport(successful) }),
      (error: unknown) => error instanceof AssistantError && error.code === "ASSISTANT_RESULT_TOO_LARGE",
    );
  });
});

describe("assistant failures name the cause they observed", () => {
  it("does not report an outage when the provider answered unusably", async () => {
    const unreachable = transport((request) => {
      if (request.operation === "assistant-route.select") return { route: "workspace", tools: [{ name: "client_readiness" }] };
      throw new Error("socket hang up");
    });
    const unusable = transport((request) => {
      if (request.operation === "assistant-route.select") return { route: "workspace", tools: [{ name: "client_readiness" }] };
      if (request.operation.endsWith(".candidate")) return { headline: "", bullets: "not an array", citations: [] };
      return { approved: true };
    });
    const ask = (chat: ChatTransport) => answerAssistantQuestion("Who is ready?", "operator", operator, { tools: tools(), transport: chat })
      .then(() => null, (error: unknown) => error);

    const outage = await ask(unreachable);
    const malformed = await ask(unusable);
    assert.ok(outage instanceof AssistantError && malformed instanceof AssistantError);
    assert.equal(outage.code, groundedFailureOutcome(KB_REFUSAL_CODES.ANSWER_FAILED));
    assert.equal(malformed.code, groundedFailureOutcome(KB_REFUSAL_CODES.CANDIDATE_MALFORMED));
    assert.notEqual(malformed.code, outage.code, "an unusable answer is reported as an outage that did not happen");
  });

  it("does not report an outage when its own route schema rejects the reply", async () => {
    // A reply the selector's own shape check refuses. Nothing was unreachable.
    const shaped = transport((request) => request.operation === "assistant-route.select"
      ? { route: "workspace", tools: [{ name: "client_readiness" }], commentary: "extra field" }
      : { approved: true });
    const outage = transport(() => { throw new Error("socket hang up"); });
    const ask = (chat: ChatTransport) => answerAssistantQuestion("Who is ready?", "operator", operator, { tools: tools(), transport: chat })
      .then(() => null, (error: unknown) => error);

    const invalid = await ask(shaped);
    const down = await ask(outage);
    assert.ok(invalid instanceof AssistantError && down instanceof AssistantError);
    assert.equal(down.code, "ASSISTANT_PROVIDER_UNAVAILABLE");
    assert.notEqual(invalid.code, down.code, "a route this codebase refused is reported as a provider outage");
    assert.equal(invalid.code, groundedFailureOutcome(KB_REFUSAL_CODES.CANDIDATE_MALFORMED));
  });
});

describe("assistant failures carry the supervisor's reason to the reader", () => {
  it("does not tell a reader a rule blocked an answer the supervisor called incomplete", async () => {
    const declining = (reason: string) => transport((request) => {
      if (request.operation === "assistant-route.select") return { route: "workspace", tools: [{ name: "client_readiness" }] };
      if (request.operation.endsWith(".candidate")) {
        const body = JSON.parse(request.messages[1]!.content) as { documents: Array<{ id: string }> };
        return { headline: "Riley Foods has verified readiness of 84.", bullets: [], citations: [{ id: body.documents[0]!.id }] };
      }
      return { approved: false, reason };
    });
    const ask = (reason: string) => answerAssistantQuestion("Who is ready?", "operator", operator, { tools: tools(), transport: declining(reason) })
      .then(() => null, (error: unknown) => error);

    const incomplete = await ask("incomplete");
    const policy = await ask("forecast_or_guarantee");
    assert.ok(incomplete instanceof AssistantError && policy instanceof AssistantError);
    assert.equal(policy.code, "ASSISTANT_POLICY_REFUSED");
    assert.notEqual(incomplete.code, policy.code, "an incomplete answer is reported as a policy refusal");
    assert.equal(incomplete.code, groundedFailureOutcome(KB_REFUSAL_CODES.SUPERVISOR_DECLINED, "incomplete"));
  });
});

describe("the caller's workspace name reaches the router", () => {
  it("asks the registry for the name and hands it to the routing request, and routes without it when the read fails", async () => {
    for (const [name, expected] of [["Northbridge Funding Group", "Northbridge Funding Group"], [null, null]] as const) {
      let routed: Record<string, unknown> | null = null;
      const seeing = transport((request) => {
        if (request.operation === "assistant-route.select") routed = JSON.parse(request.messages[1]!.content) as Record<string, unknown>;
        return successful(request);
      });
      const registry: WorkspaceToolRegistry = {
        ...tools(),
        async workspaceName() {
          if (name === null) throw new Error("ASSISTANT_WORKSPACE_NAME_READ_FAILED");
          return name;
        },
      };
      const result = await answerAssistantQuestion("Which clients are closest to funding?", "operator", operator, { tools: registry, transport: seeing });
      assert.ok(result.body.length > 0, "the answer still came back");
      assert.notEqual(routed, null);
      assert.equal((routed as unknown as Record<string, unknown>).callerWorkspace, expected);
    }
  });
});
