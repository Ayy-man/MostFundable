// The support surfaces, asserted as source text.
//
// This reads components as strings rather than rendering them, and that is a limitation worth
// stating plainly rather than working around: `package.json`'s test glob is `src/**/*.test.ts`,
// `.tsx` files are not collected, and adding a component runner to prove a bubble is in the corner
// would be a larger change to shared tooling than the thing it proves. So the mechanical half is
// here — the className is untouched, the fixture path is intact, the flag-on branch is what it
// claims to be — and the visual half is a manual walkthrough.
//
// What this file is really guarding is a diff, not a design. Phase 13 touched two files it does
// not own, under INTERFACES §5.2, and the promise attached to that permission was that the changes
// would be additive and the flag-off path would be untouched. These assertions are that promise
// written down somewhere a future edit has to walk past.
//
// The chat rebuild's extraction moved the consumer half of it into
// `components/consumer/team-chat/` and the operator Inbox into `components/operator/inbox/`. Two
// things changed here as a result, and only two. The consumer assertions read the module that now
// owns them. And the deferred-execution check stopped counting.
//
// That second one matters more than it looks. It used to pin four literal totals — twelve
// `setTimeout`s in `consumer.tsx`, one `setInterval`, two `queueMicrotask`s, zero in
// `operator.tsx` — which is exactly the shape round 5 named as the thing that rots: an enumeration
// standing in for a class, drifting every time somebody adds an unrelated animation, and saying
// nothing at all about a timer added to a file the list never heard of. The class it was standing
// in for is "nothing that can reach the support API defers work to a timer". That is now asserted
// directly: the modules are discovered by looking for the support API, and the vocabulary of
// deferral is read out of `verify-no-auto-send.mjs`, which is the file that owns it.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { stripComments } from '@/lib/testing/strip-comments';

const SRC = path.resolve(import.meta.dirname, '../..');
const SURFACES = path.join(SRC, 'components/surfaces');
const COMPONENTS = path.join(SRC, 'components');
const GATE = path.resolve(SRC, '../scripts/verify-no-auto-send.mjs');

const operator = fs.readFileSync(path.join(SURFACES, 'operator.tsx'), 'utf8');
const consumer = fs.readFileSync(path.join(SURFACES, 'consumer.tsx'), 'utf8');
const TEAM_CHAT = path.join(COMPONENTS, 'consumer/team-chat');
const APP = path.join(SRC, 'app');

/**
 * The Team Chat view, file by file.
 *
 * The chat rebuild split one component into a directory, and every assertion below that read
 * `index.tsx` was reading one file of twelve. A rule about the view has to be checked against the
 * view; a rule about one module says nothing about the module beside it that now does the work.
 */
function teamChatFiles(): { name: string; source: string }[] {
  return fs
    .readdirSync(TEAM_CHAT)
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.test.ts'))
    .map((name) => ({ name, source: fs.readFileSync(path.join(TEAM_CHAT, name), 'utf8') }));
}

/** Comment-stripped, because several files here explain a rule using the vocabulary it bans. */
const code = stripComments;


// Assembled rather than written, so this file is not a second occurrence of the literal that
// `verify-no-auto-send.mjs` rule 1 permits in exactly one place.
const SEND_RPC = 'support_' + 'send_message';

/** Every `.tsx` under `components/`, so the sweeps below cannot miss a file by not knowing it. */
function componentFiles(root = COMPONENTS): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...componentFiles(absolute));
    else if (entry.name.endsWith('.tsx')) found.push(absolute);
  }
  return found;
}

/**
 * The components that can reach the support API, discovered rather than listed.
 *
 * A hand-written list of "the chat files" is the enumeration failure again: the next surface that
 * learns to post a message would not be on it, and the check would pass by not looking. Naming the
 * route prefix instead means a file joins this set by acquiring the capability the rule is about.
 */
function supportReachingComponents(): { relative: string; source: string }[] {
  const reaching = componentFiles()
    .filter((file) => !file.endsWith('.test.tsx'))
    .map((file) => ({
      relative: path.relative(SRC, file).split(path.sep).join('/'),
      source: fs.readFileSync(file, 'utf8'),
    }))
    .filter((file) => file.source.includes('/api/support/'));
  assert.ok(
    reaching.length >= 2,
    'no component reaches the support API; the route prefix moved and this check went blind',
  );
  return reaching;
}

