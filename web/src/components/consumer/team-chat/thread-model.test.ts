// Who is speaking, checked against the thing that decides it.
//
// The claim these tests carry is contract rail 6: a reader always knows who is speaking, and the
// human thread is human-only. That claim is enforced in the database by a closed enum, so the
// enum is where the assertion is derived from — reading `support_author_kind`'s labels out of
// migration 100 rather than writing "consumer, operator, admin" here. A fourth author added to
// the enum then fails this file, which is the point: the failure mode being guarded against is a
// widened enum reaching the view and rendering under whichever branch happened to be last.
//
// Watched failing before it passed. With `authorFor`'s `operator` branch changed to return the
// assigned member's name (the tempting fix for "SupportMessageRow has no display name"), "a team
// message is attributed to the workspace" fails on the returned name; with the `admin` case
// removed, `tsc` refuses the file and the exhaustiveness assertion below reports the missing
// label by name.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import type { SupportAuthorKind, SupportMessageRow } from "@/lib/support";

import {
  PLATFORM_NAME,
  READER_NAME,
  TEAM_ROLE_LABEL,
  authorFor,
  isReader,
  messageFrom,
  threadItemsFrom,
  unreadCount,
} from "./thread-model";

const HANDOVER_README = path.resolve(import.meta.dirname, "../../../../../README.md");

const MIGRATION = path.resolve(
  import.meta.dirname,
  "../../../../../supabase/migrations/100_support_threads.sql",
);

/**
 * The author kinds the database actually has.
 *
 * Parsed out of the `create type` rather than transcribed, so this file cannot go on asserting
 * three labels after a fourth is added. The non-empty assertion comes first because a regex that
 * stops matching would otherwise turn every check below into a loop over nothing.
 */
function authorKinds(): SupportAuthorKind[] {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const declaration = /create type public\.support_author_kind as enum \(([\s\S]*?)\);/.exec(sql);
  assert.ok(declaration, "migration 100 no longer declares support_author_kind");
  const labels = [...declaration[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  assert.ok(labels.length >= 3, `the author enum parsed as ${labels.join(", ")}`);
  return labels as SupportAuthorKind[];
}

function row(over: Partial<SupportMessageRow> = {}): SupportMessageRow {
  return {
    authorKind: "operator",
    authorProfileId: "profile-a",
    body: "Anything.",
    id: "message-a",
    origin: "human",
    originDraftId: null,
    sentAt: "2026-08-20T09:00:00.000Z",
    threadId: "thread-a",
    visibility: "participants",
    ...over,
  };
}

describe("consumer team chat · who is speaking", () => {
  it("names an author for every kind the database can store", () => {
    for (const kind of authorKinds()) {
      const author = authorFor(kind, "Northbridge Funding Group");
      assert.equal(author.kind, kind, `${kind} was rendered as ${author.kind}`);
      assert.ok(author.name.trim().length > 0, `${kind} has no display name`);
    }
  });

  it("treats exactly one kind as the reader", () => {
    // Derived rather than asserted as "consumer": whichever kinds are not the reader are the
    // other party, and a second reader kind would put somebody else's message on the reader's
    // side of the thread.
    const readers = authorKinds().filter(isReader);
    assert.deepEqual(readers, ["consumer"], `${readers.join(", ")} are treated as the reader`);
  });

  it("attributes a team message to the workspace, never to a person", () => {
    // `SupportMessageRow` carries `authorProfileId` and no display name, and the tempting fix is
    // to label every operator message with whoever the client is assigned to. That is wrong
    // roughly whenever a colleague answers, and it is the lie rail 6 is about.
    const brand = "Northbridge Funding Group";
    const author = authorFor("operator", brand);
    assert.equal(author.name, brand);
    assert.equal(author.roleLabel, TEAM_ROLE_LABEL);
  });

  it("names no platform brand to a white-label client", () => {
    // White label is the product promise, so a signed-in client is never told whose software this
    // is — a platform-staff message is attributed to the function rather than to the company.
    //
    // The company's name is read out of the shipped handover README rather than written here. The
    // first version of this assertion compared `authorFor("admin", …).name` against
    // `PLATFORM_NAME`, which is tautological: a mutation run that changed `PLATFORM_NAME` to the
    // product's name passed 7/7, so the check was testing that a constant equals itself.
    const product = /^#\s+(.+)$/m.exec(fs.readFileSync(HANDOVER_README, "utf8"));
    assert.ok(product, "README.md no longer opens with the product's name");
    const platform = product[1].trim();
    for (const kind of authorKinds()) {
      const name = authorFor(kind, "Northbridge Funding Group").name;
      assert.equal(
        name.toLowerCase().includes(platform.toLowerCase()),
        false,
        `a ${kind} message is attributed to ${platform}, which a white-label client never sees`,
      );
    }
    assert.equal(authorFor("consumer", "Northbridge Funding Group").name, READER_NAME);
    assert.ok(PLATFORM_NAME.trim().length > 0);
  });

  it("never claims the team has read the client's message", () => {
    // Contract §4: a read tick is only ever shown from a watermark that exists, and there is no
    // watermark anywhere in the consumer payload for the team's attention. Every durable row
    // stops at `delivered`.
    for (const kind of authorKinds()) {
      assert.equal(messageFrom(row({ authorKind: kind }), "Brand").delivery, "delivered");
    }
  });

  it("passes visibility through rather than filtering it", () => {
    // RLS is what keeps an internal note away from a consumer — migration 385 puts the rule in
    // `support_messages_select` and in the read RPC. Re-filtering here would create a second,
    // weaker place for the guarantee to live, so that the day the filter and the policy disagreed
    // the filter would be believed.
    const rows = [row({ id: "a" }), row({ id: "b", visibility: "internal" })];
    const items = threadItemsFrom(rows, "Brand");
    assert.equal(items.length, rows.length);
    assert.deepEqual(
      items.map((item) => (item.type === "message" ? item.message.visibility : null)),
      rows.map((each) => each.visibility),
    );
  });

  it("carries the server's unread count rather than counting rows", () => {
    // The number comes from `support_list_thread_digest`. A local count disagrees the moment a
    // message lands between the read and the render, and a badge has no way to explain that.
    assert.equal(unreadCount({ counterpartReadAt: null, lastReadAt: null, unreadCount: 4 }), 4);
    assert.equal(unreadCount({ counterpartReadAt: null, lastReadAt: "2026-08-20T09:00:00.000Z", unreadCount: 0 }), 0);
  });
});
