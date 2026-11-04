# FeltKit hardening plan: decision document

2026-11-04. Basis:
- the reconciled road-test documents (`ROAD-TEST-FINDINGS.md`, `FELTKIT-GAP-REPORT.md`,
  `AGENT-OPERATOR-EVALUATION.md`, `FINAL-EVALUATION.md`, `EXTRACTION-AUDIT.md`, which is the
  extraction and code-economics document);
- `MANAGED-FELTDB-RECOVERY.md`.

**This document authorizes nothing.** Phase 1 and 2 changes need separate approval.

## 1. Repository and release state

| Item | State |
|---|---|
| `rkendel1/felt-ops` (CompanyOS) | branch `claude/keen-cannon-gxv0v3` at `5d08006`, clean, equal to its remote |
| `rkendel1/feltkit` | `main` at `7a01c39` (2026-11-03 21:41 UTC); `packages/sdk` version 0.3.13. Its source matches the published `@feltdb/feltkit@0.3.13` (22:15 UTC; `feltdbContract` differs only in type annotations) |
| `rkendel1/flow_db` | `main` at `f428423`; contains the fix `85a869c` and release 0.21.0 (`e356149`). CI on `main` failing since about 17:13 UTC on 2026-11-03 |
| Published packages | `@feltdb/feltkit` 0.3.13, `create-feltkit` 0.3.13, `@feltdb/core` 0.21.0 (requires `>=0.21.0`), `@appport/sdk` 1.4.0 pinned (1.4.1 exists) |
| Managed FeltDB (`api.feltdb.com`) | server 0.6.0 / release 0.19.0 / `791cb05`: predates the fix (F-041) |
| CompanyOS managed app | production on version 2 (starter, F-050); recovery pending your decision |
| Local processes | none running (container restarted); local production state intact on disk |
| Owner | rkendel1 owns FeltKit and FeltDB: every item below has one owner and two repositories |

## 2. Managed FeltDB

See `MANAGED-FELTDB-RECOVERY.md`. Summary:
- **F-050:** restore version 1 with a production `rollback` (recommended, needs your
  authorization). Fall back to promoting with destructive approval only if separately
  authorized for diff `sha256:6a4f4baf…`. Then revoke the two keys the control run created.
- **F-041:** the service will stay stale until FeltDB CI on `main` is green, or a
  deliberate `workflow_dispatch`. Then confirm with `check-managed-release-identity.mjs`. One
  failing CI step, named in the recovery document.

## 3. Phase 1 plan: managed correctness and deployment safety

Ordered by dependency. Each item is a separate, reviewable change with its own tests.

