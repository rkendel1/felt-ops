# Agent operator evaluation

**What this evaluation is, and is not.**
- **It is:** a measured, repeatable performance of the 15 operator workflows through the real
  CompanyOS UI, FeltKit Studio and real agent processes. Every displayed state was checked
  against FeltDB and FeltKit records.
- **It is not:** an observation of human operators, and it is not independent:
  - No human operators took part.
  - The harness and this review were written by the agent that built CompanyOS.
  - Two attempts at an independent AI evaluation did not produce a report. The first, a
    free-roaming agent driving a browser and a terminal, stalled after its first screens. The
    second, a reviewer of the recorded screens, was stopped before reporting.
- **Consequence:** the outcome, action, context-switch and display-accuracy measurements are
  solid. Judgements of comprehension, confusion and confidence are the builder's, and should
  be re-done by people who did not build it. The recorded screens in
  `evidence/operator-eval/` are suitable for that review.

## Method

- **Harness:** `scripts/operator-eval.ts` (repeatable: `npm run build && npx tsx scripts/operator-eval.ts`).
- **Environment:**
  - A disposable `feltkit dev` (port 3300) on a copy of the commit under test.
  - Its development state holds four duplicate commitments produced by release R1's actual
    code.
  - Real Chromium (Playwright) for CompanyOS and FeltKit Studio.
  - Real agent processes (`agents/runner.ts`) over `/mcp` with their own sessions.
  - Terminal steps where the operator guide prescribes them (issuing sessions, starting or
    killing agents).
- **Measured per workflow:**
  - outcome;
  - scripted wall-clock time (a lower bound for a person);
  - operator actions (clicks, fills, selections, navigations, commands);
  - context switches between app, Studio and terminal;
  - obstacles;
  - whether what the screen showed matched the records. The harness checks this
    independently against the runtime (FeltDB queries, `AgentHost.get`, the authority
    decision, the activity log).
- **Runs:**
  - Run 1, before fixes: `evidence/operator-eval-run1-before-fixes.json`.
  - Run 3, after fixes, on commit `39e27b7`: `evidence/operator-eval/results.json` plus a
    screenshot and the visible text of every screen.
  - Run 2 is discarded: it evaluated the uncommitted tree by mistake, because the harness
    reads `git archive HEAD`.

## Results (run 3)

| # | Workflow | Outcome | Time | Actions | Switches | Surfaces | Display = records |
|---|---|---|---|---|---|---|---|
| W01 | Register and configure an agent | completed | 4.4 s | 10 | 2 | app, terminal | ✓ |
| W02 | Understand and grant its authority | **partial** | 1.3 s | 1 | 0 | app | ✓ |
| W03 | Assign a business task | completed | 2.9 s | 11 | 0 | app | ✓ |
| W04 | Monitor execution | completed | 2.9 s | 3 | 1 | terminal, app | ✓ |
| W05 | Inspect capability usage and evidence | **partial** | 1.3 s | 2 | 0 | app | ✓ |
| W06 | Review and approve a consequential action | completed | 11.4 s | 8 | 3 | studio, terminal, app | ✓ |
| W07 | Reject an action and observe the refusal | completed | 7.6 s | 5 | 1 | studio, app | ✓ |
| W08 | Intervene (context, suspend, approval while suspended, resume) | completed | 14.2 s | 12 | 2 | app, studio | ✓ |
| W09 | Recover from a failed task | completed | 23.7 s | **23** | **6** | app, studio, terminal | ✓ |
| W10 | Reassign work to a human | completed | 4.1 s | 5 | 0 | app | ✓ |
| W11 | Trace a business change through engineering and deployment | **partial** | 2.8 s | 2 | 0 | app | ✓ |
| W12 | Investigate a production incident | completed | 2.8 s | 2 | 0 | app | ✓ |
| W13 | Determine the real state after a process failure | completed | 1.3 s | 2 | 1 | terminal, app | ✓ |
| W14 | Evaluate effectiveness and cost | **partial** | 1.3 s | 1 | 0 | app | ✓ |
| W15 | Revoke authority and verify refusal | completed | 3.5 s | 6 | 1 | app, terminal | ✓ |

