> Working notes from a read-only audit pass (2026-11-23). Produced by an audit agent from source, SQL, tests and docs; the discovery author spot-checked the claims used in decisions (see ../DECISIONS.md, "Verification of audit notes"). Paths are relative to the audited repository unless absolute. Treat unverified rows as leads, not facts.

# E. Clients & Human UX Audit — Multica

Scope: web (`apps/web`), desktop (`apps/desktop`), mobile (`apps/mobile`), shared `packages/views`, `packages/core`. Read-only source audit, 2026-11-23. Nothing was run (no typecheck/tests/servers).

Legend — implementation label: **VI** Verified implemented · **PI** Partially implemented · **CID** Configured/integration-dependent · **DU** Documented but unverified · **M** Missing.
Classification: core / optional / redundant / unnecessary.

---

## 1. FACTS — Sizes

### 1.1 LOC per app/package (`.ts`/`.tsx`, excl. node_modules)

| Workspace | LOC total | LOC non-test (excl. locales) | test files |
|---|---:|---:|---:|
| packages/views | 432,597 | 247,195 | 740 |
| packages/core | 127,214 | 72,511 | 279 |
| apps/web | 41,342 | 35,406 (of which `features/landing` = 30,144 marketing site; workspace routes `app/[workspaceSlug]` = 485) | 51 |
| apps/mobile | 39,299 | 32,632 | 53 |
| apps/desktop | 34,945 | 19,936 | 91 |
| apps/docs | 19,127 | — | 12 |
| packages/ui | 15,016 | 12,849 | 18 |
| e2e/ | 11,948 | — | 52 spec files (~140 `test(` calls) |
| apps/storybook | 8,806 | — | 0 |
| apps/collab | 1,668 | — | 2 |
| packages/ee | 925 | — | 1 |
| packages/plugin-sdk | 361 | — | 0 |

Plus ~84k lines of locale JSON in `packages/views/locales` (8 locales × 26 namespaces: en, es, fr, ja, ko, ru, zh-Hans, zh-Hant). Docs are in 6 locales (en, zh, zh-Hant, ja, ko, fr). Mobile has 3 (en, zh-Hans, zh-Hant).

### 1.2 packages/views subdirectories (non-test LOC)

issues 55,669 · editor 22,047 · settings 20,345 · agents 19,934 · runtimes 15,697 · layout 12,023 · common 11,273 · chat 10,647 · autopilots 9,625 · skills 7,504 · modals 7,052 · projects 6,495 · inbox 5,793 · onboarding 4,815 · search 4,672 · docs 3,668 · workflows 3,343 · dashboard 3,111 · whats-new 2,600 · rich-content 2,380 · squads 2,372 · dev-toolbar 2,092 · apps 1,924 · workspace 1,583 · issue-views 1,463 · (≈20 smaller dirs <1.4k each: plugins, navigation, auth, voice, billing, attachments, members, labels, star-prompt, telegram/lark/wecom/dingtalk/slack bind views, quick-actions, …).

### 1.3 Largest single source files (non-test)

`packages/core/api/client.ts` 6,724 (488 async methods) · `packages/core/api/schemas.ts` 5,225 · `packages/views/issues/components/issue-detail.tsx` 4,728 · `settings/components/billing-tab.tsx` 2,780 (behind default-off flag) · `issues/components/table-view.tsx` 2,637 · `issues-header.tsx` 2,441 · `core/realtime/use-realtime-sync.ts` 2,241 · `editor/attachment-preview-modal.tsx` 2,118 · `apps/desktop/.../stores/tab-store.ts` 2,006 · `common/task-transcript/agent-transcript-dialog.tsx` 1,905 · `swimlane-view.tsx` 1,902 · `members-tab.tsx` 1,787 · `apps/desktop/src/main/daemon-manager.ts` 1,715 · `runtimes/utils.ts` 1,615 (contains hard-coded MODEL_PRICING at :235).

---

## 2. FACTS — Navigation & screens

