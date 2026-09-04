/**
 * The Inbox's own wiring — the claims that live inside this directory rather than at its seam.
 *
 * Each one is a statement about wiring: that every hook a subscription offers is bound, that every
 * key the overlay advertises does something, that no key can reach the send that carries a
 * pairing. Wiring exists only in the `.tsx` files, which this runner cannot import — the test glob
 * is `src/**\/*.test.ts` and Node's type stripping does not do JSX — so the components are read as
 * text and the expectation is derived, at test time, from the module that owns the fact.
 *
 * Transcribing any of those lists into this file would defeat the point. A handler added to the
 * subscription or a key added to the table has to fail here until the Inbox binds it.
 *
 * The seam between this directory and `operator.tsx` — that every rail capability is called, that
 * the statuses come from the shared constant, that the brand crosses the mount, that origins
 * render, that a resolved conversation is named rather than blamed — is checked once, in
 * `components/surfaces/operator-inbox-durable.test.ts`. Nothing is asserted in both places.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { CHAT_SHORTCUTS } from "@/components/chat/shortcuts";
import { INBOX_FRAME_CLASS } from "./layout";

const HERE = path.join(process.cwd(), "src/components/operator/inbox");
const REALTIME_MODULE = path.join(process.cwd(), "src/lib/realtime/support.client.ts");
const SURFACE = path.join(process.cwd(), "src/components/surfaces/operator.tsx");
const LIST = path.join(process.cwd(), "src/components/chat/thread-list.tsx");
const BUTTON = path.join(process.cwd(), "src/components/ui/button.tsx");
const PANE_STATE = path.join(process.cwd(), "src/components/chat/pane-state.tsx");
const MESSAGE_THREAD = path.join(process.cwd(), "src/components/chat/message-thread.tsx");
const CLIENT_TIMELINE = path.join(
  process.cwd(),
  "src/components/operator/tracker-client-timeline.tsx",
);

/** Every source file this lane owns, concatenated. The wiring may live in any of them. */
function inboxSource(): string {
  const names = readdirSync(HERE).filter(
    (name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"),
  );
  assert.ok(names.length > 1, "the Inbox directory no longer holds the Inbox");
  return names.map((name) => readFileSync(path.join(HERE, name), "utf8")).join("\n");
}

test("keeps the mobile conversation and reply composer inside a viewport-sized frame", () => {
  const rules = INBOX_FRAME_CLASS.split(/\s+/);
  assert.ok(
    rules.some((rule) => /^h-\[[^\]]*dvh[^\]]*\]$/.test(rule)),
    "the Inbox layout rule has no base viewport height for the 390-wide conversation",
  );
  assert.ok(
    rules.includes("overflow-hidden"),
    "the Inbox frame does not contain its scrolling message pane",
  );

  const source = withoutComments(readFileSync(path.join(HERE, "index.tsx"), "utf8"));
  assert.match(
    source,
    /import \{ INBOX_FRAME_CLASS \} from "\.\/layout"/,
    "the Inbox does not import the viewport rule",
  );
  assert.ok(
    (source.match(/INBOX_FRAME_CLASS/g) ?? []).length >= 2,
    "the Inbox frame bypasses the viewport rule, so the reply composer can follow messages below the fold",
  );
});

test("splits client replies from internal team messages without changing their durable visibility", () => {
  const source = withoutComments(inboxSource());
  assert.match(source, /Client inbox/);
  assert.match(source, /Internal notes/);
  assert.match(source, /thread\.internalMessageCount > 0/);
  assert.match(source, /thread\.participantMessageCount > 0/);
  assert.match(source, /item\.message\.visibility === "internal"/);
  assert.match(source, /item\.message\.visibility !== "internal"/);
  assert.match(source, /composerKind=\{inboxMode === "team" \? "note" : "reply"\}/);
});

test("states the shown and total conversation counts separately", () => {
  const source = withoutComments(inboxSource());
  assert.match(source, /threads\.length\} shown/);
  assert.match(source, /total\} total in this inbox/);
});

test("moves system updates to the selected client's Activity view", () => {
  const surface = withoutComments(readFileSync(SURFACE, "utf8"));
  const activity = withoutComments(readFileSync(CLIENT_TIMELINE, "utf8"));
  assert.match(surface, /timelineEnabled=\{false\}/);
  assert.match(surface, /<TrackerClientTimeline/);
  assert.match(activity, /readSupportInbox\(\)/);
  assert.match(activity, /readSupportThread\(thread\.id\)/);
  assert.match(activity, /event\.kind !== "stage_changed"/);
});

