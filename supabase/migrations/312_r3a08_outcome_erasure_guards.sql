-- R3A-08: outcome evidence is tombstoned through review, never physically erased.

revoke delete, truncate on table public.outcomes from service_role;

drop trigger if exists outcomes_no_delete on public.outcomes;
create trigger outcomes_no_delete
before delete on public.outcomes
for each row execute function public.append_only_guard();
alter table public.outcomes enable always trigger outcomes_no_delete;

drop trigger if exists outcomes_no_truncate on public.outcomes;
create trigger outcomes_no_truncate
before truncate on public.outcomes
for each statement execute function public.append_only_guard();
alter table public.outcomes enable always trigger outcomes_no_truncate;
