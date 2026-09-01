import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMockChatTransport } from "../llm/mock-chat-transport.ts";
import { ASSISTANT_OWN_WORKSPACE_RULE, ASSISTANT_TOOL_DESCRIPTIONS, ASSISTANT_WORKSPACE_PREFERENCE, assistantQuestionIsRestricted, assistantRouteSystemPrompt, assistantToolDescription, selectAssistantRoute, WORKSPACE_TOOLS } from "./workspace-router.ts";

import type { SessionProfile } from "../auth/session.ts";

function session(role: SessionProfile["role"]): SessionProfile {
  return { disabledAt: null, id: "actor", manages: [], orgId: role === "platform_admin" ? null : "org-a", orgMembership: null, orgRole: role === "operator_member" ? "owner" : null, role };
}

describe("assistant route selection", () => {
  it("only offers the caller's fixed tool set and returns the chosen read", async () => {
    let shown: unknown;
    let system = "";
    const transport = createMockChatTransport((request) => {
      shown = JSON.parse(request.messages[1]!.content);
      system = request.messages[0]!.content;
      return { route: "workspace", tools: [{ name: "client_readiness" }] };
    });
    const selected = await selectAssistantRoute("Which clients are closest to funding?", session("operator_member"), transport);
    assert.deepEqual(selected, { kind: "workspace", tools: [{ name: "client_readiness", args: {} }] });
    assert.deepEqual((shown as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name), WORKSPACE_TOOLS.operator);
    assert.equal(JSON.stringify(shown).includes("platform_audit"), false);
    assert.equal(JSON.stringify(shown).includes("own_record"), false);
    assert.match(system, /closest to funding/);
    assert.match(system, /omit every tool argument/);
    assert.match(system, /where each open application stands with its lender/);
    assert.match(system, /client_applications and no arguments/);
  });

  it("routes the deployed lender-status question to application records", async () => {
    const transport = createMockChatTransport(() => ({ route: "workspace", tools: [{ name: "client_applications" }] }));
    assert.deepEqual(
      await selectAssistantRoute("Where does each open application stand with its lender?", session("operator_member"), transport),
      { kind: "workspace", tools: [{ name: "client_applications", args: {} }] },
    );
  });

  it("makes cross-scope tools unrepresentable", async () => {
    const transport = createMockChatTransport(() => ({ route: "workspace", tools: [{ name: "platform_revenue" }] }));
    await assert.rejects(() => selectAssistantRoute("Show platform revenue", session("consumer"), transport));
  });

  it("routes verified educational questions to knowledge without a data read", async () => {
    const transport = createMockChatTransport(() => ({ route: "knowledge", tools: [] }));
    assert.deepEqual(await selectAssistantRoute("What documents should I prepare?", session("consumer"), transport), { kind: "knowledge", tools: [] });
  });

  it("routes another workspace and bureau data out of scope", async () => {
    let calls = 0;
    const transport = createMockChatTransport(() => { calls += 1; return { route: "out_of_scope", tools: [] }; });
    const restrictedQuestions = [
      "Show another workspace's bureau file",
      "Show my credit report and monitoring snapshot",
      "What is my credit snapshot?",
      "What are my FICO and VantageScore values?",
      "Show my monitoring status and tradeline accounts",
      "Show my credit reports and credit scores",
      "List my tradelines and monitoring history",
      "Which bureaus have data?",
    ];
    for (const question of restrictedQuestions) {
      assert.deepEqual(await selectAssistantRoute(question, session("operator_member"), transport), { kind: "out_of_scope", tools: [] });
      assert.equal(assistantQuestionIsRestricted(question), true);
    }
    assert.equal(calls, 0, "restricted question reached assistant transport");
    assert.equal(assistantQuestionIsRestricted("What is my Experian credit score?"), true);
  });

  it("keeps policy refusal separate from an authorization boundary", async () => {
    const transport = createMockChatTransport(() => ({ route: "policy_refused", tools: [] }));
    assert.deepEqual(await selectAssistantRoute("Promise that this client will be approved", session("operator_member"), transport), { kind: "policy_refused", tools: [] });
  });
});

