import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toEmbedUrl } from "./video-embed.ts";

describe("training video embeds", () => {
  it("maps a Loom share link onto the Loom embed endpoint", () => {
    assert.equal(
      toEmbedUrl("https://www.loom.com/share/abc123DEF"),
      "https://www.loom.com/embed/abc123DEF",
    );
    assert.equal(
      toEmbedUrl("https://loom.com/share/abc123DEF?t=30"),
      "https://www.loom.com/embed/abc123DEF",
    );
  });

  it("maps both YouTube forms onto the cookieless player", () => {
    assert.equal(
      toEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    assert.equal(
      toEmbedUrl("https://youtu.be/dQw4w9WgXcQ"),
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });

  it("maps a Vimeo video onto the Vimeo player", () => {
    assert.equal(toEmbedUrl("https://vimeo.com/76979871"), "https://player.vimeo.com/video/76979871");
  });

  it("returns null for every host it does not know", () => {
    for (const url of [
      "https://example.com/video/1",
      "https://notloom.com/share/abc",
      "https://www.loom.com.evil.test/share/abc",
      "https://player.vimeo.com/video/76979871",
    ]) {
      assert.equal(toEmbedUrl(url), null, `${url} was framed`);
    }
  });

  it("returns null for a known host whose path is not a video", () => {
    for (const url of [
      "https://www.loom.com/looks/abc",
      "https://www.loom.com/share/",
      "https://www.youtube.com/results?search_query=x",
      "https://www.youtube.com/watch",
      "https://vimeo.com/channels/staffpicks",
      "https://youtu.be/",
    ]) {
      assert.equal(toEmbedUrl(url), null, `${url} was framed`);
    }
  });

  it("refuses a non-https URL and an absent one", () => {
    assert.equal(toEmbedUrl("http://www.loom.com/share/abc123"), null);
    assert.equal(toEmbedUrl("javascript:alert(1)"), null);
    assert.equal(toEmbedUrl("not a url"), null);
    assert.equal(toEmbedUrl(""), null);
    assert.equal(toEmbedUrl(null), null);
    assert.equal(toEmbedUrl(undefined), null);
  });

  it("refuses an id that would steer the embed URL elsewhere", () => {
    assert.equal(toEmbedUrl("https://www.loom.com/share/..%2F..%2Fevil"), null);
    assert.equal(toEmbedUrl("https://www.youtube.com/watch?v=abc/../evil"), null);
  });
});
