/**
 * Put a running, seeded development server into a realistic mid-operation state, through
 * real interfaces only: people through the app's HTTP client, agents through /mcp with
 * agent sessions issued by `feltkit session create`, the supplier through its HTTP API.
 *
 *   npx feltkit dev                      # terminal 1
 *   npx tsx tools/supplier-api.ts 4010   # terminal 2 (the integration's development URL)
 *   npx tsx scripts/seed-dev.ts && npx tsx scripts/demo-dev.ts
 *
 * Afterwards: the Access Steward's offboarding proposal waits for approval in Studio, the
 * Integration Sentry has found the supplier's v1 API retired (incident open, link isolated),
 * a policy draft waits for the CFO, and an application change is specified.
 */
import { spawnSync } from "node:child_process";
import { createClient } from "@feltdb/feltkit/client";
import { api } from "../feltkit/_generated/api.js";

const url = process.argv[2] ?? "http://localhost:3000";
const supplier = process.env.SUPPLIER_API_URL ?? "http://127.0.0.1:4010";

function person(id: string) {
  let token: string | null = null;
  const c = createClient({ url, tokens: { get: () => token, set: (t) => { token = t; } } });
  return { ready: c.signInAsDevUser(id), c };
}
async function as(id: string) { const p = person(id); await p.ready; return p.c; }

