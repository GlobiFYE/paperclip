---
name: ai-engineer-playbooks
description: >
  Instructional-design and assessment playbooks for teaching agentic AI engineering: cognitive
  load model, weighted competency model, real assessment design, curriculum sequencing, and
  content roadmap. Use for courses, workshops, onboarding ramps, and skills rubrics.
key: paperclipai/optional/software-development/ai-engineer-playbooks
recommendedForRoles:
  - engineer
  - product-manager
  - researcher
tags:
  - instruction-design
  - assessment
  - curriculum
  - competency-model
  - ai-engineering
trust: markdown_only
---

# AI engineer playbooks

A **deliberately narrow slice** of `C:\Users\Admin\AIEngineer`: the ten files about *how to teach
and assess* agentic engineering. The rest of that repo was not vendored — see the exclusion note
at the bottom, which matters more than usual here.

## `curriculum/`

- **`agentic-engineering-mastery-curriculum.md`** (29 KB) — a 12-week, 60–80 hour program for
  developers, engineering managers, and technical leads. Self-paced + live workshops. Integrates
  Google ADK, Microsoft AutoGen, and OpenAI Swarm. The spine of the pack.
- **`curriculum-architecture.md`** (18 KB) — sequencing and structure decisions.
- **`content-roadmap.md`** (18 KB) — what gets authored when.

## `instructional-design/`

- **`cognitive-load-management.md`** (10 KB) — the three-component load model
  (intrinsic / extraneous / germane) applied to AI tooling, plus conceptual chunking and
  prerequisite verification. Read this before authoring any AI-agent lesson.
- **`learning-experience-design.md`** (8 KB) — the learning-journey spine.
- **`engagement-optimization-strategy.md`** (10 KB) — keeping a mixed-skill cohort engaged.

## `assessment/`

- **`competency-assessment-model.md`** (11 KB) — weighted domains: **technical proficiency 40%,
  applied implementation 30%, domain knowledge 20%, collaboration 10%**, with explicit
  sub-competencies and measurable outcomes per domain.
- **`practical-assessment-design.md`** (13 KB) — building assessments that cannot be passed
  trivially. Pair with this catalog's `ai-software-factory` entry: both are about
  *gates that are not theater*.

## `content-production/`

- **`content-production-pipeline.md`** (14 KB) · **`multimedia-content-strategy.md`** (18 KB) —
  authoring and media workflow for a multi-week program.

## What was deliberately left out

`AIEngineer` is ~130 markdown files, but most are a **go-to-market and business corpus for one
specific product** (an agentic-engineering course business): pricing models, revenue projections,
sales funnels, battlecards, launch plans, a Stripe-style billing implementation
(`billing_system_architecture.md`, `database_schema.sql`), persona research, SEO/Discord/LinkedIn/
TikTok/YouTube strategy, and a Core Web Vitals / mobile-first performance handbook.

Those themes are already covered — often more thoroughly, as deployable prompts — by the
`claude-subagents-catalog` entry in this same catalog (610 agents including
`pricing-strategy-optimizer`, `persona-builder-agent`, `gtm-strategy-orchestrator`,
`competitive-differentiation-agent`, `value-proposition-development-agent`,
`micro-interaction-designer`, `performance-ux-optimizer`, `accessibility-specialist`,
`subscription-billing-architect`, `stripe-integration-agent`). Per the ONE-236 decision to avoid
double-vendoring, those were skipped. Also skipped: `detailed_business_analysis_results.json`
(generated data) and the non-markdown artifacts (`database_schema.sql`).

So this entry is the instructional-design/assessment remainder — the part with **no equivalent in
the agent library**, because that library contains agents, not curricula or rubrics.

## Provenance

Vendored 2026-09-26 from `C:\Users\Admin\AIEngineer`
(`agentic_engineering_curriculum.md`, `content/instructional-design/`,
`content/assessment-framework/`, `content/content-production/`, `strategy/curriculum/`).
Renamed only to kebab-case where the source used spaces. Text is verbatim. No upstream URL: the
working copy is Git-less, so the author of record could not be confirmed — treat the attribution
as unverified. Related: `ai-software-factory` (verification gates), `archon-workflows` (the SDLC
CLI this curriculum's tooling layer assumes).
