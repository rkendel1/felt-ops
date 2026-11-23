> Working notes from a read-only audit pass (2026-11-23). Produced by an audit agent from source, SQL, tests and docs; the discovery author spot-checked the claims used in decisions (see ../DECISIONS.md, "Verification of audit notes"). Paths are relative to the audited repository unless absolute. Treat unverified rows as leads, not facts.

# G — EVE (rkendel1/eve2) as the execution runtime for a FeltKit "agent work platform"

Repo: /home/user/rkendel1/eve2 (shallow clone, 1 commit: 50f1cf1, 2026-11-18, "Merge PR #23 claude/dreamy-galileo-4z03p5"). Read-only audit; no tests were run here. "Verified" below means: implementation present in source AND covering tests exist in the tree (test results quoted only from audit docs, not re-run).

Labels: VI = Verified implemented, PI = Partially implemented, CID = Configured/integration-dependent, DU = Documented but unverified, M = Missing.

---

## Facts

### 0. Size (LOC, `cat | wc -l`)
- packages/eve/src non-test: ~282.7k lines / 2,074 files (includes ~3.9k generated model metadata). Tests colocated in src: ~245.7k lines / 1,200 files. packages/eve/test (scenarios, TUI): ~23.4k.
- packages/eve-code: extension+agent 468 lines; tests 626.
- packages/eve-git: extension 1,422 lines; tests 1,931.
- packages/tracing (`@vercel/agent-runs`): ~4.3k non-test.
- examples/appport-agent: agent 2,504 lines (work.ts 314, operations.ts 787, appport.ts 451, work.ts lib 423, recovery.ts 261); host ~590; tests ~7,000 (node:test).

