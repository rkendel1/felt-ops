# Final evaluation: CompanyOS on FeltKit 0.3.13

Road test of 2026-11-03/04, **reconciled 2026-11-04**. Evidence is in `docs/` and `evidence/`, cited by ID. Scores are
the builder's judgement from that evidence. **No human operators or independent reviewers
took part** (see AGENT-OPERATOR-EVALUATION, "What this evaluation is").

## Verdict

FeltKit's core is **real and trustworthy**: authority checked on every call, mandatory
approval that holds on every interface, agent actions with evidence and recovery, schema
contracts and upgrades, backup and restore. A substantial, multi-domain business application
was built on it in about a day without modifying the platform, and its data survived a
FeltKit + FeltDB upgrade unchanged.

It is **not yet a platform an organization can run its people and agents on**. The gaps are
not in the data or execution core. They are in what surrounds it:
- **identity lifecycle:** accounts cannot be disabled or have their roles changed;
  applications cannot revoke sessions;
- **an application-facing agent control surface:** approvals and agent state are locked in
  Studio;
- **durable integration outcomes:** a failed outcome handler is silently dropped;
- **production operations without downtime:** issuing sessions and taking backups require
  stopping the server;
- **the managed path:** no FeltKit 0.3.13 app (CompanyOS or the unmodified starter) can start on Managed FeltDB today. The service runs a FeltDB server build that predates a fix FeltKit depends on (F-041), with no version check to say so (F-051). The managed contract also drops every application `unique` constraint and index (F-048).

In a scripted, builder-authored run, operator control held and the screens agreed with the records in every case that was actually checked (6 of 15 workflows had a real display-to-record check). The experience is fragmented across the app, Studio and a terminal. No human or independent review has been done.

## Scores

| Dimension | Weight | Score | Basis |
|---|---|---|---|
| Developer experience | 10% | 7 | Scaffold to 93 functions, 27 collections and 23 capabilities, with clear typed APIs and errors that name the fix. Lost: the `onOutcome` payload is undocumented (F-019), and the managed tooling is rough (F-037–F-040). |
| Business functionality | 10% | 7 | Seven connected domains, policy-driven approvals, reconciliation, onboarding, incidents (PRODUCT-SPEC). Payments, renewals, exceptions are not built. |
| Data integrity and evolution | 10% | 7 | Atomic mutations, sequence-ordered history, unique constraints. Upgrade 0.3.12 + FeltDB 0.20 → 0.3.13 + 0.21 verified on data (Scenario 7). Backup/restore drill identical (569 records). On Managed FeltDB, uniqueness would not be enforced: the generated contract drops all 21 unique constraints (F-048). |
| Authorization and governance | 10% | 6 | Per-call decisions; approval never widens authority (Scenarios 3, 5, 6). Missing: account lifecycle, session control, resource attributes, delegation, conditional approval (G-01–G-06). |
| Integrations and background work | 10% | 5 | Integrations recorded, `UPSTREAM_REJECTED` with status, verify probes. Silent `onOutcome` loss (F-018), after-commit permission failure only logged (F-036), env template gaps (F-024). Jobs and schedules lightly exercised. |
| Agent capability and execution | 10% | 7 | Real agent processes over MCP; proposals, approvals, crash and recovery, exactly-once outcomes, 401 on a revoked session (Scenario 6 live). Direct calls are outside the task (F-020); dev/prod divergence (F-022). |
| **Agent operator experience** | **20%** | **6 (provisional)** | Scripted, builder-authored run: 11 completed, 4 partial; 6 real display-to-record checks, all agreed; fragmented across three surfaces. No human or independent review (AGENT-OPERATOR-EVALUATION). |
| DevOps and production lifecycle | 10% | 5 | Real CI on every push; verified deploy artifact; production verified running the release commit; GitHub evidence observed through the app (production lifecycle). Fly, Vercel and Docker untested; managed path unusable (F-041, F-051); interactive deploy replaced the running artifact (F-042); downtime for sessions and backup (F-023). |
| Evidence, auditability and recovery | 10% | 6 | FeltKit action records and checkpoints verified at commit; app-level verification from records; restart reconciliation. The activity log is bounded and unreadable (F-009); the approver is absent from app records (F-008). |
| **Weighted total** | | **6.2 / 10** (was 6.4 before reconciliation) | |

## What was demonstrated (verified with evidence)

- **All seven scenarios** (SCENARIO-RESULTS), each automated and in CI. The live agent crash
  and the platform upgrade run as CI steps.
- **A business change through software to production:** request → spec → commit → GitHub
  Actions success observed through the app → executive approval → deploy → production
  verified running that commit → business acceptance.
