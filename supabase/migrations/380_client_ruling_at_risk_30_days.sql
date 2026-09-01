-- 380: the inactivity half of client health moves 14 -> 30 days, on the
-- client's own ruling.
--
-- Migration 190 shipped tracker_client_health with a 14-day quiet threshold as
-- our default, and the round-2 intake asked the client the question directly
-- ("When should a client show as 'at risk' on the operator dashboard? … or
-- 'use your defaults'"). Alec answered on 2026-08-17: "no activity for 30
-- days" (DEC-OWN-INTAKE-R2 item 4, .planning/DECISIONS.md). This applies that
-- answer to the one rule it names — the inactivity trigger — and leaves the
-- stage-target rules exactly as 190 wrote them: red past day 60 and amber from
-- day 45 in optimization or applying were never part of the question, and the
-- operator "Needs attention" panel and tracker health pills all read through
-- this one function, so the flip lands everywhere at once.
--
-- CREATE OR REPLACE keeps 190's grants and revokes; body, language, volatility
-- and search_path pin are restated verbatim apart from the interval.

create or replace function public.tracker_client_health(
  p_stage public.client_stage,
  p_stage_entered_at timestamptz,
  p_last_activity_at timestamptz,
  p_now timestamptz default statement_timestamp()
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_now >= p_last_activity_at + interval '30 days' then 'red'
    when p_stage in ('optimization', 'applying') and p_now > p_stage_entered_at + interval '60 days' then 'red'
    when p_stage in ('optimization', 'applying') and p_now >= p_stage_entered_at + interval '45 days' then 'amber'
    else 'green'
  end
$$;
