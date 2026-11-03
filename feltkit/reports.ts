/**
 * Operational intelligence, and the data fingerprint used to verify that business data
 * survived a platform change.
 */
import { fail, s } from "@feltdb/feltkit";
import type { QueryCtx, MutationCtx } from "@feltdb/feltkit";
import {
  agents, app, assignments, authorities, budgets, changes, commitments, contracts, customerIssues, customers, departments, externalRefs, incidents,
  invoices, people, policyVersions, purchaseOrders, purchaseRequests, suppliers, timeline, workItems,
} from "./app.js";
import { actor, nowIso, record, requirePerson } from "./_lib.js";

export const dashboard = app.query({
  access: "ops.read",
  handler: async (ctx) => {
    await actor(ctx);
    const now = nowIso();
    const [depts, staff, reqs, open, budgetRows, invs, issueRows, incs, work, asg, chg] = await Promise.all([
      ctx.db.find(departments, {}), ctx.db.find(people, {}), ctx.db.find(purchaseRequests, {}), ctx.db.find(commitments, { status: "open" }),
      ctx.db.find(budgets, {}), ctx.db.find(invoices, {}), ctx.db.find(customerIssues, {}), ctx.db.find(incidents, {}), ctx.db.find(workItems, {}),
      ctx.db.find(assignments, {}), ctx.db.find(changes, {}),
    ]);
    const pending = reqs.filter((r) => r.status === "pending");
    const ageDays = (iso: string) => (Date.parse(now) - Date.parse(iso)) / 86_400_000;
    return {
      at: now,
      people: { active: staff.filter((p) => p.status === "active").length, departed: staff.filter((p) => p.status === "departed").length },
      departments: depts.map((d) => {
        const budget = budgetRows.find((b) => b.departmentId === d.id)?.amount ?? 0;
        const committed = open.filter((c) => c.departmentId === d.id).reduce((n, c) => n + c.amount, 0);
        return { id: d.id, code: d.code, name: d.name, headcount: staff.filter((p) => p.departmentId === d.id && p.status === "active").length, budget, committed, utilization: budget ? committed / budget : 0, pendingRequests: pending.filter((r) => r.departmentId === d.id).length };
      }),
      purchasing: { pending: pending.length, pendingOver3Days: pending.filter((r) => ageDays(r.submittedAt) > 3).length, ordered30d: reqs.filter((r) => r.status === "ordered" && ageDays(r.submittedAt) <= 30).length },
      finance: { openCommitments: open.length, committedTotal: open.reduce((n, c) => n + c.amount, 0), invoiceExceptions: invs.filter((i) => i.status === "exception").length },
      customers: { openIssues: issueRows.filter((i) => i.status === "open").length, slaBreached: issueRows.filter((i) => i.status === "open" && i.slaDueAt < now).length },
      incidents: { open: incs.filter((i) => !["resolved", "reviewed"].includes(i.status)).length, sev1: incs.filter((i) => i.severity === "sev1" && !["resolved", "reviewed"].includes(i.status)).length },
      work: { open: work.filter((w) => w.status !== "done").length, blocked: work.filter((w) => w.status === "blocked").length, done: work.filter((w) => w.status === "done").length },
      agents: { active: asg.filter((a) => ["assigned", "accepted", "running", "recovering"].includes(a.status)).length, attention: asg.filter((a) => ["waiting-approval", "waiting-intervention", "failed", "completed"].includes(a.status)).length, verified: asg.filter((a) => a.status === "verified").length },
      changes: { config: chg.filter((c) => c.kind === "config").length, application: chg.filter((c) => c.kind === "application").length, platform: chg.filter((c) => c.kind === "platform").length, inFlight: chg.filter((c) => !["verified", "accepted", "rejected", "deferred"].includes(c.status)).length },
    };
  },
});