### 2.1 Information architecture (web + desktop share it)
- App rail "spaces": `work, docs, team, chat, autopilots` + settings in footer (`packages/core/paths/spaces.ts:9-27`). Segment→space map at `spaces.ts:29-46` (inbox/my-issues/issues/projects/views → work; agents/squads/members/skills/apps/runtimes/usage → team).
- Rail is user-reorderable via dnd-kit (`packages/views/layout/app-rail.tsx:385-395`), persisted (`core/navigation/rail-order-store.ts`). Docs space hidden when `docs_v1` off (`layout/app-shell-context.tsx:78-79`).
- Team panel links: agents, squads, members, skills, Apps (only if `appsAvailable`), runtimes, usage (`layout/panels/team-panel.tsx:399-478`). Includes live "working"/"needs attention" agent lists.

### 2.2 Web routes (`apps/web/app`)
- Workspace (all thin wrappers over `@multica/views`): `[workspaceSlug]/(dashboard)/` → `issues`, `issues/[id]`, `issues/[id]/deliverables/[name]`, `my-issues`, `views`, `projects`, `projects/[id]`, `inbox`, `chat`, `agents`, `agents/[id]`, `agents/new`, `agents/new/manual`, `agents/new/ai/[sessionId]`, `agents/new/done/[agentId]`, `squads`, `squads/[id]`, `members/[id]`, `skills`, `skills/[id]`, `apps`, `apps/[slug]`, `runtimes`, `runtimes/[id]`, `runtimes/[id]/runtime/[runtimeId]`, `autopilots`, `autopilots/[id]`, `docs`, `docs/[id]`, `docs/[id]/history`, `docs/folders/[id]`, `usage`, `settings`; plus `[workspaceSlug]/attachments/[id]/preview`.
- Pre-workspace: `(auth)/login`, `onboarding`, `workspaces/new`, `invitations`, `invite/[id]`; `auth/callback`, `join`, `billing/return`; channel bind pages `slack|lark|dingtalk|wecom|telegram/bind`.
- Marketing `(landing)`: 20 pages (about, blog, careers, changelog, contact-sales, customers, download, homepage, licensing, press, pricing, privacy, product[/slug], security, solutions[/slug], usecases[/slug]).

### 2.3 Desktop (`apps/desktop/src/renderer/src/routes.tsx:120-188`)
- Same workspace route set as web (1:1 parity of the 34 workspace routes, incl. docs/apps/usage). Desktop-specific wrappers: `DesktopRuntimesPage`, `DesktopAgentsPage`, `DesktopChooseRuntimePage`, `DesktopSettingsRoute` (+ `daemon-settings-tab`, `updates-settings-tab`).
- Tabs (`stores/tab-store.ts`, 2,006 LOC), separate issue window (`components/issue-window.tsx`), WindowOverlay for `new-workspace | invitations | onboarding` (`stores/window-overlay-store.ts:16-18`).
- Main process: bundled daemon lifecycle (`main/daemon-manager.ts`, recovery, quit dialogs, port/profile), CLI bootstrap, local-directory picker, auto-update, native context menus, 23 IPC handlers. Packaging targets mac/linux/win (`electron-builder.yml:43,65,130`).

### 2.4 Mobile (`apps/mobile/app`, Expo Router)
- Tabs: inbox, my-issues, chat, more (dropdown: pins, issues, projects, settings) (`components/nav/more-tab-dropdown.tsx:78-80,136`).
- Stack screens: issue detail + edit + pickers (status/priority/assignee/label/project/due date), comment emoji picker, `issue/[id]/runs`, `issue/[id]/run/[taskId]` (live transcript), new-issue (+ pickers), project detail/edit/new/add-resource, search, issues-filter, mention-picker, chat-sessions, inbox/[id], switch-workspace, settings (profile, notifications), login/verify.
- **Agents screen is a stub**: `more/agents.tsx` renders `agent.coming_soon` ("Agents coming soon.") and is not linked from the More menu (registered in `[workspace]/_layout.tsx:319`).
- No mobile screens for: runtimes, autopilots, squads, skills, usage, agent creation, docs, most settings. `more.tsx` header comment is stale (says it pushes `/menu`, actual is a dropdown).
- Own API client (`apps/mobile/data/api.ts`, 1,413 LOC) and realtime hooks (`data/realtime/*`).

