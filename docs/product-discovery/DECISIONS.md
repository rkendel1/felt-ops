# Decisions, evidence, assumptions and open questions

"Decision" here means a **recommendation made in this discovery**. None is authorized until the
owner approves it. Each decision cites its evidence.

## Decisions

| ID | Decision | Evidence | Alternatives rejected | Reversible by |
|---|---|---|---|---|
| D-01 | Build a **delegated-work system of record** for engineering teams, not a Multica clone or a general task tracker | MULTICA-AUDIT §3–4; Multica's value is concentrated in assign/run/steer/review, and its weaknesses are governance and evidence | Full tracker parity (enormous scope, adds no trust); CompanyOS extension (different job and users) | user research (U-02) |
| D-02 | **EVE as the execution runtime**: one runtime and many models, instead of 32 vendor-CLI adapters | B: `pkg/agent` 47.6k + daemon 56k lines in Multica; G: EVE has a durable session, steering, sandbox, event stream, coding/git packages | Re-implementing a daemon with vendor CLIs (ownership cost; no sandbox in Multica's model); in-process FeltKit `app.action` reasoner (no sandbox or command execution in app functions) | Phase 0 S1 outcome; U-04 |
| D-03 | **FeltKit app is the only control plane**. EVE is execution only and authoritative for nothing in the product | FELTKIT-BASELINE §1; EXECUTION.md "control plane authoritative; the computer is replaceable" | Using EVE's work store as the record (felt-ops lesson: two inboxes, two truths) | — |
| D-04 | Consequential effects in v1 are **person or application actions** (open PR = app; merge = person). Agents only push their own run branch and submit claims | F §3: approval of agent-owned actions is Studio-only (E-2); felt-ops operator eval: Studio fragmentation | Agent-proposed effects approved in Studio (fragmented); app-level re-implementation of approval (duplicates a platform guarantee) | E-2 delivered → Phase 3 |
| D-05 | **Claims, observations and person decisions are separate records** with an explicit `source` | felt-ops ARCHITECTURE §3 (`timeline.source`, `observedVia`) proven in 7 scenarios; Multica has no such separation (C) | Single activity log | — |
| D-06 | Runs use an **app-owned lease** (claim token, lease, attempts, CAS) mirroring `feltkit.execution/1`, **unless** Phase 0 S2 shows a bridge-surface invocation can be claimed remotely | F "Remote execution plane": no remote protocol; `#visible` admits only the requester or deliverer (`invocations.ts:262-267`, checked); remote use untested | Using invocations untested (risk of building on an unproven path); building a general remote protocol in the app (platform work in the wrong place) | S2; E-1 shipped |
| D-07 | Steering uses **FeltKit agent control** once published; interim `instructions` collection with identical states | F §3: implemented, 13 tests, unreleased (CHANGELOG "Unreleased: agent control") | Inventing a different lifecycle | S3 |
| D-08 | GitHub via `app.integration` (GitHub App, installation tokens, recorded calls) + verified inbound webhooks; **observations written by the calling job, not `onOutcome`** | F §7: no GitHub built-ins; G-09 open (`onOutcome` failures only logged); felt-ops `integrations.ts` pattern | Agent opens PRs itself with `gh` (no recorded evidence; needs broader token) | S4 |
| D-09 | Run events are **bounded evidence**, not an unbounded transcript archive | Multica truncates task messages too (C); FeltDB is the app's single store | Storing full model transcripts in the app | measurement in Phase 2 |
| D-10 | Run queueing happens **in the same transaction** as assignment | A: Multica's after-commit enqueue only logs on failure (`service/issue.go:975-983`, checked) | After-commit enqueue | — |
| D-11 | Repositories must have a default-branch protection ruleset to be connected | the agent's token is repo-scoped `contents:write`; the ruleset is the boundary that stops pushes to main | Trusting agent behaviour | — |
| D-12 | Not carried forward: squads, chat, IM adapters, plugins, Composio, Connected Apps, billing, guests, share links, docs editor, custom status catalogs, mobile and desktop (v1) | MULTICA-AUDIT §2.5–2.6; D: ~45k non-test server lines removable from coordination alone | Parity | demand |
| D-13 | Discovery docs live in `felt-ops/docs/product-discovery/` | felt-ops is the existing FeltKit product and its road-test evidence is referenced throughout | Writing into Multica (product being studied, with its own strict repo rules) | — |

## Platform gaps proposed (see CAPABILITY-MAP §8)

E-1 remote execution protocol (FeltKit) · E-2 application-facing approval of agent-owned actions
(FeltKit, the felt-ops G-07 remainder) · E-3 published AppPort work channel for EVE (ecosystem).
Explicitly **not** gaps: GitHub built-ins, usage metering, presence, a FeltKit sandbox.

## Assumptions (not yet evidenced)

| ID | Assumption | Test |
|---|---|---|
| A-01 | EVE's own coding loop is good enough on real repositories | Phase 0 S1 |
| A-02 | Self-hosted EVE (local world + Docker) runs multi-hour sessions reliably | Phase 1 live scenarios, Phase 2 soak |
| A-03 | Engineering teams accept agent definitions maintained in git instead of a form | U-05 |
| A-04 | A shared runner is acceptable for v1 (vs each person's laptop) | U-04 |
| A-05 | FeltDB handles run event volume at team scale | Phase 2 measurement |
| A-06 | Removing a tenant membership ends that member's live workspace access | Phase 1 test (1.9) |

## Unresolved questions (owner decisions needed)

| ID | Question | Why it matters |
|---|---|---|
| U-01 | Product name. "Handoff" is a placeholder and collides with FeltKit's `handoff` playbook term | identity, docs |
| U-02 | Is the target user right: small engineering teams already using coding agents? | scope of v1 |
| U-03 | Native work items, or GitHub Issues as the source of requests from day one? | Work list scope; Phase 3 triggers could become Phase 1 |
| U-04 | Must v1 support people's own CLI subscriptions (Claude Code/Codex) as Multica does? If yes, a vendor-CLI tool inside the EVE sandbox enters Phase 1 | cost to users, quality, adapter ownership |
| U-05 | Agent configuration: git-only definitions (proposed) or an in-app editor? | admin UX |
| U-06 | Will the platform owner prioritise E-1 and publish agent control (S3) in the Phase 1 window? | size of interim code |
| U-07 | FeltKit release state is inconsistent: npm `latest` is 0.3.36, while FeltKit's CHANGELOG calls 0.3.36 "prepared (unpublished)". Which published version is the target baseline? | baseline for Phase 1; 0.3.35 contains the invocation-approval fix |
| U-08 | EVE fork release quality: its own assessment says CI has never run on a PR. Will CI be enabled before we depend on it? | runner stability |

## Verification of audit notes

The detailed notes in [`evidence/`](evidence/) were produced by read-only audit agents. The
following claims, on which decisions rest, were re-checked by hand on 2026-11-23:

| Claim | Check | Result |
|---|---|---|
| Multica runs Claude with prompts bypassed | `server/pkg/agent/claude.go:1183-1187` | confirmed: `--permission-mode bypassPermissions` |
| Multica's assign-time enqueue failure is only logged | `server/internal/service/issue.go:975-983` | confirmed: `slog.Warn("enqueue agent task on create failed")` |
| Multica's "confirm" policy is mapped to allow | `server/internal/connectedapps/policy.go:56-70` | confirmed (comment: "per-call approval has been removed") |
| Run output broadcast to every workspace member | `server/cmd/server/private_project_realtime.go:91-104` | **corrected**: `task:message`/`task:progress` "stay narrowed" for private projects; workspace-wide only on non-private work |
| FeltKit approval is person-only | `feltkit/packages/sdk/src/runtime/agent.ts:1006` | confirmed |
| FeltKit invocation visibility admits only the requester or deliverer | `feltkit/packages/sdk/src/runtime/invocations.ts:262-267` | confirmed |
| FeltKit remote worker protocol not implemented | `feltkit/docs/EXECUTION.md:242` | confirmed ("Designed, not implemented") |
| Agent control is unreleased | `feltkit/CHANGELOG.md:19` "Unreleased: agent control" | confirmed |
| felt-ops passes on the installed 0.3.34 | `npm test` in felt-ops | confirmed: 9/9 pass. The run rewrote six `evidence/scenario-*.json` files; they were restored from git so the repository is unchanged |
| `@appport/eve` published | `npm view @appport/eve versions` | confirmed: `0.0.0-stage`, `1.0.2` |

Not re-checked by hand (lower decision weight; treat as leads): exact LOC figures, the per-file
counts of compatibility notes, and the Multica GitLab webhook signature defect.

## Limitations of this discovery

- Multica and EVE were read, not run. No Multica tests and no EVE agent were executed.
- AppBoundry, Resolver server, AuthBoundry and the Intent engine were not inspected directly;
  statements about them come from FeltKit's own audits.
- No user research was done. Target-user and adoption questions are open (U-02, U-04).
- The Multica clone is shallow (50 commits); history-based analysis wasn't possible.
