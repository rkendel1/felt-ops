/**
 * Scenario 3 — Production incident (production → engineering → business).
 *
 * Release R1 (commit "CompanyOS R1: …") processes the same supplier invoice twice when it
 * arrives through manual entry and the supplier feed, duplicating financial commitments.
 * Phase A runs R1's actual source on a FeltDB state directory and produces the duplicates.
 * Phase B opens the same state with the current source (the fix), and the company detects,
 * contains, remediates (agent proposals approved by Finance) and verifies the correction.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestApp } from "@feltdb/feltkit/testing";
import { api, evidence, principal, rejects, session } from "./_support.js";

function checkoutR1() {
  const sha = execFileSync("git", ["log", "--format=%H", "--grep", "^CompanyOS R1:", "-n", "1"], { encoding: "utf8" }).trim();
  assert.ok(sha, "R1 commit not found in history (CI needs fetch-depth: 0)");
  const dir = mkdtempSync(join(tmpdir(), "companyos-r1-"));
  execFileSync("sh", ["-c", `git archive ${sha} | tar -x -C ${dir}`]);
  symlinkSync(join(process.cwd(), "node_modules"), join(dir, "node_modules"));
  return { sha, dir };
}

test("scenario 3: duplicated invoice commitments in production are detected, remediated and verified", async () => {
  const r1 = checkoutR1();
  const state = mkdtempSync(join(tmpdir(), "companyos-state-"));
  const storage = { kind: "local" as const, path: state };
  try {
    // ── Phase A: R1 in production ─────────────────────────────────────────────
    const a = await createTestApp({ projectDir: r1.dir, storage });
    await a.as("ivy").mutation(api.seed.seed);
    const suppliers = await a.as("pablo").query(api.purchasing.listSuppliers);
    const northwind = suppliers.find((s) => s.name === "Northwind Components")!.id;
    const orders: string[] = [];
    for (const [amount, what] of [[4_800, "Sensor kits"], [3_150, "Spare actuators"]] as const) {
      // A Finance purchase: in R1 only Finance holds both the platform permission and the
      // business grant to approve (finding F-012: R1 could not approve Operations purchases).
      const req = await a.as("rhea").mutation(api.purchasing.submitRequest, { supplierId: northwind, amount, description: what });
      await a.as("maria").mutation(api.purchasing.decideRequest, { requestId: req.id, decision: "approved" });
      orders.push((await a.as("rhea").query(api.purchasing.listOrders)).find((p) => p.requestId === req.id)!.number);
    }
    // The integration agent runs the daily sync under an operator's assignment.
    const syncId = await a.as("otto").mutation(api.agents.assign, {
      agentKey: "agent-sentry", title: "Daily Northwind invoice sync", objective: "Import new Northwind invoices from the supplier feed every day.",
      context: "Northwind delivers invoices through its API.", constraints: ["Import only; never edit invoices."], expectedOutput: "Invoices imported and matched.",
      permittedCapabilities: ["supplierapi.invoicesv1", "invoices.ingest", "incidents.open", "incidents.note", "integrations.isolate"], approvalRequired: false, verifier: "supplier-link-healthy",
    });
    // AP enters the paper copies by hand; the feed then delivers the same invoices.
    await a.as("rhea").mutation(api.purchasing.enterInvoice, { supplierId: northwind, poNumber: orders[0], number: "NW-7781", amount: 4_800 });
    await a.as("rhea").mutation(api.purchasing.enterInvoice, { supplierId: northwind, poNumber: orders[1], number: "NW-7790", amount: 3_150 });
    const fed = await a.as("agent-sentry").mutation(api.purchasing.ingestInvoices, { supplierId: northwind, rows: [
      { externalId: "nw-del-9001", number: "nw7781", poNumber: orders[0], amount: 4_800, issuedAt: "2026-11-02T08:00:00.000Z" },
      { externalId: "nw-del-9002", number: "NW 7790", poNumber: orders[1], amount: 3_150, issuedAt: "2026-11-02T08:00:00.000Z" },
    ] });
    assert.deepEqual(fed, { imported: 2, skipped: 0, exceptions: 0 }, "R1 imports both: the defect");
    const broken = await a.as("fiona").query(api.purchasing.reconciliation);
    assert.equal(broken.duplicates.length, 2, "R1 produced duplicate commitments");
    assert.equal(broken.duplicateTotal, 7_950);
    await a.close();

    // ── Phase B: the same production state, current release ───────────────────
    const t = await createTestApp({ storage });
    for (const id of ["agent-sentry", "agent-ledger", "rhea", "maria", "fiona", "priya", "otto"]) await session(t, id);

    // Detection and classification, by the integration agent, as an assertion-backed record.
    const incident = await t.as("agent-sentry").mutation(api.incidents.open, {
      title: "Invoice processing duplicates commitments", severity: "sev2", process: "invoice-processing",
      businessImpact: `${broken.duplicates.length} duplicate commitments overstate Finance spend by 7950.00`,
      affected: broken.duplicates.map((d) => ({ collection: "commitments", id: d.commitmentId })),
    });
    const again = await t.as("agent-sentry").mutation(api.incidents.open, { title: "Duplicates again", severity: "sev2", process: "invoice-processing", businessImpact: "same duplicates seen again", affected: [] });
    assert.equal(again.id, incident.id, "a repeated detection joins the open incident");
    await t.as("eli").mutation(api.incidents.update, { incidentId: incident.id, status: "investigating", ownerId: (await t.as("eli").query(api.org.me)).person!.id, rootCause: "Manual entry and the supplier feed deduplicate only within their own channel; invoice numbers are not normalized." });
    const change = await t.as("eli").mutation(api.changes.request, { kind: "application", title: "Deduplicate invoices across channels", problem: "Same invoice via manual entry and feed is processed twice.", incidentId: incident.id, businessOwnerId: (await t.as("fiona").query(api.org.me)).person!.id });
    await t.as("eli").mutation(api.incidents.update, { incidentId: incident.id, changeId: change.id });

    // The fix is live in this release: a third cross-channel copy is held, nothing committed.
    const held = await t.as("agent-sentry").mutation(api.purchasing.ingestInvoices, { supplierId: northwind, rows: [{ externalId: "nw-del-9003", number: "NW-7781", poNumber: orders[0], amount: 4_800, issuedAt: "2026-11-03T08:00:00.000Z" }] });
    assert.deepEqual(held, { imported: 1, skipped: 0, exceptions: 1 });
    assert.equal((await t.as("fiona").query(api.purchasing.reconciliation)).duplicates.length, 2, "no new duplicate");

    // Remediation by the Ledger Reconciler, narrowed by its assignment.
    const asgId = await t.as("otto").mutation(api.agents.assign, {
      agentKey: "agent-ledger", title: `Reverse duplicate commitments (${incident.number})`, objective: "Reverse every commitment the reconciliation identifies as a duplicate.",
      context: `Incident ${incident.number}. Finance must approve each reversal.`, constraints: ["Only commitments listed by finance.reconciliation", "One proposal per commitment"],
      expectedOutput: "Zero duplicates in finance.reconciliation.", permittedCapabilities: ["finance.reconciliation", "commitments.reverse", "incidents.note"], approvalRequired: true,
      verifier: "reconciliation-clean", subject: { collection: "incidents", id: incident.id },
    });
    const ledger = principal("agent-ledger");
    const task = await t.runtime.agent.createTask({ objective: `Reverse duplicates for ${incident.number}`, principal: ledger });
    const taskId = task.task.task_id;
    await t.as("agent-ledger").mutation(api.agents.accept, { assignmentId: asgId, feltkitTaskId: taskId });
    const dupes = await t.as("agent-ledger").query(api.purchasing.reconciliation);
    // The agent cannot take the consequential step itself.
    await rejects(t.as("agent-ledger").mutation(api.purchasing.reverseCommitment, { commitmentId: dupes.duplicates[0]!.commitmentId, reason: "duplicate" }), "FORBIDDEN", /approval/);
    let view = task;
    for (const d of dupes.duplicates) {
      view = await t.runtime.agent.propose(taskId, { capability: "commitments.reverse", input: { commitmentId: d.commitmentId, reason: `Duplicate of ${d.keeps} (${d.number})`, incidentId: incident.id }, reason: `finance.reconciliation lists ${d.commitmentId} as a duplicate` }, ledger);
    }
    // A deliberately wrong proposal: a legitimate commitment.
    const legit = (await t.as("fiona").query(api.purchasing.listCommitments, { status: "open" })).find((c) => !dupes.duplicates.some((d) => d.commitmentId === c.id))!;
    view = await t.runtime.agent.propose(taskId, { capability: "commitments.reverse", input: { commitmentId: legit.id, reason: "looks similar" }, reason: "suspected duplicate" }, ledger);
    await t.as("agent-ledger").mutation(api.agents.report, { assignmentId: asgId, kind: "waiting-approval", text: `${view.pending.length} reversal(s) proposed; waiting for Finance.` });
    assert.equal(view.pending.length, 3);

    // Approval: Priya may not (no finance authority); Rhea and Maria approve the duplicates.
    const [p1, p2, p3] = view.pending;
    const priyaCan = await t.runtime.agent.approvability(taskId, principal("priya"));
    assert.equal(priyaCan[p1!.actionId]!.allowed, false);
    await rejects(t.runtime.agent.approve(taskId, p1!.actionId, principal("priya")), "FORBIDDEN");
    view = await t.runtime.agent.approve(taskId, p1!.actionId, principal("rhea"));
    view = await t.runtime.agent.approve(taskId, p1!.actionId, principal("maria")); // duplicate approval: runs nothing
    view = await t.runtime.agent.approve(taskId, p2!.actionId, principal("maria"));
    // The wrong proposal is approved by mistake; CompanyOS's own rule refuses it at execution.
    view = await t.runtime.agent.approve(taskId, p3!.actionId, principal("fiona"));
    const states = Object.fromEntries(view.actions.map((x) => [x.actionId, x]));
    assert.equal(states[p1!.actionId]!.state, "succeeded");
    assert.equal(states[p1!.actionId]!.executedAs, "agent:agent-ledger");
    assert.equal(states[p1!.actionId]!.decidedBy, "user:rhea");
    assert.equal(states[p2!.actionId]!.state, "succeeded");
    assert.equal(states[p3!.actionId]!.state, "failed");
    assert.match(states[p3!.actionId]!.outcome!.error!.message, /does not identify this commitment as a duplicate/);
    assert.equal((await t.as("fiona").query(api.purchasing.listCommitments, { status: "open" })).find((c) => c.id === legit.id)!.status, "open", "legitimate commitment untouched");

    // Agent claims; the operator verifies from records, not from the claim.
    await t.as("agent-ledger").mutation(api.agents.report, { assignmentId: asgId, kind: "claim", text: "Both duplicates reversed; one proposal was refused." });
    const verification = await t.as("otto").mutation(api.agents.verify, { assignmentId: asgId });
    assert.equal(verification.ok, true);
    const after = await t.as("fiona").query(api.purchasing.reconciliation);
    assert.equal(after.duplicates.length, 0);
    assert.equal(Math.round((broken.openTotal - after.openTotal) * 100) / 100, 7_950, "exactly the duplicated amount was reversed");

    const resolved = await t.as("eli").mutation(api.incidents.resolve, { incidentId: incident.id });
    await t.as("eli").mutation(api.incidents.review, { incidentId: incident.id, review: "Cause: per-channel deduplication. Fix: cross-channel normalized check (current release). Two duplicate commitments (7,950.00) reversed with Finance approval; one wrong proposal refused by the duplicate rule." });
    const detail = await t.as("fiona").query(api.incidents.detail, { incidentId: incident.id });
    assert.equal(detail.incident.status, "reviewed");
    assert.equal(detail.check.healthy, true);

    evidence("scenario-3", {
      r1Commit: r1.sha, duplicatesInR1: broken.duplicates, heldByFix: held, incident: detail.incident,
      incidentTimeline: detail.history.map((h) => ({ at: h.at, actor: h.actorId, source: h.source, kind: h.kind, summary: h.summary })),
      feltkitActions: view.actions.map((x) => ({ actionId: x.actionId, capability: x.capability, state: x.state, proposedBy: x.proposedBy, decidedBy: x.decidedBy, executedAs: x.executedAs, determinedBy: x.outcome?.determinedBy, error: x.outcome?.error?.message })),
      checkpoints: view.checkpoints.length, verification, resolved, reconciliationAfter: after, syncAssignment: syncId,
    });
    await t.close();
  } finally {
    rmSync(r1.dir, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
});