/**
 * Source with its comments removed.
 *
 * Prose that names an element is not the element. This directory explains its own composition in
 * headers that spell `<Composer sendOn="modifier">` and `<ThreadListFilters>`, and a JSX scan that
 * reads one of those picks up the first `/>` after it — a different element entirely. Block
 * comments go first so `{/* x *\/}` degrades to an inert `{ }` rather than losing its brace.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * The text of one call's arguments, parentheses balanced.
 *
 * A regexp cannot do this: the handler bodies contain their own parentheses, and stopping at the
 * first `)` would read a couple of lines and declare most of the vocabulary unbound. Locating by
 * the callee and counting depth is also why this does not slice between two neighbouring literals,
 * which is the failure mode where a guard silently starts checking an empty string.
 */
function callArguments(source: string, callee: string): string {
  const open = source.indexOf(`${callee}(`);
  assert.notEqual(open, -1, `${callee} is not called anywhere in the Inbox`);
  let depth = 0;
  for (let index = open + callee.length; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        const args = source.slice(open + callee.length + 1, index);
        assert.ok(args.trim().length > 0, `the ${callee} call parsed as taking no arguments`);
        return args;
      }
    }
  }
  assert.fail(`the ${callee} call is not closed`);
}

/**
 * Every argument list of every call to `callee`, parentheses balanced.
 *
 * The singular above stops at the first call, which is the wrong shape for a rule that has to hold
 * at every place a decision is made rather than at one of them.
 */
function everyCallArgument(source: string, callee: string): readonly string[] {
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const open = source.indexOf(`${callee}(`, from);
    if (open === -1) return found;
    let depth = 0;
    let index = open + callee.length;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    found.push(source.slice(open + callee.length + 1, index));
    from = index + 1;
  }
}

/**
 * The opening tag of every `<Element …>` in the source, brace depth respected.
 *
 * `<Button[\s\S]*?>` cannot do this. Half the controls in these panes carry an
 * `onClick={() => …}`, and the arrow's own `>` ends the match two attributes early — which reads
 * as a control with no variant declared on it, the exact thing this is looking for.
 */
function openingTags(source: string, element: string): readonly string[] {
  const tags: string[] = [];
  const opener = new RegExp(`<${element}\\b`, "g");
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    let depth = 0;
    for (let index = opener.lastIndex; index < source.length; index += 1) {
      const char = source[index];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) {
        tags.push(source.slice(match.index, index + 1));
        break;
      }
    }
  }
  return tags;
}

/**
 * Every `<element>…</element>` in the source as `[start, end, openingAttributes]`, nesting
 * respected.
 *
 * The end of an opening tag is found by counting braces rather than by the first `>`, for the same
 * reason `openingTags` does it: an `onClick={() => …}` carries a `>` of its own, and stopping there
 * closes the tag two attributes early and then never finds its partner, which unbalances every
 * range after it.
 */
function tagRanges(
  source: string,
  element: string,
): readonly (readonly [number, number, string])[] {
  const token = new RegExp(`<${element}\\b|</${element}>`, "g");
  const open: { at: number; attributes: string }[] = [];
  const ranges: [number, number, string][] = [];
  let match: RegExpExecArray | null;
  while ((match = token.exec(source)) !== null) {
    if (match[0].startsWith("</")) {
      const started = open.pop();
      assert.ok(started, `a closing ${element} with nothing open before it`);
      ranges.push([started.at, token.lastIndex, started.attributes]);
      continue;
    }
    let depth = 0;
    let index = match.index + match[0].length;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) break;
    }
    assert.ok(index < source.length, `a <${element} tag is not closed`);
    const attributes = source.slice(match.index + match[0].length, index);
    if (source[index - 1] === "/") ranges.push([match.index, index + 1, attributes]);
    else open.push({ at: match.index, attributes });
    token.lastIndex = index + 1;
  }
  assert.equal(open.length, 0, `the ${element} elements in this component do not balance`);
  return ranges;
}

/** The innermost `<element>` containing `at`, optionally narrowed by what it declares. */
function innermostTag(
  source: string,
  element: string,
  at: number,
  where: (attributes: string) => boolean = () => true,
): readonly [number, number, string] {
  const holding = tagRanges(source, element)
    .filter(([start, end, attributes]) => start < at && at < end && where(attributes))
    .sort((left, right) => right[0] - left[0]);
  assert.ok(holding.length > 0, `no ${element} in this component encloses that`);
  return holding[0];
}

