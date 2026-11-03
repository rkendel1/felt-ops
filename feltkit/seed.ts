/**
 * Seed a synthetic but internally consistent company: Meridian Works, 150 people, explicit
 * authority, a purchasing history whose books reconcile, customers, projects, registered
 * agents and a supplier integration link. All names and figures are invented.
 *
 * Runs once, on an empty organization, as an administrator.
 */
import { fail, s } from "@feltdb/feltkit";
import type { MutationCtx } from "@feltdb/feltkit";
import {
  agents, app, authorities, budgets, commitments, contracts, customerIssues, customers, departments, invoices, people, policies, policyVersions,
  projects, purchaseOrders, purchaseRequests, supplierLinks, suppliers, teams, workItems,
} from "./app.js";
import { nextNumber, record } from "./_lib.js";

const DEPARTMENTS = [
  { code: "EXEC", name: "Executive", responsibilities: ["Strategy", "Organizational decisions", "Financial authority"], size: 6 },
  { code: "FIN", name: "Finance", responsibilities: ["Budgets", "Invoices", "Spending approvals"], size: 18 },
  { code: "OPS", name: "Operations", responsibilities: ["Customers", "Purchasing requests", "Service delivery"], size: 40 },
  { code: "PROC", name: "Procurement", responsibilities: ["Suppliers", "Purchase orders", "Contracts"], size: 12 },
  { code: "PROD", name: "Product", responsibilities: ["Requirements", "Prioritization", "Business change"], size: 14 },
  { code: "ENG", name: "Engineering", responsibilities: ["Application development", "Maintenance"], size: 42 },
  { code: "ITSEC", name: "IT & Security", responsibilities: ["Access", "Infrastructure", "Incidents", "Security reviews"], size: 18 },
];

const TEAMS = [
  { name: "Leadership", dept: "EXEC", kind: "management" },
  { name: "AP & Treasury", dept: "FIN", kind: "operating" },
  { name: "Customer Delivery", dept: "OPS", kind: "operating" },
  { name: "Sourcing", dept: "PROC", kind: "operating" },
  { name: "Service Desk", dept: "ITSEC", kind: "operating" },
  { name: "Purchasing Platform", dept: "ENG", kind: "product" },
  { name: "Finance Platform", dept: "ENG", kind: "product" },
  { name: "Platform & Reliability", dept: "ENG", kind: "product" },
  { name: "Product Management", dept: "PROD", kind: "management" },
] as const;

/** People who sign in (dev identities). */
const NAMED = [
  { login: "omar", name: "Omar Haddad", title: "Chief Executive Officer", dept: "EXEC", team: "Leadership" },
  { login: "maria", name: "Maria Chen", title: "Chief Financial Officer", dept: "FIN", team: "Leadership" },
  { login: "fiona", name: "Fiona Walsh", title: "Finance Manager", dept: "FIN", team: "AP & Treasury" },
  { login: "rhea", name: "Rhea Das", title: "Senior Accountant", dept: "FIN", team: "AP & Treasury" },
  { login: "priya", name: "Priya Nair", title: "Operations Director", dept: "OPS", team: "Customer Delivery" },
  { login: "pablo", name: "Pablo Ruiz", title: "Procurement Lead", dept: "PROC", team: "Sourcing" },
  { login: "dana", name: "Dana Kim", title: "Product Manager", dept: "PROD", team: "Product Management" },
  { login: "eli", name: "Eli Novak", title: "Engineering Lead", dept: "ENG", team: "Purchasing Platform" },
  { login: "sam", name: "Sam Osei", title: "Software Engineer", dept: "ENG", team: "Finance Platform" },
  { login: "ivy", name: "Ivy Brennan", title: "IT & Security Manager", dept: "ITSEC", team: "Service Desk" },
  { login: "otto", name: "Otto Lind", title: "Agent Operations Lead", dept: "OPS", team: "Customer Delivery" },
] as const;

