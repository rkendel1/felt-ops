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
| [EXTRACTION-AUDIT](docs/EXTRACTION-AUDIT.md) | What should move into FeltKit, measured in code |
| [PRODUCTION-RUNBOOK](docs/PRODUCTION-RUNBOOK.md) | Deploy, configure, release, upgrade, back up, restore, respond |
| [FINAL-EVALUATION](docs/FINAL-EVALUATION.md) | Executive assessment and scores |

FeltKit's own documentation ships with the package (`npx feltkit docs`).

## Public demo deployment

This starter deploys as a public demo: visitors skip sign-in and land in the app, with demo data loaded. Every
FeltKit starter does it the same way, with FeltKit's own Fly.io deployment.

### Deploy the demo to Fly.io

```bash
npm run deploy:demo
```

```bash
npx feltkit fly deploy
```

`deploy:demo` builds and verifies FeltKit's normal Fly.io artifact (`npx feltkit deploy --target fly`, in
`.feltkit/deploy`), then `scripts/demo-artifact.mjs` changes only how the container starts. `npx feltkit fly deploy`
deploys it exactly as it would a production build: it creates the Fly app and its volume the first time.

- The demo is its own Fly app, **`companyos-demo`** (https://companyos-demo.fly.dev), never the production app `companyos`. To
  name it differently, set `"feltkitDemo": { "flyApp": "<name>" }` in `package.json` (or `DEMO_FLY_APP`).
- The container runs `scripts/demo-server.mjs`: the app in FeltKit's **development** environment, so its dev users
  are offered and the app signs each visitor in as the first one. Once the server is up it loads the demo data
  through the app's own functions (`scripts/demo-seed.ts`: the Meridian Works company, as `scripts/seed-dev.ts` does). Data and FeltKit's development files are on the Fly volume, so a redeploy
  keeps them and loads nothing twice.
- To publish a change, run both commands again.

Try the same thing locally:

```bash
npm run build
```

```bash
npm run start:demo
```

| Variable | Effect |
|---|---|
| `PORT` / `HOST` | where it listens (default: FeltKit's port from 3000, `0.0.0.0`) |
| `FELTKIT_STATE_DIR` | where the demo data lives (the Fly image sets `/data/state`) |
| `DEMO_SEED=0` | serve without loading demo data |

**Demo only.** Every visitor acts as a dev user, with that user's roles (including admin and operator roles), on
one shared copy of the data, and development mode relaxes production safeguards. Never give a demo deployment real
provider keys, credentials or customer data. For production, use `npx feltkit deploy --target fly` without
`scripts/demo-artifact.mjs`.

### Make your own FeltKit app a demo

The same four pieces work in any FeltKit app:

1. **Dev users** are who visitors become. Declare them in `feltkit/app.ts`; the first is the default, so give it
   the roles a visitor should have. FeltKit offers them only in development, never in production.

   ```ts
   dev: { users: [{ id: "ada", name: "Ada Lovelace", roles: ["admin"] }, { id: "grace", name: "Grace Hopper", roles: ["member"] }] },
   ```

2. **Sign visitors in.** Before the app shows its sign-in screen, sign in as the first dev user when the server
   offers dev users. In production the list is empty, so this does nothing there.

   ```tsx
   import { useEffect, useRef } from "react";
   import { useSession } from "@feltdb/feltkit/react";

   export function useDevSignIn() {
     const { session, signInAsDevUser } = useSession();
     const tried = useRef(false);
     useEffect(() => {
       if (session && !session.principal && session.devUsers.length && !tried.current) {
         tried.current = true;
         void signInAsDevUser(session.devUsers[0]!.id);
       }
     }, [session, signInAsDevUser]);
   }
   ```

   CompanyOS does this in `src/App.tsx` (as Otto).

3. **Demo data** in `scripts/demo-seed.ts`: sign in as a dev user and call your app's own functions over HTTP, the
   way a person would. Make each step safe to repeat; it runs on every start. In a multi-tenant app, create the
   tenant for the dev user visitors become (`scripts/demo-seed.ts` here seeds one shared company as Ivy).

   ```ts
   import { createClient } from "@feltdb/feltkit/client";
   import { api } from "../feltkit/_generated/api.js";

   let token: string | null = null;
   const ada = createClient({ url: process.argv[2], session: "bearer", tokens: { get: () => token, set: (t) => void (token = t) }, context: false });
   await ada.signInAsDevUser("ada");
   // Your app's own seed function, which refuses once its data is there.
   await ada.mutation(api.demo.seed, {}).catch((e) => { if (e.code !== "FAILED_PRECONDITION") throw e; });
   ```

4. **The launcher and the Fly step**: copy `scripts/demo-server.mjs` and `scripts/demo-artifact.mjs` from this
   repository unchanged (every starter has the same files), and add the scripts:

   ```json
   "start:demo": "node scripts/demo-server.mjs",
   "deploy:demo": "feltkit deploy --target fly && node scripts/demo-artifact.mjs"
   ```

   If the seed needs other files at runtime, list them: `"feltkitDemo": { "include": ["scripts/seed.ts"] }`.

Then deploy as above: `npm run deploy:demo`, then `npx feltkit fly deploy`.
