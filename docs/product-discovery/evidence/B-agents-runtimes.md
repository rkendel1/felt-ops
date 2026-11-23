> Working notes from a read-only audit pass (2026-11-23). Produced by an audit agent from source, SQL, tests and docs; the discovery author spot-checked the claims used in decisions (see ../DECISIONS.md, "Verification of audit notes"). Paths are relative to the audited repository unless absolute. Treat unverified rows as leads, not facts.

# Audit B — Agent identity, runtimes, machines, daemon

Scope: agent configuration, runtimes/machines, daemon lifecycle, agent CLI adapters, secrets, and security boundaries.
Method: I read source, SQL, router wiring, and test names. I did not run any tests. Paths are relative to `/home/user/multica/server` unless they start with `../`.

Sections A to C are facts with file:line evidence. Section D is judgment.

---

## A. Architecture facts (verified in source)

### A1. Mental model
- An **agent** is a workspace-scoped DB row (`agent` table, model `pkg/db/generated/models.go:25-57`). It is bound to one **runtime** through `agent.runtime_id`.
- A **runtime** is an `agent_runtime` row (`models.go:95-115`). There is one row per (workspace, daemon_id, provider), or per (workspace, daemon_id, profile_id) for custom profiles. Uniqueness comes from partial unique indexes in `migrations/120_runtime_profile.up.sql` and `migrations/121_agent_runtime_provider_partial_unique.up.sql`.
- **There is no machine table.** A "machine" is the UI grouping of `agent_runtime` rows that share a `daemon_id`. The daemon_id is a UUID persisted at `~/.multica/daemon.id` (`internal/daemon/identity.go:20-39`). A machine-wide custom name is copied across rows (`internal/handler/daemon.go:440-450`, `inheritMachineCustomName`).
- The **daemon** is a local process started with `multica daemon` on the user's machine. It is the same Go binary as the CLI: `cmd/multica/cmd_daemon*.go` plus `internal/daemon`. It can also be spawned by the desktop app (`LaunchedBy "desktop"`, `daemon.go:342`).
  - It probes PATH for installed agent CLIs.
  - It registers one runtime per detected CLI per workspace the user belongs to.
  - It claims tasks, prepares a per-task directory, launches the CLI as a child process, streams messages back, and reports the result.
- `runtime_mode` is `'local'` or `'cloud'` (CHECK in migration 004). A custom profile must be local (`internal/handler/daemon.go:626`).

### A2. Daemon authentication
- Routes live under `/api/daemon/*` (`cmd/server/router.go:1741-1800`) behind `middleware.DaemonAuth` (`internal/middleware/daemon_auth.go:118`). It accepts four credential types:
  1. `mdt_` daemon token (`daemon_auth.go:160-221`).
  2. `mcn_` cloud-node PAT, verified remotely by multica-cloud Fleet (`:223-258`).
  3. `mul_` personal access token (`:261-303`).
  4. JWT (`:306+`).
- **The normal local daemon authenticates with the user's own PAT/JWT** from `multica login` (`internal/daemon/daemon.go:2261` `SetToken(cfg.Token)`). It renews the PAT in place (`daemon.go:4244-4290` `tokenRenewalLoop`, and handler `internal/handler/personal_access_token.go:167`).
- `mdt_` tokens are **not** a general daemon credential. They are minted only for:
  - short-lived per-task Remote-MCP-broker credentials (`internal/service/task.go:4130-4146`, owner-bound, MUL-8154);
  - Qoder-managed connections (`internal/handler/qoder_connection.go:342`, 1-hour expiry).
- Table: `daemon_token(id, token_hash, workspace_id, daemon_id, expires_at, owner_id)` (`models.go:803`).

### A3. Registration, heartbeat, liveness
- **Register:** `DaemonRegister` (`internal/handler/daemon.go:596`) upserts runtimes.
  - The ownership fence lives in `UpsertAgentRuntime` (`pkg/db/queries/runtime.sql:78-122`): one member cannot take over another member's (daemon_id, provider).
  - Legacy hostname-derived daemon ids are merged into the new row (`daemon.go:1164-1335`, `mergeLegacyRuntimes`).
  - The response carries the server's extra CA PEMs for git (`daemon.go:367-369`; daemon side `internal/daemon/git_ca.go`, `internal/gitca`).