### 2.5 Per-surface inventory

| Surface | Purpose / primary info | Main actions | Endpoints (via `api.*`) | Impl. | Class. |
|---|---|---|---|---|---|
| Issues list | Issues with grouping, filters (advanced, negation, property, "agent running"), display options | create, batch edit (`batch-action-toolbar.tsx`), inline edit, peek | `/api/issues`, `/api/issues/table`, search-index sync | VI | core |
| Layouts | `ViewMode = board/list/table/gantt/swimlane` (`core/issues/stores/view-store.ts:36`) | drag on board, column picker/resize on table | same | VI | board/list core; table core; gantt & swimlane optional |
| Saved views | `/views` (`issue-views/`) | save/share views | `/api/workspaces/:id/...` | VI | optional |
| Issue detail | 4,728-LOC component; timeline of comments+activity, inline agent runs, description (optionally live-collab), sidebar with 14 sections reorderable/hidable: properties, quick_actions, wakeups, plugins, parent, sub_issues, duplicates, pull_requests, environments, deliverables, apps, execution_log, details, metadata (`core/issues/stores/issue-sidebar-sections-store.ts:7-22`) | comment/reply (steer), annotate, reactions, rerun, cancel, link PR, duplicate, subscribe | `/api/issues/:id/*` (41 path variants), `/api/tasks/:id/*`, `/api/comments/*` | VI | core (sections: plugins/apps/environments/metadata optional) |
| Execution log (sidebar) | totals, bounded cost chart, active runs, recent history; per-row status, failure/cancel reasons (`issues/components/execution-log-section.tsx:50-60, 688-714`) | cancel (`api.cancelTask` → `POST /api/issues/:id/tasks/:taskId/cancel`, :544), retry (`retry-run-button.tsx` → `POST /api/issues/:id/rerun` with `task_id`), open transcript, open Runs dialog | `listTasksByIssue`, `getIssueUsage` | VI | core |
| Runs dialog | full charts + history (`issue-runs-dialog.tsx`, 1,139 LOC; `issue-runs-cumulative-chart.tsx`) | retry, transcript | same | VI | redundant-ish with execution log (see §5) |
| Transcript viewer | `common/task-transcript/agent-transcript-dialog.tsx` — virtualized (react-virtuoso), live "follow" at end, filter by kind (text/thinking/tool_use/tool_result/error), sort, diff rendering, image results, secret redaction (`redact.ts`), context receipt, workdir copy | copy, filter | `GET` task messages (`listTaskMessages`, client.ts:3495), `getTaskContextReceipt` | VI | core |
| Inline comment run | run rendered under triggering comment with live steps (`inline-comment-run.tsx`) | stop (TerminateTaskConfirmDialog), open transcript | task messages | VI | core |
| Header live chip | "agent working" chip in issue header (`issue-agent-header-chip.tsx`), presence chip, sub-issues working chip | jump to run | `issueKeys.tasks` | VI | core |
| Steering | reply in a running agent's thread lands in current turn; receipts (`steer-receipts.tsx`, `core/issues/run-steering.ts`); chat equivalent (`client.ts:4687` `steer: options?.queue !== true`, `chat/components/chat-queue.tsx`) | retry supplement | comment create with `steer_task_ids` (client.ts:2151-2161) | VI (provider-dependent per README) | core |
| PR display | `pull-requests-section.tsx`, `pull-request-list.tsx`, `pull-request-chips.tsx` | link/unlink PR, auto-complete toggle | `listIssuePullRequests`, `linkIssuePullRequest`, `unlinkIssuePullRequest` (client.ts:6009-6095) | CID (GitHub App; GitLab/Gitea/Forgejo via `settings/components/code-vcs.tsx:51`) | core |
| Assign-to-agent | assignee picker lists members, agents (runtime-bound only), squads, recents (`issues/components/pickers/assignee-picker.tsx:229-420`); structured dispatch refusal `invocation_not_allowed` localized | assign | `PATCH issue` | VI | core |
| Agents directory | `agents/components/agents-page.tsx` with filters, bulk access, presence, sparkline | archive/restore, bulk access, cancel all tasks (`api.cancelAgentTasks`) | `listAgents`, `getWorkspaceAgentActivity`, `getWorkspaceAgentRunCounts`, `getWorkspaceWorkingAgents` | VI | core |
| Agent detail | inspector (model/thinking/runtime/access pickers), instructions, skills, env, MCP config (742+853 LOC), channels, apps (flag), conversation starters, tasks list | edit, test via chat | `getAgent`, `updateAgent`, `getAgentEnv`, `listAgentTasksPage` | VI | core; MCP/env advanced optional |
| Agent creation | choose runtime → manual form OR AI builder session (conversational) → done page (`agents/create/*`) | create, drafts | `createAgent`, `createAgentBuilderSession`, `saveAgentBuilderDraft` | VI | manual core; AI builder optional |
| Runtimes/machines | `runtimes/components/*` list, detail, profiles, concurrency, access editor, rate limits, usage charts, update section, cloud runtime nodes, remote connect, Qoder connection, local skill import | rename, delete, revoke access, initiate CLI update, list models | `listRuntimes`, `getRuntimeUsage*`, `initiateUpdate`, `createCloudRuntimeNode`, `*Qoder*` | VI (cloud nodes/Qoder CID) | core (Qoder/cloud nodes optional) |
| Desktop daemon panel | `daemon-panel.tsx`, `daemon-runtime-card.tsx`, log parsing | start/stop/restart daemon | IPC | VI | core for desktop |
| Chat | `/chat` page + floating chat window (`chat/floating-chat.tsx`); sessions, pin agents, queue, wakeups (follow-up later), quick actions, live trace under in-flight bubble | send, steer/queue, cancel (`cancelTaskById`), prioritize queued, archive/pin | `/api/chat/sessions*` (15), `/api/chat/pending-tasks`, task messages | VI | core |
| Inbox | notifications list, archived, snoozed, facets, unread summary | read/unread, archive (bulk), snooze, unsubscribe (subtree), delete | `/api/inbox/*` | VI | core |
| My issues | personal filter of issues | — | issues | VI | redundant with issues filters/views (convenience) |
| Projects | list/detail, resources (repos/docs/local folders), members, private projects, progress, subscription | CRUD, resources | `/api/projects/*` | VI | core |
| Squads | list/detail (2,372 LOC), member roles, leader | add/remove member, role | `/api/squads/*` | VI | optional |
| Autopilots | list/detail (1,396 LOC detail), triggers (cron preview, webhook w/ token rotation), runs, deliveries replay, access grants, quota; issue wakeups & system wakeups | create, trigger now, replay | `/api/autopilots/*`, `/api/system-wakeups/*` | VI | optional-core |
| Skills | list/detail, import (URL/archive), versions/restore, runtime local skill import (1,391 LOC panel) | CRUD, attach to agents | `/api/skills/*` | VI | core |
| Usage / Analytics | `/usage` dashboard: KPIs (cost/tokens/run time/runs), trend, leaderboard, Errors tab (failure classes) (`dashboard/components/*`) | ranges 1d–365d, project filter | `getDashboard*` (client.ts:3254-3299) | VI | core |
| Cost computation | client-side estimate from hard-coded `MODEL_PRICING` (`views/runtimes/utils.ts:235`, `estimateCost` :982) + per-browser custom pricing store (`core/runtimes/custom-pricing-store.ts`, global, persisted locally) | set custom price | — | VI | core, design concern (§5) |
| Settings | 3 groups, up to ~18 tabs: profile, preferences, appearance, notifications, shortcuts, voice-input (cond.), tokens; workspace general, members, billing (flag); workflows, labels, properties, quick-actions; code, channels, mcp, plugins (flag); desktop device tabs (`settings/components/settings-page.tsx:150-280`); ~90 `<SettingsRow>`; legacy URL remapping layer (`settings-navigation.ts:59-118`) | — | many | VI | core + accumulation |
| Channels | lark, slack, dingtalk, wecom, telegram, weixin (`settings-navigation.ts:2-9`) | connect/disconnect, bind | `/api/*/binding` | CID | optional |
| Onboarding | steps welcome → about_you → workspace → platform fork → runtime connect; "Mika" starter agent (`onboarding/onboarding-flow.tsx:407-458`, `templates/mika.ts`), cloud waitlist | create workspace, create Mika agent | `/api/me/onboarding`, `createMikaAgent`, `joinCloudWaitlist` | VI | core |
| Docs (workspace docs) | `docs/*` routes, history, folders | — | `/api/docs/*` | VI but gated `docs_v1` default OFF (`server/internal/featureflags/keys.go:44`) | optional |
| Apps (Composio) | `/apps` | connect accounts, request team app | `/api/integrations/composio`, `/api/apps/team` | CID, gated `composio_mcp_apps` default OFF | optional |
| Plugins | settings tab + issue sidebar section | — | `/api/plugin-bridge/v1` | gated `plugins_v1` default OFF | unnecessary for core (dogfood) |
| Billing | settings tab (2,780 LOC), limit-recovery dialog | Stripe checkout | billing endpoints | gated `billing_workspace_subscriptions` default OFF | optional (cloud only) |
| Triage | server flag `triage_v1` says it gates "the Triage page" (`keys.go:26-32`) | — | — | **M** on client: no route/page in web, desktop or mobile | — |
| Misc | What's-new deck (2,600), star prompt, voice input, themes store, dev toolbar (2,092), quick actions, search (local index) | | | VI | mostly optional/unnecessary |

