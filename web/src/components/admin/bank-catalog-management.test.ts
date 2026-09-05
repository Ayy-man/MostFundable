import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const component = readFileSync(new URL("./bank-catalog-management.tsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("../surfaces/admin.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../../lib/admin/bank-catalog-client.ts", import.meta.url), "utf8");

describe("admin Bank Vault catalog management", () => {
  it("is mounted on the existing Bank Vault surface without displacing privacy controls", () => {
    assert.match(surface, /import \{ AdminBankCatalogManagement \}/);
    const lenders = surface.slice(surface.indexOf("function LendersBody"), surface.indexOf("type TrainingEditor"));
    assert.match(lenders, /<AdminBankCatalogManagement enabled=\{vaultEnabled\} onMutation=\{recordAudit\} \/>/);
    assert.match(surface, /import \{ AdminPrivacyRequests \}/);
    assert.match(surface, /<AdminPrivacyRequests \/>/);
  });

  it("uses the governed client for load, create, update, archive and reactivate readbacks", () => {
    for (const operation of [
      "loadAdminBankCatalog",
      "createAdminBankCatalogEntry",
      "updateAdminBankCatalogEntry",
      "changeAdminBankCatalogStatus",
    ]) assert.ok(component.includes(operation), `${operation} is not wired`);
    assert.doesNotMatch(component, /\bfetch\(/);
    assert.match(component, /setBanks\(\(current\) => replaceBank\(current, saved\)\)/);
    assert.match(component, /The row above is the database readback/);
    assert.match(client, /method: "POST"/);
    assert.match(client, /method: "PATCH"/);
    assert.doesNotMatch(client, /method: "DELETE"/);
  });

  it("surfaces every stored catalog field and keeps the standing questions locked", () => {
    for (const label of [
      "Bank reference",
      "Bank name",
      "Bank products",
      "Bureau pulls",
      "Source updated date",
      "Qualification summary",
      "Application channel",
      "Channel URL or phone",
      "Checking required",
      "Minimum checking deposit in dollars",
      "Checking seasoning",
      "Relationship manager required",
      "Relationship manager tip",
      "Application questions",
    ]) assert.ok(component.includes(label), `${label} is not surfaced`);
    assert.match(component, /STANDING_APPLICATION_QUESTIONS/);
    assert.match(component, /Included automatically/);
    assert.match(component, /extraQuestions/);
  });

  it("names disabled, failed, loading, active and archived states without treating failure as empty", () => {
    for (const copy of [
      "Catalog controls unavailable",
      "Loading the complete lender catalog",
      "Catalog could not be loaded",
      "No matching banks",
      "Active",
      "Archived",
      "Admin override",
      "Referenced",
    ]) assert.ok(component.includes(copy), `${copy} state is missing`);
    assert.match(component, /hidden overflow-x-auto md:block/);
    assert.match(component, /divide-y divide-border md:hidden/);
  });

  it("archives with an explicit evidence-retention confirmation and offers no deletion control", () => {
    assert.match(component, /Archive never deletes applications or outcome evidence/);
    assert.match(component, /hard deletion is not/);
    assert.match(component, /Reactivate/);
    assert.doesNotMatch(component, />Delete bank</);
    assert.doesNotMatch(component, /deleteAdminBank|removeAdminBank/);
  });
});
