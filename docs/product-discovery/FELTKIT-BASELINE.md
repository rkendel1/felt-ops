# Platform and felt-ops baseline

What we can build on, verified against implementation and tests, not documentation alone.
Detailed tables with `file:line` references: [`evidence/F-feltkit-capabilities.md`](evidence/F-feltkit-capabilities.md)
(FeltKit, AppPort Services) and [`evidence/G-eve.md`](evidence/G-eve.md) (EVE).

## 0. What was inspected

| Component | Source inspected | Version treated as baseline | Notes |
|---|---|---|---|
| FeltKit (`@feltdb/feltkit`) | installed dist + docs in `felt-ops/node_modules`; source `rkendel1/feltkit` at `b0222f6` (package 0.3.37) | **0.3.34**, the version felt-ops' lockfile installs | npm `latest` is 0.3.36. FeltKit's CHANGELOG calls 0.3.36 "prepared (unpublished)", which contradicts npm (see DECISIONS U-07) |
| AppPort Services | nested `@appport/services` 0.20.0 | 0.20.0 | |
| FeltDB | nested `@feltdb/core` 0.22.0 | 0.22.0 | |
| AppPort SDK/core/MCP/integration, Resolver client | `felt-ops/node_modules/@appport/*` | sdk 1.10.0, core 1.9.0, resolver-client 0.3.0 | |
| EVE | `rkendel1/eve2` at `50f1cf1` (a squashed clone) | published as `@appport/eve` 1.0.2 | The fork of `vercel/eve`. Not referenced anywhere in FeltKit's source |
| AppBoundry, Resolver server, AuthBoundry, Intent | FeltKit docs and source references only | — | Their repositories were not inspected. Statements about them come from FeltKit's own audits and are labelled so |
| felt-ops (CompanyOS) | full repository at `ca3ba58` | — | `npm test` re-run on 0.3.34: **9/9 pass** (2026-11-23; rewritten evidence files kept out of the repo) |

## 1. FeltKit 0.3.34: what is real

Status: **R** = released in 0.3.34 and covered by tests · **L** = published later (0.3.35/0.3.36) ·
**U** = unreleased, source only (with tests) · **P** = partial · **M** = missing.