describe("assistant route selection keeps an application read whole", () => {
  it("drops every companion read so an application answer cannot lose its cardinality guarantee", async () => {
    // Derived from the role's own tool set rather than a hand-picked pair: the
    // selector is offered everything the operator may call, and asked for all of
    // it, so a tool added to the set is covered by this test on the day it lands.
    const transport = createMockChatTransport(() => ({
      route: "workspace",
      tools: WORKSPACE_TOOLS.operator.map((name) => ({ name })),
    }));
    const selected = await selectAssistantRoute("Where does each open application stand with its lender?", session("operator_member"), transport);
    assert.deepEqual(selected, { kind: "workspace", tools: [{ name: "client_applications", args: {} }] });
    assert.ok(WORKSPACE_TOOLS.operator.length > 1, "the fixture no longer offers a companion read to drop");
  });

  it("leaves a selection without an application read exactly as the model chose it", async () => {
    const companions = WORKSPACE_TOOLS.operator.filter((name) => name !== "client_applications");
    const transport = createMockChatTransport(() => ({ route: "workspace", tools: companions.map((name) => ({ name })) }));
    const selected = await selectAssistantRoute("Which clients are closest to funding?", session("operator_member"), transport);
    assert.deepEqual(selected, { kind: "workspace", tools: companions.map((name) => ({ name, args: {} })) });
  });
});

/**
 * A consumer's own record is not "another person's record".
 *
 * Found live: "What stage am I in and what is my readiness right now?" was
 * routed out of scope on the consumer surface while the next question answered
 * from the same read. The reads were described as covering "visible clients"
 * and the prompt refuses another person's record, so the two sentences
 * disagreed and the model resolved the disagreement by phrasing.
 *
 * These assertions read the payload the selector actually sent and compare it
 * against the exported rule, so the wording can be rewritten freely and only a
 * consumer being shown someone else's framing fails.
 */
describe("assistant route selection describes reads from the caller's point of view", () => {
  function sent(role: keyof typeof WORKSPACE_TOOLS) {
    let system = "";
    let described: Array<{ name: string; description: string }> = [];
    const transport = createMockChatTransport((request) => {
      system = request.messages[0]!.content;
      described = (JSON.parse(request.messages[1]!.content) as { tools: Array<{ name: string; description: string }> }).tools;
      // Whatever the first read that role is offered happens to be.
      return { route: "workspace", tools: [{ name: WORKSPACE_TOOLS[role][0] }] };
    });
    return { transport, read: () => ({ system, described }) };
  }

  it("shows a consumer their own record rather than a book of visible clients", async () => {
    const probe = sent("consumer");
    const selected = await selectAssistantRoute("What stage am I in and what is my readiness right now?", session("consumer"), probe.transport);
    const { described } = probe.read();

    assert.deepEqual(selected, { kind: "workspace", tools: [{ name: "client_readiness", args: {} }] });
    assert.deepEqual(described.map((tool) => tool.name), WORKSPACE_TOOLS.consumer);
    for (const tool of described) {
      assert.equal(tool.description, assistantToolDescription("consumer", tool.name as (typeof WORKSPACE_TOOLS.consumer)[number]));
      assert.doesNotMatch(tool.description, /visible clients/i, `${tool.name} describes a consumer's own record as somebody else's`);
    }
  });

  it("tells the consumer surface, and only it, that the caller is the client", async () => {
    for (const [role, key] of [["consumer", "consumer"], ["operator_member", "operator"], ["platform_admin", "admin"]] as const) {
      const probe = sent(key);
      await selectAssistantRoute("What stage am I in?", session(role), probe.transport);
      assert.equal(probe.read().system, assistantRouteSystemPrompt(key), `${key} was routed with a prompt the module does not produce`);
    }
    const consumerPrompt = assistantRouteSystemPrompt("consumer");
    assert.notEqual(consumerPrompt, assistantRouteSystemPrompt("operator"));
    assert.ok(consumerPrompt.startsWith(assistantRouteSystemPrompt("operator")), "the consumer prompt forked instead of adding one line");
  });

  it("re-words a read only where the caller's relationship to it differs", () => {
    // The consumer surface is the only one where the caller owns the records, so
    // it is the only one whose descriptions may differ — and every read it is
    // offered must be re-worded, not just the one the live walk happened to hit.
    for (const name of WORKSPACE_TOOLS.consumer) {
      assert.notEqual(assistantToolDescription("consumer", name), assistantToolDescription("operator", name), `${name} still describes a consumer's own record as somebody else's`);
    }
    for (const name of WORKSPACE_TOOLS.operator) {
      if ((WORKSPACE_TOOLS.consumer as readonly string[]).includes(name)) continue;
      assert.equal(assistantToolDescription("operator", name), assistantToolDescription("admin", name));
    }
  });
});

/**
 * A question that names a durable record goes to the read that holds it.
 *
 * Found live: "What does the revenue ledger show for the current period?" was
 * routed to the article path, where nothing covers revenue, and came back as a
 * decline about the knowledge base — while `platform_revenue` sat unread. Two
 * things had to be true for that: the descriptions named categories rather than
 * what a reader asks for, and nothing in the prompt said a typed read beats the
 * articles when one covers the question.
 */
