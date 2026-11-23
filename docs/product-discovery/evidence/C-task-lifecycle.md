> Working notes from a read-only audit pass (2026-11-23). Produced by an audit agent from source, SQL, tests and docs; the discovery author spot-checked the claims used in decisions (see ../DECISIONS.md, "Verification of audit notes"). Paths are relative to the audited repository unless absolute. Treat unverified rows as leads, not facts.

# C. Agent Task Execution Lifecycle and Human Control — Audit

Scope: Multica `/home/user/multica` (read-only). All paths are relative to `server/` unless noted.
Method: traced SQL (`pkg/db/queries/*.sql`), services, handlers, the runtime sweeper, daemon, CLI and tests. Docs not trusted.
Section A = FACTS (file:line). Section B = JUDGMENTS (labelled). LOC figures are `wc -l` counts (whole files, comments included).

---

## A. FACTS

### A1. What an "agent task" is

- Table `agent_task_queue`, created `migrations/001_init.up.sql:132` (status CHECK originally `queued,dispatched,running,completed,failed,cancelled`).
- Status set extended: `waiting_local_directory` (`migrations/109_agent_task_waiting_local_directory.up.sql:15`), `deferred` (`migrations/128_comment_routing_escalation.up.sql:7-17`). Current set = **8 statuses**: `queued, deferred, dispatched, waiting_local_directory, running, completed, failed, cancelled`.
- One row = one agent attempt ("run") against exactly one of: issue (`issue_id`), chat session (`chat_session_id`), autopilot run (`autopilot_run_id`), or quick-create (all NULL + context JSON). Lineage columns: `parent_task_id`/`retry_of_task_id` (auto-retry), `rerun_of_task_id` (manual rerun), `delegated_from_task_id`, `attempt`/`max_attempts`.
- 126 up-migrations reference `agent_task_queue` (`grep -l agent_task_queue migrations/*.up.sql | wc -l`).
- Insert paths (8): `agent.sql:328 CreateAgentTask`, `agent.sql:407 CreateDeferredChannelIssueTask`, `agent.sql:480 CreateQuickCreateTask`, `agent.sql:532 CreateRetryTask`, `agent.sql:611 CreateManualQuickCreateRetryTask`, `autopilot.sql:608 CreateAutopilotTask`, `chat.sql:1142 CreateChatTask`, `wakeup.sql:158 CreateWakeupTask`.

### A2. Enqueue triggers (who creates tasks)

| Trigger | Entry point | Service fn |
|---|---|---|
| Issue assigned to agent / status promotion | `handler/issue_trigger.go:120 resolveIssueRun` → `dispatchIssueRun` | `service/task.go:1150 EnqueueTaskForIssue`, `:1277/1281 enqueueIssueTaskWithCommentPlan` |
| Comment @mention / thread reply | `handler/comment.go:2008 triggerTasksForComment` (7 Enqueue calls in comment.go) | `task.go:1419 EnqueueTaskForMention`, `:1425 EnqueueTaskForThreadParent`, `:1463 enqueueMentionTaskWithCommentPlan` |
| Squad leader | `handler/squad.go`, `service/autopilot.go:411,966` | `task.go:1441-1455 EnqueueTaskForSquadLeader*` |
| Autopilot (scheduled/webhook) | `service/autopilot.go:1128` (`CreateAutopilotTask`) or issue-creating mode `:413,973` | — |
| Chat message | chat handlers | `task.go:1969 EnqueueChatTask`, `:2059 enqueueChatTaskTx` |
| Quick-create (prompt→issue) | quick-create handler | `task.go:1635 enqueueQuickCreateTask` |
| Scheduled issue wakeups | `handler/issue_wakeup*.go`, `service/issue_wakeup*.go` | `wakeup.sql:158 CreateWakeupTask` |
| Connected-app decision resume | `handler/connected_apps.go:1537` | `service/app_decision.go:20 EnqueueAppDecisionRun` |
| Manual rerun | `handler/task_lifecycle.go:158 RerunIssue`, `:187 RerunTaskByUser` | `task.go:6150 RerunIssue` |
| Auto-retry | inside fail tx | `task.go:5494` `CreateRetryTask` |
| Delegated-failure recovery | fail path + sweeper | `task.go:7110 dispatchDelegatedFailureRecovery`, `:7271 RecoverPendingDelegatedFailures` |

Enqueue guards: triage gate `guardIssueNotInTriage` (`task.go:1287`, `service/task_triage_guard.go`), archived agent / no runtime refusal (`task.go:1294-1305`), attribution fail-closed (`task.go:783 applyAttributionFallback`), project access (`service/task_project_access.go`).

### A3. Idempotency / dedupe

