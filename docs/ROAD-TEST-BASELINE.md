# Road-test baseline

Recorded 2026-11-03, before any CompanyOS code was written. The baseline commit is
`abf3f95` ("Baseline: unmodified create-feltkit@0.3.13 scaffold"). Everything after it is
CompanyOS. All observations below are from commands run in this repository; nothing is
taken from earlier conversations.

## 1. Repository

- `rkendel1/felt-ops` was **empty** (no commits, no default branch). Work is on
  `claude/keen-cannon-gxv0v3`.
- Public repository (GitHub API answers anonymously). No branch protection, no CI existed.

## 2. How the project was created

```bash
npm create feltkit@latest my-app   # create-feltkit 0.3.13
cd my-app && npm install && npm run dev
```

The scaffold was copied to the repository root and `package.json` `name` changed to
`companyos`. The FeltKit app name (`feltkit/app.ts` → `name`) remained `my-app` in the
baseline; it is the FeltDB namespace, so it was renamed to `companyos` before any state existed.

## 3. Dependency baseline (`npm ls --depth=1`)

| Package | Installed | Latest on npm (2026-11-03) | Note |
|---|---|---|---|
| `@feltdb/feltkit` | 0.3.13 | 0.3.13 | The only FeltKit dependency the scaffold declares |
| `@feltdb/core` | 0.21.0 (via feltkit, exact) | 0.21.0 | `doctor`: one copy, shared by FeltKit and AppPort Services |
| `@appport/sdk` | 1.4.0 (via feltkit, exact) | **1.4.1** | FeltKit pins 1.4.0 exactly; the app cannot take 1.4.1 without a FeltKit release |
| `@appport/services` | 0.14.0 (via feltkit, exact) | 0.14.0 | |
| `@appport/server` / `protocol` / `authorization` / `integration` | 1.1.5 / 1.3.0 / 1.0.7 / 1.2.2 | | transitive, exact pins |
| react / react-dom | 19.2.0 | | |
| vite / typescript | 7.3.7 / 5.9.3 | | |
| Node / npm | 22.23.4 / 10.9.9 | | |

The spec lists `@feltdb/core`, `@appport/sdk` and `@appport/services` as stack components.
The published product does not ask an application to depend on them directly: they arrive
pinned through `@feltdb/feltkit`. CompanyOS uses them only through FeltKit and does not add
direct dependencies on them (that would create a second copy, which `doctor` checks for).

## 4. Baseline commands (unmodified scaffold)

| Command | Result | Time |
|---|---|---|
| `npm test` | 8/8 pass | 3.4 s |
| `npm run typecheck` | pass | 2.5 s |
| `npm run build` | pass: 14 functions, 5 capabilities, schema `sha256:ac4d147c5741…` | 2.2 s |
| `npx feltkit doctor` | all checks pass | |
| `npx feltkit readiness --env production` | **1 failure**: no decision model selected; 6 operational requirements outside FeltKit (TLS, rate limiting, backups, monitoring, secret provisioning, Studio network access) | |

Observations:
- `readiness` fails production for a missing *decision model* even though the starter
  only needs one for `ctx.agent.start` / `decide` tasks. See finding F-004.
- `readiness` is described as a check but created `.feltkit/production/state` on disk
  (F-005).

## 5. Platform primitives available (verified by reading types and running probes)

