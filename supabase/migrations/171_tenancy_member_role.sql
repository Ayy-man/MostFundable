-- PostgreSQL requires a newly added enum value to commit before a later
-- migration can use it in invite constraints and accepted profile rows.
alter type public.org_role add value if not exists 'member';
