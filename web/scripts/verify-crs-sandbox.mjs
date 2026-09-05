import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createSandboxAdapter } from '../src/lib/crs/sandbox/driver.ts';
import { CRS_SPEC_PATHS } from '../src/lib/crs/spec-catalog.ts';

const WEB_ROOT = path.resolve(import.meta.dirname, '..');
const ENV_PATH = path.join(WEB_ROOT, '.env.local');
const REQUIRED_KEYS = ['CRS_BASE_URL', 'CRS_API_KEY', 'CRS_SECRET'];

function say(line) {
  process.stdout.write(`${line}\n`);
}

function parseEnvFile(source) {
  const values = {};
  for (const sourceLine of source.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function stepForUrl(url) {
  const pathname = new URL(url).pathname;
  if (pathname.endsWith(CRS_SPEC_PATHS.directLogin)) return 'login';
  if (pathname.endsWith(CRS_SPEC_PATHS.directUserRegistration)) return 'register';
  if (pathname.endsWith(CRS_SPEC_PATHS.ditIdentity)) return 'dit';
  if (pathname.includes('/users/smfa-send-link/')) return 'send-smfa-link';
  if (pathname.includes('/direct/preauth-token/')) return 'read-preauth';
  if (pathname.includes('/direct/close-account/')) return 'close-member';
  if (pathname.includes('/users/smfa-verify-status/')) return 'smfa-verify-status';
  if (pathname.includes('/smfa/auth/')) return 'open-smfa-link';
  return 'exchange-preauth';
}

function timedFetch() {
  return async (input, init) => {
    const startedAt = performance.now();
    const step = stepForUrl(String(input));
    try {
      const response = await fetch(input, init);
      say(`${step} status=${response.status} elapsedMs=${Math.round(performance.now() - startedAt)}`);
      return response;
    } catch {
      say(`${step} status=transport_error elapsedMs=${Math.round(performance.now() - startedAt)}`);
      throw new Error('CRS_SANDBOX_TRANSPORT_FAILED');
    }
  };
}

async function main() {
  let envSource;
  try {
    envSource = await readFile(ENV_PATH, 'utf8');
  } catch {
    say('CRS sandbox credentials are missing from web/.env.local.');
    process.exitCode = 2;
    return;
  }
  const env = parseEnvFile(envSource);
  if (REQUIRED_KEYS.some((key) => typeof env[key] !== 'string' || env[key].trim() === '')) {
    say('CRS sandbox credentials are missing from web/.env.local.');
    process.exitCode = 2;
    return;
  }

  const adapter = createSandboxAdapter({
    apiKey: env.CRS_API_KEY,
    baseUrl: env.CRS_BASE_URL.replace(/\/$/, ''),
    exposeVerificationUrl: false,
    secret: env.CRS_SECRET,
    timeoutMs: 10_000,
  }, {
    clock: { now: () => new Date() },
    fetchImpl: timedFetch(),
    webhookConfig: { basicPass: null, basicUser: null, hmacHeader: 'x-crs-signature', hmacSecret: null, sourceIps: [] },
  });

  let memberRef = null;
  let failed = false;
  const verificationStartedAt = performance.now();
  try {
    const suffix = randomUUID();
    // CRS's published "mocked end-to-end (EFX 1-bureau)" test identity: SSN 666-10-1000 with
    // mobile 555-555-1201 bypasses the live Equifax demo and always passes DIT. Any name,
    // address, or email is accepted for it (the sandbox rewrites the name to its fixture).
    // See https://crsintegration.redocly.app/client-spec/test-cases (DIT + SMFA).
    const created = await adapter.createMember({
      address: { city: 'Sandbox', line1: '1 Example Way', postalCode: '00000', state: 'CA' },
      dateOfBirth: '1990-01-01',
      email: `crs-sandbox-verifier-${suffix}@example.test`,
      firstName: 'Sandbox',
      lastName: 'Verifier',
      phone: '5555551201',
      ssn: '666101000',
    });
    memberRef = created.memberRef;

    // Before the consumer opens the link the sandbox must report the challenge as still open.
    const pending = await adapter.submitIdvStep(memberRef, { kind: 'smfa_status' }, created.continuation);
    say(`smfa-before-link outcome=${pending.outcome}`);
    if (pending.outcome !== 'retry') throw new Error('CRS_SANDBOX_SMFA_EXPECTED_RETRY');

    // Open the link the way a phone would; the mocked identity completes SMFA on that visit.
    const linkUrl = pending.challenge.verificationUrl;
    if (typeof linkUrl !== 'string') throw new Error('CRS_SANDBOX_SMFA_LINK_MISSING');
    const opened = await timedFetch()(linkUrl, { redirect: 'follow' });
    if (!opened.ok) throw new Error('CRS_SANDBOX_SMFA_LINK_FAILED');

    const verified = await adapter.submitIdvStep(memberRef, { kind: 'smfa_status' }, created.continuation);
    say(`smfa-after-link outcome=${verified.outcome}`);
    if (verified.outcome !== 'pass') throw new Error('CRS_SANDBOX_SMFA_EXPECTED_PASS');

    await adapter.getPreauthToken(memberRef);
  } catch {
    failed = true;
    say(`verify status=failed elapsedMs=${Math.round(performance.now() - verificationStartedAt)}`);
  } finally {
    if (memberRef !== null) {
      try {
        await adapter.closeMember(memberRef);
      } catch {
        failed = true;
      }
    }
  }
  if (!failed) say(`verify status=passed elapsedMs=${Math.round(performance.now() - verificationStartedAt)}`);
  if (failed) process.exitCode = 1;
}

await main();
