> Working notes from a read-only audit pass (2026-11-23). Produced by an audit agent from source, SQL, tests and docs; the discovery author spot-checked the claims used in decisions (see ../DECISIONS.md, "Verification of audit notes"). Paths are relative to the audited repository unless absolute. Treat unverified rows as leads, not facts.

# F — FeltKit capability audit (for an agent work platform)

Sources read: installed `/home/user/felt-ops/node_modules/@feltdb/feltkit` **0.3.34** (dist d.ts/js, docs),
its nested `@appport/services` 0.20.0 and `@feltdb/core` 0.22.0; source `/home/user/feltkit` (HEAD `b0222f6`,
package.json 0.3.37). Paths: `src/` = `/home/user/feltkit/packages/sdk/src`, `test/` = `.../packages/sdk/test`,
`dist/` = `/home/user/felt-ops/node_modules/@feltdb/feltkit/dist`, `CL` = `/home/user/feltkit/CHANGELOG.md`.

Status legend: **Released-0.3.34** (in installed dist) · **Published-later** (CHANGELOG "Published in 0.3.35/0.3.36") ·
**Unreleased-source** (src only; CHANGELOG "Unreleased") · **Documented-only** · **Missing**.

Version note: CHANGELOG says 0.3.35 was published (invocation-approval fix) and calls 0.3.36 "prepared (unpublished)"
(CL:37-46); the brief says npm latest is 0.3.36. Either way, 0.3.36 only changes AppPort pins (retry never repeats an
unknown provider effect). Only two src modules are absent from the 0.3.34 dist: `runtime/agent-control.ts` and
`runtime/agent-control-capabilities.ts` (checked file-by-file). Unreleased in src: agent control/steering (CL:19-35),
provider-call settlement (CL:3-17); 0.3.35: invocation approval (CL:48-68). Src pins `@appport/core` 1.11.0 / sdk 1.11.0
(packages/sdk/package.json:57-66) vs 0.3.34's core 1.9.0 / sdk 1.10.0.

---

## Remote execution plane (the key question)

