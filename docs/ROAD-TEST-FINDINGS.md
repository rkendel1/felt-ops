# Road-test findings

Every defect, limitation, friction point, workaround and untested area observed while building
and operating CompanyOS on FeltKit 0.3.13 (2026-11-03). Operator-experience findings from the
independent evaluation are in `AGENT-OPERATOR-EVALUATION.md` (IDs `E-…`).

**Classification:** **FK-defect** (FeltKit behaves wrongly) · **FK-gap** (a missing platform
primitive) · **Doc** (documentation gap) · **App** (CompanyOS defect) · **Ext** (external or
environment limitation) · **Untested**.
**Severity:** Critical / High / Medium / Low / Info.

## Summary

| ID | Sev | Class | Finding | Workaround in CompanyOS |
|---|---|---|---|---|
| F-001 | Low | FK-gap | `@appport/sdk` pinned exactly at 1.4.0 by FeltKit; 1.4.1 published | none (cannot adopt) |
| F-002 | Info | Doc | Stack is delivered as one package; `@feltdb/core`, `@appport/*` are not direct dependencies | n/a |
| F-003 | Low | Doc | Scaffold app name (`my-app`) is the FeltDB namespace; `package.json` name does not set it | renamed before any state |
| F-004 | Medium | FK-defect | `readiness` fails production for a missing decision model even when the app makes no model decisions | ignored |
| F-005 | Low | FK-defect | `readiness` (a check) creates `.feltkit/production/state` | none |
| F-006 | High | FK-gap | Application code cannot read agent tasks/actions | UI reads them through `/mcp` with the person's session |
| F-007 | High | FK-gap | Agent actions can only be approved in FeltKit Studio | operator workspace links to Studio |
| F-008 | Medium | FK-gap | The handler of an approved action cannot see who approved it | approval stays only in FeltKit's action record |
| F-009 | Medium | FK-gap | Activity log is bounded (2,000 by default) and unreadable by the app; not an audit trail | domain `timeline` collection; retention raised to 20,000 |
| F-010 | High | FK-gap | Built-in accounts cannot be disabled; roles cannot be changed; every account gets the same roles | `actor()` refuses departed people |
| F-011 | High | FK-gap | Application code cannot revoke or suspend sessions; session roles are fixed at issuance | `actor()` refuses suspended agents |
| F-012 | Medium | App | R1: platform role and business grant both required; nobody outside Finance held both | fixed in R2 |
| F-013 | High | App (deliberate) | R1: same invoice via manual entry and feed created two commitments | fixed in R2 (Scenario 3) |
| F-014 | Medium | App | Policy approved after its effective date would be in force retroactively | fixed before commit |
| F-015 | Medium | FK-gap | Agent task visibility is all-or-nothing (`feltkit.agent.read` sees every task) | none |
| F-016 | Info | Ext | In this sandbox, Node's env proxy is ignored under the `tsx` loader, so integrations cannot reach GitHub from `dev`/`test` | live GitHub checks run in CI and in production |
| F-017 | Low | App | Scenario 2 test assigned an agent as engineering (no `assignments.write`); path only reachable with network | fixed; caught by CI |
| F-018 | High | FK-defect | A failed `onOutcome` is only logged as a warning: the call succeeds, the app's state silently does not change, nothing retries | made handlers correct; no retry |
| F-019 | Medium | Doc | `onOutcome` receives `capability`, not `operation` (the exported `IntegrationCall` type has `operation`) | derive operation from capability |
| F-020 | Medium | FK-gap | Direct MCP tool calls by an agent are not attached to its FeltKit task; only proposals are | "what it changed elsewhere" from app records |
| F-021 | Low | FK-gap | No way to pass context to `onOutcome` except as operation input, which is sent to the external API | `subject` sent to GitHub as an ignored query parameter |
| F-022 | Medium | FK-defect | Dev/test resolve declared dev agents after their sessions are revoked, so approving a lost agent's proposal runs it; production fails closed | suspend the agent in CompanyOS |
| F-023 | Medium | FK-gap | Issuing a production session and backing up local production both require stopping the server | planned downtime |
| F-024 | Medium | FK-defect | `feltkit deploy`'s `.env.example` omits integration base URL variables; found at first call | set by hand |
| F-025 | High | FK-gap | Production identity bootstrap: with sign-up closed, people get in only through CLI sessions; account principal ids cannot be linked to app records | CLI sessions per person |
| F-026 | — | Untested | Docker run, Fly.io and Vercel deployments | local production with Node |
| F-027 | Info | FK-gap | CompanyOS is not portable to AppBoundry (approval, integrations, agent) | not needed |
| F-028 | Medium | FK-gap | Refusals are invisible to the app; effectiveness metrics cannot count them | stated in the metrics UI |
| F-029 | Medium | FK-gap | Agent sessions carry roles, not per-task scopes | `withinAssignment()` on CompanyOS mutations |
| F-030 | Medium | FK-gap | No delegation primitive (AuthBoundry adapter not shipped) | agents may not delegate |
| F-031 | Medium | FK-gap | No resource-attribute authorization; limits and departments are application logic | `authorities` collection |
| F-032 | Low | FK-gap | No usage/cost metering for external agents | agent-reported usage, labelled |
| F-033 | Medium | Ext | No pull request was opened: the repository had no base branch, and pushing other branches was not authorized | commits + CI runs on one branch |
| F-034 | Info | — | Platform upgrade 0.3.12 + FeltDB 0.20.0 → 0.3.13 + 0.21.0 on production data: same contract, data verified (positive) | n/a |
| F-035 | Info | FK-gap | `approval: "required"` cannot be conditional (e.g. only above an amount) | separate capabilities would be needed |
| F-036 | Medium | App + FK-gap | After-commit webhooks run as the caller; roles without `webhooks.emit` committed the change and the announcement was then denied, only logged (`incident.opened`) | fixed: staff and integration agent hold `webhooks.emit/deliver` |
| F-037 | Medium | Doc | `npx feltdb init-managed` (printed by `feltkit deploy` and the README) fails: npm 404, the `feltdb` binary is only nested inside `@feltdb/feltkit` | call `node_modules/@feltdb/feltkit/node_modules/@feltdb/core/bin/feltdb.js` |
| F-038 | Medium | FK-defect | `feltdb init-managed --help` runs setup: writes `feltdb.config.json` and an empty `feltdb.flow` into the project | removed the files |
| F-039 | High | FK-defect | `init-managed` writes credentials (`.env.local`, `.feltdb/managed.json`) to the project root; the scaffold's `.gitignore` does not cover them | added to `.gitignore` |
| F-040 | Low | Doc | A first publish is refused "Publish requires explicit approval … authorization boundary changed" without naming the flag; the flag is `--approve-destructive-changes` for a non-destructive first contract | flag found in source |
| F-041 | High | Untested (open) | The hosted artifact refused to start on Managed FeltDB: `the schema-declared scoped equality index is unavailable (HTTP 422, INDEX_UNAVAILABLE)` after the contract was published and promoted. Not yet diagnosed (transient index build vs. an index Managed FeltDB does not support) | none: hosted target not working |
| F-042 | Medium | FK-gap | Interactive `feltkit deploy` replaces `.feltkit/deploy`, the directory the local production deployment was started from (its state is kept; a restart would load the new target) | use `--out` |
| F-043 | Medium | FK-gap | The Studio link FeltKit reports to the app (`session.dashboard` = `/_feltkit/`) carries no credential: an operator following it from the app is not signed in | guide points to the printed link |
| F-044 | Medium | FK-defect | Studio shows an agent's own working task (created with `feltkit_agent_create`, default playbook `handoff`) as "Waiting for a coding agent — Nothing works on this task until one claims it" | none |
| F-045 | Medium | FK-gap | Studio's approval screen shows the proposal's raw input (record ids), not what it affects (amount, invoice, supplier) | agents put business detail in the proposal reason |
| F-046 | Medium | FK-gap | An app-level suspension is unknown to Studio: Approve stays available; the approved action then fails at CompanyOS's check | refused at execution |
| F-047 | Low | FK-gap | No agent liveness signal: a crashed agent process is visible only as silence | "last heard from the agent" from app records |

