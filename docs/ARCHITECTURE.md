# CompanyOS architecture

## 1. System

```
 People (browser)            Agents (separate processes)           External systems
 React app (src/)            agents/runner.ts, coding agents        GitHub API · supplier API
      │ HTTP + live queries        │ MCP /mcp (agent session)              ▲
      ▼                            ▼                                       │ app.integration
 ┌──────────────────────── FeltKit server (one per environment) ─────────────────────────┐
 │ Authentication: sessions, accounts    Authority: roles → permissions, per call      │
 │ CompanyOS functions (feltkit/*.ts) ── AppPort capabilities ── MCP tools             │
 │ AgentHost: tasks · proposals · approval by a person · execution as owner · evidence │
 │ AppPort Services: notifications · webhooks · jobs · schedules · files · config     │
 │ Integrations: supplierapi.*, github.* (recorded calls, onOutcome → CompanyOS)       │
 └────────────────────────────────────┬────────────────────────────────────────────────┘
                                      ▼
                     One FeltDB instance per environment (local state)
      CompanyOS collections · FeltKit sessions/activity · agent state · services · outbox
```

FeltKit Studio (`/_feltkit/`) is the platform console. It approves agent actions, shows
activity (including denials), and configures services.

## 2. Boundaries

| Concern | Owner | Why |
|---|---|---|
| Identity, sessions, per-call permission decisions | FeltKit | Never re-implemented |
| Mandatory approval of consequential agent actions, action states, evidence | FeltKit AgentHost | `approval: "required"` on `commitments.reverse`, `org.depart` |
| Durable state, schema contracts, migrations | FeltDB through FeltKit | One instance per environment |
| Notifications, webhooks, jobs | AppPort Services | Via `ctx.afterCommit` (only if the mutation commits) |
| External HTTP APIs | `app.integration` | Calls recorded; results reach CompanyOS only via `onOutcome` |
| Commits, PRs, CI runs | GitHub (authoritative) | CompanyOS records what it observed, with the call id |
| Deployment artifact, boot verification | `feltkit deploy` | CompanyOS records the receipt as *reported* and verifies the running commit itself |
| Business authority (limits, departments, separation of duties) | CompanyOS `authorities` | No resource-attribute authorization in FeltKit (G-06) |
| Business configuration (policies) | CompanyOS `policies`/`policyVersions` | Versioned, approved, effective-dated; read at run time |
| Work given to agents, their claims, operator interventions, verification | CompanyOS `assignments` + `timeline` | Business semantics FeltKit does not have |

## 3. Domain model (27 collections)

```
departments ─┬─ teams ── people ──< authorities (holder, kind, limit, department; ended, transferredFrom)
             └─ budgets
suppliers ──< purchaseRequests (policyVersionId, steps[]) ── purchaseOrders ──< receipts
         │                                                     └──< invoices ──< commitments
         └── supplierLinks (apiVersion, status, syncedThrough, lastFailure)
policies ──< policyVersions (rules, effectiveFrom, status, verification) ──< policyAcks
customers ──< contracts ──< customerIssues
projects ──< workItems (dependsOn[], changeId)
changes (kind: config | application | platform; status per kind) ──< externalRefs (observedVia)
        └── releases (changeIds[], commit, receipt) ;  incidents (affected[], changeId, verification)
agents (key = FeltKit principal id, roles) ──< assignments (permittedCapabilities, verifier, feltkitTaskId, reassignedFrom/To)
timeline (subject, seq per subject, source: platform | assertion | verification | operator)
```

- `timeline` is CompanyOS's domain history. Each entry is written in the same transaction as
  the change it describes, ordered by a FeltDB sequence per subject, and carries the
  authenticated actor. `source` separates agent statements from recorded facts and from
  verification.
