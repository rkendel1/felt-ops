/**
 * Incidents: detection, classification, business impact, the records affected, the
 * engineering change that fixes the cause, and verification computed from records.
 */
import { fail, s } from "@feltdb/feltkit";
import { app, assignments, changes, incidents, supplierLinks, timeline } from "./app.js";
import { actor, money, nextNumber, nowIso, record, requirePerson } from "./_lib.js";
import { reconcileState } from "./purchasing.js";
import { withinAssignment } from "./_scope.js";

const Incident = s.doc(incidents);
const PROCESSES = ["invoice-processing", "supplier-integration", "purchasing", "access", "deployment"] as const;

export const open = app.mutation({
  access: "incidents.report",
  args: {
    title: s.string({ minLength: 5 }), severity: s.enum(["sev1", "sev2", "sev3"]), process: s.enum([...PROCESSES]),
    businessImpact: s.string({ minLength: 5 }), affected: s.array(s.object({ collection: s.string(), id: s.string() })),
  },
  returns: Incident,
  capability: { name: "incidents.open", description: "Open an incident against a business process, with the records it affects." },
  handler: async (ctx, a) => {
    const who = await actor(ctx);
    await withinAssignment(ctx, who, "incidents.open");
    const existing = (await ctx.db.find(incidents, { process: a.process })).find((i) => !["resolved", "reviewed"].includes(i.status));
    if (existing) {
      await record(ctx, `incident:${existing.id}`, who, "detected.again", `${who.name} reported it again: ${a.title}`, { source: who.type === "agent" ? "assertion" : "platform" });
      return existing;
    }
    const number = await nextNumber(ctx, "INC");
    const id = await ctx.db.insert(incidents, { number, title: a.title, severity: a.severity, status: "open", process: a.process, businessImpact: a.businessImpact, affected: a.affected, detectedBy: who.id, openedAt: nowIso() });
    await record(ctx, `incident:${id}`, who, "incident.opened", `${number} ${a.severity}: ${a.title}. ${a.affected.length} record(s) affected.`);
    ctx.afterCommit.webhooks.emit("incident.opened", { incidentId: id, number, severity: a.severity, process: a.process });
    return (await ctx.db.get(incidents, id))!;
  },
});

export const list = app.query({
  access: "incidents.read",
  returns: s.array(Incident),
  capability: { name: "incidents.list", description: "Incidents, open first." },
  handler: async (ctx) => {
    await actor(ctx);
    const rows = await ctx.db.find(incidents, {});
    const rank = (st: string) => ["open", "investigating", "mitigated", "resolved", "reviewed"].indexOf(st);
    return rows.sort((a, b) => rank(a.status) - rank(b.status) || b.number.localeCompare(a.number));
  },
});

export const detail = app.query({
  access: "incidents.read",
  args: { incidentId: s.string() },
  handler: async (ctx, { incidentId }) => {
    await actor(ctx);
    const incident = await ctx.db.get(incidents, incidentId);
    if (!incident) fail("NOT_FOUND", `No incident ${incidentId}.`);
    const history = await ctx.db.find(timeline, { subject: `incident:${incidentId}` }, { orderBy: [{ field: "seq", direction: "asc" }] });
    const change = incident.changeId ? await ctx.db.get(changes, incident.changeId) : null;
    const work = (await ctx.db.find(assignments, {})).filter((a) => a.subject?.collection === "incidents" && a.subject.id === incidentId)
      .map((a) => ({ id: a.id, number: a.number, agentKey: a.agentKey, title: a.title, status: a.status }));
    return { incident, history, change, assignments: work, check: await check(ctx, incident.process) };
  },
});