- **Heartbeat:**
  - Daemon interval is 15 s (`internal/daemon/config.go:30`).
  - It goes over the WebSocket when connected (`internal/daemon/wakeup.go:287-336`), otherwise HTTP `/heartbeat` (`handler/daemon.go:1535`).
  - The heartbeat response also delivers pending actions: CLI update, model list, local-skill list/import (`daemon.go:4720` `handleHeartbeatActions`).
- **Liveness is split across two stores:**
  - Redis `mul:runtime:hb:<id>` TTL keys (`internal/handler/runtime_liveness_store.go:69-80`).
  - `agent_runtime.last_seen_at` in the DB, written at most every 60 s (`handler/daemon.go:1533`).
  - The DB row is authoritative for state transitions. Redis only *vetoes* an offline flip (`cmd/server/runtime_sweeper.go:152-163, 358-390`).
  - Without Redis, a no-op store makes the DB the only source (`runtime_liveness_store.go:44-60`).
- **Sweeper** (`cmd/server/runtime_sweeper.go`):
  - runs every 30 s;
  - marks a runtime offline after 150 s without a heartbeat (`internal/service/task.go:193` `RuntimeClaimFreshnessSeconds = 150`);
  - fails in-flight tasks only after a **3 h reconnect grace** (`runtime_sweeper.go:43`);
  - GCs offline runtimes with no active agents after 7 days (`internal/service/runtime_teardown.go:19`), in an hourly job.
- **Daemon restart:** the daemon calls `/runtimes/{id}/recover-orphans` (`internal/handler/task_lifecycle.go:28`) to release its own orphaned tasks immediately.
- **Request/response stores** for update, model list and local skills each have **two implementations**: in-memory for a single node and Redis for multi-node (`runtime_update.go:231` / `runtime_update_redis_store.go:64`; `runtime_models.go:214` / `runtime_models_redis_store.go:44`; `runtime_local_skills.go:244,353` / `runtime_local_skills_redis_store.go:74,268`). The model catalog adds a Redis stale-while-revalidate cache (`runtime_model_catalog.go`).

### A4. Connection and claiming
- **WebSocket** `/api/daemon/ws`: server side is `internal/daemonws/hub.go` plus `internal/handler/daemon_ws.go:13`. It carries:
  - task wakeups ("pending work hints"),
  - heartbeats and acks,
  - RPCs, including claim. The RPCs are replayed into the HTTP handlers in-process (`internal/handler/daemon_rpc.go:45-54`).
- HTTP polling stays as the fallback (`internal/daemon/wsrpc.go:334-339` `ClaimTasksWSFirst`; `daemon.go:5521-5714` `pollLoop` / `runBatchPoller`).
- **Batch claim:** `POST /api/daemon/tasks/claim`, with `/claim` kept as a transitional alias (`router.go:1760-1765`).
  - Handler: `ClaimTasksByRuntime` (`handler/daemon.go:2153`).
  - Payload builder: `buildClaimedTaskResponse` (`daemon.go:2951-4441`), about **1,500 lines**.
  - The per-runtime legacy claim route `/runtimes/{id}/tasks/claim` still exists (`daemon.go:4442`).
- **Claim finalization** (`internal/service/task.go:4080-4170` `FinalizeTaskClaim`) is one transaction that:
  - locks the runtime FOR NO KEY UPDATE;
  - re-checks runtime consent (`handler/daemon.go:2561-2613`);
  - mints the task token `mat_`, whose `user_id` = **the runtime owner** (`daemon.go:2611`);
  - optionally mints an `mdt_` for the Remote-MCP broker.
- **Concurrency limits:**
  - per-agent: default 6, range 1–50 (`internal/agentconfig/concurrency.go`);
  - per-runtime: nullable `agent_runtime.max_concurrent_tasks` (`pkg/db/queries/runtime.sql:726`);
  - daemon-wide slots: 20 (`internal/daemon/config.go:72`), handled by `task_slot.go` and `newTaskSlotSemaphore` (`daemon.go:5936`).

### A5. Execution on the machine
- **Files and directories:**
  - task directories live under `~/multica_workspaces[_<profile>]/<workspace>/<task>/` (`internal/daemon/config.go:114,544,751-767`);
  - bare-repo cache plus per-task git worktrees (`internal/daemon/repocache/cache.go`; `execenv/local_worktree*.go`);
  - context files and skills written into the env (`execenv/execenv.go`, `runtime_config*.go`);
  - per-provider homes: `CODEX_HOME`, Hermes overlay, OpenClaw config, Cursor data dir;
  - `.gc_meta.json` for GC.
