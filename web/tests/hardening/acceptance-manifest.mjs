export const ACCEPTANCE_STATES = Object.freeze([
  "OPEN",
  "PASS",
  "FAIL",
  "SKIPPED-MISSING-KEY",
  "UNVERIFIED-FOR-ACCOUNT",
  "BLOCKED-BY-SIGN-OFF",
]);

export const stateMachines = Object.freeze([
  {
    id: "consent-cancel-purge",
    packetNames: ["consent", "cancel", "purge"],
    ownerPhase: "03-enrollment",
    availability: "early",
    source: {
      path: "src/lib/enrollment/service.ts",
      symbols: ["revokeConsent", "cancelEnrollment"],
    },
    legalCases: [
      "consent-grant",
      "consent-revoke-latest",
      "consent-revoke-replay",
      "cancel-first-call",
      "cancel-replay",
      "cancel-subscription-effect",
      "purge-after-due",
      "purge-retry-terminal",
    ],
    illegalCases: [
      "consent-cross-tenant",
      "consent-stale-authority",
      "cancel-unauthorized-actor",
      "purge-before-due",
      "purge-cross-tenant",
    ],
    unitCommand: "npm run test:hardening",
    sqlProof: "../supabase/tests/160_hardening_state_machines.test.sql",
    e2eProof: "npm run test:e2e",
    openDependency: "purge production seam is not present on the EARLY base",
    initialStatus: "OPEN",
  },
  {
    id: "enrollment",
    packetNames: ["enrollment"],
    ownerPhase: "03-enrollment",
    availability: "early",
    source: {
      path: "src/lib/enrollment/machine.ts",
      symbols: ["nextState"],
    },
    states: ["pending", "sms_sent", "quiz", "retry", "passed", "locked"],
    events: [
      "idv_start",
      "idv_code_correct",
      "idv_code_wrong",
      "idv_answer_correct",
      "idv_answer_wrong",
      "cancel",
    ],
    legalCases: [
      "pending-idv-start",
      "sms-code-pass",
      "sms-code-to-quiz",
      "quiz-answer-pass",
      "retry-answer-lock",
      "cancel-precedence",
    ],
    illegalCases: [
      "terminal-event-stable",
      "wrong-event-stable",
      "stale-rpc-call",
    ],
    unitCommand: "npm run test:hardening",
    sqlProof: "../supabase/tests/160_hardening_state_machines.test.sql",
    e2eProof: "npm run test:e2e",
    openDependency: null,
    initialStatus: "OPEN",
  },
  {
    id: "billing-dunning",
    packetNames: ["billing dunning"],
    ownerPhase: "10-billing",
    availability: "early",
    source: {
      path: "src/lib/billing/operator-ladder.ts",
      symbols: ["deriveBillingSignal", "nextMembership"],
    },
    legalCases: ["paid-current", "failed-past-due", "retry-exhausted-grace", "deleted-deactivated"],
    illegalCases: ["duplicate-event", "stale-event", "unknown-status"],
    unitCommand: "npm run test:hardening",
    sqlProof: "../supabase/tests/160_hardening_state_machines.test.sql",
    e2eProof: "npm run test:e2e",
    openDependency: null,
    initialStatus: "OPEN",
  },
  {
    id: "outcome-recompute",
    packetNames: ["outcome recompute"],
    ownerPhase: "11-applications",
    availability: "early",
    source: {
      path: "src/lib/applications/worker.ts",
      symbols: ["drainOutcomeRefreshJobs"],
    },
    legalCases: ["empty-queue", "bounded-success", "retry", "attempts-exhausted"],
    illegalCases: ["lease-lost", "invalid-iterations", "wrong-worker"],
    unitCommand: "npm run test:hardening",
    sqlProof: "../supabase/tests/160_hardening_state_machines.test.sql",
    e2eProof: "npm run test:e2e",
    openDependency: "Phase 14 scheduler registration is a LATE seam",
    initialStatus: "OPEN",
  },
]);

const lateSeam = (id, ownerPhase, source, symbols, legalCases, illegalCases, proofCommand) => ({
  id,
  ownerPhase,
  availability: "late",
  source: { path: source, symbols },
  legalCases,
  illegalCases,
  proofCommand,
  initialStatus: "PASS",
});