## Details

### F-004 · `readiness` fails production without a decision model — FK-defect, Medium
- **Repro:** fresh scaffold; `npx feltkit readiness --env production`.
- **Expected:** a model is required only when the app uses `ctx.agent.start` or `decide` tasks.
- **Actual:** `✗ Decision model: No model is selected` and exit 1, for the starter and for CompanyOS, neither of which makes model decisions.
- **Evidence:** ROAD-TEST-BASELINE §4.
- **Remediation:** make it conditional on declared use, or a warning.

### F-005 · `readiness` writes state — FK-defect, Low
- **Repro:** fresh scaffold; run `readiness --env production`; `ls .feltkit` shows `production/`.
- **Expected:** a check has no side effects.

### F-006 · Application code cannot read agent state — FK-gap, High
- **Repro:** in a query, `ctx.db.find("_feltdb.AgentTask", {})`.
- **Actual:** `NOT_FOUND: Collection "_feltdb.AgentTask" is not declared by this application.` No `ctx.agent` read API (only `start`).
- **Impact:** an application cannot show, report on or verify agent actions, the core of an operator workspace.
- **Workaround:** the CompanyOS UI calls `/mcp` `feltkit_agent_get` with the signed-in person's own session (any person with `feltkit.agent.read`), with JSON-RPC from the browser, untyped.
- **Remediation:** a typed read API (`ctx.agent.get/list` in queries, and client hooks).

