import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

// ROADMAP Phase 12, criterion 2, end to end:
//
//   "Package and upfront fee options return `403 legal_gate` until a platform
//    admin sets `org_flags.upfront_fee_approved`."
//
// pgTAP proves the trigger stops every writer, and `src/lib/fees/routes.test.ts`
// proves the handlers turn that refusal into 403 with `error.code` set to the
// exact string the criterion quotes. Neither one exercises the whole chain over
// real HTTP with a real session, which is what this file is for.
//
// It skips unless the local server has real auth and fees enabled and both
// FEES_E2E password variables are set to the local-only default documented in
// `web/.env.example`. `supabase/seed.sql` provisions the two seeded profiles as
// complete email identities, so the live arm needs no extra organization,
// profile or client rows and leaves the seed-isolation counts unchanged.
//
// Residue when it does run: the two `audit_log` rows the flag changes produce.
// `audit_log` carries a BEFORE DELETE trigger that refuses removal, correctly,
// so they stay. They are scoped to the seeded Northbridge org, which 004 only
// ever asserts is invisible from the other org, so they are harmless there.

const baseUrl = process.env.FEES_TEST_BASE_URL ?? process.env.ENROLL_TEST_BASE_URL ?? "http://127.0.0.1:3003";
const container = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_mostfundable";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const CLIENT_ID = "a3000000-0000-0000-0000-000000000001";
const ADMIN_PROFILE_ID = "00000000-0000-0000-0000-000000000001";
const OWNER_EMAIL = "owner@northbridge.example";
const ADMIN_EMAIL = "admin@platform.example";
const SIGNOFF_REF = "LGL-E2E-2026-0001";

const ownerPassword = process.env.FEES_E2E_OWNER_PASSWORD?.trim() ?? "";
const adminPassword = process.env.FEES_E2E_ADMIN_PASSWORD?.trim() ?? "";

function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-tAq", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8" },
  ).trim();
}

function databaseReachable(): boolean {
  try {
    sql("select 1");
    return true;
  } catch {
    return false;
  }
}

/** True once both seeded users are accounts Auth can actually find: an
 * instance id it filters on and an email identity it resolves through. */
function seededUsersAreRealAccounts(): boolean {
  try {
    return (
      sql(
        `select count(*) from auth.users u
         where u.email in ('${OWNER_EMAIL}', '${ADMIN_EMAIL}')
           and u.instance_id is not null
           and u.encrypted_password is not null
           and exists (select 1 from auth.identities i where i.user_id = u.id)`,
      ) === "2"
    );
  } catch {
    return false;
  }
}

async function routeStatus(path: string, init?: RequestInit): Promise<number | null> {
  try {
    const response = await fetch(`${baseUrl}${path}`, { redirect: "manual", ...init });
    return response.status;
  } catch {
    return null;
  }
}

const feesStatus = await routeStatus("/api/fees");
const serverUp = feesStatus !== null;
const dbUp = serverUp ? databaseReachable() : false;
const signInStatus = serverUp
  ? await routeStatus("/api/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "probe@example.invalid", password: "x" }),
    })
  : null;
// A 404 on sign-in means the real-auth routes are not mounted; anything else,
// including the 401 a rejected probe earns, means they are.
const realAuthOn = signInStatus !== null && signInStatus !== 404;

const skip = !serverUp
  ? `no server on ${baseUrl} — run \`npm run dev -- -p 3003\` with FEATURE_FEES and FEATURE_REAL_AUTH set`
  : !dbUp
    ? `no local database container \`${container}\` — run \`supabase start\``
    : !realAuthOn
      ? "FEATURE_REAL_AUTH is not set on the running server — SKIPPED, not passed"
      : ownerPassword === "" || adminPassword === ""
        ? "FEES_E2E_OWNER_PASSWORD / FEES_E2E_ADMIN_PASSWORD are unset — SKIPPED, not passed"
        : !seededUsersAreRealAccounts()
          ? `the local seed is missing complete email identities for ${OWNER_EMAIL} and ${ADMIN_EMAIL} — SKIPPED, not passed`
          : false;

/** Sign in over the app's own route so @supabase/ssr writes the session cookie
 * through its adapter; forging that cookie here would test our forgery. */