---

## 3. FACTS — How a human sees and controls agent execution

1. **Event stream.** Server WS event types include `task:queued, task:coalesced, task:dispatch, task:running, task:waiting_local_directory, task:progress, task:usage, task:completed, task:failed, task:message, task:cancelled` (`packages/core/types/events.ts:33-43`).
2. **Live transcript plumbing.** `task:message` frames are written directly into the `chatKeys.taskMessages(taskId)` Query cache, but only for timelines this client already holds; batched with a 100 ms leading-edge window (`core/realtime/use-realtime-sync.ts:160-168, 1717-1797`). Comment there states `task:message` "is broadcast to EVERY client for EVERY run in the workspace" (:1723) — filtering is client-side. `task:completed/failed` invalidate so the DB stays authoritative.
3. **Where it shows (web/desktop):** header "agent working" chip → inline run under the triggering comment (live steps) → Execution log sidebar section (active runs + history + cost) → Runs dialog (charts) → full Transcript dialog (tool calls with args summaries, diffs, command output, images, thinking, errors; redacted secrets; follow-live). Agent detail and team panel show "working" and "stuck/needs attention". Chat shows trace under the in-flight bubble and a task status pill.
4. **Steer:** replying in the running agent's thread steers by default; receipts show delivery/failure with retry (`steer-receipts.tsx`; e2e `comment-steering.spec.ts` for codex and pi with DB-inserted fixtures). Chat sends `steer: true` unless queued.
5. **Cancel:** per-run stop in execution log and inline run (confirm dialog), chat cancel, agent-wide "cancel tasks" (`api.cancelAgentTasks`). Mobile: `run-cancel-button.tsx`, chat cancel.
6. **Rerun:** per-run retry for `failed|cancelled` (`retry-run-button.tsx:16-18`) targeting the original agent; 403 `invocation_not_allowed` localized. Mobile has no retry.
7. **Failure display:** failure reason → localized label (`agents/components/tabs/task-failure.ts:11-62`, ~28 platform codes + `agent_error.*` classes), "needs action" vs cancellation distinction, cancellation actor; Errors tab aggregates failure classes (`core/dashboard/failure-class.ts`). Mobile mirrors labels (`apps/mobile/lib/failure-reason-label.ts`, `run-failure-badge.ts`).
8. **Mobile:** runs list + live transcript (`issue/[id]/run/[taskId].tsx`, realtime via `data/realtime/use-run-transcript-realtime.ts`), agent header badge, cancel. No rerun, no agents/runtimes management.

