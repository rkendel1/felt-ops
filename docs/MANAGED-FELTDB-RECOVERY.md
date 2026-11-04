# Managed FeltDB: current state and recovery

Established 2026-11-04 between 00:15 and 00:30 UTC with read-only calls: control-plane GETs,
one data-plane query, and `feltdb managed keys list`. **Nothing was published, promoted,
rolled back, revoked or deleted.** Credentials stay in git-ignored files (`.env.local`,
`.feltdb/`) and the session scratchpad; none appear here.

## 1. Current state

### Service

| | Value | Source |
|---|---|---|
| Endpoint | `https://api.feltdb.com` (Fly app `feltdb-control-plane`, one machine, one volume, no replica) | `/health`; flow_db `docs/operations/DEPLOYMENT.md`, `deploy/control-plane/fly.toml` |
| Running build | `version 0.6.0`, `release_id 0.19.0-791cb0523b9139cab6bd6e586ea6233e7b885752`, built 2026-11-03 16:50:58 UTC | `GET /health` (unchanged since the 2026-11-04 report) |
| Required fix | `85a869c` "a scoped read of an empty collection answers through its index, not INDEX_UNAVAILABLE", in release 0.21.0 (`e356149`, crates 0.6.1) | flow_db history |
| Compatible? | **No.** `791cb05` is an ancestor of `85a869c` (`git merge-base --is-ancestor`) | flow_db clone |

### Application `app_VdI0HIgo0jINzwhFSs` (`companyos`, tenant `tenant_m174odKLypm5X0jB88`)

| Revision | Version | Created (UTC) | Collections | Indexes | Unique | Contents |
|---|---|---|---|---|---|---|
| `sha256:c5839063…2fc598` | 1 | 2026-11-03 23:51:26 | 67 | 31 (platform only) | 0 | CompanyOS (27 app collections) + platform; app constraints missing (F-048) |
| `sha256:d4a01cf9…51383f` | 2 | 2026-11-04 00:05:56 | 42 | 31 | 0 | **unmodified starter** (`projects`, `tasks`, …) + platform: the F-050 incident |

- **Production pointer:** version 2 (starter).
- **Production promotion history** (complete): `null → v1` at 23:52:07, then `v1 → v2` at 00:05:57.
  Nothing has changed since.
- **Data in production:** `_feltkit_meta` holds one record, `startup` (FeltKit's storage probe,
  written by the failed starts: 1 transaction in the CompanyOS start, 2 in the starter
  start). `tasks` and `projects` are empty. **No business data.** (Correction to F-050,
  which said no data existed.)
- **Readiness** (`GET …/environments/production/readiness`): every check passes, including
  "runtime compatible". The service's own check does not detect F-041 (evidence for F-051).

### Keys (`feltdb managed keys list`; attribution re-established 2026-11-04 from direct evidence)

| Key id | Name | Scopes | Origin | Evidence |
|---|---|---|---|---|
| `xjG1yrnGsA4X` | companyos-control | control + promote | CompanyOS setup | production history: `promoted_by` of `null → v1` (23:52:07 UTC) |
| `PBhQszATzbSP` | companyos-runtime | state:read/write | CompanyOS setup | `GET /v1/identity/me` with the repository `.env.local` runtime token → `subject_id` |
| `fJYRqHBdNtha` | companyos-control | control + promote | **starter control run** | production history: `promoted_by` of `v1 → v2` (00:05:57 UTC), the publish run from the starter copy |
| `dOdcAJruM39Z` | companyos-runtime | state:read/write | **starter control run** | `GET /v1/identity/me` with the starter copy's `.env.local` runtime token → `subject_id` |

The runtime mapping is direct: the authority itself names the key that presents each token.
For the control keys, the history names the promoting key of each revision. The repository's
control key gets 403 on `/v1/identity/me`, so which control key sits in which file is not
proven by the same call. The attribution of `fJYRqHBdNtha` rests on the history entry and the
session record of which copy ran the v2 publish.

**Creation timestamps are not available.** The service (`791cb05`) returns `id`, `name`,
`scopes`, `namespaces` and `revoked` per key (`ApiKeySummary`, `crates/feltdb-server/src/auth.rs`).
No creation time, creator or last use is returned. The application audit
(`GET …/applications/{app}/audit`) needs `audit:read`, which neither control key holds (403).
So the earlier "creation order" inference has been replaced by the evidence above, not
confirmed by timestamps. Gap recorded as F-056.

### Local side

