# MostFundable MVP status

Production evidence checked 2026-09-04: `9d290a3fb01ac5f656179f7946d2f4df9ece1161`. Review newer source by its exact commit.

## Current source position

This repository contains the MVP application, database migrations through 441, and automated coverage for the included source.

The product supports four roles: consumer, operator, affiliate, and platform administrator. The source includes tenant boundaries, authentication routes, enrollment and consent flows, readiness and funding workflows, client and task management, applications, fee agreements, support, privacy-request intake, affiliate workflows, and administration tools.

## Deployment position

The production alias resolved to Vercel deployment `dpl_G3MPf6UoNLCMUQuUQb2SMhu6RsF5` at commit `9d290a3fb01ac5f656179f7946d2f4df9ece1161` when checked on 2026-09-04. A Ready branch preview does not update that production evidence.

## Evidence boundary

Passing source checks proves the included mechanism and its automated coverage. It does not prove that a provider account is configured, that an external delivery occurred, or that a human acceptance has been recorded.

## Remaining before launch

- Establish and prove production payment processing.
- Product email delivery is live on production through Resend (`mail.mostfundable.com`) since 2026-09-06; one templated send is proven. Watch the first real notification batches in the Resend dashboard.
- Live credit-data operations are proven against the CRS sandbox (`npm run verify:crs-sandbox`: identity, link, verify, close). Production-host proof still needs the production webhook registered.
- Privacy erasure is proven end to end against a local stack (real auth provider, real storage bucket, database completion): run `npm run verify:privacy-erasure` in `web/` with `supabase start` up. The proof leaves its own seeded rows behind, so run `supabase db reset --local` before `supabase test db`, whose seed assertions count rows exactly. Production evidence still needs one run against the hosted project.
- Record monitoring, recovery, and account-ownership evidence.
- Complete production workflow checks for changed high-impact operations.
- Record the agreed walkthroughs and acceptance.

The itemised register of demo-mode behaviours, build gaps, code defects and owner inputs is in [PRE-LAUNCH-FIXES.md](PRE-LAUNCH-FIXES.md). Demo testing continues with those items open.

## Use of this document

Use this status as the current source-release summary. Record future deployment, provider, and acceptance evidence against the exact release it concerns.
