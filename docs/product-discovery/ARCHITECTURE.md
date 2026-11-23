# Proposed architecture

> **Phase 0 amendments** ([RESULTS](phase-0/RESULTS.md)):
> - Leases, attempts and fencing use FeltKit invocations with one runner-pool principal (D-06′), not an app-owned lease.
> - Steering uses published agent control (D-07′).
> - GitHub is polled, not received by webhook (D-08′).
>
> Sections below that say otherwise are superseded.

A recommendation. Each component is used only where its implementation supports it
([FELTKIT-BASELINE](FELTKIT-BASELINE.md)); where it doesn't, the gap is named and the interim
is kept small and replaceable.

## 1. System

```
 People (browser)                     People's own agents (Claude Code, Codex…)
 React app ── live queries            MCP /mcp · AppPort /appport (create/inspect work)
      │ HTTP                                   │
      ▼                                        ▼
 ┌──────────────────── Handoff: one FeltKit application (control plane) ───────────────────┐
 │ Identity, tenancy, roles, per-call authority (FeltKit)                                │
 │ Domain functions: work · runs · events · instructions · questions · results · reviews │
 │ Outbox (ctx.afterCommit): jobs, notifications ── AppPort Services                      │
 │ app.integration "github": branch / pulls / checks / merge / installation token        │
 │ Inbound webhooks: GitHub pull_request, check_suite → observations                     │
 │ Runner capabilities (AppPort, role `runner`): heartbeat · claim · report · ack ·       │
 │   ask · submit · fail          ← the only door the execution plane uses               │
 └──────────────────────────────────────┬────────────────────────────────────────────────┘
                                        │ one FeltDB instance per environment
                                        ▼  (all authoritative product state)
 ┌──────── Runner (execution plane, separate deployable, disposable) ────────┐
 │ EVE server (self-hosted, local workflow world)                            │
 │  └ runner adapter (EVE channel/extension): pull-claim, report, steer, submit │
 │  └ EVE agents (definitions in git @ commit): instructions, skills, tools  │
 │  └ Docker sandbox per attempt: fresh clone, branch handoff/<work>-<run>   │
 └───────────────────────────────────┬───────────────────────────────────────┘
                                     ▼
                     GitHub (authoritative for commits, PRs, checks)
                     Model providers (keys runner-side, by reference)
```

**One control plane.** The FeltKit application owns every product state and transition. EVE is
the execution plane. It owns how an agent reasons and runs commands, and nothing in it is
authoritative for the product. GitHub is authoritative for code facts. There are no sidecars,
no second database for product state and no orchestration outside FeltKit. The runner adapter
is a client of the application's capabilities, like any agent.

## 2. Ownership and state classification

| State | Owner (authoritative) | Class | Durable? | Notes |
|---|---|---|---|---|
| Workspaces, members, roles, sessions | FeltKit | platform | yes | — |
| Repositories, agents, runners (registry) | App collections | application | yes | Agent behaviour itself lives in git (EVE definition @ commit) |
| Work, runs, attempts, leases | App collections | application + execution control | yes | Interim for E-1; leases are app records, not process memory |
| Run events (progress, tool calls, commands, files) | App collection | evidence (agent-reported) | yes, bounded | Written by the runner; source = agent claim |
| Instructions (steering) | FeltKit agent control (when published) or app collection | application | yes | See D-07 |
| Questions, results, reviews | App collections | application | yes | Reviews are person decisions |
| Observations (branch head, PR, checks, merge) | App collection, written from recorded integration calls or verified webhooks | evidence (observed) | yes | GitHub remains authoritative; the observation cites the call id or delivery id |
| History | `app.auditTrail` per work, `source: system \| agent \| observation \| person` | evidence | yes | Written in the same transaction as the change |
| Notifications | AppPort Services | platform | yes | Projections of state, sent via the outbox |
| EVE session state, sandbox filesystem, model context | EVE / runner | external, transient | EVE-durable, not authoritative | Lost runner = lost session; the app recovers from its own records |
| Live stream to the browser | FeltKit live queries | projection | no | Rebuilt from collections |
| Desk queue, run phase, runner liveness, metrics | Derived in queries | projection | no | Never stored as state |
| Commits, PRs, checks | GitHub | external | yes | — |
| Secrets (GitHub App key, model keys) | FeltKit credential custody / runner config / Resolver refs | external | yes | Never in app records; never in events |

## 3. State machines

### Work

| State | Meaning | Entered by |
|---|---|---|
| `open` | Requested, no active run | `work.create`; a run ended without acceptance |
| `active` | Has a run that is not finished | `work.assign` (same transaction as the run insert) |
| `in-review` | The latest run submitted a result | `runs.submit` |
| `done` | A person accepted (and the PR merged, or merge was explicitly skipped) | `reviews.accept`; observed merge |
| `closed` | A person closed it without acceptance | `work.close` (stops any active run) |

