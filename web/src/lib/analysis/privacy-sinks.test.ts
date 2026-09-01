import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sealReport } from "../crs/report.ts";
import { deriveReadinessPlan } from "../llm/mock-driver.ts";
import { createOpenRouterPlanDriver, OPENROUTER_MODEL } from "../llm/openrouter-driver.ts";
import { extractFeatures } from "./features.ts";
import { createSupabaseAnalysisRepository } from "./repository.ts";

const SUBJECT_MARKER = "123-45-6789";
const ACCOUNT_MARKER = "4111111111111111";
const INSTANT = "2026-08-17T12:00:00.000Z";

function providerReport() {
  return sealReport({
    bureaus: ["EQF"],
    reportCodes: ["EQF1001"],
    pulledAt: INSTANT,
    body: {
      noHit: false,
      perBureau: [{
        bureau: "EQF",
        reportCode: "EQF1001",
        pulledAt: INSTANT,
        subjectRef: SUBJECT_MARKER,
        accounts: [{
          accountRef: ACCOUNT_MARKER,
          kind: "revolving",
          balanceCents: 20_000,
          limitCents: 100_000,
          ageMonths: 24,
          isOpen: true,
          isNegative: false,
        }],
        inquiries: [],
        monthlyDebtPaymentsCents: 10_000,
      }],
    },
  });
}

function containsMarker(value: unknown): boolean {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return serialized.includes(SUBJECT_MARKER) || serialized.includes(ACCOUNT_MARKER);
}

describe("analysis privacy sink matrix", () => {
  it("keeps provider identity markers out of every downstream sink", async () => {
    const logs: unknown[] = [];
    const errors: unknown[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...values) => { logs.push(values); };
    console.error = (...values) => { logs.push(values); };
    try {
      const derived = extractFeatures(providerReport());
      assert.deepEqual(derived.accounts.map((account) => account.accountRef), ["account-1"]);
      assert.equal(containsMarker(derived), false, "derived JSON contains no provider identity marker");

      const plan = deriveReadinessPlan(derived);
      assert.equal(containsMarker(plan), false, "plan body contains no provider identity marker");

      const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
      const repository = createSupabaseAnalysisRepository({
        createClient: () => ({
          async rpc(name: string, args: Record<string, unknown>) {
            rpcCalls.push({ name, args });
            return { data: null, error: { code: "synthetic" } };
          },
        }) as never,
      });
      try {
        await repository.persistResult({
          jobId: "30000000-0000-4000-8000-000000000010",
          workerId: "30000000-0000-4000-8000-000000000011",
          clientId: "30000000-0000-4000-8000-000000000012",
          analysisRunId: "30000000-0000-4000-8000-000000000013",
          readinessScore: plan.readinessScore,
          derived,
          plan,
        });
      } catch (error) { errors.push(error); }
      assert.equal(rpcCalls[0]?.name, "persist_analysis_result");
      assert.equal(containsMarker(rpcCalls), false, "persistence RPC arguments contain no provider identity marker");

      const requestBodies: string[] = [];
      const responsePlan = {
        ...plan,
        generation: { driver: "openrouter" as const, model: OPENROUTER_MODEL, promptVersion: 1 as const },
      };
      const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
        requestBodies.push(String(init?.body));
        const content = requestBodies.length === 1 ? responsePlan : { approved: true, codes: [] };
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
      }) as typeof fetch;
      const driver = createOpenRouterPlanDriver({ apiKey: "not-a-real-openrouter-key", fetch: fetcher });
      const candidate = await driver.generateCandidate(derived);
      await driver.supervise(derived, candidate);
      assert.equal(requestBodies.length, 2);
      assert.equal(containsMarker(requestBodies), false, "OpenRouter request bodies contain no provider identity marker");
    } catch (error) {
      errors.push(error);
      throw error;
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    assert.equal(containsMarker(logs), false, "logs contain no provider identity marker");
    assert.equal(containsMarker(errors.map((error) => error instanceof Error ? error.message : error)), false, "errors contain no provider identity marker");
  });
});