### F-007 · Agent actions are approved only in Studio — FK-gap, High
- **Evidence:** `server/admin.js` routes `POST /agent/tasks/:id/approve|reject|retry|resolve` exist only in the dev admin API (admin token + act-as) and production Studio (operator grant, cookie + CSRF). MCP has no approve tool (by design). No client or AppPort API.
- **Impact:** two approval inboxes. CompanyOS approvals (purchases, policies, releases) are in the app; agent actions are in Studio. The operator context-switches for every consequential agent step. In production, every approver must hold a Studio operator grant.
- **Remediation:** expose `approve/reject/approvability` to applications as a function-level API with exactly AgentHost's checks (person, `feltkit.agent.write`, may perform the action, owner resolvable).

### F-008 · Approval provenance is invisible to the handler — FK-gap, Medium
- **Evidence:** `runtime.js` puts `{ taskId, actionId, approvedBy }` in the activity entry's `authority.approval`; `ctx` has no equivalent. Scenario 3 evidence: CompanyOS's timeline records `agent-ledger` reversing a commitment, not that Rhea approved it.
- **Remediation:** `ctx.auth.approval` for approved executions.

### F-009 · Activity log is bounded and unreadable — FK-gap, Medium
- Default retention 2,000 entries (`activity.retain`); `ctx` cannot read it. Refusals exist only there. CompanyOS keeps its own domain history (`timeline`, written in the same transaction as each change). This is domain data, not a second audit of platform decisions, but it overlaps.

### F-010 / F-025 · Accounts and production identity — FK-gap, High
- `AccountStore` has sign-up, sign-in, verify, set-password, provider sign-in and get. It has no disable and no role change, and every account gets `auth.accounts.roles`.
- With `signUp: false`, people can only get in through CLI sessions. An account's principal id is derived from its e-mail, and there is no hook to link it to an employee record.
- **Impact:** Scenario 5's "access revoked" cannot be enforced by the platform for an account. CompanyOS refuses departed people itself (`_lib.ts actor()`), and an operator revokes sessions by hand. Production UI sign-in for employees is not usable as built (**untested**); production was exercised with CLI-issued sessions.
- **Remediation:** account disable/enable and role assignment (admin API + capability), and an `onSignIn` hook or principal mapping.

### F-011 / F-023 · Session control — FK-gap, High / Medium
- Application code has no `ctx` access to `sessions.revoke/revokePrincipal`. The app CLI revokes by ref only. Roles are fixed at issuance.
- In production the CLI refuses while the server runs: `A production server is running …; its admin API answers verified operators only`. Production Studio does not manage sessions. Revocation and first-session issuance therefore need a stop (observed twice; seconds of downtime each).
- **Impact:** suspending an agent requires two steps in two systems (CompanyOS status + session revoke). Between them, FeltKit still authenticates the agent; CompanyOS refuses it.

### F-012 · Dual authority layers disagreed (R1) — App, Medium
- **Repro:** R1 source; Priya (Operations head, holds the `purchase.approve.manager` grant for OPS) approves an Operations request → `FORBIDDEN: Missing permission: purchasing.approve`.
- **Cause:** CompanyOS required both a FeltKit permission and a business grant, and only Finance roles had the permission. Found by Scenario 3; fixed in R2 (`2b52654`): all staff hold the permission; grants decide.
- **Lesson:** with no resource-attribute authorization (F-031), the application owns a second layer of authority that must be kept consistent with roles by hand.

### F-013 · R1 duplicated commitments — App (deliberate), High
- Recorded as Scenario 3's cause; reproduced from R1's actual source in `tests/_r1.ts`; fixed in R2.

### F-014 · Retroactive policy approval — App, Medium
- Found while writing Scenario 1: a version approved after its `effectiveFrom` would have been "in force" from before its approval, and verification would then flag requests that correctly followed the old version. Fixed: a version is in force only from `max(effectiveFrom, decidedAt)`.

