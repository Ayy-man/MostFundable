#!/usr/bin/env node
// narrative-smoke.mjs — one live narrative against the real model, checked by the real checker.
//
// The unit tests prove the checker and the mock arm. They cannot prove the thing that actually
// decides whether this ships: that `openai/gpt-5.6-luna` at high effort, handed this prompt and a
// real facts pack, writes prose that `checkNarrative` approves on the first attempt. That is a
// property of the prompt and the model together, and only a live call measures it.
//
//   node --import ./scripts/ts-resolve-hook.mjs scripts/narrative-smoke.mjs [--scenario maxed]
//
// It reads OPENROUTER_API_KEY from web/.env.local and prints one summary line: attempts, the
// verdict string, and any codes. It never prints the key, the headers, or the raw response.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));
const SHARED_ENV_PATH = '/Users/aymanbaig/DEV/MostFundable/web/.env.local';

function readKey() {
  for (const path of [ENV_PATH, SHARED_ENV_PATH]) {
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const match = /^OPENROUTER_API_KEY=(.+)$/.exec(line.trim());
      if (match) return match[1].replace(/^["']|["']$/g, '').trim();
    }
  }
  return null;
}

const apiKey = readKey();
if (apiKey === null) {
  console.error('no OPENROUTER_API_KEY in web/.env.local');
  process.exit(2);
}

const { createOpenRouterNarrativeDriver, NARRATIVE_DEFAULT_MODEL } = await import('../src/lib/llm/narrative/driver.ts');
const { checkNarrative } = await import('../src/lib/llm/narrative/grounding.ts');
const { NARRATIVE_EMBEDDED_PROMPT } = await import('../src/lib/llm/narrative/prompt.ts');
const { NARRATIVE_REFERENCE_DATASET } = await import('../src/lib/llm/narrative/reference-pack.ts');
const { maxedCardsPack } = await import('../src/lib/llm/narrative/__fixtures__/packs.ts');

const scenario = process.argv.includes('--scenario')
  ? process.argv[process.argv.indexOf('--scenario') + 1]
  : 'maxed';
const model = process.argv.includes('--model')
  ? process.argv[process.argv.indexOf('--model') + 1]
  : NARRATIVE_DEFAULT_MODEL;
const pack = scenario === 'maxed' ? maxedCardsPack() : NARRATIVE_REFERENCE_DATASET[0];

const driver = createOpenRouterNarrativeDriver({ apiKey, model });
const prompt = { ...NARRATIVE_EMBEDDED_PROMPT, source: 'embedded' };

let attempts = 0;
let verdict = null;
let codes = ['NARRATIVE_DRIVER_FAILED'];
const perAttempt = [];
for (let attempt = 0; attempt < 2; attempt += 1) {
  attempts += 1;
  let narrative;
  try {
    narrative = await driver.write(pack, prompt);
  } catch (error) {
    const status = typeof error?.status === 'number' ? error.status : 'none';
    codes = [`DRIVER_THREW:${error instanceof Error ? error.message : 'unknown'}:status=${status}`];
    perAttempt.push(codes[0]);
    continue;
  }
  const result = checkNarrative(narrative, pack);
  codes = result.codes;
  perAttempt.push(result.approved ? 'approved' : result.codes.join('+'));
  if (!result.approved && result.codes.includes('NUMBER_UNGROUNDED') && process.env.DIAGNOSE) {
    // The fixture packs are synthetic, so naming the offending token is safe here.
    const { allowedNumbers } = await import('../src/lib/llm/narrative/grounding.ts');
    const allowed = allowedNumbers(pack);
    const prose = [narrative.verdict, narrative.whereYouStand,
      ...narrative.nextSteps.flatMap((step) => [step.title, step.detail]),
      ...Object.values(narrative.itemNotes), narrative.businessSide, narrative.timeline.reason];
    for (const field of prose) {
      for (const match of field.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
        if (!allowed.has(match[0].replace(/,/g, ''))) {
          console.log(`  ungrounded ${JSON.stringify(match[0])} in: ${field.slice(0, 150)}`);
        }
      }
    }
  }
  verdict = narrative.verdict;
  if (result.approved) {
    console.log(JSON.stringify({
      scenario,
      model: driver.model,
      attempts,
      perAttempt,
      passed: true,
      codes: [],
      verdict,
      steps: narrative.nextSteps.map((step) => step.title),
      band: narrative.timeline.band,
      itemNotes: Object.keys(narrative.itemNotes).length,
    }));
    process.exit(0);
  }
}

console.log(JSON.stringify({ scenario, model: driver.model, attempts, perAttempt, passed: false, codes, verdict }));
process.exit(1);