/**
 * The deferral vocabulary, read out of the gate that owns it.
 *
 * `verify-no-auto-send.mjs` cannot be imported — it runs its own self-test on load and sets an
 * exit code — so its `DEFERRAL_PATTERNS` table is parsed out of the source. Deriving it means a
 * primitive added there is enforced here on the next run, with nobody remembering to.
 */
function deferralPatterns(): { name: string; pattern: RegExp }[] {
  const gate = fs.readFileSync(GATE, 'utf8');
  const table = /const DEFERRAL_PATTERNS = \[([\s\S]*?)\n\];/.exec(gate);
  assert.ok(table, 'verify-no-auto-send.mjs no longer declares DEFERRAL_PATTERNS');
  const rows = [...table[1].matchAll(/\{ name: "([^"]+)", pattern: (\/.+?\/[a-z]*) \}/g)].map((row) => ({
    name: row[1],
    pattern: new RegExp(row[2].slice(1, row[2].lastIndexOf('/')), row[2].slice(row[2].lastIndexOf('/') + 1)),
  }));
  assert.equal(
    rows.length,
    table[1].split('{ name:').length - 1,
    'a DEFERRAL_PATTERNS row did not parse; the table shape changed',
  );
  assert.ok(rows.length >= 5, 'the deferral vocabulary shrank to almost nothing');
  return rows;
}

/** The text between the ready branch and the explicit disabled fixture branch. */
function enabledBranch(source: string): string {
  const start = source.indexOf('{supportState === "ready" ? (');
  assert.notEqual(start, -1, 'operator.tsx no longer gates the Sheet body on ready support state');
  const end = source.indexOf(') : supportState === "disabled" ? (', start);
  assert.notEqual(end, -1, 'the ready conditional has no explicit disabled fixture branch after it');
  return source.slice(start, end);
}

describe('operator surface contract', () => {
  it('keeps the support bubble clear of the global assistant launcher', () => {
    // SUPP-03 by reuse: #154 put the trigger here and Phase 13 was not asked to move it.
    //
    // This used to assert the whole className as a literal, which is how it went on passing while
    // the thing it is named for stopped being true. The launcher shipped into the same corner, and
    // the pinned string — `bottom-[5rem] ... lg:right-[9rem]` — was itself the collision: measured
    // signed-in against production at 856b839, 12x48px of overlap at 1440x900 and 99 of the pill's
    // 168px covered at 390x844, with `elementFromPoint` at its centre returning the launcher. A
    // transcription cannot catch that, because the transcription is what is wrong.
    //
    // So the position is delegated to the lane the launcher publishes, and this checks that the
    // trigger uses it. The clearance arithmetic lives with the two class strings it is computed
    // from, in `components/assistant/global-companion.test.ts`.
    assert.ok(
      operator.includes('ASSISTANT_LAUNCHER_ADJACENT_CLASS'),
      'the support trigger no longer takes its position from the assistant launcher lane',
    );
    const trigger = operator.slice(operator.indexOf('aria-label="Open Platform support"'));
    const className = /className=\{cn\(ASSISTANT_LAUNCHER_ADJACENT_CLASS, "([^"]+)"\)\}/.exec(
      trigger.slice(0, trigger.indexOf('</Button>')),
    );
    assert.ok(className, 'the support trigger does not compose the shared lane with its own look');
    // The rest of the original intent: a shadow or a z-index change is still a change to a shared
    // surface this phase has no mandate for. `z-30` moved into the lane with the position.
    for (const token of [
      'min-h-12',
      'rounded-full',
      'px-4',
      'shadow-[0_8px_24px_color-mix(in_srgb,var(--consumer-brand-tile),transparent_76%)]',
    ]) {
      assert.ok(className[1].includes(token), `the support trigger lost ${token}`);
    }
    assert.match(
      /export const ASSISTANT_LAUNCHER_ADJACENT_CLASS =\s*\n?\s*"([^"]+)"/.exec(
        fs.readFileSync(path.join(COMPONENTS, 'assistant/global-companion.tsx'), 'utf8'),
      )?.[1] ?? '',
      /\bz-30\b/,
      'the shared lane no longer carries the z-index the support trigger used to state itself',
    );
  });

  it('uses one fixture support destination with its draft inside the composer', () => {
    assert.ok(operator.includes('renderPlatformSupport()'), 'the fixture platform-support branch is gone');
    assert.ok(operator.includes('<SupportThreadView'), 'the fixture thread composer is gone');
    assert.ok(operator.includes('Suggestions stay inside the current composer'), 'the inline-draft explanation is gone');
    for (const marker of ['Held replies', 'renderReview', 'held-replies']) {
      assert.equal(operator.includes(marker), false, `operator source still mentions ${marker}`);
    }
  });

  it('renders the flag-on panel exactly once, and only behind the flag', () => {
    const uses = operator.split('<SupportBubblePanel').length - 1;
    assert.equal(uses, 1, 'the support panel is rendered more than once');
    assert.ok(
      enabledBranch(operator).includes('<SupportBubblePanel />'),
      'the support panel is rendered outside the ready conditional',
    );
  });

  it('offers no held-replies control in the flag-on branch', () => {
    const branch = enabledBranch(operator);
    for (const marker of ['Held replies', 'Segmented', 'renderReview', 'held-replies']) {
      assert.equal(branch.includes(marker), false, `the flag-on branch still mentions ${marker}`);
    }
  });

  it('uses one Platform support trigger in every support state', () => {
    assert.ok(operator.includes('aria-label="Open Platform support"'), 'the final trigger label is missing');
    assert.equal(operator.includes('activeSupport.length} held'), false, 'the removed queue still affects the trigger');
  });

  it('describes the flag-on panel rather than the one #192 removed', () => {
    // Found in the pass-3 walkthrough: the Sheet description sits above the support state
    // conditional, so it kept promising a queue of held replies kept apart from platform support
    // while the body below it showed neither. The earlier assertions all read the branch, which is
    // why none of them saw it — so this one reads the description on its own.
    const start = operator.indexOf('<SheetDescription>');
    const end = operator.indexOf('</SheetDescription>', start);
    assert.ok(start !== -1 && end > start, 'the support Sheet description could not be located');
    const description = operator.slice(start, end);

    assert.equal(description.includes('supportState'), false, 'the same support contract still varies by state');
    assert.ok(description.includes('press send'), 'the description no longer says a human presses send');
  });
});

