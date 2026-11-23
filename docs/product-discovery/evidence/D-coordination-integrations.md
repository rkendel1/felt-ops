> Working notes from a read-only audit pass (2026-11-23). Produced by an audit agent from source, SQL, tests and docs; the discovery author spot-checked the claims used in decisions (see ../DECISIONS.md, "Verification of audit notes"). Paths are relative to the audited repository unless absolute. Treat unverified rows as leads, not facts.

# Audit D — Coordination, Automation, Integrations (Multica @ /home/user/multica)

Method: read source, SQL, migrations, router wiring and test names. I read the docs only to learn what they claim. All paths are relative to `/home/user/multica`. **F:** = fact with file:line. **J:** = judgment.
LOC counts non-blank lines, measured with a glob script at `/tmp/claude-0/-home-user/4a03c94e-9ebd-5764-a1e2-9dcd3d7ea003/scratchpad/loc.py`. They do not include the area-specific code spread through `service/task.go`, `handler/comment.go`, `handler/daemon.go`, the daemon, or the ~1,000 lines of integration wiring in `cmd/server/router.go` (3,137 lines).

## 0. Size table (server Go/SQL by area; frontend TS by package)

| Area | Server non-test | Server test | Frontend non-test (core+views) | Migrations touching (name match) |
|---|---|---|---|---|
| Skills | 5,990 | 7,471 | 7,761 | 9 |
| Squads | 1,674 (plus `squad` mentioned in 72 other non-test files) | 4,249 | 2,333 | 8 |
| Chat (sessions, titles, wakeups, quick actions, drafts) | 5,920 | 9,064 | 12,231 (+339 quick-actions) | 69 "chat" |
| Inbox / notifications | 2,857 (+1,341 `cmd/server/notification_listeners.go`) | 4,485 | 8,196 | 11 |
| Autopilot + scheduler + quota | 9,208 | 10,751 | 9,608 | 30 + 10 quota |
| Issue wakeups (agent-scheduled re-entry) | 4,846 | 4,811 | — | 34 "wakeup" (chat + issue) |
| GitHub App + VCS (GitLab/Forgejo/Gitea) + PR auto-complete | 5,631 | 6,927 | 616 | 14 |
| Channel engine (shared IM core) | 5,909 | 9,127 | — | 39 "channel" |
| Lark/Feishu | 12,592 | 18,331 | 156 | 7 |
| Slack | 4,550 | 4,062 | 151 | 1 |
| DingTalk (community) | 6,226 | 10,375 | 228 | 15 |
| **WeCom (community)** | **19,974** | **31,248** | 154 | 7 |
| Weixin/WeChat | 2,472 | 1,615 | 95 | 8 |
| Telegram (community) | 6,206 | 6,178 | 143 | 2 |
| Composio | 2,775 | 2,575 | 24 | 4 |
| Connected apps + remote MCP + workspace MCP | 6,748 | 3,892 | 2,004 | 15 app_ + 14 mcp |
| Plugins (+ plugin-sdk, plugincontract) | 7,344 | 6,599 | 1,227 | **47** |
| Extension API | 80 | 50 | — | — |
| LLM (`pkg/llm`) | 488 | 694 | — | — |
| Billing / entitlement / feature flags | 5,296 | 5,612 | 3,137 | 14 |
| EE (server/ee + packages/ee) | 1,245 | 462 | (included) | — |
| *Adjacent: Qoder cloud runtime* | 4,244 | 4,414 | | |
| **Total in scope (excl. Qoder/Mika)** | **~118,000** | **~148,600** | **~48,400** | of 1,510 migration files total |

**J:** Chat-platform integrations (channel engine + 6 adapters) account for ~58k non-test and ~81k test server lines, about half of this scope. WeCom alone is larger than skills, squads, chat and inbox combined.

---

## 1. Agent Skills

