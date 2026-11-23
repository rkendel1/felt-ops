> Working notes from a read-only audit pass (2026-11-23). Produced by an audit agent from source, SQL, tests and docs; the discovery author spot-checked the claims used in decisions (see ../DECISIONS.md, "Verification of audit notes"). Paths are relative to the audited repository unless absolute. Treat unverified rows as leads, not facts.

# Audit A: Core work model and tenancy (Multica)

Scope: workspaces/tenancy, auth, members/roles/guests/invitations/seats, projects (private, members, resources), issues and everything hanging off them, assignee to agent trigger contract, CLI and public API, PATs, security boundaries, and the persistence/event model.

Method: read router, middleware, handlers, services, sqlc queries, migrations and test names. README/docs were read only to know the claims. All paths are relative to `/home/user/multica`. Line numbers are from the snapshot audited on 2026-11-23.

Convention: **Fact** means verified in code (file:line). **Judgment** is my assessment and is labelled.

---

## 0. Size and cost baseline (measured with `wc -l`)

| Area | Non-test LOC | Test LOC |
|---|---:|---:|
| Whole Go server (excl. sqlc generated) | 390,338 | 571,015 |
| `server/internal/handler/*` (all) | 102,507 | 173,137 |
| `server/internal/service/*` (all) | 28,457 | 29,561 |
| Handlers: workspace/auth/session/member/invitation/guest/PAT/seat/admission/actor_guards | 6,597 | 10,698 |
| Handlers: project*, vcs*, github* | 8,077 | 9,481 |
| Handlers: issue*, label, property, subscriber, reaction, comment, activity, search, doc, file, attachment, share_link, pin | 31,805 | 46,396 |
| of which issue_wakeup/issue_trigger handlers | 1,249 | 1,623 |
| Services issue* (incl. issue_wakeup*) | 5,655 | 5,119 |
| issue_wakeup service only (non-test) | 4,159 | ~4,077 |
| Packages issuestatus, issueworkflow, issueproperty, issueposition, issueguard, projectaccess, seatcapacity, auth, middleware | 7,404 | 6,990 |
| events + realtime + eventcontract | 3,656 | 2,928 |
| CLI (`cmd/multica` + `internal/cli`, incl. daemon commands) | 33,577 | 37,493 |
| `pkg/publicapi` | 409 | 339 |
| sqlc queries in scope (37 files: workspace, member, invitation, PAT, user, seat, project*, issue*, comment, activity, subscriber, reaction, attachment, doc, search_index, vcs, github, share_link, pin, wakeup*) | 7,284 SQL | — |
| `cmd/server/router.go` | 3,137 | — |
| Frontend `packages/views/{issues,issue-views,projects,labels,members,invitations,workflows,my-issues,search,workspace,auth,settings}` | 95,587 | 68,595 |
| Frontend `packages/core/{issues,issue-views,issue-statuses,issue-workflows,projects,labels,properties,permissions,search,search-index,workspace,auth,realtime,pins,api}` | 33,716 | 30,882 |
| All `packages/views` / all `packages/core` | 247,683 / 72,511 | 184,914 / 54,703 |
| `apps/mobile` (all ts/tsx) | 39,299 | (mixed) |

Rough total for the core work model + tenancy (backend handlers+services+packages+queries+CLI share, frontend core/views subset): **~150k non-test LOC backend+frontend, ~200k test LOC.** The single largest files: `internal/handler/issue.go` 5,418, `comment.go` 4,349, `workspace.go` 1,650, `issue_table_group.go` 1,205.

Migrations: **755 up migrations** (latest `731_skill_revision`; numbering has gaps/reuse). Filename hits: issue 139, workspace 68, comment 40, status 26, project 24, wakeup 34, member 13, search 12, label 10, workflow 9.