| # | Finding | Owner / repo | Change | Files | Tests |
|---|---|---|---|---|---|
| 1a | F-048 contract parity (unique, indexes, **references**, all dropped) | FeltKit | Derive the managed manifest from the compiled state contract (`compileStateContract`), not from a second walk of `app.collections`. One canonical model, two serializers: local `StateContract`, managed manifest (unique → `indexes[{unique, sparse}]`, indexes, references) | `packages/sdk/src/runtime/contract.ts` (`feltdbContract`), `state-contract.ts` (expose the compiled document), `storage-check.ts` (`verifyContract` compares with the same model) | `packages/sdk/test/contract.test.ts`: a fixture app with unique (incl. sparse), compound indexes and `s.ref`. For every app collection, assert local and managed declare the same fields/types, unique tuples, index field lists, references. A regression fixture of CompanyOS's **declarations only** (21 unique, 18 indexes; no business code). Fails if any declaration is dropped |
| 1b | F-048 server side | FeltDB | Confirm the publish path and the server enforce `indexes[].unique` on managed (the server source has `SchemaIndex.unique`; managed enforcement is unverified) | — (verification) | canary write of a duplicate → refused |
| 2a | F-051 compatibility contract | FeltDB | Publish a stable compatibility field. Not the npm version and not the build commit; e.g. `/health` `compatibility: { contract: "feltdb.public.substrate@1.x", features: ["query.scoped-empty-index", …] }`. Make readiness "runtime compatible" consider the client's declared requirement | server `/health`, readiness | server test: feature list present |
| 2b | F-051 client check | FeltKit | Declare `REQUIRED_FELTDB_SERVER = { features: [...], minRelease: "0.21.0" }`. Check it in `verifyStorage` before any read, and in the managed setup/publish wrapper (item 3). Error: "FeltKit 0.3.x requires FeltDB server ≥0.21.0 (needs query.scoped-empty-index); https://api.feltdb.com reports 0.19.0 (791cb05). Server too old: update the service, or use FeltKit ≤…". If the service exposes no compatibility field, fall back to `release_id` semver with an explicit warning | `packages/sdk/src/runtime/storage-check.ts`, new `runtime/server-compat.ts` | unit: old / new / missing field; e2e (`tests/e2e/managed-feltdb.test.mjs`): a server reporting an old release is refused **before** any query; **new opt-in live canary** (`FELTDB_LIVE_URL`) asserting the live service satisfies the requirement |
| 3 | F-037, F-049 | FeltKit | Add `feltkit managed <init\|publish\|keys>`, which runs FeltKit's own nested `feltdb` binary, always passing `--name <app.name>` (FeltKit's identity) and the contract path. Make `deploy` print these commands. Refuse when `package.json` name ≠ app name unless `--name` is given | `packages/sdk/src/cli/main.ts`, `cli/deploy.ts` (lines 306, 312) | CLI test: printed commands run in a fresh scaffold; a name mismatch is refused |
| 4 | F-039 | FeltKit | Copy the managed template's ignore rules (`.env`, `.env.*`, `.feltdb/`) into the default template | `examples/tasks/_gitignore` (synced to `packages/create/template` by `sync-template.mjs`) | `packages/create/test`: a scaffolded `.gitignore` ignores `.env.local` and `.feltdb/managed.json` |
| 5 | F-042 | FeltKit | Default deploy output becomes a new release directory (`.feltkit/releases/<id>`, the mechanism platform PR 3 already uses), with `.feltkit/deploy` as a pointer. If an artifact directory is targeted in place, refuse while `readRuntimeRecord()` reports a live process. Keep the state-preserving `rename` | `packages/sdk/src/cli/deploy.ts` (`replaceArtifact`, lines 41–48, 102–106), `runtime/projects.ts` (reuse) | deploy test: a live runtime record → refused, nothing deleted; state identity (inode) preserved across releases |
| 6 | F-038 | FeltDB | Make `init-managed --help` print help and write nothing | flow_db CLI `commands.js` (published as `@feltdb/core`) | CLI test in an empty directory: no files created |
| 7 | F-040, F-052 | FeltDB | The approval refusal names the flag, the diff hash and the changes it approves. **Review why adding a collection is classified `destructive`/`REQUIRES_MIGRATION`.** Ordinary growth needing destructive approval trains people to use the flag (how F-050 happened) | flow_db `publish-engine.js`, server diff classification | diff test: add-only → not destructive; message names the flag and the hash |
| 8 | Acceptance (D) | both | Run the isolated canary (`MANAGED-FELTDB-RECOVERY.md` §4), then CompanyOS after 1a | — | see §6 |

Dependencies: 1a before 8 (CompanyOS); 2a before 2b's preferred path (2b has a fallback);
F-041 deploy before 8; 3 depends on nothing.

## 4. Phase 2 API proposals (design only)

Common rules for all three:
- reuse existing stores (`AccountStore`, `FeltDbSessionStore`, `AgentHost`, the outbox);
- every operation is authorized by the existing `Authority` and recorded in activity;
- applications get typed operations, never raw collections;
- no business rules.

### G-01 / G-02: identity and session lifecycle

```ts
// Platform capabilities (AppPort, Studio, CLI; one handler each)
"feltkit.accounts.disable"   { accountId, reason }                      // revokes the account's sessions
"feltkit.accounts.enable"    { accountId, reason }
"feltkit.accounts.roles.set" { accountId, roles: string[], reason }     // revokes sessions; roles must be declared
"feltkit.sessions.revoke"    { principalId, reason } → { revoked: number }
"feltkit.sessions.issue"     { principal: { id, type, roles }, ttlMs } → { token }   // production, no downtime
// In mutations, as the caller (like ctx.services):
ctx.identity.disable(principalId, reason); ctx.identity.revokeSessions(principalId, reason)
// App binding of an authenticated account to an app identity:
auth: { onSignIn(account) => { principalId, roles } | null }            // null refuses sign-in
```

