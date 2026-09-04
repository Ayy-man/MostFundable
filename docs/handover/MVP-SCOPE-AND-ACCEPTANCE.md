# MVP scope and acceptance

Production evidence checked 2026-09-04: `9d290a3fb01ac5f656179f7946d2f4df9ece1161`. Review newer source by its exact commit.

## Included product scope

| Area | Source position | Acceptance evidence still needed |
| --- | --- | --- |
| Authentication and role routing | Included | Sign-in and role checks in the intended environment |
| Tenant-scoped workspaces | Included | Tenant-boundary checks in the intended environment |
| Enrollment, permissions, and agreements | Included | End-to-end workflow evidence |
| Readiness, plans, and tracking | Included | Live data-operation evidence where applicable |
| Operator workflows | Included | Creation and lifecycle evidence for changed workflows |
| Applications and fee agreements | Included | Production workflow evidence |
| Support messaging, privacy-request intake, and notifications | Included | Delivery and end-to-end erasure evidence |
| Administration and affiliates | Included | Role and lifecycle evidence |

## Acceptance approach

For each item being accepted, retain the release identifier, date, responsible person, exercised workflow, and a sanitized outcome record. A source check, deployment, provider interaction, and human acceptance are separate forms of evidence.

## Current boundaries

The repository does not claim that payment processing, product email delivery, live credit-data operations, monitoring, end-to-end privacy erasure, or recorded acceptance are complete. Features outside the agreed MVP scope should be assessed separately before work begins.

## Inputs still required

The project owner needs to confirm the provider accounts and access needed for production operation, approve final public-facing content, designate operating ownership, and record acceptance after the walkthroughs.
