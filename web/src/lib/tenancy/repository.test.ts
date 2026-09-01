import assert from "node:assert/strict";
import test from "node:test";

import { createTenancyRepository } from "./repository.ts";

test("repository preserves portalName in draft and published brand reads", async () => {
  const data = {
    brand: { platform_intake: true, portalName: "Northbridge Client Portal" },
    brand_published_at: "2026-09-01T00:00:00.000Z",
    id: "43200000-0000-4000-8000-000000000001",
    membership: "current",
    slug: "northbridge",
  };
  const query = {
    eq() { return query; },
    maybeSingle() { return Promise.resolve({ data, error: null }); },
    select() { return query; },
  };
  const repository = createTenancyRepository({
    from() { return query; },
    rpc() { throw new Error("unexpected RPC"); },
  } as never);

  assert.deepEqual(await repository.readBrand(data.id), {
    brand: { portalName: "Northbridge Client Portal" },
    publishedAt: data.brand_published_at,
    slug: data.slug,
  });
  assert.deepEqual(await repository.readPublishedBrand(data.id), {
    portalName: "Northbridge Client Portal",
  });
  assert.deepEqual((await repository.findClaimedOrgBySlug(data.slug))?.publishedBrand, {
    portalName: "Northbridge Client Portal",
  });
});