- **Permissions:** `feltkit.accounts.write`, `feltkit.sessions.revoke`,
  `feltkit.sessions.issue`; none granted by default.
- **Fail closed everywhere:**
  - one principal-status record (disabled / revoked-at) is checked in `principalForToken` and
    `resolvePrincipal`;
  - this covers HTTP, AppPort, MCP, jobs and schedules (which re-authorize as their creator),
    outbox recovery, and agent action owners;
  - **dev parity (F-022):** `resolvePrincipal({ devUsers: true })` honors the same record.
- **Lifecycle:**
  - disable → sessions revoked; sign-in refused; queued work owned by the principal fails
    authorization (recorded), never runs silently;
  - enable → sign-in allowed; no sessions restored.
- **Replaces:** CompanyOS `actor()` stops being the only barrier. It stays as a business rule
  ("employee departed") but no longer guards platform access.
- **Security analysis needed:** who may disable an operator; lockout (refuse disabling the last
  holder of `feltkit.accounts.write`); audit of every change; behavior of tasks owned by a
  disabled agent (actions fail closed at approval, as today for an unresolvable owner).

### G-07: application-facing agent control

```ts
// Queries (read, typed, scoped)
ctx.agent.get(taskId) → TaskView                                      // checkpoints, actions, outcomes, provenance
ctx.agent.list({ subject?: { collection, id }, state?, cursor?, limit? }) → { tasks, cursor }
ctx.agent.approvability(taskId) → Record<actionId, { allowed, reason? }>
// Operations: platform capabilities with AgentHost's existing checks, callable from the
// client (useAgentTask / useAgentTasks / client.agent.*) and AppPort, NOT inside a
// mutation's transaction (they execute actions):
"feltkit.agent.approve" { taskId, actionId, note? }
"feltkit.agent.reject"  { taskId, actionId, reason }
"feltkit.agent.retry" | "feltkit.agent.resolve" { outcome, note } | "feltkit.agent.cancel"
// Approval provenance (G-05, folded in: the data already exists)
ctx.auth.approval?: { taskId, actionId, approvedBy }                  // set only during an approved execution
// Association and liveness
MCP: tools/call accepts `_meta.feltkitTaskId`; matching calls are attached to the task
TaskView.calls (bounded), TaskView.lastSeenAt
```

- **Visibility:**
  - today: `feltkit.agent.read` sees every task;
  - proposed: tasks carry `subject` (exists) and an optional `visibility` (`owner` |
    `permission:<p>`); `list` filters by it;
  - `feltkit.agent.read` alone keeps today's behavior, for compatibility.
- **Guarantees kept:**
  - approval only by a person who may perform the action;
  - execution as the owner;
  - compare-and-swap per action (one run per approval);
  - interrupted actions settled from evidence or by a person, never replayed.
- **Replaces:** CompanyOS `useAgentTask`/`mcpTool`, the Studio hints, "Why it may act" (via a
  typed `tools(principal)`), "last heard".

### G-09: durable integration outcomes

```ts
operations: { create: { …, onOutcome: "payments:onCreated", context: s.object({ subject: s.string() }) } }
// caller supplies context in the AppPort request envelope, never sent to the API:
POST /appport { capability: "payments.create", input: {…}, context: { subject: "invoice:42" } }
export type IntegrationOutcome<I, O, C> = { call: { id, capability, operation, state, determinedBy, status, input: I, output?: O, error? }, context: C, delivery: { attempt: number, firstAttemptAt } }
```

- **Mechanism:**
  - finalizing the call record (`_feltkit_integration_calls`) and enqueueing an
    `integration.outcome` effect happen in one FeltDB transaction, using the **existing
    outbox** (`runtime/outbox.ts`);
  - the outbox performs it with retry and backoff; states are pending / performing /
    delivered / failed (attempts, last error);
  - visible in `feltkit outbox list`, Studio, and `ctx`-readable for authorized operators.
- **Semantics:** at least once. Handlers key by `call.id` (documented). `call.state` (the
  external result) and the delivery state are separate fields, so a failed handler never looks
  like a failed call, or the reverse.
- **Test:** a handler that throws twice, then succeeds. The call shows `succeeded`, the
  delivery shows `failed → delivered (attempt 3)`, and the application state reflects the
  outcome exactly once.

