// The server read has to reach the view, or the fixture branch stops being unreachable.
//
// `teamChat` has three meanings and `undefined` is the one that renders a written conversation.
// That is safe only because the real-auth page always passes something — `null` when the read had
// nothing to hand over, a snapshot when it did — and `undefined` is reachable from exactly one
// mount, `components/demo/demo-app.tsx`, which is the fixture shell behind the demo-environment
// bar. If a link in that chain broke, a signed-in client would silently start seeing messages
// nobody sent them, and nothing else in the suite would notice: the prop is optional, so dropping
// it typechecks.
//
// So the chain is followed rather than asserted at either end, and the name is read out of the
// server call rather than written here. Three hops, each of which fails on its own.
//
// Watched failing: removing `teamChat={teamChat}` from the `<ConsumerTeamChat>` element leaves the
// build green, `tsc` silent and every other test passing — and this file reports the missing hop
// by name.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const SRC = path.resolve(import.meta.dirname, "../../..");
const PAGE = path.join(SRC, "app/(surfaces)/consumer/page.tsx");
const CLIENT = path.join(SRC, "app/(surfaces)/consumer/surface-client.tsx");
const SURFACE = path.join(SRC, "components/surfaces/consumer.tsx");

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

describe("consumer team chat · the server read reaches the view", () => {
  it("carries the read from the page to the element, hop by hop", () => {
    const page = read(PAGE);

    // Hop 0: what the page called the value. Read off the call, so a rename moves the whole chain
    // rather than breaking this file.
    const bound = /const (\w+) = await readConsumerTeamChat\(/.exec(page);
    assert.ok(bound, "the consumer page no longer reads the team chat on the server");
    const name = bound[1];

    // Hop 1: page -> surface client, as a literal attribute. The client's other four attributes
    // are pinned as literals by four existing tests, so this one stays literal too rather than
    // joining a spread.
    assert.match(
      page,
      new RegExp(`<ConsumerSurfaceClient[^>]*\\s${name}=\\{${name}\\}`),
      `the page reads the team chat and does not pass it as ${name}`,
    );

    // Hop 2: surface client -> surface. This was a spread while lane 1a could not edit a file
    // under `components/`, because a JSX attribute against a props type lacking the key is an
    // excess-property error and a spread is not. The prop is declared now, so it is an attribute.
    const client = read(CLIENT);
    assert.match(
      client,
      new RegExp(`<ConsumerSurface[^>]*\\s${name}=\\{${name}\\}`),
      "the surface client no longer passes the team chat as a named attribute",
    );
    assert.equal(
      client.includes(`{...{ ${name} }}`),
      false,
      "the team chat still travels anonymously in a spread",
    );

    // Hop 3: surface -> element. The last one, and the one that fails silently: the prop is
    // optional, so dropping it here typechecks and quietly selects the fixture branch.
    const surface = read(SURFACE);
    const element = /<ConsumerTeamChat[^>]*\/>/.exec(surface);
    assert.ok(element, "the consumer surface no longer mounts the Team Chat");
    assert.match(
      element[0],
      new RegExp(`\\s${name}=\\{${name}\\}`),
      "the surface mounts the Team Chat without the server read, so it renders the fixture shell",
    );
  });

  it("hands the view the operator brand the header already writes under", () => {
    // White label is the product promise and a second expression for it is how a signed-in client
    // came to be shown a stranger's company once already. The name is read off the surface's own
    // resolution rather than written here, and then required on the element.
    const surface = read(SURFACE);
    const resolved = /const (\w+) = sessionIdentity\?\.orgName \?\?/.exec(surface);
    assert.ok(resolved, "the consumer surface no longer resolves its own operator brand");
    const element = /<ConsumerTeamChat[^>]*\/>/.exec(surface);
    assert.ok(element);
    assert.match(
      element[0],
      new RegExp(`\\s\\w+=\\{${resolved[1]}\\}`),
      `the Team Chat is not handed ${resolved[1]}, so it would need a second opinion about the brand`,
    );
  });

  it("is the only mount that can leave the prop out", () => {
    // The fixture branch is reachable from the demo shell and from nowhere else. If a second
    // mount appeared without the prop, `undefined` would stop meaning "the demo shell".
    const mounts = fs
      .readdirSync(path.join(SRC, "components"), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.tsx$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name))
      .filter((file) => /<ConsumerSurface[\s/>]/.test(read(file)));
    assert.deepEqual(
      mounts.map((file) => path.relative(SRC, file)),
      ["components/demo/demo-app.tsx"],
      "a second component mounts the consumer surface; check whether it passes the team chat",
    );
  });
});
