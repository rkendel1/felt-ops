# FeltKit gap report

What building and operating CompanyOS on FeltKit 0.3.13 showed the platform lacks, in priority
order. Each gap names the findings behind it (`ROAD-TEST-FINDINGS.md`, `AGENT-OPERATOR-EVALUATION.md`).
It also says whether the gap is a **missing primitive**, a **defect**, or something that
should stay **application responsibility**.

## Priority 1: blocks a credible agent-operator product

### G-07 · An application-facing agent control surface (missing primitive)
Findings: F-006, F-007, F-015, F-020, F-043, F-044, F-045, F-046, F-047 (the last five from the operator evaluation: unsigned Studio link, misleading task label, approval without business context, suspension not shared, no liveness).

Applications cannot read agent tasks, actions and checkpoints, and cannot approve, reject,
retry, resolve or cancel them. Only Studio can. FeltKit's underlying model is the strongest
part of the platform: approval by a person only, execution as the owner, one run per
approval, outcomes established from evidence, interrupted actions never replayed. But it is
locked inside Studio, so any business application has two approval inboxes. Direct MCP calls
by an agent are not part of its task, so the task is not a complete account of what the agent
did.

**Ask:**
- `ctx.agent.get/list` in queries, plus typed client hooks.
- An application capability for `approve/reject/approvability/retry/resolve/cancel` with
  AgentHost's existing checks.
- Optional linking of direct tool calls to a task (e.g. a task id on the MCP session or the
  call).
- Per-task read scoping.

### G-01 · Account lifecycle (missing primitive)
Findings: F-010, F-025.

No account disable, no per-account roles, no role change, and no way to link an account to an
application record. An organization cannot remove a leaver's access through the platform.

**Ask:**
- Account enable/disable and role assignment as admin capabilities, which also revoke the
  account's sessions.
- A sign-in hook (or a principal-mapping function) so the application can bind an account to
  its own person record and refuse unknown accounts.

### G-02 · Session control from the application and while production runs (missing primitive)
Findings: F-011, F-023.

Revoking an agent's or person's sessions is a CLI step by session ref. In production it
needs the server stopped, and roles are fixed at issuance.

**Ask:**
- `sessions.revokePrincipal` as a permissioned capability (`sessions.revoke`), usable from
  production Studio and by applications.
- Session issuance for operators without downtime.
- Optionally, roles re-resolved per request from a principal registry.

### G-09 · Durable integration outcomes (defect + missing primitive)
Findings: F-018, F-019, F-021.

A failing `onOutcome` handler is only logged, so the call succeeds while the application never
learns its result. The payload type is undocumented and differs from the exported type.
Context can reach the handler only through the operation's input, which is sent to the
external API.

**Ask:**
- Deliver outcomes through the existing outbox (at least once, with retry and a failed state
  visible in Studio).
- Export `IntegrationOutcome`.
- Accept a `context` field that is passed to `onOutcome` but not to the API.

## Priority 2: needed for production organizations

### G-05 · Approval provenance in the handler (missing primitive)
Finding: F-008.

`ctx.auth.approval = { taskId, actionId, approvedBy }` during an approved execution. The data
already exists in the activity entry.

### G-12 · Dev/prod parity for principal resolution (defect)
Finding: F-022.

In development and test, a revoked dev-declared agent is still resolved as an owner, and its
pending proposals can be approved and run. Production fails closed. Make
`resolvePrincipal({ devUsers: true })` respect revocation (e.g. a revoked marker per dev
identity), or at least report the divergence in `approvability`.

### G-11 · Operations without downtime, complete deploy contracts, a working managed path (defect + gap)
Findings: F-023, F-024, F-004, F-005, F-037–F-042.

The managed path is the most urgent part: `npx feltdb` does not resolve from a FeltKit project, `init-managed --help` runs setup, credentials land outside `.gitignore`, and CompanyOS then failed to start on Managed FeltDB with `INDEX_UNAVAILABLE` (F-041, open).

- Online backup of local production. The development server can already pause calls while it
  reads; production cannot.
- `.env.example` listing every integration's `baseUrl.env`.
- `readiness` that does not fail for features the app does not use, and does not write state.

### G-04 · Per-task capability scopes for agent sessions (missing primitive)
Finding: F-029.

Sessions carry roles. An operator's narrowing of authority for one piece of work has no
platform representation, so CompanyOS enforces it only on its own mutations. Integration
operations are bounded by roles alone.

**Ask:** session- or task-scoped grants (`capabilities: [...]`, expiry), checked by the same
authorizer. This is close to the AuthBoundry delegation work (G-03).

### G-08 · Durable, queryable decision evidence (missing primitive)
Findings: F-009, F-028.

The activity log is bounded and cannot be read by applications, so denials, the clearest
signal of an agent probing its limits, are invisible to the application's operator
workspace. An application-readable, durable decision log (or `ctx.activity.query` filtered to
what the caller may see) would let CompanyOS drop part of its own history.

## Priority 3: important, not blocking

| Gap | Kind | Findings | Note |
|---|---|---|---|
| G-03 Delegation primitive | missing primitive | F-030 | Waits on AuthBoundry (AGENT-OPERATIONS §9). Until then, agents cannot sub-delegate. |
| G-06 Resource-attribute authorization | missing primitive | F-031, F-012 | Limits and scopes are application logic today. An attribute-aware authorizer would remove a second authority layer the app must keep consistent with roles. |
| G-14 Agent usage and cost | missing primitive | F-032 | FeltKit does not meter external agents. Reporting is self-asserted. |
| Conditional approval | missing primitive | F-035 | `approval: (args) => "required" \| undefined`. |
| Dependency pins | packaging | F-001 | Exact pins (`@appport/sdk` 1.4.0) block patch adoption by applications. |

## What should stay application responsibility

- Business authority semantics: approval chains, limits, separation of duties, departure
  transfers. The platform should provide attribute-aware checks (G-06), not finance rules.
- Assignment semantics: objectives, constraints, deadlines and the verifier for a piece of
  work. The platform should carry scopes (G-04) and task linkage (G-07), not business
  outcomes.
- Verification of business outcomes (reconciliation, link health, departure completeness).
  FeltKit verifies that an action ran; only the application can verify that the business is
  right.
- Policies as versioned, effective-dated business configuration. The Configuration service
  stores values, but approvals and effective dating are domain behavior.

## What already works and should not be rebuilt

- Mandatory approval (`approval: "required"`) holds on every interface. A person's approval
  never widens the proposer's authority. Duplicate approval runs nothing. Verified in
  Scenarios 3, 5 and 6, including live processes.
- Restart reconciliation of agent actions from evidence, and refusal of revoked sessions at
  `/mcp` (HTTP 401, live Scenario 6).
- Integration calls recorded and verifiable, with `UPSTREAM_REJECTED` carrying the external
  status (Scenario 4).
- Schema contracts and upgrades: FeltKit 0.3.12 + FeltDB 0.20.0 → 0.3.13 + 0.21.0 on
  production data with no migration and verified data (Scenario 7).
- Backup and restore preserve every business record (production drill, 569 records,
  identical fingerprint).
