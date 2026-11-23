# Implementation plan

Nothing here is authorized. Each phase is a complete, usable increment with measurable acceptance
criteria, proven by automated scenarios that write evidence files (the felt-ops method). The
scenarios run in CI, and one live scenario kills a real runner process.

## Phase 0: prove the assumptions (spikes, no product code kept)

The plan rests on four assumptions that are not yet evidenced. Each spike produces a short
written result and decides a recorded decision.

| Spike | Question | Acceptance (measurable) | Decides |
|---|---|---|---|
| S1 EVE coding quality | Can a self-hosted EVE agent (Docker sandbox, direct model key) take 10 representative tasks on a fixture repository from objective to pushed branch with tests passing? | ≥ 7/10 tasks produce a branch whose CI passes and a reviewer would accept; median wall time and tokens recorded; same 10 tasks run with Claude Code headless for comparison | D-02 (EVE as the execution runtime) vs U-04 (vendor CLI inside the sandbox) |
| S2 Remote claim via platform | Can a runner principal hold, renew and lose a lease on a FeltKit **invocation** delivered through a `bridge` surface, over AppPort, from another process? | Test: remote process claims, renews ×3, is killed; a second process re-claims as attempt 2 with `previous`; the first gets `CLAIM_LOST` | D-06 (platform invocation vs app-owned lease) |
| S3 Steering release | Will FeltKit publish agent control (implemented, 13 tests in source) before Phase 1 ends? | A published version containing `runtime/agent-control.ts`; or an explicit "not in this window" from the platform owner | D-07 |
| S4 GitHub through `app.integration` | Mint an installation token, read branch head, open a PR idempotently, receive a verified `check_suite` webhook | All four recorded; re-sending the PR create with the same key yields one PR | D-08 |

Exit: each decision is recorded in [DECISIONS](DECISIONS.md) with the spike's evidence.

## Phase 1: the core loop, end to end (first milestone)

**Scope:**
- workspace, members (owner/admin/member);
- one GitHub App and repositories with a protection-ruleset precondition;
- agents (definition ref, model ref, permitted repos) and runners (session, heartbeat);
- work → run → claim with lease → events → instruct (received → incorporated) → question →
  submit → observe (branch head, PR, checks) → review (accept + merge / request changes /
  reject);
- stop, stall and re-claim, fail and retry;
- Desk, Work list, Work detail, a minimal Agents page;
- the runner adapter as an EVE channel/extension.

**Must prove** (each an automated scenario with an evidence file):

| # | Scenario | Acceptance criteria |
|---|---|---|
| 1.1 | Create and assign | Work created and agent assigned in **one** transaction: the run exists or the mutation failed. A fault injected after commit loses nothing (no after-commit enqueue) |
| 1.2 | Real execution | A runner claims within 10 s, clones at the base commit, the EVE agent edits, runs tests and pushes `handoff/<work>-<run>`. Events appear live in the work detail within 2 s of report |
| 1.3 | Steer | An instruction sent mid-run is recorded *received*, delivered at the next turn and acknowledged *incorporated* with a note. Its effect is visible in the result. A conflicting instruction pauses the run |
| 1.4 | Question | The agent asks, the run is `needs-input`, the delegator is notified and answers. The run continues |
| 1.5 | Failure | The runner process is SIGKILLed mid-run (live scenario). The run becomes `stalled` within lease + sweep interval (≤ 3 min). A second runner re-claims as attempt 2 with `previous`, reconciles the branch from GitHub and finishes. The old runner's late reports get `CLAIM_LOST`. **No duplicate PR, no lost commits** |
| 1.6 | Stop | A stop mid-run ends the session at the next report. The run is `stopped`; the branch state is observed and recorded |
| 1.7 | Result and observation | Submit leads to a PR opened by the app (one PR even if the job retries). Head sha observed to match. Checks observed via webhook. Every observation cites a call or delivery id |
| 1.8 | Review | Accept is disabled until the head is observed. Accept + merge runs as the reviewer and work becomes `done`. Request changes creates a new run with the note as its first instruction. Reject returns work to `open` |
| 1.9 | Authority | A runner can't claim another runner's run, can't report without the current claim, and can't push to the default branch (ruleset). A suspended agent's runs aren't claimed. A revoked runner session gets 401 on its next call. A member can't register runners |
| 1.10 | History | The work's audit trail reconstructs the whole scenario with correct sources (system / agent / observation / person) and actors |