Accumulated complexity markers (facts):
- **42 distinct DB triggers** created across migrations (`grep CREATE TRIGGER`), incl. wakeup capture (`capture_comment_wakeup`, `capture_task_wakeup`, `capture_issue_collaboration_wakeup`, `stop_issue_wakeups`, `guard_issue_wakeup_capacity`), search-index change capture (`trg_issue_search_index_change`, `trg_comment_search_index_change`, `trg_project_search_index_change`), dashboard dirty markers, `issue_child_event_insert/update`, plugin append-only guards.
- **5 backfill packages** (`internal/attributionbackfill`, `chatoriginbackfill`, `delegatedrecoverybackfill`, `issueactivitybackfill`, `taskusagebackfill`) and **4 backfill commands** (`server/cmd/backfill_*`); 20 migrations with "backfill" in the name.
- Feature flags (`server/internal/featureflags/keys.go`): 8 live flags + 4 permanently-on "compat" keys published only for old desktop clients (`agents_agent_builder`, `agents_skill_toggles`, `settings_resource_labels`, `project_workflows_v1`, keys.go:63-77, 120-124).
- Legacy FKs: 39 migrations contain `REFERENCES`; `001_init` alone has 19. The repo rule forbids FKs; `pkg/db/queries/workspace_delete.sql:1-3` says "the legacy foreign keys remain only as a compatibility safety net during the expand phase".
- Compat wire shims: `issuestatus.WireCategory` projects custom statuses to the legacy 7-value enum (issuestatus.go:1-10, handler/issue.go:49); X-Workspace-ID header kept "CLI/daemon compat" (middleware/workspace.go:58-60,112).

---

## 1. Tenancy: workspaces

- **User problem**: separate teams' issues, agents, settings.
- **Who**: every user; owners/admins manage.
- **Trigger / workflow**: `POST /api/workspaces` (any authenticated user, router.go:1897-1898) creates workspace + owner member. Workspace identity per request resolved by slug header/query, URL param, or `X-Workspace-ID` (middleware/workspace.go:105-152). `buildMiddleware` then loads `member` row and enforces role (workspace.go:197-271).
- **State**: `workspace` (name, slug, settings JSONB, context, `repos` JSONB, `issue_prefix`, `issue_counter`, `attribution_fail_closed`; models.go:2285-2300), `member`.
- **Authoritative**: `workspace`, `member` rows. Redis `MembershipCache` (existence only, TTL 5 min, auth/membership_cache.go:14-30) is a cache; invalidated on member update/delete/leave/workspace delete (handler/workspace.go:839,930,975,1335-1344).
- **Failure**: unknown slug → 404; no identifier → 400; non-member → 404 (no existence leak) (workspace.go:200-247). Task-token requests are pinned to their stamped workspace (workspace.go:209-222, MUL-2600).
- **Delete**: owner-only (`router.go:2002`); application-owned bottom-up delete plan of 41 statements with advisory locks and teardown-mode trigger suppression (`queries/workspace_delete.sql`).
- **Classification (judgment)**: core.
- **Label**: Verified implemented. Tests: `internal/middleware/workspace_test.go`, 12 `internal/handler/workspace*_test.go` files.

## 2. Authentication

### 2.1 Email code + JWT cookie sessions
- Facts: `SendCode`/`VerifyCode` (handler/auth.go:320, 412); `checkSignupAllowed` order: email allowlist → domain allowlist → `ALLOW_SIGNUP` open → pending invitation implicitly allows signup → reject (auth.go:268-305).
- Token transport: `Authorization: Bearer` (PAT/JWT) or HttpOnly `multica_auth` cookie with CSRF for state-changing requests (middleware/auth.go:36-37, 307-318).
- Sessions are **stateless JWTs with sliding renewal; no server-side session record and no revocation** — "logout clears the cookie; the token itself stays valid until exp" (internal/auth/session.go:13-27).
- Classification: core. Label: Verified implemented. Judgment: lack of revocation is a material gap for a tool that lets credentials drive agents; a stolen cookie survives logout.

### 2.2 Google OAuth
- Facts: `GoogleLogin` (auth.go:571) reads `GOOGLE_CLIENT_ID/SECRET` from env (auth.go:583-584).
- Label: **Configured-integration-dependent**. Classification: optional.

### 2.3 Personal access tokens (`mul_`) and other bearer prefixes
- Facts: PAT table `personal_access_token(user_id, name, token_hash, token_prefix, expires_at, revoked, last_used_at)`; lookup by hash, not revoked, not expired (queries/personal_access_token.sql:1-10). Create/list/renew/revoke in handler/personal_access_token.go:64,121,167,263. Redis PAT cache TTL 10 min (auth/pat_cache.go:19); revoke invalidates cache (personal_access_token.go:282). Middleware branches by prefix: `mcn_` cloud node PAT (auth.go:169), `mul_` PAT (auth.go:210), else JWT. Plus daemon tokens, task tokens, plugin `mpi_/mpc_` tokens elsewhere.
- **PATs carry no workspace or permission scope**: the row has only `user_id`; a PAT authenticates as the full user across all their workspaces with the user's role. Null `expires_at` = never expires for legacy tokens (personal_access_token.go:208-210).
- Used by CLI (`multica login --token`) and daemons.
- Classification: core (CLI/daemon depend on it). Label: Verified implemented. Judgment: unscoped, account-wide bearer tokens are the main blast-radius risk of the tenancy model.