/** The innermost span containing `at`, optionally restricted to the ones that lay out a line. */
function innermostSpan(
  source: string,
  at: number,
  where: (attributes: string) => boolean = () => true,
): readonly [number, number, string] {
  return innermostTag(source, "span", at, where);
}

/**
 * One declaration, brace-counted. Slicing to the next `export` is slicing between neighbours.
 *
 * The parameter list is stepped over first, parens balanced: these components destructure their
 * props, so counting braces from the declaration would close on the destructuring and hand back a
 * signature — which reads as a component that renders nothing at all.
 */
function declarationOf(source: string, name: string): string {
  const at = source.indexOf(`export function ${name}(`);
  assert.notEqual(at, -1, `${name} is no longer declared here`);

  let parens = 0;
  let index = at + `export function ${name}`.length;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parens += 1;
    else if (char === ")") {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  assert.ok(index < source.length, `${name}'s parameter list is not closed`);

  let depth = 0;
  let seen = false;
  for (; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
      seen = true;
    } else if (source[index] === "}") {
      depth -= 1;
      if (seen && depth === 0) return source.slice(at, index + 1);
    }
  }
  assert.fail(`${name} is not closed`);
}

/**
 * The name of the variant a `<Button>` is drawn in when nobody says otherwise, checked to still be
 * the filled brand one. Read off the button rather than written down, so renaming it or changing
 * what it paints breaks the guards below rather than quietly leaving them checking nothing.
 */
function loudVariant(): string {
  const button = readFileSync(BUTTON, "utf8");
  const fallback = /defaultVariants:\s*\{[^}]*variant:\s*"(\w+)"/.exec(button);
  assert.ok(fallback, "the button no longer declares which variant a caller gets by default");
  const painted = variantClasses(fallback[1]);
  assert.match(
    painted,
    /\bbg-primary\b/,
    "the default variant is no longer the filled brand button, so this is guarding the wrong one",
  );
  return fallback[1];
}

/** What one variant paints, by name. */
function variantClasses(name: string): string {
  const button = readFileSync(BUTTON, "utf8");
  const declared = new RegExp(`\\n\\s*${name}:\\s*\n?\\s*"([^"]*)"`).exec(button);
  assert.ok(declared, `the ${name} variant is no longer declared on the button`);
  return declared[1];
}

test("binds every handler the thread subscription offers", () => {
  const realtime = readFileSync(REALTIME_MODULE, "utf8");
  const block = /export interface ThreadSubscriptionHandlers \{([^}]*)\}/.exec(realtime);
  assert.ok(block, "ThreadSubscriptionHandlers is no longer a flat interface in the realtime module");
  const handlers = [...block[1].matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1]);
  assert.ok(handlers.length > 0, "ThreadSubscriptionHandlers declares no handlers");

  const bound = callArguments(inboxSource(), "subscribeToThread");
  const missing = handlers.filter((name) => !new RegExp(`\\b${name}\\s*[:(]`).test(bound));
  assert.deepEqual(missing, [], "the subscription is opened without these handlers");
});

test("binds every key the shortcut overlay advertises", () => {
  // `help` is the hook's own: it toggles the overlay before it ever consults the handler map, so a
  // surface that bound it would be binding something that can never be reached.
  const expected = CHAT_SHORTCUTS.map((shortcut) => shortcut.id).filter((id) => id !== "help");
  assert.ok(expected.length > 0, "the shortcut table is empty");

  const bound = callArguments(inboxSource(), "useChatShortcuts");
  const missing = expected.filter((id) => !new RegExp(`^\\s*${id}:`, "m").test(bound));
  assert.deepEqual(missing, [], "the overlay lists these keys but nothing in the Inbox binds them");
});

