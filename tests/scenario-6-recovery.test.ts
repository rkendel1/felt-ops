/**
 * Scenario 6 — Agent failure and recovery (agent → operator → recovery).
 *
 * The Ledger Reconciler is reversing four duplicate commitments, one approved proposal at a
 * time. Halfway through, its process dies and its session is gone. The platform restarts.
 * The operator establishes the real state from durable records (not from the agent's last
 * report), cancels the orphaned task, reassigns the work to the standby reconciler, and
 * verifies that nothing was done twice and nothing ran without authority.
 *
 * This test drives the agents in-process through AgentHost (the same calls MCP makes).
 * scripts/scenario-6-live.ts does the same with real agent processes over MCP.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "@feltdb/feltkit/testing";
import { stateWithR1Duplicates } from "./_r1.js";
import { api, evidence, principal, rejects, session } from "./_support.js";

test("scenario 6: an agent dies mid-operation; the operator recovers it without duplicates", async () => {
  const r1 = await stateWithR1Duplicates(4);
  try {
    const t = await createTestApp({ storage: r1.storage });
    for (const id of ["agent-ledger", "agent-ledger-2", "rhea", "maria", "otto"]) await session(t, id);
    const ledger = principal("agent-ledger");
    const reversals = (dupes: typeof r1.duplicates) => dupes.map((d) => ({ capability: "commitments.reverse", input: { commitmentId: d.commitmentId, reason: `Duplicate of ${d.keeps} (${d.number})` }, reason: `reconciliation lists ${d.commitmentId}` }));

    const asgId = await t.as("otto").mutation(api.agents.assign, {
      agentKey: "agent-ledger", title: "Reverse four duplicate Northwind commitments", objective: "Reverse each commitment finance.reconciliation lists as a duplicate.",
      context: "Four duplicates from the R1 invoice defect.", constraints: ["One proposal per commitment"], expectedOutput: "Zero duplicates.", deadline: "2026-12-31T00:00:00.000Z",
      permittedCapabilities: ["finance.reconciliation", "commitments.reverse"], approvalRequired: true, verifier: "reconciliation-clean",
    });
    const task1 = (await t.runtime.agent.createTask({ objective: "Reverse duplicates", principal: ledger })).task.task_id;
    await t.as("agent-ledger").mutation(api.agents.accept, { assignmentId: asgId, feltkitTaskId: task1 });
    let view = await t.runtime.agent.get(task1, principal("otto"));
    for (const p of reversals(r1.duplicates)) view = await t.runtime.agent.propose(task1, p, ledger);
    await t.as("agent-ledger").mutation(api.agents.report, { assignmentId: asgId, kind: "waiting-approval", text: "4 reversals proposed." });
    // Finance approves two; they run as the agent.
    view = await t.runtime.agent.approve(task1, view.pending[0]!.actionId, principal("rhea"));
    view = await t.runtime.agent.approve(task1, view.pending[0]!.actionId, principal("rhea"));
    await t.as("agent-ledger").mutation(api.agents.report, { assignmentId: asgId, kind: "progress", text: "2 of 4 reversed." });

    // ── Failure: the agent process dies and its session is gone; the platform restarts. ──
    const revoked = await t.runtime.sessions.revokePrincipal("agent-ledger");
    assert.ok(revoked >= 1);
    await t.restart();
    const reconcile = await t.runtime.agent.reconcile();

    // ── The operator establishes the actual state from durable records. ──
    const asgView = await t.as("otto").query(api.agents.assignmentDetail, { assignmentId: asgId });
    const taskView = await t.runtime.agent.get(task1, principal("otto"));
    const states = taskView.actions.map((a) => a.state).sort();
    assert.equal(asgView.assignment.status, "running", "what the agent last said");
    assert.deepEqual(states, ["proposed", "proposed", "succeeded", "succeeded"], "what FeltKit recorded");
    assert.equal(asgView.check.ok, false, "what the records show: not done");
    assert.equal((asgView.check.detail as { duplicates: number }).duplicates, 2);

    // Production semantics: the owner of the orphaned proposals cannot be resolved (no session),
    // so FeltKit's approval would fail closed. In development and test FeltKit also resolves
    // declared dev identities, so here it does resolve (finding F-022).
    const productionOwner = await t.runtime.resolvePrincipal("agent-ledger");
    const devOwner = await t.runtime.resolvePrincipal("agent-ledger", { devUsers: true });
    assert.equal(productionOwner, null);
    assert.equal(devOwner?.id, "agent-ledger");
    // CompanyOS's own boundary holds in every environment: suspend the lost agent, and an
    // approved orphan runs and is refused before it changes anything.
    await t.as("ivy").mutation(api.agents.setStatus, { key: "agent-ledger", status: "suspended", reason: "process lost; session revoked" });
    await rejects(t.as("agent-ledger").query(api.purchasing.reconciliation), "FORBIDDEN", /suspended/);
    const orphan = taskView.pending[0]!.actionId;
    const afterOrphan = await t.runtime.agent.approve(task1, orphan, principal("maria"));
    const orphanAction = afterOrphan.actions.find((a) => a.actionId === orphan)!;
    assert.equal(orphanAction.state, "failed");
    assert.match(orphanAction.outcome!.error!.message, /suspended/);
    assert.equal((await t.as("rhea").query(api.purchasing.reconciliation)).duplicates.length, 2, "nothing changed");

    // ── Recovery: cancel the orphaned task, reassign to the standby. ──
    const cancelled = await t.runtime.agent.cancel(task1, principal("otto"), "agent lost; work reassigned");
    assert.deepEqual(cancelled.actions.map((a) => a.state).sort(), ["cancelled", "failed", "succeeded", "succeeded"]);
    const newId = await t.as("otto").mutation(api.agents.reassign, { assignmentId: asgId, toAgentKey: "agent-ledger-2", note: "Primary lost mid-run; 2 of 4 reversed per FeltKit task." });
    const standby = principal("agent-ledger-2");
    const task2 = (await t.runtime.agent.createTask({ objective: "Finish reversing duplicates", principal: standby })).task.task_id;
    await t.as("agent-ledger-2").mutation(api.agents.accept, { assignmentId: newId!, feltkitTaskId: task2 });
    const remaining = await t.as("agent-ledger-2").query(api.purchasing.reconciliation);
    assert.equal(remaining.duplicates.length, 2);
    // A stale replay of an already-reversed commitment is refused at execution: no double reversal.
    let v2 = await t.runtime.agent.propose(task2, reversals([r1.duplicates[0]!])[0]!, standby);
    for (const p of reversals(remaining.duplicates)) v2 = await t.runtime.agent.propose(task2, p, standby);
    for (const p of [...v2.pending]) v2 = await t.runtime.agent.approve(task2, p.actionId, principal("maria"));
    const outcomes = v2.actions.map((a) => [a.state, a.outcome?.error?.message ?? ""]);
    assert.equal(outcomes.filter(([s]) => s === "succeeded").length, 2);
    assert.match(String(outcomes.find(([s]) => s === "failed")?.[1]), /already reversed/);

    // ── Verification: exactly four reversals, each once, each approved, total exact. ──
    await t.as("agent-ledger-2").mutation(api.agents.report, { assignmentId: newId!, kind: "claim", text: "Remaining 2 reversed." });
    const verification = await t.as("otto").mutation(api.agents.verify, { assignmentId: newId! });
    assert.equal(verification.ok, true);
    const reversed = await t.as("rhea").query(api.purchasing.listCommitments, { status: "reversed" });
    assert.deepEqual(reversed.map((c) => c.id).sort(), r1.duplicates.map((d) => d.commitmentId).sort());
    assert.deepEqual(reversed.map((c) => c.reversedBy).sort(), ["agent-ledger", "agent-ledger", "agent-ledger-2", "agent-ledger-2"]);
    const old = await t.as("otto").query(api.agents.assignmentDetail, { assignmentId: asgId });
    assert.equal(old.assignment.status, "reassigned");
    const metrics = await t.as("otto").query(api.agents.metrics);

    evidence("scenario-6", {
      r1Commit: r1.sha, reconcileAfterRestart: reconcile,
      displayedVsActual: { assignmentStatusFromAgent: asgView.assignment.status, feltkitActionStates: states, recordsCheck: asgView.check },
      orphanApproval: { productionOwnerResolves: productionOwner !== null, devOwnerResolves: devOwner !== null, stateAfterApproval: orphanAction.state, error: orphanAction.outcome?.error?.message },
      task1: cancelled.actions.map((a) => ({ state: a.state, decidedBy: a.decidedBy, executedAs: a.executedAs })),
      task2: v2.actions.map((a) => ({ state: a.state, decidedBy: a.decidedBy, executedAs: a.executedAs, error: a.outcome?.error?.message })),
      reversed: reversed.map((c) => ({ id: c.id, by: c.reversedBy, amount: c.amount })), verification,
      metrics: metrics.filter((m) => m.key.startsWith("agent-ledger")),
      timeline: old.history.map((h) => ({ at: h.at, actor: h.actorId, source: h.source, kind: h.kind, summary: h.summary })),
    });
    await t.close();
  } finally {
    r1.cleanup();
  }
});