export const lateStateSeams = Object.freeze([
  lateSeam(
    "background-job-drainer",
    "14-revenue",
    "src/lib/jobs/drainer.ts",
    ["drainJobs", "enqueueDueJobs"],
    ["queued-to-succeeded", "queued-to-skipped", "failure-to-retry", "attempt-three-terminal"],
    ["unregistered-handler-terminal", "cadence-owner-mismatch", "invalid-tuple"],
    "npm test -- src/lib/jobs",
  ),
  lateSeam(
    "revenue-accrual",
    "14-revenue",
    "src/lib/revenue/accruals.ts",
    ["runBillingAccrual"],
    ["monthly-accrual", "twelve-referral-windows", "replay-skipped"],
    ["invalid-subject", "invalid-window", "real-provider-incomplete"],
    "npm test -- src/lib/revenue",
  ),
  lateSeam(
    "consumer-referral",
    "15-referrals",
    "src/lib/referrals/service.ts",
    ["createReferralService"],
    ["created-to-clicked", "clicked-to-converted", "conversion-replay"],
    ["platform-source-refused", "invalid-token", "wrong-platform-destination"],
    "npm test -- src/lib/referrals",
  ),
  lateSeam(
    "kb-reimport",
    "16-kb",
    "src/lib/kb/job.ts",
    ["createVaultReimportKbHandler", "runVaultReimportKb"],
    ["fixture-import-ok", "same-window-skipped"],
    ["invalid-subject", "invalid-window", "source-failure"],
    "npm test -- src/lib/kb",
  ),
  lateSeam(
    "ancillary-dispatch-purge",
    "17-ancillary",
    "src/lib/ancillary/notifications.ts",
    ["runNotificationDispatch", "runUploadedReportPurge"],
    ["dispatch-ok", "dispatch-replay-skipped", "upload-purged"],
    ["invalid-job-key", "storage-still-present", "terminal-upload-skipped"],
    "npm test -- src/lib/ancillary",
  ),
  lateSeam(
    "paid-refresh",
    "18-paid-refresh",
    "src/lib/pricing/paid-refresh.ts",
    ["createPaidRefresh"],
    ["payment-before-enqueue", "durable-replay", "analysis-linked"],
    ["dependency-disabled", "cap-denied", "non-success-payment"],
    "npm test -- src/lib/pricing",
  ),
]);

const job = (name, handler, status, rationale) => ({ name, handler, status, rationale });

export const jobReconciliation = Object.freeze([
  job("crs.alert_batch", null, "OPEN", "No registered handler exists; IA-19-01 forbids guessing a load target."),
  job("analysis.run", "src/lib/jobs/handlers/analysis-run.ts#createAnalysisRunHandler", "PASS", "Registered by the shared Phase 14 registry."),
  job("billing.accruals", "src/lib/revenue/accruals.ts#runBillingAccrual", "PASS", "Registered with a monthly cadence provider."),
  job("outcomes.refresh_stats", "src/lib/jobs/handlers/outcomes-refresh.ts#createOutcomesRefreshHandler", "PASS", "Registered by the shared Phase 14 registry."),
  job("vault.sync_banks", "src/lib/vault/jobs/sync-banks.ts#runVaultSyncBanksJob", "PASS", "Registered by the shared Phase 14 registry with a nightly global cadence provider, both gated on FEATURE_VAULT."),
  job("vault.reimport_kb", "src/lib/kb/job.ts#runVaultReimportKb", "PASS", "Registered with an ISO-week cadence provider."),
  job("purge.derived", "src/lib/jobs/handlers/derived-purge.ts#runDerivedPurge", "PASS", "Registered by the shared registry with provider-close-first retry handling, plus the R4D-03 daily rediscovery provider that outlives a tuple's attempt cap."),
  job("purge.uploaded_reports", "src/lib/ancillary/purge.ts#runUploadedReportPurge", "PASS", "Registered with a daily target provider."),
  job("notifications.dispatch", "src/lib/ancillary/notifications.ts#runNotificationDispatch", "PASS", "Registered with the notification-outbox bridge."),
  job("tenancy.trial_expiry", "src/lib/tenancy/jobs/trial-expiry.ts#runTrialExpiry", "PASS", "Registered by the tenancy provider with a daily global UTC-date cadence."),
  job("kpi.rollup", null, "OPEN", "The catalog key has no merged handler or cadence provider."),
]);