test("never lets a keystroke reach the send that carries a pairing", () => {
  // Rail one. `held_drafts_send_requires_human` is the enforcement and this is the interface
  // agreeing with it: the vocabulary can focus a composer, but no key in it may call the send that
  // attaches `origin_draft_id`. The sender is found by what it does rather than by its name.
  const source = withoutComments(inboxSource());

  // The pairing is constructed in exactly one place, found by what it does rather than by a name
  // copied from the implementation: the send that carries a `draftId`. Walking back to the
  // enclosing declaration is how the name is discovered, so renaming the function does not turn
  // this into a check of nothing.
  const pairing = /draftId[,:][\s\S]{0,120}?kind: "reply"/.exec(source);
  assert.ok(pairing, "nothing in the Inbox sends a draft with its pairing any more");
  const before = source.slice(0, pairing.index);
  const declarations = [...before.matchAll(/function (\w+)\s*\(/g)];
  assert.ok(declarations.length > 0, "the paired send is not inside a named declaration");
  const sender = declarations[declarations.length - 1][1];

  const bound = callArguments(source, "useChatShortcuts");
  assert.ok(
    !new RegExp(`\\b${sender}\\b`).test(bound),
    `\`${sender}\` is reachable from the keyboard, and a paired send is a click`,
  );
});

test("takes every prop the operator shell hands it", () => {
  const surface = withoutComments(readFileSync(SURFACE, "utf8"));
  const element = /<OperatorInbox[\s\S]*?\/>/.exec(surface);
  assert.ok(element, "the operator shell no longer mounts the Inbox");
  const props = [...element[0].matchAll(/^\s+(\w+)=\{/gm)].map((match) => match[1]);
  assert.ok(props.length > 3, "the mount parsed as almost no props");

  const declared = /export interface OperatorInboxProps \{([\s\S]*?)\n\}/.exec(
    readFileSync(path.join(HERE, "index.tsx"), "utf8"),
  );
  assert.ok(declared, "the Inbox no longer declares its props");
  const missing = props.filter((name) => !new RegExp(`readonly ${name}\\??:`).test(declared[1]));
  assert.deepEqual(missing, [], "the shell hands the Inbox props it does not accept");
});

test("gives the demonstration body and the signed-in body the same controls", () => {
  // The rebuild removed a whole class rather than an instance: there is one shell, and the three
  // sources differ only in what fills it, so a control cannot exist for a signed-in workspace and
  // quietly not for the demonstration one. That property is what is worth pinning.
  const source = withoutComments(inboxSource());
  for (const pane of ["ThreadListPane", "ConversationPane", "CopilotRail"]) {
    assert.equal(
      source.split(`<${pane}`).length - 1,
      1,
      `\`${pane}\` is mounted more than once, so the bodies can drift apart again`,
    );
  }

  // And no filter is switched on which body is running. Which props those are is read off the
  // pane's own `<ThreadListFilters>` element rather than listed here, so a filter added to the
  // list is covered the moment it is forwarded. A pane state that depends on the source —
  // loading, error — legitimately does, and is not a filter.
  const pane = withoutComments(readFileSync(path.join(HERE, "thread-list-pane.tsx"), "utf8"));
  const forwarded = /<ThreadListFilters[\s\S]*?\/>/.exec(pane);
  assert.ok(forwarded, "the list pane no longer renders the shared filters");
  const filterProps = new Set(
    [...forwarded[0].matchAll(/\w+=\{(\w+)\}/g)].map((match) => match[1]),
  );
  assert.ok(filterProps.size > 2, "the filters parsed as almost no props");

  const mount = /<ThreadListPane[\s\S]*?\n\s*\/>/.exec(source);
  assert.ok(mount, "the list pane is no longer mounted");
  assert.ok(mount[0].length > 120, "the list pane's mount parsed as an empty element");
  const switched = [...mount[0].matchAll(/^\s+(\w+)=\{([\s\S]*?)\}\n(?=\s+(?:\w+=|\/>))/gm)]
    .filter(([, name]) => filterProps.has(name))
    .filter(([, , expression]) => /\bsource ===/.test(expression))
    .map(([, name]) => name);
  assert.deepEqual(
    switched,
    [],
    "a conversation filter is switched on which body is running, so one body can lose it",
  );
});

test("keeps the reasons a suggestion was held in one module", () => {
  // Not the send rules — those live in `lib/support/draft-send.ts` and are guarded tree-wide by
  // its own test. This is the classification beside them: which of the four holds a draft is in,
  // which is decided from its confidence bar and its guardrail flags. A second copy would be a
  // second place for the wording of a hold to drift from the reason it was actually held.
  const owners = readdirSync(HERE)
    .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
    .filter((name) => {
      const body = withoutComments(readFileSync(path.join(HERE, name), "utf8"));
      return /confidenceThreshold/.test(body) && /guardrailFlags/.test(body);
    });
  assert.deepEqual(
    owners,
    ["view-model.ts"],
    "the reasons a suggestion was held are written out in more than one place",
  );
});

test("decides where a held draft goes in one place, not two", () => {
  // The defect this pins was found in a browser and not by a test: the frame and the notice were
  // two independent conditions in JSX, and a combination both refused — an approved suggestion on
  // a conversation with no send wired — left the rail advertising a suggestion the composer did
  // not show. The decision is now a total function in the view model, and this is what stops the
  // pane from going back to answering it twice: both renderers must be branches of the one call.
  const pane = withoutComments(readFileSync(path.join(HERE, "conversation-pane.tsx"), "utf8"));
  const decision = /const (\w+) =\s*draft === null[\s\S]{0,200}?draftPlacement\(/.exec(pane);
  assert.ok(decision, "the pane no longer asks the view model where the draft goes");
  const held = decision[1];

  for (const renderer of ["framed", "heldNotice"]) {
    const assignment = new RegExp(`const ${renderer}[^=]*=\\s*([\\s\\S]*?);\\n`).exec(pane);
    assert.ok(assignment, `the pane no longer computes \`${renderer}\``);
    assert.match(
      assignment[1],
      new RegExp(`\\b${held}\\b`),
      `\`${renderer}\` is decided without the placement, so the two can disagree again`,
    );
  }
});


test("gives the client's name its own line in a list row", () => {
  // W-6, from the first walk of the production deploy: the name shared line one with the stage
  // chip and the timestamp, both of which refuse to shrink, so in a 318px column the name was the
  // only thing that could give — "Jordan Ne...", "Devon D...", "Casey Cl...". Nothing else in the
  // row survives being cut: a truncated preview is still a preview, a missing chip is a stage the
  // header repeats, and a name cut to eleven characters is a row the operator cannot identify.
  //
  // The claim is structural rather than visual, which is what a source test can actually hold: on
  // the line the name is on, the name is the only thing that grows and the only thing that can be
  // cut. Watched failing against the row this replaced.
  const item = declarationOf(
    withoutComments(readFileSync(LIST, "utf8")),
    "ThreadListItem",
  );
  const nameAt = item.indexOf("{thread.title}");
  assert.notEqual(nameAt, -1, "a list row no longer renders the client's name");

  const line = innermostSpan(item, nameAt, (attributes) => /items-center/.test(attributes));
  const stageAt = item.indexOf("{thread.stage}");
  assert.ok(
    stageAt === -1 || stageAt < line[0] || stageAt > line[1],
    "the stage chip is back on the client's name line, where the name is what gives way",
  );

  const own = innermostSpan(item, nameAt);
  assert.match(own[2], /\bflex-1\b/, "the name no longer takes the space its line has");
  assert.match(own[2], /\btruncate\b/, "the name has nothing to do when it does not fit");
  assert.equal(
    item.slice(line[0], line[1]).split("flex-1").length - 1,
    1,
    "something else on the name's line grows, so the two share what is left again",
  );
});

test("spends the filled brand button nowhere in the Inbox", () => {
  // W-7. Four greens at four weights, and the loudest was Resolve — the control that ends the
  // conversation drawn louder than the reply being written in it. The rank is one filled control
  // per pane and it is the composer's send, which lives in the shared composer and not here; every
  // control this directory draws is outlined or ghosted beneath it.
  //
  // Which variant is the loud one is read off the button rather than named here, so renaming it or
  // changing what it paints breaks this rather than quietly passing.
  const loud = loudVariant();

  const tags = openingTags(withoutComments(inboxSource()), "Button");
  assert.ok(tags.length > 5, "the Inbox parsed as almost no controls");
  const loudest = tags.filter(
    (tag) =>
      !/\bvariant=/.test(tag) || new RegExp(`variant=(?:"${loud}"|\\{[^}]*"${loud}")`).test(tag),
  );
  assert.deepEqual(
    loudest,
    [],
    "a control here is drawn at the filled brand weight, which the composer's send already spends",
  );
});

test("chooses which conversation opens by rule, everywhere it chooses one", () => {
  // W-9: the Inbox opened on the row at the top of the list, which is the newest by activity and
  // routinely the one nobody has written in. The rule is found by what it reads rather than by its
  // name, and both writers of the selection have to consult it — the first durable read, which is
  // what the thread fetch is keyed to, and the pane that says nothing is open.
  const model = withoutComments(readFileSync(path.join(HERE, "view-model.ts"), "utf8"));
  const rule =
    /export function (\w+)\([^)]*\): string \| null \{[\s\S]{0,400}?preview\s*[!=]==\s*null/.exec(
      model,
    );
  assert.ok(rule, "nothing in the view model decides what to open by whether it has messages");
  const chooser = rule[1];

  const shell = withoutComments(readFileSync(path.join(HERE, "index.tsx"), "utf8"));
  assert.ok(
    shell.split(new RegExp(`\\b${chooser}\\(`)).length - 1 >= 2,
    `the Inbox asks \`${chooser}\` in fewer places than it decides what to open`,
  );

  // And nothing sets the durable selection positionally. This is the shape of the defect itself:
  // `result.threads[0]?.id`, a row chosen because of where it sat.
  const writes = everyCallArgument(shell, "setDurableThreadId");
  assert.ok(writes.length > 1, "the durable selection parsed as being written almost nowhere");
  for (const written of writes) {
    if (!/\[\s*\d+\s*\]|\.at\(/.test(written)) continue;
    assert.match(
      written,
      new RegExp(`\\b${chooser}\\b`),
      "a conversation is opened because of where it sits in the list",
    );
  }
});

test("retries a failed durable thread read by refetching the same selection", () => {
  const shell = withoutComments(readFileSync(path.join(HERE, "index.tsx"), "utf8"));
  const hook = declarationOf(shell, "useOperatorInbox");
  const readEffects = everyCallArgument(hook, "useEffect").filter((effect) =>
    effect.includes("postSupportThreadRead"),
  );
  assert.equal(readEffects.length, 1, "the selected-thread read effect is no longer identifiable");
  assert.match(
    readEffects[0],
    /\[durableThreadId,\s*threadReadGeneration\]\s*$/,
    "retry generation no longer causes the selected-thread read effect to run again",
  );

  const retryAt = hook.indexOf("function retryDurableThreadRead");
  const retryEnd = hook.indexOf("function retryPendingSend", retryAt);
  assert.ok(retryAt >= 0 && retryEnd > retryAt, "the durable read retry no longer has its own path");
  const retry = hook.slice(retryAt, retryEnd);
  assert.match(retry, /setThreadReadGeneration\(\(generation\) => generation \+ 1\)/);
  assert.match(
    retry,
    /setDurableThreadRead\(\{\s*read: LOADING_DURABLE_THREAD_READ,\s*threadRef: threadId\s*\}\)/,
    "retry does not visibly replace the failed result with a loading read for the same thread",
  );

  const failedAt = shell.indexOf('title: "This conversation could not be loaded"');
  assert.notEqual(failedAt, -1, "the selected-thread failure state is no longer rendered");
  const failure = shell.slice(Math.max(0, failedAt - 500), failedAt + 100);
  assert.match(failure, /inbox\.retryDurableThreadRead\(selected\.ref\)/);
  assert.doesNotMatch(
    failure,
    /setDurableThreadId/,
    "retry is back to assigning the already-selected id, which React ignores",
  );
});

test("binds selected-thread async completions to the thread that started them", () => {
  const shell = withoutComments(readFileSync(path.join(HERE, "index.tsx"), "utf8"));
  const hook = declarationOf(shell, "useOperatorInbox");

  const selectionAt = hook.indexOf("const setDurableThreadId = useCallback");
  const selectionEnd = hook.indexOf("const [durableThreadRead", selectionAt);
  assert.ok(selectionAt >= 0 && selectionEnd > selectionAt, "durable selection is no longer tracked");
  const selection = hook.slice(selectionAt, selectionEnd);
  assert.ok(
    selection.indexOf("selectedDurableThreadRef.current = selected")
      < selection.indexOf("setDurableThreadIdState(selected)"),
    "an A-to-B click does not publish B's identity before A can finish",
  );

  const writeAt = hook.indexOf("async function runInboxWrite");
  const writeEnd = hook.indexOf("async function sendDurableMessage", writeAt);
  const write = hook.slice(writeAt, writeEnd);
  const writeGuard = write.indexOf(
    "!isCurrentDurableThread(threadId, selectedDurableThreadRef.current)",
  );
  assert.ok(writeGuard >= 0, "a selected-thread write has no stale-selection guard");
  for (const commit of [
    "setInboxProblem(failure(result.code))",
    "setDurableThreadRead({ read: threadRead, threadRef: threadId })",
    "setInboxRead(refreshedInbox)",
  ]) {
    assert.ok(
      write.indexOf(commit) > writeGuard,
      `${commit} can commit client A after the operator selected client B`,
    );
  }

  const sendAt = hook.indexOf("async function sendDurableMessage");
  const sendEnd = hook.indexOf("function retryDurableThreadRead", sendAt);
  const send = hook.slice(sendAt, sendEnd);
  assert.equal(
    send.match(/isCurrentDurableThread\(threadId, selectedDurableThreadRef\.current\)/g)?.length,
    2,
    "both successful and refused send readbacks must reject an A-to-B stale completion",
  );
  assert.equal(
    send.match(/setDurableThreadRead\(\{ read: threadRead, threadRef: threadId \}\)/g)?.length,
    2,
    "both send readbacks must retain the thread identity they were fetched for",
  );

  const component = declarationOf(shell, "OperatorInbox");
  assert.match(
    component,
    /inbox\.durableThreadReadFor === selected\?\.ref[\s\S]{0,100}?inbox\.durableThreadRead/,
    "the renderer can consume a thread result without proving it belongs to the selected row",
  );
});

test("puts the note about a suggestion under the control it describes", () => {
  // W-10. The rail was three lines of explanation and one button, in a panel whose job is to offer
  // the button. The sentence stays word for word — it is what makes the control safe to press,
  // because it says both what happens and what does not — and what changed is that it now follows
  // what it describes instead of introducing it.
  const rail = withoutComments(readFileSync(path.join(HERE, "copilot-rail.tsx"), "utf8"));
  const control = rail.indexOf("Suggest a reply");
  assert.notEqual(control, -1, "the rail no longer offers to draft a reply");
  for (const half of ["written into your composer", "Nothing reaches the client until you press send"]) {
    const at = rail.indexOf(half);
    assert.notEqual(at, -1, `the rail no longer says "${half}"`);
    assert.ok(at > control, "the explanation is back above the control it describes");
  }
});

test("offers a reload without making it the loudest thing in the pane", () => {
  // W-8. A conversation with nothing in it is not a problem to solve, and "Reload" was drawn as a
  // filled brand button in the middle of the pane — the loudest control on the operator's screen,
  // for the one action that changes nothing. The shared pane ranks its action now; the name of the
  // lesser rank and what it paints are both read out of the pane rather than named here, which is
  // what let this guard survive `emphasis` replacing the prop it was first written against.
  const pane = withoutComments(readFileSync(PANE_STATE, "utf8"));
  const drawn = /variant=\{[^}]*?emphasis === "(\w+)"[^}]*?\?\s*"(\w+)"/.exec(pane);
  assert.ok(drawn, "the shared pane no longer draws an action at more than one weight");
  const [, quiet, variant] = drawn;
  assert.notEqual(variant, loudVariant(), "the lesser rank is drawn in the loud variant");
  assert.doesNotMatch(
    variantClasses(variant),
    /\bbg-primary\b/,
    "what the lesser rank paints is a filled brand button under another name",
  );

  const thread = withoutComments(readFileSync(MESSAGE_THREAD, "utf8"));
  const empty = /items\.length === 0[\s\S]*?<PaneState([\s\S]*?)\/>/.exec(thread);
  assert.ok(empty, "the thread no longer stands in for a conversation with nothing in it");
  assert.match(
    empty[1],
    new RegExp(`emphasis:\\s*"${quiet}"`),
    "the reload offered on an empty conversation is back at full weight",
  );
});

test("lets the conversation header wrap before the client's name gives way", () => {
  // Walk round 2: "Jordan Ne...", eleven characters, in a header with room to spare. The header is
  // a wrapping flex row, and the name's column was the only item in it with no base width — so it
  // was the only item that could absorb what the status control and Resolve wanted, and it did,
  // down to an ellipsis, while both controls sat at their full size beside it and the second
  // header line the wrap exists to provide was never used.
  //
  // The claim, and it is the same one the list row makes: on this header the name is the only
  // thing that grows, it is the only thing that truncates, and it has a floor to stop at. Watched
  // failing against the header this replaced, which had no `basis` on the name column and a
  // `flex-1` the controls could take from.
  const pane = withoutComments(readFileSync(path.join(HERE, "conversation-pane.tsx"), "utf8"));
  const component = declarationOf(pane, "ConversationPane");

  const nameAt = component.indexOf("{title}");
  assert.notEqual(nameAt, -1, "the conversation header no longer renders the client's name");

  const header = innermostTag(component, "header", nameAt);
  assert.match(
    header[2],
    /\bflex-wrap\b/,
    "the header cannot wrap, so something in it has to shrink and the name is what can",
  );

  const name = innermostSpan(component, nameAt);
  assert.match(name[2], /\bflex-1\b/, "the name no longer takes the space its line has");
  assert.match(name[2], /\btruncate\b/, "the name has nothing to do when it does not fit");

  const column = innermostTag(component, "div", nameAt);
  assert.match(
    column[2],
    /\bbasis-\d/,
    "the name's column has no width to wrap at, so it is what gives way instead",
  );
  assert.match(column[2], /\bmin-w-0\b/, "the name's column cannot be narrowed by its contents");

  // And nothing else in the header grows. A second flexible item shares the row with the name
  // again, which is the state this started in.
  const rest =
    component.slice(header[0], column[0]) + component.slice(column[1], header[1]);
  assert.doesNotMatch(
    rest,
    /\bflex-1\b/,
    "something beside the name grows too, so the two divide the header between them again",
  );
});

test("makes the conversation the widest band on the screen where the three panes appear", () => {
  // Walk round 2: the conversation was the narrowest column on a 1440px screen. Two 20rem flanks
  // and a 15rem product nav left it 480px, so the pane the operator actually works in was the
  // smallest region on the page and read as one panel among several rather than as the surface.
  //
  // Every number here is read from the module that owns it — the spacing unit and the breakpoint
  // from Tailwind's own theme, the nav width and the page gutter from the shell that draws them,
  // the tracks from the Inbox — because the claim is about how these compose, and a width written
  // down in this file would go on passing after any one of them moved.
  //
  // Watched failing against the 20rem/20rem flanks this replaced: 320px of conversation between
  // two 320px columns, "the conversation is no wider than the list beside it".
  const theme = readFileSync(
    path.join(process.cwd(), "node_modules/tailwindcss/theme.css"),
    "utf8",
  );
  const unit = /--spacing:\s*([\d.]+)rem/.exec(theme);
  const breakpoint = /--breakpoint-xl:\s*([\d.]+)rem/.exec(theme);
  assert.ok(unit && breakpoint, "Tailwind no longer declares the spacing unit and the xl width");

  // A redefinition would make everything below compute off the wrong base and still pass.
  const globals = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  assert.doesNotMatch(globals, /--spacing:|--breakpoint-xl:/, "the app redefines what this reads");

  const rem = (value: number) => value * 16;
  const spacing = (steps: number) => rem(steps * Number(unit[1]));

  const shell = withoutComments(
    readFileSync(path.join(process.cwd(), "src/components/demo/demo-shell.tsx"), "utf8"),
  );
  const nav = tagRanges(shell, "aside")
    .map(([, , attributes]) => attributes)
    .filter((attributes) => /\bfixed\b/.test(attributes) && /\bw-\d/.test(attributes));
  assert.equal(nav.length, 1, "the shell no longer draws exactly one fixed navigation column");
  const navWide = spacing(Number(/\bw-(\d+)\b/.exec(nav[0])![1]));

  const gutters = shell.match(/\bxl:px-(\d+)\b/g) ?? [];
  assert.equal(gutters.length, 1, "the page gutter at this width is declared in more places than one");
  const gutter = spacing(Number(/\d+/.exec(gutters[0])![0]));

  // Every track set the Inbox can be in, not the first one written down. The rail collapses, which
  // is a second set of tracks, and a rule that holds in one arrangement and not the other is not a
  // rule about this layout.
  const inbox = withoutComments(readFileSync(path.join(HERE, "index.tsx"), "utf8"));
  const templates = inbox.match(/\bxl:grid-cols-\[[^\]]+\]/g) ?? [];
  assert.ok(templates.length > 0, "the Inbox no longer lays its panes out in tracks at this width");

  const fixed = (track: string) => {
    const declared = /^([\d.]+)rem$/.exec(track);
    assert.ok(declared, `the flanking track \`${track}\` is not a width this can compute with`);
    return rem(Number(declared[1]));
  };

  for (const template of templates) {
    const tracks = /\[([^\]]+)\]/.exec(template)![1].split("_");
    assert.equal(tracks.length, 3, `\`${template}\` is not three panes`);
    assert.match(tracks[1], /1fr/, "the conversation is no longer the track that takes what is left");

    const list = fixed(tracks[0]);
    const rail = fixed(tracks[2]);
    const conversation = rem(Number(breakpoint[1])) - navWide - gutter * 2 - list - rail;

    for (const [what, wide] of [
      ["the list beside it", list],
      ["the client panel beside it", rail],
      ["the product navigation", navWide],
    ] as const) {
      assert.ok(
        conversation > wide,
        `in \`${template}\` the conversation is ${conversation}px, no wider than ${what} at ${wide}px`,
      );
    }
  }
});
