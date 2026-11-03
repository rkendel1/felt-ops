/**
 * Procurement and finance: suppliers, purchase requests and their policy-driven approval
 * chains, purchase orders, receipts, invoices and the commitments they create.
 */
import { fail, s } from "@feltdb/feltkit";
import { app, authorities, budgets, commitments, invoices, people, purchaseOrders, purchaseRequests, receipts, supplierLinks, suppliers, timeline } from "./app.js";
import { actor, effectiveVersion, grantFor, money, nextNumber, nowIso, record, requirePerson, stepsFor } from "./_lib.js";
import { normalizeNumber as normalize, processInvoice } from "./_invoicing.js";
import { withinAssignment } from "./_scope.js";

const Request = s.doc(purchaseRequests);
const Invoice = s.doc(invoices);
const Commitment = s.doc(commitments);

// ───────────── Suppliers ─────────────

export const listSuppliers = app.query({
  access: "purchasing.read",
  returns: s.array(s.doc(suppliers)),
  capability: { name: "suppliers.list", description: "Suppliers and their status." },
  handler: async (ctx) => {
    await actor(ctx);
    return ctx.db.find(suppliers, {}, { orderBy: [{ field: "name", direction: "asc" }] });
  },
});

export const requestSupplier = app.mutation({
  access: "suppliers.request",
  args: { name: s.string({ minLength: 2 }), category: s.string() },
  handler: async (ctx, { name, category }) => {
    const who = await requirePerson(ctx, "request a supplier");
    const id = await ctx.db.insert(suppliers, { name, category, status: "requested", requestedBy: who.recordId });
    await record(ctx, `supplier:${id}`, who, "supplier.requested", `${who.name} requested ${name} (${category}).`);
    return id;
  },
});

// ───────────── Purchase requests ─────────────

/** For each step, the first active holder of a covering grant who is not the requester. */
async function assignees(ctx: Parameters<typeof actor>[0], steps: ReturnType<typeof stepsFor>, amount: number, requesterId: string) {
  const out = [];
  for (const st of steps) {
    const grants = (await ctx.db.find(authorities, { kind: st.kind, status: "active" }))
      .filter((g) => g.holderId !== requesterId && (g.limit === undefined || amount <= g.limit) && (!g.departmentId || !st.departmentId || g.departmentId === st.departmentId));
    const holders = await Promise.all(grants.map((g) => ctx.db.get(people, g.holderId)));
    const holder = holders.filter((p) => p && p.status === "active").sort((a, b) => a!.name.localeCompare(b!.name))[0];
    out.push({ ...st, ...(holder ? { assigneeId: holder.id } : {}) });
  }
  return out;
}

export const submitRequest = app.mutation({
  access: "purchasing.request",
  args: { supplierId: s.string(), amount: s.number({ minimum: 0.01 }), description: s.string({ minLength: 3 }), departmentId: s.optional(s.string()) },
  returns: Request,
  capability: { name: "purchasing.submit", description: "Submit a purchase request. Its approval chain comes from the purchasing policy in force now." },
  handler: async (ctx, { supplierId, amount, description, departmentId }) => {
    const who = await requirePerson(ctx, "submit a purchase request");
    const requester = (await ctx.db.get(people, who.recordId))!;
    const supplier = await ctx.db.get(suppliers, supplierId);
    if (!supplier) fail("NOT_FOUND", `No supplier ${supplierId}.`);
    if (supplier.status !== "active") fail("FAILED_PRECONDITION", `${supplier.name} is ${supplier.status}; only active suppliers can be ordered from.`);
    const dept = departmentId ?? requester.departmentId;
    const at = nowIso();
    const { version } = await effectiveVersion(ctx, "purchasing.approval", at);
    const steps = await assignees(ctx, stepsFor(version.rules, amount, dept), amount, who.recordId);
    const number = await nextNumber(ctx, "PR");
    const id = await ctx.db.insert(purchaseRequests, { number, departmentId: dept, supplierId, requesterId: who.recordId, amount, description, status: "pending", policyVersionId: version.id, steps, submittedAt: at });
    await record(ctx, `purchase:${id}`, who, "request.submitted", `${number}: ${money(amount)} from ${supplier.name}. Needs ${steps.map((x) => x.label).join(" → ")} (policy v${version.version}).`, { data: { policyVersionId: version.id } });
    const first = steps[0]?.assigneeId ? await ctx.db.get(people, steps[0].assigneeId) : null;
    if (first?.login) ctx.afterCommit.notifications.send({ recipient: first.login, type: "approval.requested", title: `${number} needs your approval`, body: `${money(amount)} — ${description}`, data: { requestId: id } });
    return (await ctx.db.get(purchaseRequests, id))!;
  },
});

