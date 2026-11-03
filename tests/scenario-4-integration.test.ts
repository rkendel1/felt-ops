/**
 * Scenario 4 — External integration change (integration → software → operations).
 *
 * Northwind retires API v1. CompanyOS's Integration Sentry sees the calls fail, opens an
 * incident and isolates the link; engineering tracks the change; the v2 operation is
 * validated by a real call before the link may be restored; the next sync reconciles the
 * invoice issued during the outage. All supplier traffic is real HTTP through the
 * `supplierapi` integration to tools/supplier-api.ts.
 *
 * Disclosure: the v2 operation was declared in the integration from R1 onward, so the
 * engineering step here is tracked and validated, not a new commit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startSupplierApi } from "../tools/supplier-api.js";
import { api, evidence, principal, rejects, seeded, session } from "./_support.js";

test("scenario 4: a supplier retires its API; the link is isolated, repaired, validated and reconciled", async () => {
  const supplier = await startSupplierApi();
  process.env.SUPPLIER_API_URL = supplier.url;
  const { t } = await seeded();
  try {
    const northwind = (await t.as("pablo").query(api.purchasing.listSuppliers)).find((s) => s.name === "Northwind Components")!.id;
    const req = await t.as("otto").mutation(api.purchasing.submitRequest, { supplierId: northwind, amount: 2_400, description: "Gaskets" });
    await t.as("priya").mutation(api.purchasing.decideRequest, { requestId: req.id, decision: "approved" });
    const po = (await t.as("otto").query(api.purchasing.listOrders)).find((p) => p.requestId === req.id)!.number;

    const asgId = await t.as("otto").mutation(api.agents.assign, {
      agentKey: "agent-sentry", title: "Keep the Northwind feed in sync", objective: "Import Northwind invoices; on failure, isolate the link and open an incident.",
      context: "Account: meridian.", constraints: ["Never edit invoices", "Isolate rather than retry a failing API"], expectedOutput: "Link healthy, every supplier invoice imported once.",
      permittedCapabilities: ["supplierapi.invoicesv1", "supplierapi.invoicesv2", "invoices.ingest", "integrations.isolate", "integrations.link", "incidents.open", "incidents.note"],
      approvalRequired: false, verifier: "supplier-link-healthy", subject: { collection: "suppliers", id: northwind },
    });
    const sentry = principal("agent-sentry");
    await session(t, "agent-sentry");
    const task = await t.runtime.agent.createTask({ objective: "Northwind feed", principal: sentry });
    const taskId = task.task.task_id;
    await t.as("agent-sentry").mutation(api.agents.accept, { assignmentId: asgId, feltkitTaskId: taskId });
    const link = () => t.as("agent-sentry").query(api.integrations.linkStatus, { supplierId: northwind });
    const sync = async (version: "v1" | "v2") => {
      const l = await link();
      const input = version === "v1" ? { since: l.syncedThrough, supplierId: northwind } : { account: "meridian", updatedAfter: l.syncedThrough, supplierId: northwind };
      const view = await t.runtime.agent.propose(taskId, { capability: `supplierapi.invoices${version}`, input, reason: "daily sync" }, sentry);
      return view.checkpoints.at(-1)!;
    };

    // Normal operation on v1.
    await fetch(`${supplier.url}/admin/invoices`, { method: "POST", body: JSON.stringify({ number: "NW-8001", po, total: 1_200, issued: "2026-11-01T09:00:00.000Z" }) });
    await fetch(`${supplier.url}/admin/invoices`, { method: "POST", body: JSON.stringify({ number: "NW-8002", po, total: 1_200, issued: "2026-11-01T15:00:00.000Z" }) });
    await sync("v1");
    assert.equal((await link()).status, "healthy");
    assert.equal((await link()).syncedThrough, "2026-11-01T15:00:00.000Z");
    assert.equal((await t.as("fiona").query(api.purchasing.listInvoices, { supplierId: northwind })).filter((i) => i.number.startsWith("NW-80")).length, 2);

    // The supplier retires v1 and keeps issuing invoices.
    await fetch(`${supplier.url}/admin/cutover`, { method: "POST" });
    await fetch(`${supplier.url}/admin/invoices`, { method: "POST", body: JSON.stringify({ number: "NW-8003", po, total: 640, issued: "2026-11-02T10:00:00.000Z" }) });
    const failed = await sync("v1");
    const broken = await link();
    assert.equal(broken.status, "failing");
    assert.match(broken.lastFailure!.message, /410|retired|gone/i);
    assert.equal(broken.syncedThrough, "2026-11-01T15:00:00.000Z", "watermark held at the last good sync");

    // Detection, containment.
    const incident = await t.as("agent-sentry").mutation(api.incidents.open, { title: "Northwind invoice feed failing (API v1 retired)", severity: "sev3", process: "supplier-integration", businessImpact: "Northwind invoices are not imported; payables are understated until repaired.", affected: [{ collection: "supplierLinks", id: broken.id }] });
    await t.as("agent-sentry").mutation(api.integrations.isolate, { supplierId: northwind, reason: "v1 answers 410 Gone", incidentId: incident.id });
    await t.as("agent-sentry").mutation(api.agents.report, { assignmentId: asgId, kind: "failure", text: "v1 retired by the supplier; link isolated; incident opened. Needs engineering." });
    // While isolated, a v1 retry would import nothing; restoring without validation is refused.
    await rejects(t.as("sam").mutation(api.integrations.restore, { supplierId: northwind, apiVersion: "v2" }), "FAILED_PRECONDITION", /validate/i);

    // Engineering: the change, then validation of v2 by a real call while isolated.
    const change = await t.as("eli").mutation(api.changes.request, { kind: "application", title: "Move the Northwind integration to API v2", problem: "Northwind retired API v1 on 2026-11-02.", incidentId: incident.id, businessOwnerId: (await t.as("pablo").query(api.org.me)).person!.id });
    await t.as("eli").mutation(api.incidents.update, { incidentId: incident.id, status: "investigating", changeId: change.id, rootCause: "Supplier retired API v1." });
    await t.as("otto").mutation(api.agents.intervene, { assignmentId: asgId, action: "context", note: `Use API v2 (account meridian) once ${change.number} validates it.` });
    await t.as("otto").mutation(api.agents.intervene, { assignmentId: asgId, action: "resume", note: "Validate v2 while the link is isolated." });
    await sync("v2");
    assert.equal((await t.as("fiona").query(api.purchasing.listInvoices, { supplierId: northwind })).filter((i) => i.number === "NW-8003").length, 0, "validation imports nothing");
    await t.as("sam").mutation(api.integrations.restore, { supplierId: northwind, apiVersion: "v2", changeId: change.id });

    // Reconciliation: the next sync on v2 imports exactly the missed invoice.
    await sync("v2");
    const after = await t.as("fiona").query(api.purchasing.listInvoices, { supplierId: northwind });
    const fromSupplier = supplier.state.invoices.map((i) => i.number).sort();
    assert.deepEqual(after.filter((i) => i.number.startsWith("NW-80")).map((i) => i.number).sort(), fromSupplier, "every supplier invoice imported exactly once");
    assert.equal((await link()).status, "healthy");
    assert.equal((await link()).apiVersion, "v2");
    assert.equal((await t.as("fiona").query(api.purchasing.reconciliation)).duplicates.length, 0);

    await t.as("agent-sentry").mutation(api.agents.report, { assignmentId: asgId, kind: "claim", text: "Link restored on v2; NW-8003 imported." });
    const verification = await t.as("otto").mutation(api.agents.verify, { assignmentId: asgId });
    assert.equal(verification.ok, true);
    await t.as("eli").mutation(api.incidents.resolve, { incidentId: incident.id });
    const linkHistory = (await t.as("eli").query(api.integrations.links))[0]!.history;

    evidence("scenario-4", {
      supplierRequests: supplier.state.requests, failedCheckpoint: { summary: failed.summary }, lastFailure: broken.lastFailure,
      linkHistory: linkHistory.map((h) => ({ at: h.at, actor: h.actorId, source: h.source, kind: h.kind, summary: h.summary })).reverse(),
      invoices: after.filter((i) => i.number.startsWith("NW-80")).map((i) => ({ number: i.number, channel: i.channel, externalId: i.externalId, status: i.status })),
      verification, change: change.number, incident: incident.number,
    });
  } finally {
    await t.close();
    supplier.server.close();
    delete process.env.SUPPLIER_API_URL;
  }
});
