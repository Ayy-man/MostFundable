import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeAnswerBody } from '../kb/answer-body.ts';
import {
  createStageStreamWriter,
  encodeStreamEvent,
  readStreamLines,
  type AssistantStreamEvent,
} from './stream.ts';
import { ASSISTANT_STAGES } from './types.ts';

import type { AssistantConversation, AssistantTurn } from './types.ts';

function conversation(): AssistantConversation {
  return {
    createdAt: '2026-08-22T00:00:00Z',
    id: 'conversation-1',
    lastActivityAt: '2026-08-22T00:01:00Z',
    messageCount: 2,
    scope: 'operator',
    title: 'Where does this client stand',
  };
}

function turn(body: string): AssistantTurn {
  // Decoded rather than filled in, so the fixture is whatever the repository
  // would actually hand a reader for this body.
  const decoded = decodeAnswerBody(body);
  return {
    body,
    bullets: decoded.bullets,
    createdAt: '2026-08-22T00:01:00Z',
    headline: decoded.headline,
    id: 'turn-1',
    role: 'assistant',
    sources: [{ kind: 'client', label: 'Client A', ref: 'tracker:client-a' }],
  };
}

/**
 * The event sequence a real turn produces, built from `ASSISTANT_STAGES` rather
 * than from a list written here. The reader has to survive whatever the pipeline
 * emits, so the stage names come from the module that owns them — adding a
 * fourth stage widens this test on its own.
 */
function fullSequence(): readonly AssistantStreamEvent[] {
  return [
    ...ASSISTANT_STAGES.map((stage): AssistantStreamEvent => stage === 'reading' ? { stage, titles: ['Rivera Logistics'] } : { stage }),
    { answer: { conversation: conversation(), turn: turn('The cited workspace information supports this answer.') } },
  ];
}

describe('assistant NDJSON stream', () => {
  it('reassembles the event sequence no matter where the chunks are cut', () => {
    const events = fullSequence();
    const body = events.map(encodeStreamEvent).join('');

    // Watched failing with `carry + chunk` reduced to `chunk` in
    // `readStreamLines`: every object then arrives as a run of half-lines and
    // nothing parses. One character at a time is the worst cut there is: every line boundary and
    // every string literal inside an object gets split. A reader that survives
    // this survives any chunking a network can produce.
    const received: AssistantStreamEvent[] = [];
    let carry = '';
    for (const character of body) {
      const read = readStreamLines(character, carry);
      carry = read.carry;
      received.push(...read.events);
    }

    assert.deepEqual(received, events);
    assert.equal(carry, '');
  });

  it('drops a malformed line and still delivers the answer behind it', () => {
    // A proxy that injects a keepalive, or a truncated retry, puts a line in the
    // stream that is not one of our objects. Giving up there would lose the
    // answer, which is the only line that decides the outcome.
    const events = fullSequence();
    const body = `${encodeStreamEvent(events[0]!)}: keepalive\n${encodeStreamEvent(events.at(-1)!)}`;

    const read = readStreamLines(body);

    assert.deepEqual(read.events, [events[0], events.at(-1)]);
  });

  it('emits one whole object per line with no interior newline', () => {
    // The reader splits on `\n`, so an encoder that pretty-printed, or that let a
    // body's own newline through unescaped, would silently break every consumer.
    const lines: string[] = [];
    const writer = createStageStreamWriter((line) => lines.push(line), () => {});
    writer.stage('searching');
    writer.answer(turn('First paragraph.\n\nSecond paragraph.'), conversation());

    for (const line of lines) {
      assert.equal(line.endsWith('\n'), true);
      assert.equal(line.slice(0, -1).includes('\n'), false);
    }
    const read = readStreamLines(lines.join(''));
    assert.equal(read.events.length, lines.length);
  });

  it('drops a second terminal event instead of writing onto a closed stream', () => {
    // Watched failing with the `closed` latch removed from
    // `createStageStreamWriter`: without it the failure path that runs after an
    // answer has been enqueued closes the controller twice, which throws inside
    // `ReadableStream.start` and turns a delivered answer into a broken body.
    const lines: string[] = [];
    let closes = 0;
    const writer = createStageStreamWriter((line) => lines.push(line), () => { closes += 1; });

    writer.answer(turn('Answered.'), conversation());
    writer.fail('ASSISTANT_ANSWER_UNAVAILABLE');
    writer.stage('reviewing');

    assert.equal(closes, 1);
    const read = readStreamLines(lines.join(''));
    assert.equal(read.events.length, 1);
    assert.equal('answer' in read.events[0]!, true);
  });
});