export const listRequests = app.query({
  access: "purchasing.read",
  args: { status: s.optional(s.enum(["pending", "approved", "rejected", "ordered", "cancelled"])) },
  returns: s.array(Request),
  capability: { name: "purchasing.requests", description: "Purchase requests, newest first." },
  handler: async (ctx, { status }) => {
    await actor(ctx);
    const rows = await ctx.db.find(purchaseRequests, status ? { status } : {});
    return rows.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
  },
});

/** Approval inbox: steps the caller can decide now, and those assigned to them. */
export const myApprovals = app.query({
  access: "purchasing.read",
  handler: async (ctx) => {
    const who = await actor(ctx);
    if (who.type !== "person") return [];
    const out = [];
    for (const r of await ctx.db.find(purchaseRequests, { status: "pending" })) {
      const step = r.steps.find((x) => !x.decision);
      if (!step) continue;
      const grant = await grantFor(ctx, who.recordId, step.kind, r.amount, step.departmentId);
      const decidedAnother = r.steps.some((x) => x.decidedBy === who.recordId);
      const canDecide = !!grant && r.requesterId !== who.recordId && !decidedAnother;
      if (canDecide || step.assigneeId === who.recordId) {
        const supplier = await ctx.db.get(suppliers, r.supplierId);
        out.push({ request: r, step, supplier: supplier?.name ?? "?", canDecide, why: canDecide ? `You hold ${step.kind}${grant!.limit !== undefined ? ` up to ${money(grant!.limit)}` : ""}.` : r.requesterId === who.recordId ? "You requested it." : decidedAnother ? "You already decided another step of this request." : `You hold no active ${step.kind} grant covering ${money(r.amount)}.` });
      }
    }
    return out;
  },
});

export const decideRequest = app.mutation({
  access: "purchasing.approve",
  args: { requestId: s.string(), decision: s.enum(["approved", "rejected"]), note: s.optional(s.string()) },
  handler: async (ctx, { requestId, decision, note }) => {
    const who = await requirePerson(ctx, "decide a purchase request");
    const r = await ctx.db.get(purchaseRequests, requestId);
    if (!r) fail("NOT_FOUND", `No purchase request ${requestId}.`);
    if (r.status !== "pending") fail("FAILED_PRECONDITION", `${r.number} is ${r.status}.`);
    const index = r.steps.findIndex((x) => !x.decision);
    const step = r.steps[index]!;
    if (r.requesterId === who.recordId) fail("FORBIDDEN", "You cannot approve your own request.");
    if (r.steps.some((x) => x.decidedBy === who.recordId)) fail("FORBIDDEN", "One person may decide only one step of a request.");
    const grant = await grantFor(ctx, who.recordId, step.kind, r.amount, step.departmentId);
    if (!grant) fail("FORBIDDEN", `${who.name} holds no active ${step.kind} authority covering ${money(r.amount)}${step.departmentId ? " for this department" : ""}.`);
    const at = nowIso();
    const steps = r.steps.map((x, i) => (i === index ? { ...x, decision, decidedBy: who.recordId, decidedAt: at, ...(note ? { note } : {}) } : x));
    const done = decision === "rejected" ? "rejected" : steps.every((x) => x.decision === "approved") ? "approved" : "pending";
    await ctx.db.patch(purchaseRequests, requestId, { steps, status: done });
    await record(ctx, `purchase:${requestId}`, who, `step.${decision}`, `${step.label}: ${decision} by ${who.name} (grant ${grant.id}).${note ? ` ${note}` : ""}`);
    if (done === "approved") {
      const number = await nextNumber(ctx, "PO");
      const poId = await ctx.db.insert(purchaseOrders, { number, requestId, supplierId: r.supplierId, departmentId: r.departmentId, amount: r.amount, status: "issued", issuedAt: at });
      await ctx.db.patch(purchaseRequests, requestId, { status: "ordered" });
      await record(ctx, `purchase:${requestId}`, who, "po.issued", `${number} issued for ${money(r.amount)}.`, { data: { poId } });
      ctx.afterCommit.webhooks.emit("purchase.approved", { requestId, poId, amount: r.amount });
    }
    return { status: done === "approved" ? "ordered" : done };
  },
});

export const listOrders = app.query({
  access: "purchasing.read",
  handler: async (ctx) => {
    await actor(ctx);
    return ctx.db.find(purchaseOrders, {}, { orderBy: [{ field: "issuedAt", direction: "desc" }] });
  },
});

