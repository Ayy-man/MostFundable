import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAdminGrounding } from '../kb/admin-answer.ts';
import { citationLabel } from '../kb/chat-driver.ts';
import { buildOperatorGrounding } from '../kb/operator.ts';
import { toAssistantSources } from './sources.ts';

import type { Application } from '../applications/types.ts';
import type { SessionProfile } from '../auth/session.ts';
import type { KbCitation } from '../kb/chat-driver.ts';
import type { HeldDraftRow } from '../support/repository.ts';
import type { TrackerClient } from '../tracker/types.ts';
import type { AdminKbDependencies } from '../kb/admin-answer.ts';
import type { AdminTenantRow } from '../admin/platform.ts';
import type { OperatorKbDependencies } from '../kb/operator.ts';

const BANK_REF = 'first-national-holdings';
const BANK_NAME = 'First National Holdings';

function session(): SessionProfile {
  return { disabledAt: null, id: 'operator-1', manages: [], orgId: 'org-1', orgMembership: null, orgRole: 'owner', role: 'operator_member' };
}

function client(): TrackerClient {
  return {
    analysisAt: null, analysisPending: null, archivedAt: null, archivedById: null, assignedToId: null,
    assignedToName: null, businessName: null, consumerProfileId: null, displayName: 'Rivera Logistics',
    estimatedCompletionAt: null, fundingApprovedCents: null, goalCents: 100_000, health: 'green',
    history: [], id: 'client-a', lastActivityAt: '2026-08-16T00:00:00Z', matchesUnlockedOverride: false,
    monitoring: 'active', nextRefreshAt: null, openActionCount: 2, readiness: 70, stage: 'applying',
    stageEnteredAt: '2026-08-16T00:00:00Z', startedAt: '2026-08-01T00:00:00Z', status: 'active',
  };
}

function application(): Application {
  return {
    amountCents: 10_000, bankRef: BANK_REF, clientId: 'client-a', consumerStatus: 'pending',
    createdAt: '2026-08-16T00:00:00Z', id: 'application-a', operatorStatus: 'todo',
    updatedAt: '2026-08-16T00:00:00Z', visibility: 'inherit',
  };
}

function groundingDependencies(): OperatorKbDependencies {
  return {
    async generateDraft() { return {} as HeldDraftRow; },
    async listApplications() { return [application()]; },
    async listBankRetrievalDocuments(refs) {
      const window = { approved: 1, approvedAmountCents: 100, denied: 0, withdrawn: 0 };
      return (refs ?? []).map((bankRef) => ({
        bankRef,
        document: { bank_ref: bankRef, heat_level: 'warm', windows: { d183: window, d30: window, d365: window, d60: window, d90: window } },
        documentFingerprint: 'f',
        rebuiltAt: '2026-08-16T00:00:00Z',
        statsVersion: 1,
      }));
    },
    async listTrackerClients() { return [client()]; },
    transport: () => { throw new Error('grounding does not call the model'); },
  };
}

/**
 * Cite every document the real grounding builder produces.
 *
 * The ids and titles are not written here: `buildOperatorGrounding` owns those
 * shapes, and this module reads them back. Taking them from the builder is what
 * makes the test a regression rather than a restatement — change
 * `application:<id>` to `app:<id>`, or drop the `Application ` prefix from the
 * title, and the assertions below fail on the next run instead of on somebody's
 * screen.
 */
async function citationsForEveryDocument(): Promise<readonly KbCitation[]> {
  const documents = await buildOperatorGrounding(session(), 'anything', groundingDependencies());
  // `citationLabel` is what `runGroundedChat` stamps onto every citation before
  // it leaves the KB module, so building the fixture with it is building the
  // real thing rather than an approximation of it.
  return documents.map((document) => ({
    id: document.id,
    label: citationLabel(document),
    title: document.title,
    url: document.url,
  }));
}

