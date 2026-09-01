import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path"; import { describe, it } from "node:test";
const root = path.resolve(process.cwd(), "src/app/api/uploads"); const read = (name: string) => fs.readFileSync(path.join(root, name), "utf8");
describe("upload route contracts", () => {
  it("checks scope before multipart and parser availability before credit bytes", () => { const company = read("documents/route.ts"); assert.ok(company.indexOf("clientReachable") < company.indexOf("request.formData()")); const credit = read("credit-report/route.ts"); assert.ok(credit.indexOf("assertAvailable()") < credit.indexOf("request.formData()")); assert.match(credit, /status === "queued" \? 201 : 202/); });
  it("awaits ids and invokes one canonical purge key without enumeration", () => { for (const file of ["documents/[id]/route.ts", "purge/[id]/route.ts"]) assert.match(read(file), /await context\.params/); const purge = read("purge/[id]/route.ts"); assert.match(purge, /runUploadedReportPurge\(`upload:\$\{id\}`/); assert.doesNotMatch(purge, /listUploadedReportPurgeTargets/); });
});
