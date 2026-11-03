# CompanyOS: implemented product specification (0.1)

What CompanyOS 0.1 does, as built and tested. The original brief (product spec v0.1, November
2026) is the source of the requirements. This document states what was implemented, how,
and what was left out.

## Company

Meridian Works, synthetic: 150 people (3 departed), 7 departments (Executive, Finance,
Operations, Procurement, Product, Engineering, IT & Security; the brief's table lists 7), 9
teams (4 operating, 3 product, 2 management), 12 suppliers, 20 customers with contracts and
SLAs, 7 budgets, 39 purchase requests with policy-derived approval chains, 30 matched
invoices whose commitments reconcile, 5 projects, and 5 registered agents. 11 people have
sign-in identities in development.

## Domains and capabilities

| Domain | Implemented | Not implemented |
|---|---|---|
| Organization & identity | departments, teams, people, explicit authority grants with limits and departments, transfer with provenance, departure workflow, person history, "why you can/cannot approve" | invitations, employment transitions other than departure, resource-level ACLs beyond authority grants |
| Customers & commerce | customers, contracts, SLA hours, issues with SLA due dates and breach reporting | orders/deliveries, renewals workflow |
| Procurement & finance | suppliers + onboarding workflow, purchase requests with policy-driven chains, POs, receipts, invoices (manual + supplier feed), commitments, budgets, reconciliation (duplicates, over-commitment), duplicate reversal under approval | payment runs, three-way match tolerance rules |
| Work management | projects, work items, dependencies, completion evidence, agent takeovers | escalation rules, workflow designer |
| Policies | versioned rules, effective dates, author/approver separation, impact preview, behavior verification, acknowledgments | exceptions to policies |
| Operational intelligence | dashboard KPIs, department budget utilization, SLA breaches, incidents, agent attention, changes in flight, data fingerprint | historical trend comparison |
| Product & engineering | change requests (three kinds), requirements, acceptance criteria, gated lifecycle, observed GitHub evidence, releases, runtime identity verification | architecture decision records, security findings, code review records |
| DevOps | GitHub integration (commits, runs, PRs), CI on GitHub Actions, `feltkit deploy` artifact, local production, release verification against the running commit, backup/restore drill | Fly/Vercel (untested), automated rollback records |
| Incidents | detection (agent or person), dedup into the open incident, severity, process, affected records, root cause, linked change, resolution gated on the process check, post-incident review | paging, SLAs on incidents |
| Agent operations | registry, authority explanation, assignment with narrowing, monitoring (three lanes + live FeltKit actions + cross-subject changes), interventions, reassignment to agent or person, independent verification, effectiveness metrics, real agent runner over MCP | approvals inside CompanyOS (platform gap G-07), metered cost, model-driven agents |

## Interfaces

- **Web app:** workspaces Overview, Approvals, Organization, Work, Purchasing, Suppliers,
  Finance, Policies, Customers, Changes, Releases, Incidents, Integrations, Agent operations,
  Effectiveness, Evidence explorer. Hash routes deep-link to agents, assignments, changes,
  incidents, people, purchases and policies.
- **AppPort / MCP:** 23 CompanyOS capabilities plus `supplierapi.*` and `github.*`, all
  published with output schemas. Agents use them over `/mcp`.
- **Scripts:** `seed-dev`, `demo-dev`, `production-lifecycle`, `scenario-6-live`,
  `scenario-7-platform-upgrade`, `fingerprint`; agent runner `agents/runner.ts`; test supplier
  `tools/supplier-api.ts`.

## Domain boundaries

See ARCHITECTURE.md §2. In short: FeltKit owns identity, permission decisions, agent action
lifecycle and durable state. External systems own their facts. CompanyOS owns business
authority, configuration, assignments and business verification.