describe('assistant sources', () => {
  it('names every grounding document a real answer can cite', async () => {
    const citations = await citationsForEveryDocument();
    const sources = toAssistantSources(citations, new Map([[BANK_REF, BANK_NAME]]));

    assert.equal(sources.length, citations.length);
    assert.deepEqual(
      sources.map((source) => source.kind).sort(),
      ['bank', 'client', 'metric'],
    );
    for (const source of sources) {
      assert.equal(source.label.trim().length > 0, true);
    }
  });

  it('puts no lender handle on screen, in any label', async () => {
    // Rail 3: the handle is the vault's internal name for a lender and is never
    // client-facing text. Every label is checked, not only the lender chip,
    // because the application chip is built from a title that carries the handle.
    const citations = await citationsForEveryDocument();
    const sources = toAssistantSources(citations, new Map([[BANK_REF, BANK_NAME]]));

    for (const source of sources) {
      assert.equal(source.label.includes(BANK_REF), false, `label leaked the handle: ${source.label}`);
    }
  });

  it('drops a source it cannot name rather than rendering the handle', async () => {
    // The empty map is the real state with FEATURE_VAULT off or the read model
    // unbuilt — `defaultBankLabels` returns exactly this. Watched failing with a
    // `?? bankRef` fallback in place of the `undefined` guards in
    // `toAssistantSources`: the lender and application chips then come back
    // labelled with the handle.
    const citations = await citationsForEveryDocument();
    const sources = toAssistantSources(citations, new Map());

    assert.deepEqual(sources.map((source) => source.kind), ['client']);
    assert.equal(
      sources[0]?.label,
      citationLabel({ content: '', id: `tracker:${client().id}`, metadata: {}, title: client().displayName, url: '', label: `Client · ${client().displayName}` }),
    );
  });

  it('shows one chip per source when an answer cites the same document twice', async () => {
    const citations = await citationsForEveryDocument();
    const sources = toAssistantSources([...citations, ...citations], new Map([[BANK_REF, BANK_NAME]]));

    assert.equal(sources.length, citations.length);
  });

  it('reads the handle out of a lender id that contains a colon', () => {
    // `lender:<bankRef>:<statsVersion>` and a ref may itself contain a colon, so
    // the split has to be from the right. A left split would resolve nothing for
    // any such lender and quietly drop its chip.
    const ref = 'group:regional';
    const sources = toAssistantSources(
      [{ id: `lender:${ref}:4`, label: `Lender · ${ref}`, title: `Lender ${ref}` }],
      new Map([[ref, 'Regional Group']]),
    );

    assert.deepEqual(sources, [{ kind: 'bank', label: 'Regional Group', ref: `lender:${ref}:4` }]);
  });

  it('renders sanitized workspace-tool application and bank labels without raw identifiers', () => {
    const sources = toAssistantSources([
      { id: 'application:0', label: 'Application · Acme Bakery · Example Bank · Application 1', title: 'Application · Acme Bakery · Example Bank · Application 1' },
      { id: 'lender:0', label: 'Bank · Example Bank', title: 'Bank · Example Bank' },
    ], new Map());

    assert.deepEqual(sources, [
      { kind: 'metric', label: 'Application · Acme Bakery · Example Bank · Application 1', ref: 'application:0' },
      { kind: 'bank', label: 'Example Bank', ref: 'lender:0' },
    ]);
  });
});

describe('assistant sources from the platform builder', () => {
  const TENANT: AdminTenantRow = {
    clients: 9, fundedAllTimeCents: 900_000, fundedOutcomes: 3, fundedYtdCents: 500_000,
    fundingReadyDays: 21, id: 'e1000000-0000-4000-8000-000000000001', membership: 'active',
    name: 'Northbridge Capital', plan: 'growth', slug: 'northbridge', startedAt: '2026-01-04',
  };

  function adminDependencies(): AdminKbDependencies {
    return {
      async readCounts() { return { analyses: 12, consumers: 40, operators: 1 }; },
      async readFundedVolume() { return { monthly: [{ amountCents: 500_000, label: '2026-07' }], weekly: [] }; },
      async readPlatformMrrCents() { return 250_000; },
      async readTenants() { return [TENANT]; },
      today: () => '2026-08-22',
      transport: () => { throw new Error('not reached'); },
    };
  }

  it('gives every platform document a chip, and the kind the design brief names', async () => {
    // Derived from the builder rather than listed. The brief says admin chips
    // resolve to operators and analytics; if a document kind is added that
    // `toAssistantSources` has no branch for, its chip is silently dropped and
    // the answer loses provenance without anything failing. Comparing the chip
    // count against the document count is what catches that.
    const documents = await buildAdminGrounding(adminDependencies());
    const citations: KbCitation[] = documents.map((document) => ({
      id: document.id,
      label: citationLabel(document),
      title: document.title,
    }));

    const sources = toAssistantSources(citations, new Map());

    assert.equal(sources.length, documents.length, 'a platform document produced no chip');
    assert.deepEqual(
      sources.map((source) => source.kind).sort(),
      ['metric', 'metric', 'operator'],
    );
    // The label is the stamped human phrase and the ref is the peek handle,
    // which is `@opaque` and never rendered.
    const operator = sources.find((source) => source.kind === 'operator');
    assert.equal(operator?.label, `Operator · ${TENANT.name}`);
    assert.equal(operator?.ref, `operator:${TENANT.id}`);
  });
});