/** The deterministic health check of a process: what verification compares against. */
async function check(ctx: Parameters<typeof actor>[0], process: string) {
  if (process === "invoice-processing") {
    const r = await reconcileState(ctx);
    return { healthy: r.duplicates.length === 0 && r.overCommitted.length === 0, summary: `${r.duplicates.length} duplicate commitment(s) (${money(r.duplicateTotal)}), ${r.overCommitted.length} over-committed PO(s)`, detail: r as unknown as Record<string, unknown> };
  }
  if (process === "supplier-integration") {
    const linksNow = await ctx.db.find(supplierLinks, {});
    const bad = linksNow.filter((l) => l.status !== "healthy");
    return { healthy: bad.length === 0, summary: `${bad.length} supplier link(s) not healthy`, detail: { links: linksNow.map((l) => ({ supplierId: l.supplierId, status: l.status, apiVersion: l.apiVersion, syncedThrough: l.syncedThrough })) } };
  }
  return { healthy: null, summary: "No automatic check for this process; verify by hand.", detail: {} };
}

export const note = app.mutation({
  access: "incidents.note",
  args: { incidentId: s.string(), text: s.string({ minLength: 3 }) },
  returns: s.string(),
  capability: { name: "incidents.note", description: "Add an investigation note. An agent's note is recorded as its assertion." },
  handler: async (ctx, { incidentId, text }) => {
    const who = await actor(ctx);
    await withinAssignment(ctx, who, "incidents.note");
    if (!(await ctx.db.get(incidents, incidentId))) fail("NOT_FOUND", `No incident ${incidentId}.`);
    await record(ctx, `incident:${incidentId}`, who, "note", text, { source: who.type === "agent" ? "assertion" : "platform" });
    return incidentId;
  },
});

export const update = app.mutation({
  access: "incidents.write",
  args: { incidentId: s.string(), status: s.optional(s.enum(["investigating", "mitigated"])), ownerId: s.optional(s.string()), rootCause: s.optional(s.string()), changeId: s.optional(s.string()) },
  handler: async (ctx, { incidentId, ...a }) => {
    const who = await requirePerson(ctx, "update an incident");
    const i = await ctx.db.get(incidents, incidentId);
    if (!i) fail("NOT_FOUND", `No incident ${incidentId}.`);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a)) if (v !== undefined) patch[k] = v;
    await ctx.db.patch(incidents, incidentId, patch);
    await record(ctx, `incident:${incidentId}`, who, "incident.updated", Object.entries(patch).map(([k, v]) => `${k} → ${v}`).join(", "));
    return incidentId;
  },
});

/** Resolve only when the process's own check passes now. */
export const resolve = app.mutation({
  access: "incidents.write",
  args: { incidentId: s.string() },
  handler: async (ctx, { incidentId }) => {
    const who = await requirePerson(ctx, "resolve an incident");
    const i = await ctx.db.get(incidents, incidentId);
    if (!i) fail("NOT_FOUND", `No incident ${incidentId}.`);
    if (["resolved", "reviewed"].includes(i.status)) fail("FAILED_PRECONDITION", `${i.number} is already ${i.status}.`);
    const c = await check(ctx, i.process);
    if (c.healthy === false) fail("FAILED_PRECONDITION", `${i.number} cannot be resolved: ${c.summary}.`);
    const verification = { ok: true, by: who.recordId, at: nowIso(), method: c.healthy === null ? "manual" : `check:${i.process}`, summary: c.summary };
    await ctx.db.patch(incidents, incidentId, { status: "resolved", verification });
    await record(ctx, `incident:${incidentId}`, who, "incident.resolved", `Resolved. ${c.summary}.`, { source: "verification", data: verification });
    ctx.afterCommit.webhooks.emit("incident.resolved", { incidentId, number: i.number });
    return verification;
  },
});

export const review = app.mutation({
  access: "incidents.write",
  args: { incidentId: s.string(), review: s.string({ minLength: 20 }) },
  handler: async (ctx, { incidentId, review }) => {
    const who = await requirePerson(ctx, "record a post-incident review");
    const i = await ctx.db.get(incidents, incidentId);
    if (!i) fail("NOT_FOUND", `No incident ${incidentId}.`);
    if (i.status !== "resolved") fail("FAILED_PRECONDITION", "Review a resolved incident.");
    await ctx.db.patch(incidents, incidentId, { status: "reviewed", review });
    await record(ctx, `incident:${incidentId}`, who, "incident.reviewed", review);
    return incidentId;
  },
});