describe('consumer surface contract', () => {
  it('delegates the whole chat to one module and keeps nothing behind', () => {
    // The extraction's own promise, and the reason every assertion below reads `team-chat`: if a
    // second copy of the conversation survived in `consumer.tsx`, the checks would be guarding the
    // dead one. `consumer.tsx` may name the component and nothing else about it.
    assert.ok(consumer.includes('<ConsumerTeamChat'), 'the consumer surface no longer renders the Team Chat');
    for (const marker of ['openSupportTeamChat', 'postSupportMessage', 'TeamMessage', 'All Team']) {
      assert.equal(consumer.includes(marker), false, `consumer.tsx still carries the chat's ${marker}`);
    }
  });

  it('keeps the fixture conversation as the fallback, and only where it is allowed to be', () => {
    // Rewritten for the chat rebuild. The old pair transcribed two lines of the implementation —
    // a `useState<TeamMessage[]>` initialiser and a `shownMessages.map` render loop — and both are
    // gone because the fixture is now a module and the state is a discriminated union. Neither line
    // was the fact; the fact is that a written conversation still exists, is still rendered, and is
    // reachable from exactly one place.
    //
    // Which place is the part worth guarding, and the old assertions did not guard it at all: a
    // fixture reached from a failed durable read shows a signed-in client words nobody sent them.
    // So the branch labels come from the state union that owns them rather than from a list here,
    // and every branch but one is required not to reach the fixture.
    const view = teamChatFiles();
    const builders = view.filter((file) => /export function fixtureConversation/.test(file.source));
    assert.equal(builders.length, 1, 'the written conversation is built in more than one module');

    const rendered = view.filter((file) => /fixtureConversation\(/.test(code(file.source)));
    assert.deepEqual(
      rendered.map((file) => file.name).filter((name) => name !== builders[0].name),
      ['index.tsx'],
      'the written conversation is rendered somewhere other than the view itself',
    );

    const body = code(rendered.find((file) => file.name === 'index.tsx')!.source);
    const opens = body.indexOf('switch (chat.state.kind) {');
    assert.ok(opens !== -1, 'the thread no longer switches on its own state');
    const thread = body.slice(opens, body.indexOf('\n  }', opens));

    const union = /export type TeamChatState =([\s\S]*?)\n\n/.exec(
      code(fs.readFileSync(path.join(TEAM_CHAT, 'use-team-chat.ts'), 'utf8')),
    );
    assert.ok(union, 'TeamChatState is no longer declared where this test reads it');
    const kinds = [...union[1].matchAll(/kind: "([a-z]+)"/g)].map((match) => match[1]);
    assert.ok(kinds.length >= 4, `TeamChatState parsed as ${kinds.join(', ')}`);

    let built = 0;
    for (const kind of kinds) {
      const start = thread.indexOf(`case "${kind}":`);
      assert.ok(start !== -1, `the thread has no branch for ${kind}`);
      const end = thread.indexOf('break;', start);
      if (thread.slice(start, end === -1 ? undefined : end).includes('fixtureConversation(')) built += 1;
    }
    assert.equal(built, 1, `${built} of the thread's branches render a written conversation`);
  });

  it('adds no draft affordance', () => {
    // Consumers cannot read drafts by policy (migration 100's `held_drafts_select`, re-checked in
    // migration 102). A control here would be a control that could only ever fail.
    //
    // Before the extraction this had to be scoped to a slice of `consumer.tsx`, because that file
    // has used the word "draft" since long before this phase — note drafts, amount drafts, a
    // profile draft, a suggested-prompt line that uses it as a verb. The chat module has none of
    // that, so the check now covers the whole file instead of a hand-placed window into one.
    //
    // Widened again with the rebuild: `teamChat` is now every file of the view rather than one of
    // them, because a control removed from `index.tsx` and added in `context-rail.tsx` is still a
    // control on the screen.
    for (const marker of ['/draft', 'Suggested reply', 'guardrailFlags', 'confidence']) {
      for (const file of teamChatFiles()) {
        assert.equal(
          code(file.source).includes(marker),
          false,
          `the Team Chat's ${file.name} mentions ${marker}`,
        );
      }
    }
  });

  it('sends through the durable support route, from one module, naming no client id', () => {
    // Rewritten for the chat rebuild. The route strings are no longer written here: they are read
    // off the App Router directory that serves them, so a route moved on disk moves this assertion
    // with it instead of leaving it matching a path that 404s. The old version would have passed
    // just as happily against a dead URL.
    const messagesRoute = path.join(APP, 'api/support/threads/[id]/messages/route.ts');
    assert.ok(fs.existsSync(messagesRoute), 'the support messages route is not where this test reads it');
    const url = path
      .relative(APP, path.dirname(messagesRoute))
      .split(path.sep)
      .filter((segment) => !segment.startsWith('['))
      .join('/');
    const collection = `/${url.slice(0, url.lastIndexOf('/'))}`;
    const leaf = url.slice(url.lastIndexOf('/'));

    // One module speaks to it. The extraction's whole point is that the view composes and the
    // transport transports; a second file learning to post is how a send grows a second code path
    // with its own idea of what may be asserted.
    const speakers = teamChatFiles().filter((file) => code(file.source).includes(collection));
    assert.deepEqual(
      speakers.map((file) => file.name),
      ['transport.ts'],
      'the durable support route is reached from somewhere other than the view transport',
    );
    assert.ok(speakers[0].source.includes(leaf), 'the send path is gone');

    // Migration 103 resolves the client from the signed-in profile, so nothing sent from the
    // browser may name one. `parseThread` reads `clientId` off a thread the server sent back, which
    // is a response field rather than a request, so the ban is on naming it anywhere else.
    for (const file of teamChatFiles()) {
      const body = code(file.source);
      if (!body.includes('clientId')) continue;
      assert.equal(file.name, 'transport.ts', `${file.name} names a client id outside the parser`);
      const parser = body.slice(body.indexOf('function parseThread'), body.indexOf('export function parseMessage'));
      assert.equal(
        (body.match(/clientId/g) ?? []).length,
        (parser.match(/clientId/g) ?? []).length,
        'a client id is named outside `parseThread`, which is the only place it may be read',
      );
    }
  });
});

describe('no surface can send by itself', () => {
  it('names no send RPC anywhere a component can be rendered from', () => {
    for (const file of componentFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      assert.equal(
        source.includes(SEND_RPC),
        false,
        `${path.relative(SRC, file)} names the send RPC; only the repository may`,
      );
    }
  });

  it('adds no deferred execution to anything that can reach the support API', () => {
    // The property, not a tally. `runInboxWrite`, `send`, `sendDurableReply` and the bubble's
    // writes all run from one click; a timer anywhere in a module that can post a message is the
    // "just retry it in the background" helper the whole rail exists to make impossible. Both the
    // set of modules and the set of primitives are derived, so neither can quietly go empty.
    const patterns = deferralPatterns();
    for (const file of supportReachingComponents()) {
      for (const { name, pattern } of patterns) {
        assert.equal(
          pattern.test(file.source),
          false,
          `${file.relative} defers work with ${name} and can reach the support API`,
        );
      }
    }
  });
});
