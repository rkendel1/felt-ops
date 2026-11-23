# Phase 0 protocol (pre-registered)

Written and committed **before** any experiment below was run, except where stated. Pass/fail rules
are fixed here. A result that misses them is reported as a miss, not reinterpreted. Changes to this
file after a run must be recorded in [RESULTS](RESULTS.md) as deviations, with the reason.

Phase 0 is disposable validation. Harness code under `phase-0/` is evidence of what ran, not product
code.

## Fixed baseline

| Item | Value |
|---|---|
| FeltKit | `@feltdb/feltkit` **0.3.37 exactly** (published 2026-11-23; owner's instruction) |
| EVE | `@appport/eve` **1.0.2 exactly**. The scaffold's `eve` dependency is aliased to it (`npm:@appport/eve@1.0.2`) because `eve init` scaffolds upstream `eve` (finding P0-F1 in RESULTS) |
| Node | 24.x for EVE (`engines: >=24`); 22.x for FeltKit |
| Model for S1 | `anthropic/claude-sonnet-5.5` (eve-code's own benchmark default), the **same model for both harnesses**. If it is unavailable, S1 doesn't run on a substitute model without the owner's decision |
| Sandbox | Docker (local daemon), EVE default image, network `deny-all` |

## Owner decisions recorded before Phase 0 (2026-11-23)

| Question | Decision |
|---|---|
| U-02 target user | Small engineering teams already using coding agents |
| U-03 work items | Handoff owns **delegation records** (delegation, execution, evidence, review). GitHub stays authoritative for issues, PRs and commits, which are linked external records. Handoff is not an issue tracker |
| U-04 own CLI subscriptions | Validate before committing v1; potential go/no-go |
| U-07 FeltKit version | Establish the exact published contract before implementation; Phase 0 pins 0.3.37 |
| Phase 1 | **Not approved.** Phase 0 only |

---

## S1: EVE coding quality

**Question.** Can a self-hosted EVE coding agent complete representative repository tasks as well
as Claude Code on the same model?

**Fixture.** `phase-0/s1/fixture/`: a zero-dependency Node.js (ESM) library with a visible test
suite (`node --test`). Ten tasks `phase-0/s1/tasks/T01…T10/`, each with:
- `prompt.md`: the exact text given to both harnesses;
- `grader.test.js`: hidden tests, never placed in the agent's workspace;
- `reference.patch`: a reference solution, used only to validate the grader.

Five tasks are bug fixes described as symptoms, and five are small features. Their difficulty is
spread over what a delegator would hand off: a single-function fix, a cross-module change, an edge
case, an API addition, a refactor that must preserve behaviour.

**Validity checks (must hold before any model run; otherwise fix the fixture, not the result):**
1. The visible suite passes on the base fixture.
2. Each grader **fails** on the base fixture.
3. Each grader **passes** on base + `reference.patch`, and the visible suite still passes.

**Harnesses** (same prompt, model and limits; one attempt per task per harness):
- **H-EVE:** `@appport/eve` 1.0.2 with the `eve/extensions/code` extension and a Docker sandbox
  (network deny-all), with the workspace seeded from the fixture. The session is driven over EVE's
  HTTP API until the turn settles.
- **H-CC:** Claude Code headless (`claude -p`, non-interactive) in a Docker container with the
  same fixture copy, the same model through the same gateway, and network limited to the model
  endpoint.
- Limit: 20 minutes per attempt. No human intervention. A stall, crash or timeout counts as a
  failure and is also reported separately as an infrastructure failure.

**Measures per attempt:**

| Measure | Definition |
|---|---|
| **Usable** (primary) | hidden grader passes **and** visible suite passes **and** no pre-existing visible test was deleted or skipped |
| Completed | the agent ended its turn on its own within the limit |
| Wall time | start to settle |
| Tokens | input/output as reported by the harness |
| Tool calls / tool errors | from the event stream (EVE `call.*` events; Claude Code stream-json) |
| Correction loops | number of test-command executions by the agent |
| Interventions | always 0 by protocol; any manual restart is recorded and voids the attempt |
| Diff size | files and lines changed outside the task's stated scope (reported, not scored) |

**Pass/fail rule (fixed):**
- **PASS**: EVE is usable on ≥ 7/10 **and** EVE ≥ (Claude Code usable − 2).
- **FAIL**: EVE usable ≤ 5/10 **or** EVE < (Claude Code usable − 3).
- Anything else is **INCONCLUSIVE**: run two more attempts per task per harness, then apply the
  same thresholds to the per-task majority.

**Decision it drives:** PASS confirms D-02 (EVE as the execution runtime). FAIL makes U-04 (a
vendor CLI inside the sandbox) part of Phase 1 scope, or a no-go.

---

## S2: remote work claiming with FeltKit primitives (no parallel queue)

**Question.** Can an independent runner process claim, renew, lose and hand over work using
FeltKit 0.3.37's invocation lifecycle, without an application-owned queue or lease collection?

**Setup.** A minimal FeltKit app pinned to 0.3.37 (`phase-0/s2/`) with:
- a surface for delegated work;
- application functions that call `ctx.invocations.*` (no app-owned lease, claim or attempt
  fields).

Separate OS processes act as runners over HTTP/AppPort with non-person sessions. A person session
requests the work.

**Criteria (all must hold for PASS):**
- (a) A runner process that is not the requesting person obtains a claim on the person's work.
- (b) It renews the lease with `progress` at least 3 times across the process boundary.
- (c) It is killed with SIGKILL. After lease expiry, a **second runner process** starts the same
  invocation and gets attempt 2, whose `previous` shows attempt 1 as `unknown`.
- (d) The killed runner's identity, reporting late with the old claim, gets `CLAIM_LOST` (simulated
  by replaying its last call).
- (e) The requesting person can read the invocation's state and cancel it. A cancelled invocation
  can't be progressed.
- (f) No application collection stores claim, lease or attempt state.

**Grading:**
- **PASS**: all six hold with the two runners as **distinct principals**.
- **PARTIAL**: all six hold only when both runners share **one** principal (for example one
  "runner pool" identity, distinguished by `worker` id) or only when the runner delivers the work
  itself via a `bridge` surface. Record exactly which constraint applied.
- **FAIL**: claiming requires the requesting person's own token, or any of (a)–(f) can't be met.

**Decision it drives:**
- PASS or PARTIAL decides D-06 for the platform path, with the constraint recorded.
- FAIL keeps the app-owned lease as the interim and strengthens gap E-1.

---

## S3: steering availability in a published, supported API

**Criterion** (already committed in `IMPLEMENTATION-PLAN.md` at `9883b15`, before this check ran):
a published version contains `runtime/agent-control.ts` and its MCP/HTTP surfaces.

**Note:** this check was run before this protocol was written, against published npm tarballs
(see RESULTS). Additional pre-registered check:
- (S3b) FeltKit's own `test/agent-control.test.ts` passes against source matching 0.3.37;
- (S3c) the installed 0.3.37 dist exposes `feltkit_agent_checkpoint` / `feltkit_agent_acknowledge`
  over MCP to an agent session.

**PASS** if all three hold.

---

## S4: GitHub through FeltKit's integration capability

**Question.** Does `app.integration` on 0.3.37 support the GitHub path the product needs?

**Setup.** `phase-0/s4/`: a minimal FeltKit app pinned to 0.3.37 with a `github` integration whose
credential is a custody reference. Live calls go to GitHub **read-only** against `rkendel1/felt-ops`.
Write paths run against a local GitHub-API stub, because no GitHub App credentials exist in this
session and writes to real repositories were not authorized.

**Criteria:**
- (a) Live: read an issue or PR, a branch head and check runs. Each call is recorded with a call
  id, and the response reaches the calling function.
- (b) Stub: "create PR" twice with the same idempotency key makes **one** upstream request.
- (c) Stub: an upstream that accepts the request and then drops the connection leaves the call
  recorded as `unknown`. A retry with the same key does **not** re-send. The declared verify probe
  (`pulls.get`) settles it; or, on 0.3.37, the settlement API records it.
- (d) Inbound webhook: a delivery with a valid HMAC signature is accepted and reaches the handler;
  an invalid signature and a replayed delivery are refused.
- (e) The credential value never appears in recorded calls, activity or errors.

**Grading:**
- **PASS**: all five hold.
- **PARTIAL**: (a), (b) and (e) hold.
- **Untested, recorded as such:** GitHub App installation-token minting (no App credentials), and
  writes against real GitHub.

**Decision it drives:** D-08.
