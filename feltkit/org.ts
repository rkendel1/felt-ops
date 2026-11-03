import { fail, s } from "@feltdb/feltkit";
import { agents, app, authorities, departments, people, purchaseRequests, teams, timeline, workItems } from "./app.js";
import { actor, nowIso, record, requirePerson } from "./_lib.js";
import { withinAssignment } from "./_scope.js";

const Person = s.doc(people);
const Grant = s.doc(authorities);

export const overview = app.query({
  access: "org.read",
  handler: async (ctx) => {
    await actor(ctx);
    const [depts, allTeams, everyone] = await Promise.all([ctx.db.find(departments, {}), ctx.db.find(teams, {}), ctx.db.find(people, {})]);
    return depts.map((d) => ({
      ...d,
      head: everyone.find((p) => p.id === d.headId)?.name ?? null,
      active: everyone.filter((p) => p.departmentId === d.id && p.status === "active").length,
      departed: everyone.filter((p) => p.departmentId === d.id && p.status === "departed").length,
      teams: allTeams.filter((t) => t.departmentId === d.id).map((t) => ({ ...t, members: everyone.filter((p) => p.teamId === t.id && p.status === "active").length })),
    }));
  },
});

export const listPeople = app.query({
  access: "org.read",
  args: { departmentId: s.optional(s.string()), status: s.optional(s.enum(["active", "on-leave", "departed"])), search: s.optional(s.string()) },
  returns: s.array(Person),
  capability: { name: "org.people", description: "List employees, optionally by department, status or a name search." },
  handler: async (ctx, { departmentId, status, search }) => {
    await actor(ctx);
    const filter: Record<string, unknown> = {};
    if (departmentId) filter.departmentId = departmentId;
    if (status) filter.status = status;
    const found = await ctx.db.find(people, filter, { orderBy: [{ field: "name", direction: "asc" }] });
    const q = search?.toLowerCase();
    return q ? found.filter((p) => p.name.toLowerCase().includes(q) || p.title.toLowerCase().includes(q)) : found;
  },
});

/** Everything a person is responsible for: grants, pending approvals, work, agents they own. */
export const responsibilities = app.query({
  access: "org.read",
  args: { personId: s.string() },
  returns: s.object({
    person: Person,
    grants: s.array(Grant),
    pendingApprovals: s.array(s.object({ requestId: s.string(), number: s.string(), step: s.string(), amount: s.number() })),
    openWork: s.array(s.object({ id: s.string(), title: s.string(), status: s.string() })),
    agentsOwned: s.array(s.object({ key: s.string(), name: s.string() })),
    history: s.array(s.object({ at: s.string(), kind: s.string(), summary: s.string(), actorId: s.string() })),
  }),
  capability: { name: "org.responsibilities", description: "A person's authority grants, pending approvals, open work and owned agents." },
  handler: async (ctx, { personId }) => {
    await actor(ctx);
    const person = await ctx.db.get(people, personId);
    if (!person) fail("NOT_FOUND", `No person ${personId}.`);
    const grants = await ctx.db.find(authorities, { holderId: personId });
    const pending = (await ctx.db.find(purchaseRequests, { status: "pending" })).flatMap((r) =>
      r.steps.filter((st) => !st.decision && st.assigneeId === personId).map((st) => ({ requestId: r.id, number: r.number, step: st.label, amount: r.amount })));
    const work = (await ctx.db.find(workItems, { assigneeId: personId })).filter((w) => w.status !== "done").map((w) => ({ id: w.id, title: w.title, status: w.status }));
    const owned = (await ctx.db.find(agents, { ownerId: personId })).map((a) => ({ key: a.key, name: a.name }));
    const history = (await ctx.db.find(timeline, { subject: `person:${personId}` }, { orderBy: [{ field: "seq", direction: "asc" }] })).map((h) => ({ at: h.at, kind: h.kind, summary: h.summary, actorId: h.actorId }));
    return { person, grants, pendingApprovals: pending, openWork: work, agentsOwned: owned, history };
  },
});

