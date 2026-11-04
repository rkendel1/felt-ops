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

### Keys (`feltdb managed keys list`)

| Key id | Name | Scopes | Origin |
|---|---|---|---|
| `xjG1yrnGsA4X` | companyos-control | control + promote | CompanyOS setup (promoted v1) |
| `PBhQszATzbSP` | companyos-runtime | state:read/write | CompanyOS setup (inferred, by creation order) |
| `fJYRqHBdNtha` | companyos-control | control + promote | **starter control run** (promoted v2) |
| `dOdcAJruM39Z` | companyos-runtime | state:read/write | **starter control run** (inferred, by creation order) |

The repository's `.env.local` and the starter scratch copy's `.env.local` hold **different**
runtime keys for the same application, so the control run created a second key pair.
Mapping a token to a key id is inferred from creation order; confirm the creation times in
the account before revoking.

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
| **R1 (recommended): roll back** | `POST /api/applications/{app}/environments/production/rollback` `{ target_revision: v1, expected_current_revision: v2, reason }` | your authorization (changes production). The endpoint takes no destructive flag; FeltDB may still refuse because the diff is BREAKING | low: optimistic concurrency on the current revision; history records `rollback: true` |
| R2: promote v1 with destructive approval | `POST …/environments/production/promote` `{ revision: v1, expected_current_revision: v2, approve_destructive_changes: true }` | your explicit authorization **for this exact diff** (`diff_hash` above), separate from R1 | the approval covers the 55 listed changes and nothing else |
| R3: leave it | — | nothing | the CompanyOS application keeps the starter's contract until someone acts |

**Recommendation:** authorize R1 now, with R2 only if R1 is refused and you approve it
separately. Then revoke the two keys created by the control run.

**Exact procedure (not executed)**
1. Pre-check (read-only): the production pointer is still v2 and the history is unchanged.
2. R1: one `rollback` call with `expected_current_revision` = v2.
3. **Stop** if it is refused. Report the response. Do not retry with R2 unless separately
   authorized.
4. Verify (read-only):
   - the pointer is v1;
   - the history shows a new entry `v2 → v1` with `rollback: true`;
   - readiness passes;
   - `_feltkit_meta/startup` still readable.
5. Separately authorized: revoke `fJYRqHBdNtha` and `dOdcAJruM39Z` after confirming their
   creation times. Then delete the starter scratch copy's `.env.local`.
6. Record the outcome as an update to F-050.

**Not done, and not to be done without authorization:** deleting the application, publishing
any contract, any promote, revoking keys.

## 3. F-041: owner and action

| | |
|---|---|
| Owner | rkendel1 (FeltDB, `rkendel1/flow_db`) |
| Why the service is stale | `fly-deploy.yml` deploys only after CI on `main` succeeds (or by `workflow_dispatch`). CI on `main` has failed on every run since about 17:13 UTC on 2026-11-03, so each deploy run ended in "Production deploy skipped because CI did not succeed". The control plane kept `791cb05` |
| Failing CI step | job "Build and Test Packages", step "Test semantic query composition and its surface boundaries against the contract" (run 41714200231, `f428423`) |
| Action | fix that step (or judge it unrelated and deploy deliberately with `workflow_dispatch`), deploy `feltdb-control-plane` at a commit containing `85a869c`, then confirm with `tools/check-managed-release-identity.mjs` (`FELTDB_LIVE_EXPECTED_COMMIT` = the deployed commit) |
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
