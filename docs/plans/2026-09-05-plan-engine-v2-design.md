# Plan engine v2: rules compute facts, a model writes the plan

Date: 2026-09-05. Status: agreed direction, in build.

## Why

The funding plan today is rules only: six measurable flags become an 8-item checklist and a
score, and the consumer sees factor rows with template copy. The founder's real readiness
reports (119 of them, pulled from Notion on 2026-09-05) are far richer: ten personal items with
fact, target and gap on each line, a verdict ("NOT READY, 4 items to fix"), an ordered action
plan, an inquiry table with the 45-day rule, and a timeline band. Two things were missing:
four checklist items had no data source, and nothing wrote the plan in words.

Both are now solvable. The CRS sandbox report carries the score, the subject's current name,
address and employers, per-account status and past-due amounts, delinquency comments, and
collection and public-record counts. And the model comparison on 2026-09-05 showed
gpt-5.6-luna at high reasoning writes accurate founder-voice prose from a facts pack at a
tenth of the cost of terra.

## Shape

```
bureau report ──► normalizer ──► DerivedFeatures v2 ──► rules ──► FundingReadinessPlanV1 (10 personal items)
                                                        │
                                                        └──► FactsPackV2 ──► model ──► NarrativeV1 ──► grounding check ──► plans.narrative
```

1. **Rules grow to the founder's ten items.** New derived fields: per-bureau score, employers
   and addresses on file, per-account late-within-24-months and past-due, inquiry-to-new-account
   matching for the 45-day rule. `overall_report_ready` (a placeholder) is replaced by
   `credit_score_700`, `clean_report` and `no_late_payments`. Utilization becomes per-card
   ("every card under 30%") rather than overall only. The score stays 0-100 and the 99 cap for
   any unverified item stays; a founder-style `itemsToFix` and `X/10` are added beside it.

2. **A facts pack is the only thing the model sees.** `FactsPackV2` (see
   `web/src/lib/llm/narrative/contract.ts`) holds numbers, short enums and creditor labels. No
   raw report, no identifiers, no names of people.

3. **The model writes, it never decides.** `NarrativeV1`: verdict, where-you-stand, one to
   three next steps, a note per unverified item, the business side, and a timeline band from a
   fixed vocabulary. Prompt key `funding-readiness-narrative`, governed like the plan prompt
   (versioned in the database, evaluator evidence required to activate). Default model
   `openai/gpt-5.6-luna` with reasoning effort high; `NARRATIVE_MODEL` overrides it.
   Claude Sonnet 5 is the fallback if the founder wants a warmer voice.

4. **A deterministic checker gates every narrative.** Every number in the prose (dollars,
   percents, counts, months) must appear in the pack. Compliance language rules apply (no
   "guarantee", "will approve", "credit repair"). No lender or product names. Two attempts;
   on failure the plan is still stored and the surface falls back to template copy. A
   narrative failure can never fail an analysis.

5. **Storage and surface.** `plans.narrative jsonb` (migration 435) written after the plan by
   the worker. The Optimization view gains a "Your plan" card at the top (verdict, where you
   stand, next steps, timeline) and per-factor notes; the ten personal factors replace eight.

## Not in scope

The founder's "Estimated funding potential" line is a judgment call about lenders and stays
out. Business items remain consumer-reported until a business data source exists.
