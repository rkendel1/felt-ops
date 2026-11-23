# Phase 0 results

Against the pre-registered [PROTOCOL](PROTOCOL.md) (committed `a26468f` before S1, S2 and S4 ran).
Run on 2026-11-23 in this session's container: Docker 29.10 local daemon, Node 22/24,
`@feltdb/feltkit` **0.3.37** exact, `@appport/eve` **1.0.2** exact.

| Experiment | Verdict | One line |
|---|---|---|
| S1 EVE coding quality | **NOT RUN: blocked** | Fixture, 10 tasks, hidden graders and the EVE harness are ready and validated. Neither key in this session can call the pre-registered model (details below) |
| S2 remote claiming | **PARTIAL** | Full lease, fencing and re-claim lifecycle works across processes, but only when every runner shares **one** principal that delivers the work itself |
| S3 steering availability | **PASS** | Agent control is published in 0.3.36 and 0.3.37; 13/13 FeltKit tests pass; it works live over MCP and HTTP on 0.3.37 |
| S4 GitHub via integrations | **PARTIAL** | Reads, idempotent writes and unknown-outcome handling all hold. **GitHub's own webhooks can't be received**: inbound webhooks accept only AppPort-signed deliveries |

---

## S1: EVE coding quality: not run

**Blocker (fact):**
- **AI Gateway key:** free tier. Every Anthropic model, including the pre-registered
  `anthropic/claude-sonnet-5.5`, is refused with 403 `no_providers_available` ("Free tier users do
  not have access to this model"). Some OpenAI models answer.
- **Anthropic key** (`BENCH_API_KEY`, per the owner): `api.anthropic.com` answers 401
  `authentication_error: invalid x-api-key`. A further check of the key's form was blocked by this
  session's permission classifier, and I didn't pursue it.
- The protocol forbids substituting a model without the owner's decision, so no scored run was made.

**Ready to run:**

| Asset | State |
|---|---|
| `s1/fixture/` (ledgerlite, 9 modules, zero dependencies) | visible suite 10/10 on base |
| `s1/tasks/T01–T10` (prompt, hidden grader, reference patch) | **validity checks pass for all 10**: each grader fails on base and passes on its reference; the visible suite passes on both |
| `s1/grade.mjs` | implements the protocol's *usable* definition |
| `s1/harness/run-eve.mjs` + `eve-template/` | EVE 1.0.2, `eve/extensions/code`, Docker sandbox with network deny-all, driven over EVE's HTTP API; copies `/workspace` out of the container and grades it. See "Harness dry run" below |
| H-CC (Claude Code headless) | not built. It needs a model endpoint Claude Code can use (an Anthropic model) |

**Findings made while preparing S1 (facts):**
- **P0-F1:** `@appport/eve` 1.0.2's `eve init` scaffolds a project depending on upstream **`eve`**
  (resolved to 1.3.0 on npm), not on the fork. Using the fork needs an alias
  (`"eve": "npm:@appport/eve@1.0.2"`). An adopted runtime whose scaffold silently installs a
  different distribution is a supply-chain and reproducibility risk.
- **P0-F2:** self-hosted EVE built the Docker sandbox template, started the sandbox container and
  issued the model request with no Vercel services. The run stopped only at the gateway's 403.
- **P0-F3:** EVE's `engines` require Node ≥ 24 (`eve init` writes `26.x`). FeltKit runs on Node 22.
  A runner host needs a separate Node from the FeltKit app.

**Harness dry run (unscored; plumbing only).** Two runs of task T05 used the free-tier
`openai/gpt-5.1-codex-mini`, which is not the pre-registered model, so **not S1 evidence**:
- **Run 1** exposed a harness defect. EVE's stream ends every ~60 s (`stream.lease-ended`), and
  the harness graded mid-turn. It now reconnects from its cursor until `turn.settled`.
- **Run 2:**
  - 222 s, 12 tool calls, 0 tool errors, 1 test run, 66k input / 3.9k output tokens.
  - The workspace copied out of the container grades **usable** (hidden grader and visible suite
    pass).
  - EVE settled the turn as `failed`: `MODEL_CALL_FAILED` from the gateway's free-tier limit of
    **5 requests/minute**, after 3 attempts. The harness now classifies that as an infrastructure
    failure.

Shown working with no Vercel services:
- the self-hosted EVE path: build, Docker sandbox, deny-all network, the coding extension's file
  and bash tools;
- event capture and grading.

The free key's rate limit alone would invalidate scored runs.

**Decision required:** see "What I need from you" at the end.

---

## S2: remote claiming with FeltKit primitives: PARTIAL

Code: `s2/` (no application collection holds claim, lease or attempt state). Evidence:
`s2/evidence.json` (claim tokens redacted).

| Flow | What happened |
|---|---|
| A. Person submits from their own session (`delivery: "session"`); a runner principal tries to claim | `NOT_FOUND`: invisible to any other principal |
| B. Runner A delivers via the `bridge` surface for the person; after A is killed, **runner B (a different principal)** claims | `NOT_FOUND` |
| C. One shared `runner-pool` principal delivers via the bridge; two OS processes with distinct `worker` ids | all of (a)–(f) hold, below |
| C2. Person cancels running work | `cancelled`; progress afterwards refused; the runner can't cancel |

Flow C against the criteria:

| Criterion | Result |
|---|---|
| (a) non-person claims | ✓ `proceed: true` |
| (b) 3 renewals across processes | ✓ `leaseUntil` advanced on each `progress` |
| (c) SIGKILL, then a second process after expiry | ✓ an immediate re-claim was refused ("another worker holds a live claim"); after expiry: attempt 2, `previous: [{ att_…_1, outcome: "unknown" }]` |
| (d) stale claim | ✓ refused: `FAILED_PRECONDITION` "does not hold the invocation's current claim; nothing was recorded" (docs name it `CLAIM_LOST`; surfaced over MCP as `FAILED_PRECONDITION`) |
| (e) person reads and cancels | ✓ the person sees both attempts (`unknown` by w-pool-1, `succeeded` by w-pool-2) |
| (f) no app-owned lease state | ✓ the app has no collections |

**Why PARTIAL, not PASS (pre-registered rule):** it works only when all runners share one principal
that delivers the work itself. Consequences for the product:
- Handoff must keep its own "queued delegation" record that the runner pool reads and then
  delivers. That is a work record, not lease state.
- Revoking a runner revokes the whole pool. Per-runner identity is only the asserted `worker` id.
- The request isn't "accepted" in FeltKit until a runner picks it up.

**Decision (D-06, updated):** use FeltKit invocations for lease, attempts and fencing, with one
`runner-pool` principal per workspace, and no app-owned lease. Gap **E-1 is narrowed** to:
- per-runner principals able to claim work placed on an environment;
- acceptance by the requesting person, with execution by a separate principal.

---

## S3: steering availability: PASS

| Check | Result |
|---|---|
| S3a published API | `@feltdb/feltkit` **0.3.36** (published 2026-11-19 20:46 UTC) and **0.3.37** (2026-11-23 13:32 UTC) contain `runtime/agent-control.js` and its MCP tools; 0.3.34 and 0.3.35 don't. **FeltKit's CHANGELOG still calls agent control "Unreleased"**, and the discovery repeated that error |
| S3b FeltKit's tests | `test/agent-control.test.ts` at source 0.3.37 (`6fd1010`): **13/13 pass** |
| S3c live on published 0.3.37 | Agent over MCP: `feltkit_agent_checkpoint` / `feltkit_agent_acknowledge` listed. Person over HTTP with their own session: signal, submit (*received*), pause, resume, read state. The gates are enforced: `propose` refused while an update is pending (`CONFLICT`), `complete` refused while an update is open, `checkpoint` returns `proceed: false` while paused. Instruction history: received → delivered (agent) → incorporated (agent) with the note. Evidence: `s3/evidence.json` |

Harness note: the final `complete` in the run was refused because the driver sent `signal` without
filling it with `submit`, leaving a second open update. That is correct enforcement, not a defect.

**Decision (D-07, updated):** steering uses FeltKit agent control on a published version; no
interim `instructions` collection. Reminder from the docs: FeltKit has no agent loop runner, so the
EVE runner adapter must call `checkpoint` at turn boundaries and enforce pause itself.

---

## S4: GitHub via `app.integration`: PARTIAL

Code: `s4/` (live read-only GitHub, a local stub for writes). Evidence: `s4/evidence.json`.

| Criterion | Result |
|---|---|
| (a) live reads | ✓ PR `rkendel1/felt-ops#1` (closed, merged, head `7cc0f6d`), issue, branch head, check runs (2 × `verify` = success), each recorded with a request id |
| (b) idempotent create | ✓ two calls with one key → **one** upstream POST, carrying `Idempotency-Key` and the credential |
| (c) unknown outcome | ✓ dropped connection → `OUTCOME_UNKNOWN`, call recorded `unknown`. The retry with the same key was **not re-sent** (`CONFLICT` / `IDEMPOTENCY_OUTCOME_UNKNOWN`). The declared verify probe settled it as `succeeded`, `determinedBy: "verification"`. A later retry is still refused (documented: never re-sent) |
| (d) inbound webhook | ✗ for GitHub. A **GitHub-format** delivery (`X-Hub-Signature-256`, `X-GitHub-Delivery`) is refused with `400 INVALID_REQUEST` ("requires event id, timestamp, signature"). AppPort-format deliveries work fully: 202 accepted and the handler ran once, replay 409, bad signature 401 |
| (e) no credential in records | ✓ GitHub token, stub credential and webhook secret are absent from call records, activity and evidence |

**Why PARTIAL:**
- AppPort Services verifies only its own scheme (`x-appport-event-id`, `x-appport-timestamp`,
  HMAC over `timestamp.body`).
- GitHub can't be configured to send that, so a FeltKit app can't receive GitHub webhooks
  without an intermediary.

**Decision (D-08, updated):**
- v1 observes GitHub by **polling** through recorded integration reads: on submit, on a schedule
  while in review, and on review open. This is proven by (a)–(c).
- GitHub-signed inbound webhooks become platform gap candidate **E-4** (provider signature
  schemes for inbound webhooks), to be justified only if polling proves inadequate.
- Untested: GitHub App installation-token minting (no App credentials in this session) and real
  GitHub writes (not authorized).

**Environment notes (not FeltKit defects):**
- In this container, Node's `fetch` bypasses the egress proxy that injects GitHub credentials, so
  live calls failed with 401 until the server ran with `NODE_USE_ENV_PROXY=1`.
- Configuration lessons, all of which the loader or runtime explained:
  - AppPort capability names must be lowercase (`github.pullget`).
  - A verify probe's `expect` paths must exist in the probe's declared output schema.
  - Inbound `roles` names roles, not permissions.

---

## Deviations from the protocol

1. **S3a was checked before the protocol was written.** Its criterion was committed earlier, in
   `IMPLEMENTATION-PLAN.md` at `9883b15`.
2. **S2 (d) refusal code.** The criterion names `CLAIM_LOST`; the observed code is
   `FAILED_PRECONDITION` with the same meaning ("does not hold the current claim; nothing was
   recorded"). Counted as met.
3. **S4 harness fixes:**
   - Proxy environment variable.
   - The admin token read from a binary log.
   - The timestamp format: `Date.parse` needs ISO, and I had sent epoch seconds.
   - Inbound role naming.

   These were harness errors on my side. Each was fixed and the experiment re-run from fresh
   state. Only the final run is reported.

## What I need from you

1. **S1 model access.** Either:
   - add AI Gateway credits (the key is free tier); or
   - provide a working Anthropic API key, since `BENCH_API_KEY` returns 401 at `api.anthropic.com`.

   Alternatively, explicitly approve a substitute: for example a free-tier OpenAI model for both
   harnesses. A substitute would measure a weaker model than the product would use, so I don't
   recommend it as the go/no-go evidence.
2. **D-06 constraint.** Accept for now a single runner-pool principal per workspace (S2 PARTIAL),
   or treat per-runner identity as required before Phase 1.
