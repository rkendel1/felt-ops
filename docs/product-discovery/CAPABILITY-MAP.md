# Capability map: Multica → native FeltKit application

Classes: **A** provided by FeltKit · **B** provided by a platform service or integration
(AppPort Services, EVE, an `app.integration`) · **C** existing felt-ops capability or pattern ·
**D** application-specific · **E** genuine platform gap · **F** not carried forward.

Evidence: `MA` = [MULTICA-AUDIT](MULTICA-AUDIT.md), `FB` = [FELTKIT-BASELINE](FELTKIT-BASELINE.md),
`ev/X` = [`evidence/X-*.md`](evidence/). Confidence: **H** = verified in code and tests ·
**M** = verified in code, untested for this use · **L** = inferred or depends on unreleased work.
"Extra code" is application code, in non-blank lines (estimate, see [ESTIMATE](ESTIMATE.md)).

## 1. Tenancy, identity, authority

| Multica feature | User value | Multica | Platform support | felt-ops | Class | Approach · extra code | Evidence | Conf. | Risk |
|---|---|---|---|---|---|---|---|---|---|
| Workspaces | Team boundary | Verified | `auth.tenant`, memberships, invitations (R) | — | **A** | Declare tenant; every collection carries `tenant` · ~20 | ev/F §2 | H | GAP-13: a collection without `tenant` is shared. Add a test asserting every collection has `tenant` |
| Roles owner/admin/member | Who may administer | Verified | roles → permissions; per-tenant roles (R) | roles table pattern | **A** | Three people roles + `agent`/`runner` roles · ~40 | ev/F §2 | H | — |
| Guests, share links | External collaborators | Verified / risky | — | — | **F** (v1) | Not built; revisit on demand | MA 2.1 | — | — |
| Private projects | Confidential work | Verified | `app.policy` (R) | — | **F** (v1) | Not built; `app.policy` can add repo-level visibility later | ev/F §2 | M | — |
| Email/Google login, sessions | Sign-in | Verified (stateless JWT) | accounts, sessions, GitHub/Google sign-in (R) | — | **A** | Configure providers · ~10 | ev/F §2 | H | Default broker issuer is not a running service (configure an own OAuth client) |
| PATs for CLI | Scripted access | Verified (unscoped) | AppPort API keys service; sessions (R) | apiKeys config | **A** | Use the platform; no custom tokens | ev/F §6 | H | — |
| Account disable on member removal | Leaver loses access | Partial (10-min cache) | per-tenant member removal (R); account disable internal only (G-01 P) | `actor()` workaround | **A** + small **D** | Removing a tenant membership ends workspace access; no global disable needed in v1 · ~15 | ev/F §2, §15 | M | Verify that membership removal revokes live tenant sessions (Phase 1 test) |

## 2. Work model

| Multica feature | User value | Multica | Platform support | felt-ops | Class | Approach · extra code | Evidence | Conf. | Risk |
|---|---|---|---|---|---|---|---|---|---|
| Issues (full tracker) | Capture work | Verified, very broad | collections, search, live queries (R) | `workItems` | **D** (narrow) | A `work` collection: objective, acceptance criteria, repo, state, requester, assignee agent. No custom statuses, properties or views · ~250 | MA 2.2 | H | Teams may still want their tracker; mitigated by later GitHub-issue intake |
| Custom status catalog, workflows | Fit process | Verified, overlapping | — | — | **F** | Fixed product states (ARCHITECTURE §3) | MA 2.2 | — | — |
| Labels, properties, sub-issues, duplicates, reactions, Gantt | Organization | Verified | — | — | **F** (v1) | Sub-work later if needed for decomposition | MA 2.2 | — | — |
| Trigger rule (`WillEnqueueRun`) | Work starts only when it should | Verified, **lossy** enqueue | Mutation + outbox in one transaction (R) | — | **D** | `work.assign` decides and inserts the run in the same mutation; no after-commit enqueue · ~60 | MA 2.2; ev/A §6 | H | — |
| Comments, threads | Discussion | Verified | — | timeline | **D** (narrow) | Notes on work; instructions on runs; no threads in v1 · ~60 | — | H | — |
| Activity timeline | Understand history | Verified, lossy bus | `app.auditTrail`, `ctx.db.sequence` (R) | `timeline` + `source` | **A + C** | Audit trail per work, written in the same transaction; `source` field from felt-ops · ~40 | ev/F §1; felt-ops ARCHITECTURE §3 | H | — |
| Search | Find work | Two systems | `ctx.db.search` (R) | — | **A** | Use as is · ~10 | ev/F §1 | H | Bounded scan, no ranking; fine at team scale |
| Attachments | Context | Verified | files service (R) | files | **B** | Attach files to work · ~30 | ev/F §6 | H | Bytes in FeltDB; keep small |
| Docs / collab editor | Shared docs | Off by default | — | — | **F** | — | MA 2.2 | — | — |