- The road-test processes are gone: the container restarted at about 00:18 UTC.
- The local production state from the backup/restore drill is intact at
  `.feltkit/deploy/.feltkit/production/state`. That directory now holds the **hosted**
  artifact (F-042). Restarting local production needs a container artifact built with
  `--out` into a new directory.

## 2. F-050 recovery decision

**Goal:** CompanyOS's contract (version 1) active in production again, without deleting the
application and without publishing anything new.

**Facts that shape the decision**
- FeltDB's own diff from version 2 to version 1 (read-only `GET …/revisions/{v1}/diff?from={v2}`)
  classifies it **BREAKING**: 55 changes (52 collections added, 1 modified (`projects`),
  2 removed). Each addition is marked `destructive: true` / `REQUIRES_MIGRATION`.
  `diff_hash sha256:6a4f4baf0fccc99208fa59357ab42ce7789a7d806083ebae2a7e5d0c47778756`.
- Nothing would be lost: the only stored record (`_feltkit_meta/startup`) belongs to a
  collection present in both versions.
- Restoring version 1 changes nothing functionally until F-041 is fixed: no FeltKit 0.3.13 app
  can start on the current service.

**Options**

| Option | Call | Needs | Risk |
|---|---|---|---|
| **R1: roll back with destructive approval** | `POST /api/applications/{app}/environments/production/rollback` `{ target_revision: v1, expected_current_revision: v2, reason, approve_destructive_changes: true }` | your explicit authorization **for this exact diff** (`diff_hash` above) | the approval covers the 55 listed changes and nothing else; optimistic concurrency on v2; history records `rollback: true` |
| R2: promote v1 with destructive approval | `POST …/environments/production/promote` `{ revision: v1, expected_current_revision: v2, approve_destructive_changes: true }` | the same authorization | same gate and effect as R1, but recorded as a promotion, not a rollback |
| R3: leave it | — | nothing | the CompanyOS application keeps the starter's contract until someone acts |

**Correction (2026-11-04): a rollback to v1 does require destructive approval.** The earlier
text said the rollback endpoint takes no destructive flag. The service code proves otherwise
(`791cb05`, unchanged on main). `rollback_environment` and `promote_environment` both call
`move_environment` → `ApplicationStore::move_environment_pointer`. The only difference is the
`rollback` flag, which changes the required scope (`application:revision:rollback`) and the
history and audit labels. Both run the same check: the diff from the current revision to the
target is computed, and if any migration operation is `destructive` the call fails with
`destructive_changes_require_approval` unless `approve_destructive_changes` is set
(`RollbackEnvironmentRequest` accepts it). The read-only diff v2 → v1 marks all 55 operations
destructive. So **R1 without the flag would be refused**, and the R1/R2 distinction in the
earlier recommendation was wrong. Why the additions count as destructive is analysed in §5.

**Recommendation (revised 2026-11-04): R3. Leave the production pointer on v2 until a
corrected contract is ready.** Neither v1 nor v2 is CompanyOS's real contract. v1 lacks
CompanyOS's 21 unique constraints and 18 indexes (F-048). v2 is the starter. Rolling back to v1
would mean approving a destructive diff to reach a contract that is known to be incomplete,
on a service that cannot run FeltKit 0.3.13 apps anyway until 0.21.0 is deployed. Nothing is
lost by waiting: production holds no business data, and v2 changes nothing while no CompanyOS
process uses the managed path. R1 (and the procedure below) is kept only as the documented
way back to v1, in case it is ever needed. It is not recommended.

**Plan: a corrected v3** (not authorized; each gate is a separate decision)

1. Preconditions:
   - F-048 is released in FeltKit;
   - the live service reports a commit containing `85a869c`
     (`check-managed-release-identity.mjs` and `/health`);
   - the isolated canary in §4 passes.
2. Generate CompanyOS's contract with the released FeltKit (`feltkit contract`) into a scratch
   path, not over the committed file.
3. Compare its complete declarations with the local compiled contract, the way the FeltKit
   parity test does: read back as the authority reads a manifest, the state-contract hash must
   equal `compileStateContract`'s. Also check the counts: 27 app collections, 21 unique
   constraints, 18 indexes.
4. Publish it as a **staged revision** (no promotion). Read FeltDB's own diff from the current
   production revision (v2) to it: `GET …/revisions/{v3}/diff?from={v2}`, read-only. Record
   its classification, every operation marked `destructive`, any security-sensitive change,
   and its `diff_hash`.
   - Expected: removals of the starter's `tasks`/`projects` shape make the whole revision
     `Breaking` (§5), so every collection operation will be listed as destructive.