Minor contract fact: `rerunIssue` returns the raw `this.fetch` result without zod parsing (`packages/core/api/client.ts:3544-3549`), whereas `cancelTask` parses (:3533-3541). AGENTS.md requires zod + `parseWithFallback` for UI-consumed JSON.

---

## 4. FACTS — README / docs claims vs UI

| Claim (source) | Finding | Label |
|---|---|---|
| Agents as teammates, squads, skills, own runtime (README) | pages exist web+desktop | VI |
| Assign issue to agent | assignee picker incl. agents/squads | VI |
| Autopilots on cron | cron + webhook triggers, runs, deliveries | VI |
| Chat; "chat from any page" (chat.mdx:51) | `/chat` + floating chat | VI |
| Projects with repos/docs context | project resources | VI |
| Execution log, replay every tool call | transcript dialog | VI |
| Steer a running agent (Claude Code, Codex, Cursor, Grok, Kiro, Pi) | UI + e2e for codex/pi only; per-provider support is daemon-side, not verified here | PI/DU per provider |
| Usage analytics per agent and per issue | `/usage` dashboard + issue Runs dialog + runtime usage | VI (cost is an estimate, client-computed) |
| Review gates ("work lands in review") | Implemented as `in_review` status convention agents set (issues.mdx:96); no enforced approval gate in UI found | PI (naming overstates) |
| Inbox | full | VI |
| Retries and timeouts | manual retry UI; auto retry server-side | VI (UI) |
| Git hosts GitHub/GitLab/Gitea/Forgejo | settings Code tab | CID |
| Roles, guest access | guest mode gates in rail, issue sidebar (`issue-detail.tsx:444`), mobile `use-is-guest.ts` | VI |
| Channels: Slack, Feishu/Lark, DingTalk, WeCom, Telegram, WeChat | settings Channels + bind pages | CID |
| Web, desktop, mobile "the same workspace" incl. iPad (README) | iPad: `supportsTablet: true` (app.config.ts:38). Mobile lacks agents (stub "coming soon"), runtimes, autopilots, squads, skills, usage | PI (mobile is a subset) |
| Desktop connects its computer as runtime automatically | `main/daemon-manager.ts` | VI |
| Analytics "page in the sidebar" (analytics.mdx) | route `/usage` under Team space | VI |
| Failure reason reference (tasks.mdx:95+) | UI handles codes not in docs: `runtime_access_denied`, `skill_bundle_unavailable`, `invalid_task_identity`, `runtime_cli_timeout`, `codex_resume_oversized`, `local_directory_error`, `runtime_reconnect_timeout` (0 doc hits each) | Docs lag |
| Triage page (server flag comment only, not in docs) | no client page | M |

