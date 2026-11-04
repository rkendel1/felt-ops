# Agent operator evaluation (reconciled 2026-11-04)

## What this is

- **It is:** a **scripted, builder-authored** performance of 15 operator workflows. A
  Playwright harness drove the real CompanyOS UI and FeltKit Studio, with real agent
  processes. Its stored results have been reconciled against the harness code.
- **It is not** a usability study and not an independent evaluation:
  - No human operator took part.
  - The harness, its pass/partial judgements and this document were written by the agent that
    built CompanyOS.
  - Two attempts at independent AI review produced **no report**. A free-roaming evaluator
    stalled after its first screens and was stopped. A reviewer of the recorded screens was
    stopped before reporting.
- Use the numbers below as **what the script could do and observe**, not as what people can
  do.

Reproduce: `npm run build && npx tsx scripts/operator-eval.ts`. The app under test is
`git archive HEAD`; the harness runs from the working tree.

## Measured facts (run on commit `39e27b7`, recorded 2026-11-03 23:45:59 UTC)

Source: `evidence/operator-eval/results.json`. Each figure was re-derived from that file on
2026-11-04.

| Figure | Value | What it actually measures |
|---|---|---|
| Workflows | 15 | W01–W15 as listed below |
| Outcomes | 11 completed, 4 partial, 0 not completed | the harness's own classification: a workflow becomes "partial" where its author coded an `obstacle(…, "partial")` |
| Operator actions | 93 | clicks, fills, selections, navigations and terminal commands the script counted |
| Context switches | 17 | changes of surface (app, Studio, terminal) the script counted |
| Time | 85.5 s | scripted wall-clock, **including 28 fixed waits/sleeps** written into the harness; not a usability timing |
| Browser errors | 0 | **only uncaught page exceptions on the CompanyOS tab**; `console.error` messages and the Studio tab were not captured |
| "Display matched records" flags | 15 true | see the next table: the checks differ in strength, and one is not a check |
| Screens recorded | 25 (`.jpg` + visible text `.txt`) | available for an independent review |

### What each "matched" flag really checks

| Workflow | Outcome | Actions | Switches | Check type | What is compared |
|---|---|---|---|---|---|
| W01 Register and configure an agent | completed | 10 | 2 | partial | agent name visible on its page; registry record exists (roles shown vs. stored not compared) |
| W02 Understand and grant authority | partial | 1 | 0 | **display ↔ platform** | "Why it may act" rows vs. FeltKit's authority decision for the agent's roles |
| W03 Assign a business task | completed | 11 | 0 | partial | stored capabilities equal what the script entered; forbidden capability greyed out |
| W04 Monitor execution | completed | 3 | 1 | **display ↔ platform** | page shows 4 proposed + waiting-approval vs. FeltKit pending count and stored status |
| W05 Inspect capability usage and evidence | partial | 2 | 0 | **none** (hard-coded `verdict(true)`) | records that the agent's 10 calls are not all on the page; no comparison |
| W06 Review and approve | completed | 8 | 3 | **display ↔ platform** | page shows succeeded vs. FeltKit action approved by `user:rhea`, ran as `agent:agent-ledger` |
| W07 Reject | completed | 5 | 1 | **display ↔ platform** | page shows rejected vs. FeltKit action state and remaining duplicates |
| W08 Intervene | completed | 12 | 2 | records only | approval during suspension failed with the suspension reason; status and context stored |
| W09 Recover a failed task | completed | 23 | 6 | records only | 0 duplicates, 4 unique reversals, new assignment verified |
| W10 Reassign to a human | completed | 5 | 0 | display only | work item visible on Work |
| W11 Trace a change | partial | 2 | 0 | display only | incident ↔ change links visible |
| W12 Investigate an incident | completed | 2 | 0 | **display ↔ records** | incident check's duplicate count vs. reconciliation |
| W13 State after a process failure | completed | 2 | 1 | **display ↔ records** | records-check count and action states on the page vs. reconciliation and FeltKit |
| W14 Effectiveness and cost | partial | 1 | 0 | weak | UI row contains the metric numbers (substring match) |
| W15 Revoke and verify refusal | completed | 6 | 1 | outcome only | a fresh session of the suspended agent was refused ("is suspended") |