async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/sign-in`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(
    response.status === 200 || response.status === 302 || response.status === 303 || response.status === 307,
    `sign-in for ${email} returned ${response.status}`,
  );

  const cookies = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";", 1)[0])
    .filter((entry) => entry.includes("=") && !entry.endsWith("="));
  assert.ok(cookies.length > 0, `sign-in for ${email} set no session cookie`);
  return cookies.join("; ");
}

async function call(
  cookie: string,
  path: string,
  method: string,
  body: unknown,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    redirect: "manual",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, payload };
}

const PACKAGE_AGREEMENT = {
  model: "package",
  upfrontCents: 150_000,
  successCents: 250_000,
  status: "active",
};

function countFlagAudits(): number {
  return Number(
    sql(
      `select count(*) from public.audit_log
       where org_id = '${ORG_ID}'
         and action = 'org_flags.upfront_fee_approved.changed'`,
    ),
  );
}

function cleanUp(): void {
  // Order matters: the ledger and the agreement are separate rows and neither
  // cascades from the other. Nothing here touches auth.
  sql(`delete from public.fee_agreements where client_id = '${CLIENT_ID}'`);
  sql(`delete from public.fee_ledger where client_id = '${CLIENT_ID}'`);
  sql(`delete from public.org_fee_defaults where org_id = '${ORG_ID}'`);
  // Removing the flag row entirely, not just setting it false: 090's pgTAP
  // asserts that no organization outside its own fixtures is approved, and a
  // leftover row would make that assertion depend on what ran before it.
  sql(`delete from public.org_flags where org_id = '${ORG_ID}'`);
}

describe("fees — the legal gate over HTTP (ROADMAP criterion 2)", { skip }, () => {
  it("answers 403 legal_gate before approval and 200 after, with one audit row for the flag", async (t) => {
    const owner = await signIn(OWNER_EMAIL, ownerPassword);

    // The flag probe has to happen behind a session, because the unauthenticated
    // request is redirected by the proxy before it ever reaches the route.
    const flagProbe = await fetch(`${baseUrl}/api/fees`, { headers: { cookie: owner } });
    if (flagProbe.status === 404) {
      t.skip("FEATURE_FEES is not set on the running server — SKIPPED, not passed");
      return;
    }

    cleanUp();

    try {
      // 1. The package arrangement, refused. Both halves of the criterion.
      const refused = await call(
        owner,
        `/api/fees/${CLIENT_ID}/agreement`,
        "PUT",
        PACKAGE_AGREEMENT,
      );
      assert.equal(refused.status, 403, `expected 403, got ${refused.status}`);
      assert.equal((refused.payload.error as { code?: string } | undefined)?.code, "legal_gate");

      // 2. An upfront amount on an un-gated model is refused for the same reason.
      const upfrontRefused = await call(owner, `/api/fees/${CLIENT_ID}/agreement`, "PUT", {
        model: "percentage",
        pct: 10,
        upfrontCents: 25_000,
        status: "active",
      });
      assert.equal(upfrontRefused.status, 403);
      assert.equal(
        (upfrontRefused.payload.error as { code?: string } | undefined)?.code,
        "legal_gate",
      );

      // 3. The operator cannot open their own gate.
      const selfApproval = await call(
        owner,
        `/api/fees/orgs/${ORG_ID}/upfront-approval`,
        "PATCH",
        { approved: true, signoffRef: SIGNOFF_REF },
      );
      assert.equal(selfApproval.status, 403, "an operator owner must not reach the approval route");
      const auditsBefore = countFlagAudits();
      assert.equal(auditsBefore, 0, "a refused approval writes no audit row");

      // 4. A platform admin opens it, with a written reference.
      const admin = await signIn(ADMIN_EMAIL, adminPassword);
      const missingRef = await call(
        admin,
        `/api/fees/orgs/${ORG_ID}/upfront-approval`,
        "PATCH",
        { approved: true },
      );
      assert.equal(missingRef.status, 400, "approving with no sign-off reference is a bad request");

      const approved = await call(
        admin,
        `/api/fees/orgs/${ORG_ID}/upfront-approval`,
        "PATCH",
        { approved: true, signoffRef: SIGNOFF_REF },
      );
      assert.equal(approved.status, 200, `approval returned ${approved.status}`);
      const gate = approved.payload.gate as {
        approved: boolean;
        signoffRef: string | null;
        approvedAt: string | null;
      };
      assert.equal(gate.approved, true);
      assert.equal(gate.signoffRef, SIGNOFF_REF);
      assert.ok(gate.approvedAt !== null, "an approval is stamped with a time");

      // The approval is attributed to the admin who made it, from the session
      // rather than from anything the request could have said.
      assert.equal(
        sql(`select approved_by::text from public.org_flags where org_id = '${ORG_ID}'`),
        ADMIN_PROFILE_ID,
      );

      // 5. Exactly one audit row for the flag change, written by the database
      //    trigger. The route deliberately writes none of its own.
      assert.equal(countFlagAudits(), 1, "the flag change is audited exactly once");

      // 6. The same call that was refused now succeeds.
      const allowed = await call(
        owner,
        `/api/fees/${CLIENT_ID}/agreement`,
        "PUT",
        PACKAGE_AGREEMENT,
      );
      assert.equal(allowed.status, 200, `expected 200 after approval, got ${allowed.status}`);
      assert.equal(
        (allowed.payload.agreement as { model?: string } | undefined)?.model,
        "package",
      );

      // 7. And the ledger followed: a package total is the sum of its amounts.
      const fees = await fetch(`${baseUrl}/api/fees/${CLIENT_ID}`, { headers: { cookie: owner } });
      assert.equal(fees.status, 200);
      const body = (await fees.json()) as { ledger: { totalCents: number; balanceCents: number } };
      assert.equal(body.ledger.totalCents, 400_000);
      assert.equal(body.ledger.balanceCents, 400_000);

      // 8. Revocation is forward-looking: the agreement written while the gate
      //    was open survives, and the next edit is refused again.
      const revoked = await call(
        admin,
        `/api/fees/orgs/${ORG_ID}/upfront-approval`,
        "PATCH",
        { approved: false },
      );
      assert.equal(revoked.status, 200);
      assert.equal(countFlagAudits(), 2, "the revocation is audited as its own change");

      const stillThere = await fetch(`${baseUrl}/api/fees/${CLIENT_ID}`, {
        headers: { cookie: owner },
      });
      const after = (await stillThere.json()) as { agreement: { model: string } };
      assert.equal(after.agreement.model, "package");

      const refusedAgain = await call(
        owner,
        `/api/fees/${CLIENT_ID}/agreement`,
        "PUT",
        PACKAGE_AGREEMENT,
      );
      assert.equal(refusedAgain.status, 403);
      assert.equal(
        (refusedAgain.payload.error as { code?: string } | undefined)?.code,
        "legal_gate",
      );
    } finally {
      cleanUp();
    }
  });
});