- **Preparation** runs in a helper subprocess so a hung filesystem syscall can be killed (`execenv/isolation.go` header). This is crash isolation, **not a security sandbox**.
- **"Local directory" project resources** let a task run in the user's existing directory, in place or as a worktree (`internal/daemon/local_directory.go`).
- **Environments** (`multica env start`): dev servers that agents start are supervised and detected (`internal/daemon/environments.go`, `localenv/`).
- **Launch:** `daemon.handleTask` (`daemon.go:6028`) → `runTask` (`daemon.go:8226-9937`, about **1,700 lines in one function**) → `executeAndDrain` (`daemon.go:10250-10848`, about 600 lines).
- **Process-tree cleanup:**
  - Unix: `Setpgid` (`pkg/agent/proc_other.go:31`);
  - Windows: Job Objects (`pkg/agent/proc_windows.go:139-150`);
  - helper commands: `internal/daemon/processtree`.
- **Idle watchdog:** `daemon.go:10903-10994`. There are 19 non-test files and 453 occurrences of "watchdog" across `internal/daemon` and `pkg/agent`.
- **Poisoned sessions:** output/error classes that make a resumed session fail deterministically are excluded from resume (`internal/daemon/poisoned.go`; SQL guards in `pkg/db/queries/agent.sql` `GetLastTaskSession`).
- **Reconcile:** a WS reconnect broadcasts "re-check now" to the ticker loops (`internal/daemon/reconcile.go`).
- **Rate limits:** CLI subscription-window snapshots are posted to `runtime_rate_limit` (`internal/daemon/rate_limits.go`, `internal/handler/runtime_rate_limit.go`, migration 673).
- **GC:** `internal/daemon/gc.go` (1,807 lines) asks the server whether an issue, chat, autopilot run or task is done (`/gc-check` routes, `router.go:1791-1795`) before deleting directories. Artifact TTL patterns are documented in `../CLI_AND_DAEMON.md:417-428`.
- **Auto-update:** the server queues an update and the daemon defers it until idle (`internal/daemon/queued_update.go`, `auto_update.go`). Integrity is a sha256 check against the release's `checksums.txt` (`internal/cli/update.go:29-32,198-212`). There is no signature beyond that same-origin checksum file.

### A6. Agent CLI adapters (`pkg/agent`)
- **31 protocol backends** in `New()` (`pkg/agent/agent.go:513-572`):
  claude, codebuddy, codex, copilot, opencode, codearts, deveco, openclaw, hermes, pi, cursor, kimi, reasonix, dsh, dim, kiro, antigravity, qoder (+ qoderclicn alias), traecli, grok, qwen, qwenpaw, droid, amp, mcode, devin, muse, zeroclaw, museapp, zcode.
- Add one descriptor-based builtin, `omp` (pi family; `pkg/agent/builtin_runtimes.go`). That makes **32 provider identities**, matching `../scripts/agent-cli-command-names.txt` (31 command names).
- There is **no Gemini CLI adapter**, despite the audit prompt's assumption.
- `SupportedTypes` (`agent.go:423-455`) must stay in lockstep with a DB CHECK constraint that has been widened by about 14 migrations (comment at `agent.go:406-422`).
- Largest adapters, non-test / test LOC:

| Adapter | Non-test | Test |
| --- | --- | --- |
| codex | 4,439 | 7,404 |
| hermes | 4,070 | 6,948 |
| cursor | 2,818 | 4,295 |
| opencode | 2,673 | 5,089 |
| pi | 2,584 | 3,712 |
| claude | 2,496 | 4,123 |
| zcode | 2,121 | 1,925 |
| muse + museapp | 1,877 | 1,693 |

  Most other adapters are 400–1,000 lines each.
- **Per-OS variants:** cursor has 9 `cursor_background_process_*` platform files. pi, qwen, copilot and cursor each have `*_invocation_{windows,other}.go`.

### A7. Secrets and credentials
- **Provider API keys are not handled by the server.**
  - The agent child inherits the daemon's whole OS environment (`pkg/agent/claude.go:1343-1400` `buildEnv` = `os.Environ()` + extras).
  - Only inherited `MULTICA_*` variables and a few Claude-internal markers are stripped.
  - The CLI's own login state (`~/.claude`, `~/.codex`, ...) is used, so credentials stay on the machine.