- Partial unique index evolution: `022_task_lifecycle_guards` (`idx_one_pending_task_per_issue`) → `037_fix_pending_task_unique_index` (per issue+agent) → `257_..._v2` → `452_agent_task_pending_thread_unique.up.sql:2` (`(issue_id, agent_id, COALESCE(comment_thread_id,0))` WHERE `status IN ('queued','dispatched') OR (deferred AND channel media pending)`); old v2 dropped in `453`.
- Violation mapped to sentinel `ErrDuplicatePendingTask` / coalesced outcome: `task.go:734 isDuplicatePendingTaskErr` (knows all 3 historical constraint names), `:763 pendingSlotTakenErr`, `:1388-1395`.
- New comments while a task is pending are merged rather than enqueued: `agent.sql:1837 MergeCommentIntoPendingTask`, `:1938 RegisterPlannedCommentForActiveTask`.
- Retry child uses `ON CONFLICT ... DO NOTHING` so a fail tx never aborts on slot collision (`agent.sql:600-603`; comment `task.go:5449-5459`).
- Tests: `internal/handler/duplicate_pending_task_test.go`, `internal/service/duplicate_pending_task_test.go`, `internal/service/pending_slot_err_test.go`, `internal/service/comment_duplicate_enqueue_race_test.go`.

### A4. Task state-transition table

| # | From → To | Actor | SQL (file:line) | Caller (file:line) |
|---|---|---|---|---|
| 1 | ∅ → queued / deferred | server enqueue | `agent.sql:328` CreateAgentTask (`CASE fire_at`), `:407`, `:480`, `chat.sql:1142`, `autopilot.sql:608`, `wakeup.sql:158` | §A2 |
| 2 | ∅ → queued/deferred (retry child) | server, fail tx | `agent.sql:532` CreateRetryTask | `service/task.go:5494`; sweeper path `task.go:5915 MaybeRetryFailedTask` |
| 3 | deferred → queued | claim-time promotion (health gated) | `agent.sql:2323`, `:2438` PromoteDueDeferredTasksForRuntime(s); `:459` PromoteDeferredChannelIssueTask; `chat.sql:1182` PromoteChannelChatTasksIfMediaReady | `task.go:4302` (batch claim), `:4550`, `:2324`, `:2344` |
| 4 | queued(chat) → deferred | channel media pending | `chat.sql:752` DeferChatTaskForSealedPendingMedia | chat channel path |
| 5 | queued → dispatched | daemon claim (`POST /api/daemon/tasks/claim`, `router.go:1764`) | `agent.sql:816` ClaimAgentTask (FOR UPDATE SKIP LOCKED; per-(issue,agent)/chat-session/quick-create serialization; runtime online+fresh; sets `prepare_lease_expires_at`) | `task.go:3831` in `claimTask` (`:3741`); batch `task.go:4263 ClaimTasksForRuntimes`; handler `handler/daemon.go:2153` |
| 6 | dispatched → dispatched (re-delivery) | claim path when response lost | `agent.sql:950`, `:996` ReclaimStaleDispatchedTask(s)ForRuntime(s) | `task.go:4341` |
| 7 | dispatched → queued | claim finalization failed before bytes written (CAS on dispatched_at) | `agent.sql:920` RequeueAgentTaskAfterClaimFailure | `task.go:4189` |
| 8 | dispatched → waiting_local_directory | daemon (path lock contention) | `agent.sql:1068` MarkAgentTaskWaitingLocalDirectory | `task.go:4734`; handler `daemon.go:4936` |
| 9 | dispatched / waiting_local_directory → running | daemon `POST /tasks/{id}/start` | `supplement.sql:1` StartAgentTaskWithSupplement (also records supplement/process-cleanup capability) | `task.go:4613/4640 StartTask(ForClaim)`; handler `daemon.go:4804`; lock `agent.sql:1060 LockAgentTaskStartClaim` |
| 10 | (prepare lease heartbeat, no status change) | daemon every ~15s pre-start | `agent.sql:1047` ExtendAgentTaskPrepareLease | `task.go:4707`; daemon `daemon.go:7729 startTaskPrepareLeaseExtender` |
| 11 | running → completed | daemon `/complete` | `agent.sql:1086` CompleteAgentTask (`WHERE status='running'`) | `task.go:4842 CompleteTaskWithTransition`; handler `daemon.go:5046` |
| 12 | dispatched/running/waiting → failed | daemon `/fail` | `agent.sql:1246` FailAgentTask | `task.go:5287 FailTaskWithTransition`; handler `daemon.go:5830/5857` |
| 13 | dispatched/running/waiting → failed (`runtime_recovery`) | daemon restart | `agent.sql:1300` RecoverOrphanedTasksForRuntime | handler `task_lifecycle.go:28`; daemon `daemon.go:1989,4538` |
| 14 | dispatched/running → failed (`timeout`) | server sweeper (30s) | `agent.sql:1317` FailStaleTasks (dispatch 300s & lease expired; running 9000s AND runtime heartbeat absent > reconnect grace) | `cmd/server/runtime_sweeper.go:593`; consts `:74,:89` |
| 15 | dispatched/running/waiting → failed (`runtime_offline`) | sweeper | `runtime.sql:312` FailTasksForOfflineRuntimes (runtime offline > reconnect grace, default 3h `runtime_sweeper.go:43`) | `runtime_sweeper.go:304` |
| 16 | queued → failed (`queued_expired`) | sweeper | `agent.sql:1394` ExpireStaleQueuedTasks (task age AND runtime heartbeat age > grace; batch 500) | `runtime_sweeper.go:630` |
| 17 | deferred(runtime_offline retry) → failed (`runtime_reconnect_timeout`) | sweeper | `agent.sql:1455` FailExpiredRuntimeReconnectRetries | `runtime_sweeper.go:332` |
| 18 | any non-terminal → cancelled (user) | human `POST /api/tasks/{id}/cancel` (`router.go:2727`), `POST /api/issues/{id}/tasks/{taskId}/cancel` (`router.go:2303`), CLI `issue cancel-task` | `agent.sql:1515` CancelAgentTaskByUser (records `cancelled_by_*`) | `task.go:3008`; handlers `chat.go:1878`, `daemon.go:6373` |
| 19 | any non-terminal → cancelled (system) | server | `agent.sql:1506` CancelAgentTask, `:1644` CancelAgentTaskWithReason, `:1664/:1677` CancelQueued*, `:658` ByIssue, `:670/:694` PendingByIssueAndAgent(InThread), `:731` ByAgent, `:743` ByTriggerComment, `:756` ByChatSession, `:2282` CancelSupersededDeferredRetries, `runtime.sql:359` ByRuntimeOrAgent, `:436` CancelNonOwnerTasksByRuntime, `wakeup.sql:64,72` | `task.go:2761 CancelTasksForIssue` (issue delete `handler/issue.go:4643,5398`), `:2817 CancelTasksForAgent` (`handler/agent.go:3036`), `:2848 CancelTasksByTriggerComment` (comment edit/delete `comment.go:3559,3822`), `:6481 CancelTasksForArchivedAgent`, `service/runtime_access_cancellation.go` |
| 20 | cancelled → failed (`cleanup_unconfirmed`) | daemon cancel-ack reports process still alive | `task_cleanup.sql:37` FailCancelledTaskProcessCleanup | `task.go:5379`; handler `daemon.go:6115 AckTaskCancelled` |