const matrix = (file, domain) => ({ file: `../supabase/tests/${file}`, domain });

export const databaseMatrices = Object.freeze([
  matrix("001_platform_tenancy_rls.test.sql", "platform-tenancy"),
  matrix("002_enrollment_foundation_rls.test.sql", "enrollment-foundation"),
  matrix("003_analysis_tracker_rls.test.sql", "analysis-tracker"),
  matrix("004_seed_isolation.test.sql", "seed-isolation"),
  matrix("01x_bootstrap_test.sql", "auth-bootstrap"),
  matrix("01x_org_settings_policy_test.sql", "org-settings"),
  matrix("020_enrollment_hardening_test.sql", "enrollment-hardening"),
  matrix("021_enrollment_tables_test.sql", "enrollment-tables"),
  matrix("022_billing_tables_test.sql", "consumer-billing"),
  matrix("024_enrollment_begin_rpc_test.sql", "enrollment-rpc"),
  matrix("030_analysis_jobs.test.sql", "analysis-jobs"),
  matrix("050_tracker_stage_engine.sql", "tracker"),
  matrix("070_operator_billing_test.sql", "operator-billing"),
  matrix("071_operator_billing_rpc_test.sql", "operator-billing-rpc"),
  matrix("072_operator_seat_sync_test.sql", "operator-seat-sync"),
  matrix("073_billing_isolation_test.sql", "billing-isolation"),
  matrix("080_applications_outcomes.test.sql", "applications-outcomes"),
  matrix("081_outcome_stats_writeback.test.sql", "outcome-recompute"),
  matrix("090_org_legal_flags_test.sql", "fee-legal-flags"),
  matrix("091_fees_core_test.sql", "fees-core"),
  matrix("092_fees_rpcs_test.sql", "fees-rpc"),
  matrix("093_fees_client_autocreate_test.sql", "fees-client-create"),
  matrix("100_support_threads.test.sql", "support-threads"),
  matrix("101_support_send_guard.test.sql", "support-send-guard"),
  matrix("102_support_reads.test.sql", "support-reads"),
  matrix("103_support_consumer_thread.test.sql", "support-consumer"),
  matrix("110_revenue_ledgers.test.sql", "revenue-ledgers"),
  matrix("111_background_jobs.test.sql", "background-jobs"),
  matrix("120_consumer_referrals.test.sql", "referrals-tenancy"),
  matrix("130_kb_articles.test.sql", "kb-articles"),
  matrix("131_kb_search_service_role.test.sql", "kb-search-service-role"),
  matrix("140_ancillary_enum_extensions.test.sql", "ancillary-enums"),
  matrix("141_ancillary_trainings_uploads_caps.test.sql", "ancillary-trainings-caps"),
  matrix("142_ancillary_notifications_exports.test.sql", "ancillary-notifications-exports"),
  matrix("150_paid_refresh_enum.test.sql", "paid-refresh-enum"),
  matrix("151_paid_refresh_payments.test.sql", "paid-refresh-payments"),
  matrix("160_hardening_state_machines.test.sql", "hardening-cross-machine"),
  matrix("190_console_client_health_archive.test.sql", "console-client-health-archive"),
  matrix("191_console_training_controls.test.sql", "console-training-controls"),
  matrix("220_email_delivery.test.sql", "email-delivery"),
  matrix("210_affiliate_mutations.test.sql", "affiliate-mutations"),
  matrix("211_affiliate_enrollment_attribution.test.sql", "affiliate-enrollment-attribution"),
  matrix("200_admin_settings_prompts.test.sql", "admin-settings-prompts"),
  matrix("201_admin_analytics.test.sql", "admin-analytics"),
  matrix("170_tenancy_lifecycle.test.sql", "tenancy-lifecycle"),
  matrix("171_tenancy_invites_brand.test.sql", "tenancy-invites-brand"),
  matrix("231_tenancy_slug_guard_self_upsert.test.sql", "tenancy-slug-guard-self-upsert"),
  matrix("230_billing_ops_client_cap.test.sql", "billing-ops-client-cap"),
  matrix("181_billing_ops_settlement_refunds.test.sql", "billing-ops-settlement-refunds"),
  matrix("232_background_job_claim_by_id.test.sql", "background-job-claim-by-id"),
  matrix("241_enrollment_write_boundary.test.sql", "enrollment-write-boundary"),
  matrix("243_append_only_truncate_guards.test.sql", "append-only-truncate-guards"),
  // 2026-08-17 Round 1 pass 2: carry every new database regression into the complete matrix.
  matrix("250_stripe_webhook_claim.test.sql", "stripe-webhook-claim"),
  matrix("251_background_job_lease_reclaim.test.sql", "background-job-lease-reclaim"),
  matrix("252_targeted_analysis_claim.test.sql", "targeted-analysis-claim"),
  matrix("253_refund_running_max.test.sql", "refund-running-max"),
  matrix("254_paid_refresh_cap_reservations.test.sql", "paid-refresh-cap-reservations"),
  matrix("255_outcome_fee_basis_atomic.test.sql", "outcome-fee-basis-atomic"),
  matrix("256_upload_purge_analysis_atomic.test.sql", "upload-purge-analysis-atomic"),
  matrix("257_enrollment_activation_analysis_atomic.test.sql", "enrollment-activation-analysis-atomic"),
  matrix("258_operator_billing_equal_timestamp.test.sql", "operator-billing-equal-timestamp"),
  // 2026-08-17 Round 1 pass 3: carry every new database regression into the complete matrix.
  matrix("260_cancellation_consent_purge_rails.test.sql", "cancellation-consent-purge-rails"),
  matrix("263_parse_failure_purge_state.test.sql", "parse-failure-purge-state"),
  matrix("264_prompt_activation_evidence_gate.test.sql", "prompt-activation-evidence-gate"),
  // 2026-08-17 Round 2 pass 1: carry every new database regression into the complete matrix.
  matrix("270_r2a01_bootstrap_binding_boundary.test.sql", "tenant-binding-bootstrap"),
  matrix("272_r2a07_stage_history_write_boundary.test.sql", "stage-history-rpc-only"),
  matrix("273_r2a09_audit_write_boundary.test.sql", "audit-rpc-only"),
  matrix("274_r2a10_disabled_affiliate_view.test.sql", "affiliate-profile-status"),
  matrix("275_r2a11_disabled_definer_callers.test.sql", "definer-profile-status"),
  matrix("276_r2a12_public_org_projection.test.sql", "org-brand-view"),
  matrix("278_tenant_write_wall.test.sql", "tenant-write-wall"),
  // 2026-08-17 Round 2 pass 2: carry every new database regression into the complete matrix.
  matrix("280_r2c07_seat_sync_generation.test.sql", "operator-seat-sync-generation"),
  matrix("281_r2c06_subscription_creation_intent.test.sql", "subscription-creation-intent"),
  matrix("282_r2c05_paid_refresh_payment_attempt.test.sql", "paid-refresh-payment-attempt"),
  matrix("283_r2c04_refund_attribution.test.sql", "refund-attribution"),
  matrix("284_r2c11_enrollment_settlement_review.test.sql", "enrollment-settlement-review"),
  matrix("285_r2a03_paid_refresh_cap_recovery.test.sql", "paid-refresh-cap-recovery"),
  // 2026-08-17 Round 2 pass 3: carry every new database regression into the complete matrix.
  matrix("290_r2c02_job_owner_allowlist.test.sql", "job-owner-allowlist"),
  matrix("291_r2c08_targeted_outcome_claim.test.sql", "targeted-outcome-claim"),
  matrix("292_r2a05_paid_refresh_purge_links.test.sql", "paid-refresh-purge-links"),
  matrix("293_r2a06_latest_consent_authorization.test.sql", "latest-consent-authorization"),
  matrix("294_r2a08_persistence_authorization_recheck.test.sql", "analysis-persistence-authorization"),
  matrix("295_r2d07_monitoring_authorization.test.sql", "monitoring-authorization"),
  matrix("296_r2c13_cancellation_subscription_order.test.sql", "cancellation-subscription-order"),
  // 2026-08-17 Round 2 pass 4: carry prompt evidence provenance into the complete matrix.
  matrix("300_r2d04_prompt_eval_policy.test.sql", "prompt-evaluation-policy"),
  // 2026-08-17 Round 3 (integrator): register the round-3 pgTAP files. Passes 1-3 ran a
  // focused gate that does not execute the hardening suite, so the twenty new files
  // landed unmapped and verify-rls-matrix.mjs --inventory reported FAIL.
  matrix("310_r3a00_governed_write_helpers.test.sql", "governed-write-helpers"),
  matrix("311_r3a02_outcome_insert_authority.test.sql", "outcome-insert-authority"),
  matrix("312_r3a08_outcome_erasure_guards.test.sql", "outcome-erasure-guards"),
  matrix("313_r3a04_client_delete_authority.test.sql", "client-delete-authority"),
  matrix("314_r3a01_fee_basis_write_guard.test.sql", "fee-basis-write-guard"),
  matrix("315_r3a10_fee_attribution_guards.test.sql", "fee-attribution-guards"),
  matrix("316_r3a05_client_insert_normalizer.test.sql", "client-insert-normalizer"),
  matrix("317_r3a03_application_identity_guard.test.sql", "application-identity-guard"),
  matrix("318_r3a09_application_note_actor_guard.test.sql", "application-note-actor-guard"),
  matrix("319_r3a06_client_cap_read_authority.test.sql", "client-cap-read-authority"),
  matrix("320_r3a07_workspace_fee_read_policies.test.sql", "workspace-fee-read-policies"),
  matrix("330_r3c03_paid_consumer_activation.test.sql", "paid-consumer-activation"),
  matrix("331_r3c09_consumer_subscription_events.test.sql", "consumer-subscription-events"),
  matrix("332_r3c04_consumer_subscription_attempt.test.sql", "consumer-subscription-attempt"),
  matrix("333_r3c01_authoritative_seat_target.test.sql", "authoritative-seat-target"),
  matrix("334_r3c08_incomplete_settlement_guard.test.sql", "incomplete-settlement-guard"),
  matrix("335_r3c06_expired_checkout_intent.test.sql", "expired-checkout-intent"),
  matrix("336_r3c07_background_job_lease_renewal.test.sql", "background-job-lease-renewal"),
  matrix("337_r3c02_advance_paid_refresh_payment.test.sql", "advance-paid-refresh-payment"),
  matrix("338_r3d03_bind_prompt_evaluation_identity.test.sql", "prompt-evaluation-identity"),
  matrix("350_r4a01_evidence_erasure_boundary.test.sql", "evidence-erasure-boundary"),
  matrix("351_r4a02_application_write_actor_kind.test.sql", "application-write-actor-kind"),
  matrix("353_r4a08_idv_transition_pairs.test.sql", "idv-transition-pairs"),
  matrix("354_r4c07_provider_cancel_intent.test.sql", "provider-cancel-intent"),
  matrix("355_r4a04_r4c08_settlement_gate.test.sql", "settlement-gate"),
  matrix("356_r4c08_attempt_claim_authority.test.sql", "attempt-claim-authority"),
  matrix("357_r4d03_derived_purge_rediscovery.test.sql", "derived-purge-rediscovery"),
  matrix("358_r4c09_operator_intent_review.test.sql", "operator-intent-review"),
  matrix("370_r5c02_row_window_job_rediscovery.test.sql", "row-window-job-rediscovery"),
  matrix("371_r5d01_provider_cancel_purge_target.test.sql", "provider-cancel-purge-target"),
  matrix("372_r5c06_stale_operator_intents.test.sql", "stale-operator-intents"),
  matrix("373_r5d01_provider_cancel_settle_guard.test.sql", "provider-cancel-settle-guard"),
  matrix("374_r5a01_erasure_boundary_predicate.test.sql", "erasure-boundary-predicate"),
  matrix("375_r5a02_idv_session_client_anchor.test.sql", "idv-session-client-anchor"),
  matrix("377_r5c01_paid_refresh_unfulfillable.test.sql", "paid-refresh-unfulfillable"),
  matrix("378_r5c04_crs_pull_operations.test.sql", "crs-pull-operations"),
  matrix("379_kpi_subject_uuid_shape.test.sql", "kpi-subject-uuid-shape"),
  matrix("381_banks_cache.test.sql", "bank-vault-cache"),
  matrix("383_applications_bank_ref_fk.test.sql", "bank-vault-application-key"),
  matrix("384_bank_read_model_reconciliation.test.sql", "bank-vault-reconciliation"),
  matrix("384_support_realtime_publication.test.sql", "support-realtime-publication"),
  matrix("385_support_internal_notes.test.sql", "support-internal-notes"),
  matrix("386_support_thread_reads.test.sql", "support-thread-reads"),
  matrix("387_assistant_conversations.test.sql", "assistant-conversations"),
  matrix("388_support_welcome_on_activation.test.sql", "support-welcome-on-activation"),
  matrix("390_tenancy_email_null_org.test.sql", "tenancy-email-null-org"),
  matrix("391_consumer_checklist_reporting.test.sql", "consumer-checklist-reporting"),
  matrix("392_demo_reset_consumer_workspace.test.sql", "demo-reset-consumer-workspace"),
  matrix("393_support_counterpart_read_receipt.test.sql", "support-counterpart-read-receipt"),
  matrix("394_consumer_notification_reads.test.sql", "consumer-notification-reads"),
  matrix("395_consumer_notification_reads_tenant_wall.test.sql", "consumer-notification-reads-tenant-wall"),
  matrix("396_document_requests.test.sql", "timeline-document-requests"),
  matrix("397_document_reviews.test.sql", "timeline-document-reviews"),
  matrix("398_client_assignment_history.test.sql", "timeline-client-assignments"),
  matrix("400_crs_alert_pointer_storage.test.sql", "crs-alert-pointer-storage"),
  matrix("401_alec_flat_fee_funding_trigger.test.sql", "flat-fee-funding-trigger"),
  matrix("402_consent_revocation_realtime.test.sql", "consent-revocation-realtime"),
  matrix("403_active_client_receivables.test.sql", "active-client-receivables"),
  matrix("404_stage_history_initial_backfill.test.sql", "stage-history-backfill"),
  matrix("405_support_inbox_audiences.test.sql", "support-inbox-audiences"),
  matrix("406_outcome_client_funding_projection.test.sql", "client-funding-projection"),
  matrix("407_reauthorization_purge_guard.test.sql", "reauthorization-purge-guard"),
  matrix("408_operator_tasks.test.sql", "operator-tasks"),
  matrix("409_consumer_consent_reauthorization.test.sql", "consumer-consent-reauthorization"),
  matrix("410_org_portal_preferences.test.sql", "org-portal-preferences"),
  matrix("411_consumer_profile_self_service.test.sql", "consumer-profile-self-service"),
  matrix("412_platform_training_source_attachments.test.sql", "platform-training-source-attachments"),
  matrix("413_consumer_notification_preferences.test.sql", "consumer-notification-preferences"),
  matrix("414_client_invites.test.sql", "client-invites"),
  matrix("416_consumer_privacy_requests.test.sql", "consumer-privacy-requests"),
  matrix("417_fee_agreement_void_lifecycle.test.sql", "fee-agreement-void-lifecycle"),
  matrix("418_affiliate_lifecycle_and_statements.test.sql", "affiliate-lifecycle-statements"),
  matrix("419_operator_member_role_updates.test.sql", "operator-member-role-updates"),
  matrix("420_admin_bank_catalog.test.sql", "admin-bank-catalog"),
  matrix("423_consumer_notification_delivery_enforcement.test.sql", "consumer-notification-delivery-enforcement"),
  matrix("430_operator_client_notes.test.sql", "operator-client-notes"),
  matrix("431_paid_refresh_single_outstanding_purchase.test.sql", "paid-refresh-single-outstanding-purchase"),
  matrix("432_workspace_identity_brand.test.sql", "workspace-identity-brand"),
  matrix("433_hardening_task_archived_client.test.sql", "operator-task-archived-client"),
  matrix("434_consumer_notification_email.test.sql", "consumer-notification-email"),
  matrix("435_plan_narrative.test.sql", "plan-narrative"),
  matrix("438_paid_invoice_revenue_evidence.test.sql", "paid-invoice-revenue-evidence"),
  matrix("439_derived_features_v2.test.sql", "derived-features-v2"),
  matrix("440_consumer_event_notification_rows.test.sql", "consumer-event-notification-rows"),
  matrix("441_manual_stage_transitions.test.sql", "manual-stage-transitions"),
]);