- **`agent.custom_env`:**
  - a **plaintext JSONB** column (`migrations/040_agent_custom_env.up.sql:5`), with no encryption;
  - delivered to the daemon in the claim payload and layered onto the child env;
  - keys blocked from override: `MULTICA_*`, `HOME`, `PATH`, `USER`, `SHELL`, `TMPDIR`, `CODEX_HOME`, and a few more (`internal/daemon/daemon.go:11388-11400`);
  - not blocked: `LD_PRELOAD`, `NODE_OPTIONS`, `GIT_SSH_COMMAND`, proxies;
  - API responses mask values. Reveal/update is limited to a human workspace owner/admin or the agent owner, never an agent token, and is audit-logged (`internal/handler/agent_env.go:18-73`).
- **Git credentials:**
  - The local daemon uses the machine's own git credential helpers (`repocache/cache.go`, `gitEnv` comment). The server sends only CA PEMs.
  - Qoder-managed runs instead resolve a manual repo token or a short-lived GitHub App installation token server-side (`internal/qoderruntime/credentials.go`).
- **Task token `mat_`:**
  - injected as `MULTICA_TOKEN` (`daemon.go:182-195`) and must start with `mat_` (`daemon.go:171-180`);
  - the server binds (user, agent, task, workspace) and overwrites client headers (`internal/middleware/auth.go:100-140`);
  - expires (`GetTaskTokenByHash ... expires_at > now()`, `pkg/db/queries/task_token.sql`).
- **Credential mint guard:** there is no source file named "credential_mint_guard". It exists only as a test, `internal/handler/credential_mint_guard_test.go:15,60`. The test asserts that `CreatePersonalAccessToken` and `IssueCliToken` return 403 for `X-Actor-Source` task_token/cloud_pat, so an agent cannot escalate its `mat_` into a PAT. An integration variant exists at `cmd/server/credential_mint_actor_integration_test.go`.
- **Redaction** (`pkg/redact/redact.go:18-71`):
  - regexes for AWS, PEM private keys, GitHub, `sk-`, Slack, GitLab, Google, Stripe, JWT, Bearer, DB URLs, and a generic `TOKEN=` / `PASSWORD=` pattern;
  - applied server-side to task messages (`handler/daemon.go:5999-6001`) and on the daemon to tool inputs and notices (`daemon.go:8166,10572`);
  - 13 non-test call sites;
  - Multica's own bare prefixes (`mat_`, `mul_`, `mdt_`) have **no pattern**. They are caught only in `KEY=value` form.
- **Remote MCP broker:**
  - local loopback HTTP brokers per task (`internal/daemon/remote_mcp_broker.go`, limits of 1 MiB, 256 calls, 8 concurrent);
  - credentials are fetched just-in-time with the per-task `mdt_` (`router.go:1757`; `pkg/remotemcp/types.go`);
  - tool schemas are pinned by digest.
- **Plugin hooks:** the server signs the request, so the daemon never holds the signing secret (`router.go:1753-1757`).

### A8. Security boundary (facts)
- **Agents run unsandboxed as the daemon's OS user:**
  - Claude: `--permission-mode bypassPermissions` (`pkg/agent/claude.go:1187`); refused under root unless `IS_SANDBOX=1` (`claude.go:1346-1351`);
  - Cursor: `--yolo` (`cursor.go:1085`);
  - OpenCode: `--dangerously-skip-permissions` (`opencode.go:164`);
  - Codex: `danger-full-access` on Linux by product decision, and on macOS because of an upstream bug (`internal/daemon/execenv/codex_sandbox.go:15-35`).
- **User `custom_args` cannot override these permission flags.** Each backend keeps a blocked-flag table (`claude.go:1170`, `cursor.go:1058`, `opencode.go:40`).
- **The local health/checkout endpoint** (`internal/daemon/health.go`) authenticates `/repo/checkout` with a per-task token. Its own comment says it "is not an OS-user isolation boundary".
- **"Env root guard"** (`env_root_guard_test.go`, `daemon.go:11067-11160`) is a GC/reuse guard. It stops GC from deleting an active task root, including through symlink aliases. It is **not a security control**.
- **Runtime consent and sharing:**
  - `RuntimeAllowsUser` (`internal/service/runtime_access.go:12`): owner, or `visibility='public'`, or `shared_with` contains the user (migrations 083 and 592).
  - It is checked at bind time (`handler/agent.go:2159,2529`), at readiness (`service/agent_ready.go:157`), and again at claim delivery under a row lock (`handler/daemon.go:2587,3056`).
  - Member sharing is a paid feature: `runtime_member_sharing`, MUL-9491 (`handler/runtime_sharing.go`).
