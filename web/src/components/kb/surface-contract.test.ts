// The two KB assistants, and the seam each one sits behind.
//
// Rewritten for the chat rebuild (lane 3). The previous version read
// `components/consumer/team-chat/kb-assistant.tsx`, which lane 1b's extraction had moved here from
// `components/kb/` and which the rebuild deleted: contract R3 rules out the composition it
// embodied, an assistant rendered as a block inside the Team Chat sharing the thread's composer.
// The consumer assistant is now a navy side panel with its own transport, so five of this file's
// assertions were reading a path that no longer exists and one was pinning the defect.
//
// Every fact those assertions protected is still protected. Two are now driven rather than matched;
// three are derived from whatever owns them; one no longer applies and its replacement is named
// where it sat. What changed in each case is written at the assertion, not here.
//
// The operator half is untouched in substance. Its component-name checks are derived from the
// wrapper's own import rather than written down, because lane 4b replaces that component with its
// assistant workspace and the fact worth holding — the operator page mounts exactly one assistant
// and hands it the thread id it was given — is true either way.

import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CONSUMER_KB_IDENTITY } from "@/lib/kb/consumer";
import { safeCitationHref } from "@/components/kb/safe-citation-href";
import {
  CONSUMER_KB_ROUTE,
  askBody,
  parseCitations,
} from "@/components/consumer/team-chat/use-assistant";

import { stripComments } from "@/lib/testing/strip-comments";

// `fileURLToPath`, never `URL.pathname`. This repository lives at
// `/Users/aymanbaig/DEV/Legacy funding platform`, and `URL.pathname` percent-encodes the space, so
// every path built from it points at `Legacy%20funding%20platform` and each read dies with ENOENT
// before reaching an assertion. Six of this file's seven tests died that way and the suite reported
// them passing, because every lane worktree is `~/DEV/mf-chat-N` and has no space in its path.
// `no-native-select.test.ts` carries the same note; it was written there and not applied here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..", "..");
const CONSUMER_ASSISTANT_DIR = path.join(SRC, "components/assistant");
const CONSUMER_ENTRY = "consumer-companion.tsx";
const OPERATOR_ASSISTANT_DIR = path.join(SRC, "components/assistant");
const OPERATOR_ENTRY = "operator-assistant.tsx";
/**
 * The ask path, as distinct from the pages that host it.
 *
 * `workspace.tsx` is the assistant: it owns the composer, the question and everything the answer
 * travels through. `operator-assistant.tsx` and `admin-assistant.tsx` are mounts — a page header,
 * a greeting, and the workspace underneath — and they are operator and admin chrome that happens
 * to contain an assistant. The lane rule below turns on that difference, so it is named here once
 * rather than being re-argued at each assertion.
 */
const ASSISTANT_ASK_ENTRY = "workspace.tsx";

const parserPath = new URL("./safe-citation-href.ts", import.meta.url);
const teamChatPath = new URL("../consumer/team-chat/index.tsx", import.meta.url);
const operatorAssistantPath = new URL("../assistant/operator-assistant.tsx", import.meta.url);
const consumerSurfacePath = new URL("../surfaces/consumer.tsx", import.meta.url);
const operatorSurfacePath = new URL("../surfaces/operator.tsx", import.meta.url);
const seedsPath = new URL("../operator/inbox/seeds.ts", import.meta.url);

function read(file: string): string {
  return fs.readFileSync(path.join(CONSUMER_ASSISTANT_DIR, file), "utf8");
}

/** The same read against the operator assistant's own directory. */
function readOperator(file: string): string {
  return fs.readFileSync(path.join(OPERATOR_ASSISTANT_DIR, file), "utf8");
}

/** Comment-stripped, because these files explain the rules they follow using the banned vocabulary. */
const code = stripComments;

/**
 * Every module specifier in a file.
 *
 * Four forms, borrowed from `verify-ai-transport.mjs`'s own scanner, because all four resolve and a
 * check understanding only `import … from` is defeated by the exact thing somebody reaches for when
 * the first form is being linted.
 */