## 3. Agents, runners, execution

| Multica feature | User value | Multica | Platform support | felt-ops | Class | Approach · extra code | Evidence | Conf. | Risk |
|---|---|---|---|---|---|---|---|---|---|
| Agent identity | A named teammate | Verified | agent principals, sessions, revocation (R) | `agents` registry | **A + C** | `agents` collection: definition ref (repo@commit), model ref, permitted repos, owner, status; identity = FeltKit agent principal · ~150 | ev/F §3; felt-ops `agents.ts` | H | Registry roles can drift from session roles (felt-ops E-08): derive, don't copy |
| Agent instructions, skills, MCP config | Tailor behaviour | Verified (DB-stored skills, 6k lines) | EVE: `instructions.md`, `skills/`, `tools/` in a git directory | — | **B** | The agent definition lives in git as an EVE agent; the app stores only the reference · ~0 app | ev/G §6 | M | Admins edit agents in git, not a form; acceptable for engineering teams (U-05) |
| Agent builder (system agent) | Easy setup | Verified | — | — | **F** | A template agent definition instead | ev/B | — | — |
| Runtime / machine registration, heartbeat | Know where agents can run | Verified (daemon) | agent/service sessions (R); **no remote worker protocol (M)** | — | **D** (+ **E-1**) | `runners` collection; the runner signs in with its own session and heartbeats via `runners.heartbeat` · ~120 | ev/F "Remote execution plane" | M | — |
| Claim / lease / fencing / re-claim *(Phase 0 S2: FeltKit invocations with one runner-pool principal; see DECISIONS D-06′)* | Work runs once; crashes recover | Verified (row locks, 3h machine grace) | invocations: claim, CAS, `CLAIM_LOST`, attempts (R, in-process); visibility blocks a separate worker principal | runner pattern | **E-1**, interim **D** | Interim: app-owned lease on `runs` (claim token, `leaseUntil`, attempt counter, CAS via `__version`), mirroring `feltkit.execution/1` semantics so it can be replaced · ~200. Phase 0 spike decides whether a bridge-surface invocation can carry it instead | ev/F (a)–(c) | M | Building a second lifecycle that drifts from the platform's. Keep it minimal and named as a workaround (DECISIONS D-06) |
| Daemon launching vendor CLIs (32 providers) | Use existing tools and subscriptions | Verified, 104k lines | EVE runtime (own loop; any AI-SDK model) | — | **B**; vendor CLIs **F** (v1) | Run EVE agents in a runner; models via keys/Resolver refs · ~0 app | ev/B, ev/G §4 | M | EVE coding quality vs Claude Code (highest-risk assumption, Phase 0) |
| Execution environment, working dirs, worktrees, repo cache | Isolated workspace per task | Verified (no sandbox) | EVE sandbox (Docker verified self-hosted) | — | **B** | One sandbox per run attempt; fresh clone of the repo at the base commit | ev/G §3 | M | Docker networking is allow-all/deny-all; secrets enter the sandbox |
| Runner ↔ app work contract | Hand work over, get progress back | — | EVE `examples/appport-agent` (example only, push model, writes to its own store) | `agents/runner.ts` (MCP playbook) | **D** (runner adapter) + ecosystem gap **E-3** | An EVE channel/extension in the runner: pull-claims runs, streams events, takes instructions at turn boundaries, submits results, all via app capabilities over AppPort · ~700–1,200 | ev/G §7 | L | Reusable across apps: should become a published EVE/AppPort package (E-3) |
| Credentials to the machine | Agent can push, call models | Machine's own helpers, inherited env | credential custody (R); Resolver for models (R) | — | **A + D** | App mints a short-lived GitHub App installation token scoped to one repo per claim; model keys stay runner-side by reference. The app never stores or returns a person's credentials · ~80 | ev/F §7 | M | The token reaches the sandbox; scope (repo, `contents:write`, branch rules) and expiry limit the blast radius |
| Runtime sharing across members | Use a teammate's machine | Verified (RCE by design) | — | — | **F** | Runners are workspace resources, not people's machines | MA 2.3 | — | — |
| Cloud runtime proxy, Qoder bridge | Hosted execution | Config | — | — | **F** | — | MA 2.3 | — | — |