- **A production incident from a real defective release** (R1, run from git history),
  remediated by an agent under Finance approval. A wrongly approved proposal was refused by
  the business rule.
- **Agent crash, session revocation, platform restart and recovery** with exactly four
  reversals.
- **Platform upgrade** across FeltKit and FeltDB versions with data verification.
- **Backup and restore** of production with an identical fingerprint.

## Not tested

- Fly.io, Vercel, Cloudflare (no credentials); Docker (no daemon).
- Multi-instance behavior (needs a working shared FeltDB; F-041).
- Model-driven agents and Intelligence (deliberately deterministic agents).
- Account e-mail and sign-in providers.
- External webhook receivers, schedules running on time, load and concurrency beyond the
  platform's own guarantees.
- Human operators.

## Failures

- **F-041:** no FeltKit 0.3.13 app starts on Managed FeltDB (`INDEX_UNAVAILABLE` on empty platform collections). The root cause is a service running a pre-fix FeltDB server; reproduced with the unmodified starter.
- **F-048:** the managed contract drops application `unique` constraints and indexes.
- **F-018:** silent loss of integration outcomes (observed in Scenario 4, first run).
- **F-022:** in development, a revoked agent's proposal can still be approved and run.
- **CompanyOS's own defects found by the test:** R1's dual-authority mismatch (F-012), the
  deliberate R1 invoice defect (F-013), retroactive policy approval (F-014), missing webhook
  permissions (F-036), and the Scenario 2 test path that only CI could reach (F-017).

## Investigation incident

While reproducing F-041 with the unmodified starter, the investigator published the starter's contract into the CompanyOS managed application (version 2, promoted to production), by pre-approving a breaking publish (F-050). There was no data. Version 1 still exists. A decision is pending: re-promote version 1, or delete the managed application.

## Workarounds in place (the capability is still missing)

| Workaround | Covers |
|---|---|
| `actor()` refuses departed people and suspended agents | G-01, G-02 |
| `withinAssignment()` narrows agent authority on CompanyOS's own mutations | G-04 |
| The UI reads agent state through `/mcp` with the person's session | G-07 |
| Domain `timeline` instead of a readable activity log | G-08 |
| `subject` passed to GitHub as an ignored query parameter | G-09 |
| Production downtime to issue sessions and take backups | G-11 |

## Is it suitable for real organizational workloads?

- **For a single team running its own operations with a few deterministic agents, on a
  self-managed host:** close. The data, authority-per-call and agent-safety core holds up, and
  CompanyOS works.
- **For an organization with staff turnover, many approvers and production agents:** not yet.
  It cannot remove a leaver's access at the platform level (G-01). Approvers must work in
  Studio (G-07). Integration results can be lost silently (G-09). Routine operations need
  downtime (G-11).

## What prevents broader adoption

In order:
1. Identity lifecycle (G-01, G-02).
2. An application-facing agent control surface (G-07).
3. Durable integration outcomes (G-09).
4. A managed path that works end to end: a server version aligned with the client (F-041, F-051), constraint parity (F-048), runnable setup commands (F-037–F-039), plus multi-instance proof.
5. Zero-downtime operations (G-11).
6. Approval provenance and readable decision evidence (G-05, G-08).

## What should be fixed in FeltKit vs. stay with the application

See FELTKIT-GAP-REPORT for the full list.
- **Fix in FeltKit:**
  - G-01, G-02, G-07, G-09, G-05, G-11, G-12, G-08;
  - the defects F-004, F-005, F-018, F-022, F-024, F-038, F-039, F-044.
- **Stay with the application:**
  - business authority semantics (limits, chains, separation of duties);
  - assignment semantics and business verification;
  - policies as effective-dated business configuration;
  - domain history.

## The three questions

1. **Can a developer build and evolve a substantial business application with FeltKit
   without fighting the platform?**
   - Yes for the core. Building, testing, changing schemas and upgrading the platform were
     productive.
   - The fights were at the edges: integration outcomes, identity, managed setup, and the
     dev sandbox's network.
2. **Can business and engineering coordinate changes without losing authority, continuity or
   evidence?**
   - Yes, demonstrated end to end (Scenarios 1, 2, 3, 5, 7). Authority held at every step,
     and evidence links each change to its business record.
   - Continuity relies on CompanyOS workarounds where the platform lacks account and session
     control.
3. **Can a human operate a team of agents through this system, rather than watch tool calls?**
   - Yes, with safety and truthful state: the operator assigns scoped work, sees what is
     proposed, executed and verified, intervenes, recovers, and proves outcomes from records.
   - The experience needs a substantial new platform layer to be good rather than merely
     sound. Above all: approvals and agent state exposed to applications (G-07), and identity
     and session control (G-01/G-02).
