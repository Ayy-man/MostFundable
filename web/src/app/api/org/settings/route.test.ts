import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");

function stringMembers(constant: string): string[] {
  const declaration = new RegExp(`const ${constant} = \\[([\\s\\S]*?)\\]`).exec(source);
  assert.ok(declaration, `${constant} is missing`);
  return [...declaration[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

test("workspace identity is a bounded normalized settings field", () => {
  assert.ok(stringMembers("SETTABLE_KEYS").includes("name"));
  assert.match(source, /const MAX_ORG_NAME_LENGTH = 120;/);
  assert.match(source, /const name = body\.name\.trim\(\);/);
  assert.match(source, /name\.length < 1 \|\| name\.length > MAX_ORG_NAME_LENGTH/);
  assert.match(source, /settings\.name = name;/);
});

test("GET and PATCH return the same exact stored name projection", () => {
  assert.ok(stringMembers("SETTINGS_COLUMNS").includes("name"));
  assert.match(source, /\.select\(SETTINGS_COLUMNS\);/);
  assert.match(source, /return Response\.json\(\{ org: updated\[0\] \}, \{ status: 200 \}\);/);
});
