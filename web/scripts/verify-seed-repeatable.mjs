#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seedPath = resolve(webRoot, "../supabase/seed.sql");
const seed = readFileSync(seedPath, "utf8")
  .replace(/^\s*begin;\s*/i, "")
  .replace(/\s*commit;\s*$/i, "");

const cardinalityProof = String.raw`
do $seed_gate$
begin
  if (select count(*) from public.orgs where id in (
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001'
  )) <> 3 then raise exception 'SEED_REPEAT_ORG_CARDINALITY'; end if;

  if (select count(*) from public.profiles where id::text ~ '^(00000000|a1000000|b1000000)-') <> 10
  then raise exception 'SEED_REPEAT_PROFILE_CARDINALITY'; end if;

  if (select count(*) from public.affiliates where id = 'a2000000-0000-0000-0000-000000000001') <> 1
  then raise exception 'SEED_REPEAT_AFFILIATE_CARDINALITY'; end if;

  if (select count(*) from public.clients where id::text ~ '^[ab]3000000-') <> 5
  then raise exception 'SEED_REPEAT_CLIENT_CARDINALITY'; end if;
end
$seed_gate$;
`;

const sql = `begin;\n${seed}\n${seed}\n${cardinalityProof}\nrollback;\n`;
const result = spawnSync(
  "docker",
  [
    "exec", "-i", "supabase_db_mostfundable", "psql", "-U", "postgres",
    "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-q",
  ],
  { cwd: resolve(webRoot, ".."), encoding: "utf8", input: sql, maxBuffer: 16 * 1024 * 1024 },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

process.stdout.write("seed repeatability: PASS (two applications; orgs=3 profiles=10 affiliates=1 clients=5; rolled back)\n");