| Need for this product | Status | What exists | Limit that matters here |
|---|---|---|---|
| Durable app state, indexes, uniques, migrations, sequences | R | `app.collection`, `ctx.db.*`, `ctx.db.sequence`, state contracts; managed contract carries uniques/indexes (G-15 closed) | — |
| Live UI | R | `useQuery` over SSE `/api/events` with predicate re-run | Invocation-store and FeltDB agent-state writes are **outside** the change feed (agent actions stream polls every 2–10 s) |
| Tenancy (workspaces) | R | `auth.tenant`, memberships, invitations, per-tenant roles, `ctx.tenancy.members()` | One session = one tenant at a time; a collection without a `tenant` field is silently shared (GAP-13) |
| Roles, per-call authority, resource policies | R | roles → permissions; `app.policy`, `owner`, `authorize` hook (G-06 closed) | — |
| Account disable / role change (G-01) | P | `AccountStore.setDisabled/setRoles` exist; nothing calls them | No admin capability |
| Session revoke (G-02) | R (operators) | online revoke by principal (CLI, admin API); `onSessionEnd` | Not an application capability |
| Agent principals and sessions | R | `type: agent` sessions, revocable, checked per request at `/mcp`, `/appport` | — |
| Capabilities over MCP/AppPort | R | every function with `capability` is an AppPort capability and an MCP tool; output schemas; idempotency | Direct MCP calls are not linked to an agent task |
| Agent tasks: propose → **person approval** → execute as owner → evidence | R | `AgentHost` (`runtime/agent.ts`); `approve` refuses non-`user` principals (`:1006`, checked); digest-bound approval; checkpoints verified at commit; restart reconcile | **G-07 partly open.** An external agent's task is agent-owned and its actions can be approved **only in Studio**. App code can't read tasks (`ctx.agent` absent from queries) and can't retry/resolve/cancel |
| Steering a running agent (signal/submit/pause/resume/interrupt/stop, checkpoint/acknowledge) | **U** | `runtime/agent-control.ts`, HTTP + SSE, MCP tools, `appport.agent-control/1`; 13 tests incl. an external MCP agent | Not published. No agent loop runner: something outside must restart a reasoner |
| Invocations with attempts, leases, fencing, recovery | R | `ctx.invocations.accept/start/progress/transition/cancel`; claim token; CAS; `CLAIM_LOST`; re-claim creates a new attempt with `previous`; recovery **reports** stalled leases | All tests run in-process. **Visibility:** only the requesting person or the delivering principal can see an invocation (`invocations.ts:262-267`, checked), so a separate worker principal can't claim a person's invocation |
| Person approval of `awaiting_approval` invocations | **L** (0.3.35) | `POST /api/invocations/<id>/approve` with digest | In 0.3.34 a worker could resume without approval (the defect fixed in 0.3.35) |
| Remote worker protocol (a process elsewhere claims work under its own identity) | **M** | EXECUTION.md: "designed, not implemented" (checked). Only adapter: in-process `managed` job, 15-min deadline | Gap E-1 |
| Runtime components with durable work | R | in-process routes/WebSocket; `ctx.afterCommit.work` → `ctx.work.claim/finish`, leased, version-fenced | Runs inside the app process; no lease renewal; daemon auth would be ours to build |
| Command execution, workspaces, local git | R (platform server only) | `feltkit platform serve`: sandboxed `command.run` (allow-list node/npm/git/feltkit), workspaces, local git | A developer-operations server over FeltKit projects, **not** callable from application functions; no push/PR |
| Jobs, schedules | R | AppPort Services jobs (durable lease/retry), schedules | Handlers run in-process; scheduled jobs carry no workspace (GAP-REGISTER) |
| Transactional outbox | R | `ctx.afterCommit.{notifications,webhooks,jobs,agent,work}` | Anonymous callers can't stage |
| Notifications inbox | R | `ctx.services.notifications.*`, paging, unread count | In-app only; e-mail only for account mail |
| Webhooks | R | signed outbound; verified inbound `/webhooks/inbound/<id>` with replay checks | Production replay disabled |
| HTTP integrations | R | `app.integration`: recorded calls, idempotency, verify probes, unknown outcomes never re-sent; OAuth2 credentials; per-person connections | **G-09 open:** a failing `onOutcome` is only logged |
| GitHub | M (sign-in only) | GitHub/Google sign-in | No GitHub API/PR/check client; build it on `app.integration` (felt-ops did) |
| Credential custody | R | `credential-ref:<id>` → env or vault | — |
| Server-side models | R | `ctx.model.generate` (OpenAI, OpenAI-compatible, Anthropic) in actions; Resolver `ref://` for models only | — |
| Search, files | R | `ctx.db.search` (bounded scan, no ranking); files service | — |
| Audit / history | R / P | `app.auditTrail`, sequences; bounded activity log; `_feltkit_decisions` admin-only | G-08: no application-readable activity |
| Usage/cost metering (G-14) | M | per-generation usage only for in-app generations | External agents are not metered |
| Presence / transient signaling | M | proposal; tests are `test.todo` | — |
| "EVE" in FeltKit | M | Not referenced by FeltKit source | EVE is a separate project (§2) |
| "Intent" engine | not wired | FeltDB `IntentService` is a development planner over `.flow` contracts; `record_intent` is unbound in TypeScript (FeltKit `docs/M1-AGENT-FOUNDATION-AUDIT.md:109-111`) | Not usable as a runtime workflow engine for this product |

## 2. EVE (`rkendel1/eve2`, published as `@appport/eve`)

A filesystem-first framework for durable AI agents: an agent is a directory (`instructions.md`,
`tools/`, `skills/`, `channels/`, `schedules/`) compiled into a server. Each session is a
durable workflow run, checkpointed per step.

| Need | Status | Facts | Limit |
|---|---|---|---|
| Durable session survives crash | Verified self-hosted (local SQLite world) | SIGKILL-and-resume scenario test | Postgres world has plumbing tests only; multi-replica not verified. Upgrading the version strands in-flight sessions on self-hosted worlds |
| Steering, cancel | Verified | `turnPolicy` steer/queue (`input-queue.ts:167`); cancel/clear/compact/end routes | No operator **pause** |
| Tool approval | Verified | per-tool approval policies | Approval is EVE's own, not FeltKit's |
| Sandbox | Verified (Docker, self-hosted) | Docker, Vercel Sandbox, just-bash, custom | Docker networking is allow-all or deny-all; **no credential brokering**, so secrets enter the sandbox |
| Coding | Partial | Own model + tools loop (AI SDK; direct Anthropic/OpenAI keys). `eve-code` (468 lines): coding instructions, AGENTS.md, gh tooling. `eve-git` (1,422): a `pr` skill (commit, push, `gh pr create --draft`), optional brokered `git__gh` tool (needs Vercel Connect or your own broker) | **No in-repo test of clone → edit → test → push → PR with a real model.** Does not wrap Claude Code/Codex |
| Observability | Verified | NDJSON session event stream (`turn.*`, `call.*`), transcripts, OpenTelemetry, token usage | USD only when the AI Gateway reports it |
| Work from an AppPort app | Example only | `examples/appport-agent`: the app pushes `POST /work` (JWT + Idempotency-Key); the app polls `GET /work/:id`; an operation ledger uses operation ids as AppPort idempotency keys; a completion gate requires recorded evidence; operator settle; 15-min stall detection | Not published. Progress is written to the **agent's own** FeltDB, not the app's. No callback, no work-level steer/cancel, one process per work store |
| Self-hosting off Vercel | Mostly | Node + local world verified | Sandbox network policy, credential brokering, `eve deploy` and the dynamic-schedule default are still Vercel-only |
| Size | — | `packages/eve/src` ~283k non-test lines (+ ~246k colocated tests) | Ecosystem-owned code, not app-owned |
| CI | — | The fork's own assessment says eve2's CI has never run on a PR (`HOSTED-READINESS-ASSESSMENT.md`) | Release-quality risk |

