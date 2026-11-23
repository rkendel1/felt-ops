# Estimate and ownership analysis

These are estimates. The method and inputs are shown so they can be challenged. Line counts are
non-blank lines unless noted. Multica counts are `wc -l` from the audit (evidence A–E), and
felt-ops counts are from its EXTRACTION-AUDIT and a re-measurement on 2026-11-23.

## 1. Expected domain model

| Collection | Purpose | Notes |
|---|---|---|
| `repositories` | Connected GitHub repositories, installation id, default branch, ruleset observed | tenant-scoped |
| `agents` | Definition ref (repo@commit), model ref, permitted repos, owner, status | identity = FeltKit agent/runner principal |
| `runners` | Registered runner, session principal, version, capacity, last heartbeat, state | liveness derived |
| `work` | Request, acceptance criteria, repo, base, requester, state, number | unique `(tenant, number)` |
| `runs` | Work, agent, runner, branch, state, attempt, claim, lease, previous[], failure | unique active run per work |
| `runEvents` | Typed, bounded events per run/attempt with `seq` | the largest collection; capped |
| `instructions` | Interim steering records (if agent control is unpublished) | same states as FeltKit agent control |
| `questions` | Agent → person, answer | — |
| `observations` | Facts from GitHub with call/delivery id | — |
| `reviews` | Person decisions | — |
| audit trail `work` | History with source | `app.auditTrail` |

**10–11 collections**, against felt-ops' 27 and Multica's 191 `CREATE TABLE` statements.

## 2. Expected functions and capabilities

| Area | Functions (≈) | Examples |
|---|---|---|
| Work | 7 | create, update, assign, close, list, get, search |
| Runs (person side) | 7 | pause, resume, stop, retry, reassign, get, events |
| Runner capabilities | 8 | heartbeat, claim, report, acknowledge, ask, submit, fail; sweep job |
| Steering and questions | 3 | instruct, answer, withdraw |
| Review | 3 | accept (+merge), requestChanges, reject |
| Registry | 10 | agents register/update/setStatus/list/get; runners register/drain/revoke/list; repos connect/list/disconnect |
| GitHub integration ops | 6 | installationToken, branchHead, pullsOpen, pullsGet, checks, merge |
| Jobs and webhooks | 4 | observe, openPr, sweep, inbound GitHub handler |
| Desk | 1–2 | needsMe, inFlight |
| **Total** | **≈ 50** | felt-ops: 93 functions, 23 published capabilities |

## 3. UI surfaces

| Surface | Complexity driver |
|---|---|
| Desk | three derived queues |
| Work list + new-work dialog | modest |
| Work detail: request, live run panel (events, instruct, pause/stop, question), result/review (claims vs observations), history | **the dominant UI cost** |
| Agents + runners | modest |
| Settings: members, repositories, authority, credentials | modest |

## 4. Application-specific code estimate

Method:
- **Backend:** felt-ops averages ~27 lines per function (2,549 / 93), with CompanyOS's dense
  business rules. This product's functions are thinner, but the run state machine, lease and
  GitHub integration are denser. Range: 30–45 lines × 50 functions, plus fixed parts.
- **Frontend:** felt-ops built 16 workspaces in 1,101 lines of simple tables. The live run view
  and review comparison are heavier.
- **Runner adapter:** EVE's `examples/appport-agent` is 2,322 non-test lines, but it includes its
  own operation ledger, store and recovery that this design keeps in the app. Range: 30–50% of it.

| Category | Estimate | Basis |
|---|---|---|
| Domain logic (work, runs state machine, reviews, questions) | 900–1,300 | ~30 functions × 30–45 |
| Execution orchestration (claim, lease, report, sweep, re-claim): interim for E-1 | 250–400 | mirrors `feltkit.execution/1`; replaced when E-1 ships |
| Authorization (roles, policies, preconditions) | 100–200 | mostly declarative in FeltKit |
| Integrations (GitHub ops, webhook handler, observations) | 300–450 | felt-ops `integrations.ts` is 222 lines for three read ops plus a supplier API |
| State management (client) | ~0–100 | live queries; no client store beyond UI state |
| Infrastructure (app-owned) | ~50 | app definition, services config |
| **Backend subtotal** | **1,600–2,500** | |
| UI | 1,800–2,800 | Work detail ~40% of it |
| Runner adapter (EVE extension) | 700–1,200 | intended to become E-3 |
| **Product code** | **≈ 4,100–6,500** | |
| Tests and scenarios | 1,800–3,000 | 10 Phase 1 scenarios + unit; felt-ops: 725 test + 879 script lines for 7 scenarios |
| **Total app-owned** | **≈ 6,000–9,500** | |

