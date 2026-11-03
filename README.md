# CompanyOS

A living business and software operations platform, built on the published FeltKit stack
(`@feltdb/feltkit` 0.3.13: FeltDB 0.21.0, AppPort SDK 1.4.0, AppPort Services 0.14.0). It is
also a road test of that stack. The evaluation reports are in [`docs/`](docs/).

One application, one FeltDB instance per environment. It covers business operations
(organization, authority, purchasing, finance, policies, customers, work), product and
engineering operations (changes on three paths, GitHub evidence, releases, incidents), and
agent operations (registry, assignments, approvals, interventions, recovery, verification).

## Run it

Requires Node 22.

```bash
npm install
```

```bash
npm run dev
```

In a second terminal, seed the synthetic company (Meridian Works, 150 people) over HTTP:

```bash
npx tsx scripts/seed-dev.ts
```

Open http://localhost:3000. You are signed in as Otto Lind (agent operator). Switch identity
from the top bar; **Studio ↗** opens FeltKit Studio, where agent actions are approved.

Optional, for a mid-operation company with agents at work, a supplier feed, an incident and
pending approvals:

```bash
npx tsx tools/supplier-api.ts 4010
```

```bash
npx tsx scripts/demo-dev.ts
```

Run an agent (it works reconciliation assignments over MCP):

```bash
npx feltkit session create --type agent --id agent-ledger --role agent-finance
```

```bash
AGENT_TOKEN=<token> npx tsx agents/runner.ts --url http://localhost:3000
```

## Test and verify

| Command | What it proves |
|---|---|
| `npm test` | Foundation and scenarios 1–6 against fresh FeltDB instances (scenarios 3 and 6 run the defective release R1 from git history) |
| `npm run scenario:6-live` | Real agent processes over MCP: crash, revoked session, recovery, no duplicates |
| `npm run scenario:7` | Platform upgrade FeltKit 0.3.12 + FeltDB 0.20.0 → 0.3.13 + 0.21.0 on production data |
| `npx tsx scripts/production-lifecycle.ts …` | Scenario 2 end to end against a running production deployment (see the runbook) |
| `npm run typecheck`, `npm run build` | Types; backend bundle, schema contract and frontend |

CI (GitHub Actions) runs all of the above except the production lifecycle on every push.
Evidence files are written to `evidence/`.

## Where things are

| Path | What |
|---|---|
| `feltkit/app.ts` | Roles, identities, services, the 27 collections |
| `feltkit/org.ts`, `policies.ts`, `purchasing.ts`, `operations.ts` | Business domains |
| `feltkit/changes.ts`, `incidents.ts`, `integrations.ts`, `reports.ts` | Engineering, DevOps, integrations, reporting |
| `feltkit/agents.ts`, `_scope.ts` | Agent operations |
| `feltkit/_lib.ts`, `_invoicing.ts`, `seed.ts` | Shared rules, invoice processing, synthetic company |
| `src/` | Web app (operator workspace in `src/operator.tsx`) |
| `agents/runner.ts` | Agent process (MCP client, deterministic playbook) |
| `tools/supplier-api.ts` | Test supplier API (not part of CompanyOS) |
| `tests/`, `scripts/`, `evidence/` | Scenarios, live scripts, recorded evidence |

## Documents

| Document | Contents |
|---|---|
| [PRODUCT-SPEC](docs/PRODUCT-SPEC.md) | What was implemented, and what was not |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Boundaries, domain model, authority model, topology |
| [ROAD-TEST-BASELINE](docs/ROAD-TEST-BASELINE.md) | The published platform before CompanyOS |
| [ROAD-TEST-FINDINGS](docs/ROAD-TEST-FINDINGS.md) | Every defect, gap, workaround and untested area |
| [SCENARIO-RESULTS](docs/SCENARIO-RESULTS.md) | The seven scenarios with evidence |
| [AGENT-OPERATOR-GUIDE](docs/AGENT-OPERATOR-GUIDE.md) | For people who supervise agents |
| [AGENT-OPERATOR-EVALUATION](docs/AGENT-OPERATOR-EVALUATION.md) | Independent evaluation of the operator experience |
| [FELTKIT-GAP-REPORT](docs/FELTKIT-GAP-REPORT.md) | Prioritized platform gaps |
| [PRODUCTION-RUNBOOK](docs/PRODUCTION-RUNBOOK.md) | Deploy, configure, release, upgrade, back up, restore, respond |
| [FINAL-EVALUATION](docs/FINAL-EVALUATION.md) | Executive assessment and scores |

FeltKit's own documentation ships with the package (`npx feltkit docs`).