**Exit measures:**
- all ten scenarios pass in CI;
- the live kill scenario passes 10 consecutive runs;
- application code within the estimate (backend ≤ 2,500, frontend ≤ 2,800, adapter ≤ 1,200
  non-blank lines);
- zero platform modifications.

**Not in Phase 1:** dashboards, usage reports, schedules/triggers, Slack, local runners,
multiple model providers beyond one, mobile.

## Phase 2: operate as a team

- Multiple agents and runners; per-agent concurrency; runner drain/revoke.
- Reassign (to another agent or a person) stops the active run in the same transaction.
- Review policy (required reviewer, not the requester); run time and token budgets.
- Notifications for every Desk reason. Usage recorded per turn (runner-reported), with cost
  computed server-side from a versioned price table.
- Sandbox hardening: deny-all network plus an allow-list for package registries (needs EVE
  support beyond Docker allow-all/deny-all, or a runner-side proxy). Event scrubbing tests.

**Acceptance:**
- Two runners and three agents operate concurrently without double-claims across 100 queued
  runs. The test asserts on its own fixture rows.
- Reassign mid-run stops the old run within one report interval.
- Budget exceeded leads to `failed: budget_exceeded`.
- A secret planted in the environment never appears in stored events (test).

## Phase 3: automation and agent-proposed actions

- Triggers: a GitHub issue label or a schedule creates work from a template (FeltKit schedules +
  inbound webhooks), with the tenant carried in the job payload.
- If **E-2** is delivered: agents may propose declared consequential capabilities (e.g. "run
  database migration in staging"), approved by a person in the app.

**Acceptance:**
- A labelled GitHub issue creates exactly one work item, idempotent on redelivery.
- A schedule fires once per period across an app restart.
- With E-2, a proposed action is approved in the app (not Studio) and executed as the owner.
  The approver is recorded.

## Phase 4: reach

- Local runners on members' machines (the same EVE runner on local Docker), clearly labelled.
- Slack intake and notifications via EVE's channel.
- Additional model providers via Resolver refs.
- Optional vendor-CLI tool inside the sandbox if S1 showed a quality gap (U-04).

Each item has its own acceptance scenario before it ships.

## Dependencies and risks

| Dependency / risk | Affects | Mitigation |
|---|---|---|
| EVE coding quality (S1) | the whole product | Measured first. Fallback: a vendor CLI driven inside the EVE sandbox |
| EVE release quality (fork CI has never run on a PR) | runner stability | Pin versions; run the adapter's own scenario suite against each EVE upgrade; ask the platform owner to enable CI |
| EVE upgrades strand in-flight sessions | long runs | Drain runners before upgrade; the app's re-claim handles the rest |
| E-1 not delivered | an interim lease remains app code | Keep it ≤ 200 lines, mirroring platform names. Replace when shipped |
| Agent control unpublished (D-07) | steering | Interim `instructions` collection with the same states |
| E-2 not delivered | Phase 3 agent-proposed actions | Product stays useful without it (v1 design) |
| G-09 (`onOutcome` only logged) | observations | Write observations from the calling job, not `onOutcome` |
| GAP-13 (collection without `tenant` is shared) | tenancy | Test that every collection declares `tenant` |
| Docker network policy is allow-all/deny-all | sandbox egress | Phase 2 proxy or EVE improvement |
| Token reaches the sandbox | blast radius | Repo-scoped installation token, ≤ 1 h, branch ruleset required |