export const me = app.query({
  access: "authenticated",
  handler: async (ctx) => {
    const p = ctx.auth.requirePrincipal();
    if (p.type === "agent") {
      const [a] = await ctx.db.find(agents, { key: p.id });
      return { principal: p, person: null, agent: a ?? null, permissions: ctx.auth.permissions, grants: [] as NonNullable<typeof authorities.$doc>[] };
    }
    const [person] = await ctx.db.find(people, { login: p.id });
    const grants = person ? await ctx.db.find(authorities, { holderId: person.id, status: "active" }) : [];
    return { principal: p, person: person ?? null, agent: null, permissions: ctx.auth.permissions, grants };
  },
});

export const grant = app.mutation({
  access: "org.manage",
  args: { holderId: s.string(), kind: s.string({ minLength: 3 }), limit: s.optional(s.number({ minimum: 0 })), departmentId: s.optional(s.string()), reason: s.string({ minLength: 3 }) },
  handler: async (ctx, args) => {
    const who = await requirePerson(ctx, "grant business authority");
    const holder = await ctx.db.get(people, args.holderId);
    if (!holder || holder.status !== "active") fail("FAILED_PRECONDITION", "Authority can be granted only to an active employee.");
    const id = await ctx.db.insert(authorities, {
      holderId: args.holderId, holderType: "person", kind: args.kind, status: "active", grantedBy: who.id, grantedAt: nowIso(),
      ...(args.limit !== undefined ? { limit: args.limit } : {}), ...(args.departmentId ? { departmentId: args.departmentId } : {}),
    });
    await record(ctx, `person:${args.holderId}`, who, "authority.granted", `Granted ${args.kind}${args.limit !== undefined ? ` up to ${args.limit}` : ""}: ${args.reason}`, { data: { grantId: id } });
    return id;
  },
});

export const endGrant = app.mutation({
  access: "org.manage",
  args: { grantId: s.string(), reason: s.string({ minLength: 3 }) },
  handler: async (ctx, { grantId, reason }) => {
    const who = await requirePerson(ctx, "end business authority");
    const g = await ctx.db.get(authorities, grantId);
    if (!g) fail("NOT_FOUND", `No grant ${grantId}.`);
    if (g.status !== "active") fail("FAILED_PRECONDITION", "That grant has already ended.");
    await ctx.db.patch(authorities, grantId, { status: "ended", endedAt: nowIso(), endedBy: who.id, endReason: reason });
    await record(ctx, `person:${g.holderId}`, who, "authority.ended", `Ended ${g.kind}: ${reason}`, { data: { grantId } });
    return grantId;
  },
});

/**
 * An employee leaves. In one transaction: their status, every active grant ended (and,
 * when a successor is named, re-granted to the successor with provenance), their pending
 * approval steps, open work and owned agents moved to the successor. Nothing is deleted.
 *
 * Agents may only propose it (approval: "required"); a person with org.access approves.
 * Their FeltKit sessions are revoked by an operator (`feltkit session revoke`), which the
 * application cannot do (G-02); until then CompanyOS refuses the departed principal.
 */
