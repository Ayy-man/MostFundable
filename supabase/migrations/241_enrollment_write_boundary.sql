-- R1A-02: enrollment evidence and state are writable only through service-role
-- RPCs. Browser sessions retain their existing tenant-scoped read policies.

revoke insert on table public.consents from authenticated;
revoke insert, update on table public.enrollments from authenticated;
revoke insert, update on table public.enrollment_milestones from authenticated;

drop policy if exists consents_insert_authenticated on public.consents;
drop policy if exists enrollments_insert_authenticated on public.enrollments;
drop policy if exists enrollments_update_authenticated on public.enrollments;
drop policy if exists enrollment_milestones_insert_authenticated on public.enrollment_milestones;
drop policy if exists enrollment_milestones_update_authenticated on public.enrollment_milestones;
