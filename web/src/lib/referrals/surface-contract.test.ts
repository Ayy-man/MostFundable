import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surface = readFileSync(new URL("../../components/surfaces/consumer.tsx", import.meta.url), "utf8");
const wrapper = readFileSync(new URL("../../app/(surfaces)/consumer/surface-client.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/(surfaces)/consumer/page.tsx", import.meta.url), "utf8");
const demo = readFileSync(new URL("../../components/demo/demo-app.tsx", import.meta.url), "utf8");

test("consumer referral wiring defaults false through both component boundaries", () => {
  assert.match(surface, /referralsEnabled = false/);
  assert.match(wrapper, /referralsEnabled = false/);
  assert.match(wrapper, /referralsEnabled=\{referralsEnabled\}/);
});

test("the referral control exists in the true header branch only", () => {
  const header = surface.slice(surface.indexOf("actions={referralsEnabled"), surface.indexOf("eyebrow={greetingDate}"));
  assert.match(header, /referralsEnabled \?/);
  assert.equal((header.match(/<ReferralShareControl/g) ?? []).length, 1);
  // The status tag is hoisted into overviewStatusTag so durable mode can swap
  // its claims; both header branches must still render it.
  assert.equal((header.match(/overviewStatusTag/g) ?? []).length, 2);
  const tagStart = surface.indexOf("const overviewStatusTag");
  assert.notEqual(tagStart, -1);
  const tag = surface.slice(tagStart, surface.indexOf("return (", tagStart));
  // Three arms since the Tier-2 eviction lane: durable-with-the-read-off, durable, and the
  // fixture shell. The property under test is that the tag is built in one place, not how many
  // states it distinguishes, so the count moves with the ternary.
  assert.equal((tag.match(/<StatusTag/g) ?? []).length, 3);
});

test("the authenticated page resolves availability after role authorization", () => {
  assert.ok(page.indexOf("requireRole(SURFACE_ROLE)") < page.indexOf("resolveReferralAvailability()"));
  assert.match(page, /referralsEnabled=\{referralsEnabled\}/);
});

test("fixture callers remain referral-free and the false path mounts no effect", () => {
  assert.doesNotMatch(demo, /referralsEnabled|ReferralShareControl/);
  assert.doesNotMatch(wrapper, /useEffect|fetch\("\/api\/referrals"/);
});