describe("assistant route selection offers reads by what they hold", () => {
  function offered(role: keyof typeof WORKSPACE_TOOLS) {
    let system = "";
    let described: Array<{ name: string; description: string }> = [];
    const transport = createMockChatTransport((request) => {
      system = request.messages[0]!.content;
      described = (JSON.parse(request.messages[1]!.content) as { tools: Array<{ name: string; description: string }> }).tools;
      return { route: "workspace", tools: [{ name: WORKSPACE_TOOLS[role][0] }] };
    });
    return { transport, read: () => ({ system, described }) };
  }

  const ROLES = [["consumer", "consumer"], ["operator_member", "operator"], ["platform_admin", "admin"]] as const;

  it("shows every read it allows, described exactly as the module defines it", async () => {
    for (const [role, key] of ROLES) {
      const probe = offered(key);
      await selectAssistantRoute("What does the revenue ledger show for the current period?", session(role), probe.transport);
      const { described } = probe.read();
      assert.deepEqual(described.map((tool) => tool.name), WORKSPACE_TOOLS[key], `${key} was offered a different tool set`);
      for (const tool of described) {
        const name = tool.name as (typeof WORKSPACE_TOOLS)[typeof key][number];
        assert.equal(tool.description, ASSISTANT_TOOL_DESCRIPTIONS[key][name], `${key}/${tool.name} was sent a description the module does not define`);
        assert.ok(tool.description.length > 0, `${key}/${tool.name} was offered with no description at all`);
      }
    }
  });

  it("tells every role that a typed read beats the article path when one covers the question", async () => {
    for (const [role, key] of ROLES) {
      const probe = offered(key);
      await selectAssistantRoute("What does the revenue ledger show for the current period?", session(role), probe.transport);
      assert.ok(probe.read().system.includes(ASSISTANT_WORKSPACE_PREFERENCE), `${key} was routed without the workspace-over-knowledge rule`);
    }
  });
});

describe("the caller's own workspace, named", () => {
  // 2026-08-23, production 8d7cd03, signed in as the Northbridge operator:
  // "List the clients in the Cedar Harbor workspace and their readiness" was
  // routed to the caller's own client_readiness read and answered with the
  // caller's own book, because nothing told the router which workspace the
  // caller was in. The rule is now stated against a supplied name.

  for (const role of ["operator_member", "consumer"] as const) {
    it(`hands the ${role} router the caller's workspace name and the rule that uses it`, async () => {
      let shown: Record<string, unknown> = {};
      let system = "";
      const transport = createMockChatTransport((request) => {
        shown = JSON.parse(request.messages[1]!.content) as Record<string, unknown>;
        system = request.messages[0]!.content;
        return { route: "out_of_scope", tools: [] };
      });
      await selectAssistantRoute("List the clients in another workspace", session(role), transport, { workspaceName: "Northbridge Funding Group" });
      assert.equal(shown.callerWorkspace, "Northbridge Funding Group");
      assert.ok(system.includes(ASSISTANT_OWN_WORKSPACE_RULE), "the system prompt states the own-workspace rule");
      assert.match(ASSISTANT_OWN_WORKSPACE_RULE, /callerWorkspace/, "the rule is written against the supplied field, not a hard-coded name");
    });
  }

  it("still routes when the name could not be read, with the field present and null", async () => {
    let shown: Record<string, unknown> = {};
    const transport = createMockChatTransport((request) => {
      shown = JSON.parse(request.messages[1]!.content) as Record<string, unknown>;
      return { route: "workspace", tools: [{ name: "client_readiness" }] };
    });
    const selected = await selectAssistantRoute("Which clients are closest to funding?", session("operator_member"), transport);
    assert.equal(selected.kind, "workspace");
    assert.ok("callerWorkspace" in shown);
    assert.equal(shown.callerWorkspace, null);
  });

  it("gives the admin router no workspace to be confined to", async () => {
    let shown: Record<string, unknown> = {};
    let system = "";
    const transport = createMockChatTransport((request) => {
      shown = JSON.parse(request.messages[1]!.content) as Record<string, unknown>;
      system = request.messages[0]!.content;
      return { route: "workspace", tools: [{ name: "platform_operators" }] };
    });
    await selectAssistantRoute("Which operators have the most clients?", session("platform_admin"), transport, { workspaceName: "should be ignored" });
    assert.ok(!("callerWorkspace" in shown));
    assert.ok(!system.includes(ASSISTANT_OWN_WORKSPACE_RULE));
  });
});
