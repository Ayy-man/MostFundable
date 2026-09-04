# Overnight engineering report — 2026-09-04

The worst finding was a high-severity production dependency exposure in the directly installed Next.js version. The same review also found that the clean handover repository had no CI at all, so pushes could reach Vercel without lint, type, build, test, database, or compliance enforcement. This branch updates Next.js and its matched lint configuration from 16.2.10 to 16.3.4, moves the build-only shadcn CLI out of production dependencies, and restores a two-lane GitHub Actions gate.

## Release identity and boundary

- Candidate branch: `overnight-20260904`
- Candidate source before this report-only commit: `55aa487afcbb140ba2ff80c9673a6e32c90c4a06`
- Production evidence checked on 2026-09-04: `9d290a3fb01ac5f656179f7946d2f4df9ece1161`
- Production Vercel deployment checked on 2026-09-04: `dpl_G3MPf6UoNLCMUQuUQb2SMhu6RsF5`

The branch was pushed for CI and preview evidence, but it was not merged or pushed to `main`. No hosted database, Vercel environment variable, key, or production alias was changed. No migration was added, renamed, or edited; the existing migration ceiling remains 433. The source checkout supplied for the task had unrelated uncommitted handover files, so all work was isolated in `.overnight-20260904` and those files were left untouched.

## Engineering changes

**CI and release controls.** `.github/workflows/web-ci.yml` now runs on branch pushes and pull requests. Its source lane runs a clean install, lint, typecheck, production build, the full unit suite, hardening, KB boundaries, report-persistence, environment, source, fee-legal, secret-hygiene, and compliance gates. Its database lane starts a disposable local Supabase stack, rebuilds the schema and seed from empty, runs pgTAP, executes the production-server E2E arms, resets the database, exercises the authenticated affiliate and fee arms, then resets again and runs the mock paid-refresh lifecycle under the non-production server mode that authorizes mock purchasing. It finishes with the combined source/product gate and always stops the stack. The authenticated tests wait for local Auth readiness and read the local-only login fixture from `supabase/seed.sql` at runtime instead of copying it into CI. The missing local invite template was restored because a clean Supabase boot referenced it and failed before any database test could run.

**Chat defects.** The consumer conversation now anchors its first render immediately and reserves smooth scrolling for later message growth, eliminating the visible trip through an older message. Empty durable threads use the message-preview rule rather than falling through to business context. The operator inbox owns a viewport-relative, overflow-contained height at base and desktop breakpoints, so its message pane scrolls inside the frame while the reply box remains in view. The existing consumer height and compact mobile assistant row already matched CO-CHAT-01 and CO-CHAT-02, so they were verified and not redesigned.

**Email contract.** Mock and Resend drivers now run through the same catalog-derived contract. Resend resolves sender context without allowing a transient profile read to invalidate or resend an already accepted durable receipt; malformed sender data still fails closed before the claim. The account-backed arm now runs when both Resend inputs exist and reports the exact missing-input skip otherwise.

**Assistant mock parity.** The consumer KB route's mock responder predated the assistant router, so a mock-mode consumer question failed before grounding with `answer_malformed`. Both assistant entry points now use one deterministic responder that implements the router and grounded-answer schemas. The KB E2E fixture also pins retrieval from `KB_EMBEDDING_DRIVERS` and compares identity with `CONSUMER_KB_IDENTITY`, removing two environment and copied-literal assumptions from the proof.

**Security and source hygiene.** Next.js, its lint configuration, and affected transitive packages were updated. A production-only audit against the freshly populated advisory cache reports zero vulnerabilities. The online recheck later timed out at the registry, so this is dependency-resolution evidence rather than a fresh independent network response. The stricter lint version also exposed five warnings; all were removed without changing user-visible behavior.

**Handover accuracy.** The handover documents no longer describe an internal historical commit as the current release. They bind production statements to the observed production source and deployment, distinguish candidate evidence from promoted evidence, narrow privacy claims to request intake, and describe audit records as reviewable rather than mutable.

