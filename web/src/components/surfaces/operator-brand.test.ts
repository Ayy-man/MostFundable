import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import { writeTenantRequestContext } from "@/lib/tenancy/context";
import {
  operatorBrandPresentation,
} from "@/lib/tenancy/operator-brand";
import { readOperatorPublishedBrand } from "@/lib/tenancy/operator-brand-server";
import type { PublishedBrand, TenantResolution } from "@/lib/tenancy/types";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PUBLISHED: PublishedBrand = {
  accentColor: "#2255aa",
  logoUrl: "https://assets.example.test/operator/logo.png",
  primaryColor: "#114477",
};

function tenantHeaders(resolution: TenantResolution): Headers {
  return writeTenantRequestContext(new Headers(), resolution);
}

describe("published operator brand", () => {
  test("does not query when tenancy is disabled", async () => {
    let reads = 0;
    const brand = await readOperatorPublishedBrand({
      enabled: false,
      headers: tenantHeaders({ kind: "organization", organization: {
        brandPublishedAt: "2026-08-17T00:00:00Z",
        id: ORG_ID,
        membership: "current",
        publishedBrand: PUBLISHED,
        slug: "acme",
      } }),
      repository: { async readPublishedBrand() { reads += 1; return PUBLISHED; } },
    });
    assert.equal(brand, null);
    assert.equal(reads, 0);
  });

  test("does not query for absent or platform-admin context", async () => {
    let reads = 0;
    const repository = {
      async readPublishedBrand() { reads += 1; return PUBLISHED; },
    };
    assert.equal(await readOperatorPublishedBrand({ enabled: true, headers: new Headers(), repository }), null);
    assert.equal(await readOperatorPublishedBrand({
      enabled: true,
      headers: tenantHeaders({ kind: "platform_admin" }),
      repository,
    }), null);
    assert.equal(reads, 0);
  });

  test("threads only the repository's published projection", async () => {
    let requestedOrgId = "";
    const headers = tenantHeaders({
      kind: "organization",
      organization: {
        brandPublishedAt: "2026-08-17T00:00:00Z",
        id: ORG_ID,
        membership: "current",
        publishedBrand: PUBLISHED,
        slug: "acme",
      },
    });
    const brand = await readOperatorPublishedBrand({
      enabled: true,
      headers,
      repository: {
        async readPublishedBrand(orgId) {
          requestedOrgId = orgId;
          return PUBLISHED;
        },
      },
    });
    assert.equal(requestedOrgId, ORG_ID);
    assert.deepEqual(brand, PUBLISHED);
  });

  test("an unpublished repository result reaches the surface as no prop", async () => {
    const brand = await readOperatorPublishedBrand({
      enabled: true,
      headers: tenantHeaders({
        kind: "organization",
        organization: {
          brandPublishedAt: null,
          id: ORG_ID,
          membership: "trial",
          publishedBrand: null,
          slug: "acme",
        },
      }),
      repository: { async readPublishedBrand() { return null; } },
    });
    assert.equal(brand, null);
    assert.deepEqual(operatorBrandPresentation(brand ?? undefined), {});
  });

  test("no-prop presentation preserves the existing render path", async () => {
    assert.deepEqual(operatorBrandPresentation(), {});
    assert.deepEqual(operatorBrandPresentation(undefined), {});
    const source = await readFile(new URL("./operator.tsx", import.meta.url), "utf8");
    assert.match(source, /if \(!publishedBrand\.shellStyle\) return shell;/);
    // The fixture persona is now the fallback behind the session identity
    // (display-identity.ts); an absent published brand and an absent session
    // identity still land on the same fixture strings.
    // Re-pinned 2026-08-22 (fixture eviction, LANE A): the shell's brand and
    // the two Inbox composers now share one `workspaceBrandName` constant, and
    // the fixture persona is reached only when this is NOT a signed-in
    // workspace — a real operator with no org on the session gets a neutral
    // placeholder rather than a company none of them work for. The fixture
    // shell's own strings are unchanged, which is what this test is about.
    assert.match(source, /brand=\{workspaceBrandName\}/);
    assert.match(
      source,
      /const \[liveWorkspaceName, setLiveWorkspaceName\] = useState\([\s\S]*?sessionIdentity\?\.orgName[\s\S]*?const workspaceBrandName = liveTenantBrand\?\.portalName \?\? liveWorkspaceName;/,
    );
    assert.match(
      source,
      /roleLabel=\{sessionIdentity \? displayRoleLine\(sessionIdentity\) : \(durableWorkspace \? "[^"]+" : "Owner · Apex Funding Partners"\)\}/,
    );
  });

  test("published colors apply to the operator shell without changing fixture copy", () => {
    assert.deepEqual(operatorBrandPresentation(PUBLISHED), {
      logoUrl: PUBLISHED.logoUrl,
      previewColor: "#2255aa",
      shellStyle: {
        "--primary": "#114477",
        "--ring": "#2255aa",
        "--sidebar-primary": "#114477",
        "--sidebar-ring": "#2255aa",
      },
    });
  });
});
