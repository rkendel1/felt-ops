# Product discovery: Multica → a native FeltKit product

Discovery, analysis and product definition only. Nothing was implemented, deployed or changed
outside this folder. Inspected on 2026-11-23:

| Repository / package | Version |
|---|---|
| `rkendel1/multica` | `27dea95` |
| `rkendel1/felt-ops` | `ca3ba58` |
| `rkendel1/feltkit` | `b0222f6`, source 0.3.37 |
| `@feltdb/feltkit` (installed baseline) | 0.3.34 |
| `rkendel1/eve2` | `50f1cf1`, published as `@appport/eve` 1.0.2 |

## Documents

| # | Document | Contents |
|---|---|---|
| 1 | [MULTICA-AUDIT](MULTICA-AUDIT.md) | What Multica actually does, labelled by implementation status |
| 2 | [FELTKIT-BASELINE](FELTKIT-BASELINE.md) | FeltKit 0.3.34, AppPort Services, EVE and felt-ops as they really are |
| 3 | [CAPABILITY-MAP](CAPABILITY-MAP.md) | Every Multica capability classified A–F, with ownership and evidence; platform gaps |
| 4 | [PRODUCT-DEFINITION](PRODUCT-DEFINITION.md) | Job, thesis, users, objects, workflows, scope, differentiators |
| 5 | [ARCHITECTURE](ARCHITECTURE.md) | Control plane / execution plane, state machines, runner contract, recovery, secrets |
| 6 | [UX-SPEC](UX-SPEC.md) | Four surfaces, screen behaviour, states and permissions |
| 7 | [IMPLEMENTATION-PLAN](IMPLEMENTATION-PLAN.md) | Phase 0 spikes, then phases with measurable acceptance |
| 8 | [ESTIMATE](ESTIMATE.md) | Domain model, functions, code by responsibility, comparison, risks |
| 9 | [DECISIONS](DECISIONS.md) | Decisions, assumptions, open questions, verification of audit notes |
| — | [`evidence/`](evidence/) | Detailed audit notes with `file:line` references (A–G) |

## Executive summary

### What Multica is really good at
Making coding agents **teammates on a shared board**. An agent is an assignee like a person. A
run is live and inspectable: transcript, tool calls and diffs. People steer by replying, and can
cancel and rerun, with classified failure reasons. Agents run on the user's own machine with
their existing CLI subscriptions, across 32 providers.

### What we should preserve
- Assigning work to an agent as naturally as to a person.
- **One rule** decides whether work starts, with dedupe.
- The live run view with steering, stop and retry.
- A queue of what needs a human.
- PRs linked back to the work.
- The idea of a disposable runtime that claims work.

### What we should not reproduce
- **Unsandboxed agents with prompts bypassed** on members' machines, inheriting their environment.
- **No enforced approval** anywhere: the "confirm" policy is mapped to allow.
- **State that depends on the model**: status changes are prompt instructions.
- **Work that can be lost silently**: the enqueue after commit and the in-process event bus.
- A **3-hour machine-level grace** instead of per-run liveness.
- 32 provider adapters, four redundant schedulers and four tool-access paths.
- Six run surfaces, six IM adapters, plugins, Composio, billing scaffolding.

In all, about 390k lines of server code and 755 migrations accumulated around a loop that is
valuable but ungoverned.

### What FeltKit already gives us (released, tested)
- Durable state with transactions.
- Tenancy, roles and per-call authority, including resource policies.
- The transactional outbox, jobs, schedules and notifications.
- Signed and verified webhooks.
- Recorded HTTP integrations, with unknown outcomes never re-sent.
- Credential custody.
- Live queries.
- MCP and AppPort for every capability.
- Agent sessions with revocation.
- **Person-only approval** of agents' consequential actions.
- Invocation attempts with fencing (in-process).

From the ecosystem, **EVE** provides:
- durable agent sessions that survive a crash (verified self-hosted);
- steering and cancel;
- Docker sandboxes;
- an event stream;
- git/PR skills.

### What is genuinely missing
- **E-1, a remote execution protocol (FeltKit):** a worker elsewhere claims, leases and reports
  under its own identity. It is designed in FeltKit's docs but not implemented, and every
  agent-work product needs it.
- **E-2, approval of agent-owned actions inside the application (FeltKit):** today that is
  Studio-only.
- **E-3, a published AppPort work channel for EVE (ecosystem):** it exists only as an example
  that pushes work and writes progress to its own store.
- **Steering is implemented and tested in FeltKit but unreleased.** It needs a release, not
  design.

### The product we recommend
**A system of record for delegated software work** (working name *Handoff*). A team hands
well-scoped repository work to agents and steps in when it matters. Every result arrives with
the agent's **claims** shown separately from **observed** GitHub facts, and a person
**accepts** it.
- **Control plane:** one FeltKit application, which owns every state transition.
- **Execution plane:** EVE runners with sandboxes, which own nothing in the product.
- **Surfaces:** Desk, Work, Agents, Settings.

### Why it is better
- **Governed:** agents run sandboxed with narrow, revocable authority, and people make the
  consequential decisions.
- **Trustworthy:** claims are never shown as facts, and Accept requires an observed head
  commit.
- **Reliable:** work is queued in the same transaction as assignment. Each run has a lease and
  fenced re-claim, and uncertain effects are reconciled, not repeated.
- **Far less to own:** an estimated 6–9.5k lines of application code and tests for the core
  loop, against a scope-matched Multica lower bound of about 107k non-test lines. That
  advantage depends on FeltKit and EVE being shared platforms (ESTIMATE §5).
- **Given up, openly:** bring-your-own vendor CLI. Agent quality is EVE's, which is the
  highest-risk assumption.

### What the first milestone must prove
**Phase 0** de-risks four things before product code:
- S1: EVE's coding quality against Claude Code on 10 tasks.
- S2: whether a FeltKit invocation can be claimed remotely.
- S3: whether agent control is published in time.
- S4: GitHub through `app.integration`.

**Phase 1** then proves the core loop end to end, in CI, with evidence files:
- create and assign work in one transaction;
- a real EVE agent pushes a branch;
- live events;
- an instruction incorporated;
- a question answered;
- **a SIGKILLed runner recovered by another runner as attempt 2, with no duplicate PR and no
  lost commits**;
- a stop honoured;
- a PR opened by the app and observed;
- review (accept and merge as the person, request changes as a new run, reject).

All of this with zero platform modifications and within the line budget.

### Recommended next step
Approve **Phase 0** (spikes S1–S4, no product code kept) and answer U-02, U-03 and U-04 in
[DECISIONS](DECISIONS.md#unresolved-questions-owner-decisions-needed). In parallel, ask the platform owner about
publishing agent control and prioritising E-1. Phase 1 should start only after S1 confirms EVE's
coding quality.
