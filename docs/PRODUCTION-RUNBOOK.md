# CompanyOS production runbook

Procedures as they were performed in the road test (2026-11-03), on the
`feltkit deploy --target container` artifact run with Node. Steps marked **untested** were
not exercised.

## 1. Build and verify an artifact

```bash
npm ci && npm test && npm run build
```

```bash
npx feltkit deploy --target container
```

`deploy` boots the production build against throwaway state and checks health and the
AppPort manifest before writing `.feltkit/deploy/`. Production state already inside it is
kept.

## 2. Configure

| Variable | Value | Note |
|---|---|---|
| `PORT` | e.g. `3100` | |
| `COMPANYOS_COMMIT` | `git rev-parse HEAD` of the release | lets *Releases → verify* prove which commit runs |
| `GITHUB_API_URL` | `https://api.github.com` | **not in FeltKit's `.env.example`** (F-024); without it GitHub calls answer `NOT_CONFIGURED` |
| `SUPPLIER_API_URL` | the supplier's API origin | same |
| `FELTKIT_CREDENTIAL_<ID>` | only if an integration declares a credential | none in 0.1 |

## 3. Start

```bash
cd .feltkit/deploy
```

```bash
npm ci --omit=dev
```

```bash
COMPANYOS_COMMIT=<sha> GITHUB_API_URL=https://api.github.com SUPPLIER_API_URL=<url> PORT=3100 npm start
```

The first start installs the schema (`Schema none → v1 applied`). Check health:

```bash
curl -s http://127.0.0.1:3100/_feltkit/health
```

Docker (`docker compose -f .feltkit/deploy/docker-compose.yml up --build`) and Fly
(`fly.toml`) are generated but **untested** here.

## 4. People and agents

Production has no development sign-in, and CompanyOS closes sign-up. Sessions are issued on
the host, **with the server stopped** (F-023):

```bash
npx feltkit session create --env production --type user --id ivy --role staff --role itsec --role operator --role admin
```

```bash
npx feltkit session create --env production --type agent --id agent-scribe --role agent-engineering
```

The `--id` must equal the person's `login` (or the agent's `key`) in CompanyOS, otherwise
CompanyOS refuses the caller. Built-in e-mail accounts cannot be linked to employees (F-025):
browser sign-in for employees in production is **not usable** in 0.1. Seed the organization
once with an admin session (`seed.seed`).

## 5. Release

1. CI green on the release commit (GitHub Actions).
2. *Changes*: the change reaches `ci-passed`, which requires the Engineering Scribe to have
   observed the commit and a successful run through the `github` integration.
3. Create the release (engineering), approve it (executive), deploy (§1–3), record the
   deployment, then **verify the release**: CompanyOS compares `COMPANYOS_COMMIT` with the
   release commit.
4. The business owner checks the acceptance criteria against production and accepts.

`scripts/production-lifecycle.ts` performs 2–4 and records evidence.

## 6. Platform upgrades (FeltKit / FeltDB)

Never bundled with application changes (a release refuses mixed kinds).

```bash
npm run scenario:7
```

This rehearses the path: old platform from npm, production activity, data baseline captured
by CompanyOS, tests on the new platform, new platform on the same state, data verified. For a
real upgrade:

1. Record the platform change, then *capture baseline* (`reports.captureBaseline`).
2. Run the full test suite on the new versions.
3. Approval, then deploy (§1–3); FeltKit checks and installs the schema at start, and refuses
   to serve on drift.
4. `reports.verifyData`; the change becomes `verified` only if counts and money totals match.

## 7. Backup and restore (performed)

```bash
pkill -f "feltkit start"
```

```bash
npx feltkit backup create --env production --out /backups/companyos-$(date +%F).backup
```

```bash
npx feltkit backup verify /backups/companyos-<date>.backup
```

Local production cannot be backed up while it runs (F-023). To restore, move the live state
aside (never delete it), then:

```bash
mv .feltkit/production/state /backups/state-moved-aside-$(date +%s)
```

```bash
npx feltkit backup restore /backups/companyos-<date>.backup --env production
```

Restore writes only into an empty environment. **Sessions are not in backups:** re-issue them
(§4). Then compare the business fingerprint before and after:

```bash
npx tsx scripts/fingerprint.ts <token> http://127.0.0.1:3100
```

Drill result: 569 records, identical fingerprint; old tokens refused.

## 8. Incident response

1. *Incidents*: the incident shows its process check (computed now), affected records and
   timeline. Detection by an agent is joined to the open incident.
2. Contain it. For an integration: `integrations.isolate` (the watermark holds).
3. Open the engineering change from the incident; set the root cause.
4. Remediate. Consequential agent actions (e.g. `commitments.reverse`) are approved in Studio
   by someone with the authority. CompanyOS refuses anything its rules do not allow, even if
   approved.
5. Resolve: refused until the process check passes. Record the post-incident review.

## 9. Agent recovery

See AGENT-OPERATOR-GUIDE §4:
1. Read the records, not the agent's last statement.
2. Suspend the agent.
3. Revoke its sessions (requires a stop in production).
4. Cancel its FeltKit task in Studio.
5. Reassign, then verify.

## 10. Rollback

Rollback = deploy the previous release's artifact on the same state. The schema is checked at
start; a release that migrated the state may not run on the previous code. In that case
restore the pre-deployment backup (§7). FeltKit's platform PR 3 automates this for
`deploy.apply`; CompanyOS did not use the platform operations server. **Untested** here.

## 11. Monitoring

Only `/_feltkit/health`, stdout and the activity log are available (`readiness` lists
monitoring, TLS, rate limiting and secret provisioning as outside FeltKit). The Overview
dashboard and the incident process checks are the business-level signals.