- **Agent invocation permission** (`agent.permission_mode` private|public_to plus `agent_invocation_target`, `handler/agent_access.go`): an admin cannot invoke someone else's private agent.

### A9. Cloud runtime and Qoder
- **`internal/cloudruntime`** (255 LOC) plus `handler/cloud_runtime.go` (208 LOC):
  - a thin authenticated **proxy to an external closed-source "multica-cloud" Fleet service** (`router.go:2710-2724`). Routes include `nodes` create, delete, start, stop, reboot, status, and **exec**;
  - self-hosted deployments return 503 (`router.go:2710-2711`);
  - nodes are EC2 instances running the daemon with a node-scoped `mcn_` PAT (`handler/cloud_runtime.go:47-58`);
  - the provisioning logic itself is not in this repo, so it is unverifiable here.
- **Qoder managed runtime** (`internal/qoderruntime`, 3,061 / 3,752 LOC; `cmd/qoder-runtime`; `handler/qoder_*.go`, about 1,700 non-test LOC):
  - a **server-side bridge** that drives Qoder's cloud agent API instead of a local CLI;
  - an advisory-lock-elected supervisor in the API server (`cmd/server/main.go:763`);
  - an encrypted journal in `cloud_agent_connection` (migration 586), queried with **raw SQL in handlers** rather than sqlc (`handler/qoder_connection.go:74,290,300`; `qoder_disconnect.go:97-156`).

### A10. Agent identity and configuration features
- **Agent columns:** name, avatar, instructions, description, model, thinking_level, service_tier, custom_env, custom_args, mcp_config, runtime_config, runtime_mode, visibility (legacy, derived), permission_mode, max_concurrent_tasks, kind (user|system), system_key, disabled_runtime_skills, composio_toolkit_allowlist, conversation_starters (`models.go:25-57`).
- **Related tables:** agent_skill, agent_mcp_server, agent_invocation_target, agent_app, agent_to_label, agent_builder_draft, chat_pinned_agent.
- **Routes:** `router.go:2577-2629` cover CRUD, archive/restore, skills, runtime-skill toggles, MCP servers, env, labels, Mika, and agent-builder sessions.
- **Mika:** a built-in "Chief of Staff" onboarding agent.
  - It is a normal `kind='user'` row with `system_key`. Its instructions are embedded from `internal/service/builtin_agents/mika/INSTRUCTIONS.md` (`service/builtin_agents.go`).
  - The opening message is written statically, with no agent run (`handler/mika_onboarding.go` header, MUL-5827).
- **Agent builder:** an AI-guided agent-creation chat. A hidden `kind='system'` carrier agent runs it on a chosen runtime (`handler/agent_builder.go`). It is behind the compat flag `agents_agent_builder` (`internal/featureflags/keys.go:63`).
- **Avatars:** `handler/agent_avatar.go`, a 42-line validator reusing `acceptAvatarURL`.
- **Runtime profiles** (MUL-3284): a custom command name plus fixed args based on a supported family, bound to one machine (`runtime_profile` table, `handler/runtime_profile.go:1-20`). The daemon pulls them via `/workspaces/{id}/runtime-profiles`.
- **Runtime local skills:** list and import of `~/.claude/skills`, `~/.agents/skills`, etc. through a heartbeat request/response (`internal/daemon/local_skills.go`, `handler/runtime_local_skills.go`). Per-agent disable is in `handler/agent_runtime_skills.go`.

### A11. Legacy table
`daemon_connection` (migration 001) is referenced only by `pkg/db/queries/workspace_delete.sql`. It is dead schema.

---

## B. Feature inventory

Legend for implementation labels:
- **VI** = Verified implemented
- **PI** = Partially implemented
- **CID** = Configured-integration-dependent
- **DU** = Documented but unverified