- `externalRefs.observedVia` is either `integration:<call id>` (CompanyOS observed it through
  an integration), `computed` (CompanyOS computed it from its records) or `reported`
  (someone's statement). Lifecycle gates that need external facts (CI passed, commit exists)
  accept only observed evidence.

## 4. Authority model

Three layers, applied in order on every call:

1. **FeltKit permission** (roles in `feltkit/app.ts`), checked before arguments are validated.
   People hold `staff` plus functional roles. Agents hold only `agent-*` roles, which never
   include an approval permission.
2. **CompanyOS actor check** (`feltkit/_lib.ts actor()`). The caller must be an active employee
   or an active registered agent. This is a workaround for G-01/G-02: the platform cannot
   disable accounts, and applications cannot revoke sessions.
3. **Business rules** in the function:
   - **Business authority** (`grantFor()`): a covering grant (kind, limit, department).
     Separation of duties: no approving your own request, and one step per person per
     request.
   - **Assignment scope for agents** (`_scope.ts withinAssignment()`): the agent must have an
     active assignment that permits the capability. An assignment can narrow the agent's
     authority, never widen it; the assign form refuses capabilities its roles do not grant.

Agents' consequential actions go through FeltKit's proposal lifecycle. The agent proposes; a
person who may perform the action approves in Studio; FeltKit runs it as the agent. All three
layers apply again at execution, so approving a forbidden action yields a failed action and
no change (Scenario 3, third proposal).

## 5. Agent operations

| | FeltKit | CompanyOS |
|---|---|---|
| Identity | session principal `type: agent`, roles | `agents` registry: purpose, runtime, provider, model, owner, status |
| Work | task (objective, owner) | assignment: objective, context, constraints, deadline, permitted capabilities, verifier |
| Actions | proposals → approval → execution → outcome (from evidence) | n/a (read live through `/mcp`) |
| Statements | notes, completion summary | `assignments.report` → `timeline` with `source: assertion` |
| Verification | evidence that an action ran (checkpoint, verified at commit) | evidence that the business objective holds (`verify` computes from records) |
| Intervention | approve / reject / retry / resolve / cancel (Studio) | suspend / resume / context / cancel / escalate / reassign (CompanyOS) |

Agents are separate processes (`agents/runner.ts`), deterministic playbooks that use only MCP.
No model makes decisions in CompanyOS 0.1; that choice is deliberate.

## 6. Integrations

- **`supplierapi`**: `invoicesv1` and `invoicesv2` observations. `onSupplierCall` records link
  health and imports rows (idempotent by delivery id; cross-channel duplicates are held as
  exceptions). It refuses to import while the link is isolated or from a non-active API
  version, and records such calls as validation instead.
- **`github`**: `commit`, `runs`, `pulls`. `onGithubCall` stores what GitHub answered as
  `externalRefs` on the subject.
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) runs doctor, typecheck, tests, build, live
  Scenario 6 and Scenario 7 on every push.

## 7. Change paths

| Kind | Path | Mechanism |
|---|---|---|
| config | propose → impact → approve (grant holder, not the author) → effective → verify | data (`policyVersions`); no deployment |
| application | request → assess → specify → develop → in-review (commit observed) → ci-passed (Actions success observed) → release approved → deployed → business acceptance | code, GitHub, `feltkit deploy` |
| platform | discovered → assessed → tested → approved → deployed → verified (data fingerprint computed) | dependency upgrade; released alone (a release never mixes kinds) |

## 8. Deployment topology

| Environment | Runs | State |
|---|---|---|
| development | `feltkit dev` (Vite + Studio + hot reload) | `.feltkit/development/state` |
| test | `createTestApp` per test; scenarios on local state dirs | temporary |
| CI | GitHub Actions, Node 22 | temporary |
| production (verified here) | `feltkit deploy --target container` artifact, run with Node (`npm start`) | `.feltkit/deploy/.feltkit/production/state` on local disk |
| Fly / Vercel / Docker | artifact files generated (`fly.toml`, `Dockerfile`) | **untested** (no credentials, no Docker daemon) |

Production settings: `GITHUB_API_URL`, `SUPPLIER_API_URL` (integrations; not listed by
FeltKit's `.env.example`, F-024), `COMPANYOS_COMMIT` (lets CompanyOS verify which release
runs), `PORT`.
