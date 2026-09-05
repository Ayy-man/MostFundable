# Email templates

One file per provider template id in `web/src/lib/email/templates.ts`. Run `RESEND_API_KEY=... node web/scripts/publish-resend-templates.mjs` (add `--dry-run` first) to create or update and publish them in Resend under these aliases (subjects below), or paste each file by hand; the consumer templates take the two variables the driver sends, `FIRST_NAME` and `APP_PATH`, in Resend's triple-brace syntax. `operator-card-failure` takes none. Copy is the registry's copy verbatim, plus the fixed footer; nothing in a message names a score, an outcome or a promise.

| Template | Subject |
| --- | --- |
| `consumer-monitoring-alert` | There is a new credit alert on your account |
| `consumer-stage-change` | Your funding journey moved to a new stage |
| `consumer-analysis-complete` | Your plan is ready |
| `consumer-refresh-result` | Your refresh has finished |
| `consumer-enrollment-milestone` | You completed an onboarding step |
| `consumer-document` | A new document is on your account |
| `consumer-team-message` | Your team sent you a message |
| `consumer-application-update` | There is an update on one of your applications |
| `operator-card-failure` | A payment for your workspace did not go through |

Links point at `https://app.mostfundable.com` + `APP_PATH`; change the host in every file if production lives elsewhere.
