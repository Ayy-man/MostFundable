import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { NextRequest, NextResponse } from "next/server";

import {
  activeProfileRole,
  guardDecision,
  providerSessionDecision,
  type GuardDecision,
} from "@/lib/auth/route-guard";
import { writeTenantRequestContext } from "@/lib/tenancy/context";
import { createTenantHostResolver } from "@/lib/tenancy/resolve";
import type { TenancyRepository } from "@/lib/tenancy/repository";
import type { TenantOrganization } from "@/lib/tenancy/types";
import { legacyProxy, proxy, tenantProxy } from "../../src/proxy.ts";

const PROXY_MODULE_PATH = "../../src/proxy.ts";

const requireFromHere = createRequire(import.meta.url);
const { unstable_doesMiddlewareMatch } = requireFromHere(
  "next/experimental/testing/server",
) as typeof import("next/experimental/testing/server");

const ORG: TenantOrganization = {
  brandPublishedAt: null,
  id: "11111111-1111-4111-8111-111111111111",
  membership: "current",
  publishedBrand: null,
  slug: "acme",
};

function resolver() {
  return createTenantHostResolver({
    async findClaimedOrgBySlug(slug: string) {
      return slug === ORG.slug ? ORG : null;
    },
  } as TenancyRepository);
}

async function responseSnapshot(response: Response) {
  return {
    body: Buffer.from(await response.arrayBuffer()),
    headers: [...response.headers.entries()],
    status: response.status,
  };
}

describe("route-guard", () => {
  test("only an active profile creates an application session across every surface", () => {
    const states = [
      { expected: { clear: false, hasSession: true }, state: "active" },
      { expected: { clear: true, hasSession: false }, state: "missing" },
      { expected: { clear: false, hasSession: false }, state: "unavailable" },
      { expected: { clear: true, hasSession: false }, state: "disabled" },
    ] as const;
    const paths = ["/", "/sign-in", "/admin", "/affiliate", "/consumer", "/operator"];

    for (const { expected, state } of states) {
      const session = providerSessionDecision(true, state);
      assert.deepEqual(session, expected, `${state} provider session decision`);

      for (const pathname of paths) {
        const decision = guardDecision({ hasSession: session.hasSession, pathname });
        const expectedGuard = state === "active"
          ? pathname === "/sign-in" ? { redirectTo: "/" } : null
          : pathname === "/sign-in" ? null : { redirectTo: "/sign-in" };
        assert.deepEqual(decision, expectedGuard, `${state} ${pathname} must settle`);
      }
    }
  });

  test("sign-in and confirmation require an active profile role", () => {
    assert.equal(activeProfileRole(null), null, "a missing profile must never inherit consumer access");
    assert.equal(
      activeProfileRole({ disabled_at: "2026-08-17T00:00:00Z", role: "platform_admin" }),
      null,
      "a disabled profile must never create an application session",
    );
    assert.equal(activeProfileRole({ disabled_at: null, role: "affiliate" }), "affiliate");
  });

  const cases: Array<{
    expected: GuardDecision;
    hasSession: boolean;
    pathname: string;
  }> = [
    {
      expected: { redirectTo: "/sign-in" },
      hasSession: false,
      pathname: "/operator",
    },
    { expected: null, hasSession: false, pathname: "/sign-in" },
    {
      expected: null,
      hasSession: false,
      pathname: "/api/auth/sign-in",
    },
    {
      expected: null,
      hasSession: false,
      pathname: "/api/invites/accept",
    },
    {
      expected: { redirectTo: "/sign-in" },
      hasSession: false,
      pathname: "/api/invites/accept/other",
    },
    {
      expected: { redirectTo: "/" },
      hasSession: true,
      pathname: "/sign-in",
    },
    { expected: null, hasSession: true, pathname: "/operator" },
    {
      expected: { redirectTo: "/sign-in" },
      hasSession: false,
      pathname: "/_next/static/chunks/app.js",
    },
    {
      expected: { redirectTo: "/sign-in" },
      hasSession: false,
      pathname: "/icon.svg",
    },
  ];

  for (const { expected, hasSession, pathname } of cases) {
    test(`${hasSession ? "authenticated" : "unauthenticated"} ${pathname}`, () => {
      assert.deepEqual(
        guardDecision({ hasSession, pathname }),
        expected,
        `route-guard decision changed for ${pathname}`,
      );
    });
  }
});