## 3. Members, roles, invitations, share links, guests, seats

### 3.1 Roles
- Facts: `member.role` CHECK `owner|admin|member|guest` (migrations/699_member_guest_role.up.sql:11); invitations allow `admin|member|guest` (:16). Lookups refuse unknown roles (queries/member.sql:16-22). Route-level role gates: admin group (router.go:1945-1999), owner-only delete (router.go:2002). Owner changes require owner; at least one owner kept (handler/workspace.go:792-805).
- Resource-level rules in handlers, e.g. issue delete: owners/admins any; members only issues they or their agents created; agents only issues they created and never inherit their token user's rights (handler/issue_delete_permissions.go:10-14); same for projects (project_delete_permissions.go:9-11). Ordinary issue edits are open to any member who can see the issue (no per-issue ACL; inferred from absence of role checks in UpdateIssue path — judgment, not exhaustively verified).
- Frontend mirror: `packages/core/permissions/rules.ts` (+ `rules.test.ts`).
- Classification: core. Label: Verified implemented.

### 3.2 Invitations
- Facts: create (admin) handler/invitation.go:63; list/revoke 309/357; my invitations/accept/decline 465/511/746; routes router.go:2146-2149. Rate limiter `invitation_rate_limiter.go`.
- Classification: core. Label: Verified implemented. Tests: `invitation*_test.go` (1 file) plus guest acceptance tests in `guest_boundaries_test.go:689`.

### 3.3 Share links (join by link)
- Facts: admin-created; role `member` or `admin` (handler/share_link.go:81-87); expiry optional (1..max hours) and `max_uses` optional (share_link.go:94-112); `POST /api/share-links/join` (router.go:2150), public info `GET /api/share-links/{code}` (router.go:1696).
- Judgment: an admin-role link with no expiry and no use cap is a bearer grant of admin; consider forbidding admin links or forcing expiry. Classification: optional. Label: Verified implemented.

### 3.4 Guests (project-scoped external collaborators)
- Facts: guests are `member` rows with role `guest`. **Deny-by-default route allowlist** (`internal/middleware/guest.go:14-120`) enforced in the workspace middleware (`workspace.go:248-251`); a set of shell reads return empty bodies instead of 403 (guest.go:123-147). Row narrowing by `projectaccess`: a guest sees only projects it is a member of and nothing outside a project (`internal/projectaccess/projectaccess.go:11-14`). Guests may comment/react/subscribe, but not mention agents/squads/@all (handler/guest.go:89-115). Release gating: self-host always on; cloud requires `billing_workspace_subscriptions` flag + plan feature, failing closed (handler/guest.go:37-76; `cmd/server/guests_release_router_test.go:19`).
- Tests: `guest_test.go`, `guest_access_test.go`, `guest_boundaries_test.go` (20 tests e.g. `TestGuestCommentMentionRuleCoversCreateAndEdit` :408, `TestRoleChangeDecidedOnStaleRoleIsRefused` :809, `TestSearchIndexRebuildsAfterGuestAccessNarrows` :591), `guest_plan_test.go`.
- Classification: optional (valuable for agencies/clients). Label: Verified implemented; on cloud **Configured-integration-dependent** (plan).

### 3.5 Seat capacity and member limit
- Facts: `seat_capacity_outbox` durable intent table for Cloud's pre-purchased seat protocol (migrations/415_seat_capacity_outbox.up.sql:1-30; actions reserve/consume invitation, claim share join, confirm, release); worker `internal/seatcapacity/worker.go`. Free-plan member limit counts members + pending invitations; guests take no slot; "Off skips the check ... which is also the self-hosted behavior" (handler/member_limit.go:17-31).
- Classification: optional (commercial only; zero effect self-hosted). Label: **Configured-integration-dependent** (Multica Cloud).

## 4. Projects