### Run (one agent, one assignment)

```
queued ─claim─▶ running ⇄ needs-input (ask / answer)
   │              │  ⇄ paused (person pause / resume)
   │              ├─submit─▶ submitted ─review─▶ accepted | changes-requested | rejected
   │              ├─fail───▶ failed
   │              └─lease expires─▶ stalled ─claim─▶ running (new attempt) | failed (attempts exhausted)
   └──────────────── stop (person), reassign, close ─▶ stopped   (from any non-terminal state)
```

| Transition | Function | Actor | Deterministic? | Authority check | Idempotency | Recovery |
|---|---|---|---|---|---|---|
| create run | `work.assign` | person | yes (start rule) | member; agent permitted on the repo; runner capacity not required | one non-terminal run per work (unique index on `work`+`active`) | in-transaction insert: nothing to lose |
| claim | `runs.claim` | runner | yes (oldest queued run whose agent the runner hosts) | `runner` role; runner active; run placed on it or unplaced | returns the existing attempt to the same runner + key | lease; CAS on `__version` |
| heartbeat / report | `runs.report` | runner | yes | claim token matches current attempt | event `seq` per attempt; duplicates ignored | renews lease; returns control state and pending instructions |
| ask / answer | `runs.ask`, `questions.answer` | runner / person | yes | claim; member | question key | answer becomes an instruction |
| pause / resume / stop | `runs.pause/resume/stop` | person | yes | member (stop also: work owner, admin) | state-guarded | the runner sees it at its next report (≤ report interval) |
| submit | `runs.submit` | runner | yes | claim; result branch = the run's branch | result key = attempt | enqueues `github.observe` + `github.openPr` jobs in the same transaction |
| observe | job → `app.integration` | system | yes | job runs as the system principal with `github.*` | integration idempotency key = run id + op | recorded call; unknown outcomes verified, never re-sent |
| review | `reviews.accept/requestChanges/reject` | person | yes | member; not the runner; accept requires ≥ 1 observation of the result's head commit | one review per run | accept may call `github.merge` as the person |
| stall | job `runs.sweep` (schedule, every minute) | system | yes | system | state-guarded | marks `stalled`; notifies; re-claim allowed up to `maxAttempts` (default 3) |
| fail | `runs.fail` / sweep | runner / system | yes | claim / system | attempt-scoped | closed failure reason set |