| # | Feature | User problem / who | Trigger → workflow | State (authoritative / projection) | Failure behaviour | Human must see / control | Class | Label | Evidence / tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Agent identity CRUD | Members define AI teammates | UI/CLI → `POST /api/agents` | `agent` row (auth.) | n/a | Name, owner, runtime, instructions, model | **core** | VI | `handler/agent.go:1493`; `agent_test.go` and about 25 `agent_*_test.go` |
| 2 | Instructions / model / thinking / custom args | Tune behaviour | Agent edit → delivered at claim | `agent` cols; snapshot in claim | Bad args blocked per backend | Model, args | core | VI | `agent_custom_args_test.go`, `agent_thinking_test.go`, `claude.go:1170` |
| 3 | custom_env | Per-agent secrets/config | PUT `/env` (human owner/admin) | Plaintext JSONB | Blocked keys dropped | Masked values, audit log | core, but **weakly protected** | VI | `agent_env.go`, `agent_env_permission_test.go`, `daemon.go:11388` |
| 4 | MCP config / workspace MCP / remote MCP broker | Tool access | Agent MCP servers → claim → per-task broker | `agent.mcp_config`, `agent_mcp_server`; per-task `mdt_` | Broker limits; schema digest pin | Which servers / tools | optional | VI | `remote_mcp_broker_test.go`, `remote_mcp_startup_test.go`, `daemon_claim_workspace_mcp_test.go` |
| 5 | Work dir / local directory | Run in an existing repo checkout | Project resource `local_directory` | Project resource; lock file | Waits on lock (`wait-local-directory` route) | Which dir; mode | optional | VI | `local_directory_test.go`, `agent_work_dir_test.go` |
| 6 | Concurrency (agent / runtime / daemon) | Protect the machine | Claim SQL plus daemon semaphore | Agent col, runtime col, daemon config | Over-limit work stays queued | Limits per agent and runtime | core | VI | `agent_concurrency_test.go`, `runtime_concurrency_test.go`, `task_slot_test.go` |
| 7 | Invocation permission (private / public_to) | Stop others using my agent and its OAuth | Every trigger | `agent.permission_mode`, `agent_invocation_target` | Deny by default | Allow-list | core | VI | `agent_permission_test.go`, `agent_invocation_feature_test.go` |
| 8 | Avatars | Identity | Upload | `avatar_url` | – | – | optional | VI | `avatar_test.go` |
| 9 | Agent builder | Guided creation | Builder chat on a runtime | Hidden system agent, `agent_builder_draft` | Hidden carrier deleted with runtime | Draft | optional / redundant (could be a form) | VI (compat flag) | `agent_builder_test.go` |
| 10 | Mika onboarding agent | First-run guidance | Onboarding | `agent` row with `system_key`, chat rows | Static opening, no run | Rename / edit | optional | VI | `mika_*_test.go` (5 files) |
| 11 | Runtime registration (machine = daemon_id) | Expose local CLIs | Daemon start / workspace sync every 30 s | `agent_runtime` (auth.) | Ownership fence; legacy merge | Machine name, providers, online state | **core** | VI | `daemon_test.go`, `daemon_runtime_ownership_test.go`, `daemon_deregister_batch_test.go` |
| 12 | Heartbeat / liveness | Know if a machine is online | 15 s beats over WS or HTTP | Redis TTL key (projection, veto) + `last_seen_at` (auth.) | Offline after 150 s; tasks failed after 3 h; GC after 7 d | Online / offline, last seen | core | VI | `runtime_liveness_store_test.go`, `cmd/server/runtime_sweeper*_test.go` |
| 13 | Daemon WS (wakeup / heartbeat / RPC) | Low latency | Persistent WS; HTTP fallback | In-memory hub | Falls back to HTTP polling | – | optional (HTTP poll suffices) | VI | `daemonws/*_test.go` (29 tests), `daemon_ws_test.go`, `wsrpc_test.go` |
| 14 | Batch claim + finalize | Dispatch work safely | Poll / wakeup → claim | `agent_task_queue`, `task_token`, `daemon_token` | Tx rollback re-queues; requeue undelivered | Task state | core | VI | `daemon_batch_claim_*_test.go` (5), `task_batch_claim_*_test.go` |
| 15 | Runtime sharing (public / shared_with) | Use a teammate's machine | Runtime PATCH | `visibility`, `shared_with` | Re-checked at delivery | Who may use my machine | optional (paid) | VI | `runtime_sharing_test.go`, `runtime_visibility_*_test.go` |
| 16 | Runtime profiles (custom CLIs) | Wrappers, forks | Settings → profile → daemon refresh | `runtime_profile` | Failed profile row recorded | Command, args | optional | VI | `runtime_profile_*_test.go`, `daemon/runtime_profile_*_test.go` |
| 17 | Model catalog | Pick a model | UI → heartbeat request → daemon runs CLI | Redis / in-memory store + SWR cache | Falls back to cached / static | Model list | optional | VI | `runtime_model_catalog*_test.go` |
| 18 | Runtime local skills | Reuse ~/.claude/skills | UI → heartbeat request | Redis / in-memory; import → `skill` rows | Conflict reporting | Import list | optional | VI | `runtime_local_skills*_test.go` |
| 19 | Runtime update / auto-update | Keep daemons current | UI → queued update → daemon self-replace | Redis / in-memory update store | Deferred until idle; checksum | Version, update button | optional | VI | `runtime_update*_test.go`, `daemon/auto_update_test.go`, `queued_update_test.go` |
| 20 | Rate-limit snapshots | See CLI quota | During run | `runtime_rate_limit` | Latest wins | Usage windows | optional | VI | `runtime_rate_limit_test.go` |
| 21 | Runtime usage / activity | Cost tracking | Task usage reports | `runtime_usage`, task usage | – | Charts | optional | VI | `runtime_test.go` |
| 22 | Execution environment (execenv / repocache / worktrees / CA) | Isolated per-task checkout | Claim → prepare in helper subprocess | Files under `~/multica_workspaces` | Prepare-lease extension; rollback | Work dir path | core | VI | `execenv/*_test.go` (about 100 files), `repocache/*_test.go`, `gitca_linux_test.go` |
| 23 | Agent launch / stream / complete | The actual work | `runTask` → backend `Execute` → messages | `task_message` (redacted) | Fresh-session retry, poisoned filter, idle watchdog | Live transcript | core | VI | `pkg/agent` 1,730 tests; `daemon` 2,171 tests |
| 24 | GC | Disk hygiene | Periodic + server gc-check | Local dirs | 404 TTL guard | Disk usage | core | VI | `gc_*_test.go` |
| 25 | Poisoned sessions / reconcile / process tree | Reliability | Automatic | Failure reason; SQL resume guards | – | Failure reason | core (reliability) | VI | `poisoned_test.go`, `reconcile_test.go`, `processtree/run_unix_test.go` |
| 26 | Redaction | Stop secrets landing in DB/UI | Message ingest | – | Regex-based; misses bare `mat_`/`mul_` | – | core | PI (heuristic) | `pkg/redact/redact_test.go` (452 LOC) |
| 27 | Credential mint guard | Stop agent escalation | Mint endpoints | – | 403 | – | core | VI (test-only artefact) | `credential_mint_guard_test.go` |
| 28 | Cloud runtime (Fleet proxy) | Hosted machines | UI → proxy | External service | 503 when unset | Nodes | optional (SaaS) | **CID** | `cloud_runtime_test.go`, `cloudruntime/client_test.go` |
| 29 | Qoder managed runtime | Run Qoder cloud agents | Settings → connection → server bridge | `cloud_agent_connection` (encrypted journal) | Advisory-lock supervisor | Connection status | optional | CID | `qoderruntime/*_test.go` (103 tests), `qoder_*_test.go` |
| 30 | Environments (`multica env`) | Dev servers per task | Agent CLI | `<dir>/<id>/state.json` | Survive restart | Environment list | optional | VI | `environments_test.go`, `localenv/*_test.go` |
| 31 | Agent sandboxing | Contain the agent | – | – | **None**: bypass/yolo flags | – | missing | **Missing** (by design) | `claude.go:1187`, `codex_sandbox.go` |
| 32 | `daemon_connection` table | – | – | – | – | – | unnecessary | dead schema | `workspace_delete.sql` only |
| 33 | `/api/daemon/claim` alias, per-runtime claim, JWT/PAT daemon auth fallback | Older daemons | – | – | – | – | redundant (compat) | VI | `router.go:1760-1765`; `daemon_legacy_fallback_test.go` |