### 4.1 Projects core
- Facts: `project` row: title, description, icon, status, priority, lead (polymorphic), dates, `workflow_id`, `visibility`, archive fields, `folder_id` (models.go:1723-1745). Routes router.go:2445-2470 (CRUD, archive/restore, workflow, members, subscription, resources). Delete permission: project_delete_permissions.go. Project folders are in `server/ee/projectfolder` (commercial license, separate sqlc package; sqlc.yaml:21-30).
- Classification: core. Label: Verified implemented. Tests: 14 `project*_test.go`.

### 4.2 Private projects and project members
- Facts: single rule source `internal/projectaccess` (projectaccess.go:1-19): private project visible only to its `project_member` rows; **workspace owner/admin get no implicit visibility** (MUL-9284); an agent run sees a private project only if both triggering human and agent owner can (`ForPrincipals` :156, `RunPrincipals` :206). Issue load path enforces it: `loadIssueForUser` → `requireProjectVisible` → 404 (handler/handler.go:1108-1162). SQL predicates use hidden-project lists in issue/inbox/label/unread/search_index/wakeup queries (e.g. `queries/inbox.sql` 14 refs). Realtime fan-out narrowed to project members (`cmd/server/private_project_realtime.go`). 32 non-test Go files call `projectaccess.`. Dynamic issue-table SQL injects a hidden-projects predicate (handler/issue_table_query.go:188-200, 514-519). Owner-recovery path exists (`project_owner_recovery.go`, `queries/project_owner_recovery.sql`).
- Tests: 10 `private_project_*_test.go` in handler (e.g. `TestPrivateProjectIssueDetailMatrix` private_project_test.go:91, `TestPrivateProjectEnqueueNeedsAgentOwnerAccess` :449, `TestPrivateProjectInboxSkipsOutsiders` :485) + 3 in cmd/server (realtime, routes).
- Classification: optional-but-important. Label: Verified implemented.
- Judgment: correctness depends on every query remembering the hidden predicate (filter-in-every-query model rather than RLS). Test coverage is broad, but this is the highest-risk surface for future leaks because the issue table builds SQL by hand outside sqlc.

### 4.3 Project resources / repositories / VCS linkage
- Facts: `project_resource(resource_type, resource_ref JSONB, label, position)` (models.go:1765-1775); allowed types only `github_repo` and `local_directory` (handler/project_resource.go:74-86), local_directory with in-place/worktree modes and daemon capability checks (project_resource.go:118-140, 590). Separate **workspace-level** `workspace.repos` JSONB (models.go:2294) feeds the daemon allowlist (`internal/daemon/daemon.go:1584,3490,4135`). VCS connections (GitHub App installations, Forgejo/Gitea/GitLab) are admin-managed (router.go:2004-2021); issue↔PR links via `/api/issues/{id}/pull-requests` (router.go:~2318).
- Judgment: two places to declare repositories (workspace repos + project resources) is redundant/confusing; resources were "lifted into resp.Repos by the claim handler" (daemon.go:3490), i.e. merged at claim time.
- Classification: core for agent coding use. Label: Verified implemented (GitHub/VCS integrations are Configured-integration-dependent).

## 5. Issues

### 5.1 Issue entity and create/update
- Facts: `issue` columns (models.go:1107-1140): title, description, status (TEXT key), priority, polymorphic assignee (`assignee_type` ∈ member|agent|squad, migrations/084_squad.up.sql:31-33), creator (polymorphic), parent_issue_id, acceptance_criteria, context_refs, position, due/start dates, number, project_id, origin_type/id, first_executed_at, metadata JSONB, stage, properties JSONB, revision, last_activity_at, triage_state, duplicate_of_issue_id, requester_user_id, description_revision.
- Create: `handler/issue.go:3310` → workflow resolution (issue.go:~3418-3470) → `IssueService.Create` with tx (service/issue.go:233-595): number allocation via `workspace.issue_counter`, labels/properties validated in tx, then **commit, then** link attachments, publish `issue:created`, analytics, and enqueue agent run (service/issue.go:593-645).
- Number collisions: counter can trail MAX(number); service detects unique violation and heals on committed path; otherwise returns `issue_number_collision` asking an admin to repair (service/issue_counter.go:17-57; handler/issue_number_collision.go:10-22). Judgment: evidence that the counter has drifted in production.
- Update: optimistic `revision`, field-level raw JSON handling (`refreshUntouchedNullableIssueParams`, `updateIssueAtomically`, issue.go:~3818-3854).
- Assignee validation: member must be workspace member (guests included because lookup accepts guest); agent must be in workspace, not archived, and invocable by actor (`validateAssigneePair`, issue.go:4476-4520).
- Classification: core. Label: Verified implemented. Tests: 77 `issue_*_test.go` in handler; e2e `issues.spec.ts`, `issue-table.spec.ts`, etc.

