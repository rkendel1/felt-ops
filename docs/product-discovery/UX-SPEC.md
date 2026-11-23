# UX specification

The experience is designed around the delegator's loop (delegate → watch or ignore → answer →
review), not around Multica's feature list. No mockups yet: this is the specification to
evaluate first.

## 1. Information architecture

Four top-level surfaces:

| Surface | Job | Replaces in Multica |
|---|---|---|
| **Desk** (home) | "What needs me, what is moving" | Inbox, my-issues, dashboard, runs dialog |
| **Work** | All requests and their state; create new work | Issues list/board/table, projects |
| **Agents** | Who can do work, and where it runs | Agents, runtimes, machines, skills |
| **Settings** | Members, repositories, authority, credentials | ~18 settings tabs |

Work detail (with the run inside it) is a page reached from Desk and Work. There is no separate
runs page, chat page, squads page or usage page in v1. A run is always seen in the context of
the work it serves.

Deep links: `/w/<workspace>/work/<number>`, `…/work/<number>/runs/<n>`, `/w/<workspace>/agents/<key>`.

## 2. Desk

- **Purpose:** the one place a delegator checks. It replaces notifications as the primary
  queue. Notifications point here.
- **Primary information (derived queries, not stored state):**
  1. **Needs you**: open questions, results awaiting your review, runs paused on conflict,
     stalled or failed runs on work you requested. Each item shows the work title, the agent,
     why it is here, and how long it has waited.
  2. **In flight**: active runs on your work: agent, phase, last event ("ran tests: 3 failed",
     40 s ago), and a liveness dot from the lease.
  3. **Recently finished**: accepted or closed in the last 7 days.
- **Actions:** answer inline (short answers), open the work, accept/review (opens review),
  retry or reassign a failed run.
- **States:** empty ("Nothing needs you. Delegate something →"), loading (skeleton rows), error
  (the query error with retry; never a blank page).
- **Permissions:** shows only your requests plus anything assigned to you as reviewer. An
  admin toggle shows everything in the workspace.
- **Records:** none of its own. Every row is a query over work, runs, questions and reviews.

## 3. Work (list)

- **Purpose:** see and filter all requests.
- **Primary information:** number, title, repository, state (`open`, `active`, `in-review`,
  `done`, `closed`), assigned agent, requester, current run phase, updated.
- **Views:** one table with state filter chips and a repository filter. No custom statuses, board
  variants or saved views in v1.