Terminal states: completed, failed, cancelled (cancelled can still become failed via #20). Terminal side effects centralised in `task.go:6684/6691 settleTerminalTaskState` (same tx).

Non-transitions on human issue actions (explicit tests): reassigning an issue does NOT cancel the running task (`handler/issue_reassign_no_cancel_test.go:46,82,133`); setting issue status to cancelled does NOT cancel the task (`handler/issue_cancel_status_no_cancel_test.go:50,88`). Only issue DELETE cancels (`issue.go:4643`).

### A5. Claim, lease, heartbeat, timeouts

- Runtime heartbeat: `POST /api/daemon/heartbeat` (`router.go:1746`); daemon `daemon.go:4588 heartbeatLoop`. Freshness window = `service.RuntimeClaimFreshnessSeconds` (`runtime_sweeper.go:37`).
- Prepare lease (claim → start): `agent.sql:1047`, daemon extender `daemon.go:7729`.
- No per-task lease once running; liveness is the runtime heartbeat (`agent.sql:1317` comment).
- Daemon-side watchdogs: `MULTICA_AGENT_TIMEOUT` default 0 = no wall clock (`daemon/config.go:36,336`); idle watchdog `MULTICA_AGENT_IDLE_WATCHDOG` (`config.go:344-351`, firing `daemon.go:10981`, message `:10850`); Codex semantic inactivity 10m (`config.go:37`, reason `codex_semantic_inactivity` `daemon/poisoned.go:44`).
- Concurrency: per-agent `max_concurrent_tasks` checked in claim tx (`task.go:3741+`, `agent.sql:1733 CountRunningTasks`); test `service/task_claim_race_test.go:22`.
- Claim response mints a task-scoped token `mat_…` (`task_token` table `migrations/108_task_token.up.sql:14`); daemon refuses non-`mat_` tokens (`daemon.go:171-180`); revoked on terminal (`daemon.go:5885`).

### A6. Failure classification and retry

- `pkg/taskfailure/failure.go:1-120` canonical taxonomy: platform reasons (queued_expired, runtime_offline, runtime_reconnect_timeout, runtime_recovery, timeout, cleanup_unconfirmed/blocked, iteration_limit, agent_blocked, api_invalid_request, …) + 14 `agent_error.*` reasons from `classify.go:124 Classify(rawError)` (885 LOC of string heuristics, many `legacy*Reasons` maps for older daemons, `classify.go:471-710`).
- Server re-classifies when daemon omits reason: `task.go:5295-5300`.
- Retryable set: `task.go:5728-5735 retryableReasons` = runtime_offline, runtime_recovery, timeout, codex_semantic_inactivity, agent_error.provider_network, skill_bundle_unavailable. Ceiling `max_attempts` default 2; provider_network raised to 3 (`:5762`); delays `:5778` (runtime_offline → deferred health-gated; provider_network final → 5s).
- `retryEligible` excludes autopilot and triage runs (`task.go:5861-5867`).
- Resume-unsafe reasons clear session on retry (`task.go:5789`, `:5820 ResumeUnsafeFailure`; SQL mirror in `CreateRetryTask` `agent.sql:571-575`).
- On terminal failure with no retry: system comment posted on issue (`task.go:5669-5671`; sweeper path `:6593-6595`); sweeper path also resets issue `in_progress → todo` when no other active task (`task.go:6609-6640`). The daemon-reported `/fail` path (`FailTaskWithTransition`) contains no such reset (no `UpdateIssueStatus` between `task.go:5287-5700`).
- Tests: `service/task_complete_race_test.go:88-492`, `handler/fail_task_successor_test.go`, `pkg/taskfailure/*_test.go` (1,634 test LOC), `handler/task_retry_rebind_race_test.go`.

### A7. Recovery of orphaned / delegated work

- Daemon restart: §A4 #13.
- Runtime gone: `handleRuntimeGone` `daemon.go:1337`, reregister `:1946`.
- Delegated failure recovery (task A delegated to agent B, B fails terminally → platform-authored `progress_update` comment routed back to A's agent): `task.go:6789-7330`; durable outbox replayed every 5 min (`runtime_sweeper.go:33,198`). Backfill CLI `cmd/backfill_delegated_failure_settled`, package `internal/delegatedrecoverybackfill`. Tests `handler/delegated_failure_recovery_test.go`, `service/delegated_failure_recovery_test.go`, `..._settled_test.go`, `..._mixed_categories_test.go`.

### A8. Cancellation

- Human: §A4 #18. `CancelAgentTaskByUser` also acknowledges delegated-failure recovery signals (`agent.sql:1515-1574`). Who cancelled is stored (`cancelled_by_type/id/name`) and resolved by `handler/task_cancellation_actor.go`.
- Propagation to the running agent: daemon polls `GET /api/daemon/tasks/{id}/status` every 5s (`daemon.go:827,5978-6026`) plus WS reconcile broadcast; interrupts agent on terminal status (`daemon.go:5967`).
- Cancel ack + process cleanup confirmation for pi/omp/museapp (`task_cleanup.sql:44-60`, `daemon.go:6334`).
- Chat cancel has deferred finalize (`agent.sql:1715 ClaimChatFinalizeDeferred`; sweeper grace 60s `runtime_sweeper.go:101`; `task.go:3555`).
- NOTE: `handler/request_cancellation.go` is HTTP client-disconnect handling (499), NOT task cancellation (`request_cancellation.go:11-38`).
- Tests: `handler/cancel_task_by_user_test.go`, `handler/task_cancellation_actor_test.go`, `handler/daemon_cancel_retire_test.go`, `handler/comment_reconcile_cancel_test.go`, `handler/chat_archive_cancel_test.go`.

### A9. Rerun (manual retry)

- `POST /api/issues/{id}/rerun` (optional `task_id`), `POST /api/tasks/{id}/rerun` (`fresh` flag) (`router.go:2306,2728`); CLI `issue rerun`, `issue rerun-task` (`cmd/multica/cmd_issue.go:497,506`).
- Re-validates invoke permission on the historical agent (`task_lifecycle.go:230-240`), refuses triage source (`task.go:6185-6187`), enqueues behind a running task rather than cancelling it (comment `task.go:5878-5885`).
- Tests: `handler/rerun_task_test.go`.

### A10. Run history and transcripts

- `task_message` (`migrations/026_task_messages.up.sql:1`): seq, type, tool, content, input, output, `output_truncated` (nullable = unknown), `call_id`, idempotency key. Batch insert `task_message.sql:6`; daemon posts every ~500ms (`handler/daemon.go:5921-5940`). Read: `GET /api/tasks/{id}/messages` (`router.go:2338`), CLI `issue run-messages`.
- Tests: `handler/task_message_batch_test.go`, `task_message_call_id_test.go`, `task_message_truncation_test.go`, `task_payload_nul_test.go`, `plugin_task_messages_test.go`.
- Run list: `GET /api/issues/{id}/task-runs` (`daemon.go:6473 ListTasksByIssue`, `active=true`, `scope=family|subtree`, family cap 20 with `X-Active-Runs-Truncated` header `:6418-6440`). Agent-scoped `GET /api/agents/{id}/tasks` (`agent.go:3055`).
- Context receipt (MUL-9013): metadata-only record of context sources handed to the agent (`handler/task_context_receipt.go:1-40`, `daemon/context_receipt.go`); `POST /api/daemon/tasks/{id}/context-receipt`, `GET /api/tasks/{id}/context-receipt`.
- Session resume: `session_id`, `work_dir`, `durable_work_dir`, `retired_session_id`, `session_rollout_missing` columns; mid-flight pin `agent.sql:1277 UpdateAgentTaskSession` (`POST /tasks/{id}/session`); lookup `agent.sql:1110 GetLastTaskSession`, chat `chat.sql:1218`. Provider-specific resume gating in daemon (`daemon.go:7107-7486`: codex rollout presence, pi session files, claude worktree transcript migration).

### A11. Agent progress and communication

- Agent process receives env `MULTICA_TOKEN` (task-scoped `mat_` token), `MULTICA_SERVER_URL`, `MULTICA_TASK_ID`, `MULTICA_AGENT_ID`, `MULTICA_WORKSPACE_ID` (`daemon.go:182-197`), and uses the `multica` CLI (`cmd/multica/`) to post comments (`issue comment add`), change status (`issue status <id> <status>`, `cmd_issue.go:329`), link PRs, read runs, etc.
- Issue-status behaviour is a prompt convention: injected instructions tell the agent to set `in_progress` first and `in_review`/`done` later (`daemon/execenv/runtime_config_sections.go:371,695,712-715`). Server does not set `in_progress` on claim/start (`task.go:4686-4702 taskStarted` only reconciles agent status and broadcasts).
- Completion invariant: if agent posted no comment since start, server synthesizes a fallback comment from final output (truncated + redacted) (`task.go:4964-5012`).
- Progress: `POST /tasks/{id}/progress` → WS event only, not persisted (`task.go:7347-7363`).
- MCP: workspace/agent MCP servers are merged at claim (`cmd/multica/cmd_agent_mcp.go:15-24`); daemon-local plugin hook MCP (`daemon/plugin_hook_mcp.go`), connected-apps gateway `POST /api/apps/mcp` (`connected_apps.go:1493`, flag-gated).

### A12. Human intervention and steering

- **Comment steer / task supplements** (inject a human message into a running turn): `POST /api/issues/{id}/tasks/{taskId}/supplements` (human only, `router.go:2304`), retry `:2305`; comment create with `steer_task_ids` / `steer` (`handler/comment.go:1451-1454,1730-1746,2019`); CLI `--steer/--steer-active` (`cmd/multica/cmd_issue_comment_steer.go:29-80`, agents cannot steer their own run). Daemon claims/acks (`router.go:1778-1779`; `task_supplement.go:475,518`). Tables `task_supplement`, `task_supplement_capability` (`migrations/538_task_supplement.up.sql:4,16`), `chat_task_supplement` (`661`). Only providers codex/claude/grok/cursor/kiro/pi and only if negotiated at start (`supplement.sql:17`, `CreateTaskSupplement` `supplement.sql:39-55`). Not feature-flagged. Tests `handler/task_supplement_test.go`, `comment_steer_test.go`, `comment_agent_steer_test.go`, `chat_supplement_test.go`, `daemon/cursor_supplement_gate_test.go`.
- **Cancel**: §A8. **Reassign**: does not stop running task (§A4).
- **Blockers**: only the built-in issue status `blocked` (`issue_status.sql:16`, category `migrations/332_issue_status.up.sql:39`). Table `issue_dependency` (blocks/blocked_by/related) exists since `001_init.up.sql:89` but the only query touching it is a workspace-delete cleanup (`workspace_delete.sql:378`) — no API reads/writes it. `taskfailure.ReasonAgentBlocked` and inbox type `agent_blocked` (`internal/inbox/registry.go:73`) are declared but no Go code emits them.
- **Approval gates**: (a) Connected-apps (Composio) action/connect requests — agent tool call creates `app_action_request` (`migrations/617_connected_apps.up.sql:70`, `internal/connectedapps/requests.go:45-120`), human approves/rejects, then run resumes via `EnqueueAppDecisionRun` (`service/app_decision.go:20`). Behind `composio_mcp_apps` flag, default off (`featureflags/keys.go:20,91-92`). (b) Triage gate: issues in Triage refuse derived runs (`service/task_triage_guard.go`), flag `triage_v1` default off (`keys.go:32,99-100`). No generic "approve before agent acts" gate, no `needs_input` status (grep returns nothing).
- **Outcome reporting**: `IssueRunOutcome` is a response-only field on issue writes (status queued|coalesced|deferred|blocked + reason code), never persisted/broadcast (`handler/issue_trigger.go:101-145`, `issue.go:116-118,4438`; CLI `cmd_issue_run_outcome.go`). Comment writes return analogous `trigger_outcomes`. "agent_activity_outcomes" is a test of `GET /api/agent-activity-30d` counts (`agent.go:3423`; `agent_activity_outcomes_test.go:10`), not a table.

### A13. Pull requests and Git integration

- GitHub App: install/callback/webhook (`handler/github.go:460,488,1293`, signature `:1333`, PR events `:1495`), env `GITHUB_APP_SLUG`, `GITHUB_WEBHOOK_SECRET` (`github.go:366-380`). Tables github_installation, github_pull_request (+ snapshot).
- Generic VCS (GitLab, Forgejo, Gitea): `internal/integrations/vcs/{gitlab,forgejo}.go`, webhook `handler/vcs_webhook.go`, tables `vcs_connection`, `vcs_pull_request`, `vcs_commit_status` (`vcs.sql`).
- Linking: identifier in PR title/branch or closing keyword in body; manual link/unlink (`pr_auto_complete.go:27-44,475`; `github.sql:271-305`, `vcs.sql:172-201`).
- PR merge automation: when all linked PRs merged, issue moves to workspace-configured status (default Done), per-issue opt-out, evaluated only on PR events (`pr_auto_complete.go:27-58,612`). Tests `pr_auto_complete_race_test.go`, `issue_pr_auto_complete_test.go`, `issue_create_pr_auto_complete_test.go`, `pr_merge_status_migration_test.go`.
- PR state feeds reviewer-loop dedupe (`head_sha` in task context, `agent.sql:334-336`) and wakeup conditions (`service/issue_wakeup_condition.go:271-336`).
- Agents link PRs themselves via CLI `issue link <issue> <pr-url>` (`cmd_issue.go:261`).

### A14. Usage and cost

- `task_usage` per (task, provider, model): tokens + `cost_usd_ticks` (provider-reported) + `credits_micros` (`task_usage.sql:1-20`; `migrations/032_task_usage.up.sql`). Upsert overwrite (snapshots safe). Endpoint `POST /api/daemon/tasks/{id}/usage` (`daemon.go:5659`); reads `GET /api/issues/{id}/usage` (`daemon.go:6856`), dashboards (`task_usage.sql:124-323`).
- Rollups: daily (073), dashboard (084), hourly pipeline (101/102) with dirty tables; backfill commands `cmd/backfill_task_usage_hourly`, `cmd/backfill_codex_usage_cache`, `internal/taskusagebackfill`.
- Pricing tables duplicated: server `internal/metrics/pricing.go` (457 LOC, Prometheus cost) + `cursor_pricing.go`; frontend `packages/views/runtimes/utils.ts:235 MODEL_PRICING` with user custom pricing store `packages/core/runtimes/custom-pricing-store.ts`.

### A15. Row lock order

- Rule in AGENTS.md "Row Lock Order"; implemented by `lock_task_owner_rows` (`migrations/284_task_owner_row_fence.up.sql`), used in CreateAgentTask (`agent.sql:355-360`), RequeueAgentTaskAfterClaimFailure (`:927-946`), CreateRetryTask (`:598`), CreateWakeupTask. `LockAgentForTaskEnqueue` (`agent.sql:37`) before retry insert (`task.go:5492`).
- Lock-order / race tests: `handler/chat_send_claim_deadlock_test.go`, `runtime_binding_lock_order_test.go`, `service/issue_wakeup_lock_order_test.go`, `service/channel_context_lock_order_test.go`, `service/task_claim_race_test.go`, `task_complete_race_test.go`, `task_retry_rebind_race_test.go`, `cmd/server/runtime_sweeper_race_test.go`, `handler/pr_auto_complete_race_test.go`, `service/comment_duplicate_enqueue_race_test.go`.
- AGENTS.md documents a known unfixed reverse-order path (runtime delete/teardown).

### A16. LOC measurements (approximate; `wc -l`)

| Area | Non-test | Test |
|---|---:|---:|
| service task core (`task*.go`, chat_supplement, claim caches, app_decision, runtime_access_cancellation + their tests) | 9,774 | 8,855 |
| — of which `service/task.go` alone | 8,654 | — |
| service issue/chat wakeups | 5,731 | 4,737 |
| handler daemon/task/steer/rerun/cancel (`daemon*.go`, `task_*.go`, etc.) | 8,723 | 23,732 |
| — of which `handler/daemon.go` alone | 7,156 | — |
| PR / VCS / GitHub (handlers + integrations/vcs) | 4,638 | 6,383 |
| runtime sweeper (`cmd/server/runtime_sweeper*.go`) | 774 | 1,600 |
| `pkg/taskfailure` | 1,498 | 1,634 |
| SQL task queries (agent, supplement, chat_supplement, task_message, task_usage, task_cleanup, task_token, task_context_receipt, wakeup) | 4,172 | — |
| usage pricing/backfill | 1,007 | 1,495 |
| Daemon (`internal/daemon/**`, executor side) | 55,967 | 97,200 |
| Agent backends (`pkg/agent/*.go`, per-provider CLI drivers) | 47,585 | 71,509 |

Server-side lifecycle (excluding daemon + provider drivers, excluding wakeups): ≈ 31k non-test LOC + ≈ 4.2k SQL; with wakeups ≈ 37k. Including daemon and provider drivers: ≈ 140k non-test LOC, ≈ 215k test LOC.

### A17. Accumulated complexity markers

- `service/task.go` cites 51 distinct incident/issue refs (MUL-/GH #).
- Dedupe index rebuilt 4 times (022→037→257→452).
- `taskfailure/classify.go` carries ≥8 `legacy*Reasons` maps to re-bucket older daemons' classifications.
- 30 duplicated migration number prefixes (all ≤128, e.g. two `128_*` files), plus 4 backfill commands and 5 `*backfill` packages.
- Mixed-version compat in claim/start (legacy start with no runtime_id/dispatched_at `daemon.go:4825`; `/claim` alias `router.go:1765`).

---

## B. JUDGMENTS (per feature)

Labels: **Verified implemented** = code + tests traced; **Partially implemented**; **Configured-integration-dependent**; **Documented/declared but unverified**; **Missing**.

| Feature | User problem / who | Trigger → workflow | State (authoritative vs projection) | Failure behaviour | Human must see/control | Classification | Label |
|---|---|---|---|---|---|---|---|
| Task queue + state machine | Operators/members need agents to pick up work reliably | enqueue → claim → start → complete/fail | `agent_task_queue` authoritative; agent status, issue timeline, WS events are projections | sweepers fail stuck work; auto-retry for infra reasons | status, who/why, error, retries | core | Verified implemented (§A4) |
| Enqueue triggers (assign/mention/squad/chat/autopilot/wakeup/quick-create) | Members delegate by assigning or @mentioning | §A2 | task row; `IssueRunOutcome` is response-only projection | refusal sentinels (triage, archived, no runtime, attribution) | whether a run started and why not | core (assign/mention/chat); optional (autopilot, wakeups, squad, quick-create) | Verified implemented |
| Dedupe / coalescing | Avoid duplicate concurrent runs on same issue+agent | unique partial index + merge into pending | index authoritative | duplicate → coalesced outcome | "coalesced" reason | core | Verified implemented |
| Claim / prepare lease / heartbeat | Daemons must not double-run or lose work | daemon poll/WS hint → claim tx | task row + runtime `last_seen_at` | re-delivery, requeue CAS, stale-dispatch fail | runtime online/offline, queued vs running | core | Verified implemented |
| Timeouts / watchdogs | Stuck runs must end | server sweeper 30s; daemon idle/semantic watchdogs | task row | server only fails running tasks when runtime heartbeat absent ≥ grace (3h default); daemon wall-clock off by default | timeout reason | core (backstop is layered: two server + several daemon timers — arguably over-layered) | Verified implemented |
| Failure classification | Users need actionable cause | daemon reason or server `Classify` | `failure_reason` column | unknown → `agent_error.unknown` | refined reason text | core (taxonomy); heuristic legacy maps are maintenance burden | Verified implemented |
| Auto-retry | Transparent recovery from infra blips | in fail tx / sweeper | child task row, lineage cols | ON CONFLICT yields to pending rerun | retry pending flag on failed event | core | Verified implemented |
| Manual rerun / fresh rerun | Member retries a failed/unsatisfying run | button/CLI | new task with `rerun_of_task_id` | permission re-check; triage refusal | rerun, choose fresh session | core | Verified implemented |
| Orphan recovery (daemon restart, runtime gone) | Work must not hang after crash | daemon startup RecoverOrphans | task row | fail + auto-retry | — | core | Verified implemented |
| Delegated failure recovery | Coordinator agent must learn sub-agent failed | fail path + 5-min outbox replay | system comment + settled receipts | bounded attempts (3) then exhaustion comment | coordinator sees platform comment | optional (multi-agent orchestration) — high complexity for a niche path | Verified implemented |
| Cancellation (user) | Stop a run | UI/CLI cancel | task row + `cancelled_by_*` | daemon polls 5s; cleanup ack can flip to failed | who cancelled; confirmation that process stopped | core | Verified implemented |
| Implicit non-cancel on reassign / issue-cancel | Avoid surprising kills | — | — | running work continues after reassign/close | human must explicitly cancel; UI must make this visible | design choice (risk: orphaned spend after a human "cancels" the issue) | Verified implemented (by tests) |
| Transcripts (`task_message`) | Humans audit what the agent did | daemon batch every ~500ms | `task_message` authoritative | NUL sanitized; truncation flagged (nullable) | full tool calls, truncation marker | core | Verified implemented |
| Context receipt | Show what context was given to the agent | once per run | `task_context_receipt` (metadata only) | optional; malformed dropped | debug transparency | optional | Verified implemented |
| Session resume | Continuity across runs/retries | claim reads last session; daemon gates per provider | session cols on task row | resume-unsafe reasons force fresh; retired sessions excluded | "fresh" rerun control | core for agent quality; heavy provider-specific code | Verified implemented |
| Progress reporting | Live status line | `POST /progress` | WS-only, not persisted | lost on reconnect | live indicator | optional | Verified implemented (ephemeral) |
| Agent→platform communication | Agents comment, change status, link PRs | `multica` CLI with `mat_` task token | comments/issues authoritative | completion fallback comment guarantees a visible result | agent comments | core | Verified implemented |
| Agent issue-status changes | Board reflects agent work | prompt instructions + CLI | issue.status | not server-enforced; sweeper resets in_progress→todo only on sweeper-failed tasks, not daemon-reported failures | status | core but convention-based | Partially implemented (inconsistent reset; relies on LLM compliance) |
| Steer / supplements | Correct a running agent mid-turn | comment `--steer`, supplement API | `task_supplement`, `chat_task_supplement` | only 6 providers, capability negotiated; otherwise comment becomes a normal trigger | supplement receipts, `can_supplement` | optional (high value but provider-limited) | Verified implemented (provider-dependent) |
| Blockers | Mark work stalled / dependencies | issue status `blocked` | issue.status | — | — | `issue_dependency` table is unused; `agent_blocked` reason/inbox type never emitted | Partially implemented (status only); dependency graph **Missing**; agent_blocked **Declared but unverified/unused** |
| Approval gates | Humans approve risky agent actions | Composio app action requests; Triage | `app_action_request`; issue triage_state | flags default off | approve/reject UI | optional | Configured-integration-dependent (both default-off flags) |
| Generic "needs input" / pre-action approval | Agent asks human and waits | — | — | — | — | — | Missing (no status; agents just comment and end the turn) |
| PR linking + merge auto-complete | Close issues when code merges | GitHub App / VCS webhooks | `github_pull_request`/`vcs_pull_request` + link tables; issue status projection | evaluated only on PR events | per-issue opt-out, workspace target | optional/core for coding teams | Configured-integration-dependent (needs GitHub App env or VCS connection) |
| Usage & cost | Spend visibility per run/issue/agent | daemon usage reports | `task_usage` authoritative; daily/hourly/dashboard rollups are projections | provider missing → backfilled from runtime | tokens, cost | core (tokens); cost calc duplicated server+client | Verified implemented (pricing tables duplicated — redundancy) |
| Run outcome reporting (`run_outcome`, `trigger_outcomes`) | Caller learns if a write started a run | issue/comment writes | response-only | hidden when caller can't invoke agent | queued/coalesced/deferred/blocked | core (small) | Verified implemented |
| Wakeups (scheduled re-runs, system wakeups) | Agents revisit issues on schedule/conditions | issue wakeup API, ticks | `issue_wakeup` + tasks with `context.wakeup_id` | disabled wakeup cancels unstarted tasks | enable/disable, run list | optional (5.7k LOC) | Verified implemented |

### Overall judgments

1. The lifecycle is robust and heavily defended (CAS on `dispatched_at`, SKIP LOCKED, owner-row fences, ON CONFLICT yielding, layered sweepers), but the defence is the product of many incidents: a rebuild today would need ≈30–37k server LOC + daemon executor to match behaviour; the daemon and provider drivers (~100k LOC non-test) dominate total cost.
2. Human control is strong for cancel/rerun/steer, weak for structured intervention: no needs-input/approval state, blockers are just a status, and reassign/close do not stop spend.
3. Redundancy candidates: duplicated pricing tables (server vs frontend); several cancel query variants (≥14 status→cancelled statements); legacy-daemon reclassification maps; `/claim` alias and legacy start path (compat, needed while old daemons exist).
4. Unnecessary/dead: `issue_dependency` table, `agent_blocked` reason and inbox type.
5. Inconsistency worth flagging: issue `in_progress → todo` reset exists only for sweeper-failed tasks (`task.go:6609`), not daemon-reported failures (`task.go:5287-5700`).