### F-018 · `onOutcome` failures are silent — FK-defect, High
- **Repro:** an `onOutcome` mutation that throws (here: CompanyOS's scope check rejected `supplierapi.undefined`, see F-019).
- **Expected:** the outcome is delivered at least once (like `ctx.afterCommit`), or the failure is surfaced to the caller or operator.
- **Actual:** `integrations.js` logs `integration: <fn> failed for <id>: …` as a warning. The capability call returns success, and the app's state never reflects the result. Scenario 4 first run: invoices fetched, nothing imported, link still "healthy".
- **Remediation:** an outbox for outcome handlers with retry, plus a visible failed state per call.

### F-019 · `onOutcome` payload shape — Doc, Medium
- **Actual payload:** `{ id, capability, state, determinedBy, status, input, output, error, idempotencyKey }` (`integrations.js` `#onOutcome`). The exported `IntegrationCall` type, which an app naturally uses, has `operation`, `integration`, `principal`, `request`.
- **Remediation:** export the payload type and document it.

### F-020 · Direct tool calls are not part of the agent task — FK-gap, Medium
- An observation the agent calls directly over MCP (e.g. `supplierapi_invoicesv1`), or a consequential capability without mandatory approval (e.g. `integrations.isolate`), is recorded only in the activity log. The task's actions and checkpoints show proposals only. The operator cannot see "what it invoked" for the work.
- **Workaround:** the assignment page lists what the agent changed in CompanyOS records since the assignment started. Calls that changed nothing are visible only in Studio → Activity.

### F-022 · Dev/test principal resolution diverges from production — FK-defect, Medium
- **Repro:** test/dev: agent `agent-ledger` (a declared dev user) proposes; revoke its sessions (`revokePrincipal`); a person approves → **the action runs as the agent**. `resolvePrincipal("agent-ledger")` → `null`; with `{ devUsers: true }` → the agent.
- **Expected:** the documented guarantee, "If the owner cannot be resolved (no session, not a dev identity), approval fails closed", holds in development for revoked sessions too, or the divergence is flagged.
- **Impact:** safety behavior differs between development and production, so a team testing revocation in development sees the opposite of production.
- **Evidence:** `tests/scenario-6-recovery.test.ts`; CompanyOS's suspension check made the approved orphan fail (`state: failed`, "Agent agent-ledger is suspended").

### F-024 · Deployment env template incomplete — FK-defect, Medium
- **Repro:** `feltkit deploy --target container`; `grep GITHUB_API_URL .feltkit/deploy/.env.example` → nothing. First production call: `NOT_CONFIGURED: github.commit is not configured: github: GITHUB_API_URL is not set in the production environment.`
- The error is clear (good), but the README describes `.env.example` as "exactly the variables it needs".

### F-016 · Sandbox network — Ext, Info
- Node's `fetch` honors `NODE_USE_ENV_PROXY=1` in plain `node` but not under `--import tsx`, which `feltkit dev` and `feltkit test` use, so the development integration to GitHub got 403 from the sandbox egress. Production (bundled, plain Node) reached GitHub. Not a FeltKit defect; it shaped where live GitHub verification ran (CI and production).

### F-028 / F-029 / F-030 / F-031 · Authority shape — FK-gap, Medium
- **F-028:** denials are visible only in Studio → Activity.
- **F-029:** no per-task scopes. CompanyOS enforces assignment scope on its own mutations only; integration operations (`supplierapi.*`, `github.*`) run before any CompanyOS code and are bounded by roles alone. `onOutcome` then refuses to record results outside an assignment, but the call has happened.
- **F-030:** no delegation primitive. AGENT-OPERATIONS §9 says the AuthBoundry adapter is blocked upstream.
- **F-031:** limits and department scope live in CompanyOS.

### F-035 · Approval cannot be conditional — FK-gap, Info
- `approval: "required"` applies to every call of a mutation. "Reverse a commitment above 10,000 needs a second approver" needs separate capabilities or app logic.

## Untested

| Area | Why |
|---|---|
| Fly.io, Vercel, Cloudflare deployments | no credentials in this environment (F-026) |
| Docker / `docker compose` run of the artifact | Docker daemon not available |
| Model decisions (`ctx.agent.start`, `decide`), Intelligence service | CompanyOS agents are deterministic by design; no production model was configured (keys present in the environment were not used) |
| Account e-mail, password reset, sign-in providers | no Mailerport; production sign-up closed (F-025) |
| Webhook delivery to an external receiver | endpoints not registered; events are emitted (after-commit) |
| Schedules (`agents.sweep`) running periodically | handler tested as a mutation; not scheduled |
| Managed FeltDB / FeltDB server, multi-instance | not available |
| Concurrency under load | only the platform's own guarantees (one run per approval, sequence fencing) were exercised |
| Human operators | no human operators took part; the operator evaluation is a scripted harness plus the builder's review (AGENT-OPERATOR-EVALUATION.md) |
| Hosted target on Managed FeltDB | account, app, contract publish and promotion worked; the app did not start (F-041) |
| Multi-instance behavior | needs a shared FeltDB (Managed or server); blocked by F-041 |