- **Actions:** **New work** opens a dialog:
  - objective (required);
  - acceptance criteria (a list, encouraged, shown to the agent and to the reviewer);
  - repository (required; only connected ones);
  - base branch (default branch);
  - agent (optional: without one the work stays `open`);
  - attachments.

  The dialog shows what the agent may do in that repository (from the agent's permissions)
  before submit.
- **States:** empty ("Connect a repository" first if none, else "Delegate your first piece of
  work"); loading; error.
- **Permissions:** members create and assign; anyone in the workspace reads.

## 4. Work detail (the central screen)

Layout: request on top; run panel below (the latest run by default, with a run switcher for
earlier attempts); history on the side.

### 4.1 Request

Objective, acceptance criteria, repository@base, requester, attachments, notes. Edits after a run
has started are recorded in history and offered to the running agent as an instruction ("Send
this change to the agent?"). Nothing is silently changed under a running agent.

### 4.2 Run panel: live

- **Header:** agent (definition @ commit), runner, attempt *n*, phase (`queued`, `running`,
  `needs-input`, `paused`, `stopping`, `stalled`, `submitted`, `failed`, `stopped`), lease
  liveness ("last heard 12 s ago"), elapsed time and reported token usage (labelled "reported by
  runner").
- **Event stream:** turns, tool calls (collapsed by default), commands with exit codes, files
  changed, test runs. It follows the live end, with a "jump to now" control. Events are labelled
  as the agent's report.
- **Controls** (always visible while non-terminal):
  - **Instruct**: a composer. After sending, the instruction shows *received*, then
    *delivered*, then *incorporated* (with the agent's note) or *conflict* (the run pauses and
    the note is shown).
  - **Pause / Resume.**
  - **Stop**: confirmation, with the consequence: "The agent stops at its next step. Work
    already pushed stays on branch …".
- **needs-input:** the question is pinned above the stream with an answer box. The answer is
  delivered as an instruction.
- **stalled:** "The runner stopped responding at 14:02. It will be retried on another runner
  (attempt 2 of 3)", plus Stop and Reassign.
- **failed:** the reason (closed set) in plain language, the detail, and Retry (same agent) or
  Reassign (another agent or a person).

### 4.3 Run panel: result and review

Shown when the run is `submitted`. Two columns:

| The agent says (claims) | Observed (GitHub) |
|---|---|
| summary, claimed test results, branch, head commit | branch head commit (matches? ✓/✗), PR link and state, checks (pending/passing/failing), mergeability |

- Diff: summary of changed files, with a link to the PR for the full review on GitHub (v1 doesn't
  rebuild a code-review tool).
- **Actions:**
  - **Accept** (enabled only when the observed head matches the claim). Options: merge now (as
    you, via the app) or accept without merging.
  - **Request changes** (note required). Creates a new run with your note as its first
    instruction, on the same branch.
  - **Reject** (note required). The work returns to `open`.
- **Permissions:** any member may review, except that the requester can be required as reviewer
  by a workspace setting (Phase 2).

### 4.4 History

The audit trail: who did what, with `source` badges (System, Agent, GitHub, Person). Filters:
all / decisions only.

### 4.5 Empty, loading, error

- **No run yet:** "Assign an agent" with the agent picker.
- **Loading:** skeleton.
- **Error:** inline with retry. A missing runner shows "No runner can take this agent right now:
  queued".

## 5. Agents

- **Purpose:** know who can do work and whether they can run now.
- **List:** agent name, purpose, definition (repo@commit), model, permitted repositories,
  status (`active`/`suspended`), runs in flight, last 30 days (submitted / accepted / failed:
  derived).
- **Agent detail:**
  - **What it may do:** repositories, branch rule, capabilities. The authority is explained
    from the platform's own rules, not a hand-kept copy.
  - Recent runs.
  - Suspend or resume, with a reason. Suspending stops new claims; in-flight runs continue
    unless you also stop them (offered).
- **Runners** (section on the same page):
  - Each runner shows status (online / draining / offline, from heartbeat), version, capacity,
    hosted agents and current runs.
  - Admins can drain a runner (finish current, claim no more) or revoke it (its session ends
    and its runs stall and move elsewhere).
- **Register agent** (admin): a definition reference, model reference, repositories, owner.
- **Register runner** (admin): issues a runner session token once, with copy-once display and
  setup instructions.
- **Empty:** "No agents yet: register one from the template definition" and "No runner online:
  agents can't run".

## 6. Settings

- **Members:** invite, change role, remove (removal ends their workspace access).
- **Repositories:** connect via the GitHub App. On connect the app checks that the default branch
  has a protection ruleset and **refuses** without it (with the fix).
- **Authority:**
  - who may review;
  - maximum attempts;
  - run time budget;
  - later, which agent actions require approval (E-2).
- **Credentials:** references only (GitHub App, model refs). Values are never displayed.

## 7. Notifications

The in-app inbox (FeltKit notifications) carries: question asked, review needed, run failed or
stalled, and instruction conflict. Each links to the exact place on the work detail. There is no
e-mail in v1 (FeltKit sends e-mail only for account mail).

## 8. Principles applied

- The run is shown once, in context: no parallel run surfaces.
- Claims and facts are visually distinct everywhere they appear.
- Every control states its real consequence (stop is cooperative; a push may already have
  happened).
- Liveness is a fact from leases, not an inference from the agent's last write (felt-ops F-047).
- No action requires leaving the app, as Studio did for felt-ops approvals. The single
  exception is code review on GitHub, which is deliberate.
