# FeltKit extraction and code-economics audit

Measured 2026-11-04 on commit `a305197` (working tree identical for the files counted). No
earlier extraction audit exists in this repository; this is the first. Recommendations are
not implemented (no upstream or product changes were made for this audit).

## Method (reproducible)

Counts are **non-blank lines of committed files** (`git ls-files`). Exclusions, to avoid
double-counting:
- generated code (`feltkit/_generated/api.ts`, 17 lines);
- `package-lock.json`, `evidence/`, `docs/`;
- starter files kept unchanged (`src/main.tsx` 15, `src/theme.tsx` 53; `git diff abf3f95` is
  empty);
- the synthetic seed (`feltkit/seed.ts`, 219), counted separately;
- tests, scripts and tools, counted separately from product code.

```bash
for f in $(git ls-files 'feltkit/*.ts' | grep -v _generated); do printf "%s %s\n" "$(grep -cv '^\s*$' $f)" $f; done
```

```bash
span(){ awk -v s="$2" -v e="$3" 'NR>=s && NR<=e && $0 !~ /^[[:space:]]*$/' "$1" | wc -l; }
```

`span file start end` measures one construct between line numbers found with `grep -n`.
Exact constraint counts come from loading `feltkit/app.ts` (21 unique constraints on 19
collections; 18 indexes on 11 collections).

## Totals

| Category | Non-blank lines | Notes |
|---|---|---|
| Backend product code (`feltkit/`, excl. generated, seed) | **2,549** | 14 modules |
| Frontend product code (`src/`, excl. unchanged starter files) | **1,101** | 5 files |
| **Product code** | **3,650** | the starter's backend was 262 and its `App.tsx` 500 |
| Agent runner (`agents/runner.ts`) | 102 | example agent process |
| Synthetic seed (`feltkit/seed.ts`) | 219 | data, not logic |
| Tests (`tests/`) | 725 | 9 files |
| Scripts (`scripts/`) | 879 | of which the operator-evaluation harness is 401 |
| Test supplier (`tools/`) | 59 | not part of CompanyOS |

Backend by module:

| Module | Lines |
|---|---|
| `app.ts` | 412 |
| `agents.ts` | 391 |
| `purchasing.ts` | 349 |
| `changes.ts` | 279 |
| `integrations.ts` | 222 |
| `org.ts` | 188 |
| `policies.ts` | 164 |
| `incidents.ts` | 130 |
| `reports.ts` | 110 |
| `_lib.ts` | 104 |
| `operations.ts` | 86 |
| `_scope.ts` | 56 |
| `_invoicing.ts` | 39 |
| `inbox.ts` | 19 |

## Classification

### 1. Exists only as a workaround for a platform gap: about 141 lines (3.9% of product code)

| Construct | Lines | Gap | Evidence it is a workaround | Note |
|---|---|---|---|---|
| `_lib.ts actor()`: refuse departed people and suspended agents | 13 | G-01, G-02 | Scenario 5 (account cannot be disabled), W15 (a new session to a suspended agent is refused only by CompanyOS) | Covers only CompanyOS functions; FeltKit-level access (services, integrations) is not stopped |
| `_scope.ts`: assignment scope, capability→permission map, permission matching | 56 | G-04 (+ DX) | F-029; integration operations run before any CompanyOS code, so they are not covered | 21 of the 56 lines are a hand-kept capability→permission map duplicating each function's `access` |
| `src/ui.tsx` `useAgentTask` + `mcpTool` + types: read agent state over `/mcp` | 32 | G-07 | F-006: `_feltdb.AgentTask` is unreadable from app code | JSON-RPC from the browser, untyped |
| `agents.detail` "Why it may act" | 19 | DX gap | Re-derives the decision that `AgentHost.tools(principal)` (`feltkit_context`) already returns as `allowed`, because app code cannot call it | Correct today (W02 agreed with FeltKit), but can drift |
| "Last heard from the agent" (component 10, backend 2) | 12 | F-047 | No liveness signal in FeltKit | Infers liveness from writes only |
| Studio hint and deep link | 4 | G-07, F-043 | Approval happens only in Studio | |
| `onOutcome` operation derivation (2) + `subject` routed through GitHub inputs (3) | 5 | G-09 (F-019, F-021) | Payload lacks `operation`; no context passthrough | `subject` is sent to GitHub as a query parameter |

The line count is small; the **cost is not**. These workarounds:
- cover CompanyOS's own functions only, not the platform's other interfaces;
- duplicate data that can drift (the agent registry's `roles` vs. the session's roles, E-08;
  the capability map vs. `access`);
- are the parts the operator evaluation found weakest (W05, W15).