## 3. felt-ops (CompanyOS) as an existing product

Facts from its docs and code: 27 collections, 93 functions, 23 published capabilities, 9 tests and
7 scenarios. Product code is 3,650 non-blank lines (backend 2,549, frontend 1,101; EXTRACTION-AUDIT).
It is pinned at `^0.3.34`, but its code and docs describe the 0.3.13 platform: the workarounds
for gaps closed since (G-06, G-15) are still in place.

### Classification of what felt-ops contains

| Part | Classification | Relevance to this product |
|---|---|---|
| `agents` registry, `assignments`, interventions, reassign, `verify` with verifier functions, `metrics` (`feltkit/agents.ts`, 416 lines) | **Reusable product capability (pattern)** | The closest existing model of "work delegated to an agent". Reuse the *shape*: objective / context / constraints / permitted capabilities / verifier; claims as assertions; verification separate from claims; operator interventions; reassignment chain. Not the code as-is: it is coupled to CompanyOS verifiers and `people` |
| `timeline` + `record()` with `source: platform \| assertion \| verification \| operator` | **Reusable pattern** | Exactly the claim/evidence/verification separation this product needs. Implement on `app.auditTrail` (released) rather than a hand-rolled collection |
| `externalRefs.observedVia` (`integration:<call id>` / `computed` / `reported`) and the `github.*` integration (`integrations.ts`) | **Reusable capability** | The PR/commit/CI-observation pattern. Lift the GitHub integration operations |
| `agents/runner.ts` (MCP client, deterministic playbook) | **Road-test infrastructure** | Proof that an external process can work assignments over MCP with crash recovery (Scenario 6 live). Not a coding agent |
| Organization, purchasing, finance, policies, customers, incidents, changes, releases | **CompanyOS-specific business domains** | Out of scope. Changes/releases overlap conceptually with "work → PR → release" but encode CompanyOS's gates |
| `_lib.ts actor()` (departed/suspended refusal) | **Temporary workaround** (G-01/G-02) | Still needed in part: G-01 is open in 0.3.34 |
| `_scope.ts withinAssignment()` + hand-kept capability→permission map | **Workaround** (G-04) + duplication | Avoid. Narrow agents with per-agent grants (`ctx.authority.grants`, released) and app policy instead |
| `useAgentTask` / `mcpTool` (browser JSON-RPC to `/mcp`), "last heard", Studio deep links | **Workarounds** (G-07, F-047) | Avoid by design (see ARCHITECTURE §4) |
| Scenarios, operator-eval harness, supplier API, demo deploy, evidence files | **Road-test infrastructure** | Reuse the *method* (scenario tests that write evidence, live process-kill scenario) |
| Three hand-written MCP clients | Unnecessary duplication | One shared client if needed |

### Lessons felt-ops already paid for (evidence: its docs)

- FeltKit's propose → approve → execute-as-owner → evidence lifecycle held on every interface,
  including real process crashes and session revocation (Scenarios 3, 5, 6 live).
- The operator experience fragmented across the app, Studio and a terminal (operator eval:
  3–6 context switches per approval workflow). **An agent-work product can't put its central
  decision in Studio.**
- Liveness had to be inferred from the agent's last write (no heartbeat in FeltKit).
- Usage was self-reported by agents and labelled as such.

## 4. Platform summary for this product

- **Strong and released:** durable state, tenancy, authority, the outbox, live queries, the
  integration-call record, jobs and schedules, notifications, inbound/outbound webhooks,
  credential custody, the agent proposal/approval lifecycle, and invocation attempts with
  fencing (in process).
- **Implemented, not published:** steering (agent control) and invocation approval for 0.3.34
  users.
- **Missing and relevant:** a remote worker protocol; approval of agent-owned actions outside
  Studio; app-readable agent state; usage metering; GitHub built-ins.
- **Available elsewhere in the ecosystem:** EVE provides the agent loop, sandbox, steering and
  durable sessions. Its AppPort work contract exists only as an example.
