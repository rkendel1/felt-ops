/**
 * Scenario 2 — New business capability (business → software → production).
 *
 * Operations asks for supplier onboarding (R1 could record a supplier request but nothing
 * could make the supplier active). Product specifies it, engineering implements it (commit
 * "R3: …" in this repository), CI verifies it on GitHub Actions, and the business owner
 * accepts it against the running behavior.
 *
 * The GitHub part goes through CompanyOS's own integration (github.commit / github.runs),
 * proposed by the Engineering Scribe agent as observations, so the evidence is what GitHub
 * answered, not what anyone said. It runs when api.github.com is reachable; the full
 * release, deployment and acceptance against the finished CI run is
 * scripts/scenario-2-live.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { api, evidence, principal, rejects, seeded, session } from "./_support.js";

const REPO = { owner: "rkendel1", repo: "felt-ops" };

async function githubReachable() {
  try { return (await fetch("https://api.github.com/zen", { signal: AbortSignal.timeout(5000) })).ok; } catch { return false; }
}

test("scenario 2: supplier onboarding goes from a business request to accepted software", async () => {
  const { t, ids } = await seeded();
  try {
    // ── Request, assessment, specification ──
    const change = await t.as("priya").mutation(api.changes.request, { kind: "application", title: "Supplier onboarding workflow", problem: "Requested suppliers can never become active: there is no onboarding, so Operations cannot buy from new suppliers." });
    await rejects(t.as("sam").mutation(api.changes.advance, { changeId: change.id, to: "assessed" }), "FORBIDDEN", /changes.write/);
    await t.as("dana").mutation(api.changes.advance, { changeId: change.id, to: "assessed", note: "Blocks two Operations projects." });
    await t.as("dana").mutation(api.changes.specify, {
      changeId: change.id, impact: "Procurement, Finance and IT & Security each own one check; Operations can order from approved suppliers.",
      requirements: ["Procurement starts onboarding for a requested supplier", "Tax ID, bank and risk checks are each recorded by the owning function", "Procurement approves or rejects; the requester cannot approve"],
      acceptance: ["A requested supplier cannot be ordered from until onboarding is approved", "Each check records who made it and when", "The requester cannot approve their own supplier"],
    });
    await t.as("eli").mutation(api.changes.advance, { changeId: change.id, to: "in-development" });

    // ── Evidence gates: a statement is not evidence ──
    await t.as("dana").mutation(api.changes.recordEvidence, { changeId: change.id, system: "github", kind: "commit", ref: "deadbeef", status: "exists" });
    await rejects(t.as("eli").mutation(api.changes.advance, { changeId: change.id, to: "in-review" }), "FAILED_PRECONDITION", /observed through the GitHub integration/);

    let github: Record<string, unknown> = { reachable: false };
    const sha = execFileSync("git", ["log", "--format=%H", "--grep", "^R3:", "-n", "1"], { encoding: "utf8" }).trim();
    if (sha && (await githubReachable())) {
      const scribe = principal("agent-scribe");
      await session(t, "agent-scribe");
      await t.as("eli").mutation(api.agents.assign, { agentKey: "agent-scribe", title: `Collect GitHub evidence for ${change.number}`, objective: "Observe the implementing commit and its CI runs on GitHub.", context: `Commit ${sha}`, constraints: ["Observe only"], expectedOutput: "Commit and CI run recorded on the change.", permittedCapabilities: ["github.commit", "github.runs"], approvalRequired: false, verifier: "manual" });
      const task = await t.runtime.agent.createTask({ objective: `Evidence for ${change.number}`, principal: scribe });
      const taskId = task.task.task_id;
      await t.runtime.agent.propose(taskId, { capability: "github.commit", input: { ...REPO, sha, subject: `change:${change.id}` }, reason: "the implementing commit" }, scribe);
      const view = await t.runtime.agent.propose(taskId, { capability: "github.runs", input: { ...REPO, head_sha: sha, per_page: 5, subject: `change:${change.id}` }, reason: "CI for the implementing commit" }, scribe);
      const refs = await t.as("eli").query(api.integrations.refs, { subject: `change:${change.id}` });
      const commit = refs.find((r) => r.kind === "commit" && r.observedVia.startsWith("integration:"));
      assert.ok(commit, "the commit was observed through the integration");
      await t.as("eli").mutation(api.changes.advance, { changeId: change.id, to: "in-review" });
      const success = refs.find((r) => r.kind === "workflow-run" && r.status === "completed/success");
      if (success) {
        await t.as("eli").mutation(api.changes.advance, { changeId: change.id, to: "ci-passed" });
      } else {
        // CI for this very commit is still running (this test is part of it): the gate holds.
        await rejects(t.as("eli").mutation(api.changes.advance, { changeId: change.id, to: "ci-passed" }), "FAILED_PRECONDITION", /ci-success/);
      }
      github = { reachable: true, sha, observations: refs.map((r) => ({ kind: r.kind, ref: r.ref, status: r.status, via: r.observedVia, url: r.url })), checkpoints: view.checkpoints.length, ciPassedNow: !!success };
    }

    // ── The capability itself (acceptance criteria, checked against behavior) ──
    const requested = (await t.as("pablo").query(api.purchasing.listSuppliers)).find((s) => s.status === "requested")!;
    await rejects(t.as("otto").mutation(api.purchasing.submitRequest, { supplierId: requested.id, amount: 900, description: "Boxes" }), "FAILED_PRECONDITION", /requested/);
    await rejects(t.as("priya").mutation(api.purchasing.startOnboarding, { supplierId: requested.id }), "FORBIDDEN");
    await t.as("pablo").mutation(api.purchasing.startOnboarding, { supplierId: requested.id });
    await t.as("pablo").mutation(api.purchasing.recordCheck, { supplierId: requested.id, check: "tax-id", value: "TX-448812" });
    await rejects(t.as("pablo").mutation(api.purchasing.recordCheck, { supplierId: requested.id, check: "bank", value: "verified" }), "FORBIDDEN", /finance.write/);
    await rejects(t.as("pablo").mutation(api.purchasing.decideOnboarding, { supplierId: requested.id, decision: "approved" }), "FAILED_PRECONDITION", /incomplete/);
    await t.as("rhea").mutation(api.purchasing.recordCheck, { supplierId: requested.id, check: "bank", value: "verified", note: "Micro-deposit confirmed" });
    await t.as("ivy").mutation(api.purchasing.recordCheck, { supplierId: requested.id, check: "risk", value: "medium" });
    await t.as("pablo").mutation(api.purchasing.decideOnboarding, { supplierId: requested.id, decision: "approved" });
    const onboarded = (await t.as("pablo").query(api.purchasing.listSuppliers)).find((s) => s.id === requested.id)!;
    assert.equal(onboarded.status, "active");
    assert.deepEqual(onboarded.onboarding!.map((x) => [x.step, x.by]), [["started", ids.pablo], ["tax-id", ids.pablo], ["bank", ids.rhea], ["risk", ids.ivy], ["approved", ids.pablo]]);
    const order = await t.as("otto").mutation(api.purchasing.submitRequest, { supplierId: requested.id, amount: 900, description: "Boxes" });
    assert.equal(order.status, "pending");

    // The requester may not approve their own supplier, even when they hold the approval.
    const second = await t.as("pablo").mutation(api.purchasing.requestSupplier, { name: "Harbor Freight Partners", category: "Freight" });
    await t.as("pablo").mutation(api.purchasing.startOnboarding, { supplierId: second });
    await t.as("pablo").mutation(api.purchasing.recordCheck, { supplierId: second, check: "tax-id", value: "TX-551200" });
    await t.as("rhea").mutation(api.purchasing.recordCheck, { supplierId: second, check: "bank", value: "verified" });
    await t.as("ivy").mutation(api.purchasing.recordCheck, { supplierId: second, check: "risk", value: "low" });
    await rejects(t.as("pablo").mutation(api.purchasing.decideOnboarding, { supplierId: second, decision: "approved" }), "FORBIDDEN", /requested a supplier/);

    for (const i of [0, 1, 2]) await t.as("priya").mutation(api.changes.checkCriterion, { changeId: change.id, index: i, met: true, note: "Checked in the test environment" });
    // Acceptance needs deployment first: the lifecycle cannot skip release.
    await rejects(t.as("priya").mutation(api.changes.advance, { changeId: change.id, to: "accepted" }), "FAILED_PRECONDITION");

    const detail = await t.as("priya").query(api.changes.detail, { changeId: change.id });
    evidence("scenario-2", { change: detail.change, history: detail.history.map((h) => ({ at: h.at, actor: h.actorId, source: h.source, kind: h.kind, summary: h.summary })), github, supplier: { name: onboarded.name, status: onboarded.status, onboarding: onboarded.onboarding } });
  } finally {
    await t.close();
  }
});
