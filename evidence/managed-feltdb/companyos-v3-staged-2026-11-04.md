# CompanyOS contract v3: staged, not promoted (2026-11-04)

Recovery plan step 4 (`docs/MANAGED-FELTDB-RECOVERY.md` §2, "a corrected v3"). Authorized by the owner
("Go ahead with companyos"). **Production was not changed.**

## Preconditions (all met)
- F-048 is released: FeltKit 0.3.14 (`v0.3.14` = `26a6255`). Its `dist/runtime/contract.js` builds app
  collections with `compileStateContract`.
- The live service contains `85a869c`: `GET https://api.feltdb.com/health` gives `git_commit 99e56e3…`,
  `release_id 0.21.0-99e56e3…`, server `0.6.1`.
- The isolated canary passed (`canary-2026-11-04.md`).

## Contract
- Generated with the released FeltKit (`npx feltkit contract`, `@feltdb/feltkit` 0.3.14, `@feltdb/core`
  0.21.0) into a git-ignored path (`.feltdb/v3-candidate.contract.json`). `feltkit contract --check`
  reports it up to date.
- 67 collections and 70 indexes, 21 of them unique. That is 31 platform indexes plus CompanyOS's 21
  unique constraints and 18 indexes, the counts F-048 said v1 lacked.

## Publish
- `feltdb publish --contract .feltdb/v3-candidate.contract.json --dry-run`: validation `breaking`. An
  earlier attempt failed once with "Manifest request failed" before any draft; the cause is unknown and
  it did not recur.
- `feltdb publish --contract … --yes`, **without** `--approve-destructive-changes`. Requests: revisions,
  draft create/update/validate, commit (201), diff (200). No promote call.
- CLI result: "Publish requires explicit approval before activation (BREAKING, authorization boundary
  changed). Immutable version 3 was staged but the active cloud version was not changed."
- Three drafts were left by the dry runs and this publish. They are not revisions.

## State after
| | Value |
|---|---|
| Revisions | v1 `sha256:c5839063…`, v2 `sha256:d4a01cf9…`, **v3 `sha256:370cc21b53aec837048e6bb038e016b11f7cc8d175db544f0f9d70b4e7d32162`** |
| Production pointer | **v2** (`sha256:d4a01cf9…`), unchanged |
| Readiness, production (current) and for v3 | all 10 blocking checks passed |

## Diff v2 → v3 (FeltDB's own, read-only; full JSON: `companyos-v3-diff-from-v2.json`)
- `classification` **BREAKING**.
- `diff_hash` **`sha256:2ef5d9c0ed24d39962b8ffbd08128212d8fc608f6d2537303cf5f3e98fd00024`**.
- 94 changes: 91 added, 1 modified, 2 removed.
- Migration plan: 29 operations, **all marked destructive**: 26 `add` (collections added, made
  destructive by the breaking revision, §5), 1 `alter` (`projects`), 2 `remove`.
- State schema:
  - `tasks` collection removed (DESTRUCTIVE);
  - `projects`: fields `kind`, `ownerId`, `status` added (DESTRUCTIVE), `teamId` added (SAFE),
    `createdAt` and `createdBy` removed (DESTRUCTIVE);
  - every other change is a SAFE collection addition.
- `security_changes`: 26 entries, each "Added security-sensitive resource" in `policies`. These are
  the access policies for CompanyOS's 26 added app collections. None removes or loosens an existing
  policy.
- What the destructive operations touch: `tasks` and `projects` are the starter's. Per §1 (read
  2026-11-04 ~00:30 UTC), production holds only `_feltkit_meta/startup`. No CompanyOS process has used
  the managed path since.

## Next (requires the owner's approval of this exact diff)
Promote v3 to production with `expected_current_revision` = v2 and `approve_destructive_changes: true`
for `diff_hash sha256:2ef5d9c0…00024` only. Then verify the pointer, the history entry, readiness,
and a CompanyOS start-up against it.

## Promotion (step 5–6, owner approved the exact diff: "approved.")

**Before promoting**, re-checked: the production pointer was still v2, and the v3-from-v2 `diff_hash` equals the
approved `sha256:2ef5d9c0…00024`. The promote request carries no `diff_hash`, so this check was made by the
caller.

`POST /api/applications/{app}/environments/production/promote` sent
`{ revision: v3, expected_current_revision: v2, approve_destructive_changes: true, reason: "F-050 recovery … Owner approved diff_hash sha256:2ef5d9c0…" }`
→ **200**. The response is in `companyos-v3-promotion.json` and records `diff_hash sha256:2ef5d9c0…00024`,
`from_revision` v2 and `promoted_by xjG1yrnGsA4X` (the CompanyOS control key, not the starter's).

**Verified after:**
| Check | Result |
|---|---|
| Production pointer | **v3** `sha256:370cc21b…` |
| Production history | v2 → v3 by `xjG1yrnGsA4X`, `rollback: false`, diff `sha256:2ef5d9c0…` (after `null → v1` and the F-050 `v1 → v2`) |
| Readiness | **READY**, 10/10 blocking checks passed on v3 |
| CompanyOS start-up on Managed FeltDB | `feltkit start` (FeltKit 0.3.14) with the managed settings exported from `.env.local`: `State remote https://api.feltdb.com`; startup storage 928 ms, schema 14 ms, markers 476 ms, services 317 ms, reconcile 165 ms; `GET /_feltkit/health` → `{"status":"ready","application":"companyos","environment":"production"}`; then SIGTERM → "Stopped cleanly" |

**Mistakes during verification, recorded:**
1. The first start-up did not export `.env.local`, so it ran on a fresh local store
   (`.feltkit/production/state`, git-ignored). Its "ready" proves nothing about Managed FeltDB and is not
   counted.
2. One attempt stopped early because of a wrong PID; the server was then found and stopped by its own
   PID.

**New finding: CompanyOS's managed configuration has no `FELTKIT_API_KEY_VERIFIER_KEY`.** On a
FeltDB server, FeltKit 0.3.14 refuses to start production without one ("services.apiKeys needs
FELTKIT_API_KEY_VERIFIER_KEY when production state is on a FeltDB server"). The verification
start-up used a throwaway random key held only in that process's environment, never written
anywhere. No API keys were issued, so nothing depends on it. **Before CompanyOS runs on Managed
FeltDB for real, the owner sets a permanent key (32+ random bytes) in the secret manager**, the same
for every process. Changing it later invalidates every issued API key.