Claimed features not found implemented in the UI: (a) an enforced "review gate" beyond the `in_review` status; (b) mobile agents ("coming soon" stub); (c) Triage page referenced by the server flag. Everything else in README has a corresponding UI surface.

---

## 5. FACTS — E2E coverage of core flows (`e2e/`, 52 specs)

Covered: auth (4), issues CRUD/filters/table/duplicate/display (≈20 tests across 12 specs), comments (2), comment steering (1, two providers), comment agent routing (1), issue task history (1), issue wakeups (2), timeline scroll (4), inbox delete (2), onboarding (5), settings (4), navigation/rail/pinning (5), runtime sharing (1), agent MCP (2), agents search (2), chat attachments (1), skills intro (1), quick actions (1), weixin (1), local search (5).
Heavy on edge/regression UI: html preview/iframe/attachments/pdf/shimmer (~25 tests). Docs feature (default-off) has the largest spec (10 tests); plugin surface (default-off) 5.
**Not covered end-to-end:** agent creation (manual or AI builder), assign→run→complete with streamed transcript, cancel/rerun buttons, chat send + streaming reply, autopilots, squads, usage dashboard, PR linking, desktop app (no Electron e2e found), mobile (no e2e).

---

## 6. JUDGMENTS

### 6.1 Overall
- The client surface is very large for the product's core loop (assign issue → agent runs → watch → review). ~247k non-test LOC in `packages/views` alone, ~84k lines of locale JSON in 8 languages, plus a 30k-LOC marketing site living inside `apps/web`. The core loop is well implemented and thoughtfully engineered (bounded streaming, redaction, failure taxonomy, steering receipts).
- Web and desktop parity is excellent because routes are thin wrappers over shared views; desktop adds genuine value (bundled daemon, local folders, tabs).
- Mobile is a separate re-implementation (own API client, schemas, realtime) of a subset; it duplicates logic (failure labels, transcript building) that already exists in core/views. Classification: optional; maintenance cost is high relative to coverage.