/** Counts and money totals per collection: what a platform upgrade must not change. */
export async function fingerprint(ctx: QueryCtx | MutationCtx) {
  const cols = { departments, people, authorities, customers, contracts, suppliers, purchaseRequests, purchaseOrders, invoices, commitments, policyVersions, incidents, agents, assignments, timeline };
  const counts: Record<string, number> = {};
  for (const [name, c] of Object.entries(cols)) counts[name] = await ctx.db.count(c, {});
  const sum = (rows: Array<{ amount: number }>) => Math.round(rows.reduce((n, r) => n + r.amount, 0) * 100) / 100;
  const totals = {
    purchaseOrders: sum(await ctx.db.find(purchaseOrders, {})),
    openCommitments: sum(await ctx.db.find(commitments, { status: "open" })),
    invoices: sum(await ctx.db.find(invoices, {})),
    contracts: Math.round((await ctx.db.find(contracts, {})).reduce((n, k) => n + k.annualValue, 0)),
  };
  return { counts, totals };
}

export const dataFingerprint = app.query({
  access: "changes.read",
  handler: async (ctx) => {
    await actor(ctx);
    return fingerprint(ctx);
  },
});

/** Before a platform change: record the fingerprint, computed here. */
export const captureBaseline = app.mutation({
  access: "changes.engineer",
  args: { changeId: s.string() },
  handler: async (ctx, { changeId }) => {
    const who = await requirePerson(ctx, "capture a data baseline");
    const c = await ctx.db.get(changes, changeId);
    if (!c || c.kind !== "platform") fail("FAILED_PRECONDITION", "A data baseline belongs to a platform change.");
    const fp = await fingerprint(ctx);
    const id = await ctx.db.insert(externalRefs, { subject: `change:${changeId}`, system: "local-production", kind: "data-baseline", ref: c.platform?.from ?? "", status: "captured", observedAt: nowIso(), observedBy: who.id, observedVia: "computed", detail: fp });
    await record(ctx, `change:${changeId}`, who, "baseline.captured", `Data baseline: ${Object.entries(fp.counts).map(([k, v]) => `${k} ${v}`).join(", ")}.`, { source: "verification" });
    return id;
  },
});

/**
 * After the upgrade: the fingerprint must equal the baseline, except for history written
 * since (timeline grows with every recorded step, so it may only grow).
 */
export const verifyData = app.mutation({
  access: "changes.engineer",
  args: { changeId: s.string() },
  handler: async (ctx, { changeId }) => {
    const who = await requirePerson(ctx, "verify data after a platform change");
    const [baseline] = (await ctx.db.find(externalRefs, { subject: `change:${changeId}`, kind: "data-baseline" })).sort((a, b) => (a.observedAt < b.observedAt ? 1 : -1));
    if (!baseline) fail("FAILED_PRECONDITION", "Capture a data baseline before the upgrade.");
    const before = baseline.detail as unknown as Awaited<ReturnType<typeof fingerprint>>;
    const after = await fingerprint(ctx);
    const differences: string[] = [];
    for (const [k, v] of Object.entries(before.counts)) {
      const now = after.counts[k] ?? 0;
      if (k === "timeline" ? now < v : now !== v) differences.push(`${k}: ${v} → ${now}`);
    }
    for (const [k, v] of Object.entries(before.totals)) if ((after.totals as Record<string, number>)[k] !== v) differences.push(`${k} total: ${v} → ${(after.totals as Record<string, number>)[k]}`);
    const passed = differences.length === 0;
    const c = (await ctx.db.get(changes, changeId))!;
    await ctx.db.insert(externalRefs, { subject: `change:${changeId}`, system: "local-production", kind: "data-verification", ref: c.platform?.to ?? "", status: passed ? "passed" : "failed", observedAt: nowIso(), observedBy: who.id, observedVia: "computed", detail: { before, after, differences } });
    await record(ctx, `change:${changeId}`, who, passed ? "data.verified" : "data.verification-failed", passed ? "Business data matches the pre-upgrade baseline." : differences.join("; "), { source: "verification" });
    return { passed, differences };
  },
});

export const supplierSummary = app.query({
  access: "purchasing.read",
  handler: async (ctx) => {
    await actor(ctx);
    const [all, pos, invs] = await Promise.all([ctx.db.find(suppliers, {}), ctx.db.find(purchaseOrders, {}), ctx.db.find(invoices, {})]);
    return all.map((sup) => ({ ...sup, orders: pos.filter((p) => p.supplierId === sup.id).length, ordered: pos.filter((p) => p.supplierId === sup.id).reduce((n, p) => n + p.amount, 0), invoices: invs.filter((i) => i.supplierId === sup.id).length }));
  },
});