function specifiersIn(source: string): string[] {
  const body = code(source);
  return [
    /(?:^|[\n;])\s*(?:import|export)\s[\s\S]*?\sfrom\s*["']([^"']+)["']/g,
    /(?:^|[\n;])\s*import\s*["']([^"']+)["']/g,
    /(?<![.\w])import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /(?<![.\w])require\s*\(\s*["']([^"']+)["']\s*\)/g,
  ].flatMap((pattern) => [...body.matchAll(pattern)].map((match) => match[1]));
}

/**
 * Everything the consumer assistant can reach without leaving its own directory.
 *
 * The assistant is a module graph now rather than one file, so a rule about "the assistant" has to
 * be a rule about what the assistant can reach. A new module that learns to do the forbidden thing
 * joins this set by being imported, without anybody having to name it here.
 */
function consumerAssistantFiles(): { name: string; source: string }[] {
  const seen = new Set([CONSUMER_ENTRY]);
  const frontier = [CONSUMER_ENTRY];
  while (frontier.length > 0) {
    const next = frontier.pop()!;
    for (const specifier of specifiersIn(read(next))) {
      if (!specifier.startsWith("./")) continue;
      for (const candidate of [`${specifier.slice(2)}.ts`, `${specifier.slice(2)}.tsx`]) {
        if (seen.has(candidate)) continue;
        if (!fs.existsSync(path.join(CONSUMER_ASSISTANT_DIR, candidate))) continue;
        seen.add(candidate);
        frontier.push(candidate);
      }
    }
  }
  assert.ok(seen.size >= 2, "the consumer assistant reaches nothing at all; the walk is broken");
  return [...seen].map((name) => ({ name, source: read(name) }));
}

/**
 * The operator assistant's modules, reached the same way the consumer's are.
 *
 * This used to be one file, `components/kb/operator-kb-assistant.tsx`, and two assertions below
 * read it by path. The chat rebuild replaced it with a workspace of twenty-one modules, so a path
 * would now pin whichever one happened to be named here and say nothing about the other twenty —
 * the two facts these guard (an assistant does not read a server flag in the browser, and an
 * assistant does not reach into another lane) are properties of everything the mount pulls in, not
 * of an entry point. Walking the imports means a module added to the workspace tomorrow is covered
 * without anybody extending a list.
 */
function operatorAssistantFiles(entry: string = OPERATOR_ENTRY): { name: string; source: string }[] {
  const seen = new Set([entry]);
  const frontier = [entry];
  while (frontier.length > 0) {
    const next = frontier.pop()!;
    for (const specifier of specifiersIn(readOperator(next))) {
      if (!specifier.startsWith("./")) continue;
      for (const candidate of [`${specifier.slice(2)}.ts`, `${specifier.slice(2)}.tsx`]) {
        if (seen.has(candidate)) continue;
        if (!fs.existsSync(path.join(OPERATOR_ASSISTANT_DIR, candidate))) continue;
        seen.add(candidate);
        frontier.push(candidate);
      }
    }
  }
  assert.ok(seen.size >= 2, "the operator assistant reaches nothing at all; the walk is broken");
  return [...seen].map((name) => ({ name, source: readOperator(name) }));
}