export const receive = app.mutation({
  access: "purchasing.request",
  args: { poId: s.string(), amount: s.number({ minimum: 0.01 }) },
  handler: async (ctx, { poId, amount }) => {
    const who = await requirePerson(ctx, "receive goods");
    const po = await ctx.db.get(purchaseOrders, poId);
    if (!po) fail("NOT_FOUND", `No purchase order ${poId}.`);
    const id = await ctx.db.insert(receipts, { poId, receivedBy: who.recordId, amount, at: nowIso() });
    await ctx.db.patch(purchaseOrders, poId, { status: "received" });
    await record(ctx, `po:${poId}`, who, "goods.received", `Received ${money(amount)} against ${po.number}.`);
    return id;
  },
});

// ───────────── Invoices and commitments ─────────────

export const enterInvoice = app.mutation({
  access: "invoices.write",
  args: { supplierId: s.string(), poNumber: s.optional(s.string()), number: s.string({ minLength: 1 }), amount: s.number({ minimum: 0.01 }) },
  handler: async (ctx, args) => {
    const who = await requirePerson(ctx, "enter an invoice");
    const [same] = await ctx.db.find(invoices, { supplierId: args.supplierId, number: args.number, channel: "manual" });
    if (same) fail("CONFLICT", `Invoice ${args.number} was already entered manually.`);
    return processInvoice(ctx, who, { ...args, channel: "manual" });
  },
});

/**
 * Import invoices from a supplier feed (the Integration Sentry calls this with what
 * supplierapi.* returned). Deduplicated by the feed's delivery id.
 */
export const ingestInvoices = app.mutation({
  access: "invoices.ingest",
  args: { supplierId: s.string(), rows: s.array(s.object({ externalId: s.string(), number: s.string(), poNumber: s.optional(s.string()), amount: s.number(), issuedAt: s.string() })), syncedThrough: s.optional(s.string()) },
  returns: s.object({ imported: s.number(), skipped: s.number(), exceptions: s.number() }),
  capability: { name: "invoices.ingest", description: "Import supplier-feed invoices (deduplicated by delivery id) and advance the supplier's sync watermark." },
  handler: async (ctx, { supplierId, rows, syncedThrough }) => {
    const who = await actor(ctx);
    await withinAssignment(ctx, who, "invoices.ingest");
    let imported = 0, skipped = 0, exceptions = 0;
    for (const row of rows) {
      const [seen] = await ctx.db.find(invoices, { externalId: row.externalId });
      if (seen) { skipped += 1; continue; }
      const out = await processInvoice(ctx, who, { supplierId, number: row.number, amount: row.amount, channel: "supplier-feed", externalId: row.externalId, ...(row.poNumber ? { poNumber: row.poNumber } : {}) });
      imported += 1;
      if (out.status !== "matched") exceptions += 1;
    }
    if (syncedThrough) {
      const [link] = await ctx.db.find(supplierLinks, { supplierId });
      if (link && syncedThrough > link.syncedThrough) await ctx.db.patch(supplierLinks, link.id, { syncedThrough, status: link.status === "isolated" ? "isolated" : "healthy", lastSuccessAt: nowIso() });
    }
    return { imported, skipped, exceptions };
  },
});

export const listInvoices = app.query({
  access: "invoices.read",
  args: { supplierId: s.optional(s.string()) },
  returns: s.array(Invoice),
  capability: { name: "invoices.list", description: "Invoices, newest first." },
  handler: async (ctx, { supplierId }) => {
    await actor(ctx);
    const rows = await ctx.db.find(invoices, supplierId ? { supplierId } : {});
    return rows.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  },
});

export const listCommitments = app.query({
  access: "commitments.read",
  args: { status: s.optional(s.enum(["open", "reversed"])) },
  returns: s.array(Commitment),
  capability: { name: "commitments.list", description: "Financial commitments created by matched invoices." },
  handler: async (ctx, { status }) => {
    await actor(ctx);
    return ctx.db.find(commitments, status ? { status } : {});
  },
});


/**
 * Independent reconciliation: computed from records by CompanyOS, never by an agent.
 * A duplicate is an open commitment whose invoice has the same supplier and normalized
 * number as an earlier invoice that also holds an open commitment.
 */