Extraction should be justified by enforcement coverage and consistency, not by lines saved.

### 2. Should become FeltKit primitives

| Primitive | Replaces | Lines removed in CompanyOS | Evidence |
|---|---|---|---|
| Account disable/enable and per-account roles; session revocation as a permissioned capability | `actor()` departed/suspended checks; the CLI steps in the runbook | 13 (+ runbook steps) | F-010, F-011, F-023, F-025; Scenario 5; W15 |
| Typed agent read and approval API for applications | `useAgentTask`/`mcpTool`; Studio hints; the second approval inbox | 36 | F-006, F-007; W06–W09 (3–6 context switches) |
| Per-task capability scopes on agent sessions | `withinAssignment()` | ~35 | F-029; integration ops uncovered |
| Approval provenance on `ctx` | none (gap left open) | 0 (adds missing data) | F-008; Scenario 3 timeline lacks the approver |
| Agent liveness (last seen, heartbeat) on tasks | "last heard" | 12 | F-047; W13 |
| Durable `onOutcome` delivery + exported payload type + context field | operation derivation, `subject` hack; silent loss | 5 (and a class of silent failures) | F-018, F-019, F-021; Scenario 4 first run |
| Managed contract parity (`unique`, indexes) and client/server version check | none (platform only) | 0 | F-041, F-048, F-051 |

### 3. FeltKit DX and documentation improvements

| Improvement | Effect on CompanyOS | Evidence |
|---|---|---|
| Expose capability metadata (`access`, approval, effect) and an "explain authority for principal" call to app code | remove the 21-line capability map, the 7-line duplicate in `src/operator.tsx`, and most of "Why it may act" (~45 lines) | §1; `runtime.functions()` and `AgentHost.tools()` exist but are not on `ctx` |
| An agent/MCP client in the SDK | the 3 hand-written MCP clients (`agents/runner.ts` 23, `scripts/demo-dev.ts` 18, `scripts/production-lifecycle.ts` 17 = 58 lines) collapse to one call site each. **Unverified** whether the installed `@appport/client` already covers this | `jsonrpc` sites in 3 files |
| `onOutcome` payload documented and typed | avoids F-019 | Scenario 4 |
| Runnable managed setup commands, scaffold `.gitignore` for credentials, complete `.env.example` | n/a (operations) | F-024, F-037, F-039 |

### 4. Should remain application code: about 3,450 lines

Business authority and approval chains (`_lib.ts` policy and grant helpers, `purchasing.ts`),
policies as effective-dated configuration (`policies.ts`), invoicing and reconciliation
(`_invoicing.ts`, `purchasing.ts`), organization and departures (`org.ts`), change lifecycle
and evidence gates (`changes.ts`), incidents and process checks (`incidents.ts`), reporting
and the data fingerprint (`reports.ts`), customer and work (`operations.ts`), integration
*business* handling (link health, import, isolation in `integrations.ts`), the assignment
model, interventions, business verification and metrics (`agents.ts` except §1), and the UI.

**Evidence:** these encode Meridian Works' rules: limits, separation of duties, chains fixed
at submission, cross-channel deduplication, departure transfers. The gap report argues the
platform should provide attribute-aware checks (G-06), not these rules.

Domain history (`timeline` + `record()`, 12-line writer, 67 call sites) is application
responsibility. Part of its *need* comes from platform gaps: the activity log is bounded and
unreadable (F-009), and the approver is unavailable (F-008).

### 5. Unnecessary or accidental complexity

| Item | Lines | Why | Fix (application, not done) |
|---|---|---|---|
| Capability map duplicated in the UI (`PERM`, `permissionFor`, `CAPABILITIES`) | 7 | copy of `_scope.ts` | serve it from a query |
| Three MCP clients | ~35 removable | written three times | one shared module |
| R1 checkout duplicated (`scenario-3` inline + `tests/_r1.ts`) | 8 | test duplication | use `_r1.ts` |
| `agents.roles` stored in the registry | data, not lines | can drift from the session's real roles (E-08) | derive from the platform once G-01 exists |

## Summary

- Of 3,650 lines of product code, about **141 (3.9%) exist only because of platform gaps**,
  about **50 are accidental duplication**, and about **3,450 are legitimate application
  code**.
- The case for extraction rests on **enforcement and consistency**, not code volume.
  The workarounds:
  - protect only CompanyOS's own functions;
  - leave platform interfaces uncovered (integration operations, a new session for a
    suspended agent);
  - duplicate state that can drift.
- The highest-value extractions, in evidence order:
  1. account and session control (G-01/G-02);
  2. the application-facing agent control surface (G-07);
  3. durable integration outcomes (G-09);
  4. managed-contract parity and version checks (G-15/G-16).