**Reconciled statement:**
- 6 of 15 workflows had a real check of what the screen showed against FeltKit or FeltDB
  records, and all 6 agreed.
- 3 had partial checks and 3 checked records or outcomes but not the screen; all held.
- 2 checked only that something was displayed.
- 1 (W05) had no check.

The earlier claim "displays matched records in 15/15" was an overstatement and is withdrawn.

### Run history

- **Run 1** (before fixes): `evidence/operator-eval-run1-before-fixes.json`. W01 partial: no
  registration UI.
- **Run 2:** discarded. It evaluated the uncommitted tree; its results were overwritten.
- **Run 3:** the figures above. In between, commit `39e27b7` added:
  - agent registration in the UI;
  - a Studio task deep link;
  - "last heard from the agent";
  - agent work on the incident page;
  - incident linking in the assign form;
  - webhook permissions.

## Observations (measured) and interpretation (builder's judgement)

| Observation (from the run) | Interpretation |
|---|---|
| Approval required leaving CompanyOS for Studio (W06: 3 switches); recovery used all three surfaces (W09: 23 actions, 6 switches) | Operator work is fragmented; the main cost is platform-shaped (G-02, G-07) |
| An approval granted in Studio while the CompanyOS assignment was suspended ran and failed: "Assignment AS-0002 is suspended by an operator …" (W08) | Control holds at execution; the two systems do not share suspension (F-046) |
| A fresh FeltKit session issued to a suspended agent was refused by CompanyOS (W15) | Platform-level revocation is incomplete; the app's check is load-bearing (G-01/G-02) |
| The app's "Studio ↗" link is `/_feltkit/` with no credential; Studio shows a sign-in prompt (W06 screen) | F-043 |
| Studio shows the agent's own task as "Waiting for a coding agent — Nothing works on this task until one claims it" (W06 screen) | F-044 |
| The approval screen shows raw ids (`"commitmentId": "mw…"`) (W06 screen) | F-045 |
| The agent made 10 recorded calls; the assignment page shows its 4 proposals (W05) | F-020, F-028 |

## Problems (unchanged in substance; IDs as before)

E-01 approvals only in Studio (High) · E-02 unsigned Studio link (High) · E-03 approval screen
without business context (High) · E-04 misleading Studio task label (Medium) · E-05
suspension not shared (Medium) · E-06 recovery cost (Medium) · E-07 reads and refusals
invisible (Medium) · E-08 registration and credentials in separate systems (Medium) · E-09
liveness inferred from writes (Low) · E-10 incident linking only at assignment time (Low).

Each was **observed in the scripted run**. Their severity for people is the builder's
judgement and is untested with users.

## Operator scorecard: provisional

These scores are **provisional**. They rest on a scripted run and the builder's judgement,
with no human or independent review. Where a score depended on "displays matched records in
15/15", it now rests on the 6 real checks plus the record-level checks.

| Dimension | Provisional score | Basis |
|---|---|---|
| Discoverability | 6 | measured: authority explanation agrees with FeltKit (W02); approvals and revocation outside the app |
| Delegation | 6 | measured: narrowing stored and enforced (W03, W08); no runtime grant or delegation primitive |
| Visibility | 5 | measured: action states agree with FeltKit (W04, W06, W07); reads and refusals invisible (W05, unchecked); lowered from 6 because W05 had no check |
| Approval | 6 | measured: authority and execution semantics (W06, W08); experience fragmented |
| Intervention | 7 | records-level: W08, W10 |
| Recovery | 7 | records-level: W09, W13 |
| Trust | 6 | 6 real display checks agreed; lowered from 7 after reconciliation |
| Effectiveness | 4 | W14 check weak; cost unmeasured |
| **Overall** | **6 (provisional)** | |

## Required before these results can be relied on

1. Human sessions with 2–3 operators (novice and experienced), using only
   `AGENT-OPERATOR-GUIDE.md`, timed against these scripted lower bounds.
2. An independent review of the 25 recorded screens.
3. Harness fixes before the next run, without changing what is measured:
   - a real check for W05;
   - display-versus-records checks for W08–W11 and W15;
   - capture of `console.error` and of the Studio tab;
   - timings reported without the fixed waits.