const FIRST = ["Alex", "Bea", "Carlos", "Dee", "Emil", "Farah", "Gil", "Hana", "Ian", "Jade", "Kofi", "Lena", "Milo", "Nia", "Owen", "Pia", "Quinn", "Rosa", "Seth", "Tara", "Uma", "Vik", "Wren", "Yara", "Zeke"];
const LAST = ["Abbott", "Bauer", "Cruz", "Dalton", "Eze", "Fischer", "Grant", "Holm", "Iqbal", "Jensen", "Kaur", "Lopez", "Moss", "Ng", "Okafor", "Price", "Reyes", "Sato", "Toivonen", "Ueda", "Varga", "Wolfe"];
const TITLES: Record<string, string[]> = {
  EXEC: ["Chief Operating Officer", "Chief People Officer", "Executive Assistant", "Strategy Director"],
  FIN: ["Accountant", "AP Specialist", "Financial Analyst", "Payroll Specialist", "Treasury Analyst"],
  OPS: ["Service Coordinator", "Account Manager", "Delivery Specialist", "Customer Success Manager", "Operations Analyst"],
  PROC: ["Buyer", "Sourcing Specialist", "Contract Analyst"],
  PROD: ["Product Manager", "Product Designer", "Business Analyst"],
  ENG: ["Software Engineer", "Senior Software Engineer", "QA Engineer", "Site Reliability Engineer", "Staff Engineer"],
  ITSEC: ["Systems Administrator", "Security Analyst", "Service Desk Analyst", "Network Engineer"],
};
const SUPPLIERS = [
  ["Northwind Components", "Hardware"], ["Contoso Cloud", "Hosting"], ["Fabrikam Logistics", "Freight"], ["Tailspin Office", "Office supplies"],
  ["Litware Security", "Security services"], ["Adatum Analytics", "Software"], ["Proseware Consulting", "Professional services"], ["Wingtip Facilities", "Facilities"],
  ["Lucerne Print", "Printing"], ["Alpine Ski House Events", "Events"], ["Coho Telecom", "Telecom"],
] as const;
const CUSTOMERS = ["Blue Yonder Airlines", "Trey Research", "Margie's Travel", "City Power & Light", "Graphic Design Institute", "Humongous Insurance", "Relecloud", "Southridge Video", "VanArsdel", "Woodgrove Bank", "Bellows College", "School of Fine Art", "Datum Health", "Fourth Coffee", "Wide World Importers", "The Phone Company", "Consolidated Messenger", "Northwind Traders", "Lamna Healthcare", "Munson's Pickles"];

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const day = (n: number) => new Date(Date.UTC(2026, 6, 1) + n * 86_400_000).toISOString();

