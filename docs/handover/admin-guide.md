# MostFundable admin guide

Production evidence checked 2026-09-04: `9d290a3fb01ac5f656179f7946d2f4df9ece1161`. Use the exact promoted commit during an operational review.

## Roles and boundaries

Platform administrators work across operator organizations. Operators work only within their organization, affiliates see only their assigned leads, and consumers see only their own workspace. Confirm the organization and client context before every update.

## Administration

Platform administrators can manage operator organizations, reference data, training content, support requests, privacy requests, approved settings, and review audit records. Operators can manage clients, tasks, applications, outcomes, fee agreements, team membership, affiliates, and workspace settings.

## Safe operating practice

Confirm the selected client before saving a change, reload after high-impact updates, and preserve a sanitized outcome record for acceptance work. Internal notes and client-visible messages have different audiences and must remain separate.

Use normal product workflows for changes. Do not use direct database changes to imitate a completed workflow or to bypass an unavailable state.

## Provider-dependent work

Some workflows need configured external services before they can be treated as complete. An unavailable state is preferable to an unverified result. Follow the operations runbook when enabling or checking a provider-dependent workflow.

## Escalation

For an incident or acceptance question, record the release identifier, date, affected role, workflow, and sanitized result. Use the scope document for acceptance boundaries and the operations runbook for release and recovery procedures.