export const RATIFIED_FLAG_ORDER = Object.freeze([
  "FEATURE_REAL_AUTH",
  "FEATURE_ENROLLMENT",
  "FEATURE_ANALYSIS",
  "FEATURE_TRACKER",
  "FEATURE_BILLING",
  "FEATURE_VAULT",
  "FEATURE_SUPPORT",
  "FEATURE_APPLICATIONS",
  "FEATURE_FEES",
  "FEATURE_REFERRALS",
  "FEATURE_REVENUE",
  "FEATURE_KB",
  "FEATURE_ANCILLARY",
  "FEATURE_PAID_REFRESH",
  "FEATURE_CONSOLE_OPS",
  "FEATURE_EMAIL",
  "FEATURE_AFFILIATES",
  "FEATURE_ADMIN",
  "FEATURE_TENANCY",
  "FEATURE_BILLING_OPS",
  "FEATURE_TIMELINE",
  "FEATURE_DEMO_QUICK_SIGN_IN",
]);

const flag = (name, owner, availability, activation, mockBoundary, smokeSeam, prerequisites = []) => ({
  name,
  owner,
  availability,
  activation,
  mockBoundary,
  smokeSeam,
  prerequisites,
  rollbackReceipt: "required",
  initialStatus: "OPEN",
});