**Totals:**
- 11 completed, 4 partial, 0 not completed.
- What the screen showed matched durable records in **15 of 15**.
- 93 operator actions, 17 context switches, no browser console errors.

**Run 1 → run 3:** W01 moved from partial to completed (agent registration added to the UI).
The fixes in between:
- registration in the UI;
- a Studio deep link per task;
- "last heard from the agent";
- agent work on the incident page;
- incident linking in the assign form;
- webhook permissions (F-036).

The four partials are platform gaps or environment limits, not CompanyOS steps:
- **W02:** authority cannot be granted at run time. Roles live in code and are attached when
  a session is issued (G-01, G-04).
- **W05:** the agent made 10 recorded calls; the assignment shows its 4 proposals. Its reads,
  and every refusal, exist only in Studio → Activity (F-020, F-028).
- **W11:** the dev sandbox cannot reach GitHub (F-016). The production run shows the full
  chain (`evidence/production-lifecycle.json`).
- **W14:** no cost, because FeltKit does not meter external agents and the deterministic
  agents report none (F-032). Refusals are not counted.

## What the measurements show

1. **The system tells the truth.** In every workflow, including after a crash (W13) and
   during recovery (W09), the UI's state matched FeltDB and FeltKit. The operator can trust
   the display, which is the precondition for everything else. Two mechanisms carry this:
   - the records check computed by CompanyOS;
   - FeltKit's action records (proposer, approver, executed-as, outcome determined by
     dispatch).
2. **Control works at the execution boundary.**
   - An approval granted while the assignment was suspended ran and failed: "Assignment
     AS-0002 is suspended by an operator; commitments.reverse may not run under it" (W08).
   - A suspended agent with a brand-new session was refused (W15).
   - A rejected proposal changed nothing, and the duplicate it targeted stayed for the
     standby to handle (W07, W09).
   - Recovery after a killed process ended with exactly four reversals, each once (W09).
3. **The cost is fragmentation.**
   - Approving takes 3 context switches (W06), and recovering takes 23 actions across all
     three surfaces (W09).
   - Every consequential decision leaves CompanyOS for Studio (G-07).
   - Every revocation leaves both for a terminal (G-02).
   - A suspension made in one place is unknown to the other (F-046).

## Problems, ranked

| ID | Sev | Problem | Where | Owner |
|---|---|---|---|---|
| E-01 | High | Agent approvals happen only in Studio; the operator leaves the business context to decide | W06–W09 | Platform (G-07) |
| E-02 | High | The app's Studio link (`/_feltkit/`) opens Studio signed out; the operator needs the token link from the terminal (development) or an operator grant (production) | W06 | Platform (F-043) |
| E-03 | High | Studio's approval screen shows raw record ids (`commitmentId: "mw1…"`), not the amount, invoice or supplier being reversed | W06 | Platform (F-045); mitigated by agents putting detail in the reason |
| E-04 | Medium | Studio labels the agent's own working task "Waiting for a coding agent — Nothing works on this task until one claims it" while it waits for approval | W06 | Platform (F-044) |
| E-05 | Medium | Suspension is not shared: Studio still offers Approve on a suspended assignment's actions (refused at execution, but the screen invites it) | W08 | Platform + app (F-046) |
| E-06 | Medium | Recovery takes 23 actions on 3 surfaces: suspend (app), cancel task (Studio), reassign (app), issue session and start agent (terminal), approve (Studio), verify (app) | W09 | Mostly platform (G-02, G-07) |
| E-07 | Medium | What the agent *read* and what it was *refused* are invisible in the app; the assignment shows only proposals and changes | W05 | Platform (F-020, F-028) |
| E-08 | Medium | Registration (CompanyOS) and credentials (FeltKit CLI) are separate; nothing ties the session's roles to the registered role, and IT could issue a session to a suspended agent | W01, W15 | Platform (G-01/G-02) |
| E-09 | Low | Liveness is inferred: "last heard from the agent" is the agent's latest write; a stuck agent that only reads looks silent | W13 | Platform (F-047) |
| E-10 | Low | Linking work to an incident must be done when assigning; the remediation assignment in the run predates the incident and is unlinked | W12 | App |