---

## C. Size measurements (LOC; `wc -l` of `.go` files)

| Area | Non-test | Test |
| --- | --- | --- |
| `internal/daemon` (incl. execenv, repocache, localenv, processtree) | **55,967** | **97,200** |
| `pkg/agent` (adapters) | **47,585** | **71,509** |
| `cmd/multica/cmd_daemon*.go` (daemon CLI / autostart) | 4,891 | about 5,700 |
| handler `runtime*` + `cloud_runtime` | 7,322 | 11,512 |
| handler `daemon*` (claim / heartbeat / register / task lifecycle) | 7,485 | 15,279 |
| handler `agent*`, `avatar`, `mika*`, `plugin_agent*`, `chat_pinned_agent` | 6,992 | 10,201 |
| service `runtime*`, `agent_runtime*`, `agent_ready`, `agent_invocation` | 865 | 1,066 |
| service `task*` (claim / finalize / lifecycle; shared with tasks audit) | 9,054 | 6,238 |
| `cmd/server/runtime_sweeper.go` | 774 | (several test files) |
| `internal/cloudruntime` | 255 | 86 |
| `internal/qoderruntime` | 3,061 | 3,752 |
| handler `qoder_*` | about 1,700 | about 850 |
| `internal/daemonws` | 1,426 | 1,329 |
| `pkg/remotemcp` | 1,209 | 337 |
| `pkg/redact` | 169 | 452 |
| `internal/gitca` | 214 | 172 |
| Frontend `packages/views/runtimes` | 15,697 | 8,302 |
| Frontend `packages/views/agents` | 19,934 | 13,448 |

