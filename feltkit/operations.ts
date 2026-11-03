/**
 * Customer operations and work management.
 */
import { fail, s } from "@feltdb/feltkit";
import { app, contracts, customerIssues, customers, people, projects, workItems } from "./app.js";
import { actor, nowIso, record, requirePerson } from "./_lib.js";

export const customerList = app.query({
  access: "ops.read",
  handler: async (ctx) => {
    await actor(ctx);
    const [all, allContracts, issues, everyone] = await Promise.all([ctx.db.find(customers, {}), ctx.db.find(contracts, {}), ctx.db.find(customerIssues, {}), ctx.db.find(people, {})]);
    const now = nowIso();
    return all.map((c) => ({
      ...c,
      owner: everyone.find((p) => p.id === c.ownerId)?.name ?? c.ownerId,
      contracts: allContracts.filter((k) => k.customerId === c.id),
      annualValue: allContracts.filter((k) => k.customerId === c.id && k.status !== "expired").reduce((n, k) => n + k.annualValue, 0),
      openIssues: issues.filter((i) => i.customerId === c.id && i.status === "open").length,
      breachedIssues: issues.filter((i) => i.customerId === c.id && i.status === "open" && i.slaDueAt < now).length,
    })).sort((a, b) => b.annualValue - a.annualValue);
  },
});

export const issues = app.query({
  access: "ops.read",
  handler: async (ctx) => {
    await actor(ctx);
    const [all, cs] = await Promise.all([ctx.db.find(customerIssues, {}), ctx.db.find(customers, {})]);
    return all.map((i) => ({ ...i, customer: cs.find((c) => c.id === i.customerId)?.name ?? "?" })).sort((a, b) => (a.slaDueAt < b.slaDueAt ? -1 : 1));
  },
});

export const openIssue = app.mutation({
  access: "ops.write",
  args: { customerId: s.string(), title: s.string({ minLength: 3 }), severity: s.enum(["low", "medium", "high"]), incidentId: s.optional(s.string()) },
  handler: async (ctx, { customerId, title, severity, incidentId }) => {
    const who = await requirePerson(ctx, "open a customer issue");
    const [c] = await ctx.db.find(contracts, { customerId, status: "active" });
    const hours = c?.slaHours ?? 72;
    const id = await ctx.db.insert(customerIssues, { customerId, title, severity, status: "open", openedAt: nowIso(), slaDueAt: new Date(Date.now() + hours * 3_600_000).toISOString(), ...(c ? { contractId: c.id } : {}), ...(incidentId ? { incidentId } : {}) });
    await record(ctx, `customer:${customerId}`, who, "issue.opened", `${title} (${severity}, SLA ${hours} h).`);
    return id;
  },
});

export const resolveIssue = app.mutation({
  access: "ops.write",
  args: { issueId: s.string() },
  handler: async (ctx, { issueId }) => {
    const who = await requirePerson(ctx, "resolve a customer issue");
    const i = await ctx.db.get(customerIssues, issueId);
    if (!i) fail("NOT_FOUND", `No issue ${issueId}.`);
    await ctx.db.patch(customerIssues, issueId, { status: "resolved", resolvedAt: nowIso() });
    await record(ctx, `customer:${i.customerId}`, who, "issue.resolved", i.title);
    return issueId;
  },
});

export const projectList = app.query({
  access: "work.read",
  handler: async (ctx) => {
    await actor(ctx);
    const [all, items, everyone] = await Promise.all([ctx.db.find(projects, {}), ctx.db.find(workItems, {}), ctx.db.find(people, {})]);
    const today = nowIso().slice(0, 10);
    return all.map((p) => {
      const mine = items.filter((w) => w.projectId === p.id);
      return {
        ...p, owner: everyone.find((x) => x.id === p.ownerId)?.name ?? p.ownerId,
        items: mine.map((w) => ({ ...w, assignee: everyone.find((x) => x.id === w.assigneeId)?.name ?? null, blockedBy: w.dependsOn.filter((d) => mine.find((m) => m.id === d)?.status !== "done") })),
        done: mine.filter((w) => w.status === "done").length, overdue: mine.filter((w) => w.status !== "done" && w.dueOn && w.dueOn < today).length,
      };
    });
  },
});

export const setWorkStatus = app.mutation({
  access: "work.write",
  args: { itemId: s.string(), status: s.enum(["todo", "doing", "blocked", "done"]), evidence: s.optional(s.string()) },
  handler: async (ctx, { itemId, status, evidence }) => {
    const who = await requirePerson(ctx, "update work");
    const w = await ctx.db.get(workItems, itemId);
    if (!w) fail("NOT_FOUND", `No work item ${itemId}.`);
    if (status === "done") {
      for (const d of w.dependsOn) if ((await ctx.db.get(workItems, d))?.status !== "done") fail("FAILED_PRECONDITION", "A dependency is not done yet.");
      if (!evidence && !w.evidence) fail("INVALID_ARGUMENT", "Say what shows it is done (evidence).");
    }
    await ctx.db.patch(workItems, itemId, { status, ...(evidence ? { evidence } : {}) });
    await record(ctx, `work:${itemId}`, who, "work.status", `${w.status} → ${status}${evidence ? `: ${evidence}` : ""}`);
    return itemId;
  },
});
