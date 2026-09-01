import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { createAssistantRepository } from './repository.ts';
import { ASSISTANT_SOURCE_KINDS } from './types.ts';

interface RpcCall { readonly name: string; readonly args: Record<string, unknown> }

function recording(data: unknown): { createAdmin: () => never; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ args, name });
      return Promise.resolve({ data, error: null });
    },
  };
  return { calls, createAdmin: () => client as never };
}

const MIGRATION = readFileSync(
  new URL('../../../../supabase/migrations/387_assistant_conversations.sql', import.meta.url),
  'utf8',
);

/**
 * The argument names migration 387 declares for one function.
 *
 * Read out of the migration rather than listed here, because the migration is
 * what owns them. PostgREST matches named arguments exactly: a repository that
 * sends `p_conversation` to a function declared with `p_conversation_id` fails
 * at runtime with a "function does not exist" that names neither side, and no
 * type in this codebase would have caught it.
 */
function declaredArguments(functionName: string): ReadonlySet<string> {
  const pattern = new RegExp(`create (?:or replace )?function public\\.${functionName}\\s*\\(([^)]*)\\)`, 'i');
  const match = pattern.exec(MIGRATION);
  assert.notEqual(match, null, `migration 387 declares no function public.${functionName}`);
  return new Set([...match![1]!.matchAll(/\bp_[a-z_]+/g)].map((found) => found[0]!));
}

describe('assistant repository', () => {
  it('calls each RPC by the name and arguments migration 387 declares', async () => {
    const { calls, createAdmin } = recording({
      body: 'Answered.',
      created_at: '2026-08-22T00:00:00Z',
      id: 'turn-1',
      last_activity_at: '2026-08-22T00:00:00Z',
      role: 'assistant',
      scope: 'operator',
      sources: [],
      title: 'New conversation',
    });
    const repository = createAssistantRepository({ createAdmin });

    // Every operation, so no RPC escapes the check by being the one nobody drove.
    await repository.openConversation('operator', 'operator-1');
    await repository.listConversations('operator-1');
    await repository.listTurns('conversation-1', 'operator-1');
    await repository.appendTurn({ actorProfileId: 'operator-1', body: 'Q', conversationId: 'conversation-1', role: 'user' });
    await repository.deleteConversation('conversation-1', 'operator-1');

    assert.equal(calls.length, 5);
    for (const call of calls) {
      const declared = declaredArguments(call.name);
      for (const argument of Object.keys(call.args)) {
        assert.equal(declared.has(argument), true, `${call.name} has no argument ${argument}`);
      }
    }
  });

  it('drops a stored source with nothing to show', async () => {
    // Watched failing with the `label.length === 0` and `KNOWN_SOURCE_KINDS`
    // guards removed from `mapSources`: the chip row then renders an empty
    // pill and a kind the surface has no rendering for. The permitted kinds come
    // from the exported list, so a sixth kind widens the test with the module.
    const unknownKind = `not-${ASSISTANT_SOURCE_KINDS[0]}`;
    const { createAdmin } = recording([
      {
        body: 'Answered.',
        created_at: '2026-08-22T00:00:00Z',
        id: 'turn-1',
        role: 'assistant',
        sources: [
          { kind: ASSISTANT_SOURCE_KINDS[0], label: 'Rivera Logistics', ref: 'tracker:client-a' },
          { kind: ASSISTANT_SOURCE_KINDS[0], label: '   ', ref: 'tracker:client-b' },
          { kind: unknownKind, label: 'Something else', ref: null },
          'not an object',
        ],
      },
    ]);

    const [turn] = await createAssistantRepository({ createAdmin }).listTurns('conversation-1', 'operator-1');

    assert.deepEqual(turn?.sources, [
      { kind: ASSISTANT_SOURCE_KINDS[0], label: 'Rivera Logistics', ref: 'tracker:client-a' },
    ]);
  });

  it('reads a row whether PostgREST returns it bare or wrapped in an array', async () => {
    // `assistant_open_conversation` returns a composite and the list functions
    // return a set; which shape arrives depends on the function, not on us.
    const row = {
      created_at: '2026-08-22T00:00:00Z',
      id: 'conversation-1',
      last_activity_at: '2026-08-22T00:00:00Z',
      message_count: 3,
      scope: 'operator',
      title: 'New conversation',
    };

    const bare = await createAssistantRepository({ createAdmin: recording(row).createAdmin })
      .openConversation('operator', 'operator-1');
    const wrapped = await createAssistantRepository({ createAdmin: recording([row]).createAdmin })
      .openConversation('operator', 'operator-1');

    assert.deepEqual(bare, wrapped);
    assert.equal(bare.messageCount, 3);
  });

  it('reports a fresh conversation as empty rather than as not-a-number', async () => {
    const { createAdmin } = recording({
      created_at: '2026-08-22T00:00:00Z',
      id: 'conversation-1',
      last_activity_at: '2026-08-22T00:00:00Z',
      scope: 'operator',
      title: 'New conversation',
    });

    const conversation = await createAssistantRepository({ createAdmin }).openConversation('operator', 'operator-1');

    assert.equal(conversation.messageCount, 0);
  });
});