**Short answer: in published 0.3.34 there is no supported remote worker/daemon protocol** (EXECUTION.md "Designed, not
implemented: a remote worker protocol (how a worker outside the process authenticates and calls the control plane)").
But the fenced primitives are reachable by a remote caller **indirectly**, through application functions it calls over
MCP/AppPort/HTTP, with significant constraints.

| Q | Finding | Evidence |
|---|---|---|
| (a) Can functions called remotely use `ctx.invocations.start/progress/transition/cancel`? | **Yes, mechanically.** Every function call (any `via`: http, appport, mcp, job) gets `ctx.invocations` bound to the *caller's* principal: mutations get the full writer (`accept` only in mutations), queries get `get/list` only; actions get `InvocationsWorker`. A remote daemon calls an app mutation (e.g. `work:claim`) that calls `ctx.invocations.start(id, { environment?, worker?, leaseMs? })` and returns `claim` to the daemon; later calls pass `claim` back as a function argument to `progress`/`transition`. **Who may:** `#visible` admits only (i) the person it is for, if `type==="user"`, or (ii) the principal that *delivered* it (`deliveredBy.id`), and tenant must match. Session surfaces are delivered by the person themselves, so an **agent/service session can only work invocations it delivered itself via a `bridge` surface** (bridge = any principal holding `surface.bridge.role`, naming `person`). A daemon holding the person's own session could also do it, but then it *is* the person (GAP-12: a person token over MCP bypasses `approval:"required"`). **Fencing:** claim = 18 random bytes; each move is compare-and-set on record `__version` (8 retries); `progress`/`transition` from `running` require `claim === execution.claim`, else `FAILED_PRECONDITION/CLAIM_LOST`; `start` with an `environment` other than the placed one → `WRONG_ENVIRONMENT`. `cancel` is the person's only. Lifecycle moves commit on their own, not with the mutation's other writes. | src/runtime/runtime.ts:745-760, :1822-1823, :2009; src/runtime/invocations.ts:261-267 (`#visible`), :274-288 (accept; bridge role check), :362-380 (CAS), :387-422 (start), :449-457 (progress), :488-510 (transition), :563-571 (cancel); src/runtime/context.ts:43-85; dist/runtime/context.d.ts:51-143 (get:51, list:52, start:64, progress:83, resume:91, transition:107, cancel:117, accept:133); dist/runtime/invocations.js:131 (same `#visible`) |
| (b) Lease expiry, stalled recovery, re-claim as new attempt — for such a caller? | **Yes for re-claim, no for automatic recovery.** Lease default 5 min, clamped 1 s–1 h; `progress` renews it (heartbeat). After expiry, **any visible principal calling `start` again** reclaims it: the old attempt is marked `unknown` ("abandoned"), a new attempt `att_…_<n>` is created, and `previous` lists earlier outcomes. A stale worker then gets `CLAIM_LOST`. The services-worker sweep `recover()` only **reports** expired leases as `stalled` (and handles failed dispatch: ≤3 re-dispatches then `DISPATCH_FAILED`; expires undecided approvals). Nothing re-dispatches or reassigns stalled work; something must call `start` again. Environment/worker identity on attempts is `attribution: "asserted"` (not authenticated). | src/runtime/invocations.ts:389, :400-414 (reclaim), :580-622 (`recover`, `stalled` at :621); test/execution.test.ts:157-191 (test "5-7": worker-a disappears, restart, recover() reports stalled, worker-b reclaims as attempt 2, worker-a's progress/transition → CLAIM_LOST) and :193-221 (test 8: WRONG_ENVIRONMENT; OUTCOME_UNKNOWN → attempt `unknown`); test/invocations.test.ts:206 ("repeated dispatch never duplicates work … expired claim is reclaimed"). **All these tests call `runtime.invocations.*` in-process; none drives it from a remote process over MCP/AppPort.** |
| (c) Are invocations/execution in 0.3.34? | **Yes** (surfaces, invocations, placement, `ExecutionAdapter`, attempts, fencing, recovery). `ctx.invocations` is in dist/runtime/context.d.ts:46-147,166,262; dist/runtime/execution-host.d.ts:43-50 (`policy`, `resolver`, `register`, `unregister`); dist/index.d.ts:38-40 exports `resolvePlacement`, `EXECUTION_CONTRACT`, `ExecutionAdapter`. HTTP in 0.3.34: `GET /api/surfaces`, `GET /api/invocations`, `GET /api/invocations/<id>`, `POST …/cancel` (dist/server/index.js:543-565). **Not in 0.3.34:** approval of `awaiting_approval` (`POST /api/invocations/<id>/approve|reject`, `resume` refusing `NOT_APPROVED`) — 0.3.35 (CL:48-68). In 0.3.34 `resume` needs no approval and a worker could `transition` `awaiting_approval→completed` (the bug 0.3.35 fixed). **Execution adapters are not declarable by an app**: only `runtime.execution.register(adapter)` on a `FeltKitRuntime` object (embedding via `@feltdb/feltkit/server`); the only adapter shipped is `managed` (in-process AppPort Services job, 15-min deadline); the second environment in tests is an in-process fixture (`fixture-remote`). Artifacts (AppBoundry) do not host the invocation store. | src/runtime/execution-host.ts:20,64-74; src/server/public.ts:11; docs/EXECUTION.md "Status", "Limits"; test/execution.test.ts:6,31 |
| (d) External MCP agent as a coding agent's control channel via AgentHost tasks? | **Partly yes.** 0.3.34 MCP agent tools: `feltkit_context`, `feltkit_agent_tasks`, `_create` (playbooks incl. `handoff`), `_claim` (handoff → caller becomes owner), `_get`, `_propose`, `_note`, `_complete` (dist/server/mcp.js:7-40). Unreleased adds `feltkit_agent_checkpoint`/`_acknowledge` (src/server/mcp.ts:18-24, 59-60, 84-87). Observations run immediately as owner; consequential proposals wait for a **person's** approval (`approve` refuses non-`user`, src/runtime/agent.ts:1003-1007). **Constraints:** (1) the task owner is the agent after create/claim; app-side `POST /api/agent/actions/approve|reject` (in 0.3.34, dist/server/index.js:412-418) is **owner-scoped** (`approveOwn` → `#ownedOrNotFound`, src/runtime/agent.ts:983-994), so a person can approve an agent-owned task's actions **only in Studio** (`POST /agent/tasks/:id/approve`, src/server/admin.ts route list); (2) handoff tasks can be created only via MCP or Studio, not from app functions (`createTask` callers: src/server/mcp.ts:73, src/server/admin.ts:654; `ctx.agent.start` is decide-only, src/runtime/context.ts:172-180); (3) no app-readable `ctx.agent.get/list` in queries (QueryCtx has no `agent`, src/runtime/context.ts:87-101); (4) direct MCP capability calls are **not linked** to a task; (5) steering (signal/submit/pause/resume/interrupt/stop over `GET|POST /api/agent/tasks/:id/control[/op]` + SSE `…/control/events`, src/server/index.ts:446-~530) and the checkpoint gate are **unreleased**; any `user` principal (or owner) may steer (src/runtime/agent-control.ts:236-241); (6) "FeltKit has no agent loop runner" (CL:34-35; docs/AGENT-CONTROL.md:133). Tests: test/agent-control.test.ts:535 ("MCP: an external coding agent is held at the same boundary — refused until it checkpoints, held while paused, cannot complete over an open update"), :472 (HTTP + SSE), :589 (AppPort `appport.agent-control/1`), :414 (authority). | as cited |

**Other remote-execution-adjacent primitives in 0.3.34:**
- **Runtime components + durable work** (`feltkit({ components })`, `ctx.afterCommit.work(component, kind, input)`,
  component `ctx.work.claim({kinds,limit,leaseMs})` / `ctx.work.finish(item, done|retry|failed|unknown)`, version-fenced,
  `resumed: true` after lease expiry, survives restart). A component runs **in the app process** on declared route
  prefixes with optional WebSocket and authenticates its own traffic; it acts only as `component:<name>` (or an
  `app.agent` principal) via `ctx.call`. This is the most credible in-app hook for a **gateway that remote daemons
  connect to**, but the daemon auth/protocol is the app's to build; no lease renewal API. src/component.ts:61-100;
  dist/component.d.ts:90-112; docs/COMPONENTS.md "Decision"; test/component-work.test.ts:88,121,140.
- **FeltKit platform (`feltkit platform serve`, AppPort app `dev.feltkit.platform`)**: workspaces, sandboxed
  `command.run` (allowlist node/npm/git/feltkit, rlimits, namespaces where available, network needs a person's
  approval), durable execution records, local git (`source.init/status/diff/commit/log/branch`; no push/remote/PR),
  change sets, artifacts, releases/rollback, approvals. It is a **developer-operations server over a root of FeltKit
  projects**, not an application primitive; it is in 0.3.34 dist (dist/platform/*.js). src/platform/platform.ts:1-16;
  src/platform/workspace-operations.ts:66-585 (ops), :206-249 (`command.run`); src/platform/exec.ts:1-27;
  test/platform-exec.test.ts (9 tests), test/platform-workspaces.test.ts:39,117,162,183; docs/M2-AGENT-OPERATIONS.md G4-G13 closed, G17 open.
- **`app.agent`** runs are leased/retried (default 5 attempts, 5-min lease) but the handler **is a mutation** in the
  server process (no network I/O, no long work). src/app.ts:753-789.
- **AppPort Services jobs** run handlers in-process via the services worker; no external claim API is exposed to remote workers.

---

## 1. App definition

| capability | status | API & evidence | tests | limitations |
|---|---|---|---|---|
| Collections/schema (`s.*`), refs, enums | Released-0.3.34 | `app.collection(name, shape, options)` src/app.ts:1043; dist/app.d.ts:909; `s` src/schema.ts | test/data.test.ts, test/schema-views.test.ts | GAP-13: with `auth.tenant`, a collection without a `tenant` field is silently shared (GAP-REGISTER:71) |
| Indexes / unique (incl. sparse) | Released-0.3.34 | `UniqueDeclaration`, `IndexDeclaration` src/app.ts:411-450; managed contract carries them (src/runtime/contract.ts:21,61-62,145-155) | test/contract-parity.test.ts:56,71 (CompanyOS 21 unique + 18 indexes) | Index plan at 100k on managed unproven (FG-04/AG-02) |
| Queries / mutations / actions | Released-0.3.34 | src/app.ts:1291-1311; dist/app.d.ts:990-1001; `access` required (deny by default, CL:993); `approval:"required"`; `owner` | test/server.test.ts, test/approval-required.test.ts, test/ownership.test.ts | Actions have no db handle (use runQuery/runMutation); mutations retried on conflict |
| Live queries (React) | Released-0.3.34 | `useQuery/useQueryState/useMutation/useAction/useEvent/useOwnActions/useSession` dist/react/index.d.ts:10-75; SSE `/api/events` src/server/index.ts:900-947; predicate-level re-run (FK-GAP-005) | test/live-predicates.test.ts:88-242, test/client-reconnect.test.ts | Invocation-store and FeltDB agent-state writes are outside the change feed (INVOCATIONS.md "Limits"; `/api/agent/actions/events` polls 2-10 s, src/server/index.ts:420-423) |
| Schema migrations / contracts | Released-0.3.34 | `app.migration(name, run)` src/app.ts:1207; state contract `runtime/state-contract.ts`; refuses destructive `evolve` | test/schema-lifecycle.test.ts, test/schema-lifecycle-artifact.test.ts | FeltDB F18 (evolve drops non-empty collection) mitigated by refusal |
| Sequences / audit trail | Released-0.3.34 | `ctx.db.sequence(name)` src/runtime/data.ts:159,459; `app.auditTrail(name,{subjects})` src/app.ts:1115, `.record/.history` :496-498; dist/app.d.ts:925 | test/sequence.test.ts:35,53; test/audit-trail.test.ts (3) | Audit trail is app-written, not platform activity |
| Search | Released-0.3.34 | `ctx.db.search(collection,{text,limit,fields,where,orderBy})` src/runtime/data.ts:414; dist/runtime/data.d.ts:94-98 | test/search.test.ts:30-154 (accents, tenant isolation, fencing, artifact) | Bounded scan of `where` matches; no ranking/full-text index |
| Large collections | Released-0.3.34 | paged complete reads, `query` cursors | test/large-collections.test.ts:107-194 (10k records) | Services `files.list` >1000 fixed only unpublished (NEW-13); FeltDB `recallForTask` cap 100 (F21) |
| Set membership `where … in` | Released (0.3.32 train) | CL:352 | test/membership-query.test.ts | — |

## 2. Identity

| capability | status | API & evidence | tests | limitations |
|---|---|---|---|---|
| Built-in accounts, sessions (cookie+CSRF / bearer) | Released-0.3.34 | `auth.accounts`, `auth.session` src/app.ts:198-283; routes `/api/auth/*`, `/api/account*`, `/api/auth/sessions[/revoke]` src/server/index.ts:582-886 | test/accounts.test.ts, test/session-cookies.test.ts, test/session-end.test.ts | — |
| Roles → permissions | Released-0.3.34 | `roles: Record<string,string[]>`, wildcards src/app.ts:205; `authorize` hook src/app.ts:217 | test/authorization.test.ts, test/authorize.test.ts | Roles fixed on account record; per-tenant roles via membership |
| Principal types user/agent/service | Released-0.3.34 | `PrincipalType` (src/runtime/authority.ts); approval only by `user` (src/runtime/agent.ts:1006) | test/agent.test.ts | GAP-12 open: a person's token over MCP *is* the person and bypasses approval (GAP-REGISTER:67) |
| Account disable / role change (G-01) | Partial (internal only) | `AccountStore.setRoles` / `setDisabled` src/runtime/accounts.ts:386-399 (dist/runtime/accounts.d.ts:103,105); **no HTTP, CLI, Studio or ctx caller in src** (grep: only tests use them) | test/session-cookies.test.ts, test/authorization.test.ts, test/discovery.test.ts use them directly | No admin capability; no sign-in hook mapping account→app record. Per-tenant role change exists: `POST /api/tenants/current/members/role` src/server/tenancy.ts:146 |
| Session control (G-02) | Released-0.3.34 (operator) | `sessions.revokePrincipal` src/runtime/sessions.ts:139; CLI `feltkit session revoke principal:<id>` src/cli/main.ts:1989; online admin `DELETE /sessions/:ref` src/server/admin.ts:722,1113; own sessions `client.revokeSession/signOutEverywhere` dist/client/index.d.ts:419-423; `ctx.auth.session` + `auth.onSessionEnd` (0.3.33, CL:115-126) | test/production-online-admin.test.ts:54 (revoke online, server keeps serving); test/session-bound-state.test.ts | Not callable from application code as a capability |
| Sign-in GitHub/Google/OIDC | Released-0.3.34 | `auth.providers` own client (src/app.ts:256-264; src/server/oauth.ts:48-49) or **broker** (0.3.32, CL:151-171); extension sign-in | test/sign-in-providers.test.ts (4), test/signin-broker.test.ts | Default broker issuer `getfeltkit.com/broker` is "not a service this repository runs" (CL:166-168). Sign-in only: no GitHub API token for the app |
| Tenancy / workspaces | Released-0.3.34 | `auth.tenant` (TenantOptions src/app.ts:131); `app.tenant/requireTenant/requireClaim` :1158-1177; `/api/tenants*`, invitations src/server/tenancy.ts:42-206; client tenants API dist/client/index.d.ts:427-457; `ctx.tenancy.members()` | test/tenancy.test.ts (10), test/tenant-platform.test.ts, test/tenancy-parity.test.ts, test/tenancy-appboundry.test.ts | One session = one tenant at a time; GAP-13; schedules' jobs carry no workspace (GAP-REGISTER:86) |
| Resource/attribute authorization (G-06) | Released (≤0.3.32) | `app.policy(rule)` over caller, record (owner, shared-with, field state), input, `delegated` (CL:449-473; src/app.ts:1025; dist/app.d.ts:908); `owner` on functions; `authorize` hook gets args + read-only db | test/policies.test.ts (10), test/ownership.test.ts | Managed policy versions not in AppBoundry guest; `delegated` doesn't hold in guest |
| Delegation (AuthBoundry) | Released (0.3.30-0.3.33) | `authority: { local: true, capabilities, executor }` src/app.ts:~290-335; `ctx.authority.grants.list/grant({capabilities, expiresAt?, agent?})/revoke`, `agents.register/list/revoke`, `decide({capability,onBehalfOf,agent,resource})` src/runtime/context.ts:225-289; `X-AppPort-On-Behalf-Of` (0.3.33, CL:101-113); `ctx.auth.delegation` | test/delegated-appport.test.ts, test/delegated-appport-boundaries.test.ts, test/local-authority.test.ts, test/platform-authboundry.test.ts | On-behalf-of only on `/appport` with **local** AuthBoundry; MCP ignores the header; approval-required and integration ops refused; no sub-delegation (G-03) |

## 3. Agent model

| capability | status | API & evidence | tests | limitations |
|---|---|---|---|---|
| AgentHost (tasks, proposals, person approval, exec as owner, checkpoints, evidence, handoffs, reconcile) | Released-0.3.34 | src/runtime/agent.ts: createTask 573, propose 700, approve 1003 (person only, digest-bound, expiry, separate approver), reject 1140, retry 1157, resolve 1176, reconcile 1218, complete 1270, cancel 1291, openHandoffs/claim 1332-1349, note 1368 | test/agent.test.ts, test/agent-lifecycle.test.ts, test/agent-hardening.test.ts, test/approval-binding.test.ts | FeltDB agent state (`_feltdb.Agent*`) outside change feed |
| `app.agent` application agents | Released-0.3.34 | src/app.ts:753-789, 982; `ctx.afterCommit.agent(name,input)`; `on: app.event` | test/agents.test.ts:39-299 | Handler is a mutation; refused in AppBoundry build |
| In-app model turns (assist) | Released-0.3.34 | ActionCtx `agent.catalog/tools/openTask/actions/propose`, `model.generate` (stream, tool calls, receipts) src/runtime/context.ts:351-417 | test/generation.test.ts (11) | — |
| External agents over MCP | Released-0.3.34 | see Remote execution (d); tools gated by `feltkit.agent.read/write` src/server/mcp.ts:18-24 | test/agent.test.ts, test/mcp-idempotency.test.ts | No task linkage of direct calls |
| G-07 app-facing agent control | **Partly** | 0.3.34: `GET /api/agent/actions`, SSE `/api/agent/actions/events`, `POST /api/agent/actions/approve|reject` (owner's own tasks only), client `ownActions/watchOwnActions/approveAction/rejectAction`, `useOwnActions` (dist/client/index.d.ts:355-371; dist/react/index.d.ts:47). **Missing:** `ctx.agent.get/list` in queries; app retry/resolve/cancel; approval of agent-owned tasks outside Studio; per-task read scoping; MCP-call↔task linking | test/agent.test.ts | G-07 **not closed in 0.3.34**; unreleased control API adds stop(=cancel)/pause/resume/interrupt for any person |
| Agent acting for a person over /appport | Released (0.3.33) | CL:101-113 | test/delegated-appport*.test.ts | Local AuthBoundry only |
| Steering: signal/submit/withdraw/pause/resume/interrupt/stop, checkpoint/acknowledge | **Unreleased-source** | src/runtime/agent-control.ts (484 lines); `ctx.agent.checkpoint/acknowledge` src/runtime/context.ts:413-415; HTTP src/server/index.ts:446+; MCP tools; AppPort `appport.agent-control/1` (src/runtime/agent-control-capabilities.ts) | test/agent-control.test.ts:89-589 (13 tests) | No agent loop runner; `appport.agent.changed@1` event not yet; needs @appport/core ≥1.11 |
| Per-task capability scopes (G-04) | Missing (adjacent) | Per-agent grants with capability list + expiry exist (`ctx.authority.grants.grant`), not per task | — | Integration ops bounded by roles |
| Approval provenance (G-05) | Partial | Available to `authorize` hook (`approval: {taskId, actionId, approvedBy}` src/authorize.ts:63-64; dist/authorize.d.ts:71) and on audit record (src/runtime/runtime.ts:1725-1726); **not on `ctx.auth`** (src/runtime/authority.ts:332-356) | — | — |
| Conditional approval | Missing (for app fns) | `approval: "required"` only (src/app.ts:739); platform ops have `requiresApproval(input)` | — | — |

## 4. Execution

See "Remote execution plane". Summary rows:

| capability | status | API & evidence | tests | limitations |
|---|---|---|---|---|
| Placement-neutral execution (`feltkit.execution/1`, adapters, placement, attempts) | Released-0.3.34 | src/execution.ts; src/runtime/execution-host.ts; docs/EXECUTION.md | test/execution.test.ts (12) | Remote worker protocol, re-placement, preemptive cancel: designed only |
| Run commands/processes | Released-0.3.34 (platform only) | `command.run` in `feltkit platform serve` | test/platform-exec.test.ts | Not available to application functions; allowlist node/npm/git/feltkit; G17 isolation on CI unverified |
| Workspaces / git | Released-0.3.34 (platform only) | `workspace.*`, `source.*` | test/platform-workspaces.test.ts | Local git only, no push/PR/remote |
| AppBoundry | Released | wasm artifact runs functions/schema/services via host interfaces; refuses `ctx.agent`, `app.agent`, providers, invocation store (docs/APPBOUNDRY.md:235-260; CL:85-86) | test/appboundry*.test.ts | Not a process runner |
| Remote runner / daemon claiming work | **Missing** (only components' in-process `ctx.work.claim` and invocation `start` via functions) | — | — | — |
| Agent loop runner | **Missing** | CL:34-35 | — | — |

## 5. Invocations

| capability | status | API & evidence | tests | limitations |
|---|---|---|---|---|
| Surfaces + `feltkit.invocation/1` | Released-0.3.34 | `app.surface(id,{delivery:"session"|"bridge",…})` src/app.ts:1230; `normalizeInvocation` src/surfaces.ts | test/surfaces.test.ts (7) | Instruction ≤2000 chars, ≤5 context items; result ref ≤4 KB |
| Lifecycle `received→…→completed|failed|cancelled`, dispatch as job, recovery | Released-0.3.34 | `ctx.invocations.accept({surface, envelope, person?, dispatch:{job,payload,requirements,placement}})` → job handler `start/progress/transition`; src/runtime/invocations.ts | test/invocations.test.ts:65-276 | Live queries not notified; separate writes; not in artifacts |
| awaiting_approval approved by person, resume | **Published-later (0.3.35)** | `POST /api/invocations/<id>/approve {digest}` / `reject {reason}`; `resume` refuses NOT_APPROVED; recovery expires (src/runtime/invocations.ts:525-557, :622-628) | test/invocations.test.ts:308,347,366,403 | In 0.3.34, resume needed no approval (defect) |
| Relation to jobs | — | dispatch = after-commit outbox → AppPort Services job (managed adapter) → handler runs as the accepting principal | — | — |

## 6. AppPort Services (0.20.0 via FeltKit)

| capability | status | API & evidence | tests | limitations |
|---|---|---|---|---|
| Jobs | Released-0.3.34 | `services.jobs.handlers {type:"mod:fn"}`; `ctx.services.jobs.enqueue(type,payload,{runAt,maxAttempts})` / `ctx.afterCommit.jobs.enqueue` src/runtime/services.ts:246-248; durable lease/retry in FeltDB (services docs/capabilities.md) | test/services.test.ts, test/services-released.test.ts | Run in-process as enqueuer; no job cancel (M2 G14); jobs CAS defects deferred |
| Schedules | Released-0.3.34 | `services.schedules` (needs jobs) | — (TA-10: not exercised e2e) | No workspace on scheduled jobs |
| Notifications | Released-0.3.34 | `send/markRead/dismiss/markAllRead`, inbox paging, unreadCount (services 0.20.0 CHANGELOG; src/runtime/services.ts:222-231) | test/notification-paging.test.ts | In-app inbox; e-mail channel only for account mail; no outbound email/SMS to non-principals (TA-7) |
| Webhooks | Released-0.3.34 | Outbound `ctx.services.webhooks.emit` (signed); inbound `services.webhooks.inbound {provider:{handler,roles}}` at `/webhooks/inbound/<id>` with signature/timestamp/replay checks (src/runtime/services.ts:279-292) | test/services.test.ts, test/integration-settings.test.ts | Replay disabled in prod (S8); delivery inspection only in Studio (TA-6) |
| Files | Released-0.3.34 | `upload/remove/link/uploadLink`, image variants (src/runtime/services.ts:156-165, 272) | test/file-lifecycle.test.ts, test/file-links.test.ts, test/file-cache-variants.test.ts | Bytes in FeltDB (`_feltkit_file_content`); >1000 files list fixed only unpublished |
| Configuration | Released-0.3.34 | `ctx.services.configuration.get/set/remove` src/runtime/services.ts:234-243 | test/production-online-admin.test.ts:89 | No history/rollback |
| Outbox (`ctx.afterCommit`) | Released-0.3.34 | `notifications.send`, `webhooks.emit`, `jobs.enqueue`, `agent(name)`, `work(component,…)` src/runtime/transactions.ts:198-217 | test/outbox.test.ts:50-138 | Anonymous callers can't stage (TA-1) |
| Intelligence | Released-0.3.34 | provider/model config only (`services.intelligence`) | test/models-saved.test.ts | — |
| API keys | Released-0.3.34 | `services.apiKeys {roles}` | test/services.test.ts | — |
| Evidence | Released | services `evidence` store; FeltKit's own evidence in agent memory/attempt records | — | NEW-14 bounded find defect |

## 7. Integrations, providers, credentials

| capability | status | API & evidence | tests | limitations |
|---|---|---|---|---|
| `app.integration` (HTTP ops recorded, idempotency, verify, unknown never re-sent) | Released-0.3.34 | src/app.ts:552-680, 1239; `ctx.integrations.invoke(cap,input,{idempotencyKey,onBehalfOf})` src/runtime/context.ts:334-349 | test/integrations.test.ts:42-224 | **G-09 open:** `onOutcome` failure only logged (src/runtime/integrations.ts:502-505); GAP-08 base URL/creds env-only |
| OAuth2 credentials for integrations | Released (0.3.29) | docs/OAUTH-CREDENTIALS.md | test/oauth-credentials.test.ts (12), test/oauth-production.test.ts | Generic OAuth; nothing GitHub-specific |
| Per-person connections | Released-0.3.34 | `credential.owner:"person"`; `ctx.integrations.connections.list/connect/disconnect` (dist/runtime/context.d.ts:445); `/api/integrations/connections` | test/connections.test.ts (7) | "Reference implementation"; AppPort contract not yet written (CONNECTIONS.md:3-11) |
| Providers (`feltkit({providers})`, channels, `client.invoke`) | Released-0.3.34 | CL:69-89; src/runtime/providers.ts; `/api/capability/<name>` | test/providers.test.ts (15) | Refused in AppBoundry; in 0.3.34 retry could repeat unknown effect (fixed 0.3.36 pins) |
| Unknown-outcome settlement (`/api/provider-calls`, verify, settle) | **Unreleased-source** | CL:3-17; src/server/index.ts:701 | test/providers.test.ts "settle: …" (4) | Needs @appport/core 1.11.0 |
| Credential custody | Released | `credential-ref:<id>` → `FELTKIT_CREDENTIAL_<ID>` or vault (`FELTKIT_CREDENTIAL_VAULT[_KEY]`) src/runtime/credentials.ts:4-21 | test/credential-custody.test.ts, test/credential-database.test.ts | — |
| GitHub built-ins | **Missing** (only sign-in endpoints src/server/oauth.ts:49,297) | — | — | No GitHub API client, PRs, checks, webhooks provider |
| Resolver (resolver-client 0.3.0) | Released for **models only** | `agent.model: "ref://…"`; ResolverClient used only in src/runtime/decisions.ts:28 | test/resolver-model.test.ts (6), test/resolver-revocation.test.ts | Not for integrations/secrets (GAP-08); Resolver not deployed (PRODUCT-REALITY-AUDIT) |

## 8. Models

| capability | status | API & evidence | tests | limitations |
|---|---|---|---|---|
| Decision runtimes + generation | Released-0.3.34 | OpenAI chat / openai-compatible / Anthropic Messages (src/runtime/decisions.ts:13, 200-283); `ctx.model.generate/status` in actions; `agent.decisions/model/timeouts`; component `ctx.model()` | test/decisions.test.ts, test/generation.test.ts, test/browser-inference.test.ts | Server-side model calls only within actions/agent decide; usage recorded per generation receipt |

## 9. Realtime

| capability | status | API & evidence | tests | limitations |
|---|---|---|---|---|
| Live queries / change SSE | Released-0.3.34 | `/api/events` | test/live-predicates.test.ts | — |
| `app.event` ephemeral events | Released-0.3.34 | `app.event(name,{payload,access})` src/app.ts:950; `ctx.events.publish(event,payload,{scope})` (mutations, after commit) src/runtime/context.ts:7-9; `useEvent` | test/events.test.ts:32-97 (re-authorized per delivery) | Publish only from mutations; action `ctx.emit` only to its caller's stream |
| Presence / transient signaling / quotas | **Documented-only** (proposal) | docs/PRESENCE-AND-SIGNALING-PROPOSAL.md:1-15 | test/presence-contract.test.ts = all `test.todo` | Only session-binding (`onSessionEnd`) implemented; no rate limiting (TA-8) |

## 10. Activity / audit

| capability | status | API & evidence | tests | limitations |
|---|---|---|---|---|
| Activity log | Released | bounded (default 2000), Studio `/activity`; `activity.record` option src/app.ts:375-381 | test/audit.test.ts, test/large-collections.test.ts:158 | **G-08:** no `ctx.activity` for apps |
| Durable decision evidence | Released (≤0.3.32) | `_feltkit_decisions`, admin `/decisions` (CL:461-464) | test/policies.test.ts | Operator/admin API, not application-readable |
| `app.auditTrail`, `ctx.db.sequence` | Released-0.3.34 | see §1 | as §1 | — |

## 11. Studio
Operators: overview, capabilities, data explorer (edits disabled in prod), services (jobs retry, webhook deliveries/replay [prod-disabled], inbound integrations disable/rotate), agent tasks (create handoff, approve/reject/retry/resolve/cancel/decide), activity, readiness, models (+test), integrations, credentials, sessions revoke, policies/decisions, online backup; platform `/review` page for change sets. Routes: src/server/admin.ts (route table; `cancel` at :678). Dashboard not served in prod unless `FELTKIT_DASHBOARD=1` (src/cli/main.ts:874).

## 12. Usage / cost metering (G-14)
**Missing.** Only per-generation `usage` on receipts for in-app generations (src/runtime/decisions.ts:657-659; src/runtime/agent.ts:188). Nothing meters external MCP agents.

## 13. Search, files, large collections — see §1 and §6.

## 14. EVE and Intent
- **EVE: not found** as a system. Only "an eve agent" as an example phrase (docs/LOCAL-AUTHORITY.md:116) and a test user named `eve` (test/search.test.ts:24). Nothing in installed @feltdb/@appport packages.
- **Intent: not wired.** FeltDB `IntentService` (`@feltdb/core/dist/intent.d.ts`, `_feltdb.Intent` collection) is an app-development planner over `.flow` contracts; "not wired into FeltKit"; Rust `record_intent` unbound in TS (docs/M1-AGENT-FOUNDATION-AUDIT.md:109-111; docs/PLATFORM-PLAN.md:14). No reference in FeltKit src.

## 15. felt-ops gaps (FELTKIT-GAP-REPORT.md)

| Gap | Status at 0.3.34 | Later / src | Evidence |
|---|---|---|---|
| G-01 account lifecycle | Open (internal `setDisabled/setRoles` only; per-tenant role change exists) | same | src/runtime/accounts.ts:386-399 |
| G-02 session control | Mostly closed for operators (online revoke by principal/ref; own-session revoke; onSessionEnd) | — | test/production-online-admin.test.ts:54 |
| G-03 delegation | Partly (per-agent grants, on-behalf-of over /appport, local AuthBoundry); no sub-delegation | — | CL:99-113, 368 |
| G-04 per-task scopes | Open (per-agent capability grants w/ expiry only) | — | src/runtime/context.ts:225-250 |
| G-05 approval provenance | Partial (authorize hook + audit, not ctx.auth) | — | src/authorize.ts:63-64 |
| G-06 resource-attribute authz | Closed via `app.policy`, `owner`, `authorize` | — | CL:449-492 |
| G-07 app-facing agent control | Partly (own-task approve/reject + hooks) | Unreleased steering adds stop/pause/resume/interrupt; still no ctx.agent reads, retry/resolve, or agent-owned approval outside Studio | §3 |
| G-08 queryable decision evidence | Partial (`_feltkit_decisions` via admin API) | — | CL:461 |
| G-09 durable integration outcomes | Open | Unreleased settlement is for provider calls, not onOutcome | src/runtime/integrations.ts:502-505 |
| G-11 ops/managed path | Partly (online admin/backup; many items) | — | test/production-online-admin.test.ts |
| G-12 dev/prod principal parity | Not verified in this pass | — | — |
| G-14 usage/cost | Open | — | §12 |
| G-15 constraint parity | Closed (before 0.3.34) | — | CL:1232-1241; test/contract-parity.test.ts |
| G-16 client/server version check | Not found (no server-release comparison in src) | — | grep negative |
| (G-10, G-13 not present in the report) | | | |
