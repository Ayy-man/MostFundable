import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * The defect: under `FEATURE_REAL_AUTH` the role switcher called
 * `router.push(SURFACE_PATH_BY_DEMO_ROLE[role])`. Every surface page calls
 * `requireRole()` and redirects a caller holding another role back to its own
 * surface, so pushing `/admin` as the consumer landed on `/consumer` again and
 * the control did nothing at all.
 *
 * These assertions are derived from the surface directory rather than
 * transcribed from the reproduction: the role list is read off disk, so a fifth
 * surface added later is covered without anyone remembering to add it here.
 * That is the standard the review rounds landed on — a regression test that
 * enumerates by hand rots the moment the enumeration does.
 */

const SURFACES_DIR = join(import.meta.dirname, "../../app/(surfaces)");

function surfaceNames(): string[] {
  return readdirSync(SURFACES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function surfaceClient(name: string): string {
  return readFileSync(join(SURFACES_DIR, name, "surface-client.tsx"), "utf8");
}

function surfacePage(name: string): string {
  return readFileSync(join(SURFACES_DIR, name, "page.tsx"), "utf8");
}

test("every surface exists to be checked", () => {
  const names = surfaceNames();
  assert.ok(names.length >= 4, `expected the four surfaces, found ${names.join(", ")}`);
});

test("no surface client switches role by route navigation", () => {
  for (const name of surfaceNames()) {
    const source = surfaceClient(name);
    assert.ok(
      !source.includes("SURFACE_PATH_BY_DEMO_ROLE"),
      `${name}: switches role with a route push, which requireRole bounces straight back`,
    );
  }
});

test("every surface client routes the switch through the shared hook", () => {
  for (const name of surfaceNames()) {
    const source = surfaceClient(name);
    assert.ok(
      source.includes("useRoleSwitch"),
      `${name}: does not use the shared role-switch hook`,
    );
  }
});

test("every surface client refuses to render the switcher it cannot honour", () => {
  for (const name of surfaceNames()) {
    const source = surfaceClient(name);
    assert.ok(
      source.includes("realAuth && !quickSignIn ? null"),
      `${name}: offers the role switcher when the quick-sign-in route would 404`,
    );
  }
});

test("every surface page supplies quickSignIn from the server-side helper", () => {
  for (const name of surfaceNames()) {
    const source = surfacePage(name);
    assert.ok(
      source.includes("quickSignIn={demoQuickSignInEnabled()}"),
      `${name}: does not pass the server-derived quick-sign-in condition`,
    );
  }
});

test("the hook exchanges the session rather than navigating, under real auth", () => {
  const hook = readFileSync(join(import.meta.dirname, "use-role-switch.ts"), "utf8");
  assert.ok(
    hook.includes("/api/auth/quick-sign-in"),
    "the hook must exchange the session through the quick-sign-in route",
  );
  assert.ok(
    hook.includes("window.location.assign"),
    "a changed session cookie needs a document load, not a client-router push",
  );
});

test("the quick-sign-in condition requires both flags and a password", () => {
  const helper = readFileSync(join(import.meta.dirname, "quick-sign-in.ts"), "utf8");
  for (const part of [
    "FEATURE_REAL_AUTH",
    "FEATURE_DEMO_QUICK_SIGN_IN",
    "DEMO_QUICK_SIGN_IN_PASSWORD",
  ]) {
    assert.ok(helper.includes(part), `the condition drops ${part}`);
  }
});