5. Present that diff and the exact approval it needs: `approve_destructive_changes` for that
   `diff_hash` only. Get explicit approval before any production promotion.
6. Promote with `expected_current_revision` = v2. Verify:
   - the pointer;
   - the history entry;
   - readiness;
   - a CompanyOS start-up against it (the storage check names any missing index).

Publishing a staged revision changes the application's revision list but not production.
It also needs authorization, because it publishes a contract.

**R1 procedure, kept for reference (not recommended, not executed)**
1. Pre-check (read-only): the production pointer is still v2 and the history is unchanged;
   the diff v2 → v1 still has `diff_hash` `sha256:6a4f…8756`.
2. R1: one `rollback` call with `expected_current_revision` = v2 and
   `approve_destructive_changes: true` (only with approval of that diff hash).
3. **Stop** if it is refused, or if the recorded `diff_hash` differs from the approved one.
   Report the response. Do not retry.
4. Verify (read-only):
   - the pointer is v1;
   - the history shows a new entry `v2 → v1` with `rollback: true`;
   - readiness passes;
   - `_feltkit_meta/startup` still readable.
5. Separately authorized: revoke `fJYRqHBdNtha` and `dOdcAJruM39Z` (attribution in §1; no
   creation times exist to confirm). Then delete the starter scratch copy's `.env.local`.
6. Record the outcome as an update to F-050.

**Not done, and not to be done without authorization:** deleting the application, publishing
any contract, any promote, revoking keys.

## 3. F-041: owner and action

| | |
|---|---|
| Owner | rkendel1 (FeltDB, `rkendel1/flow_db`) |
| Why the service is stale | `fly-deploy.yml` deploys only after CI on `main` succeeds (or by `workflow_dispatch`). CI on `main` has failed on every run since about 17:13 UTC on 2026-11-03, so each deploy run ended in "Production deploy skipped because CI did not succeed". The control plane kept `791cb05` |
| Failing CI step | job "Build and Test Packages", step "Test semantic query composition and its surface boundaries against the contract" (run 41714200231, `f428423`) |
| Root cause (2026-11-04) | **Tooling, not a regression.** The step's tests never ran: vitest could not load Rollup's native binary. Since `f268ad6` the website workspace depends on the `@feltdb/studio` workspace. npm 11 (Node 24 in CI) then reaches `rollup` only as an optional peer of `vite-plugin-dts` and leaves rollup's 25 platform packages (and `@napi-rs/lzma-linux-x64-gnu`) out of `package-lock.json`, so `npm ci` installs none. Bisected to `website/package.json`; a root `rollup` devDependency did not help, while `@feltdb/studio` declaring `rollup` did. Earlier red runs (`3bf3e1f`, `ad5b8ea`, `ab4d395`) failed on a stale certification report, which passes on main now |
| Fix | branch `claude/ci-npm11-platform-binaries` (flow_db): `rollup` in `@feltdb/studio` devDependencies; lockfile regenerated with npm 11.6.0 (+26 entries, nothing removed or re-versioned); `tools/check-lockfile-optional-dependencies.mjs` plus a CI step after `npm ci`, so a recurrence fails with its cause named |
| Action | land the fix through CI on `main`; the normal `fly-deploy.yml` run then deploys `feltdb-control-plane` at a commit containing `85a869c`, then confirm with `tools/check-managed-release-identity.mjs` (`FELTDB_LIVE_EXPECTED_COMMIT` = the deployed commit) |
| Acceptance | `/health` `git_commit` has `85a869c` as an ancestor; the isolated test below passes |

FeltKit's managed e2e test (`tests/e2e/managed-feltdb.test.mjs`) runs against a server built
from a local flow_db checkout, never against the live service, so it could not see this
drift. The hardening plan adds a live-service check (F-051).

## 4. Isolated managed test (plan; run only after §3 is confirmed)

| Item | Value |
|---|---|
| Project | fresh `npm create feltkit@latest feltkit-canary-<yyyymmdd>` in the scratchpad; **no edits** |
| Names | directory = `package.json` name = FeltKit app name = managed application name (`feltkit-canary-<yyyymmdd>`), passed explicitly with `--name`; checked before any managed call |
| Credentials | a new key pair created by `init-managed` for the new application only; kept in the canary directory; never the CompanyOS keys |
| Contract | the canary's own, published by `init-managed` to the new application only |