export const flagRehearsals = Object.freeze([
  flag("FEATURE_REAL_AUTH", "02-auth", "early", "build", "none", "/sign-in", ["Ayman sign-off", "hosted auth settings", "five-minute manual pass"]),
  flag("FEATURE_ENROLLMENT", "03-enrollment", "early", "runtime", "IDV_DRIVER=mock; BILLING_DRIVER=mock", "POST /api/enroll"),
  flag("FEATURE_ANALYSIS", "05-analysis", "early", "runtime", "CRS_DRIVER=mock; AI_DRIVER=mock", "analysis.run"),
  flag("FEATURE_TRACKER", "06-tracker", "early", "runtime", "local database", "GET /api/clients"),
  flag("FEATURE_BILLING", "10-billing", "early", "runtime", "BILLING_DRIVER=mock", "/api/billing/*"),
  flag("FEATURE_VAULT", "08-vault", "late", "runtime", "VAULT_DRIVER=fixture", "/api/banks/*"),
  flag("FEATURE_SUPPORT", "13-support", "early", "runtime", "AI_DRIVER=mock", "/api/support/*"),
  flag("FEATURE_APPLICATIONS", "11-applications", "early", "runtime", "VAULT_DRIVER=fixture", "/api/applications/*"),
  flag("FEATURE_FEES", "12-fees", "early", "runtime", "local database", "/api/fees/*"),
  flag("FEATURE_REFERRALS", "15-referrals", "late", "runtime", "local database", "createConsumerReferral -> resolveConsumerReferral -> completeConsumerReferral"),
  flag("FEATURE_REVENUE", "14-revenue", "late", "runtime", "BILLING_DRIVER=mock", "POST /api/revenue/jobs/run-now"),
  flag("FEATURE_KB", "16-kb", "late", "runtime", "VAULT_DRIVER=fixture; AI_DRIVER=mock", "runVaultReimportKb(global, YYYY-Www)"),
  flag("FEATURE_ANCILLARY", "17-ancillary", "late", "runtime", "local database", "runNotificationDispatch; runUploadedReportPurge"),
  flag("FEATURE_PAID_REFRESH", "18-paid-refresh", "late", "runtime", "CRS_DRIVER=mock; BILLING_DRIVER=mock", "POST /api/refresh-now"),
  flag("FEATURE_CONSOLE_OPS", "22-console-ops", "late", "runtime", "local database", "GET/PATCH /api/clients; PATCH /api/trainings/*"),
  flag("FEATURE_EMAIL", "25-email", "late", "runtime", "EMAIL_DRIVER=mock", "notifications.dispatch"),
  flag("FEATURE_AFFILIATES", "24-affiliates", "late", "runtime", "local database", "GET /api/affiliates/me"),
  flag("FEATURE_ADMIN", "23-admin-governance", "late", "runtime", "AI_DRIVER=mock", "GET/PATCH /api/admin/settings; POST /api/admin/analytics/run-now"),
  flag("FEATURE_TENANCY", "20-tenancy", "late", "runtime", "local database", "POST /api/admin/tenants", ["local mail-sink receipt"]),
  flag("FEATURE_BILLING_OPS", "21-billing-ops", "late", "runtime", "BILLING_DRIVER=mock", "POST /api/billing/checkout; PATCH /api/revenue/settlement"),
  flag("FEATURE_TIMELINE", "timeline-backend", "late", "runtime", "local database", "GET /api/support/threads/[id]/timeline"),
  flag("FEATURE_DEMO_QUICK_SIGN_IN", "hosted-demo", "late", "runtime", "local database", "POST /api/auth/quick-sign-in"),
]);