### 5.2 Statuses and custom status workflow
- Facts: per-workspace catalog `issue_status(key, name, category, color, icon, is_system, position, archived_at)` (models.go:1327-1341). 7 fixed built-in keys and 4 lifecycle categories (internal/issuestatus/issuestatus.go:27-43). Custom statuses inherit lifecycle only, not built-in parking/review/failure behaviors (issuestatus.go:1-10). `issue.status` stores the key as TEXT with no FK.
- Workflows (`issue_workflow`: name, initial_status_key, steps JSONB, is_default, owner_id; models.go:1456-1467) select/ordered statuses per project; todo/done/cancelled mandatory; each step can hand off to none/agent/squad/member/project_lead/creator (internal/issueworkflow/issueworkflow.go:1-43). Once a stored Default exists it limits status writes even outside projects (issueworkflow.go:15-19).
- Routes router.go:2377-2402. Tests: 6 `issue_status*_test.go`, 2 `issue_workflow*_test.go`, `issuestatus/*_test.go` (lifecycle, mixed categories), `issueworkflow_test.go`.
- Classification: status catalog core; workflow handoffs optional. Label: Verified implemented.
- Judgment: two overlapping concepts (status catalog + workflow-of-statuses + legacy 7-value wire enum + category projection) is significant cognitive and code load; `Effective()` is called on hot paths (service/issue_trigger.go:131-132) to map custom keys.

### 5.3 Labels, custom properties, metadata
- Facts: labels CRUD router.go:2364-2373; attach/detach per issue :~2312. Custom properties: `/api/properties` definitions (router.go:2354-2361; no delete route), values set per issue `PUT /api/issues/{id}/properties/{propertyId}` stored in `issue.properties` JSONB, validated with definition locks in UUID order (service/issue.go:648-722). Free-form `issue.metadata` key/value (router.go:~2315).
- Classification: labels core; properties optional; metadata optional (agent scratch). Label: Verified implemented.

### 5.4 Sub-issues, parents, duplicates, triage
- Facts: `parent_issue_id`; cycle check walks **at most 10 ancestors, outside a transaction** (handler/issue.go:4142-4153). `issue_child_event` rows written by DB triggers in the writing transaction drive parent wakeups; processed post-commit with sweeper retry (migrations/558_issue_child_event.up.sql:1-12). Duplicates: `duplicate_of_issue_id`, active-duplicate guard (`internal/issueguard/duplicate.go`) returns 409 `active_duplicate_issue` on create (issue.go:3645-3655). Triage: `triage_state`, flag `triage_v1` default off (featureflags/keys.go:32,100).
- Judgment: cycle detection is bounded and racy (two concurrent re-parents could form a cycle, and chains >10 escape the check). Low likelihood, but no DB invariant backs it.
- Labels: sub-issues Verified; duplicates Verified; triage Documented-in-code but **flag default off** (Partially released).
- Classification: sub-issues core; duplicates optional; triage optional.

### 5.5 Comments, threads, reactions, subscribers, activity/timeline
- Facts: `comment` (parent_id threads, resolved_*, source_task_id, quick_action_id, via_plugin_id, revision, recovery_settled_at, soft `deleted_at`, `suppressed_agent_ids`; models.go:742-763). Comment create can trigger agents (mentions / assignee routing; preview endpoint `comments/trigger-preview`, router.go:~2272). Admission contract: every enqueue answers queued/coalesced/deferred/blocked with enumeration-safe reason codes (handler/admission.go:9-52). Reactions on issues and comments (two tables: `issue_reaction`, `comment_reaction`). Subscribers (`issue_subscriber`), project subscribers. Timeline `GET /api/issues/{id}/timeline`.
- Activity log: written by **in-process event-bus listeners after commit**, not in the write transaction (`cmd/server/activity_listeners.go:10-40`); a failed insert is only logged.
- Classification: comments/subscribers/activity core; reactions optional. Label: Verified implemented. Tests: 24 `comment*_test.go`, 5 `subscriber*_test.go`, `cmd/server/comment_*_integration_test.go`.

