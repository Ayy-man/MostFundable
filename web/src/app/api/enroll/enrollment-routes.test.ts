import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import { POST as enroll } from "./route.ts";
import { POST as cancel } from "../enrollments/[id]/cancel/route.ts";
import { POST as submitIdv } from "../enrollments/[id]/idv/route.ts";
import { POST as reauthorizeConsent } from "../enrollments/[id]/reauthorize-consent/route.ts";
import { POST as revokeConsent } from "../enrollments/[id]/revoke-consent/route.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const ITEM_CONTEXT = { params: Promise.resolve({ id: ID }) };
const ROUTES = [
  ["/api/enroll", "./route.ts", (request: Request) => enroll(request)],
  ["/api/enrollments/[id]/cancel", "../enrollments/[id]/cancel/route.ts", (request: Request) => cancel(request, ITEM_CONTEXT)],
  ["/api/enrollments/[id]/idv", "../enrollments/[id]/idv/route.ts", (request: Request) => submitIdv(request, ITEM_CONTEXT)],
  ["/api/enrollments/[id]/reauthorize-consent", "../enrollments/[id]/reauthorize-consent/route.ts", (request: Request) => reauthorizeConsent(request, ITEM_CONTEXT)],
  ["/api/enrollments/[id]/revoke-consent", "../enrollments/[id]/revoke-consent/route.ts", (request: Request) => revokeConsent(request, ITEM_CONTEXT)],
] as const;

describe("enrollment mutation feature boundary", () => {
  test("flag-off returns the typed 404 before the session seam", async () => {
    const previous = process.env.FEATURE_ENROLLMENT;
    delete process.env.FEATURE_ENROLLMENT;
    try {
      for (const [path, , call] of ROUTES) {
        for (const cookie of [undefined, "sb-session=authenticated"] as const) {
          const response = await call(new Request(`http://local.test${path.replace("[id]", ID)}`, {
            body: "{",
            headers: cookie ? { cookie } : undefined,
            method: "POST",
          }));
          assert.equal(response.status, 404, `${path} ${cookie ? "authenticated" : "anonymous"}`);
          assert.deepEqual(await response.json(), {
            error: { code: "not_found", message: "Enrollment is unavailable." },
          });
        }
      }
    } finally {
      if (previous === undefined) delete process.env.FEATURE_ENROLLMENT;
      else process.env.FEATURE_ENROLLMENT = previous;
    }
  });

  test("every feature-off branch precedes dynamic auth and service imports", async () => {
    for (const [path, relative] of ROUTES) {
      const source = await readFile(new URL(relative, import.meta.url), "utf8");
      const handler = source.slice(source.indexOf("export async function POST"));
      const flag = handler.indexOf('featureFlag("FEATURE_ENROLLMENT")');
      const firstImport = handler.indexOf("await Promise.all");
      assert.ok(flag >= 0 && firstImport > flag, `${path}: feature-off must return before the session seam`);
      assert.doesNotMatch(source, /^import .*@\/lib\/auth\/session/m, path);
    }
  });

  test("reauthorization is consumer-only and returns private server readback", async () => {
    const source = await readFile(
      new URL("../enrollments/[id]/reauthorize-consent/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /requireRole\("consumer"\)/);
    assert.doesNotMatch(source, /\bgetSession\b/);
    assert.match(source, /parseReauthorizeConsentBody\(await readEnrollmentJson\(request\)\)/);
    assert.match(source, /"Cache-Control": "private, no-store"/);
  });

  test("the IDV route returns consent attention without continuing to provider submission", async () => {
    const previous = process.env.FEATURE_ENROLLMENT;
    process.env.FEATURE_ENROLLMENT = "1";
    let submitted = 0;
    try {
      const response = await submitIdv(
        new Request(`http://local.test/api/enrollments/${ID}/idv`, { body: "{", method: "POST" }),
        ITEM_CONTEXT,
        {
          async getSession() {
            return { disabledAt: null, id: ID, manages: [], orgId: ID, orgMembership: null, orgRole: null, role: "consumer" };
          },
          parseEnrollmentId(value) {
            if (typeof value !== "string") throw new Error("invalid enrollment id");
            return value;
          },
          parseIdvSubmitBody() { throw new Error("must not parse after consent withdrawal"); },
          async readEnrollmentJson() { throw new Error("must not read after consent withdrawal"); },
          async reconcile() {
            return {
              attemptsRemaining: 2, consents: [], enrollmentId: ID, idvState: "passed",
              lockedUntil: null, milestones: [], needsOperatorAttention: "consent_withdrawn",
              parkedUntil: null, status: "active", subscription: null,
            };
          },
          async submitIdv() { submitted += 1; throw new Error("provider submission must not run"); },
        },
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).needsOperatorAttention, "consent_withdrawn");
      assert.equal(submitted, 0, "the IDV route does not bypass withdrawn consent reconciliation");
    } finally {
      if (previous === undefined) delete process.env.FEATURE_ENROLLMENT;
      else process.env.FEATURE_ENROLLMENT = previous;
    }
  });
});
