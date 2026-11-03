/**
 * Scenario 1 — Business policy change (business → configuration).
 *
 * Finance lowers the purchasing approval thresholds. The system shows the affected
 * workflows, refuses unauthorized approval, applies the new rules from the effective date
 * without a deployment, keeps earlier requests on the rules they were submitted under, and
 * verifies the behavior from records.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { api, evidence, rejects, seeded } from "./_support.js";

const V2 = {
  tiers: [
    { upTo: 2_500, steps: [{ kind: "purchase.approve.manager", label: "Department manager", scope: "department" }] },
    { upTo: 10_000, steps: [{ kind: "purchase.approve.manager", label: "Department manager", scope: "department" }, { kind: "purchase.approve.finance", label: "Finance" }] },
    { upTo: null, steps: [{ kind: "purchase.approve.manager", label: "Department manager", scope: "department" }, { kind: "purchase.approve.finance", label: "Finance" }, { kind: "purchase.approve.executive", label: "Executive" }] },
  ],
};

test("scenario 1: finance changes purchasing approval thresholds", async () => {
  const { t } = await seeded();
  try {
    const suppliers = await t.as("pablo").query(api.purchasing.listSuppliers);
    const supplierId = suppliers.find((s) => s.name === "Contoso Cloud")!.id;
    const chain = (r: { steps: Array<{ label: string }> }) => r.steps.map((s) => s.label).join(" → ");

    // Before: a 12,000 request needs manager → finance under v1.
    const before = await t.as("otto").mutation(api.purchasing.submitRequest, { supplierId, amount: 12_000, description: "Monitoring licences" });
    assert.equal(chain(before), "Department manager → Finance");

    // Failure conditions: malformed rules, and people without the authority.
    await rejects(t.as("fiona").mutation(api.policies.propose, { key: "purchasing.approval", rules: { tiers: [{ upTo: 100, steps: [] }] }, effectiveFrom: new Date().toISOString(), rationale: "broken rules for the test" }), "INVALID_ARGUMENT");
    await rejects(t.as("priya").mutation(api.policies.propose, { key: "purchasing.approval", rules: V2, effectiveFrom: new Date().toISOString(), rationale: "operations cannot propose" }), "FORBIDDEN");

    const proposal = await t.as("fiona").mutation(api.policies.propose, { key: "purchasing.approval", rules: V2, effectiveFrom: new Date().toISOString(), rationale: "Audit finding AF-12: approvals above 10k need an executive." });
    const impact = await t.as("fiona").query(api.policies.impact, { versionId: proposal.versionId });
    assert.deepEqual(impact.workflows, ["purchase-request approval", "purchase-order issue"]);
    assert.deepEqual(impact.changedAmounts, [4_999, 5_000, 12_000, 24_999, 25_000], "amounts whose chain changes");

    // A draft changes nothing yet.
    const during = await t.as("otto").mutation(api.purchasing.submitRequest, { supplierId, amount: 12_000, description: "Second batch" });
    assert.equal(chain(during), "Department manager → Finance");

    await rejects(t.as("fiona").mutation(api.policies.decide, { versionId: proposal.versionId, decision: "approved" }), "FORBIDDEN", /approve|permission/i);
    await rejects(t.as("rhea").mutation(api.policies.decide, { versionId: proposal.versionId, decision: "approved" }), "FORBIDDEN");
    await t.as("maria").mutation(api.policies.decide, { versionId: proposal.versionId, decision: "approved", note: "Agreed with audit." });

    // After: new requests follow v2; the earlier ones keep v1.
    const after12 = await t.as("otto").mutation(api.purchasing.submitRequest, { supplierId, amount: 12_000, description: "Third batch" });
    const after3 = await t.as("otto").mutation(api.purchasing.submitRequest, { supplierId, amount: 3_000, description: "Cables" });
    assert.equal(chain(after12), "Department manager → Finance → Executive");
    assert.equal(chain(after3), "Department manager → Finance");
    const stored = await t.as("otto").query(api.purchasing.listRequests, { status: "pending" });
    assert.equal(chain(stored.find((r) => r.id === before.id)!), "Department manager → Finance", "earlier request unchanged");
    assert.notEqual(stored.find((r) => r.id === before.id)!.policyVersionId, after12.policyVersionId);

    const verification = await t.as("fiona").mutation(api.policies.verify, { versionId: proposal.versionId });
    assert.equal(verification.ok, true, JSON.stringify(verification.problems));
    assert.deepEqual(verification.requestNumbers, [after12.number, after3.number]);

    // Business configuration, not a release: no release, no deployment.
    assert.equal((await t.as("eli").query(api.changes.listReleases)).length, 0);
    const change = (await t.as("dana").query(api.changes.list, { kind: "config" }))[0]!;
    assert.equal(change.status, "verified");
    const history = await t.as("dana").query(api.org.history, { subject: `change:${change.id}` });
    assert.deepEqual(history.map((h) => h.kind), ["change.requested", "change.approved", "change.verified"]);

    evidence("scenario-1", { change, impact: { changedAmounts: impact.changedAmounts, comparison: impact.comparison }, before: chain(before), afterAt12000: chain(after12), afterAt3000: chain(after3), verification, history: history.map((h) => ({ at: h.at, actor: h.actorId, source: h.source, kind: h.kind, summary: h.summary })) });
  } finally {
    await t.close();
  }
});
