-- 395_consumer_notification_reads_tenant_wall.sql — the reads ledger carries the tenant wall.
--
-- THERE IS NO ROLLBACK COMMAND HERE. The fix for a problem in this file is a
-- NEW forward migration. Never edit this file once it is merged, and never
-- `supabase db reset` from a lane worktree.
--
-- Migration 278 (R2A-14) rewrote every authenticated mutation policy that
-- existed on that day so its predicate carries private.tenant_write_allowed,
-- and pgTAP 278 has asserted ever since that no authenticated insert, update
-- or delete policy exists without it. Migration 394 created
-- public.consumer_notification_reads with an own-row insert policy and no
-- wall — correct for a consumer (the wall returns true for the consumer role)
-- but a hole in the invariant, and the integration gate caught it on the
-- merged tree (2026-08-25). This file closes it the way 278 would have:
-- the own-row predicate stays, the wall is conjoined.

alter policy consumer_notification_reads_insert_own
on public.consumer_notification_reads
with check (
  (profile_id = (select private.auth_profile_id()))
  and (select private.tenant_write_allowed(private.auth_org_id()))
);