**Steps**
1. Service check: `/health` `git_commit` contains `85a869c`.
2. Scaffold and install.
3. `npx feltkit deploy --target hosted --out <canary>/release-1`.
4. `init-managed --name <canary> --contract …` (signin).
5. Start the artifact with the canary's keys.
6. Readiness, then platform-collection reads (from the start-up trace).
7. A write/read cycle through the app (create a task, read it back).
8. Restart, then read again.
9. Confirm in `git status` that no credential file is tracked.

**Stop conditions** (any one stops the test, recorded as a finding):
- the service commit lacks `85a869c`;
- any managed call names an application id other than the canary's;
- `init-managed` proposes publishing into an existing application;
- **any publish refusal: never answer it with `--approve-destructive-changes`**;
- `INDEX_UNAVAILABLE` or any start-up error;
- a credential file appears in `git status`;
- a step would touch `app_VdI0HIgo0jINzwhFSs`.

CompanyOS is tested on the managed path only after the canary passes, and only after F-048
(constraint parity) is fixed. Otherwise the test would prove a contract without CompanyOS's
unique constraints.

## 5. Why adding a collection is classified destructive

Source: `crates/feltdb/src/application.rs` in flow_db. The file is identical at the deployed
commit `791cb05` and at `origin/main` `f428423`, so this is what the service does now and what
0.21.0 will do. Analysis only: **no approval semantics were changed.**

**How a promotion or rollback is gated** (`move_environment_pointer` → `application_revision_diff`):

1. `diff_manifests` lists every changed resource with a section default safety. Collections get
   `RequiresMigration`, whether added, modified or removed. Indexes and workflows get `Safe`.
   Actions, agents, capabilities, connections and policies get `SecuritySensitive`.
2. `compatibility(before, after)` gives the whole revision one verdict. It is `Breaking` if any
   collection or field of `before` is missing from `after`, and `RequiresMigration` if a
   field's type name changed. Otherwise it is `Compatible`. Additions never affect it.
3. Each `RequiresMigration` or `Breaking` change becomes a migration operation with
   ```
   destructive = kind == Removed
              || safety == Breaking
              || (section == "collections" && compatibility(whole revision) == Breaking)
   ```
4. Any destructive operation, or (when there is a previous revision) any security-sensitive
   change, refuses the move unless `approve_destructive_changes` is set.

**So an addition is destructive only by contagion (the third clause).** In a revision that
also removes a collection or a field, every collection operation becomes destructive, additions
included. In v2 → v1, the two starter collections v1 does not declare make the whole revision
`Breaking`, so all 52 additions are flagged too. In a purely additive revision, the additions
are migration operations but not destructive, and promotion proceeds without approval. The
existing test `destructive_change_requires_acknowledgement_and_audit_binds_diff` covers only
a removal. No test pins either behaviour for additions.

**Classification as implemented vs. a proposed intent** (the owner decides; nothing here is implemented):

| Change | Implemented | Proposed intent | Reason |
|---|---|---|---|
| Collection added, nothing removed | migration op, not destructive | same | nothing stored can be lost or invalidated |
| Collection added, something else removed | **destructive** (contagion) | not destructive; the removal alone needs approval | the approval list would then name the operations that can lose data, not 52 that cannot |
| Collection removed | destructive | destructive | records become unreachable |
| Field removed | destructive (it makes the revision `Breaking`) | destructive | values are lost |
| Field type changed | `RequiresMigration` (not destructive unless the revision is otherwise `Breaking`) | needs approval when stored records can fail the new type | stored values may not satisfy it |
| Field becomes required or non-nullable, gains an enum, a reference or a unique constraint | not gated by this rule. The state-schema comparison (`compare_schemas`) affects only the reported classification, not the gate | needs approval when the collection holds records | existing records may violate it (relevant to F-048's upgrade) |
| Index added or removed | `Safe` | `Safe` (a unique index: as the row above) | |
| Security-sensitive section changed | needs approval (same flag) | same, but a separate flag | one flag now approves both data loss and authorization changes |

**What a change would require** (per the instruction not to change semantics without a tested
compatibility analysis):
- characterization tests that pin today's behaviour for each row before any change;
- a decision on whether `diff_hash` approvals already recorded stay valid (the hash covers the
  diff, so a reclassification changes the hash for the same revisions);
- the CLI's gate (`feltdb publish` stages `BREAKING` and `MIGRATION_REQUIRED` diffs) is a
  separate rule from the server's `destructive` gate, and both would have to agree.

Recorded as F-052 (cause added: contagion makes additions destructive) and F-057 (tightening
constraints on populated collections is not gated by the server's destructive check). These
are findings for flow_db. F-057 comes from reading the code only, with no test run.