## Regression evidence and assertion sources

Every new or changed regression derives its expected behavior from a rule, catalog, route contract, or runtime presentation module rather than copying a value from a reproduction.

| Regression | Pre-fix observation | Assertion source |
| --- | --- | --- |
| Initial chat anchoring | Failed before the fix because initial and resize events shared smooth behavior | `CHAT_SCROLL_BEHAVIOR`; the test also proves the conversation component consumes both rule fields |
| Empty-thread preview | Failed before the fix because the row fell through to `subtitle` | `threadPreview` and `EMPTY_THREAD_PREVIEW`; the test proves the thread list consumes the rule |
| Operator inbox containment | Failed before the fix because the base layout had no viewport-relative height contract | `INBOX_FRAME_CLASS`; the test derives the required base and desktop properties from the shared class rule and proves the inbox consumes it |
| Email driver parity | Failed on the pre-fix Resend driver when a durable accepted receipt met a transient sender-profile error | `EMAIL_TEMPLATE_REGISTRY`, `EmailDriver`, and `EmailReceiptRepository`; the same suite is instantiated for mock and Resend |
| Request-origin E2E helpers | The restored real-stack run failed with `same_origin_required` | Each helper derives `Origin` from the URL it actually calls and adds it only to mutating requests |
| Revenue presentation | The restored real-stack run found a stale hand-written expected object | `revenuePresentation(null)` and `revenuePresentation("failed")`; the test compares their runtime key set and shared labels, then checks their state distinction |
| Mock assistant routing | The restored real-stack run reached the route with an unusable supervisor-shaped response and returned `answer_malformed` | The existing assistant E2E drives the real router and grounding chain; both mock entry points now consume one responder instead of maintaining parallel operation lists |
| KB fixture retrieval and identity | The restored real-stack run first inherited an unstated retrieval selector, then rejected the current identity against a copied historical label | `KB_EMBEDDING_DRIVERS.selector`, `KB_EMBEDDING_DRIVERS.fallback`, and `CONSUMER_KB_IDENTITY` |
| KB held-draft isolation | The restored real-stack run selected a seeded thread that already carried a held draft, so its supposed no-draft baseline was false | The fixture queries the seeded organization for an operator-visible team chat with no held draft instead of copying a thread id |
| KB verifier receipt | The wrapper failed after the verifier grew from 24 to 25 successful assertions | The child verifier's exit status remains authoritative; the wrapper accepts any positive assertion count instead of maintaining a second inventory |
| Authenticated E2E page rendering | The restored real-stack run returned 500 with `DYNAMIC_SERVER_USAGE` because the build classified auth-disabled pages as static before the test enabled auth | The workflow derives its build inputs from the disposable stack's `API_URL` and `ANON_KEY` and builds with the same auth and tenancy flags exercised by the suite |
| Credit-score failure correlation | A random correlation UUID happened to contain a score-like substring, making the redaction test fail despite a safe response | `ROUTE_FAILURE_VOLATILE_FIELDS` supplies the response fields excluded before the test applies score-redaction assertions |
| Job-drainer deadline | A CI run deferred one extra job because the test used a 50 ms wall-clock budget and the runner crossed it between two operations | The test injects clock ticks and derives deferred count from `claimed.length - renewed.length`; renewed and failed ids come from the claimed rows |

The focused chat regression run changed from three failures on the pre-fix tree to 42 passing tests after the fix. The email run finished with 21 passing tests and one explicit missing-key account skip locally. The complete local unit run finished with 3,915 passing, 10 explicit external-arm skips, and no failures; hardening finished 81/81. The compliance rule self-test finished 88,196/88,196 and the repository scan covered 1,346 files with zero unsuppressed findings.