describe("KB surface contract", () => {
  it("keeps the controls hidden until their server bootstrap enables them", async () => {
    // The operator half, following the fact across the rebuild rather than pinning the shape it
    // used to have. It was one component that fetched `/api/kb/operator` with `cache: "no-store"`
    // and posted to that same literal; it is now a workspace whose browser half declares its
    // routes as constants and reads availability off the listing. The fact is the one it always
    // was — the assistant does not decide for itself that it is switched on — so it is asserted
    // against the module that owns the answer, with the route read out of that module rather than
    // written here.
    const client = readOperator("client.ts");
    const listing = /const \w+ = "(\/api\/assistant\/[a-z-]+)";/.exec(client);
    assert.ok(listing, "the assistant client no longer declares the route it lists from");
    assert.match(
      client,
      /cache: "no-store"/,
      "the assistant client reads its availability from a cacheable response",
    );
    assert.match(
      client,
      /payload\.enabled !== true\) return \{ status: "disabled" \}/,
      "the assistant client no longer takes `enabled` from the server as the answer",
    );
    // And every writing call goes to the same route family that answered the question, so the
    // assistant cannot be told it is off by one service and ask another anyway.
    for (const specifier of [...client.matchAll(/"(\/api\/[a-z-]+)/g)].map((match) => match[1])) {
      assert.equal(
        specifier,
        listing[1].split("/").slice(0, 3).join("/"),
        `the assistant client reaches ${specifier}, outside the family that gates it`,
      );
    }

    // The consumer half is the same three facts against a rebuilt implementation.
    //
    // "Asks the route that enabled it" was a regex pairing two `fetch` literals. It is now true by
    // construction — one exported constant used twice — so what is checked is that no second route
    // was written into the module and that every call goes through the constant.
    const hook = code(fs.readFileSync(path.join(SRC, "components/consumer/team-chat/use-assistant.ts"), "utf8"));
    const routes = new Set([...hook.matchAll(/"(\/api\/[a-z/-]+)"/g)].map((match) => match[1]));
    assert.deepEqual([...routes], [CONSUMER_KB_ROUTE], "a second route is named in the consumer hook");
    assert.match(CONSUMER_KB_ROUTE, /^\/api\/kb\//);
    for (const call of [...hook.matchAll(/fetch\(\s*([A-Za-z_]+)/g)]) {
      assert.equal(call[1], "CONSUMER_KB_ROUTE", `a consumer fetch is called with ${call[1]}`);
    }

    const consumerSurface = code(await readFile(consumerSurfacePath, "utf8"));
    assert.match(consumerSurface, /<ConsumerAssistantCompanion\b/, "the app surface has no global consumer assistant");
    const teamChat = code(await readFile(teamChatPath, "utf8"));
    assert.doesNotMatch(teamChat, /Assistant(?:Entry|Panel)/, "Team Chat still owns an assistant control");

    // And neither side decides for itself. The flag name is read out of the route that owns it
    // rather than written here, so a rename covers both spellings without an edit.
    const route = await readFile(new URL(`../../app${CONSUMER_KB_ROUTE}/route.ts`, import.meta.url), "utf8");
    const flag = /featureFlag\("([A-Z_]+)"\)/.exec(route);
    assert.ok(flag, "the consumer KB route no longer reads a feature flag");
    for (const file of [...operatorAssistantFiles(), ...consumerAssistantFiles()]) {
      assert.equal(
        code(file.source).includes(flag[1]),
        false,
        `${file.name} reads ${flag[1]} in the browser instead of asking the server`,
      );
    }
  });

  it("posts only the consumer question and identifies the assistant", async () => {
    // Driven rather than matched. `JSON.stringify({ question: value })` said nothing about what the
    // object ended up carrying; this sends a question through the real body builder and reads the
    // keys off what comes out.
    const sent = JSON.parse(askBody("What should I finish first?")) as Record<string, unknown>;
    assert.deepEqual(Object.keys(sent), ["question"]);

    // The route resolves the client, the org and the enrollment from the signed-in session, so
    // nothing this side may assert any of them. Checked across the assistant's whole module graph,
    // because the send moved out of the component it used to live in.
    for (const file of consumerAssistantFiles()) {
      for (const key of ["clientId", "enrollmentId", "analysisId", "profileId", "orgId"]) {
        assert.equal(code(file.source).includes(key), false, `${file.name} names ${key}`);
      }
    }

    // The identity is compared against the constant the route stamps on every answer rather than
    // matched as a string, so the two cannot be renamed apart.
    assert.ok(
      fs.readFileSync(path.join(SRC, "components/consumer/team-chat/use-assistant.ts"), "utf8").includes(`const IDENTITY = "${CONSUMER_KB_IDENTITY}"`),
      "the consumer assistant names itself something other than what the route stamps",
    );
  });

  it("refuses every citation scheme that is not http", () => {
    // Unchanged. Driven, not read: `new URL()` accepts all of these happily, and the protocol check
    // is the only thing standing between a citation row and a script URL in an `href`.
    for (const hostile of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "not a url at all",
      "",
    ]) {
      assert.equal(safeCitationHref(hostile), null, `${hostile || "(empty)"} was accepted as an href`);
    }
    for (const allowed of ["https://example.test/a", "http://example.test/a"]) {
      assert.equal(safeCitationHref(allowed), new URL(allowed).href);
    }
  });

  it("renders every citation through that parser, or renders no link at all", async () => {
    // The operator half took the second of the two ways out, and this now says so.
    //
    // It used to render a citation as an anchor whose href went through `safeCitationHref`, which
    // satisfied "or renders no link at all" by satisfying the first clause. F-06 then ruled that a
    // source chip carries a label and goes nowhere, and the rebuilt workspace has no anchor in it
    // — so the guard moves to the other clause rather than dying with the anchor it used to check.
    // Swept across every module the mount reaches, because "there is no link" is only worth
    // anything if it is true of all of them.
    for (const file of operatorAssistantFiles()) {
      assert.equal(
        code(file.source).includes("href="),
        false,
        `${file.name} gives a citation a destination; a source chip carries a label and goes nowhere`,
      );
    }
    // The parser stays exported and tested above, because the consumer half and the KB routes
    // still owe it — an unused export here would be the wrong conclusion to draw from the sweep.
    const parser = await readFile(parserPath, "utf8");
    assert.match(parser, /export function safeCitationHref/);

    // The consumer half of this fact no longer applies, and is replaced rather than dropped.
    //
    // It used to require the consumer assistant to render a citation as an anchor whose href went
    // through the parser. F-06 ruled that consumer source chips carry no link: `safeCitationHref`
    // resolves the knowledge base's fixture host, which serves no page, so an anchor there hands a
    // signed-in client a dead destination. A rule about how the link is built cannot survive there
    // being no link.
    //
    // What replaces it is the stronger form of the same protection, and it is a claim about the
    // type rather than about a render site: the consumer's citation carries no url for any renderer
    // to reach for, so this holds for render sites nobody has written yet. The fields are read off
    // `KbCitation` — the route's own shape — so a fifth one added there is refused here.
    const driver = await readFile(new URL("../../lib/kb/chat-driver.ts", import.meta.url), "utf8");
    const declaration = /export interface KbCitation \{([^}]*)\}/.exec(driver);
    assert.ok(declaration, "KbCitation is no longer declared where this test reads it");
    const fields = [...declaration[1].matchAll(/readonly ([A-Za-z]+):/g)].map((match) => match[1]);
    assert.ok(fields.length >= 3, `KbCitation parsed as ${fields.join(", ")}`);
    const [parsed] = parseCitations([Object.fromEntries(fields.map((field) => [field, `v-${field}`]))]);
    assert.ok(parsed, "a complete citation from the route did not survive the consumer parser");
    assert.deepEqual(Object.keys(parsed), ["label"]);

    // And no consumer module reaches for a link anyway, checked across the graph.
    for (const file of consumerAssistantFiles()) {
      for (const forbidden of ["href=", "<a ", "safeCitationHref", 'target="_blank"']) {
        assert.equal(
          code(file.source).includes(forbidden),
          false,
          `${file.name} renders ${forbidden}, which F-06 rules out on the consumer side`,
        );
      }
    }
  });

  it("keeps the operator assistant read-only, and shows the server's own footer", async () => {
    // Two of the four facts this used to hold no longer have a subject, and one of the two that
    // survive is now stronger.
    //
    // The dead pair described a component with two modes: `mode: "answer"` and
    // `mode: "message_draft"`, the second drafting a support reply from inside the assistant.
    // Held drafts belong to the Inbox — that is where "never send a draft that is not approved"
    // lives — and the rebuilt assistant has no draft mode at all, so a guard that a draft mode
    // stays separate from an answer mode is a guard about nothing. It is replaced by the stronger
    // claim underneath it: the assistant cannot start an outbound message in any mode.
    //
    // The footer survives as it was and matters more than it did, because it is the sentence that
    // keeps an answer from reading as advice. `answer-view.test.ts` proves it cannot be dropped
    // from the render; this proves it is the server's and not a second copy written here.
    const files = operatorAssistantFiles(ASSISTANT_ASK_ENTRY);
    for (const file of files) {
      assert.doesNotMatch(
        code(file.source),
        /sendMessage|"\/api\/support|>Send</,
        `${file.name} gives the assistant a way to send, which is the Inbox's to own`,
      );
      assert.equal(
        code(file.source).includes('mode: "message_draft"'),
        false,
        `${file.name} drafts a reply from inside the assistant`,
      );
    }
    // The footer is rendered from the answer the server returned, not composed here.
    const view = files.find((file) => file.name === "answer-view.ts");
    assert.ok(view, "the assistant no longer has an answer view to read a footer from");
    assert.match(
      code(view.source),
      /footer/,
      "the answer view carries no footer field, so the not-advice line has no owner",
    );
  });

  it("contains no direct provider, database, or client-lane reference", async () => {
    // The lane list is no longer written here. Every directory under `src/lib` is a lane, so the
    // rule is derived from the tree: an assistant may reach the knowledge base it speaks to and the
    // shared helpers, and nothing else — which covers lanes that do not exist yet, and covered
    // `@/lib/realtime` and `@/lib/vault` on the day they were added without anybody noticing.
    const lanes = fs
      .readdirSync(path.join(SRC, "lib"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `@/lib/${entry.name}`);
    assert.ok(lanes.length >= 10, `the lane sweep found ${lanes.length} directories`);
    const allowed = new Set(["@/lib/kb", "@/lib/utils"]);

    // Two facts changed under this rule when the KB assistant became a workspace, and both are
    // sharpenings rather than relaxations.
    //
    // The assistant grew a lane of its own. `@/lib/assistant` is to this assistant what
    // `@/lib/kb` was to the one it replaced — its types, its stream decoder, its error codes — so
    // allowing it is the same rule pointed at the renamed thing, not a hole. What is still refused
    // is every other lane, including the ones that did not exist when this was written.
    //
    // And the rule is about reaching, not about naming. A `import type` cannot call anything: it
    // compiles to nothing and gives the assistant no capability it did not have. The crossing this
    // guard exists to stop is a runtime one — an assistant that queries a lane in the browser
    // instead of asking its server — so type-only specifiers are read past. That distinction is
    // load-bearing here: the ask path names `@/lib/tracker/types` to describe a stage, and refusing
    // it would push the assistant into keeping a second copy of a shape it does not own.
    const allowedLanes = new Set([...allowed, "@/lib/assistant"]);
    const runtimeSpecifiers = (source: string): string[] => {
      const body = code(source);
      return [...body.matchAll(/(?:^|[\n;])\s*import\s+(?!type\s)[\s\S]*?\sfrom\s*["']([^"']+)["']/g)]
        .map((match) => match[1]);
    };

    for (const file of [...operatorAssistantFiles(ASSISTANT_ASK_ENTRY), ...consumerAssistantFiles()]) {
      for (const specifier of runtimeSpecifiers(file.source)) {
        const lane = lanes.find((each) => specifier === each || specifier.startsWith(`${each}/`));
        assert.ok(
          lane === undefined || allowedLanes.has(lane),
          `${file.name} imports ${specifier} at runtime; the assistant may not reach ${lane}`,
        );
      }
      for (const provider of ["supabase", "openrouter"]) {
        assert.equal(
          code(file.source).toLowerCase().includes(provider),
          false,
          `${file.name} names ${provider} directly`,
        );
      }
    }

    // The two mounts, held to the half of the rule that is about them.
    //
    // A mount is a page: a header, a greeting, and the workspace under it. It reads its own
    // surface's lane to say how many clients need attention, which is the operator's own data on
    // the operator's own page and not the assistant reaching anywhere — so the lane clause above
    // does not apply to it. What does apply, and what it would be a real defect to lose, is that a
    // page hosting an assistant still may not name a provider or a database: the moment a mount
    // can, "ask the server" stops being the only way an answer can be produced on that screen.
    for (const mount of ["operator-assistant.tsx", "admin-assistant.tsx"]) {
      const source = code(readOperator(mount));
      for (const forbidden of ["supabase", "openrouter"]) {
        assert.equal(
          source.toLowerCase().includes(forbidden),
          false,
          `${mount} names ${forbidden} directly`,
        );
      }
      // And a mount hosts the ask rather than reimplementing it.
      assert.match(
        source,
        /<AssistantWorkspace/,
        `${mount} does not mount the workspace, so it is answering on its own`,
      );
    }
  });

  it("mounts one assistant per surface, and hands the operator one no identifier", async () => {
    // The consumer half was `<TeamChatView[\s\S]{0,200}?<ConsumerKbAssistant />` — the assistant as
    // a block rendered inside the Team Chat view. Contract R3 rules that composition out: the
    // consumer assistant is a side panel with its own composer, never a tab or a block sharing the
    // thread's space.
    const consumerSurface = await readFile(consumerSurfacePath, "utf8");
    assert.match(consumerSurface, /<ConsumerTeamChat[^>]*\/>/);
    const teamChat = code(await readFile(teamChatPath, "utf8"));
    assert.doesNotMatch(teamChat, /Assistant(?:Entry|Panel)/, "Team Chat mounts an assistant");
    const panel = code(read("global-companion.tsx"));
    assert.match(panel, /<Sheet\b/, "the global consumer assistant is no longer a panel over the view");
    assert.equal(
      code(read(CONSUMER_ENTRY)).includes("<Composer"),
      true,
      "the consumer assistant has no composer of its own, so it shares the thread's",
    );

    // The operator half, with the component name derived rather than written. Lane 4b's rebuild
    // landed and the fact worth holding survived it: the page is labelled and mounts exactly one
    // assistant. What moved is where that assistant comes from — it used to be a component in
    // another directory, so the specifier was an alias; it is now the workspace sitting beside its
    // two mounts, so the specifier is relative. The pattern accepts either, because which of the
    // two it is says nothing about whether the page mounts one assistant.
    const operatorAssistant = await readFile(operatorAssistantPath, "utf8");
    const imported =
      /import \{ (\w+) \} from "@\/components\/(?:kb|assistant)\/[^"]+"/.exec(operatorAssistant) ??
      /import \{ (\w+Workspace) \} from "\.\/[^"]+"/.exec(operatorAssistant);
    assert.ok(imported, "the operator assistant page imports no assistant component");
    const component = imported[1];
    // Counted against the code and not the file. The page's own docblock names `<AssistantWorkspace>`
    // while explaining that the two scopes share it, and a comment that mentions a mount is not a
    // second mount — counting the raw source read two and called a correct page a defect.
    assert.equal(
      (code(operatorAssistant).match(new RegExp(`<${component}\\b`, "g")) ?? []).length,
      1,
      "the operator page mounts other than exactly one assistant",
    );
    // Labelled, and the assistant sits under the label. The title itself is not pinned: it is copy
    // under the frontend freeze, so a rewording is a change order rather than a structural failure,
    // and pinning it here would fail lane 4b's specified workspace on the wrong grounds.
    // Read off the code for the same reason the count is: the docblock names the mount, so a raw
    // `indexOf` finds the comment's mention first and reports a correctly ordered page as inverted.
    const operatorCode = code(operatorAssistant);
    const header = /<CompactHeader[^>]*title="([^"]+)"[^>]*\/>/.exec(operatorCode);
    assert.ok(header, "the operator assistant page carries no header");
    assert.ok(header[1].trim().length > 0, "the operator assistant page's header has no title");
    assert.ok(
      operatorCode.indexOf(header[0]) < operatorCode.indexOf(`<${component}`),
      "the assistant renders above its own page header",
    );
    // The wrapper passes through what it was given rather than deciding anything itself.
    const parameter = "viewerName";
    assert.match(operatorAssistant, /export function OperatorAssistant\([^)]*viewerName/);
    assert.match(
      operatorAssistant,
      new RegExp(`<${component}[^>]*viewerName=\\{${parameter}\\}`),
      `the assistant is not handed ${parameter}, so the wrapper decides the identity itself`,
    );

    // This half used to say the mount is handed the Inbox's *durable* thread id rather than a
    // seeded one, which was the right guard while the assistant drafted a support reply against a
    // thread. It does not any more: held drafts are the Inbox's, they live behind a human send in
    // that pane, and a workspace with no thread open and no send control has no business knowing a
    // thread id. So the prop is gone from both sides.
    //
    // The replacement is the stronger claim, not the absence of the old one. "Not the fixture id"
    // is subsumed by "no id at all": the mount is swept against every id the seeds module declares
    // AND against anything uuid-shaped, so neither a seeded handle nor a durable one can be handed
    // back in without failing here. The seeded ids are still read out of the seeds module rather
    // than written down, so renaming one moves this with it.
    const operatorSurface = await readFile(operatorSurfacePath, "utf8");
    const mount = /<ScopedAssistantCompanion[\s\S]*?\/>/.exec(code(operatorSurface));
    assert.ok(mount, "the operator view no longer mounts the assistant");
    const seed = /export const SUPPORT_SEED = \[([\s\S]*?)\] as const;/.exec(
      await readFile(seedsPath, "utf8"),
    );
    assert.ok(seed, "the Inbox seeds module no longer declares SUPPORT_SEED");
    const seededIds = [...seed[1].matchAll(/\n\s+id:\s*"([^"]+)"/g)].map((match) => match[1]);
    assert.ok(seededIds.length > 0, "SUPPORT_SEED names no ids to guard against");
    for (const id of seededIds) {
      assert.equal(mount[0].includes(`"${id}"`), false, `the assistant is handed the fixture id ${id}`);
    }
    assert.equal(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(mount[0]),
      false,
      "the assistant is handed something uuid-shaped",
    );
    // And no thread of any name reaches it, which is what makes the sweep above exhaustive rather
    // than a list of the two handles that happen to exist today.
    assert.equal(
      /thread/i.test(mount[0]),
      false,
      "the assistant is handed a thread again; held drafts belong to the Inbox",
    );

    // The disabled fixture preview that used to follow the live assistant is gone. It moved with
    // the extraction, so the strings have to stay deleted in the file they moved *to* — checking
    // only the surface would pass while the panel sat one import away.
    //
    // Compared against the code rather than the file, and this is the fourth assertion in this
    // one file to need that. A deleted string is deleted when nothing renders it, and the honest
    // way to record why a panel went away is a comment quoting the panel — which is exactly what
    // the rebuilt page does. Reading the raw file turns a good explanation into a failure and
    // teaches the next person to explain less.
    const operatorSurfaceCode = code(operatorSurface);
    for (const removed of [
      "Assistant preview input",
      "Assistant connection is not enabled",
      "Workspace intelligence",
      "brand-tile-foreground",
      "brand-tile-muted",
    ]) {
      assert.equal(operatorSurfaceCode.includes(removed), false, `${removed} must stay deleted`);
      assert.equal(operatorCode.includes(removed), false, `${removed} moved instead of dying`);
    }
  });
});