### 5.6 Attachments, docs, live description
- Facts: attachments via `/api/upload-file`, `/api/attachments/*` (router.go:1890-1894, 2556-2558); storage backend in `internal/storage`. Docs: `/api/docs`, `/api/doc-folders` gated by `docs_v1` **default off** (featureflags/keys.go:44,106; router.go:2407-2443), version history in `doc_collab.go:57-130`; real-time co-editing uses a separate Node service `apps/collab` (Dockerfile.collab). Live issue description editing gated by `issue_description_live` **default off** (keys.go:51,109).
- Classification: attachments core; docs optional; live description optional.
- Labels: attachments Verified; docs and live description **Partially implemented / flag-gated off by default and dependent on collab service** (Configured-integration-dependent).

### 5.7 Search, views, issue table
- Facts: server search uses `LOWER(col) LIKE '%…%'` with pg_bigm/pg_trgm GIN indexes and an 8 s statement timeout; issue search is "candidate-first" scanning each workspace's issues/comments (handler/search.go:17-31). Local search index for web/desktop (`/api/search-index/*`, flag `local_search_index` default on) fed by DB triggers on issue/comment/project changes. Saved views `/api/issue-views` (router.go:2537-2548), per-user view preferences. Issue table endpoints `/api/issues/table/{groups,rows,facets}` build **hand-written dynamic SQL** outside sqlc (handler/issue_table_query.go 923 LOC, issue_table_group.go 1,205 LOC).
- Classification: search core; saved views optional; issue table core UI. Label: Verified implemented. Tests: 10 `search*_test.go`, 13 `issue_table*_test.go`, e2e `local-search.spec.ts`, `issue-table.spec.ts`.
- Judgment: two search systems (server LIKE + client local index with trigger-fed change log) plus dynamic SQL is costly; the comment itself records user-visible hangs (MUL-4059, MUL-7146).

## 6. Assignees and the agent trigger contract

