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
