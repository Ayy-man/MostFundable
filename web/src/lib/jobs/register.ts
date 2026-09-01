// Sibling domains integrate by adding exactly one side-effect import here; the
// shared scheduler and drainer remain owned by Phase 14.
import "./handlers/analysis-run.ts";
import "./handlers/derived-purge.ts";
import "./handlers/outcomes-refresh.ts";
import "@/lib/crs/jobs/register";
import "@/lib/revenue/jobs/register";
import "@/lib/kb/jobs/register";
import "@/lib/ancillary/jobs/register";
import "@/lib/admin/jobs/register";
import "@/lib/tenancy/jobs/register";
import "@/lib/vault/jobs/register";

// R5C-02: last, because it reads the handler owner flags every module above has just
// registered and composes onto any cadence a domain already owns.
import { registerRowWindowRediscovery } from "./rediscovery.ts";

registerRowWindowRediscovery();