## 5. Comparison with Multica (ownership, not just lines)

A scope-matched Multica lower bound, counting only what Multica owns to deliver the same core loop
(work → assign → run on a machine → stream → steer → result → PR link → review), non-test:

| Responsibility | Multica owns | This product owns | Who owns it instead |
|---|---:|---:|---|
| Task lifecycle server (service + daemon handlers + SQL) | ~22.7k | ~1.2–1.7k | FeltKit transactions, outbox, authority |
| Machine-side execution (daemon, excluding provider adapters) | ~56k | adapter 0.7–1.2k | EVE (sandbox, loop, durable session) |
| Provider adapters (3 providers, of 32 at 47.6k) | ~8k (≈ claude + codex + one more) | 0 | EVE + AI SDK model providers |
| Auth, workspace, members | ~6.6k | ~0.1k | FeltKit accounts, tenancy, roles |
| Events/realtime | ~3.7k | 0 | FeltKit live queries |
| GitHub/VCS | ~5.6k | ~0.3–0.45k | `app.integration` + inbound webhooks |
| Notifications/inbox | ~4.2k | ~0.06k | AppPort Services notifications |
| **Backend + machine side, lower bound** | **≈ 107k** | **≈ 2.3–3.7k** | |
| Tests for the same | ≈ 200k+ (daemon alone 97k) | 1.8–3k | |
| Web UI for the same surfaces | a large share of `views` (issues 55.7k, agents 19.9k, runtimes 15.7k) | 1.8–2.8k | FeltKit React client |

Caveats (stated, not hidden):
- Multica serves far more scope: 32 providers, IM channels, autopilots, squads, chat, mobile,
  desktop, 8 locales, cloud billing. The table compares **only the core loop**.
- The ecosystem still owns code: FeltKit (~40k lines of published JS), EVE (~283k non-test lines
  in `packages/eve/src`). The economic advantage is that **the application team** owns ~3% of
  the core-loop code. The same owner maintains FeltKit and EVE, so the organization's total
  ownership falls only to the extent those platforms are reused by other products. That is
  the ecosystem bet, and it should be measured, not assumed.

## 6. Reuse from felt-ops

| Reuse | Form | Lines (approx.) |
|---|---|---|
| Claim/observation/verification separation (`timeline.source`, `externalRefs.observedVia`) | pattern, re-implemented on `app.auditTrail` | design reuse |
| GitHub integration ops | adapt `feltkit/integrations.ts` github parts | ~80–120 lines adapted |
| Assignment shape and interventions (`feltkit/agents.ts`) | pattern | design reuse |
| Scenario-with-evidence test method; live process-kill scenario | method | — |
| Agent runner (`agents/runner.ts`) | **not reused**: a deterministic MCP playbook, not a coding agent | 0 |

## 7. Code that must not be carried over

- From felt-ops: `actor()` employment checks (CompanyOS-specific), `withinAssignment` and the
  hand-kept capability map (G-04 workaround with drift), browser MCP calls (`useAgentTask`),
  Studio deep links, "last heard" inference.
- From Multica: provider adapters and per-OS shims, compatibility maps for old daemons, Redis
  projection stores, the in-process event bus, prompt-driven status changes, browser-side cost,
  runtime sharing, unsandboxed execution with an inherited environment.

## 8. Complexity drivers (ranked)

1. **Live run view** (event volume, ordering, steering state, claims vs observations).
2. **Recovery correctness** (lease, fencing, branch reconciliation, no duplicate PR).
3. **Runner adapter over EVE** (turn-boundary steering, pause enforcement EVE lacks, event
   mapping).
4. **GitHub App** setup, tokens and webhooks.
5. **Sandbox security** (network egress, secret scrubbing).

## 9. Highest-risk assumptions

| Assumption | If wrong | How it is tested |
|---|---|---|
| EVE's coding loop is good enough for real repository work | product fails on quality | Phase 0 S1 against Claude Code headless |
| Self-hosted EVE (local world, Docker) is stable for multi-hour runs | stalls, lost sessions | Phase 1 live scenarios; soak test |
| A team will accept a hosted/self-hosted runner instead of their own CLI subscriptions | adoption | U-04 user interviews; Phase 4 local runner |
| The interim lease stays small and is replaced by E-1 | a second orchestration system grows inside the app | line budget (≤ 400) as a Phase 1 exit measure |
| FeltKit publishes agent control | interim steering code persists | S3 |
| Run events fit comfortably in FeltDB at team scale | storage or latency issues | event caps; measure at 100 runs × 2k events in Phase 2 |
