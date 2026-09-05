#!/usr/bin/env node
// narrative-eval.mjs — the narrative eval, run through the shipped driver.
//
// Every case goes through `createOpenRouterNarrativeDriver` (the real transport, the real strict
// schema, the real fence stripping and schema matcher) and then `checkNarrative`, exactly as
// `runNarrativeEngine` would run it inside an analysis job. A side harness that parses the model's
// text itself measures the prompt; this measures production. The 2026-09-05 rerun found that the
// difference was the whole result.
//
//   node --import ./scripts/ts-resolve-hook.mjs scripts/narrative-eval.mjs \
//     --models anthropic/claude-sonnet-5,openai/gpt-oss-120b [--scenarios 05,12] \
//     [--attempts 2] [--concurrency 2] [--pair x-ai/grok-4.3,deepseek/deepseek-v4-flash] \
//     [--no-require-parameters openai/gpt-5.6-luna] [--out results.json]
//
// It reads OPENROUTER_API_KEY from web/.env.local and never prints the key or a raw response. The
// scenarios are synthetic (`narrative-eval-scenarios.mjs`), so a rejected narrative's prose is
// printed in full to make the failure diagnosable: every number in it is invented.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function readKey() {
  const text = readFileSync(ENV_PATH, 'utf8');
  for (const line of text.split('\n')) {
    const match = /^OPENROUTER_API_KEY=(.+)$/.exec(line.trim());
    if (match) return match[1].replace(/^["']|["']$/g, '').trim();
  }
  return null;
}

const apiKey = readKey();
if (apiKey === null) {
  console.error('no OPENROUTER_API_KEY in web/.env.local');
  process.exit(2);
}

const { createOpenRouterNarrativeDriver } = await import('../src/lib/llm/narrative/driver.ts');
const { allowedNumbers, checkNarrative } = await import('../src/lib/llm/narrative/grounding.ts');
const { complianceLanguageCodes } = await import('../src/lib/compliance/language-rules.mjs');
const { NARRATIVE_EMBEDDED_PROMPT } = await import('../src/lib/llm/narrative/prompt.ts');
const { NARRATIVE_EVAL_SCENARIOS } = await import('./narrative-eval-scenarios.mjs');

const models = argument('--models', 'anthropic/claude-sonnet-5').split(',').map((model) => model.trim()).filter(Boolean);
const scenarioFilter = argument('--scenarios', '').split(',').map((part) => part.trim()).filter(Boolean);
const attemptsPerCase = Number(argument('--attempts', '2'));
const noRequireParameters = new Set(argument('--no-require-parameters', '').split(',').map((model) => model.trim()).filter(Boolean));
const outPath = argument('--out', null);
// Models run this many at a time. The 2026-09-05 smoke ran eight at once and every model's median
// latency went from ~25s to ~100s, tripping the driver's 120s limit on requests that pass alone;
// two keeps the wall clock sane without starving any one stream.
const concurrency = Number(argument('--concurrency', '2'));
// `--pair primary,fallback` also scores the two as the engine runs them: first attempt on the
// primary, second on the fallback. Both must be in --models; the attempts come from their own runs.
const pair = argument('--pair', '').split(',').map((model) => model.trim()).filter(Boolean);

const scenarios = NARRATIVE_EVAL_SCENARIOS.filter((scenario) =>
  scenarioFilter.length === 0 || scenarioFilter.some((part) => scenario.name.includes(part)),
);
const prompt = { ...NARRATIVE_EMBEDDED_PROMPT, source: 'embedded' };

function proseOf(narrative) {
  return [
    narrative.verdict,
    narrative.whereYouStand,
    ...narrative.nextSteps.flatMap((step) => [step.title, step.detail]),
    ...Object.values(narrative.itemNotes),
    narrative.businessSide,
    narrative.timeline.reason,
  ];
}

function ungroundedNumbers(narrative, pack) {
  const allowed = allowedNumbers(pack);
  const found = new Set();
  for (const field of proseOf(narrative)) {
    for (const match of field.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const canonical = String(Number(match[0].replace(/,/g, '')));
      if (!allowed.has(canonical)) found.add(match[0]);
    }
  }
  return [...found];
}

function wrappedFetch(model, capture) {
  return async (url, init) => {
    const body = JSON.parse(String(init.body));
    if (noRequireParameters.has(model)) delete body.provider.require_parameters;
    body.usage = { include: true };
    const started = Date.now();
    const response = await fetch(url, { ...init, body: JSON.stringify(body) });
    const text = await response.text();
    capture.ms = Date.now() - started;
    capture.status = response.status;
    try {
      const parsed = JSON.parse(text);
      capture.cost = parsed.usage?.cost ?? null;
      capture.completionTokens = parsed.usage?.completion_tokens ?? null;
      capture.provider = parsed.provider ?? null;
      capture.error = parsed.error?.message ?? null;
      capture.finish = parsed.choices?.[0]?.finish_reason ?? null;
      capture.content = parsed.choices?.[0]?.message?.content ?? null;
    } catch { /* not json */ }
    return new Response(text, { status: response.status, headers: response.headers });
  };
}

async function runModel(model) {
  const cases = [];
  for (const scenario of scenarios) {
    const attempts = [];
    let passed = false;
    for (let attempt = 1; attempt <= attemptsPerCase && !passed; attempt += 1) {
      const capture = {};
      const driver = createOpenRouterNarrativeDriver({ apiKey, model, fetch: wrappedFetch(model, capture) });
      let record;
      try {
        const narrative = await driver.write(scenario.pack, prompt);
        const check = checkNarrative(narrative, scenario.pack);
        record = {
          attempt,
          approved: check.approved,
          codes: check.codes,
          ms: capture.ms,
          cost: capture.cost,
          completionTokens: capture.completionTokens,
          provider: capture.provider,
          verdict: narrative.verdict,
          band: narrative.timeline.band,
        };
        if (!check.approved) {
          record.diagnosis = {
            ungroundedNumbers: check.codes.includes('NUMBER_UNGROUNDED') ? ungroundedNumbers(narrative, scenario.pack) : [],
            languageRules: check.codes.includes('LANGUAGE') ? complianceLanguageCodes(proseOf(narrative)) : [],
            prose: proseOf(narrative),
            itemNoteKeys: Object.keys(narrative.itemNotes),
            expectedNoteKeys: scenario.pack.personal.filter((fact) => fact.state === 'unverified').map((fact) => fact.key),
          };
        }
        passed = check.approved;
      } catch (error) {
        record = {
          attempt,
          approved: false,
          codes: ['DRIVER_THREW'],
          error: error instanceof Error ? error.message : String(error),
          upstream: capture.error ?? null,
          status: capture.status ?? null,
          finish: capture.finish ?? null,
          ms: capture.ms ?? null,
          cost: capture.cost ?? null,
          completionTokens: capture.completionTokens ?? null,
          provider: capture.provider ?? null,
          contentHead: typeof capture.content === 'string' ? capture.content.slice(0, 400) : null,
        };
        if (capture.status === 404) attempt = attemptsPerCase;
      }
      attempts.push(record);
      console.log(JSON.stringify({ model, scenario: scenario.name, attempt: record.attempt, approved: record.approved, codes: record.codes, ms: record.ms, cost: record.cost, provider: record.provider, error: record.error ?? undefined, upstream: record.upstream ?? undefined }));
    }
    cases.push({ model, scenario: scenario.name, passed, attempts });
  }
  return cases;
}

const started = Date.now();
const queue = [...models];
const perModel = new Map();
await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
  for (let model = queue.shift(); model !== undefined; model = queue.shift()) perModel.set(model, await runModel(model));
}));
const results = models.flatMap((model) => perModel.get(model));