- **User problem:** give agents reusable instructions (SKILL.md plus supporting files) without pasting them into every prompt.
- **Who:** workspace members who configure agents; agents consume them.
- **Trigger/workflow:** a member creates a skill or imports one (URL from skills.sh/GitHub or clawhub.ai, an archive, or a runtime's local skill dir), then attaches it to agents. At task claim the server sends skill *refs* with hashes. The daemon resolves each bundle per skill (cached on disk), then writes it into the provider-native skills directory of the task workdir (`.claude/skills`, `.github/skills`, `.opencode/skills`, `codex-home/skills`, ...).
- **State:** `skill`, `skill_file`, `agent_skill` (F: `server/migrations/008_structured_skills.up.sql:4-31`). `skill_version` is an append-only snapshot history, and restore writes forward (F: `server/migrations/612_skill_version.up.sql:1-30`). Built-in skills are embedded (`multica-platform`, `multica-onboarding`) (F: `server/internal/service/builtin_skills.go:11-34`).
- **Authoritative vs projection:** live `skill`/`skill_file` are authoritative. `skill_version` is history only (F: 612:5-8). The daemon disk cache is a projection keyed by hash.
- **Failure behavior:** a skill load failure is reported, never swallowed into a shorter set (F: `server/internal/service/task.go:7385-7405`). A daemon bundle fetch failure fails the dispatch with a network diagnosis, and partially fetched bundles stay cached (F: `server/internal/daemon/daemon.go:7508-7575`).
- **Human must see/control:** which skills each agent has, with per-agent enable toggles (routes `cmd/server/router.go:2595-2603`), version history and restore, and import conflict strategy (fail/overwrite/rename/skip, F: `handler/skill.go:856`).
- **Evidence:** handlers `server/internal/handler/skill.go:361-3025`, `skill_version.go:204-272`, `runtime_local_skills.go:595-803`. Daemon resolve route `router.go:1767`. Writer of per-provider dir: `server/internal/daemon/execenv/context.go:325-390`. Third-party import: clawhub `handler/skill.go:929`, skills.sh→GitHub API `:1018,1067`.
- **Tests:** 7.5k lines, e.g. `service/task_agent_skills_test.go`, `service/skill_bundle_test.go`, `daemon/chat_skills*_test.go`, `skill/*_test.go`.
- **Classification:** **Core**. It is the main way to specialize agents, and squads' rosters key off skill names.
- **Label:** **Verified implemented**. Marketplace import depends on external hosts (clawhub.ai, api.github.com).
- **J/complexity:** One concept has three delivery paths (claim payload, bundle resolve with cache, local-skill import RPC through the daemon), and the per-provider directory table has to grow with every new agent CLI. Reasonable but costly.

## 2. Squads

- **User problem:** route work to the right agent or person without the human choosing each time.
- **Who:** members who assign or @mention a squad. A *leader agent* coordinates.
- **Trigger:** an issue is assigned to a squad (`issue.assignee_type='squad'`, F: `migrations/084_squad.up.sql:30-33`), or a squad is @mentioned, quick-created, or targeted by an autopilot (`service/autopilot.go:1776 resolveAutopilotLeader`).
- **Workflow:** a leader task is enqueued (`handler/squad.go:1234 enqueueSquadLeaderTask`). At claim, a hard-coded "Squad Operating Protocol" plus a roster with members' skills is prepended (F: `handler/squad_briefing.go:33-60, 241, 280-454`). The leader delegates by @mention comment, must not do the work itself, then records an evaluation (`action|no_action|failed`) through `POST /api/issues/{id}/squad-evaluated`, which writes to `activity_log` (F: `handler/squad.go:1021-1060`, `router.go:2496`). Worker comments wake the leader (test `squad_worker_comment_wakes_leader_test.go`). Workflow coupling: the leader may change parent status only under the project workflow contract (`leaderWorkflow` enum, F: `squad_briefing.go:128-142`; `service/workflow_squad_handoff.go:14`).
- **State:** `squad` (leader_id), `squad_member` (agent|member, role) (F: 084:2-28). Task rows carry `is_leader_task`, `squad_id` (F: comment at `squad.go:1043-1050`). Evaluations are stored in `activity_log`.
- **Authoritative:** the task row is authoritative for "is this a leader turn" (F: `squad.go:1043`), not the issue assignee.
- **Failure:** a leader that stays silent records nothing. `no_action` is a first-class outcome (`service/squad_no_action.go:12`). Self-trigger suppression is at `squad.go:1192`.
- **Human must see/control:** roster and roles, member runtime status (`/members/status`), leader evaluations in the activity log, and the ability to reassign.
- **Tests:** 15 handler test files `handler/squad_*_test.go` (including `squad_workflow_status_contract_test.go`, `squad_parent_status_contract_test.go`, `squad_no_action_test.go`), plus `service/autopilot_squad_test.go` and `issue_wakeup_squad_test.go`.
- **Classification:** **Optional (differentiating)**. Coordination is done by prompt contract, not by a server-side planner: the server routes and records; the LLM decides.
- **Label:** **Verified implemented**. Whether routing is correct depends on the model following the protocol, which the server cannot enforce.
- **J:** Own code is small (1.7k), but squad conditionals spread into `comment.go` (159 mentions), `autopilot.go` (79), `task.go` (64), `daemon.go` (61) and 72 files overall. That is high coupling for an optional feature. Legacy/current daemon prompt branches (`leaderWorkflowLegacyDaemon`) add version skew.

## 3. Chat

- **User problem:** have a conversation with one agent without filing an issue.
- **Who:** members (1:1 web/desktop chat). External IM users reach the same sessions through channels (§7).
- **Trigger:** send a message (`handler/chat.go SendChatMessage`). This creates an `agent_task_queue` row with `chat_session_id` and no `issue_id` (F: `migrations/033_chat.up.sql:31-35`).
- **How it differs from issues:** a session is owned by its creator and bound to a single `agent_id` (F: 033:4-15). There is no status workflow, assignee, subscribers or inbox rows. Chat replies send a bounded cross-workspace alert that "never creates an Inbox item" (F: `cmd/server/chat_reply_notifications.go` header). The agent session/workdir is reused (`session_id`, `work_dir` columns). `/issue` promotes a message to an issue (channels: `channel/engine/issue_command.go`).
- **Sub-features and state:**
  - `chat_session`, `chat_message` (033).
  - `chat_pinned_agent` (per-user quick-agent pins, F: `migrations/152_chat_pinned_agent.up.sql:1-5`).
  - `chat_draft_restore` (returns the composer text when a cancelled task produced nothing, F: `migrations/182_chat_draft_restore.up.sql:1-18`).
  - `chat_submission_receipt` (653).
  - `chat_task_supplement` (661).
  - `chat_wakeup` (agent-scheduled return to the conversation, kinds condition/at/check, mandatory expiry, F: `migrations/675_chat_wakeup.up.sql:1-24`; dispatcher job `scheduler/jobs_chat_wakeup.go:14`).
  - Queue control: prioritize/clear queued, cancel (`chat.go` endpoints).
- **Titles:** deterministic first-line title capped at 30 code points (F: `internal/chattitle/title.go:21-60`). Optional LLM retitle runs async with a 20s timeout and a CAS write. It is silently skipped when the LLM layer is unconfigured (F: `handler/chat_title.go:17-22, 92-96, 165`).
- **Failure:** cancelled-empty transcript → message deleted plus a durable draft restore. LLM failures fall back silently.
- **Human control:** archive/pin/delete sessions, cancel and reorder queued turns, list/cancel/retry wakeups (`handler/chat_wakeup.go`).
- **Tests:** 9k server lines, 9.3k views lines (e.g. `cmd/server/chat_submission_*_test.go`, `service/chat_wakeup*_test.go`, `handler/chat_title_test.go`).
- **Classification:** **Core** as an interaction mode. Wakeups, quick actions and draft restore are **optional** polish.
- **Label:** **Verified implemented**. LLM titles and quick-action suggestions are **Configured-integration-dependent** (`MULTICA_LLM_*`).
- **J:** 69 chat-named migrations show heavy churn. Chat wakeups (1.8k) duplicate the issue-wakeup engine (4.8k), with different kind enums (`condition/at/check` vs `event/at/every/cron`). This is a **redundancy candidate**.

## 4. Inbox and notifications

- **User problem:** know what needs your attention across issues, docs and agent runs.
- **Who:** members (and agents as recipients, per `recipient_type`).
- **Trigger:** domain events go through bus listeners (`cmd/server/notification_listeners.go`, 1,341 lines) to the single write path `inbox.Deliver` (F: `internal/inbox/deliver.go:33-43`). Other writers: `service/task.go` (task_failed), autopilot pause/quota, connected-app requests, doc comments, project owner recovery, and WeCom outbound.
- **Workflow and rules:**
  - The type registry maps each type to a mutable preference group. Unregistered types are refused (F: `inbox/registry.go:14-63`).
  - Bystander/delegated subscription tiers narrow fanout (F: `inbox/tier.go:10-43`; `notification_listeners.go:58-102`).
  - Snooze up to 366 days. "Waking" types end a snooze (F: `inbox/snooze.go:11-39`).
  - Auto-archive on the actor's own action (F: `inbox/auto_archive.go:17-56`).
  - Per-recipient cap of 2,000 active rows with background trim (F: `inbox/trim.go:16-21`).
  - Per-process read admission budget (F: `internal/inboxread/guard.go:1-30`).
- **State:** `inbox_item` (F: `migrations/001_init.up.sql:110-124`, later extended), plus `notification_preference` (064), archive and snooze columns.
- **Authoritative:** `inbox_item` rows. The realtime `inbox:new` / `inbox:snoozed` events are notifications only. Deliver is deferred until after commit when written inside a transaction (F: `deliver.go:41-42`).
- **Failure:** muted or ineligible recipients are silently not inserted (`inserted=false`). There is **no email or push for notifications**: `EmailService` only sends verification codes and invitations (F: `service/email.go:340,368`).
- **Human control:** archive/unarchive/snooze/archive-all/archive-completed, archived view, preferences, auto-archive prompt (F: `router.go:2838-2873`).
- **Tests:** `inbox/*_test.go` (registry matches frontend types: `inbox/registry_test.go`), 12 `handler/inbox*_test.go`, plus `cmd/server/notification_*_test.go`, `bystander_tier_test.go`, `subscription_delivery_test.go`.
- **Classification:** **Core**.
- **Label:** **Verified implemented** (in-app only).
- **J:** The design is well bounded (one write path, a registry, a trim). Complexity sits in tier rules, which are encoded as prose-heavy predicates in the listener file. Since there is no off-app delivery, a user who isn't watching the app never sees `action_required` items. The chat-platform adapters partly fill that gap (WeCom relays inbox pushes).

## 5. Autopilots and scheduling

- **User problem:** recurring or event-driven agent work (nightly triage, react to CI failure).
- **Who:** members configure. Agents or squads execute.
- **Triggers:** `schedule` (cron + timezone), `webhook` (`/api/webhooks/autopilots/{token}`), `api`/manual (F: `migrations/042_autopilot.up.sql:30-46`; `router.go:1701, 2498-2524`). Webhook triggers have event filters and payload conditions (F: `migrations/110_...:1-5`; `handler/autopilot_webhook.go:676-1018`).
- **Workflow:** run admission → quota gate → concurrency policy (skip/queue/replace) → `create_issue` (creates an issue, assigns the agent or squad leader) or `run_only` (task without issue) (F: 042:14-18; `service/autopilot.go:599-1075`). Run status is synced from issue and task events (`autopilot.go:1200-1418`; `cmd/server/autopilot_listeners.go:28`).
- **Scheduler:** a DB-backed lease/audit table `sys_cron_executions` with unique `(job, scope, plan_time)` (F: `migrations/113_sys_cron_executions.up.sql:1-36`). It runs jobs for autopilot dispatch, chat wakeup, issue wakeup, child-done sweep, plugin hook schedule, search index prune and usage rollup (F: `scheduler/jobs_*.go` Name lines). `heartbeat_scheduler.go` is unrelated: it batches runtime last_seen writes (F: `handler/heartbeat_scheduler.go:15-40`).
- **Webhook pipeline:** the request is persisted to `webhook_delivery` first, a worker processes it asynchronously, there is dedupe (`X-GitHub-Delivery` or a generic header), replay, and a per-IP rate limit (F: `autopilot_webhook.go:217-260, 348-520`; `handler/webhook_delivery_worker.go:28-56`).
- **Quota:** policy-agnostic accounting tables `autopilot_quota_period/reservation`. Limits come from Cloud (F: `migrations/352_autopilot_quota_execution.up.sql:1-16`; `service/autopilot_quota.go`).
- **Failure:** a failed run gets `failure_reason`. The failure monitor auto-pauses autopilots whose runs are mostly failing and sends an `attention` inbox item (F: `cmd/server/autopilot_failure_monitor.go:25-74`). Signature failures → 401 and a rejected delivery, with no run (F: `autopilot_webhook.go:500-520`).
- **Accountability:** a per-trigger "responsible publisher" for attribution (F: `migrations/189_autopilot_trigger_publisher.up.sql:1-15`). There are also rule versions (186), subscribers (120) and collaborators (128).
- **Human control:** pause, run history, delivery log with replay, rotate token, signing secret, cron preview, usage.
- **Tests:** 18 handler test files and 22 service/scheduler test files (e.g. `autopilot_webhook_gitlab_test.go`, `scheduler/concurrent_claim_test.go`, `stale_steal_test.go`, `cmd/server/autopilot_failure_monitor_test.go`).
- **Classification:** **Core** for an agent-work platform.
- **Label:** **Verified implemented**. Quota enforcement is **Configured-integration-dependent** (MULTICA_CLOUD_URL; fail-open otherwise).
- **Facts worth flagging:**
  - (F) Signature verification only supports `X-Hub-Signature-256` HMAC for every provider; `provider` is ignored (`autopilot_webhook.go:249-261`). The webhook_delivery provider CHECK is `('generic','github')` (`migrations/093`). GitLab's native webhook secret is the `X-Gitlab-Token` header, which this path never reads (`X-Gitlab-Token` appears only in `handler/vcs.go` and `integrations/vcs/`). The GitLab test signs with `X-Hub-Signature-256` (`autopilot_webhook_gitlab_test.go:148-160`).
  - **J:** A GitLab-native autopilot webhook therefore works only unsigned, with the URL token as bearer. Docs list 401 for a missing signature but give GitLab event-name guidance without this caveat (`apps/docs/content/docs/autopilots.mdx:94-147`). This is a *Partially implemented* edge.
- **J (redundancy):** there are four independent "run an agent later" mechanisms: autopilot schedule triggers, issue wakeups (`event/at/every/cron`, `migrations/509_issue_wakeup.up.sql`), chat wakeups (`condition/at/check`), and plugin hook schedules (`migrations/399`). They share the scheduler but have separate tables, dispatchers and UIs.

## 6. GitHub App and VCS

- **User problem:** link PRs to issues, show CI status, auto-complete issues on merge.
- **GitHub:** App install (`GitHubConnect`, `GitHubSetupCallback`), HMAC-verified webhook routing `pull_request`, `check_suite/check_run/status`, `installation` (F: `handler/github.go:460-1400`). PRs are linked to issues only by a closing keyword next to the identifier (`Fixes MUL-1`) (F: `github.go:1280-1287`). Since MUL-7726 the merge effect is a workspace setting with per-issue opt-out (F: `migrations/545_pr_auto_complete.up.sql:1-12`; `handler/pr_auto_complete.go:475-612`). Tables: `github_installation`, `github_pull_request`, `issue_pull_request`, check suites/runs, `github_pending_installation` (079, 091, 096, 120, 222). REST snapshot refresher in `integrations/ghsnapshot`.
- **VCS (GitLab/Forgejo/Gitea):** per-workspace token connections with encrypted secrets, separate mirror tables (F: `migrations/216_vcs_integration.up.sql:1-22`; `handler/vcs.go:110-304`, `vcs_webhook.go:94`; `integrations/vcs/gitlab.go, forgejo.go`).
- **Config:** requires `GITHUB_APP_ID/PRIVATE_KEY/SLUG/CLIENT_ID/SECRET`, `GITHUB_WEBHOOK_SECRET`, and `MULTICA_VCS_SECRET_KEY` (+ `MULTICA_VCS_INTEGRATION_ENABLED`) (F: router env scan; `router.go:1465-1474`).
- **Authoritative:** GitHub/GitLab are the source. Local PR tables are projections refreshed by webhook plus snapshot.
- **Failure:** without the secret, the webhook is disabled (`github.go:1296-1300`). Excluded PRs are never re-linked (545).
- **Tests:** `handler/github_test.go`, `github_install_ownership_test.go`, `vcs_webhook_test.go`, `ghsnapshot/*_test.go`, `service/issue_pr_auto_complete_test.go`, `issue_wakeup_condition_pr_test.go`.
- **Classification:** **Core** for a coding-agent product (closes the loop from issue to PR to done). The VCS twin is **optional**.
- **Label:** **Configured-integration-dependent** (verified implemented in code).
- **J:** GitHub and generic VCS keep parallel table families (`github_pull_request` vs `vcs_pull_request`). `issue_pull_request_exclusion.pull_request_id` points at either table, so it is polymorphic without a type column (F: 545 comment). That is accumulated duplication.

## 7. Chat-platform channels (Lark/Feishu, Slack, DingTalk, WeCom, Weixin, Telegram)

- **User problem:** talk to an agent from the IM tool a team already uses.
- **Model:** one installation = one bot = one agent. External users are bound to Multica members (`channel_user_binding`). Chats map onto ordinary `chat_session` rows (F: `migrations/124_channel_generalization.up.sql:62-281`). A shared engine runs Supervisor (per-installation WS connection behind a lease CAS so only one replica connects) and Router (dedup → @bot filter → identity → session → `/issue` → debounced run → outbound replier and typing indicator) (F: `integrations/channel/engine/doc.go`; 13.5k lines incl. tests).
- **Install models:**
  - Slack: BYO app, paste xoxb plus xapp tokens, with slash commands `/issue /new /clear /help` (F: `slack/install.go`, `slash_command.go`).
  - Telegram: BotFather token.
  - DingTalk: BYO Stream robot.
  - WeCom: QR scan install session with a worker.
  - Lark: OAuth device-grant PersonalAgent registration (F: `lark/registration.go`).
  - Weixin: QR login.
- **Gating:** each adapter is wired only when its `MULTICA_<X>_SECRET_KEY` is set (F: `router.go:606, 824, 912, 969, 1271, 1302`).
- **Failure:** the WeCom code says replies produced on a replica that doesn't hold the lease are **dropped** unless a Redis relay is configured, and are lost if no replica holds a connection (F: `router.go:1248-1262`).
- **State:** ~14 `channel_*` tables (dedup, audit, outbound card, task delivery, reply delivery, typing reaction, media pending, context generation ...) plus per-platform tables (dingtalk, weixin, wecom_install_session, feishu_verification).
- **Tests:** very heavy (≈81k lines of tests in total), many are named regressions (`wecom/regression_*`, `lark/typing_*_regression_test.go`).
- **Classification:** Lark and Slack are **optional**. DingTalk, WeCom and Telegram are **optional, community-maintained**: docs say they have no official SLA and the core team "cannot verify behavior against the real thing" (F: `apps/docs/content/docs/community-maintained.mdx`, table rows).
- **Label:** **Configured-integration-dependent**. Behavior against the real platforms is **Documented but unverified** by the core team for the 3 community adapters.
- **J:** This is the dominant cost centre. WeCom is ~20k non-test plus ~31k test lines for a community-maintained adapter, which is more than the code size of skills, squads, chat and inbox combined. The shared engine was extracted late (MUL-3620), and Lark still carries pre-engine structures (`lark_chat_session_binding` in 109 plus channel tables in 124). IM is a reasonable surface, but six adapters is breadth the product doesn't need to establish its core value.

## 8. Composio, Connected Apps, Remote MCP, Workspace MCP

- **Composio:** a standalone REST client (`pkg/composio`) plus business glue (signed-state connect, `user_composio_connection` mirror) (F: `pkg/composio/doc.go`; `integrations/composio/service.go` header; `migrations/127`).
- **Connected Apps v2:** team accounts (`workspace_composio_connection`), per-agent app level, per-action-class rules, requests, a tool-call log (F: `migrations/617_connected_apps.up.sql:1-135`). Runs call apps through a Multica MCP gateway (`POST /api/apps/mcp`) authenticated by a task-scoped bearer that works only while the task is dispatched or running (F: `connectedapps/gateway.go:67`; `router.go:1734-1735`). Remote MCP apps (OAuth to the app's own MCP server, tokens kept server-side) are in `migrations/719` and `pkg/remotemcp`.
- **Gating (F):**
  - Everything needs `COMPOSIO_API_KEY` **and** feature flag `composio_mcp_apps` (default **off**) (`router.go:1378-1381`; `featureflags/keys.go`).
  - Remote MCP apps additionally need `MULTICA_APPS_SECRET_KEY` and are wired *inside* the Composio branch (`router.go:1424-1431`), so remote MCP apps cannot run without a Composio key.
  - Team accounts are an entitlement paid feature (`entitlement/types.go: FeatureTeamAppAccounts`).
- **Human-in-the-loop finding (F):** policies `allow/confirm/block` exist, but `Decide` rewrites `confirm` → `allow` ("per-call approval has been removed", `connectedapps/policy.go:58-70`). The `confirm_writes` level runs as `write` (`gateway.go:347`; `packages/core/types/connected-apps.ts:9-11`). `createRequest` is now only called with `KindConnect` (`gateway.go:577,613`), so `app_action_requested` notifications are effectively vestigial even though the inbox registry still lists them as blocking (`inbox/registry.go:59-62`). The client zod schema maps an unknown level to `confirm_writes` (`packages/core/api/schemas.ts:5028`), which in practice means full write.
  - **J:** A user who chose "confirm writes" gets no confirmation. This is a safety/expectation gap.
- **Workspace MCP:** a library of MCP servers plus explicit per-agent binding, modeled on skills (F: `migrations/315_workspace_mcp_server.up.sql:1-12`). It is merged into the agent's `mcp_config` at claim (`handler/mcp_overlay.go`). Routes are at `router.go:1935-1962, 2608-2611`. It is not flag-gated.
- **Tests:** `handler/connected_apps*_test.go` (5), `workspace_mcp*_test.go` (3), `remotemcp/*_test.go`, `composio/*_test.go`.
- **Classification:** Workspace MCP is **core-adjacent** (a cheap, generic way to give agents tools). Composio and Connected Apps are **optional**, dark-launched commercial-ish surface.
- **Label:** Workspace MCP: **Verified implemented**. Connected Apps, Composio and Remote MCP: **Configured-integration-dependent**, default off. Confirm-writes semantics: **Partially implemented / regressed**.
- **J:** There are three overlapping ways to give an agent external tools: workspace MCP (generic), Connected Apps via Composio, and plugin MCP hooks (`/plugins/{id}/mcp/{hookKey}/tools`, `router.go:1994`). Plus remote MCP apps. **Redundant**.

## 9. Plugins (plugin handlers, plugin-sdk, plugincontract)

- **Model:** the manifest contract defines Actions (plugin→host), Hooks (host→plugin, with triggers event/schedule/...), Resources (skill text), iframe Surfaces, scopes, and `net:<domain>` (F: `pkg/plugincontract/manifest.go` header). Published packages are immutable versions stored in the DB, and admins approve installs (F: `service/plugin_package.go` header). There are 5 example plugins in `examples/plugins/`.
- **Gating:** `plugins_v1` flag is default **off** (F: `featureflags/keys.go`, enforced in `handler/plugin.go:17`, `service/plugin_event_dispatch.go:230`, `scheduler/jobs_plugin_hook.go:124,232`).
- **History (F):** v1 shipped 14 tables and a capability-snapshot compiler. It "never left its feature flag" and was dropped wholesale (`migrations/344_plugin_v2_reset.up.sql:1-44`). 47 plugin-named migrations exist.
- **Tests:** 15 `handler/plugin*_test.go`, `service/plugin*_test.go`, `plugincontract/*_test.go`, `cmd/server/plugin_*_test.go`.
- **Classification:** **Unnecessary at current stage** (speculative platform). It overlaps skills (resource skill text), MCP (hook MCP) and autopilot (schedule hooks).
- **Label:** **Partially implemented** (code exists and is tested, flag off, no production data per 344).
- **J:** ~7.3k non-test plus 6.6k test lines plus 47 migrations for a dark feature that was already rewritten once.

## 10. Extension API and Enterprise edition

- **F:** `internal/extension/extension.go` (≈50 lines) is a registry where `server/ee` packages mount workspace routes from `init`. `-tags oss` builds without them. A boundary test forbids OSS from importing ee (`extension/boundary_test.go`). `handler/extension_api.go:10-24` exposes WorkspaceID/Actor/Publish.
- **EE content (F):** only `projectfolder` (project folders, MUL-9390), with routes List/Create/File/Rename/Delete (`server/ee/projectfolder/handler.go:52-57`) and the client in `packages/ee/project-folders`. It is not entitlement-gated in code; the license boundary is the only separation.
- **Classification:** **Optional / commercial scaffolding**. The scaffolding is thin and clean.
- **Label:** **Verified implemented**.

## 11. LLM usage by the server itself

- **F:** `pkg/llm/client.go:1-60` uses the OpenAI-compatible SDK and is configured by `MULTICA_LLM_API_KEY/BASE_URL/DEFAULT_MODEL`. When unconfigured it is disabled (`Enabled()`, `:307-309`) and makes zero upstream requests (`outbound_contract_test.go:44`). It has exactly two consumers: chat auto-titling (`handler/chat_title.go:165`) and chat follow-up "quick action" suggestions (`service/chat_quick_actions_generate.go:77-88`, `service/task.go:78-83`). **No triage, summarization or routing uses a server-side LLM.** Triage, squads and so on are done by agents through the daemon. The proxy route `/api/llm/v1/chat/completions` was intentionally removed (`router.go:1869`).
- **Doc/test drift (F):** the package doc says `TestOpenAISDKIsImportedOnlyByThisPackage` and `TestDocumentedConsumersAreTheOnlyCallers` enforce the single-entry rule, but **neither test exists** anywhere (grep of `*_test.go`). Today only `pkg/llm` imports `openai-go`, but nothing enforces that.
- **Classification:** **Optional**. **Label:** **Configured-integration-dependent**. The enforcement claim is **Documented but unverified**.

## 12. Billing, entitlements, feature flags

- **Entitlement (F):** a "mechanical policy consumer": Cloud (`MULTICA_CLOUD_URL`) supplies the decisions, and the result is fail-open `ActionOff` when disabled, unreachable or expired (`entitlement/doc.go:1-10`; `types.go:109-120`).
  - Gates: `autopilot_runs`, `members`, `storage_bytes`, `dashboard_history_days`.
  - Paid features: `private_projects`, `guests`, `agent_invocation_members`, `runtime_member_sharing`, `team_app_accounts` (`types.go:15-24, 144-158`).
- **Cloud billing handlers (F):** about 20 proxy endpoints (subscriptions, seats, plan change, portal, balance, top-ups, Stripe webhook forward, autopilot add-on) (`handler/cloud_billing*.go`). They are gated by the `billing_workspace_subscriptions` flag, default off (`cloud_billing.go:123`), and by cloud runtime config (`:638`).
- **Feature flags (F):** `featureflags/keys.go`: billing, composio_mcp_apps, plugins_v1, triage_v1, docs_v1 and issue_description_live are default off. local_search_index and dashboard_history_365d are on. There are four permanently-true compat keys for old desktop clients.
- **Classification:** **Commercial scaffolding** (not product). It is OSS-safe because it fails open.
- **Label:** **Configured-integration-dependent**.
- **J:** ~5.3k server plus 3.1k frontend lines of commercial plumbing. Quota accounting tables live in OSS by design (352).

---

## Cross-cutting judgments

1. **Core value chain:** skills, issues, autopilot, task, PR/GitHub, inbox. These are implemented and heavily tested. Squads are a thin, prompt-driven layer with wide coupling.
2. **Redundancy:**
   - Four deferred-run engines (autopilot schedule, issue wakeups, chat wakeups, plugin hook schedule).
   - Four tool-provisioning paths (workspace MCP, Composio/Connected Apps, remote MCP apps, plugin MCP hooks).
   - Two VCS table families (GitHub vs generic).
   - Skills vs plugin "resource" skills.
3. **Dark/unnecessary:** plugins (flag off, rewritten once, 47 migrations). Connected apps/Composio (flag off). Triage and docs are flag-off (outside scope).
4. **Cost concentration:** six IM adapters are about half the scope. WeCom alone is ~51k lines incl. tests and is community-maintained without core-team verification.
5. **Human-control gaps:**
   - `confirm_writes` now silently means write (§8).
   - No off-app notification channel (§4).
   - GitLab autopilot webhooks cannot use GitLab's native secret (§5).
   - The leader-squad protocol is model-enforced only (§2).
6. **Doc-vs-code drift found:** the LLM single-entry enforcement tests are missing (§11). Docs don't mention the GitLab signature limitation (§5).
7. **Accumulated complexity signals:** 1,510 migration files. Comment blocks that are dense with MUL-ticket incident narratives (e.g. `squad.go:1043-1060`, `notification_listeners.go:58-102`). Legacy/current daemon prompt branches. Compat feature keys. Legacy inbox types kept for old rows.

## Rough cost basis (for estimation)

- In-scope server: ~118k non-test plus ~149k test lines (non-blank). Frontend: ~48k non-test plus ~35k test lines in core/views packages for these areas (channel settings UI under `views/settings` is not counted).
- Estimated cut if plugins, Composio/connected apps, and the three community IM adapters were dropped: about 45k non-test plus 60k test server lines (≈38% / 40% of this scope).
