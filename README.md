# MostFundable

MostFundable is a multi-tenant funding-readiness application for consumers, operator teams, affiliates, and platform administrators. This handover repository is a clean export of release `bddb5ca37d2d46402cb5fc8552bba266c24b7979`; it contains the application, database migrations, tests, runtime configuration templates, and the current operating documents.

## What is built

The application includes authentication and role routing, tenant-scoped workspaces, consumer enrollment and consent records, readiness and funding workflows, operator client management, tasks, applications, fee agreements, privacy requests, affiliate access, and platform administration. The included migration set reaches version 433 and contains the corresponding database tests.

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