### 6.2 Redundant / duplicate surfaces
- Run visibility exists in ≥6 places: header chip, inline comment run, execution log section, Runs dialog, transcript dialog, agent detail task list (+ team panel "working", chat pill). Each is justified individually, but Execution log vs Runs dialog overlap is largest (both list runs + cost charts + retry).
- Issue detail vs issue peek vs desktop issue window vs list-row peek.
- Chat page vs floating chat.
- Issues vs My issues vs saved Views vs sidebar pinned/views sections.
- Usage in 3 places: `/usage`, runtime usage section, issue Runs dialog.
- Settings URL-compat remapping (`settings-navigation.ts`) and four permanently-on compat feature keys (`keys.go:59-77`) show accumulated churn.

### 6.3 Unnecessary / speculative for the core product (in this repo's default build)
- Default-off code paths shipped to all clients: Billing (2,780-LOC tab), Plugins, Composio Apps, Docs (routes + editor + 10 e2e tests), live description collaboration, Triage server flag without UI. Combined these are several thousand LOC of UI that a self-hoster never sees.
- What's-new deck, star prompt, dev toolbar in shared views, theme store, voice input: polish/marketing, not core.
- Gantt and swimlane views (1.9k LOC swimlane) beyond board/list/table.

### 6.4 UX concerns
- **Cost is a client-side estimate** from a hard-coded price table in a views util plus a per-browser custom pricing store; two viewers can see different costs for the same run, and prices go stale with releases. Should be server-side.
- **`task:message` broadcast to every workspace client** with client-side filtering — a scaling and least-privilege concern (transcript content of runs a user may not be allowed to see reaches their socket). Worth confirming server-side authorization of the broadcast.
- Issue detail sidebar has 14 configurable sections, settings ~18 tabs/~90 rows: high configurability, high cognitive load for new users.
- Mobile "Agents coming soon" screen is a dead registered route; stale comment in `more.tsx`.
- "Review gates" wording in README overstates what is a status convention.
- Giant components (`issue-detail.tsx` 4.7k, `client.ts` 6.7k) are change-risk hotspots.

### 6.5 Classification summary
- **Core:** issues (list/board/table), issue detail + execution log + transcript + steering/cancel/retry, assign-to-agent, agents directory/detail/manual create, runtimes (+ desktop daemon), inbox, chat page, projects, skills, usage dashboard, onboarding, members/roles, PR display (integration-dependent).
- **Optional:** squads, autopilots, AI agent builder, channels, VCS other than GitHub, saved views, gantt/swimlane, mobile client, Qoder/cloud runtime nodes, MCP/env advanced tabs.
- **Redundant:** Runs dialog vs execution log overlap; floating chat vs chat page; my-issues vs filters/views; multiple usage surfaces.
- **Unnecessary (for default build):** default-off billing/plugins/composio/docs UI, whats-new/star-prompt, dev-toolbar shipped in shared views, triage flag without UI, compat flags.
