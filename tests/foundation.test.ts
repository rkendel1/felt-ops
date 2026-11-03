import { test } from "node:test";
import assert from "node:assert/strict";
import { api, rejects, seeded } from "./_support.js";

test("the seeded company is consistent: 150 people, explicit authority, books that reconcile", async () => {
  const { t, seed } = await seeded();
  try {
    assert.equal(seed.people, 150);
    assert.equal(seed.departments, 7);
    const org = await t.as("omar").query(api.org.overview);
    assert.equal(org.reduce((n, d) => n + d.active + d.departed, 0), 150);
    const rec = await t.as("fiona").query(api.purchasing.reconciliation);
    assert.equal(rec.duplicates.length, 0, "seeded books have no duplicates");
    assert.equal(rec.overCommitted.length, 0);
    assert.ok(rec.openCommitments >= 25);
    const pol = await t.as("fiona").query(api.policies.effective, { key: "purchasing.approval" });
    assert.equal(pol.version, 1);
    const fiona = await t.as("fiona").query(api.org.me);
    assert.ok(fiona.grants.some((g) => g.kind === "purchase.approve.finance" && g.limit === 100_000));
    await rejects(t.as("ivy").mutation(api.seed.seed), "FAILED_PRECONDITION", /already seeded/);
  } finally {
    await t.close();
  }
});

test("platform roles and business authority are both enforced", async () => {
  const { t } = await seeded();
  try {
    // Platform: an auditor cannot write; a viewer-like role is refused before arguments are read.
    await rejects(t.as("vic").mutation(api.purchasing.submitRequest, { supplierId: "x", amount: 1, description: "xyz" }), "FORBIDDEN");
    // Business: Rhea holds Finance authority up to 25,000, not the department-manager step.
    const pending = await t.as("rhea").query(api.purchasing.myApprovals);
    for (const p of pending) assert.equal(p.canDecide, p.step.kind === "purchase.approve.finance" && p.request.amount <= 25_000);
    // An agent is not an ordinary user: it cannot submit purchases (no permission) …
    await rejects(t.as("agent-ledger").mutation(api.purchasing.submitRequest, { supplierId: "x", amount: 1, description: "xyz" }), "FORBIDDEN");
    // … and an unregistered agent identity is refused by CompanyOS even with a valid role.
    await rejects(t.as({ id: "agent-rogue", type: "agent", roles: ["agent-finance"] }).query(api.purchasing.reconciliation), "FORBIDDEN", /not registered/);
  } finally {
    await t.close();
  }
});

test("state survives a restart", async () => {
  const { t } = await seeded();
  try {
    const before = await t.as("eli").query(api.reports.dataFingerprint);
    await t.restart();
    assert.deepEqual(await t.as("eli").query(api.reports.dataFingerprint), before);
  } finally {
    await t.close();
  }
});