- Facts: `WillEnqueueRun` is the single predicate shared by write paths and preview (service/issue_trigger.go:90-240). Rules: only agent/squad assignees run; sources are create/assignee change ("assign") or backlog → active status ("status"); **backlog parks work**, Triage refuses, done/cancelled never start (issue_trigger.go:131-161); agent must exist, be unarchived, have a runtime, be invocable; self-loop and duplicate-pending suppression; squads route to the leader after readiness check (issue_trigger.go:163-236). DB partial unique index on pending (issue_id, agent_id) coalesces duplicates (comment at :101-114).
- Workflow handoffs: entering a workflow step can reassign to the step's handler and start a run with step instructions (issueworkflow.go:9-13; `EnteredHandoffStep`).
- **Enqueue is post-commit and best-effort**: after `tx.Commit` the service calls `maybeEnqueueOnAssign`; on error it only logs `"enqueue agent task on create failed"` (service/issue.go:593-645, 948-990). I found no reconciler that re-enqueues assigned-but-never-queued issues (grep for such a sweep found none). A blocked runtime gets an explanatory note on the issue (`noteRuntimeUnusable`, issue.go:962-967), but a transient DB error or crash between commit and enqueue leaves an assigned issue silently idle.
- Wakeups (issue_wakeup): agent-authored or user-authored rules (event/timer/cron/condition, max fires, expiry) captured **transactionally by DB triggers** into `issue_wakeup_receipt` (migrations/518_wakeup_event_capture.up.sql:1-30); auto-stopped when the issue closes (`stop_issue_wakeups`). 34 wakeup migrations, ~4.2k LOC service + 541 SQL; 30+ wakeup test files.
- What a human must see/control: preview endpoints (`/api/issues/preview-trigger`, comment trigger preview), admission outcome codes, wakeup list/disable/enable/delete routes (router.go:~2283-2296), task cancel/rerun.
- Classification: assign→run is core (the product's reason to exist); wakeups optional/advanced. Label: Verified implemented; reliability gap noted. Tests: `service/issue_trigger_test.go`, `handler/issue_wakeup*_test.go`, `admission_mul4525_test.go`, `cmd/server/comment_trigger_integration_test.go`.

## 7. CLI and public API

### 7.1 CLI (`multica`)
- Facts: `server/cmd/multica` has ~45 command files: issue (status, label, metadata, batch, delete, timeline, wakeup, comment steer, PR auto-complete, run outcome), project, label, property, view, workflow, workspace, repo, squad, skill, agent, autopilot, chat, inbox, doc, runtime, daemon (+OS autostart), auth/login/setup/update. It is an HTTP client over the same internal `/api/*` routes (internal/cli/client.go) authenticated with PATs. Agents drive Multica through it (README line 118).
- Classification: core (agents depend on it). Label: Verified implemented. Note that 33.6k LOC also contains the daemon command surface.

### 7.2 Public API v1
- Facts: `pkg/publicapi/v1` defines 10 operations: `/context`, `/issues/{ref}` GET/PATCH, `/issues/{ref}/comments` GET/POST, `/tasks/{id}/messages`, `/storage/*` (routes.go:59-68). The registry lists `CredentialUserOAuth` and `CredentialPersonalAccess` as allowed credentials for the shared operations (routes.go:42-47), and the README says "User OAuth and PAT authenticate a member" (README.md:27-30). But the router mounts `/v1` behind `middleware.PluginBearerOnly`, which accepts only `mpi_`/`mpc_` plugin tokens (router.go:1803-1814; middleware/plugin_auth.go:16-47). Audit policy is `AuditPlanned` on every write (routes.go:60-68).
- So a stable public API for users and PATs does not exist yet. User scripting uses the unversioned internal `/api` with PATs.
- Classification: optional. Label: **Partially implemented** (plugin surface only; user/PAT surface and audit are documented but not wired).

## 8. Persistence and event model

- **In-process synchronous bus** (`internal/events/bus.go:46-120`): `Publish` runs listeners on the caller's goroutine and recovers from panics. No durability. Events are published **after** commit (e.g. service/issue.go:627).
- Projections fed by bus listeners (best-effort, post-commit): `activity_log` (cmd/server/activity_listeners.go), inbox notifications (notification_listeners.go), issue unread (issue_unread_listeners.go), subscribers (subscriber_listeners.go), WS broadcast; 21 `bus.Subscribe` calls across those four listener files.
- Projections fed by **DB triggers** (transactional): wakeup receipts, `issue_child_event`, search-index change log, dashboard dirty markers/rollups.
- Backfilled projections: `issue.last_activity_at` (`internal/issueactivitybackfill`, `cmd/backfill_issue_last_activity`), task usage hourly, attribution, delegated failure settled.
- Realtime: WS hub with Redis stream relay for multi-node (`internal/realtime/hub.go`, `redis_relay.go`, `sharded_stream_relay.go`), membership/private-project audience filters (`realtime/membership*.go`, `cmd/server/private_project_realtime.go`). Clients patch/invalidate TanStack Query caches (AGENTS.md rule; `packages/core/realtime`).
- Outbox: only `seat_capacity_outbox` (Cloud seat protocol). There is **no general transactional outbox** for domain events.
- `pkg/eventcontract` is a naming list for plugin/wakeup event types (events.go:1-40), not a durable event store.
- Authoritative tables: `workspace`, `member`, `user`, `personal_access_token`, `project`, `project_member`, `project_resource`, `issue`, `issue_status`, `issue_workflow`, `issue_label`(+join), property definitions, `comment`, `attachment`, `issue_subscriber`, reactions, `issue_wakeup`, `agent_task_queue`. Projections: `activity_log`, inbox items, unread, search index change log, dashboard rollups, `issue.last_activity_at`, wakeup receipts, child events.
- Judgment: the split (some projections transactional via triggers, others best-effort via in-process bus) means activity/inbox/realtime can silently miss events on crash or listener error, while wakeups cannot. A human looking at the timeline may see a status change with no activity entry. A transactional outbox would unify this.

---

## 9. Feature matrix (summary)

| Feature | Classification (judgment) | Label | Key evidence |
|---|---|---|---|
| Workspaces / tenancy middleware | core | Verified | middleware/workspace.go:197-271 |
| Email-code login + JWT cookie | core | Verified (no revocation) | handler/auth.go:320,412; auth/session.go:13-27 |
| Google login | optional | Config-dependent | handler/auth.go:571-584 |
| PATs (unscoped) | core | Verified | queries/personal_access_token.sql:1-10; middleware/auth.go:210 |
| Roles owner/admin/member | core | Verified | migrations/699:11; router.go:1945-2002; workspace.go:792-805 |
| Invitations | core | Verified | handler/invitation.go:63-746 |
| Share links (may grant admin) | optional | Verified | handler/share_link.go:81-112 |
| Guests | optional | Verified / plan-gated on cloud | middleware/guest.go:14-147; handler/guest.go:37-115 |
| Seat capacity / member limit | optional (commercial) | Config-dependent (Cloud) | migrations/415; handler/member_limit.go:17-31 |
| Projects | core | Verified | router.go:2445-2470 |
| Private projects + members | optional-important | Verified | projectaccess.go:1-19; handler.go:1108-1162 |
| Project folders | optional | Verified (ee/ commercial) | server/ee/projectfolder |
| Project resources (github_repo, local_directory) | core | Verified | project_resource.go:74-86 |
| Workspace repos JSONB | redundant w/ resources | Verified | models.go:2294; daemon.go:3490 |
| Issues CRUD, numbering | core | Verified (counter drift handling) | service/issue.go:233-645; issue_counter.go:17-57 |
| Status catalog | core | Verified | issuestatus.go:1-43 |
| Workflows + handoffs | optional | Verified | issueworkflow.go:1-43 |
| Labels | core | Verified | router.go:2364 |
| Custom properties | optional | Verified | service/issue.go:648-722 |
| Metadata KV | optional | Verified | router.go:~2315 |
| Sub-issues | core | Verified (bounded, racy cycle check) | issue.go:4142-4153 |
| Duplicates guard | optional | Verified | issueguard/duplicate.go |
| Triage | optional | Flag off by default | featureflags/keys.go:32 |
| Comments + threads + resolve | core | Verified | models.go:742-763 |
| Reactions | optional | Verified | reaction.go, issue_reaction.go |
| Subscribers / inbox | core | Verified | subscriber_listeners.go |
| Activity / timeline | core | Verified (best-effort projection) | activity_listeners.go:10-40 |
| Attachments | core | Verified | router.go:1890-1894 |
| Docs + collab | optional | Flag off by default; needs collab svc | keys.go:44; apps/collab |
| Live issue description | optional | Flag off by default | keys.go:51 |
| Search (server + local index) | core / redundant pair | Verified | search.go:17-31 |
| Saved views / issue table | optional / core UI | Verified | issue_table_query.go |
| Assign → agent run | core | Verified, post-commit best-effort | issue_trigger.go:90-240; issue.go:593-645,948-990 |
| Issue wakeups | optional/advanced | Verified | migrations/518; service/issue_wakeup.go |
| CLI | core | Verified | server/cmd/multica |
| Public API v1 | optional | Partially implemented (plugin-only) | routes.go:42-68 vs router.go:1803-1814 |
| Event bus / realtime | core infra | Verified (non-durable) | events/bus.go:94-120 |
| Outbox | — | Only for seat capacity | migrations/415 |

## 10. Key risks and judgments (ranked)

1. **Agent run on assign is not durable.** Enqueue happens after commit and failures are only logged (service/issue.go:593-645, 978-981). No reconciler. For a product whose core promise is "assign an issue and the agent takes it", this is the biggest correctness gap in my scope.
2. **Non-durable event projections.** Activity, inbox, unread and realtime run on an in-process synchronous bus after commit (events/bus.go:94; activity_listeners.go). Wakeups use DB triggers instead. Two consistency models live side by side.
3. **Account-wide unscoped PATs plus non-revocable JWT sessions** (personal_access_token.sql; session.go:21-27). Cache-based revocation lag up to 10 min (membership_cache.go:27-30).
4. **The private-project/guest boundary is enforced by convention in every query** (32 files, hand-built SQL in the issue table). It is well tested (14 private-project test files, 4 guest test files), but there is no database-level guarantee.
5. **The public API claims PAT/OAuth support it does not serve.** Write audit is "planned".
6. **Complexity load**: 755 migrations, 42 DB triggers, 5 backfill packages, 4 compat flags, status catalog plus workflow plus legacy wire enum, two repo declarations, two search systems, `issue.go` at 5.4k LOC, and a test/non-test ratio of about 1.5:1 server-wide. The issue counter needs self-healing, which means it has drifted before.
7. Minor: sub-issue cycle check is bounded at depth 10 and not transactional (issue.go:4142-4153). Admin share links can be created with no expiry or use cap (share_link.go).