## 5. Dependency map

| Work | FeltDB | FeltKit | AppPort / Services | External |
|---|---|---|---|---|
| F-041 service update | **owns** (CI fix, deploy) | — | — | Fly deploy |
| F-050 recovery | control plane (rollback) | — | — | your authorization |
| F-048 parity | verify `unique` enforcement on managed | **owns** generator | — | — |
| F-051 compatibility | compatibility field, readiness | **owns** client check | — | — |
| F-037/049 managed CLI | `--name` honored (exists) | **owns** wrapper | — | — |
| F-038, F-040, F-052 | **owns** | — | — | — |
| F-039, F-042 | — | **owns** | — | — |
| G-01/G-02 | — | **owns** (`AccountStore`, sessions, Authority) | Services' gateway re-authorization (verify only) | — |
| G-07 | agent state (read paging exists) | **owns** (AgentHost, MCP bridge, client) | — | — |
| G-09 | — | **owns** (integrations + outbox) | — | — |
| Canary acceptance | service ≥ fix | harness | — | managed account |

## 6. Acceptance criteria

**Phase 0 is done when:**
- the production pointer of `app_VdI0HIgo0jINzwhFSs` is v1, or you have decided to leave it,
  recorded in F-050;
- `/health` `git_commit` contains `85a869c`, confirmed by `check-managed-release-identity.mjs`;
- the starter-created keys are revoked or explicitly kept.

**Phase 1 is done when:**
- the contract parity test passes and fails when any unique, index or reference is removed from
  the generator (checked by mutation);
- a server reporting an old release is refused at start before any query, with both versions in
  the message (e2e);
- the live canary check passes against `api.feltdb.com`;
- the commands printed by `deploy` run as printed from a fresh scaffold (CLI test); `--help` writes
  nothing; a fresh scaffold ignores credential files;
- `deploy` refuses to replace an artifact with a live runtime record, and state inodes survive
  a release;
- the managed canary (`MANAGED-FELTDB-RECOVERY.md` §4) passes every step: publish, promote,
  start, readiness, scoped reads of empty collections, a duplicate write refused by a unique
  constraint, a write/read cycle, restart persistence, isolation (only the canary's app id
  appears in traffic), no tracked credential;
- then the same for CompanyOS, with its own fresh managed app or the restored v1, by your
  decision.

**Phase 2** (each primitive separately) **is done when:**
- **G-01/G-02:** a disabled account and a revoked principal are refused on HTTP, AppPort, MCP,
  a queued job and an agent approval, in development **and** production (test matrix); session
  issue and revoke work while production serves; CompanyOS's Scenario 5 passes with `actor()`'s
  platform guard removed.
- **G-07:** CompanyOS approves an agent action through the typed API with no Studio round trip;
  the existing AgentHost lifecycle tests pass unchanged; a non-permitted approver is refused with
  the same reason as Studio; one approval cannot execute twice (concurrency test).
- **G-09:** the throw-twice test above passes; Scenario 4 shows no silent loss.

**Phase 4** (people) **is done when:** the harness fixes are in place (W05 check; display checks
for W08–W11 and W15; console and Studio capture; timings without fixed waits); 2–3 real
operator sessions (novice and experienced) are recorded; and someone other than the builder has
reviewed them. Until then, no usability claims.

## 7. Scope and risk

**Untouched:**
- CompanyOS business code and schema;
- the CompanyOS managed application (until authorized);
- delegation, resource-attribute authorization, conditional approval, cost metering;
- AuthBoundry and Resolver;
- OperationsHub;
- business limits, approval chains, assignment semantics, policy effective dating, business
  verification (all application responsibilities).

**Risks:**
- F-048's fix makes managed contracts stricter. Existing managed apps with duplicate data would
  fail to publish the new contract. That is intended, and needs a migration note and a
  pre-publish check that reports violations.
- F-051 needs FeltDB to commit to a compatibility field. Until then the release-semver fallback
  is approximate, and must be labeled as such.
- G-01's fail-closed behavior can strand queued work owned by a disabled principal. That is
  intended, and must be visible.
- G-07 visibility scoping changes who sees tasks. Default to today's behavior.
- Managed FeltDB is one machine with no replica (per its own docs). Multi-instance claims stay
  out of scope until tested.
