# Fix before proper launch

Release: `9d290a3fb01ac5f656179f7946d2f4df9ece1161`
Measured against the live deployment on 2026-09-02 by signing in as all four roles and reading the responses. Line references are to this repository.

The deployment is running in a deliberate demo configuration. Every item below is either a demo-mode behaviour that is fine for testing but must change before real money, real email or real credit data flow, or a gap found while mapping the build. Demo testing can continue with all of these open.

## A. Demo-mode behaviours to switch off before launch

| # | What happens today | Why it is acceptable for demo | What must change | Proof |
| --- | --- | --- | --- | --- |
| A1 | Every consumer charge succeeds without a payment provider. The seeded consumer shows an active 49 dollar subscription that was never charged. | Lets the enrollment and activation flow be walked end to end. | Set `BILLING_DRIVER=stripe` with the five Stripe keys and run the enrollment walk against a real test card. Confirm the subscription row carries a real provider reference. | `web/src/lib/billing/mock.ts:213-228`; `web/src/lib/env.ts:87-100`; live `GET /api/enroll` shows `subscription.status: active` |
| A2 | The card step in onboarding stores nothing. The mock setup intent returns no client secret and the browser never sends card digits anywhere. | Nothing sensitive is captured during demos. | Wire the real card capture for the Stripe arm and verify `confirmCard` with an attached payment method. | `web/src/components/onboarding1.tsx:570-598`; `web/src/lib/billing/mock.ts:190-196`; `web/src/lib/billing/stripe.ts:162` unverified |
| A3 | The paid credit refresh is priced and shown but refuses to charge in production until both Stripe and the bureau are live. | Correct fail-closed behaviour. | Follows automatically from A1 plus C1. Verify a 19 dollar refresh purchase once both are on. | `web/src/lib/pricing/paid-refresh-availability.ts:9-17`; live `POST /api/refresh-now` returns 503 |
| A4 | No email leaves the platform. The email driver is unset, so the mock accepts sends without a network call. | No accidental mail to demo addresses. | Set `EMAIL_DRIVER=resend` with the key and sender. Note that only one email exists today, see B3. | `web/src/lib/email/mock-driver.ts:32-57`; `web/src/lib/env.ts:127-132` |
| A5 | The credit bureau runs against the bureau test host. Identity checks and report pulls work there today. | Real end-to-end credit flow without production billing from the bureau. | Point `CRS_BASE_URL` at the production host once the bureau grants access. Only the link exposure behaviour changes between hosts. | `web/src/lib/crs/spec-catalog.ts:12-21`; `web/src/lib/crs/sandbox/driver.ts:81-83` |
| A6 | Quick sign-in buttons for the four demo roles are on. | Needed for demo walkthroughs. | Turn off `FEATURE_DEMO_QUICK_SIGN_IN`, clear `DEMO_QUICK_SIGN_IN_PASSWORD`, and remove or re-password the seeded demo accounts. | `web/src/app/api/auth/quick-sign-in/route.ts:69-79` |
| A7 | The funding plan is produced by the fixed rules engine, not the AI. | Deterministic plans make demos repeatable. | Decide whether launch ships with the rules engine. If the AI plan writer is wanted, its output must first pass `evaluatePlan`, which it does not today. | `web/src/lib/llm/driver.ts:16-31,52-57` |
| A8 | The AI coach answers from six sample articles. | Shows the supervised answer flow safely. | Load real knowledge-base content. The vault-backed source is deliberately blocked until its content has been checked for personal data. | `web/src/lib/kb/fixture-source.ts:6-11`; `web/src/lib/kb/source.ts:30-38,66-69` |

## B. Build gaps found while mapping

