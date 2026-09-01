import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";

import { parseArguments, validateHeaders, verifyUrl } from "../../scripts/verify-security-headers.mjs";

const contract = JSON.parse(readFileSync(new URL("./security-contract.json", import.meta.url), "utf8"));
const servers = [];
afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    await new Promise((resolveClosed) => server.close(resolveClosed));
  }
});

function completeHeaders() {
  return Object.fromEntries(contract.required.map((rule) => [rule.name, rule.predicate.value]));
}

async function serve(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  return `http://127.0.0.1:${server.address().port}`;
}

test("complete local header contract passes", async () => {
  const url = await serve((_request, response) => {
    response.writeHead(200, completeHeaders());
    response.end("ok");
  });
  const receipt = await verifyUrl({ url, buildRef: "local-test", environment: "local", contract });
  assert.equal(receipt.verdict, "PASS");
  assert.deepEqual(receipt.findings, []);
  assert.equal("body" in receipt, false);
});

test("missing CSP and HSTS remain failing findings", () => {
  const headers = new Headers({
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  assert.deepEqual(validateHeaders(headers, contract, "local"), [
    { id: "MISSING_HEADER", header: "content-security-policy" },
    { id: "MISSING_HEADER", header: "strict-transport-security" },
  ]);
});

test("malformed values fail without returning the response value", () => {
  const headers = completeHeaders();
  headers["content-security-policy"] = "synthetic-wrong-value";
  const findings = validateHeaders(new Headers(headers), contract, "local");
  assert.deepEqual(findings, [{ id: "MALFORMED_HEADER", header: "content-security-policy" }]);
  assert.equal(JSON.stringify(findings).includes("synthetic-wrong-value"), false);
});

test("redirects are refused instead of followed", async () => {
  const url = await serve((_request, response) => {
    response.writeHead(302, { location: "https://example.invalid/elsewhere" });
    response.end();
  });
  const receipt = await verifyUrl({ url, buildRef: "local-test", environment: "local", contract });
  assert.equal(receipt.verdict, "FAIL");
  assert.equal(receipt.findings.some(({ id }) => id === "REDIRECT_REFUSED"), true);
});

test("deployed verification requires both URL and build reference", async () => {
  const receipt = await verifyUrl({ url: null, buildRef: null, environment: "deployed", contract });
  assert.equal(receipt.verdict, "UNVERIFIED-FOR-ACCOUNT");
  assert.deepEqual(receipt.findings, [{ id: "DEPLOYED_INPUT_REQUIRED" }]);
});

test("unknown environments and arguments fail closed", () => {
  assert.throws(() => parseArguments(["--environment", "preview"]), /local or deployed/);
  assert.throws(() => parseArguments(["--filter", "csp"]), /unknown argument/);
});