## 4. Run lifecycle and human control

| Multica feature | User value | Multica | Platform support | felt-ops | Class | Approach · extra code | Evidence | Conf. | Risk |
|---|---|---|---|---|---|---|---|---|---|
| Task states | Understand where work is | Verified (8 states, ~38 writers) | FeltDB transactions (R) | assignment states | **D** | Explicit state machine in one module; each transition is one function with preconditions (ARCHITECTURE §3) · ~300 | ev/C | H | — |
| Transcript / tool calls | See what the agent did | Verified (UI); progress not stored | live queries (R); EVE event stream | timeline | **D + B** | `runEvents` collection: bounded, typed events (turn, tool call, command, file change, test) written by the runner; live by query · ~150 backend | ev/G §5 | M | Volume: batch writes; cap per run (DECISIONS D-09) |
| Steering by reply | Redirect without restarting | Verified, 6 providers | FeltKit agent control (**published 0.3.36+**, Phase 0 S3); EVE `turnPolicy: steer` (verified) | — | **B** (FeltKit agent control) once published; interim **D** | Use FeltKit's instruction lifecycle on the run's agent task; the runner's checkpoint delivers it to the EVE session. If not published by Phase 1: a minimal `instructions` collection with received/delivered/acknowledged · ~0–150 | ev/F §3; FeltKit `docs/AGENT-CONTROL.md` | L | Release timing (DECISIONS D-07) |
| Pause / interrupt | Hold work | Missing | FeltKit agent control (U); EVE has no operator pause | — | **B** | From agent control; the runner stops starting new turns while paused | ev/G §2 | L | EVE has no pause: the runner must enforce it between turns |
| Cancel | Stop work | Verified; reassign/close don't cancel | invocation/agent-task cancel (R) | `intervene` | **D** | `runs.stop` by a person; reassign/close stop the active run in the same transaction; the runner sees it at its next call (`CANCELLED`) and ends the EVE session · ~60 | ev/C | H | Cooperative, not preemptive: bounded by the runner's poll interval |
| Rerun / retry | Try again | Verified | invocation attempts (R) | reassign chain | **D** | New run (person) or new attempt (stalled lease), with `previous` context · ~80 | ev/C | H | — |
| Failure classification | Know why it failed | Verified (~28 codes + compat maps) | typed errors | — | **D** | Small closed set: `runner_lost`, `sandbox_failed`, `model_error`, `budget_exceeded`, `agent_gave_up`, `cancelled`, `push_rejected` · ~40 | ev/C | H | — |
| Blockers / needs input | Agent asks for help | Missing (status only) | — | `waiting-intervention` | **D** | `questions` collection; run state `needs-input`; answer = instruction · ~100 | MA 2.4 | H | — |
| Approval gates | Humans control consequential effects | **Missing** ("confirm" → allow) | `approval: "required"` with person-only approval (R); agent-owned approvals only in Studio (**E-2**) | uses Studio | **A** (where people act) / **E-2** (agent-proposed) | v1 design: consequential effects (open PR, merge) are application functions run **by people** or by the app, so no agent approval is needed. Agent-proposed consequential actions wait for E-2 | ev/F §3 | H | Scope creep toward agent-initiated effects before E-2 |
| Usage / cost | Know what it costs | Verified, browser-computed | **M** (G-14) | agent-reported usage | **D** | Runner reports tokens per turn from EVE (`source: runner-reported`); server-side cost from a versioned price table, never the browser · ~80 (Phase 2) | ev/C; ev/G §5 | M | Not metered by the platform; label as reported |

