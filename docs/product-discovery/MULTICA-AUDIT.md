# Multica: product and implementation audit

Audited 2026-11-23 against `rkendel1/multica` at `27dea95` (a shallow clone of 50 commits, so
history-based velocity was not measured). Read-only: no Multica code, tests or servers were run.
Evidence comes from source, SQL, migrations, router wiring and test files. Detailed notes with
`file:line` references are in [`evidence/`](evidence/) (A–E). The claims this document relies on
for decisions were spot-checked by hand ([DECISIONS.md](DECISIONS.md#verification-of-audit-notes)).

Labels: **Verified** = implemented and covered by tests in the tree · **Partial** · **Config** =
configured/integration-dependent · **Doc-only** = documented but unverified · **Missing**.
Classification (judgement): **core** · **optional** · **redundant** · **unnecessary**.

## 1. What Multica actually is

A task tracker (workspaces → projects → issues) in which an issue's assignee can be a person,
an **agent** or a **squad**. Assigning or @-mentioning an agent queues a **task** (one attempt by
one agent). A **daemon** is a local process the user runs (`multica daemon`, the same binary as
the CLI). It detects vendor coding CLIs on the machine, claims the task, prepares a working
directory, launches the CLI (Claude Code, Codex, Cursor, OpenCode … 32 provider identities) and
streams its messages back to the server. The agent reports through the `multica` CLI, using a
task-scoped token, to comment, change status and create issues. People watch a live transcript,
reply to steer, and cancel or rerun.

The vision (`VISION.md`) says Multica should be "the system of record and action for human-agent
work". The implementation is closer to **a shared issue tracker plus a fleet manager for coding
CLIs on members' machines**.

Scale (`wc -l`, non-test / test):

| Area | Non-test | Test |
|---|---:|---:|
| Go server, excluding generated code | ~390k | ~571k |
| Daemon (`internal/daemon`) | 56k | 97k |
| Provider adapters (`pkg/agent`, 32 identities) | 47.6k | 71.5k |
| Task service + daemon handlers | ~18.5k | ~32.6k |
| Issue/comment handlers | 31.8k | 46.4k |
| IM channels (Lark, Slack, DingTalk, WeCom, Weixin, Telegram) | ~58k | ~81k |
| `packages/views` (shared web/desktop UI) | 247k | 740 test files |
| `packages/core` (client, hooks, stores) | 72.5k | 279 test files |
| Mobile / desktop / web shell | 32.6k / 19.9k / 35.4k (30k of it marketing) | — |
| Migrations | 755 up-migrations; 191 `CREATE TABLE`; 42 DB triggers | — |

## 2. Feature audit

Each row: problem → workflow → state → authority vs projection → failure → human control →
label → classification. Evidence IDs point to `evidence/<file>` sections.

### 2.1 Tenancy, identity, permissions (evidence A §1–3)

| Feature | What it does / state | Failure, risks | Label | Class |
|---|---|---|---|---|
| Workspaces | Every workspace route loads the caller's `member` row (`middleware/workspace.go:197-271`). Non-members get 404. Task tokens are pinned to their workspace. Delete is owner-only and done step by step in app code | — | Verified | core |
| Roles | owner/admin/member/guest (`migrations/699`). The last owner can't be removed. Delete rules depend on role and creator | — | Verified | core |
| Guests | Allow-list of routes (`middleware/guest.go:14-147`). Guests are narrowed to their projects and can't mention agents | — | Verified (cloud-gated by plan) | optional |
| Private projects | One rule source (`projectaccess.go`). Admins get no implicit access | Enforced per query; nothing below enforces it; `issue_table_query.go` builds its own SQL | Verified | optional |
| Auth | Email code + JWT cookie, Google OAuth, PATs (`mul_`) | Sessions are stateless JWTs; logout only clears the cookie. PATs have no workspace or permission scope, and legacy ones never expire. Removed members' access lingers up to 10 min in a cache | Verified | core (weak) |
| Share links | Join by link | Can grant admin with no expiry or use cap | Verified | unnecessary as built |

### 2.2 Work model (evidence A §4–7)

| Feature | What it does / state | Failure, risks | Label | Class |
|---|---|---|---|---|
| Projects, repos | Projects; repositories declared both on `workspace.repos` and as project resources | Two sources of truth for repos | Verified | core (repos) |
| Issues | Polymorphic assignee (member/agent/squad), custom status catalog (7 built-in keys, 4 categories), project workflows, labels, properties, sub-issues, duplicates, comments, reactions, subscribers, attachments, saved views, a table view | `issue.go` is 5.4k lines and `comment.go` 4.3k; the status catalog, workflows and the legacy enum overlap | Verified | core (a small subset) |
| Trigger contract | `WillEnqueueRun` (`service/issue_trigger.go:90-240`) is the single rule: backlog parks, triage refuses, done/cancelled never start, and a unique index coalesces duplicates | **The enqueue runs after commit and only logs on failure** (`service/issue.go:975-983`, checked). An assigned issue can sit with no run and nobody told | Verified (lossy) | core |
| Blockers | Issue status `blocked`. `issue_dependency` exists since `001_init` and is unused. The `agent_blocked` reason and inbox type are never emitted | — | Partial | core idea, not built |
| Docs, live description editing | Behind `docs_v1` / `issue_description_live`; needs the `apps/collab` service | — | Config (off by default) | unnecessary |
| Search | Two systems | — | Verified | core (one) |
| CLI | ~45 command files over the internal `/api` with a PAT | — | Verified | core (as an agent interface) |
| Public API v1 | Registry claims user OAuth and PATs are accepted; `/v1` accepts only plugin tokens (`router.go:1803-1814`); write auditing "planned" | Doc/implementation mismatch | Partial | optional |
| Events | In-process bus after commit feeds activity, inbox, unread and realtime (`events/bus.go:94-120`). Wakeups and search use 42 DB triggers. The only outbox is `seat_capacity_outbox` | A crash after commit loses activity, inbox entries and broadcasts | Verified (lossy) | core need, weak build |

### 2.3 Agents, runtimes, machines, daemon (evidence B)

| Feature | What it does / state | Failure, risks | Label | Class |
|---|---|---|---|---|
| Agent | `agent` row: instructions, model, custom args, env (`custom_env` plaintext JSONB), MCP config, concurrency, visibility; bound to one runtime | Env blocks only a few names (not `LD_PRELOAD`, `NODE_OPTIONS`, `GIT_SSH_COMMAND`) | Verified | core |
| Runtime | `agent_runtime` row per (workspace, daemon_id, provider/profile). There is no machine table: a machine is runtime rows sharing `~/.multica/daemon.id` | — | Verified | core idea |
| Daemon | Registers, heartbeats every 15 s (WebSocket or HTTP), claims tasks, prepares `~/multica_workspaces/<task>`, launches the CLI, streams messages, garbage-collects | `daemon.go` is 11.7k lines (`runTask` ~1.7k); ~100-field claim struct; 646 legacy/compat mentions | Verified | core idea, heavy build |
| Liveness | DB `last_seen_at` is authoritative (written ≤ every 60 s); Redis keys are projections. Sweeper: offline after 150 s, tasks failed after a **3-hour reconnect grace**, empty runtimes deleted after 7 days | No per-task lease: a stuck run on a live machine is never detected | Verified | core |
| Providers | 32 identities. Largest adapters: codex 4.4k, hermes 4.1k, cursor 2.8k, opencode 2.7k, pi 2.6k, claude 2.5k lines. No Gemini adapter | Per-OS shims (cursor alone has 9 platform files) | Verified | **unnecessary breadth** |
| Execution security | **No sandbox.** Claude runs with `--permission-mode bypassPermissions` (`pkg/agent/claude.go:1187`, checked), Cursor with `--yolo`, OpenCode with `--dangerously-skip-permissions`, and Codex with `danger-full-access`. The child inherits `os.Environ()` | Every shell secret and the whole filesystem are reachable by the agent | Verified | must not reproduce |
| Runtime sharing | Another member's agent runs on the owner's machine, as the owner | Remote code execution by design, with consent checked at claim | Verified | must not reproduce |
| Credentials | Normal daemon uses the user's PAT/JWT; per-task `mat_` token acts as the runtime owner; git uses the machine's own helpers | Redaction is regex-only and misses bare `mat_`/`mul_`/`mdt_` | Verified | core need, weak build |
| Cloud runtime | 255-line proxy to the closed "multica-cloud" fleet; 503 when self-hosted | — | Config | unnecessary |
| Qoder bridge | ~4.7k lines, raw SQL outside sqlc | — | Config | unnecessary |

### 2.4 Task lifecycle and human control (evidence C)

States: `queued, deferred, dispatched, waiting_local_directory, running, completed, failed,
cancelled`. There are 8 insert paths and about 38 status-changing statements. A full transition
table with SQL and caller `file:line` is in `evidence/C-task-lifecycle.md`.

| Feature | Facts | Failure, risks | Label | Class |
|---|---|---|---|---|
| Claim | Row locks that skip busy rows; stale claims guarded by `dispatched_at`; lock order fixed (migration 284) with deadlock tests | — | Verified | core |
| Dedupe | Unique index on pending (issue, agent, thread); rebuilt 4 times | — | Verified | core |
| Retry | Auto-retry inside the fail transaction for 6 infrastructure failure reasons; yields to a manual rerun | Autopilot and triage runs skipped | Verified | core |
| Failure classification | `pkg/taskfailure`, ~28 platform codes, plus 8+ maps re-bucketing older daemons' reasons | — | Verified | core idea |
| Recovery | Daemon restart releases orphans (`recover-orphans`); delegated-failure recovery is ~550 lines plus an outbox replayed every 5 min | The issue resets to `todo` only when the sweeper fails a task, not when the daemon reports the failure (inconsistent) | Verified | core / over-built |
| Transcript | `task_message` rows (truncated); tool calls, thinking, diffs rendered in the UI | Progress events are WebSocket-only and never stored | Verified | core |
| Agent → system | The agent uses the `multica` CLI. **Status changes are only prompt instructions** (`execenv/runtime_config_sections.go:695`). The server posts a fallback comment if the agent didn't | The system's state depends on the model remembering to update it | Verified | core need, wrong ownership |
| Steering | Comment or supplement to a running task; 6 providers; only if the capability was agreed when the run started | e2e covers codex and pi only | Verified (partial providers) | core |
| Cancel | Records who cancelled; the daemon polls every 5 s; `cancelled → failed` if the process wouldn't stop | **Reassign and close don't cancel the run** (tests confirm); only deleting the issue does | Verified | core (incomplete) |
| Approval gates | None enforced. Review is the `in_review` status. Composio action requests and Triage are off by default, and "confirm writes" is **mapped to allow** (`connectedapps/policy.go:65-67`, checked) | No human gate on any agent effect | Missing | core need, absent |
| Needs input | No state | — | Missing | core need, absent |
| PRs | GitHub App plus GitLab/Forgejo/Gitea webhooks link PRs by `Fixes MUL-1`, mirror CI, complete the issue on merge | Two families of VCS tables | Config | core |
| Usage/cost | Per task, provider and model: tokens, provider-reported cost, credits; rollups and backfills | Pricing table duplicated in server and browser; the **cost shown is computed in the browser**, with per-browser custom prices | Verified (inconsistent) | optional |

### 2.5 Coordination, automation, integrations (evidence D)

| Feature | Facts | Label | Class |
|---|---|---|---|
| Skills | `skill`, `skill_file`, `agent_skill`, versions; bundles written into the CLI's skills folder at claim; import from GitHub/skills.sh/archives (6.0k / 7.5k lines) | Verified | core idea |
| Squads | Leader agent with a hard-coded operating-protocol prompt; delegates by @mention; **coordination enforced only by the prompt**; reaches into 72 files (1.7k / 4.2k) | Verified | optional |
| Chat | One creator ↔ one agent; tasks without an issue; `/issue` promotes; 69 chat migrations (5.9k / 9.1k) | Verified | redundant with work + steering |
| Inbox | Single write path `inbox.Deliver`, type registry, snooze, auto-archive, 2k-row cap; in-app only | Verified | core |
| Autopilots | Schedule/webhook/manual triggers; DB cron (`sys_cron_executions`); webhooks stored then processed; failure auto-pause (9.2k / 10.8k). GitLab signature path broken (`autopilot_webhook.go:249-261`) | Verified / Partial | core (later) |
| Four ways to "run later" | Autopilot schedules, issue wakeups (4.8k), chat wakeups (1.8k), plugin hook schedules | Verified | redundant |
| Four ways to give agents tools | Workspace MCP, Composio, remote MCP, plugin MCP hooks | Mixed | redundant |
| IM channels | Six adapters on one engine; WeCom alone ~20k / 31k and "community-maintained", unverifiable by the core team | Config | unnecessary |
| Plugins, Composio, Connected Apps | Off by default; plugins v1 dropped with "no production data" (`migrations/344`) | Config | unnecessary |
| Server LLM | Only chat titles and follow-up suggestions | Config | unnecessary |
| Billing / entitlements / EE | Commercial scaffolding proxying to Multica Cloud; allow-all when absent | Config | unnecessary |

### 2.6 Clients (evidence E)

| Surface | Facts | Label | Class |
|---|---|---|---|
| Web/desktop | 34 workspace routes at 1:1 parity (thin wrappers over `packages/views`). App rail: work, docs, team, chat, autopilots | Verified | core (a subset) |
| Run visibility | Live `task:message` frames into the query cache (100 ms batching); runs appear in **at least six places**: header chip, under the comment, execution-log sidebar, Runs dialog, transcript viewer, errors tab | Verified | core (once) |
| Live content scope | Run content (`task:message`, `task:progress`) is narrowed for private projects (`cmd/server/private_project_realtime.go:91-104`, checked); on other issues every member sees it | Verified | — |
| Desktop | Bundled daemon manager, tabs, separate issue window, overlays | Verified | optional |
| Mobile | Partial client: Agents screen is "coming soon"; no runtimes, autopilots, skills, usage | Partial | optional |
| Settings | ~18 tabs and ~90 rows; issue sidebar has 14 reorderable sections | Verified | over-built |
| E2E | 52 specs (~140 tests). **None covers agent creation, the assign → run → transcript loop, cancel/retry buttons, chat streaming, autopilots or PR linking** | — | gap |
| Locales | 8 UI locales (~84k lines of JSON); docs in 6 | Verified | optional |

## 3. What Multica is really good at

1. **Agents as first-class assignees.** The assignee picker, timeline and inbox treat agents and
   people alike. People don't have to switch to an agent's own UI.
2. **A live, inspectable run.** Transcript with tool calls, diffs and thinking, steering by reply,
   cancel, rerun, and classified failure reasons. This is the experience users come for.
3. **Bring-your-own machine and subscription.** Agents run where the code, tools and paid CLI
   subscriptions already are.
4. **One rule decides whether work starts** (`WillEnqueueRun`), with dedupe by unique index.
5. **Breadth of provider support.** Valuable to a wide market; expensive to own.

## 4. Structural weaknesses (facts, not taste)

1. **No human authority over agent effects.** There is no enforced approval anywhere, the
   "confirm" policy is mapped to allow, and agents run with permission prompts bypassed on a
   person's machine and with that person's environment.
2. **System state depends on model compliance.** Status transitions are prompt instructions; the
   server posts fallback comments.
3. **Losable side effects.** The run enqueue after commit and the in-process event bus
   (activity, inbox, realtime) can drop work without anyone noticing.
4. **No per-run liveness.** A run is abandoned only when its whole machine is silent past a
   3-hour grace.
5. **Claims are not separated from evidence.** "Done" is the agent's comment plus an issue
   status. A PR merge is the only observed fact, and only when the integration is configured.
6. **Accumulation.** 755 migrations, 4 redundant schedulers, 4 tool-access paths, duplicate
   run surfaces, two VCS table families, permanently-on compatibility flags, and ~650 legacy
   notes in the daemon.

## 5. Correction to an audit note

The clients audit suspected that run output is broadcast to every workspace member. The server
narrows `task:message`/`task:progress` for private projects; workspace-wide visibility applies
to non-private work by design. Recorded in [DECISIONS.md](DECISIONS.md#verification-of-audit-notes).