| Primitive | Where | Verified how |
|---|---|---|
| Collections with schemas, unique constraints, indexes | `app.collection` | types + tests |
| Atomic mutations; `ctx.db.sequence` for ordered append-only streams | `MutationCtx` | docs/TRANSACTIONS.md |
| Data migrations in the same transaction as schema install | `app.migration` | types |
| Roles → permissions, checked per call before input validation | `feltkit({ roles })` | starter tests |
| AppPort capabilities from functions; `/appport`, `/mcp` | `capability:` | build output |
| **Mandatory approval** for agents/services/API keys | `approval: "required"` | probe: agent direct call → `FORBIDDEN` with an explanatory message |
| Agent tasks, proposals, approval by a person, execution as owner, checkpoints with FeltDB-verified evidence, retry, resolve, reconcile, cancel, handoffs | `runtime.agent` (`AgentHost`) | probe: viewer approval refused (`feltkit.agent.write`); member approval ran the action **as `agent:bot`**, `determinedBy: dispatch`; duplicate approval ran nothing |
| HTTP integrations as capabilities with idempotency header, `verify`, `onOutcome` | `app.integration` | types |
| After-commit effects (notifications, webhooks, jobs) | `ctx.afterCommit` | starter tests |
| Services: files, notifications, configuration, API keys, webhooks, jobs, schedules, intelligence | `services:` | starter tests, readiness |
| Activity log (every call, decision id, writes) | `runtime.activity` | starter test |
| Sessions: issue, list, revoke by ref, `revokePrincipal` (store API) | `runtime.sessions`, `feltkit session` | probe |
| Built-in accounts (email + password) | `auth.accounts` | types |
| Deploy artifacts: container, hosted, self-hosted, vercel, cloudflare, fly | `feltkit deploy` | README, `dist/cli/fly.js` exists |
| Production Studio with operator grants | `feltkit operator grant` | source read (`server/admin.js`) |
| Model decisions among app-supplied options | `ctx.agent.start`, `playbook: decide` | types (not exercised in baseline) |

## 6. Known limitations established at baseline (before building)

Each becomes a finding in `ROAD-TEST-FINDINGS.md`.

1. **Agent state is not readable by application code.** `ctx.db.find("_feltdb.AgentTask")`
   → `NOT_FOUND: not declared by this application` (probe). An application can read agent
   tasks only as a client of `/mcp` (`feltkit_agent_tasks`, `feltkit_agent_get`).
2. **Approving an agent action is only possible in FeltKit Studio.** `AgentHost.approve`
   is reached by Studio's development admin API (admin token + "act as") and production
   Studio (operator grant → cookie + CSRF). There is no approve tool on MCP (by design) and
   no application-facing API, so an application cannot host its own approval inbox for
   agent actions.
3. **Approval provenance is not visible to the executing handler.** The activity entry
   carries `authority.approval` (task, action, approver), but `ctx` does not, so a mutation
   cannot record who approved it in domain data.
4. **Activity log is bounded** (default 2,000 entries) and is not a durable audit trail.
5. **Built-in accounts cannot be disabled and their roles cannot be changed.** `AccountStore`
   has sign-up, sign-in, verify, set-password, provider sign-in and get; every new account
   receives the same `auth.accounts.roles`. Per-person roles in production need
   `auth.authenticate` (own IdP) or CLI-issued sessions.
6. **Application code cannot revoke sessions.** `runtime.sessions.revokePrincipal` exists but
   is not on `ctx`; the app CLI revokes by session ref only.
7. **Session roles are fixed at issuance** (documented in AGENT-OPERATIONS §1).
8. **Agent task visibility is all-or-nothing**: any principal with `feltkit.agent.read` lists
   and reads every task.
9. **No resource-attribute authorization.** Roles grant permissions on capabilities; limits
   such as "approve purchases up to $25,000 for Finance" are application logic.
10. **Platform PRs 4–6 are not implemented** (AuthBoundry delegations, Resolver references,
    the invoice acceptance scenario), per `docs/AGENT-OPERATIONS.md` §9.
11. `feltkit deploy` targets for Vercel/Cloudflare/Fly need credentials.

## 7. Deployment capabilities in this environment

| Target | Available here | Reason |
|---|---|---|
| Local production (`feltkit deploy --target container`, `feltkit start`) | yes | Node 22, disk |
| Docker | binary present | daemon availability checked in Phase 6 |
| Fly.io | **no** | no `flyctl`, no `FLY_API_TOKEN` |
| Vercel | **no** | no `vercel` CLI or token |
| GitHub Actions | yes | push to the branch; repository is public |
| GitHub API | yes (read, anonymous) | public repository |

## 8. Not tested at baseline

Model decisions (no production model), account e-mail (no Mailerport), sign-in providers,
Managed FeltDB, AppBoundry artifacts, multi-instance FeltDB server, webhooks to external
receivers.
