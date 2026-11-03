/**
 * Scenario 5 — Organizational change (organization → authority → continuity).
 *
 * Fiona Walsh (Finance Manager) leaves. The Access Steward agent inventories her
 * responsibilities and proposes the departure; IT & Security approves it; her grants move to
 * Rhea Das with provenance, her pending approvals and work move too, her access is refused,
 * and her history stays intact.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { api, evidence, principal, rejects, seeded, session } from "./_support.js";

test("scenario 5: an employee leaves; access is revoked and responsibilities continue", async () => {
  const { t, ids } = await seeded();
  try {
    const before = await t.as("ivy").query(api.org.responsibilities, { personId: ids.fiona! });
    assert.ok(before.grants.filter((g) => g.status === "active").length >= 3);
    assert.equal(before.pendingApprovals.length, 2, "two Finance approvals wait for Fiona");
    const pastDecisions = (await t.as("ivy").query(api.purchasing.listRequests, {})).filter((r) => r.steps.some((s) => s.decidedBy === ids.fiona)).length;
    assert.ok(pastDecisions > 0);

    const asgId = await t.as("ivy").mutation(api.agents.assign, {
      agentKey: "agent-steward", title: "Offboard Fiona Walsh", objective: "Inventory Fiona's responsibilities and propose their transfer to Rhea Das, leaving 2026-11-07.",
      context: "Resignation accepted by Maria Chen.", constraints: ["Successor: Rhea Das", "Nothing is deleted"], expectedOutput: "Fiona departed; nothing left assigned to her.",
      permittedCapabilities: ["org.responsibilities", "org.depart"], approvalRequired: true, verifier: "departure-complete", subject: { collection: "people", id: ids.fiona! },
    });
    const steward = principal("agent-steward");
    await session(t, "agent-steward");
    for (const id of ["ivy", "otto"]) await session(t, id);
    const task = await t.runtime.agent.createTask({ objective: "Offboard Fiona Walsh", principal: steward });
    const taskId = task.task.task_id;
    await t.as("agent-steward").mutation(api.agents.accept, { assignmentId: asgId, feltkitTaskId: taskId });
    // Observation runs at once, recorded as evidence on the task.
    await t.runtime.agent.propose(taskId, { capability: "org.responsibilities", input: { personId: ids.fiona }, reason: "inventory before transfer" }, steward);
    const input = { personId: ids.fiona, successorId: ids.rhea, leftOn: "2026-11-07", reason: "resignation" };
    await rejects(t.as("agent-steward").mutation(api.org.depart, input as never), "FORBIDDEN", /approval/);
    let view = await t.runtime.agent.propose(taskId, { capability: "org.depart", input, reason: "transfer 4 grants, 2 approvals and owned work to Rhea" }, steward);
    await t.as("agent-steward").mutation(api.agents.report, { assignmentId: asgId, kind: "waiting-approval", text: "Departure proposed; waiting for IT & Security." });
    const actionId = view.pending[0]!.actionId;

    // An operator without access authority cannot approve it; IT & Security can.
    assert.equal((await t.runtime.agent.approvability(taskId, principal("otto")))[actionId]!.allowed, false);
    await rejects(t.runtime.agent.approve(taskId, actionId, principal("otto")), "FORBIDDEN");
    view = await t.runtime.agent.approve(taskId, actionId, principal("ivy"));
    const action = view.actions.find((a) => a.actionId === actionId)!;
    assert.equal(action.state, "succeeded");
    assert.equal(action.executedAs, "agent:agent-steward");
    assert.equal(action.decidedBy, "user:ivy");
    const result = action.outcome!.output as { grantsTransferred: number; approvalsMoved: number; platformSteps: string[] };
    assert.equal(result.approvalsMoved, 2);
    assert.match(result.platformSteps[0]!, /session revoke/);

    // Access: CompanyOS refuses her at once; the platform session is revoked as the next step.
    await rejects(t.as("fiona").query(api.purchasing.myApprovals), "FORBIDDEN", /left the company/);
    await rejects(t.as("fiona").mutation(api.purchasing.decideRequest, { requestId: "x", decision: "approved" }), "FORBIDDEN", /left the company/);
    const revoked = await t.runtime.sessions.revokePrincipal("fiona");
    assert.ok(revoked >= 1, "her sessions are revoked at FeltKit too (the operator's CLI step)");

    // Continuity: Rhea holds the transferred grants and can decide the moved approvals.
    const after = await t.as("rhea").query(api.org.responsibilities, { personId: ids.rhea! });
    const transferred = after.grants.filter((g) => g.transferredFrom && g.status === "active");
    assert.equal(transferred.length, result.grantsTransferred);
    assert.equal(after.pendingApprovals.length, 2);
    const inbox = await t.as("rhea").query(api.purchasing.myApprovals);
    const big = inbox.find((i) => i.request.amount === 14_250)!;
    assert.equal(big.canDecide, true, "the 100k Finance limit moved to Rhea");
    await t.as("rhea").mutation(api.purchasing.decideRequest, { requestId: big.request.id, decision: "approved" });

    // History intact: her record, her ended grants, her past decisions.
    const fiona = await t.as("ivy").query(api.org.responsibilities, { personId: ids.fiona! });
    assert.equal(fiona.person.status, "departed");
    assert.ok(fiona.grants.every((g) => g.status === "ended" && /departure/.test(g.endReason ?? "")));
    assert.equal((await t.as("ivy").query(api.purchasing.listRequests, {})).filter((r) => r.steps.some((s) => s.decidedBy === ids.fiona)).length, pastDecisions);
    await rejects(t.runtime.agent.propose(taskId, { capability: "org.depart", input, reason: "again" }, steward).then((v) => t.runtime.agent.approve(taskId, v.pending[0]!.actionId, principal("ivy"))).then((v) => { const last = v.actions.at(-1)!; if (last.state === "failed") throw Object.assign(new Error(last.outcome!.error!.message), { code: "FAILED_PRECONDITION" }); return v; }), "FAILED_PRECONDITION", /already left/);

    await t.as("agent-steward").mutation(api.agents.report, { assignmentId: asgId, kind: "claim", text: "Fiona departed; all responsibilities with Rhea." });
    const verification = await t.as("ivy").mutation(api.agents.verify, { assignmentId: asgId });
    assert.equal(verification.ok, true, JSON.stringify(verification.detail));

    evidence("scenario-5", {
      before: { grants: before.grants.map((g) => ({ kind: g.kind, limit: g.limit ?? null, status: g.status })), pendingApprovals: before.pendingApprovals },
      action: { state: action.state, proposedBy: action.proposedBy, decidedBy: action.decidedBy, executedAs: action.executedAs, output: action.outcome?.output },
      rheaGrants: after.grants.map((g) => ({ kind: g.kind, limit: g.limit ?? null, transferredFrom: g.transferredFrom ?? null })),
      fionaHistory: fiona.history, sessionsRevoked: revoked, verification,
    });
  } finally {
    await t.close();
  }
});
