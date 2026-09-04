# MostFundable operations runbook

Production evidence checked 2026-09-04: `9d290a3fb01ac5f656179f7946d2f4df9ece1161`. Use the exact candidate commit for every release procedure.

## Release procedure

1. Record the candidate release identifier and review the migration list.
2. Run a clean dependency install, lint, type checks, production build, automated tests, and database tests.
3. Deploy the reviewed release and confirm that the deployment identifies the same release.
4. Apply only reviewed forward migrations, then read back the migration level and affected access controls.
5. Exercise changed workflows with the relevant roles and record sanitized results.
6. Record provider evidence separately from source and deployment evidence.

## Local verification

Install the Supabase CLI and Docker, then start the local stack from the repository root with `supabase start`. From `web/`, run `npm ci`, `npm run build`, and the test commands in the root README. The database-backed end-to-end suites skip with an instruction when the local stack is unavailable; start the stack before treating those checks as exercised.

## Provider boundaries

Configuration must be present and verified before a provider-dependent workflow is declared operational. A simulated or unavailable result is not evidence of a real external action.

## Jobs and scheduled work

For a job-related incident, record the job name, subject reference, time window, attempt, duration, final status, and sanitized error code. Confirm the expected downstream record changed before declaring the workflow healthy.

## Incidents and recovery

Capture the release identifier, affected route or job, role, organization or client reference, date, response status, and sanitized error code. Determine whether an external effect may have occurred before retrying a request. Use the established product workflow and reviewed recovery procedure; do not make unreviewed direct data changes.

## Privacy and data handling

Do not place personal data, private access material, or raw provider payloads in tickets, screenshots, or handover records. Keep only the minimum sanitized evidence needed to establish the result.

## Closure

A release is operationally ready only when source checks, database state, deployment, role-based workflow checks, and any affected provider evidence all relate to the same release identifier. Acceptance is recorded separately.