const summary = models.map((model) => {
  const own = results.filter((result) => result.model === model);
  const first = own.filter((result) => result.attempts[0]?.approved).length;
  const passed = own.filter((result) => result.passed).length;
  const cost = own.reduce((sum, result) => sum + result.attempts.reduce((inner, attempt) => inner + (attempt.cost ?? 0), 0), 0);
  const latencies = own.flatMap((result) => result.attempts.map((attempt) => attempt.ms)).filter((ms) => typeof ms === 'number');
  const codes = {};
  for (const result of own) for (const attempt of result.attempts) for (const code of attempt.codes) codes[code] = (codes[code] ?? 0) + 1;
  return {
    model,
    cases: own.length,
    passedFirstAttempt: first,
    passed,
    totalCost: Number(cost.toFixed(4)),
    costPerApproved: passed > 0 ? Number((cost / passed).toFixed(4)) : null,
    medianMs: latencies.length ? latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)] : null,
    codes,
  };
});

console.log('');
console.log('SUMMARY');
for (const row of summary) {
  console.log(`${row.model.padEnd(34)} passed ${String(row.passed).padStart(2)}/${row.cases} (first attempt ${row.passedFirstAttempt})  cost $${row.totalCost.toFixed(3)}  per approved ${row.costPerApproved === null ? 'n/a' : '$' + row.costPerApproved.toFixed(4)}  median ${row.medianMs === null ? 'n/a' : Math.round(row.medianMs / 1000) + 's'}  ${JSON.stringify(row.codes)}`);
}
let pairSummary = null;
if (pair.length === 2 && pair.every((model) => models.includes(model))) {
  const [primary, fallback] = pair;
  const rows = scenarios.map((scenario) => {
    const first = results.find((result) => result.model === primary && result.scenario === scenario.name)?.attempts[0];
    const second = results.find((result) => result.model === fallback && result.scenario === scenario.name)?.attempts[0];
    const passed = Boolean(first?.approved || second?.approved);
    const cost = (first?.cost ?? 0) + (first?.approved ? 0 : second?.cost ?? 0);
    const ms = (first?.ms ?? 0) + (first?.approved ? 0 : second?.ms ?? 0);
    return { scenario: scenario.name, passed, byPrimary: Boolean(first?.approved), cost, ms };
  });
  const latencies = rows.map((row) => row.ms).sort((a, b) => a - b);
  pairSummary = {
    primary,
    fallback,
    cases: rows.length,
    passed: rows.filter((row) => row.passed).length,
    passedByPrimary: rows.filter((row) => row.byPrimary).length,
    totalCost: Number(rows.reduce((sum, row) => sum + row.cost, 0).toFixed(4)),
    medianMs: latencies[Math.floor(latencies.length / 2)] ?? null,
    failed: rows.filter((row) => !row.passed).map((row) => row.scenario),
  };
  console.log(`PAIR ${primary} -> ${fallback}: passed ${pairSummary.passed}/${pairSummary.cases} (primary alone ${pairSummary.passedByPrimary})  cost $${pairSummary.totalCost.toFixed(3)}  median ${Math.round(pairSummary.medianMs / 1000)}s  failed ${JSON.stringify(pairSummary.failed)}`);
}
console.log(`elapsed ${Math.round((Date.now() - started) / 1000)}s`);

if (outPath) {
  writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), models, scenarios: scenarios.map((scenario) => scenario.name), attemptsPerCase, noRequireParameters: [...noRequireParameters], summary, pair: pairSummary, results }, null, 2));
}
process.exit(summary.every((row) => row.passed === row.cases) ? 0 : 1);