describe("proxy matcher", () => {
  test("covers application routes and excludes static assets", async () => {
    const { config } = (await import(PROXY_MODULE_PATH)) as {
      config: Parameters<typeof unstable_doesMiddlewareMatch>[0]["config"];
    };

    for (const url of [
      "/admin",
      "/operator",
      "/consumer",
      "/affiliate",
      "/sign-in",
      "/api/auth/sign-in",
    ]) {
      assert.equal(
        unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }),
        true,
        `proxy matcher must cover ${url}`,
      );
    }

    for (const url of [
      "/_next/static/chunks/app.js",
      "/_next/image?url=%2Ficon.svg&w=64&q=75",
      "/favicon.ico",
      "/icon.svg",
    ]) {
      assert.equal(
        unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }),
        false,
        `proxy matcher must exclude ${url}`,
      );
    }
  });

  // DEC-OWN-PROXY-WEBHOOKS. Both halves are asserted, because the exclusion
  // that is too wide is as wrong as the one that is missing: `/api/enrollments`
  // shares a prefix with `/api/enroll` and must keep the session-refresh pass.
  test("excludes signature-verified webhooks and the unauthenticated bootstrap", async () => {
    const { config } = (await import(PROXY_MODULE_PATH)) as {
      config: Parameters<typeof unstable_doesMiddlewareMatch>[0]["config"];
    };

    for (const url of [
      "/api/webhooks/stripe",
      "/api/webhooks/crs",
      "/api/webhooks/crs/retry",
      "/api/enroll",
    ]) {
      assert.equal(
        unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }),
        false,
        `proxy matcher must exclude ${url} (DEC-OWN-PROXY-WEBHOOKS)`,
      );
    }

    for (const url of [
      "/api/enrollments/11111111-1111-1111-1111-111111111111/idv",
      "/api/enrollments/11111111-1111-1111-1111-111111111111/cancel",
      "/api/enrollments/11111111-1111-1111-1111-111111111111/milestone",
      "/api/org/settings",
      "/api/monitoring/token",
    ]) {
      assert.equal(
        unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }),
        true,
        `the exclusion is too wide — proxy matcher must still cover ${url}`,
      );
    }
  });

  test("excludes only the referral resolver prefix", async () => {
    const { config } = (await import(PROXY_MODULE_PATH)) as {
      config: Parameters<typeof unstable_doesMiddlewareMatch>[0]["config"];
    };

    assert.equal(
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `/api/referrals/resolve/${"a".repeat(43)}` }),
      false,
      "public referral resolution must bypass the session proxy",
    );

    for (const url of [
      "/api/referrals",
      "/api/referrals/convert",
      "/api/referrals/resolver/lookalike",
      "/api/referrals/resolve",
    ]) {
      assert.equal(
        unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }),
        true,
        `proxy matcher must still cover ${url}`,
      );
    }
  });
});