function agentToken(id: string, role: string) {
  const r = spawnSync("npx", ["feltkit", "session", "create", "--type", "agent", "--id", id, "--role", role, "--label", "demo-dev"], { encoding: "utf8" });
  const token = r.stdout.split("\n").map((l) => l.trim()).find((l) => /^[A-Za-z0-9_-]{30,}$/.test(l));
  if (!token) throw new Error(`no token for ${id}: ${r.stdout}${r.stderr}`);
  return token;
}
function mcp(token: string) {
  let id = 0;
  let names = new Map<string, string>();
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const res = await fetch(`${url}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    const body = await res.json() as { result?: { isError?: boolean; content?: Array<{ text: string }>; structuredContent?: { result?: unknown } }; error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result!;
  };
  return {
    async init() { await rpc("initialize", { protocolVersion: "2025-06-18" }); const t = (await rpc("tools/list")) as unknown as { tools: Array<{ name: string }> }; names = new Map(t.tools.map((x) => [x.name.replace(/_/g, "."), x.name])); },
    async call<T>(cap: string, args: Record<string, unknown> = {}): Promise<T> {
      const r = await rpc("tools/call", { name: names.get(cap) ?? cap, arguments: args });
      if (r.isError) throw new Error(r.content?.[0]?.text);
      return (r.structuredContent?.result ?? JSON.parse(r.content?.[0]?.text ?? "null")) as T;
    },
  };
}

const otto = await as("otto");
const ivy = await as("ivy");
const people = await otto.query(api.org.listPeople, { search: "Fiona" });
const fiona = people.find((p) => p.login === "fiona")!;
const rhea = (await otto.query(api.org.listPeople, { search: "Rhea" })).find((p) => p.login === "rhea")!;

// A. Offboarding: the Access Steward proposes; IT & Security must approve in Studio.
const offboard = await ivy.mutation(api.agents.assign, { agentKey: "agent-steward", title: "Offboard Fiona Walsh", objective: "Inventory Fiona's responsibilities and propose their transfer to Rhea Das, leaving 2026-11-07.", context: "Resignation accepted by Maria Chen on 2026-11-02.", constraints: ["Successor: Rhea Das", "Nothing is deleted"], expectedOutput: "Fiona departed; nothing left assigned to her.", deadline: new Date(Date.now() + 3 * 86_400_000).toISOString(), permittedCapabilities: ["org.responsibilities", "org.depart"], approvalRequired: true, verifier: "departure-complete", subject: { collection: "people", id: fiona.id } });
const steward = mcp(agentToken("agent-steward", "agent-access"));
await steward.init();
const sTask = await steward.call<{ task: { task_id: string } }>("feltkit_agent_create", { objective: "Offboard Fiona Walsh" });
await steward.call("assignments.accept", { assignmentId: offboard, feltkitTaskId: sTask.task.task_id });
const inventory = await steward.call<{ grants: unknown[]; pendingApprovals: unknown[] }>("org.responsibilities", { personId: fiona.id });
await steward.call("assignments.report", { assignmentId: offboard, kind: "progress", text: `Inventory: ${inventory.grants.length} grants, ${inventory.pendingApprovals.length} pending approvals.` });
await steward.call("feltkit_agent_propose", { taskId: sTask.task.task_id, capability: "org.depart", input: { personId: fiona.id, successorId: rhea.id, leftOn: "2026-11-07", reason: "resignation" }, reason: `Transfer ${inventory.grants.length} grants and ${inventory.pendingApprovals.length} pending approvals to Rhea Das.` });
await steward.call("assignments.report", { assignmentId: offboard, kind: "waiting-approval", text: "Departure proposed; waiting for IT & Security approval in Studio." });
console.log("A. offboarding proposed, waiting for approval");

// B. Supplier feed: works on v1, then the supplier retires v1.
const post = (path: string, body?: unknown) => fetch(`${supplier}${path}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
const northwind = (await otto.query(api.purchasing.listSuppliers)).find((s) => s.name === "Northwind Components")!;
const po = (await otto.query(api.purchasing.listOrders)).find((o) => o.supplierId === northwind.id)!.number;
await post("/admin/invoices", { number: "NW-8101", po, total: 820, issued: "2026-11-01T09:00:00.000Z" });
const sync = await otto.mutation(api.agents.assign, { agentKey: "agent-sentry", title: "Keep the Northwind feed in sync", objective: "Import Northwind invoices; on failure, isolate the link and open an incident.", context: "Account: meridian.", constraints: ["Isolate rather than retry a failing API"], expectedOutput: "Link healthy, every supplier invoice imported once.", permittedCapabilities: ["supplierapi.invoicesv1", "supplierapi.invoicesv2", "invoices.ingest", "integrations.isolate", "integrations.link", "incidents.open", "incidents.note"], approvalRequired: false, verifier: "supplier-link-healthy", subject: { collection: "suppliers", id: northwind.id } });
const sentry = mcp(agentToken("agent-sentry", "agent-integration"));
await sentry.init();
const eTask = await sentry.call<{ task: { task_id: string } }>("feltkit_agent_create", { objective: "Northwind feed" });
await sentry.call("assignments.accept", { assignmentId: sync, feltkitTaskId: eTask.task.task_id });
const link1 = await sentry.call<{ syncedThrough: string }>("integrations.link", { supplierId: northwind.id });
await sentry.call("supplierapi.invoicesv1", { since: link1.syncedThrough, supplierId: northwind.id });
await sentry.call("assignments.report", { assignmentId: sync, kind: "progress", text: "Synced 1 invoice from v1." });
await post("/admin/cutover");
await post("/admin/invoices", { number: "NW-8102", po, total: 455, issued: "2026-11-02T11:00:00.000Z" });
const link2 = await sentry.call<{ syncedThrough: string; id: string }>("integrations.link", { supplierId: northwind.id });
try { await sentry.call("supplierapi.invoicesv1", { since: link2.syncedThrough, supplierId: northwind.id }); } catch (e) { console.log("   v1 call failed as expected:", (e as Error).message.slice(0, 80)); }
const incident = await sentry.call<{ id: string; number: string }>("incidents.open", { title: "Northwind invoice feed failing (API v1 retired)", severity: "sev3", process: "supplier-integration", businessImpact: "Northwind invoices are not imported; payables are understated until repaired.", affected: [{ collection: "supplierLinks", id: link2.id }] });
await sentry.call("integrations.isolate", { supplierId: northwind.id, reason: "v1 answers 410 Gone", incidentId: incident.id });
await sentry.call("assignments.report", { assignmentId: sync, kind: "failure", text: `v1 retired by the supplier; link isolated; ${incident.number} opened. Needs engineering.` });
console.log(`B. ${incident.number} open, link isolated`);

// C. A policy draft waiting for the CFO.
const fionaC = await as("fiona");
await fionaC.mutation(api.policies.propose, { key: "purchasing.approval", effectiveFrom: new Date().toISOString(), rationale: "Audit finding AF-12: approvals above 10k need an executive.", rules: { tiers: [
  { upTo: 2_500, steps: [{ kind: "purchase.approve.manager", label: "Department manager", scope: "department" }] },
  { upTo: 10_000, steps: [{ kind: "purchase.approve.manager", label: "Department manager", scope: "department" }, { kind: "purchase.approve.finance", label: "Finance" }] },
  { upTo: null, steps: [{ kind: "purchase.approve.manager", label: "Department manager", scope: "department" }, { kind: "purchase.approve.finance", label: "Finance" }, { kind: "purchase.approve.executive", label: "Executive" }] },
] } });
console.log("C. policy draft proposed");

// D. An application change from Operations, specified by Product.
const priya = await as("priya");
const change = await priya.mutation(api.changes.request, { kind: "application", title: "Supplier onboarding workflow", problem: "Requested suppliers can never become active: there is no onboarding, so Operations cannot buy from new suppliers." });
const dana = await as("dana");
await dana.mutation(api.changes.advance, { changeId: change.id, to: "assessed" });
await dana.mutation(api.changes.specify, { changeId: change.id, impact: "Procurement, Finance and IT & Security each own one check.", requirements: ["Procurement starts onboarding", "Each check recorded by the owning function", "The requester cannot approve"], acceptance: ["A requested supplier cannot be ordered from until approved", "Each check records who and when", "The requester cannot approve their own supplier"] });
console.log(`D. ${change.number} specified`);
