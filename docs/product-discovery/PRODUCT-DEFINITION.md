# Product definition

Recommendations, grounded in [MULTICA-AUDIT](MULTICA-AUDIT.md) and [FELTKIT-BASELINE](FELTKIT-BASELINE.md).
Open questions that could change it are in [DECISIONS](DECISIONS.md#unresolved-questions-owner-decisions-needed).

## 1. The underlying job

> *"I have more well-understood software work than people to do it. I want to hand pieces of it
> to agents, keep working on other things, step in when it matters, and get back changes I can
> trust enough to merge, without babysitting a terminal or giving an agent the keys to
> everything."*

Multica proved the demand for this (agents as assignees, a live run, steer and rerun). It
answered with a tracker plus a fleet of unsandboxed CLIs on members' laptops. In that design
nothing governs what an agent may do, "done" is whatever the agent says, and state transitions
depend on the model following its prompt.

## 2. What the product is

**Conceptually: a system of record for delegated work.** The record runs from the request,
through the authority it was given, each attempt and what was observed during it, the human
decisions along the way, and the result someone accepted or rejected. The board and the live
view are projections of that record.

**Working name: Handoff** (see U-01; the name collides with FeltKit's `handoff` playbook, so
treat it as a placeholder). Avoid "CompanyOS": this product is about delegated engineering
work, not company operations.

**Thesis.** Delegation to agents is valuable only when the result is **trustworthy** and the
delegation is **governed**. So:

- The system, not the model, owns every state transition.
- The agent's statements are recorded as **claims**, separate from **observed** facts
  (commits, PRs, CI on GitHub) and from the person's **acceptance**.
- Agents act with explicit, narrow, revocable authority inside an isolated sandbox. Effects
  outside the sandbox go through capabilities the application authorizes and records.
- Runs survive runner crashes. A human can always see what is happening and stop or redirect it.

## 3. Target users

| Who | What they do | What they need |
|---|---|---|
| **Delegator** (primary): a tech lead or senior engineer on a team of 2–20 who already uses coding agents | Writes requests, assigns agents, answers questions, reviews and accepts results | Low-ceremony delegation; one place for everything that needs them; trustworthy evidence at review |
| **Reviewer** (often the same person) | Decides whether a result is acceptable | The diff, CI result and claims vs observed facts, side by side; accept / request changes / reject |
| **Workspace admin** | Connects repositories, registers agents and runners, sets what needs approval | Clear authority settings; runner health; credentials never exposed |
| **Agents** (non-human users) | Claim runs, report progress, ask questions, submit results | A small, typed capability contract; nothing more |

Not the target for v1: large organizations needing guest access, private projects, IM-first
workflows or billing; non-engineering knowledge work (the model generalizes, but prove it on
code first).

## 4. Core objects and relationships

```
Workspace ─┬─ Member (person, role)
           ├─ Repository (GitHub, connected through the workspace's GitHub App installation)
           ├─ Agent (definition ref, model ref, permitted repositories, owner)
           ├─ Runner (an execution environment that hosts agents; registered principal; liveness)
           └─ Work (request: objective, acceptance criteria, repository, requested by, state)
                 └─< Run (one agent's attempt: agent, runner, branch, lease, attempts[], state)
                        ├─< Run event (progress, tool call, command, file change: bounded evidence)
                        ├─< Instruction (person → running agent; steering lifecycle)
                        ├─< Question (agent → person; blocks the run until answered)
                        ├─  Result (agent's claim: branch, commits, PR, summary, test claims)
                        ├─< Observation (fact observed via integration: commit exists, PR, CI status)
                        └─  Review (person's decision: accept / request changes / reject, note)
History: one audit trail per Work, with source = system | agent-claim | observation | person
```

- **Work** is the durable request. **Run** is an attempt; a Work can have several (retry,
  request-changes, a different agent). Rejecting or requesting changes creates a new run that
  carries the feedback; nothing is edited in place.
- An **Agent** is configuration plus identity. Its behaviour (instructions, skills, tools) lives
  in a versioned agent definition (an EVE agent directory in git), referenced by commit, so
  "which agent did this" has a precise answer.
- A **Runner** is where runs execute: a self-hosted EVE deployment with a Docker sandbox,
  either shared on a server or on a member's own machine. It is a principal with its own
  session, never a person's credentials.

## 5. Primary workflows

1. **Delegate.** Write a request (objective, acceptance criteria, repository) and pick an agent.
   The system decides whether a run starts (one rule, as Multica's `WillEnqueueRun`) and queues
   it **in the same transaction**, so it can't be lost.
2. **Run.** A runner claims the run under a lease, checks out a fresh branch `handoff/<work>-<run>`
   in its sandbox and works. Progress is recorded as run events the delegator can watch live.
3. **Steer.** A person sends an instruction. It is durably *received*, delivered at the agent's
   next turn boundary, and the agent acknowledges *incorporated* or *conflict*. Conflict pauses
   the run for a person. Pause and stop are separate, explicit controls.
4. **Ask.** When the agent can't proceed safely, it raises a question. The run waits in
   `needs-input` and the question appears in the delegator's queue. The answer is delivered as
   an instruction.
5. **Recover.** A runner that dies loses its lease. The run shows *stalled*, then is re-claimed
   as a new attempt that is told what the previous attempt did. Effects that might have
   happened (a push) are reconciled against GitHub before being repeated. A person can also
   stop it or reassign it.
6. **Return.** The agent submits a result (claim). The application, not the agent, opens or
   updates the pull request through its GitHub integration and records what GitHub says (PR,
   head commit, CI checks) as observations.
7. **Review.** The reviewer sees claims next to observations and the diff, then accepts
   (optionally merging through the app as themselves), requests changes (new run with
   feedback) or rejects (work closes or is reassigned). Acceptance is a person's decision,
   recorded with who and why.

## 6. Human / agent interaction model

| Principle | Concretely |
|---|---|
| People decide, agents propose | Only a person accepts results, merges, answers questions and approves anything marked consequential. FeltKit enforces "approval by a person" for agent-proposed consequential actions |
| The system owns state | Work and run states move only through application functions with explicit preconditions. An agent's comment never changes state |
| Claims are not evidence | Each history entry carries its source. The review screen never shows a claim as a fact |
| Authority is explicit and narrow | An agent may touch only its permitted repositories, may push only its own run branch, and can't merge. Runners hold no person's credentials |
| Always interruptible | Stop, pause and instruct are always available on a live run. Reassigning or closing the work **stops** its run (Multica doesn't) |
| Nothing is lost silently | Queueing, notifications and GitHub calls go through the transactional outbox or recorded integration calls. Failures are visible states, not log lines |

## 7. Scope

| Now (v1) | Later (earned by usage) | Not carried forward |
|---|---|---|
| Workspaces, members, roles (owner/admin/member) | Triggers from GitHub issues/labels and schedules (Multica's autopilots) | 32 provider adapters (one runtime, many models instead) |
| GitHub repositories via a GitHub App | Agent-proposed consequential actions with in-app approval (needs platform gap E-2) | Squads with prompt-enforced coordination (use sub-work instead, later) |
| Agents, runners, liveness | Runners on members' machines (same runner, local Docker) | Chat as a separate concept (work + instructions cover it) |
| Work → run → events → steer → question → result → observation → review | Slack notifications/intake via EVE's channel | Six IM adapters, plugins, Composio, Connected Apps |
| Inbox of things that need you (FeltKit notifications) | Usage and cost reports (runner-reported) | Billing/entitlements scaffolding, cloud-runtime proxy |
| Failure, stall, re-claim, stop, reassign | Mobile approvals | Guests, share links, private projects (until asked for) |
| Capability access for people's own agents over MCP/AppPort (free with FeltKit) | | Docs/collab editor, custom status catalogs, Gantt/swimlanes, 8 locales |

## 8. Why it is better than Multica

1. **Governed.** Agents run sandboxed with narrow, revocable authority, and people approve what
   matters. Multica runs agents with permission prompts bypassed, on a person's machine, with
   that person's environment and no enforced approval anywhere.
2. **Trustworthy results.** Claims, observations and acceptance are distinct records. Multica's
   "done" is a status the agent was asked to set.
3. **Nothing silently lost.** The run is queued in the same transaction as the assignment, and
   side effects go through the outbox. Multica's enqueue-after-commit and in-process event bus
   can drop work.
4. **Per-run liveness and real recovery.** A lease per run, fenced re-claim and reconciliation
   of uncertain effects, versus a 3-hour machine-level grace.
5. **One run view, one inbox, four top-level surfaces**, versus six run surfaces, 34 routes and
   ~18 settings tabs.
6. **Far less to own.** An estimated 6–9.5k lines of application code and tests over FeltKit and EVE,
   versus Multica's ~390k-line server and ~250k-line shared UI ([ESTIMATE](ESTIMATE.md)). The
   trade-off is explicit: one agent runtime (EVE) instead of every vendor CLI.

## 9. What it gives up (stated, not hidden)

- **Bring-your-own CLI subscription.** v1 runs EVE's own model loop with workspace model keys,
  not the user's Claude Code or Codex subscription. That subscription is part of Multica's
  appeal. It can be revisited as an EVE tool that drives a vendor CLI *inside* the sandbox (U-04).
- **Laptop-first.** v1 favours a shared self-hosted runner. Local runners follow the same
  contract later.
- **Agent coding quality** is EVE's loop, not Claude Code's or Codex's. This is the
  highest-risk assumption ([IMPLEMENTATION-PLAN](IMPLEMENTATION-PLAN.md) Phase 0 measures it).