## 5. Git and review

| Multica feature | User value | Multica | Platform support | felt-ops | Class | Approach · extra code | Evidence | Conf. | Risk |
|---|---|---|---|---|---|---|---|---|---|
| GitHub App, PR linking, CI mirror | See the code result | Config | `app.integration` + OAuth2/credentials (R); inbound webhooks (R) **but AppPort-signed only, so GitHub deliveries are refused (Phase 0 S4)**; no GitHub built-ins (M) | `github.*` integration + `externalRefs.observedVia` | **B + C** | Integration ops `github.branch`, `github.pulls.open/get`, `github.checks`, `github.merge`; inbound webhook for `pull_request`/`check_suite` updates observations · ~300 | ev/F §7; felt-ops `integrations.ts` | M | G-09: a failing `onOutcome` is only logged. Write observations from the calling mutation, not `onOutcome` |
| Auto-complete on merge | Close the loop | Config | — | — | **D** | Merge is the reviewer's acceptance in-app (as themselves); a merge done on GitHub is observed and moves work to `done` · ~40 | ev/C | M | — |
| Review = `in_review` status | Gate before done | Partial | — | `verify` | **D** | `reviews` record: accept / request-changes / reject with note; shows claims vs observations · ~120 | MA 2.4 | H | — |
| GitLab/Forgejo/Gitea | Other hosts | Config | — | — | **F** (v1) | GitHub only | ev/D | — | — |

## 6. Coordination, automation, communication

| Multica feature | User value | Multica | Platform support | felt-ops | Class | Approach · extra code | Evidence | Conf. | Risk |
|---|---|---|---|---|---|---|---|---|---|
| Inbox / notifications | Know what needs you | Verified | notifications service, `afterCommit.notifications` (R) | `inbox.ts` | **B** | Notify on question, review needed, failure, stall; the Desk queries state directly · ~60 | ev/F §6 | H | — |
| Autopilots (schedule, webhook, manual) | Recurring and triggered work | Verified (9k lines) | schedules, inbound webhooks, jobs (R) | jobs/schedules | **B + D** (Phase 3) | A trigger creates work from a template; GitHub label/issue webhook creates work · ~200 | ev/D; ev/F §6 | M | Scheduled jobs carry no workspace (GAP-REGISTER): store tenant in the payload |
| Issue/chat wakeups, plugin schedules | Run later | Verified, redundant | jobs `runAt` (R) | — | **F** | One mechanism: jobs | ev/D | — | — |
| Squads | Multi-agent teams | Verified, prompt-enforced | — | — | **F** (v1) | Later: explicit decomposition into sub-work with dependencies, system-enforced | ev/D | — | — |
| Chat with an agent | Ad hoc help | Verified | — | — | **F** | Quick work items cover it; people's own agents use the MCP surface | ev/D | — | — |
| IM channels (6) | Work where people talk | Config, ~58k lines | EVE Slack/GitHub/Linear channels | — | **F** (v1); later **B** | Slack via EVE's channel (Phase 4) | ev/D, ev/G §6 | L | — |
| Composio, Connected Apps, remote/workspace MCP, plugins | Agent tools | Off by default / partial | EVE tools and MCP channel; AppPort capabilities | — | **F** | Tools belong in the agent definition | ev/D | — | — |
| Server LLM (chat titles) | Nicer titles | Config | `ctx.model.generate` (R) | — | **F** | — | ev/D | — | — |

