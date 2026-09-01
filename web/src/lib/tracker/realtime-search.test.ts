import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readTrackerClientSnapshot } from "./realtime.client.ts";

describe("tracker record-search snapshot", () => {
  it("uses the authenticated client route with explicit all-status scope and no cache", async () => {
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ init, url: String(input) });
      return Response.json({ clients: [], enabled: false });
    };

    const result = await readTrackerClientSnapshot(
      { scope: "all", status: "all" },
      fetcher,
    );

    assert.deepEqual(result, { clients: [], enabled: false });
    assert.equal(requests[0]?.url, "/api/clients?scope=all&status=all");
    assert.equal(requests[0]?.init?.cache, "no-store");
    assert.equal(requests[0]?.init?.credentials, "same-origin");
  });
});