Totals:
- **Backend non-test in scope:** about 147k LOC.
- **Backend test in scope:** about 225k LOC.
- **Test functions:** daemon 2,171, pkg/agent 1,730, handler runtime/daemon/agent 660, qoderruntime 103, daemonws 29.
- **Frontend in scope:** about 35.6k non-test and about 21.8k test LOC.

Hot spots:

| File | Lines |
| --- | --- |
| `internal/daemon/daemon.go` | 11,674 |
| `internal/handler/daemon.go` | 7,156 |
| `internal/service/task.go` | 8,654 |
| `internal/handler/agent.go` | 3,518 |

`pkg/db/queries/agent.sql` exceeds 2,800 lines. 47 of 755 up-migrations touch agent_runtime, runtime_profile or daemon_token.

Complexity markers (non-test code, `internal/daemon`, `pkg/agent`, `internal/handler`):
- 646 mentions of "legacy / old server / older daemon", 287 of them in `internal/daemon` alone;
- 460 `MUL-####` and 357 `#NNNN` / `GH #` incident references in daemon and agent code;
- the claim `Task` struct has about 100 fields, many with mixed-version contract comments (`internal/daemon/types.go:60-200`).

---

## D. Judgments (opinion, not fact)

1. **The core is sound and heavily defended.** Register, heartbeat, claim, execute, report, plus sweeper and GC, are fully implemented and test-dense. The DB is authoritative and Redis is an optional accelerator, with correct fallbacks.

2. **The security model is "the agent is you on your machine".** There is no sandbox. Agents get bypass/yolo flags, the full inherited environment (all of the user's shell secrets), and a `mat_` token that acts as the **runtime owner** for API calls.
   - Runtime sharing (`public` / `shared_with`) therefore lets another member's agent instructions execute arbitrary commands on the owner's machine with the owner's local credentials and Multica identity.
   - This is consent-gated and re-checked at delivery, but UI copy must make it explicit.
   - `custom_env` is stored in plaintext and does not block injection variables (`LD_PRELOAD`, `NODE_OPTIONS`, `GIT_SSH_COMMAND`).

3. **Accumulated complexity is extreme relative to the product surface.**
   - 32 provider identities, each with bespoke stream parsing, resume semantics, skill directories, Windows invocation shims, and model discovery.
   - Watchdogs: cursor background watchdog, idle watchdog, codex guardian rate-limit breaker.
   - Multiple compat layers: legacy daemon ids, legacy claim routes, JWT/PAT daemon auth, legacy skill redirect, old-server flags in the claim payload.
   - `runTask` at about 1,700 lines and `buildClaimedTaskResponse` at about 1,500 lines are single functions.
   - A rebuild could keep 3–5 providers (claude, codex, cursor, opencode, gemini-class) and drop roughly 70% of `pkg/agent`.

4. **Redundant or removable pieces:**
   - in-memory and Redis dual stores, which could pick one;
   - the `daemon_connection` table;
   - `/claim` and the per-runtime claim aliases;
   - the WebSocket RPC layer duplicating HTTP, which could be kept as wakeup-only;
   - the agent builder, which could be a form;
   - the legacy `visibility` field derived from `permission_mode`.

5. **Integration-dependent parts:** cloud runtime is a proxy to a closed external service, and Qoder is vendor-specific. Neither is verifiable or needed for self-hosting.

6. **What a human must see and control:**
   - each machine's online state and last seen;
   - which CLIs and versions are detected;
   - who may run on my machine (sharing);
   - per-agent concurrency;
   - env secrets, masked, with an audit log;
   - the live transcript and failure reason;
   - update status;
   - disk/GC.

   All of these exist in handlers and views.