async function seedAll(ctx: MutationCtx, by: { id: string; type: string }) {
  const r = rng(20261103);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const deptId: Record<string, string> = {};
  for (const d of DEPARTMENTS) deptId[d.code] = await ctx.db.insert(departments, { code: d.code, name: d.name, responsibilities: d.responsibilities });
  const teamId: Record<string, string> = {};
  for (const t of TEAMS) teamId[t.name] = await ctx.db.insert(teams, { name: t.name, departmentId: deptId[t.dept]!, kind: t.kind });

  const login: Record<string, string> = {};
  for (const n of NAMED) {
    login[n.login] = await ctx.db.insert(people, { login: n.login, name: n.name, email: `${n.login}@meridian.example`, title: n.title, departmentId: deptId[n.dept]!, teamId: teamId[n.team]!, status: "active", startedOn: "2021-03-01" });
  }
  const heads: Record<string, string> = { EXEC: login.omar!, FIN: login.maria!, OPS: login.priya!, PROC: login.pablo!, PROD: login.dana!, ENG: login.eli!, ITSEC: login.ivy! };
  for (const [code, id] of Object.entries(heads)) await ctx.db.patch(departments, deptId[code]!, { headId: id });
  for (const t of TEAMS) await ctx.db.patch(teams, teamId[t.name]!, { leadId: heads[t.dept]! });
  await ctx.db.patch(people, login.fiona!, { managerId: login.maria! });
  await ctx.db.patch(people, login.rhea!, { managerId: login.fiona! });

  let n = 0;
  const used = new Set<string>(NAMED.map((x) => x.name));
  for (const d of DEPARTMENTS) {
    const named = NAMED.filter((x) => x.dept === d.code).length;
    const deptTeams = TEAMS.filter((t) => t.dept === d.code).map((t) => teamId[t.name]!);
    for (let i = named; i < d.size; i += 1) {
      let name = `${pick(FIRST)} ${pick(LAST)}`;
      while (used.has(name)) name = `${pick(FIRST)} ${pick(LAST)}`;
      used.add(name);
      n += 1;
      const departed = n % 37 === 0;
      await ctx.db.insert(people, {
        name, email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@meridian.example`, title: pick(TITLES[d.code]!), departmentId: deptId[d.code]!,
        ...(deptTeams.length ? { teamId: pick(deptTeams) } : {}), managerId: d.code === "FIN" && i < 8 ? login.fiona! : heads[d.code]!,
        status: departed ? "departed" : "active", startedOn: `20${18 + Math.floor(r() * 8)}-0${1 + Math.floor(r() * 9)}-15`, ...(departed ? { leftOn: "2026-06-30" } : {}),
      });
    }
  }

  // Explicit business authority.
  const g = async (who: string, kind: string, limit?: number, dept?: string) =>
    ctx.db.insert(authorities, { holderId: login[who]!, holderType: "person", kind, status: "active", grantedBy: "seed", grantedAt: day(0), ...(limit !== undefined ? { limit } : {}), ...(dept ? { departmentId: deptId[dept]! } : {}) });
  for (const [code, who] of Object.entries({ EXEC: "omar", FIN: "fiona", OPS: "priya", PROC: "pablo", PROD: "dana", ENG: "eli", ITSEC: "ivy" })) await g(who, "purchase.approve.manager", 25_000, code);
  await g("maria", "purchase.approve.manager", 25_000, "FIN");
  await g("fiona", "purchase.approve.finance", 100_000);
  await g("rhea", "purchase.approve.finance", 25_000);
  await g("maria", "purchase.approve.finance");
  await g("omar", "purchase.approve.executive");
  await g("maria", "purchase.approve.executive");
  await g("maria", "policy.approve.finance");
  await g("omar", "policy.approve.finance");
  await g("fiona", "invoice.approve", 50_000);

  // Business configuration: purchasing approval policy v1.
  const policyId = await ctx.db.insert(policies, { key: "purchasing.approval", title: "Purchasing approval thresholds", ownerDepartmentId: deptId.FIN!, workflows: ["purchase-request approval", "purchase-order issue"], approvalKind: "policy.approve.finance" });
  const v1 = await ctx.db.insert(policyVersions, {
    policyId, version: 1, effectiveFrom: "2026-01-01T00:00:00.000Z", status: "approved", authorId: login.fiona!, decidedBy: login.maria!, decidedAt: "2025-12-15T10:00:00.000Z",
    rationale: "FY2026 thresholds.",
    rules: { tiers: [
      { upTo: 5_000, steps: [{ kind: "purchase.approve.manager", label: "Department manager", scope: "department" }] },
      { upTo: 25_000, steps: [{ kind: "purchase.approve.manager", label: "Department manager", scope: "department" }, { kind: "purchase.approve.finance", label: "Finance" }] },
      { upTo: null, steps: [{ kind: "purchase.approve.manager", label: "Department manager", scope: "department" }, { kind: "purchase.approve.finance", label: "Finance" }, { kind: "purchase.approve.executive", label: "Executive" }] },
    ] },
  });
  const travel = await ctx.db.insert(policies, { key: "expenses.travel", title: "Travel and expenses", ownerDepartmentId: deptId.FIN!, workflows: ["expense claims"], approvalKind: "policy.approve.finance" });
  await ctx.db.insert(policyVersions, { policyId: travel, version: 1, effectiveFrom: "2026-01-01T00:00:00.000Z", status: "approved", authorId: login.fiona!, decidedBy: login.omar!, decidedAt: "2025-12-15T10:00:00.000Z", rationale: "FY2026 travel policy.", rules: { dailyMeals: 75, hotelCap: 250, bookingLeadDays: 14 } });

  // Suppliers, budgets.
  const supplierIds: string[] = [];
  for (const [name, category] of SUPPLIERS) supplierIds.push(await ctx.db.insert(suppliers, { name, category, status: "active", riskTier: pick(["low", "low", "medium", "high"] as const), taxId: `TX-${100000 + supplierIds.length * 7919}`, bankVerified: true }));
  await ctx.db.insert(suppliers, { name: "Bluebird Packaging", category: "Packaging", status: "requested", requestedBy: login.priya! });
  const amounts: Record<string, number> = { EXEC: 400_000, FIN: 300_000, OPS: 1_800_000, PROC: 350_000, PROD: 250_000, ENG: 2_100_000, ITSEC: 900_000 };
  for (const d of DEPARTMENTS) await ctx.db.insert(budgets, { departmentId: deptId[d.code]!, fiscalYear: 2026, amount: amounts[d.code]! });

  // Purchasing history under v1: ordered requests, POs, invoices and commitments that reconcile.
  const v1Rules = (await ctx.db.get(policyVersions, v1))!.rules as { tiers: Array<{ upTo: number | null; steps: Array<{ kind: string; label: string; scope?: string }> }> };
  const approverFor: Record<string, (code: string) => string> = {
    "purchase.approve.manager": (code) => (code === "FIN" ? login.maria! : login[{ EXEC: "omar", OPS: "priya", PROC: "pablo", PROD: "dana", ENG: "eli", ITSEC: "ivy" }[code] ?? "omar"]!),
    "purchase.approve.finance": () => login.fiona!,
    "purchase.approve.executive": () => login.omar!,
  };
  const requesters: Record<string, string> = { OPS: "otto", ENG: "sam", PROC: "pablo", ITSEC: "ivy", PROD: "dana", FIN: "rhea" };
  let northwindPo = "";
  for (let i = 0; i < 36; i += 1) {
    const code = pick(Object.keys(requesters));
    const requester = login[requesters[code]!]!;
    const supplierIndex = i % 6 === 0 ? 0 : 1 + Math.floor(r() * (SUPPLIERS.length - 1));
    const amount = Math.round((r() < 0.6 ? 500 + r() * 4_000 : r() < 0.85 ? 5_000 + r() * 18_000 : 26_000 + r() * 60_000) * 100) / 100;
    const tier = v1Rules.tiers.find((t) => t.upTo === null || amount <= t.upTo)!;
    const steps = tier.steps.map((st, k) => {
      let approver = approverFor[st.kind]!(code);
      if (approver === requester) approver = login.maria!;
      return { kind: st.kind, label: st.label, ...(st.scope ? { departmentId: deptId[code]! } : {}), assigneeId: approver, decision: "approved" as const, decidedBy: approver, decidedAt: day(i * 3 + k) };
    });
    const number = await nextNumber(ctx, "PR");
    const reqId = await ctx.db.insert(purchaseRequests, { number, departmentId: deptId[code]!, supplierId: supplierIds[supplierIndex]!, requesterId: requester, amount, description: `${SUPPLIERS[supplierIndex]![1]} for ${DEPARTMENTS.find((d) => d.code === code)!.name}`, status: "ordered", policyVersionId: v1, steps, submittedAt: day(i * 3) });
    const poNumber = await nextNumber(ctx, "PO");
    const poId = await ctx.db.insert(purchaseOrders, { number: poNumber, requestId: reqId, supplierId: supplierIds[supplierIndex]!, departmentId: deptId[code]!, amount, status: i < 30 ? "received" : "issued", issuedAt: day(i * 3 + 2) });
    if (supplierIndex === 0) northwindPo = poNumber;
    if (i < 30) {
      const invId = await ctx.db.insert(invoices, { supplierId: supplierIds[supplierIndex]!, poId, number: `${SUPPLIERS[supplierIndex]![0].split(" ")[0]!.slice(0, 3).toUpperCase()}-${10_000 + i}`, amount, channel: supplierIndex === 0 ? "supplier-feed" : "manual", status: "matched", receivedAt: day(i * 3 + 9), enteredBy: supplierIndex === 0 ? "agent-sentry" : "rhea", ...(supplierIndex === 0 ? { externalId: `nw-del-${5000 + i}` } : {}) });
      await ctx.db.insert(commitments, { departmentId: deptId[code]!, poId, invoiceId: invId, amount, status: "open", createdAt: day(i * 3 + 9) });
    }
  }
  // Pending requests awaiting Fiona (Finance step) and department managers.
  for (const [i, [code, amount]] of ([["OPS", 8_400], ["ENG", 14_250], ["ITSEC", 3_100]] as const).entries()) {
    const tier = v1Rules.tiers.find((t) => t.upTo === null || amount <= t.upTo)!;
    const requester = login[requesters[code]!]!;
    const steps = tier.steps.map((st, k) => ({ kind: st.kind, label: st.label, ...(st.scope ? { departmentId: deptId[code]! } : {}), assigneeId: st.kind === "purchase.approve.finance" ? login.fiona! : approverFor[st.kind]!(code), ...(k === 0 && tier.steps.length > 1 ? { decision: "approved" as const, decidedBy: approverFor[st.kind]!(code), decidedAt: day(118 + i) } : {}) }));
    const number = await nextNumber(ctx, "PR");
    await ctx.db.insert(purchaseRequests, { number, departmentId: deptId[code]!, supplierId: supplierIds[1 + i]!, requesterId: requester, amount, description: ["Field service laptops", "Load-testing environment", "Badge readers"][i]!, status: "pending", policyVersionId: v1, steps, submittedAt: day(117 + i) });
  }
  await ctx.db.insert(supplierLinks, { supplierId: supplierIds[0]!, apiVersion: "v1", status: "healthy", lastSuccessAt: "2026-10-31T00:00:00.000Z", syncedThrough: "2026-10-31T00:00:00.000Z" });

  // Customers, contracts, issues.
  const owners = [login.priya!, login.otto!];
  for (const [i, name] of CUSTOMERS.entries()) {
    const cid = await ctx.db.insert(customers, { name, segment: pick(["enterprise", "mid-market", "public-sector"] as const), ownerId: owners[i % 2]!, status: i % 9 === 4 ? "at-risk" : "active" });
    const value = Math.round(40_000 + r() * 400_000);
    await ctx.db.insert(contracts, { customerId: cid, title: `${name} managed service`, annualValue: value, startsOn: "2026-01-01", endsOn: i % 5 === 0 ? "2026-12-31" : "2027-06-30", slaHours: pick([24, 48, 72]), status: i % 5 === 0 ? "renewal-due" : "active" });
    if (i % 3 === 0) await ctx.db.insert(customerIssues, { customerId: cid, title: pick(["Delivery delayed", "Invoice query", "Service outage report", "Change request"]), severity: pick(["low", "medium", "high"] as const), status: i % 2 === 0 ? "open" : "resolved", openedAt: day(110 + i), slaDueAt: day(112 + i) });
  }

  // Projects and work.
  const proj = async (name: string, kind: "business" | "engineering", owner: string, team: string, titles: string[]) => {
    const pid = await ctx.db.insert(projects, { name, kind, ownerId: login[owner]!, teamId: teamId[team]!, status: "active" });
    let prev: string | undefined;
    for (const [k, title] of titles.entries()) {
      const status = k < titles.length / 2 ? "done" : k === Math.floor(titles.length / 2) ? "doing" : "todo";
      const assignee = pick([login[owner]!, login.sam!, login.rhea!, login.otto!]);
      prev = await ctx.db.insert(workItems, { projectId: pid, title, status, assigneeId: assignee, dueOn: day(100 + k * 9).slice(0, 10), dependsOn: prev ? [prev] : [], ...(status === "done" ? { evidence: "Completed and reviewed." } : {}) });
    }
  };
  await proj("FY2026 close readiness", "business", "fiona", "AP & Treasury", ["Accrual schedule", "Vendor statement review", "Budget variance report", "Close calendar"]);
  await proj("Customer onboarding refresh", "business", "priya", "Customer Delivery", ["Map current onboarding", "Interview five customers", "Draft new playbook", "Pilot with two accounts"]);
  await proj("Supplier risk review", "business", "pablo", "Sourcing", ["Collect certificates", "Score suppliers", "Escalate high risk"]);
  await proj("Purchasing platform hardening", "engineering", "eli", "Purchasing Platform", ["Add request audit view", "Policy-driven approval chains", "Invoice matching tests", "Supplier feed monitoring"]);
  await proj("Access review Q4", "business", "ivy", "Service Desk", ["Export access list", "Manager attestations", "Remove stale accounts"]);

  // Registered agents (their sessions are issued separately with the same roles).
  const reg = async (key: string, name: string, purpose: string, roles: string[], owner: string) => {
    await ctx.db.insert(agents, { key, name, purpose, runtime: "companyos-agent-runner (Node, MCP over HTTP)", provider: "none (deterministic playbook)", model: "none", roles, ownerId: login[owner]!, status: "active", mayDelegate: false });
    await record(ctx, `agent:${key}`, by, "agent.registered", `${name} registered with ${roles.join(", ")}.`);
  };
  await reg("agent-ledger", "Ledger Reconciler", "Find and remediate commitment discrepancies; propose reversals of duplicates for finance approval.", ["agent-finance"], "otto");
  await reg("agent-ledger-2", "Ledger Reconciler (standby)", "Standby reconciler: takes over when the primary is unavailable.", ["agent-finance"], "otto");
  await reg("agent-sentry", "Integration Sentry", "Sync supplier feeds, detect failing integrations, isolate them and report incidents.", ["agent-integration"], "eli");
  await reg("agent-steward", "Access Steward", "Prepare offboarding: inventory a leaver's responsibilities and propose their transfer.", ["agent-access"], "ivy");
  await reg("agent-scribe", "Engineering Scribe", "Collect commit, pull request and CI evidence for change requests from GitHub.", ["agent-engineering"], "eli");

  return { departments: DEPARTMENTS.length, people: NAMED.length + n, suppliers: SUPPLIERS.length + 1, customers: CUSTOMERS.length, northwindPo, policyVersionId: v1 };
}

export const seed = app.mutation({
  access: "org.admin",
  returns: s.object({ departments: s.number(), people: s.number(), suppliers: s.number(), customers: s.number(), northwindPo: s.string(), policyVersionId: s.string() }),
  handler: async (ctx) => {
    if ((await ctx.db.count(departments, {})) > 0) fail("FAILED_PRECONDITION", "The organization is already seeded.");
    const p = ctx.auth.requirePrincipal();
    return seedAll(ctx, { id: p.id, type: p.type });
  },
});