**No AI decides a transition.** AI (EVE's model loop) decides what code to write and when to
ask. Every state change is a function with a precondition.

## 4. The runner contract (application capabilities)

Published as AppPort capabilities with input/output schemas, callable only by principals with
the `runner` role. The adapter in EVE is their only client. Summary:

| Capability | Input (essentials) | Output | Notes |
|---|---|---|---|
| `runners.heartbeat` | runner id, version, capacity, hosted agent keys | desired state (active/draining) | liveness = last heartbeat; projection only |
| `runs.claim` | runner id, idempotency key | run snapshot: work objective and acceptance criteria, repo, base commit, branch, agent definition ref, pending instructions, previous attempts' outcomes, claim token, lease, **short-lived GitHub installation token** | `null` when nothing to do; token minted via the `github` integration and never stored |
| `runs.report` | run id, claim, events[] (seq, type, payload ≤ N KB), usage? | control (`running`/`paused`/`stopping`), instructions to deliver now | renews the lease; the runner calls it at least every 30 s |
| `runs.acknowledge` | run id, claim, instruction id, `incorporated`/`conflict`, note | — | conflict → run `paused` for a person |
| `runs.ask` | run id, claim, question | — | run → `needs-input`; notifies the delegator |
| `runs.submit` | run id, claim, branch, head sha, summary, claimed test results | — | → `submitted`; the app observes before anyone reviews |
| `runs.fail` | run id, claim, reason (closed set), detail, `effect: none \| possible` | — | `possible` makes the next attempt reconcile the branch first |

The adapter's loop: claim → create sandbox → clone at the base commit → start an EVE session with
the objective → on each turn boundary call `report` (events since the last call, renew lease,
receive control and instructions; inject instructions with `turnPolicy: steer`; stop when told)
→ push branch → `submit` (or `ask` / `fail`).

## 5. Authority and approval

| Action | Who | How it is enforced |
|---|---|---|
| Create work, assign, steer, answer, pause, stop | members | FeltKit roles + application preconditions |
| Register agents, runners, repositories; set policies | admins | roles |
| Claim, report, ask, submit, fail | the runner principal, for runs it claimed | `runner` role + claim token fencing |
| Push to the run's branch | the sandbox, with an installation token scoped to one repository | GitHub App permissions; a required ruleset on the default branch (checked at repo connect as a precondition) |
| Open/update the PR | the application (system), not the agent | recorded integration call |
| Accept / merge | a person | application function; merge runs as that person's decision through the integration |
| Agent-proposed consequential actions (e.g. "deploy this") | not in v1 | needs E-2; then `approval: "required"` with person-only approval in the app |

An agent never holds a person's credentials, can't merge, and can't change product state except
through the runner capabilities. Revoking a runner's session stops its next call. Stopping a run
stops its next report.

## 6. Evidence

- **Claims**: run events, results and usage, written by the runner (`source: agent`).
- **Observations**: branch head, PR, checks and merge, from integration calls (citing the call
  id) or verified webhook deliveries (citing the delivery id), written by the app
  (`source: observation`).
- **Decisions**: answers, pauses, stops and reviews by people (`source: person`), with the
  principal from FeltKit.
- The review screen requires at least one observation of the submitted head commit before
  **Accept** is enabled. The agent's word alone is never enough to accept.
- Run events are bounded: per-event payload cap, per-run count cap, and large outputs truncated
  with a marker. They are evidence of activity, not a full transcript archive (D-09).

## 7. Failure and recovery

| Failure | Detection | Outcome |
|---|---|---|
| Runner process crash / machine loss | lease not renewed (default 2 min) → sweep | run `stalled` → re-claimed as attempt n+1 with `previous`; the branch is reconciled against GitHub first (observe the remote head; continue from it or reset) |
| Runner restart (EVE durable session survives) | same runner re-claims with its key | same attempt continues if the claim is still valid; otherwise a new attempt |
| Sandbox failure, model error | runner `fail` with reason | `failed`; a person retries or reassigns |
| Stale runner after re-claim | its claim token no longer matches | refused (`CLAIM_LOST`); its events are discarded |
| GitHub call outcome unknown | integration records `unknown` | verify via probe (`github.pulls.get`), never re-send blindly |
| App restart | durable records, outbox, jobs | nothing in memory to lose; jobs resume |
| Person stops during a push | `stopping` returned at the next report | the push may have happened. The branch is observed; the run is `stopped` with the observation |

Agent work isn't exactly-once at the external-effect level (FeltKit EXECUTION.md §Safety says
the same). The design makes repeated effects harmless: one branch per run, PR creation keyed by
run id, and observation before repetition.

## 8. Secrets

- GitHub App private key: FeltKit credential custody (`credential-ref:github-app`). The app
  mints installation tokens per claim through a recorded integration call; the token value is
  returned to the claiming runner only and never stored or logged.
- Model keys: runner-side configuration or Resolver `ref://` models. The app stores the
  reference on the agent, never the key.
- Sandbox: receives only the installation token (repo-scoped, ≤ 1 h) and model access as EVE
  provides. A deny-all network policy plus an allow-list is a Phase 2 hardening item: Docker
  supports only allow-all/deny-all today (EVE gap).
- Run events are scrubbed by the adapter before reporting (token patterns), and the app refuses
  events containing the active installation token's prefix.

## 9. Evolution without coupling

- The app depends on its own capability contract, not on EVE internals. Replacing EVE (or adding
  a vendor-CLI tool inside the sandbox) changes the runner adapter only.
- Models are references; providers change without schema changes.
- The interim lease (E-1) mirrors `feltkit.execution/1` names (invocation → run, attempt, claim,
  lease, `previous`, `unknown`), so moving to the platform protocol is a data mapping, not a
  redesign.
- Steering uses FeltKit agent control as soon as it is published (D-07). The interim
  `instructions` collection has the same states.
- Schema changes are additive; FeltKit state contracts refuse destructive evolution.

## 10. Deliberately not used

| Component | Why not (now) |
|---|---|
| FeltKit invocations for runs | Visibility excludes a separate worker principal; remote use untested (Phase 0 spike may reverse this; D-06) |
| AgentHost proposals for runner effects | Agent-owned approvals are Studio-only (E-2); v1 keeps consequential effects as person or app actions |
| FeltKit platform server (`command.run`) | A developer-operations server for FeltKit projects, not an application primitive |
| AppBoundry | Doesn't host the invocation store or agents; nothing here needs a portable artifact |
| Intent | Not wired into FeltKit runtime |
| AuthBoundry delegation | Local-only on `/appport`; v1 needs no on-behalf-of chain (runs act as the runner under app rules). Revisit for "agent acts for a person" |
| Resolver beyond models | Wired only for models in FeltKit; Resolver is not deployed |