CI run `33842827878` proved 164 pgTAP files and 3,493 assertions from an empty database. Its production-server E2E aggregate reported 30 passes and no failures; affiliate, fees, and paid-refresh were explicit skips there because they run in their correct isolated modes immediately afterwards, while billing operations remained owner-gated. The authenticated affiliate and fee run then passed 2/2 with zero skips, and the isolated mock paid-refresh lifecycle passed 1/1 with zero skips. The final product-gate tail passed 15/15, including seed repeatability, after the E2E resets.

## CI and operational evidence

GitHub Actions run `33833890768` completed both the source and database jobs successfully on `d45465a`. Enabling the real local-stack E2E arms then exposed missing request-origin headers, a stale revenue shape, a wall-clock drainer assertion, the incomplete mock assistant contract, an auth-disabled build being reused for auth-enabled page tests, and a hard-coded KB thread whose seed state contradicted the test baseline. Activating every local E2E arm also exposed a copied KB assertion count and showed that authenticated tests could race the local Auth restart. Each failure was retained as evidence until its rule-derived fix landed. Run `33842827878` is green for both workflow jobs on the functional candidate, and the report-only commit is subject to the same gate rather than being exempted from it.

The local environment could not start Docker, so local pgTAP and local-stack E2E evidence comes from GitHub's disposable Supabase runner. Production was checked read-only: the public URL redirected to sign-in with the expected security headers, and the production alias still identified the older production commit above. A branch preview reached Ready state, but that is preview evidence and is not recorded as production acceptance.

## Worse than the prior documents claimed

- The clean repository had no `.github` directory, so none of the documented checks ran on push.
- A clean local Supabase start referenced an invite template that had not been exported into the repository.
- Several E2E files were present but the restored workflow initially did not execute their local-stack arms; enabling them immediately found stale same-origin request construction and a copied response shape.
- The mock consumer assistant could not route a normal knowledge question, because its responder implemented grounding but not the router operation that runs first.
- The E2E build and child server used different auth feature states, so signed-in page checks failed with `DYNAMIC_SERVER_USAGE` while their API-only neighbors passed.
- The direct framework dependency carried high-severity advisories even though the handover materials presented the source as release-ready.
- The handover documents attached current claims to an internal historical commit, overstated privacy completion, and described audit records as manageable despite their append-only operating model.
- The restored workflow emits one GitHub annotation because `supabase/setup-cli@v1` still declares the deprecated Node 20 action runtime; GitHub forced that action onto Node 24 and the database job passed, but the upstream action metadata remains stale.

## Deliberate non-changes and remaining owner inputs

Actual browser geometry at 1440×900 and 390×844 could not be observed in this runtime: the in-app browser control was unavailable and isolated headless Chrome exited without a debug port. The chat repairs therefore have source-level and rule-derived regression evidence, but no claimed visual-browser acceptance. Client-facing wording, view structure, labels, and control placement were not changed.

Stripe, live Resend, credit-data provider operations, production monitoring, and owner acceptance still require Alec's accounts, keys, or approval. The Resend account arm is ready to execute when its two inputs are present, but no key was added or changed. Full privacy erasure and export, operator pagination, payout and refund operations, usage metering, impersonation, recurring billing semantics, and new administration surfaces require product, legal, or UX decisions and would exceed the frozen frontend. Manual stage-transition policy, scheduled job cadence, provider replay semantics, and support-message enforcement likewise need an owner contract rather than an inferred code change.

The existing activity-timeline behavior, ancillary feature-flag behavior, and demo quick-sign-in path are pinned by current product decisions or tests, so they were not silently reinterpreted. No attempt was made to replace missing external observability or throttling infrastructure with process-local state that would be unreliable on serverless instances.

The internal workflow's historical demo-document verifier was not copied. The clean client repository does not contain the 506-line `MILESTONE2-DEMO.md` it verifies, and the internal copy identifies itself as superseded while naming internal-only planning paths. Importing that document to make the old scanner pass would publish stale internal procedure rather than protect the shipped client tree.
