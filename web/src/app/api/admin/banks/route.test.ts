import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { GET, POST } from "./route.ts";

describe("admin bank catalog route", () => {
  it("returns an empty 404 before loading mutations while either feature is off", async () => {
    const priorAdmin = process.env.FEATURE_ADMIN;
    const priorVault = process.env.FEATURE_VAULT;
    delete process.env.FEATURE_ADMIN;
    process.env.FEATURE_VAULT = "true";
    try {
      assert.equal((await GET()).status, 404);
      assert.equal((await POST(new Request("http://local/api/admin/banks", { method: "POST" }))).status, 404);
    } finally {
      if (priorAdmin === undefined) delete process.env.FEATURE_ADMIN; else process.env.FEATURE_ADMIN = priorAdmin;
      if (priorVault === undefined) delete process.env.FEATURE_VAULT; else process.env.FEATURE_VAULT = priorVault;
    }
  });

  it("exposes list/create and archive-or-edit, but no hard-delete route", () => {
    const collection = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    const item = readFileSync(new URL("./[ref]/route.ts", import.meta.url), "utf8");
    assert.match(collection, /export async function GET/);
    assert.match(collection, /export async function POST/);
    assert.match(item, /export async function PATCH/);
    assert.doesNotMatch(`${collection}\n${item}`, /export async function DELETE/);
    assert.ok(collection.indexOf("if (!enabled())") < collection.indexOf("handleAdminBankCatalogList"));
    assert.ok(item.indexOf('!featureFlag("FEATURE_ADMIN")') < item.indexOf("handleAdminBankCatalogMutation"));
  });
});