export const depart = app.mutation({
  access: "org.access",
  approval: "required",
  args: { personId: s.string(), successorId: s.string(), leftOn: s.string(), reason: s.string({ minLength: 3 }) },
  returns: s.object({ grantsTransferred: s.number(), approvalsMoved: s.number(), workMoved: s.number(), agentsMoved: s.number(), platformSteps: s.array(s.string()) }),
  capability: { name: "org.depart", description: "Record an employee's departure and transfer their responsibilities to a successor. Needs a person's approval when proposed by an agent." },
  handler: async (ctx, { personId, successorId, leftOn, reason }) => {
    const who = await actor(ctx);
    await withinAssignment(ctx, who, "org.depart");
    const person = await ctx.db.get(people, personId);
    const successor = await ctx.db.get(people, successorId);
    if (!person) fail("NOT_FOUND", `No person ${personId}.`);
    if (person.status === "departed") fail("FAILED_PRECONDITION", `${person.name} has already left (on ${person.leftOn}).`);
    if (!successor || successor.status !== "active") fail("FAILED_PRECONDITION", "The successor must be an active employee.");
    if (successorId === personId) fail("INVALID_ARGUMENT", "A person cannot succeed themselves.");
    const at = nowIso();

    let grantsTransferred = 0;
    for (const g of await ctx.db.find(authorities, { holderId: personId, status: "active" })) {
      await ctx.db.patch(authorities, g.id, { status: "ended", endedAt: at, endedBy: who.id, endReason: `departure: ${reason}` });
      const { id: _id, __version: _v, ...rest } = g as typeof g & { __version: number };
      await ctx.db.insert(authorities, { ...rest, holderId: successorId, status: "active", grantedBy: who.id, grantedAt: at, transferredFrom: g.id });
      grantsTransferred += 1;
    }
    let approvalsMoved = 0;
    for (const r of await ctx.db.find(purchaseRequests, { status: "pending" })) {
      if (!r.steps.some((st) => !st.decision && st.assigneeId === personId)) continue;
      const steps = r.steps.map((st) => (!st.decision && st.assigneeId === personId ? { ...st, assigneeId: successorId } : st));
      approvalsMoved += r.steps.filter((st) => !st.decision && st.assigneeId === personId).length;
      await ctx.db.patch(purchaseRequests, r.id, { steps });
      await record(ctx, `purchase:${r.id}`, who, "approver.reassigned", `Pending approval moved from ${person.name} to ${successor.name} (departure).`);
    }
    let workMoved = 0;
    for (const w of await ctx.db.find(workItems, { assigneeId: personId })) {
      if (w.status === "done") continue;
      await ctx.db.patch(workItems, w.id, { assigneeId: successorId });
      workMoved += 1;
    }
    let agentsMoved = 0;
    for (const a of await ctx.db.find(agents, { ownerId: personId })) {
      await ctx.db.patch(agents, a.id, { ownerId: successorId });
      await record(ctx, `agent:${a.key}`, who, "owner.changed", `Owner changed from ${person.name} to ${successor.name} (departure).`);
      agentsMoved += 1;
    }
    for (const d of await ctx.db.find(departments, { headId: personId })) await ctx.db.patch(departments, d.id, { headId: successorId });
    for (const t of await ctx.db.find(teams, { leadId: personId })) await ctx.db.patch(teams, t.id, { leadId: successorId });
    for (const p of await ctx.db.find(people, { managerId: personId })) await ctx.db.patch(people, p.id, { managerId: successorId });

    await ctx.db.patch(people, personId, { status: "departed", leftOn });
    const summary = { grantsTransferred, approvalsMoved, workMoved, agentsMoved };
    await record(ctx, `person:${personId}`, who, "person.departed", `Left on ${leftOn} (${reason}). Responsibilities moved to ${successor.name}.`, { data: summary });
    await record(ctx, `person:${successorId}`, who, "responsibilities.received", `Received ${person.name}'s responsibilities.`, { data: summary });
    const platformSteps = person.login
      ? [`Revoke ${person.login}'s sessions: npx feltkit session list, then npx feltkit session revoke <ref> for each (CompanyOS already refuses them).`]
      : [];
    return { ...summary, platformSteps };
  },
});

export const history = app.query({
  access: "org.read",
  args: { subject: s.string() },
  handler: async (ctx, { subject }) => {
    await actor(ctx);
    return ctx.db.find(timeline, { subject }, { orderBy: [{ field: "seq", direction: "asc" }] });
  },
});

/** Recent history across every subject (the evidence explorer). */
export const recentHistory = app.query({
  access: "org.read",
  args: { actorId: s.optional(s.string()), source: s.optional(s.string()), limit: s.optional(s.number()) },
  handler: async (ctx, { actorId, source, limit }) => {
    await actor(ctx);
    const filter: Record<string, unknown> = {};
    if (actorId) filter.actorId = actorId;
    if (source) filter.source = source;
    const rows = await ctx.db.find(timeline, filter);
    return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit ?? 200);
  },
});