export async function reconcileState(ctx: Parameters<typeof actor>[0]) {
  const open = await ctx.db.find(commitments, { status: "open" });
  const allInvoices = new Map((await ctx.db.find(invoices, {})).map((i) => [i.id, i]));
  const groups = new Map<string, typeof open>();
  for (const c of open) {
    const inv = allInvoices.get(c.invoiceId);
    if (!inv) continue;
    const key = `${inv.supplierId}|${normalize(inv.number)}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const duplicates = [...groups.values()].filter((g) => g.length > 1).flatMap((g) => {
    const sorted = [...g].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id)));
    return sorted.slice(1).map((c) => ({ commitmentId: c.id, invoiceId: c.invoiceId, keeps: sorted[0]!.id, amount: c.amount, number: allInvoices.get(c.invoiceId)!.number }));
  });
  const orders = await ctx.db.find(purchaseOrders, {});
  const overCommitted = orders.map((po) => ({ po, committed: open.filter((c) => c.poId === po.id).reduce((n, c) => n + c.amount, 0) }))
    .filter((x) => x.committed > x.po.amount + 0.005).map((x) => ({ poId: x.po.id, number: x.po.number, amount: x.po.amount, committed: x.committed }));
  return { openCommitments: open.length, openTotal: open.reduce((n, c) => n + c.amount, 0), duplicates, duplicateTotal: duplicates.reduce((n, d) => n + d.amount, 0), overCommitted };
}

export const reconciliation = app.query({
  access: "commitments.read",
  returns: s.object({
    openCommitments: s.number(), openTotal: s.number(), duplicateTotal: s.number(),
    duplicates: s.array(s.object({ commitmentId: s.string(), invoiceId: s.string(), keeps: s.string(), amount: s.number(), number: s.string() })),
    overCommitted: s.array(s.object({ poId: s.string(), number: s.string(), amount: s.number(), committed: s.number() })),
  }),
  capability: { name: "finance.reconciliation", description: "Duplicate and over-committed commitments, computed from records." },
  handler: async (ctx) => {
    await actor(ctx);
    return reconcileState(ctx);
  },
});

/**
 * Reverse a duplicate commitment. Consequential and irreversible in finance terms: an agent
 * can only propose it, and only for a commitment the reconciliation identifies as a duplicate.
 */
export const reverseCommitment = app.mutation({
  access: "commitments.reverse",
  approval: "required",
  args: { commitmentId: s.string(), reason: s.string({ minLength: 5 }), incidentId: s.optional(s.string()) },
  returns: s.object({ commitmentId: s.string(), status: s.string() }),
  capability: { name: "commitments.reverse", description: "Reverse a commitment the reconciliation identifies as a duplicate, and void its invoice. Agents must propose it." },
  handler: async (ctx, { commitmentId, reason, incidentId }) => {
    const who = await actor(ctx);
    await withinAssignment(ctx, who, "commitments.reverse");
    const c = await ctx.db.get(commitments, commitmentId);
    if (!c) fail("NOT_FOUND", `No commitment ${commitmentId}.`);
    if (c.status === "reversed") fail("FAILED_PRECONDITION", `Commitment ${commitmentId} was already reversed at ${c.reversedAt} by ${c.reversedBy}. Nothing changed.`);
    const { duplicates } = await reconcileState(ctx);
    if (!duplicates.some((d) => d.commitmentId === commitmentId)) fail("FAILED_PRECONDITION", "The reconciliation does not identify this commitment as a duplicate; it cannot be reversed here.");
    const at = nowIso();
    await ctx.db.patch(commitments, commitmentId, { status: "reversed", reversedAt: at, reversedBy: who.id, reversalReason: reason, ...(incidentId ? { incidentId } : {}) });
    await ctx.db.patch(invoices, c.invoiceId, { status: "void" });
    await record(ctx, `commitment:${commitmentId}`, who, "commitment.reversed", `Reversed ${money(c.amount)}: ${reason}`, { data: { incidentId: incidentId ?? null } });
    if (incidentId) await record(ctx, `incident:${incidentId}`, who, "remediation.step", `Reversed duplicate commitment ${commitmentId} (${money(c.amount)}).`, { data: { commitmentId } });
    return { commitmentId, status: "reversed" };
  },
});

export const budgetSummary = app.query({
  access: "purchasing.read",
  handler: async (ctx) => {
    await actor(ctx);
    const [all, open] = await Promise.all([ctx.db.find(budgets, {}), ctx.db.find(commitments, { status: "open" })]);
    return all.map((b) => {
      const committed = open.filter((c) => c.departmentId === b.departmentId).reduce((n, c) => n + c.amount, 0);
      return { ...b, committed, remaining: b.amount - committed };
    });
  },
});

export const requestHistory = app.query({
  access: "purchasing.read",
  args: { requestId: s.string() },
  handler: async (ctx, { requestId }) => {
    await actor(ctx);
    return ctx.db.find(timeline, { subject: `purchase:${requestId}` }, { orderBy: [{ field: "seq", direction: "asc" }] });
  },
});