describe("tenant proxy", () => {
  test("empty environment is byte-identical to the legacy response", async () => {
    const previousTenancy = process.env.FEATURE_TENANCY;
    const previousAuth = process.env.FEATURE_REAL_AUTH;
    delete process.env.FEATURE_TENANCY;
    delete process.env.FEATURE_REAL_AUTH;
    try {
      const url = "http://acme.localhost:3000/operator?view=clients";
      const baseline = await responseSnapshot(
        await legacyProxy(new NextRequest(url, { headers: { cookie: "demo=1" } })),
      );
      const actual = await responseSnapshot(
        await proxy(new NextRequest(url, { headers: { cookie: "demo=1" } })),
      );
      assert.deepEqual(actual, baseline);
    } finally {
      if (previousTenancy === undefined) delete process.env.FEATURE_TENANCY;
      else process.env.FEATURE_TENANCY = previousTenancy;
      if (previousAuth === undefined) delete process.env.FEATURE_REAL_AUTH;
      else process.env.FEATURE_REAL_AUTH = previousAuth;
    }
  });

  test("local organization Host replaces spoofed tenant headers", async () => {
    const received: NextRequest[] = [];
    const response = await tenantProxy(
      new NextRequest("http://acme.localhost:3000/operator", {
        headers: {
          "x-mf-org-id": "attacker",
          "x-mf-org-slug": "attacker",
          "x-mf-tenant-kind": "platform_admin",
        },
      }),
      {
        resolveTenantHost: resolver(),
        runLegacy: async (request) => {
          received.push(request);
          return NextResponse.next({ request });
        },
        writeContext: writeTenantRequestContext,
      },
    );

    assert.equal(response.status, 200);
    assert.equal(received[0]?.headers.get("x-mf-tenant-kind"), "organization");
    assert.equal(received[0]?.headers.get("x-mf-org-id"), ORG.id);
    assert.equal(received[0]?.headers.get("x-mf-org-slug"), ORG.slug);
  });

  test("admin local Host receives only platform context", async () => {
    const received: NextRequest[] = [];
    await tenantProxy(new NextRequest("http://admin.localhost:3000/admin"), {
      resolveTenantHost: resolver(),
      runLegacy: async (request) => {
        received.push(request);
        return NextResponse.next({ request });
      },
      writeContext: writeTenantRequestContext,
    });
    assert.equal(received[0]?.headers.get("x-mf-tenant-kind"), "platform_admin");
    assert.equal(received[0]?.headers.has("x-mf-org-id"), false);
    assert.equal(received[0]?.headers.has("x-mf-org-slug"), false);
  });

  test("default slug bypasses an otherwise unknown Host", async () => {
    const received: NextRequest[] = [];
    await tenantProxy(new NextRequest("http://localhost:3000/operator"), {
      defaultOrgSlug: "acme",
      resolveTenantHost: resolver(),
      runLegacy: async (request) => {
        received.push(request);
        return NextResponse.next({ request });
      },
      writeContext: writeTenantRequestContext,
    });
    assert.equal(received[0]?.headers.get("x-mf-org-id"), ORG.id);
  });

  test("unknown Hosts return the same neutral bytes without reflecting labels", async () => {
    const run = async (label: string) => responseSnapshot(await tenantProxy(
      new NextRequest(`http://${label}.localhost:3000/operator`),
      {
        resolveTenantHost: resolver(),
        runLegacy: async () => assert.fail("unknown tenant reached auth proxy"),
        writeContext: writeTenantRequestContext,
      },
    ));
    const first = await run("missing-one");
    const second = await run("missing-two");
    assert.deepEqual(second, first);
    assert.equal(first.status, 404);
    assert.equal(first.body.includes(Buffer.from("missing-one")), false);
    assert.equal(first.body.includes(Buffer.from("missing-two")), false);
  });

  test("enabled tenant path preserves refreshed auth cookies", async () => {
    const response = await tenantProxy(
      new NextRequest("http://acme.localhost:3000/operator"),
      {
        resolveTenantHost: resolver(),
        runLegacy: async (request) => {
          const refreshed = NextResponse.next({ request });
          refreshed.cookies.set("sb-refresh", "rotated", {
            httpOnly: true,
            path: "/",
          });
          refreshed.headers.set("Cache-Control", "private, no-store");
          return refreshed;
        },
        writeContext: writeTenantRequestContext,
      },
    );
    assert.match(response.headers.get("set-cookie") ?? "", /sb-refresh=rotated/);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });
});