| # | Gap | What a user sees today | Fix | Proof |
| --- | --- | --- | --- | --- |
| B1 | The bureau credit monitoring window is not placed in the consumer app. The token endpoint works but no browser code calls it, and no embed exists. | The My Credit panel shows no scores in production. | Build the embed on the My Credit view, then have the bureau register the production web address for the widget. | No non-test caller of `/api/monitoring/token` under `web/src`; only iframe is `web/src/components/consumer/trainings-view.tsx:221`; live `GET /api/monitoring/reading` returns `available: false` |
| B2 | Consumer email notifications have no sender path. The preference exists but is hard-wired unavailable. | Email toggles are off and cannot be turned on. | Build the consumer email dispatcher, then enable the preference. | `web/src/lib/notifications/preferences.ts:15-19` |
| B3 | Only one product email can be sent, the operator card-failure notice. | No invites, receipts or alert emails from the product. Invites come from the sign-in service, receipts would come from Stripe. | Decide which product emails are required for launch and build them. | `web/src/lib/email/templates.ts:19-32`; `web/src/lib/email/matrix.test.ts:35-43` |
| B4 | The operator has no screen for its own platform subscription. The billing routes exist but nothing calls them. | Plan and billing panel says the plan is not readable here. | Wire the subscription, checkout and portal routes into Settings and Billing. | `web/src/components/surfaces/operator.tsx:8988-9003` |
| B5 | The admin lender-news intake queue is empty by construction and its actions write only to the session. | Empty queue with a placeholder message. | Either feed it from a real source or remove it from the launch scope. | `web/src/components/surfaces/admin.tsx:300,1552-1580` |
| B6 | Admin system health tiles are static and read Not monitored. | No live health signal. | Connect real checks once monitoring ownership is decided. | `web/src/components/surfaces/admin.tsx:2745-2775` |
| B7 | Fixed. The operator inbox receives the timeline feature flag. | Upload requests and the conversation timeline appear in the inbox when the flag is on. | Complete. | `web/src/components/surfaces/operator.tsx:9296`; `web/src/components/operator/inbox/inbox-contract.test.ts:104-108` |
| B8 | Sending funding outcomes back to the Vault database has never run against the real project. Target table names come from documents, not the live schema. | Nothing visible. Outbox rows accumulate. | Confirm the destination tables with the Vault owner and run one delivery. | `web/src/lib/applications/writeback.ts:118-134` |
| B9 | Bureau alert delivery is received but registration on the bureau side is unconfirmed. | No credit alerts arrive. | Register the receiver address and credentials with the bureau and prove one alert end to end. | `web/src/app/api/webhooks/crs/route.ts`; `web/src/lib/crs/webhook.ts:41` |

## C. Code defects to fix before real money or real credit pulls

| # | Defect | Risk | Fix | Proof |
| --- | --- | --- | --- | --- |
| C1 | The sandbox driver now declares report retrieval as per-request billing, so the replay-safety check answers from the driver and a retried analysis with a completed pull operation never buys the report again. | Double bureau billing on a retried analysis. | Complete. Re-declare `cached-read` only when CRS gives this account a written replay guarantee. | `web/src/lib/crs/adapter.ts:44-47`; `web/src/lib/analysis/worker.ts:245`; `supabase/migrations/378_r5c04_crs_pull_operations.sql:6-33` |
| C2 | Fixed. Stripe consumer revenue now comes from retained `invoice.paid` evidence for that subscription and month, rather than the configured price. A Stripe subscription with no paid invoice contributes zero and leaves an explicit incomplete marker without discarding other subscriptions. | Revenue share continues when real payments start, with missing receipts visible. | Complete. | `web/src/lib/billing/paid-invoices.ts`; `supabase/migrations/438_paid_invoice_revenue_evidence.sql`; `web/src/lib/revenue/accruals.ts` |
| C3 | Pull caps are bypassed while the ancillary flag is off, and every bypass now logs `PULL_CAP_BYPASSED_FLAG_OFF` with the client UUID and cause. | A flag flip removes a spend limit without warning. | Complete. Fail closed instead if the flag is ever off in production with real pulls. | `web/src/lib/ancillary/pull-caps.ts:19` |
| C4 | Removed. The unsupported daily analysis schedule job is no longer catalogued or accepted by the background-job queue. | Complete. | No further change. | `web/src/lib/jobs/definitions.ts`; `supabase/migrations/436_remove_analysis_schedule_due_job.sql` |
| C5 | Human-typed support messages are not checked for banned compliance language. Only AI drafts and shipped copy are. | An operator can type prohibited claims to a client. | Decide whether to add a warning or a block on operator-authored message bodies. | `supabase/migrations/100_support_threads.sql:167-175` covers drafts only |
| C6 | Manual stage moves have no forward-only rule. An operator can move a client from Onboarding straight to Funded. | Stage reports can be gamed or mis-clicked. | Add an allowed-transition check for manual moves if forward-only is a requirement. | `supabase/migrations/050_tracker_stage_engine.sql:84-256` |

## D. Documentation corrections

- The internal engineering context still says the ancillary flag is empty in production. Measured today it is on. All feature flags are on except the email flag, which is moot while no email driver is set.
- Production env pulls through the Vercel CLI return blanks for sensitive values. A blank in a pulled file is not evidence a flag is off. Measure flags by calling a gated route with a signed-in session.
- The Bank Vault holds 47 lenders live. The repository ships 7 fixture lenders; the 47 come from the nightly sync against the real Vault project.

## E. Inputs owed by the project owner

These are unchanged from ASKS-AND-DECISIONS.md, with two additions found in code.

1. Stripe account and approval to charge real cards.
2. Email provider account and an approved sender address.
3. Bureau production approval, plus registration of the production web address for the monitoring widget and the alert receiver.
4. Final public-facing wording.
5. Monitoring and recovery ownership.
6. Walkthrough dates and written acceptance.
7. Real knowledge-base content for the AI coach, added from this review.
8. A decision on launching with the rules-based plan or waiting for the AI plan writer, added from this review.

## Suggested order

1. Owner inputs 1 to 3, because A1 to A5, B8, B9 and C2 all wait on them.
2. C1 before any production credit pull.
3. B1 before the consumer surface is shown to a paying customer.
4. A6 last, on the day demo access is retired.