## Operator scorecard

| Dimension | Score | Evidence |
|---|---|---|
| Discoverability | 6 | Attention queue with reasons and nav counts; "Why it may act" maps every capability to the role that grants it (W02 matched FeltKit's decision). Lost points: approvals and revocation live outside the app, and the Studio link does not sign in (E-01, E-02). |
| Delegation | 6 | Assignments narrow authority and cannot widen it (capabilities the role lacks are greyed out, W03), enforced at execution (W08). No runtime grant, no delegation primitive, and integration calls are bounded by roles only (G-03, G-04). |
| Visibility | 6 | Three lanes (agent says / recorded / verified), live FeltKit actions, records check, cross-subject changes, last heard. Reads and refusals invisible (E-07); Studio's task label misleads (E-04). |
| Approval | 6 | FeltKit's semantics are the strongest part: a person only, approver must hold the authority, runs as the agent, one run per approval, refused at execution if business rules or suspension forbid it. Approval happens in another system, without business context (E-01, E-03). |
| Intervention | 7 | Suspend, resume, context, cancel, escalate and reassign (to an agent or a person) all worked and are enforced (W08, W10). |
| Recovery | 7 | The real state after a crash is evident and correct (W13); recovery produced exactly-once results and verification (W09). Expensive in actions and surfaces (E-06). |
| Trust | 7 | 15/15 displays matched records; claims are labelled, verification is computed from records. Dev/prod divergence in owner resolution (F-022) and hidden refusals limit it. |
| Effectiveness | 4 | Attempts, claims, verified outcomes, interventions and recoveries are counted from records. No cost (unmetered), refusals uncounted, samples tiny. |
| **Overall** | **6** | The operator can supervise agents safely and establish the truth. Doing so is fragmented across three surfaces. |

## Answers to the brief's questions

| Question | Answer (from this run) |
|---|---|
| Understand what agents are doing without raw logs? | Mostly yes: assignment lanes, live actions, records check. Not their reads or refusals. |
| Assign work with clear scope and authority? | Yes (W03). Scope is narrowable, never widenable. |
| See why an agent may act? | Yes (W02), from the same role table FeltKit decides with. |
| Distinguish proposed, executed and verified? | Yes: FeltKit action states plus CompanyOS verification lanes. |
| Approve consequential operations safely? | Safely yes; conveniently no (Studio, raw ids). |
| Intervene without corrupting state? | Yes (W08): an approval during suspension failed cleanly. |
| Recover work after failures? | Yes (W09, W13), with exactly-once results; costly. |
| Determine who or what caused a change? | Yes for changes; the approver is in FeltKit's record, not CompanyOS's (F-008). |
| Trace business outcomes to software changes? | Yes in production (Scenario 2); not in the dev sandbox (W11). |
| Operate multiple agents across domains? | Yes: five agents, four domains, one workspace. |
| Manage cost, performance, effectiveness? | Performance and effectiveness partly; cost no. |
| Trust the system without trusting the model? | Yes: no model decides; every outcome is verified from records, and FeltKit's authority holds regardless of what an agent asserts. |

## Still to do

- Run the 15 workflows with 2–3 people (novice and experienced) using only the guide, timing
  them against these scripted lower bounds. Record confusion and confidence.
- An independent review of the recorded screens (`evidence/operator-eval/*.jpg`, `*.txt`) by
  someone who did not build CompanyOS.