### 1. What an eve agent is; durable execution model
- An agent is a directory (`agent/agent.ts`, instructions, tools/, skills/, channels/, subagents/, schedules/, memory/, sandbox.ts) compiled by `eve build` into a Nitro server (AGENTS.md "About eve"; packages/eve/src/compiler/*).
- Durability engine = Workflow SDK (`@workflow/core` 5.6.1 + worlds) — packages/eve/package.json:688-693 (`@workflow/core`, `world`, `world-local`, `world-vercel`). Each session = one workflow run; checkpoints at "steps" (one model call + inline tool calls) — docs/concepts/execution-model-and-durability.mdx:8-20. **VI** (packages/eve/src/execution/session/*, e.g. interrupted-step.integration.test.ts, handoff-steps.test.ts, durable-session-store.integration.test.ts).
- World selection: install/validate at packages/eve/src/execution/install-workflow-world.ts:10-17. Worlds: Local (SQLite at `.eve/.workflow-data/world.db`, single process), Postgres (`@workflow/world-postgres`, Graphile Worker, multi-replica), Vercel Workflow — docs/guides/deployment/workflow-worlds.md:10-16, 20-30, 32-60.
  - Local world self-hosted: **VI** — test/scenarios/local-workflow-restart-recovery.scenario.test.ts:84 ("finishes a spec 9 turn that was sleeping when `eve start` was killed"); self-hosted-acceptance.scenario.test.ts (SIGKILL + resume; real-model half credential-gated, audits/self-hosted-parity/EVE-SELF-HOSTED-ACCEPTANCE.md:24).
  - Postgres world: **CID / DU** — only config-plumbing tests (src/internal/nitro/host/host-routes.integration.test.ts:295, start-development-server.test.ts:381); `e2e-postgres.yml` exists, but audits state "The Postgres world and multiple replicas" not verified (EVE-SELF-HOSTED-REMAINING-GAPS.md "Not verified").
- Vercel dependency, CURRENT state (audits/vercel-removal/EVE-VERCEL-REMOVAL-RESULTS.md, cross-checked to .changeset/*):
  - Self-host via `eve build` + `eve start` on Node, local world: VI.
  - Multi-agent workspace on one origin + signed peer tokens (`workspacePeers()`, `EVE_WORKSPACE_SECRET`): VI (.changeset/self-hosted-workspace-host.md; test/scenarios/self-hosted-workspace.scenario.test.ts:187-315). Note: older EVE-SELF-HOSTED-REMAINING-GAPS.md table still says "Default workspace-peer transport requires Vercel" — superseded by the removal slice.
  - Dynamic schedules self-hosted: `workflowScheduleProvider()` exists (packages/eve/src/public/schedules/providers/workflow.ts; test self-hosted-schedules.scenario.test.ts:184,239) but default is still `vercelScheduleProvider()` (packages/eve/src/public/schedules/subscription.ts:450,505). PI/CID (opt-in).
  - Model catalog bundled (`EVE_MODEL_CATALOG=bundled`): VI (.changeset/bundled-model-metadata.md).
  - Still Vercel-only: deployed self-modification, Agent Runs destination, `eve deploy/link`, domain-level sandbox network policies and credential-transform brokering (Vercel Sandbox only — packages/eve/src/execution/sandbox/bindings/docker-network.ts:5-15).
  - Runtime deps still include `@vercel/*` packages (package.json:678-687) bundled, but not required at runtime off-Vercel.
  - Unreleased in this fork: these are pending changesets (.changeset/*.md), i.e. post-1.0.2 work.

### 2. Runtime lifecycle
| Item | Status | Evidence |
|---|---|---|
| Start session (HTTP `POST /eve/v1/session`, channel send, `from(addr).send`) | VI | docs/concepts/sessions-runs-and-streaming.md "Start a session"; src/channel/send-input.test.ts, src/public/channels/eve-session-routes.test.ts |
| Resume after crash/restart | VI (local world) | Completed steps replayed, interrupted step re-run; `MAX_TURN_INTERRUPTIONS = 3` → `STEP_INTERRUPTED` (src/execution/session/interrupted-step.ts:260,287); test interrupted-step.integration.test.ts; scenario local-workflow-restart-recovery. Version upgrade on local/Postgres world: existing sessions cannot resume ("stranded") — workflow-worlds.md:12, execution-model doc:49-147 |
| Cancellation | VI | Route `createEveSessionCancelRoutePath` (src/protocol/routes.ts:60), client controls cancel/clear/compact/end (src/client/session-controls.ts:14-19); src/harness/turn-cancellation.test.ts, tool-loop-cancellation.integration.test.ts; cancelled-turn settle step (src/execution/settle-cancelled-turn-step.ts) |
| Pause (operator-initiated) | M | No pause control; only `turn.paused` when awaiting human input (src/client/session-utils.ts:136,169) |
| Timeouts | VI | Session idle timeout default 30 days (src/execution/session/timeout.ts:1), timeout-workflow.test.ts; sandbox idle stop 5 min default (.changeset/sandbox-idle-timeout.md; idle-sandbox.integration.test.ts) |
| Retries | VI (step-level) | Step retries / `TURN_FAILED` (doc :200); step-retry-owner.integration.test.ts, nonturn-retry.integration.test.ts. Not exactly-once for tool side effects (doc :204-212: "Give tools with irreversible effects a stable operation ID") |
| Tool-call idempotency | PI | Framework: delivery idempotency keys, last 1,024 per session (doc :234; src/execution/session/delivery-idempotency.integration.test.ts). Tool side effects NOT idempotent by framework — app must provide operation ids (the appport example builds an operation ledger for this) |
| Human approval of tool calls | VI | `approval: auto()/always()/once()/never()/policy` (docs/tools/human-in-the-loop.md:26-263; src/approval/definition.ts, agent.ts + tests; src/harness/approval-answers.integration.test.ts, approved-call-recheck.integration.test.ts, ai-sdk-approval-resume.integration.test.ts). Turn parks with no compute until answered (doc "Parked work") |
| Steering a running agent | VI | `turnPolicy: "steer"` (default) vs `"queue"` (doc :226-246); src/execution/session/input-queue.ts:167-175, input-queue.test.ts, turn-control.test.ts |
| Durable waits in tools (timers/webhooks/human answers), background tasks | VI | `defineWorkflowTool`, `task()`/`serve()`, `eve__task_wait` (docs/tools/workflows.mdx, tasks.md; src/execution/tasks/*) |

### 3. Sandbox / machine execution
- Providers: Default (Vercel on Vercel, Docker when reachable, just-bash in dev), Vercel Sandbox, Docker, just-bash (pure-JS virtual shell), custom via `defineSandboxProvider()` — docs/sandbox/index.mdx:67-75,195-197; src/sandbox/providers/{default,docker,vercel,just-bash}.ts; Docker binding src/execution/sandbox/bindings/docker*.ts (~2.4k lines with tests).
  - Docker: **VI** (docker.integration.test.ts, docker.scenario.test.ts, self-hosted-runtime.scenario.test.ts). Template image must be prepared by `eve build` on the same Docker daemon as runtime; one sandbox lives on one daemon (EVE-SELF-HOSTED-REMAINING-GAPS.md table).
  - Vercel Sandbox: CID (Vercel credentials, docs/sandbox/vercel.mdx:34-56).
- Filesystem: per-session sandbox, `/workspace` root, persists across turns while provider keeps it; skills at `$HOME/.agents/skills`; attachments in `/workspace/.eve/attachments` (docs/sandbox/index.mdx:28,149-193,232-243). Built-in tools: bash, read_file, write_file, grep, glob (src/execution/sandbox/bash.ts, read-file.ts, write-file.ts, grep-search.ts, glob-tool.ts).
- Network: Docker supports only `allow-all`/`deny-all`; domain allow-lists and credential brokering require Vercel (src/execution/sandbox/bindings/docker-network.ts:5-15). **PI** off-Vercel.
- Secrets: Vercel credential transforms inject headers at network boundary so secret never enters the sandbox (docs/sandbox/vercel.mdx:130-138) — CID (Vercel). Docker: `env` on environment (docs/sandbox/docker.mdx:93) or eve-code's "command delivery"/consumer `broker` escape hatch (packages/eve-code/README.md "Non-Connect escape hatch").
- No "run on the user's own machine" daemon concept. Sandbox runs next to the eve server (Docker) or in Vercel; a custom provider would be needed for remote machines.

### 4. Coding capability (eve-code, eve-git)
- eve's own model+tools loop (harness: src/harness/*), NOT a wrapper around Claude Code/Codex CLIs. No vendor-CLI execution adapter found (grep for claude-agent-sdk/claude-code: none in runtime; `codex-app-server.ts` is ChatGPT sign-in/model transport, src/public/models/openai/chatgpt/codex-app-server.ts).
- `eve acp` exposes an eve agent TO editors over Agent Client Protocol (src/acp/server.ts; docs/reference/cli :16,301) — reverse direction of Multica's model.
- eve-code (`eve/extensions/code`, private source package, shipped inside `eve`): coding instructions, AGENTS.md/CLAUDE.md as project instructions, investigate/review skills, `installCodeTooling` (gh, vc, gh-signed-commit wrappers with placeholder tokens) — packages/eve-code/README.md; extension/lib/tooling.ts:1-40. Tests: test/integration/{sandbox,credentials,connect-authentication}.test.ts, test/scenario/*. **VI** (small).
- eve-git (`eve/extensions/git`): GitHub instructions + `pr` skill (a markdown procedure: commit, push, `gh pr create --draft`; packages/eve-git/README.md; skills/pr.ts is 12 lines delegating to lib/github-guidance.ts); optional `git__gh` tool running one gh/git/gh-signed-commit command per call with an `authorize` callback, Connect-brokered tokens, signed commits, co-author attribution, an in-sandbox lease lock (lib/sandbox-lease-lock.ts:6-15, 10-min stale). Tests: test/integration/github-shell.test.ts, connect-user-auth.test.ts, test/scenario/signed-commit-files.test.ts. **VI** for plumbing; brokered mode **CID** (Vercel Connect + Vercel Sandbox network policy, or a consumer broker).
- Clone/edit/test/commit/push/PR: done by the model via `bash`+`git`/`gh` in the sandbox. Plain `git({})` assumes shell already has GitHub credentials (eve-git README). GitHub channel checks out the repo into the sandbox every turn (src/public/channels/github/checkout.ts:52-86, checkout.test.ts) — **VI**, but its setup is documented via a GitHub App created through Vercel Connect, with a self-managed alternative (docs/channels/github/index.mdx).
- No end-to-end test in this tree of "clone → change → tests → push → PR" with a real model; eve-code benchmarked externally via eve-bench (eve-code README "Benchmarks", .github/workflows/eve-code-benchmark.yml). → **DU** for the full coding loop quality.
- Models: any AI SDK `LanguageModel` (docs/agent-config.md:28,89-102 incl. `@ai-sdk/openai-compatible` local models, :206 bedrock); helpers `anthropic()` (src/public/models/anthropic/index.ts:6) and `openai()`; string IDs route via Vercel AI Gateway. `eve init -n` default still gateway (audits/self-hosted-parity/EVE-DEFAULT-MODEL-DECISION.md). Provider-independent: **VI**; self-hosted keys: **VI** (appport example uses `anthropic()` direct with ANTHROPIC_API_KEY).

### 5. Observability
- Session event stream (NDJSON, facts like `turn.started`, `call.settled`, `turn.settled`, `turn.paused`), reconnect/rewind by position — docs/concepts/sessions-runs-and-streaming.md:40-370; src/execution/session-event-stream.ts, src/client/follow-stream.test.ts, transcript.ts/transcript.test.ts. **VI**.
- Tool-call records: `call.*` facts in the stream (src/protocol/*). **VI**.
- Tracing: OpenTelemetry (docs/guides/instrumentation/otel.mdx; test self-hosted-workspace.scenario.test.ts:222 "exports nested and linked traces through OpenTelemetry without Vercel"). `@vercel/agent-runs` (packages/tracing) = Vercel Agent Runs destination, optional. **VI** (OTel).
- Usage: token usage per turn/session (src/harness/session-usage.ts:9-48, session-usage.test.ts, usage-sink.integration.test.ts). Cost USD only when AI Gateway returns it (src/harness/model-call/usage.ts:19,36-45). Budgets / HITL budget requests (src/harness/hitl/budget.ts). **PI** for cost off-gateway.
- `eve logs` local diagnostic logs (docs/reference/cli :20,354).

### 6. Channels, schedules, subagents, memory, skills (brief)
- Channels: entry surfaces (eve HTTP, Slack, Teams, Discord, Telegram, Twilio, GitHub, Linear, A2A, MCP, custom `defineChannel` with routes + event handlers) — src/public/channels/*, docs/channels/*. Custom channel event handlers (`turn.started`, `call.settled`, `turn.settled`) used by appport example. **VI**.
- Schedules: `agent/schedules/*` cron files (static) **VI**; dynamic schedules experimental (see §1).
- Subagents: own session/context/sandbox; local or remote (`defineRemoteAgent` with durable callbacks, public-address callbacks only; docs/guides/remote-agents.md:181-206). **VI**.
- Memory: `agent/memory/*` slots; `fileMemory()` needs a backend off Vercel — `localFiles()` single-process (.changeset/memory-local-files-backend.md). **PI** for multi-replica.
- Skills: Agent Skills standard, markdown/SKILL.md, read on demand (docs/skills.mdx). **VI**.

### 7. AppPort / FeltKit integration
- examples/appport-agent (example-only, not a published package; package.json `private: true`, name `appport-agent-example`): self-hosted eve agent, `defaultTools: false`, three tools `appport_capabilities`, `appport_contract`, `appport_invoke` (agent/tools/*), using `@appport/client` 1.1.8, `@appport/protocol` 1.5.0, `@feltdb/core` 0.22.0.
- Work contract is PUSH into the agent, not a pull from the app: custom channel agent/channels/work.ts:
  - `POST /work` (:93) — JWT (`jwtHmac`) + `Idempotency-Key`, body `{objective, readOnly?, onBehalfOf?, surface?}`; records submission + FeltDB `AgentTask` in the AGENT's own FeltDB work store, then `from(workId).send(objective, {idempotencyKey: "work:"+workId})` (:160-163). Returns `{workId, sessionId, replayed}`.
  - `GET /work/:workId` (:173) — status, history, decisions, evidence, ledger, refusals (requester-only).
  - `GET /submissions/:person/:key` (:194), `POST /work/reconcile` (:212, operator), `POST /operations/:operationId/settle` (:222, ES256 operator JWT).
  - Event handlers write immutable FeltDB checkpoints: `turn.started` (:254), `call.settled` (:270), `turn.settled` (:295); completion decided from ledger evidence, never model text (README "Completion gate").
- Recovery (agent/lib/recovery.ts): no eve startup hook, so reconciliation runs once per process before first `/work` request; reads eve events in-process via `sessions.attach(id).stream({follow:false})` (recovery.ts:84); stall detection `APPPORT_AGENT_STALL_AFTER_MS` default 15 min (recovery.ts:245).
- Durable operation ledger (agent/lib/operations.ts): `prepared → executing → succeeded|failed|indeterminate`, op id = sha256(work id, capability, key-or-input digest), AppPort idempotency key = op id, contract pinning by `capabilityDigest`, reconciliation by read capability, operator settlement (README "Durable operations", "Operator settlement").
- FeltKit delegated execution: agent with its own FeltKit session calls FeltKit `/appport` with `X-AppPort-On-Behalf-Of`; AuthBoundry decides (audits/appport-foundation/FELTKIT-DELEGATED-EXECUTION-REPORT.md:1-60). Tests: examples/appport-agent/test/feltkit.test.mjs, personalos.test.mjs, work.test.mjs, settle.test.mjs, replacement.test.mjs, acceptance.test.mjs (~7k lines, node:test, require sibling FeltKit/PersonalOS checkouts via env).
- Constraints: one eve process per work store (FeltDB exclusive lock; README:101); local AuthBoundry only for agent-credential delegation (HOSTED-READINESS-ASSESSMENT.md §4 limits); "eve's CI does not run at all … GitHub Actions has never run on any eve2 PR" (HOSTED-READINESS-ASSESSMENT.md:12,112).
- Resolver: research/runtime-dependency-resolution.md frontmatter `status: proposed`; ":Nothing here is implemented in `eve`" (line ~9). Mechanics proven only inside the example (CONTRACT-VERIFIED-REPLACEMENT-REPORT.md). **M** in eve.
- Status: the FeltKit→eve work hand-off contract is **example-only (PI)**. Direction: app/surface → agent `POST /work`; progress/evidence is held in the agent's FeltDB and read via `GET /work/:id` (polling). There is NO callback/webhook from the agent back to the FeltKit app, and no FeltKit-side "work item" type the agent pulls from. The agent's only writes into FeltKit are AppPort capability invocations.

### 8. Packaging / fork delta
- packages/eve/package.json: `name: "eve"`, `version: "1.0.2"`, repository still `vercel/eve`. CHANGELOG top: 1.0.2 released 2026-11-17 (upstream).
- Fork publishes as `@appport/eve` via manual workflow .github/workflows/publish-packages.yml (workflow_dispatch, NPM_TOKEN) and scripts/publish-packages.mjs:6 (`NAME = "@appport/eve"`); `canonicalPackageName` maps `@appport/eve` → `eve` (src/internal/package-name.ts:3, test package-name.test.ts:7; .changeset/eve-published-distribution-name.md). npm registry (checked `npm view`): `@appport/eve` versions `0.0.0-stage`, `1.0.2`; upstream `eve@1.0.2` also exists.
- Fork-specific delta (from tree contents; history is a single squashed commit so exact diff vs upstream not computable here): audits/ (all four dirs), examples/appport-agent, research/runtime-dependency-resolution.md, publish-packages workflow/script, and the pending changesets: bundled-model-metadata, cli-telemetry-opt-in (telemetry off by default), durable-workflow-schedules, eve-published-distribution-name, init-direct-provider-model, memory-local-files-backend, self-hosted-diagnostics, self-hosted-workspace-host (also likely upstream-origin: sandbox-idle-timeout, workflow-5-6, public-api-comments-only — cannot confirm without upstream history).

---

## Judgments (not facts)

### 9. Gaps for "EVE as execution runtime for long-running coding work assigned from a FeltKit app"
1. **No worker-claim/lease model.** eve is a server that receives deliveries (HTTP push). Work queueing/claiming exists only inside the Workflow world (local SQLite or Postgres/Graphile) and is not exposed as "a remote worker claims an app's work item with a lease + heartbeat". Multica-style "daemon on the user's machine claims tasks" would need to be built: either a FeltKit-side dispatcher that POSTs to eve (the example's direction), or a new pull channel/poller in eve. (M)
2. **Progress/evidence back to the app.** Generic building blocks exist (session NDJSON stream with resume positions; channel event handlers). The example stores evidence in the agent's own FeltDB and the app must poll `GET /work/:id`. Writing progress/evidence into the FeltKit app's FeltDB (e.g., via AppPort capabilities like `work.checkpoint`) or a signed webhook is not implemented. (M; small to build using channel event handlers.)
3. **Steering/cancel from the app.** eve supports steer/queue/cancel/end by session id; the example's work channel exposes none of these for work items (no `/work/:id/message` or `/work/:id/cancel`). Pause: missing in eve. (PI)
4. **Liveness.** No heartbeat; only the example's stall detection on reconcile passes (15 min). (PI/example)
5. **Coding execution off Vercel.** Docker sandbox works self-hosted but: single daemon per sandbox, template must be prepared on the runtime daemon at build time, network policy only all/none, no credential brokering → GitHub tokens must enter the sandbox (or a custom broker/proxy). Running on users' own machines would need a custom sandbox provider. (PI)
6. **Vendor CLIs.** eve does not drive Claude Code/Codex/Cursor CLIs; it is its own agent loop with any AI SDK model. If the product requires running vendor CLIs, that is a custom tool/sandbox-process integration to build (could be a `defineWorkflowTool`/task running a CLI in the sandbox), with no existing support or tests. (M)
7. **Branch/PR evidence.** PRs are produced by the model following the `pr` skill; there is no structured "result artifact" (branch, commit SHA, PR URL) recorded by the framework — it would be inferred from `call.settled` of `git__gh`/bash. (PI)
8. **Multi-replica / HA.** Postgres world is documented, plumbing-tested, not verified in audits; example work store is single-process (FeltDB lock); `localFiles()` memory single-process. (DU/PI)
9. **Verification maturity.** By the fork's own assessment, eve2 CI has never run on a PR; results are workstation-local. Version upgrades strand in-flight sessions on self-hosted worlds — matters for multi-day coding work. Fork lags/diverges from upstream with only manual publishing.
10. **Resolver** integration is a proposal only.

### Bottom line
eve provides a solid durable session runtime (checkpointed turns, crash resume, cancel, steer, approvals, durable waits/tasks, event stream, OTel) that runs self-hosted on Node + local SQLite world + Docker sandbox, and a model-agnostic coding toolset (bash/files + git/gh skill). The FeltKit hand-off contract (`POST /work` + ledger + recovery + settlement) is a well-tested *example*, push-based, with evidence kept agent-side and no callbacks, steering or cancel exposed for work items. A Multica-like platform would need: a work-dispatch/claim layer, progress/evidence write-back to the FeltKit app, work-level steer/cancel endpoints, structured PR/branch artifacts, and (if desired) vendor-CLI or user-machine execution — none of which exist in eve today.