export function validateAcceptanceManifest(input = { stateMachines, lateStateSeams, jobReconciliation, databaseMatrices, flagRehearsals }) {
  const errors = [];
  const requireUnique = (values, label) => {
    if (new Set(values).size !== values.length) errors.push(`${label} contains duplicates`);
  };

  requireUnique(input.stateMachines.map(({ id }) => id), "machine IDs");
  const lateSeams = input.lateStateSeams ?? lateStateSeams;
  const jobs = input.jobReconciliation ?? jobReconciliation;
  requireUnique(lateSeams.map(({ id }) => id), "late seam IDs");
  requireUnique(jobs.map(({ name }) => name), "job names");
  requireUnique(input.databaseMatrices.map(({ file }) => file), "database matrix paths");
  requireUnique(input.flagRehearsals.map(({ name }) => name), "flag names");

  for (const machine of input.stateMachines) {
    for (const field of ["id", "ownerPhase", "availability", "unitCommand", "sqlProof"]) {
      if (!machine[field]) errors.push(`${machine.id ?? "machine"} is missing ${field}`);
    }
    if (!machine.source?.path || !machine.source?.symbols?.length) errors.push(`${machine.id} is missing a source seam`);
    if (!machine.legalCases?.length || !machine.illegalCases?.length) errors.push(`${machine.id} must declare legal and illegal cases`);
    if (!ACCEPTANCE_STATES.includes(machine.initialStatus)) errors.push(`${machine.id} uses an unknown acceptance state`);
  }
  for (const seam of lateSeams) {
    for (const field of ["id", "ownerPhase", "availability", "proofCommand"]) {
      if (!seam[field]) errors.push(`${seam.id ?? "late seam"} is missing ${field}`);
    }
    if (!seam.source?.path || !seam.source?.symbols?.length) errors.push(`${seam.id} is missing a source seam`);
    if (!seam.legalCases?.length || !seam.illegalCases?.length) errors.push(`${seam.id} must declare legal and illegal cases`);
    if (!ACCEPTANCE_STATES.includes(seam.initialStatus)) errors.push(`${seam.id} uses an unknown acceptance state`);
  }
  for (const row of jobs) {
    if (!row.name || !row.rationale) errors.push("job reconciliation row is incomplete");
    if (!ACCEPTANCE_STATES.includes(row.status)) errors.push(`${row.name} uses an unknown acceptance state`);
    if (row.status === "PASS" && !row.handler) errors.push(`${row.name} is PASS without a handler`);
  }

  const actualOrder = input.flagRehearsals.map(({ name }) => name);
  if (JSON.stringify(actualOrder) !== JSON.stringify(RATIFIED_FLAG_ORDER)) errors.push("flag order differs from the ratified literal order");
  for (const row of input.flagRehearsals) {
    for (const field of ["name", "owner", "availability", "activation", "mockBoundary", "smokeSeam", "rollbackReceipt"]) {
      if (!row[field]) errors.push(`${row.name ?? "flag"} is missing ${field}`);
    }
    if (!ACCEPTANCE_STATES.includes(row.initialStatus)) errors.push(`${row.name} uses an unknown acceptance state`);
  }

  return errors;
}
