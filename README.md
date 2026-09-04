# MostFundable

MostFundable is a multi-tenant funding-readiness application for consumers, operator teams, affiliates, and platform administrators. This repository contains the application, database migrations, tests, runtime configuration templates, and current operating documents. Identify a source review with `git rev-parse HEAD`; the production alias was last verified at commit `9d290a3fb01ac5f656179f7946d2f4df9ece1161` on 2026-09-04, so a newer branch or preview is candidate evidence rather than production evidence.

## What is built

The application includes authentication and role routing, tenant-scoped workspaces, consumer enrollment and consent records, readiness and funding workflows, operator client management, tasks, applications, fee agreements, privacy-request intake, affiliate access, and platform administration. The included migration set reaches version 433 and contains the corresponding database tests.

## Run locally

Use Node.js 22 or newer. Copy `web/.env.example` to `web/.env.local`, add only values issued for your own environment, then run:

```bash
cd web
npm ci
npm run dev
```

For local database work, start the Supabase stack from the repository root, then run `npm run demo:reset` from `web/`. Do not use sample access outside an approved local environment.

## Verify

```bash
cd web
npm run lint
npm run typecheck
npm run build
npm test
npm run test:hardening
npm run test:e2e
npm run test:gates
cd ..
supabase test db
```

## Before launch

The source release is ready for review. Production payment processing, product email delivery, live credit-data operations, monitoring, account ownership confirmation, and recorded acceptance still need their own evidence before launch.

## Handover documents

- [Build map](docs/handover/build-map.mermaid)
- [MVP status](docs/handover/MVP-STATUS.md)
- [Scope and acceptance](docs/handover/MVP-SCOPE-AND-ACCEPTANCE.md)
- [Asks and decisions](docs/handover/ASKS-AND-DECISIONS.md)
- [Admin guide](docs/handover/admin-guide.md)
- [Operations runbook](docs/handover/ops-runbook.md)