## 7. Clients, API, operations

| Multica feature | User value | Multica | Platform support | felt-ops | Class | Approach · extra code | Evidence | Conf. | Risk |
|---|---|---|---|---|---|---|---|---|---|
| Web app | Use it | Verified (34 routes) | React client, live queries (R) | operator workspace | **D** | Four surfaces (UX-SPEC) · ~2,000–3,000 | ev/E | H | The run view is the hardest UI |
| Desktop app with daemon manager | Run agents locally | Verified | — | — | **F** (v1) | Web only; local runner is a CLI later | ev/E | — | — |
| Mobile | Approve on the go | Partial | `@appport/mobile` exists (not evaluated) | — | **F** (v1) | Responsive web; revisit for approvals | ev/E | L | — |
| CLI + public API | Script and integrate | Verified CLI; partial v1 API | every capability on AppPort + MCP (R) | MCP capabilities | **A** | Publish capabilities with output schemas; people's own agents (Claude Code) can create and inspect work · ~0 extra | ev/F §3 | H | — |
| Realtime | Live updates | Verified, lossy | live queries (R) | — | **A** | Everything shown is a collection query | ev/F §9 | H | Agent-state writes are outside the change feed. Keep run state in app collections |
| Billing, seats, entitlements, EE | Commercial | Config | — | — | **F** | — | ev/D | — | — |
| i18n (8 locales) | Global audience | Verified | — | — | **F** (v1) | English first | ev/E | — | — |
| Deployment | Run it | Docker/self-host | `feltkit deploy` targets; managed FeltDB | runbook | **A** | Use FeltKit deploy; runner is a separate deployable (EVE) | felt-ops PRODUCTION-RUNBOOK | M | Two deployables: app and runner(s) |

## 8. Platform gaps (E): only those proven necessary

| ID | Gap | Why necessary (not parity) | Reusable by | Interim | Evidence |
|---|---|---|---|---|---|
| **E-1** | **Remote execution protocol.** A process outside the server authenticates as its own principal, claims placed work, renews a lease, reports progress and outcome under fencing, and is re-placed on loss | Every agent-work product needs a worker elsewhere: Multica's daemon, felt-ops' runner and EVE's work channel each re-invent it. FeltKit has the control plane (invocations, attempts, fencing) but EXECUTION.md lists the remote protocol as designed, not implemented, and invocation visibility excludes a separate worker principal | Any FeltKit app that delegates long-running work (CI, coding, data jobs, EVE agents) | App-owned lease on `runs` (~200 lines), mirroring `feltkit.execution/1` | ev/F "Remote execution plane"; FeltKit `docs/EXECUTION.md` §Status |
| **E-2** | **Application-facing approval of agent-owned actions** (felt-ops G-07 remainder): read a task's actions from app code and approve/reject an agent-owned task's action in the app, under the same person-only checks | Without it the central human decision lives in Studio, which felt-ops' operator evaluation showed fragments the experience | Every app with agents proposing consequential actions | v1 avoids agent-proposed consequential actions by design | ev/F §3 (G-07 partly), felt-ops AGENT-OPERATOR-EVALUATION |
| **E-3** | **Published AppPort work channel for EVE** (ecosystem, not FeltKit): an EVE package that pulls work from an AppPort app, writes progress and evidence back to the app, and honours steer/stop at turn boundaries | The example exists but is unpublished, pushes instead of claiming, and writes progress to the agent's own store | Every app that hands work to EVE agents | App-specific runner adapter (~700–1,200 lines), written to become the package | ev/G §7 |

**Not gaps, deliberately:**
- GitHub built-ins: `app.integration` suffices; felt-ops proved the pattern.
- Usage metering (G-14): the runner reports usage; the app labels it.
- Presence: the run view's liveness comes from leases and events.
- Agent control (steering): implemented and tested in FeltKit source; it needs a **release**, not design.
- A sandbox in FeltKit: EVE owns execution.
