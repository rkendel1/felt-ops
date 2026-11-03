/**
 * Agent operations: the registry, work assigned to agents, what they report, what operators
 * do about it, and what was independently verified.
 *
 * Division of labour with FeltKit (never duplicated here):
 *   FeltKit  — the agent's session and roles, every capability decision, proposals,
 *              approval by a person, execution as the owner, action states, checkpoints
 *              with FeltDB-verified evidence (feltkitTaskId links to it).
 *   CompanyOS — the business assignment: objective, context, constraints, deadline, the
 *              operator's narrowing of authority, the agent's claims (as assertions),
 *              operator interventions, and verification computed from business records.
 */
import { fail, s } from "@feltdb/feltkit";
import type { MutationCtx, QueryCtx } from "@feltdb/feltkit";
import { agents, app, assignments, people, projects, timeline, workItems } from "./app.js";
import { actor, nextNumber, nowIso, record, requirePerson, type Actor } from "./_lib.js";
import { reconcileState } from "./purchasing.js";
import { ACTIVE, CAPABILITY_PERMISSION, grants, permissionsOf, withinAssignment } from "./_scope.js";
export { withinAssignment };
import { supplierLinks, authorities, purchaseRequests } from "./app.js";

const Assignment = s.doc(assignments);

// ───────────── Registry ─────────────

export const list = app.query({
  access: "agents.read",
  handler: async (ctx) => {
    await actor(ctx);
    const [all, work, everyone] = await Promise.all([ctx.db.find(agents, {}), ctx.db.find(assignments, {}), ctx.db.find(people, {})]);
    return all.map((a) => {
      const mine = work.filter((w) => w.agentKey === a.key);
      return {
        ...a,
        owner: everyone.find((p) => p.id === a.ownerId)?.name ?? a.ownerId,
        permissions: permissionsOf(a.roles),
        active: mine.filter((w) => ACTIVE.includes(w.status)).length,
        attention: mine.filter((w) => ["waiting-approval", "waiting-intervention", "failed"].includes(w.status)).length,
        verified: mine.filter((w) => w.status === "verified").length,
      };
    });
  },
});

export const register = app.mutation({
  access: "agents.manage",
  args: { key: s.string({ minLength: 3 }), name: s.string(), purpose: s.string({ minLength: 10 }), runtime: s.string(), provider: s.string(), model: s.string(), roles: s.array(s.string()), ownerId: s.string() },
  handler: async (ctx, a) => {
    const who = await requirePerson(ctx, "register an agent");
    const declared = app.options.roles ?? {};
    for (const r of a.roles) {
      if (!declared[r]) fail("INVALID_ARGUMENT", `Role ${r} is not declared.`);
      if (!r.startsWith("agent-")) fail("INVALID_ARGUMENT", `Agents hold agent roles only; ${r} is a role for people.`);
    }
    const owner = await ctx.db.get(people, a.ownerId);
    if (!owner || owner.status !== "active") fail("FAILED_PRECONDITION", "An agent's owner must be an active employee.");
    const id = await ctx.db.insert(agents, { ...a, status: "active", mayDelegate: false });
    await record(ctx, `agent:${a.key}`, who, "agent.registered", `${a.name} registered by ${who.name} with ${a.roles.join(", ")}. Issue its session: npx feltkit session create --type agent --id ${a.key} --role ${a.roles.join(" --role ")}`);
    return id;
  },
});

export const detail = app.query({
  access: "agents.read",
  args: { key: s.string() },
  handler: async (ctx, { key }) => {
    await actor(ctx);
    const [a] = await ctx.db.find(agents, { key });
    if (!a) fail("NOT_FOUND", `No agent ${key}.`);
    const perms = permissionsOf(a.roles);
    const work = (await ctx.db.find(assignments, { agentKey: key })).sort((x, y) => (x.assignedAt < y.assignedAt ? 1 : -1));
    const history = await ctx.db.find(timeline, { subject: `agent:${key}` }, { orderBy: [{ field: "seq", direction: "asc" }] });
    const why = Object.entries(CAPABILITY_PERMISSION).map(([capability, permission]) => {
      const viaRole = a.roles.find((r) => grants(app.options.roles?.[r] ?? [], permission));
      return { capability, permission, allowed: !!viaRole, viaRole: viaRole ?? null };
    });
    const owner = await ctx.db.get(people, a.ownerId);
    return { agent: a, owner: owner?.name ?? a.ownerId, permissions: perms, capabilities: why, assignments: work, history };
  },
});

export const setStatus = app.mutation({
  access: "agents.manage",
  args: { key: s.string(), status: s.enum(["active", "suspended", "retired"]), reason: s.string({ minLength: 3 }) },
  handler: async (ctx, { key, status, reason }) => {
    const who = await requirePerson(ctx, "change an agent's status");
    const [a] = await ctx.db.find(agents, { key });
    if (!a) fail("NOT_FOUND", `No agent ${key}.`);
    if (a.status === "retired") fail("FAILED_PRECONDITION", "A retired agent stays retired; register a new one.");
    await ctx.db.patch(agents, a.id, { status, statusReason: reason });
    let affected = 0;
    if (status !== "active") {
      for (const w of await ctx.db.find(assignments, { agentKey: key })) {
        if (!ACTIVE.includes(w.status)) continue;
        await ctx.db.patch(assignments, w.id, { status: "suspended" });
        await record(ctx, `assignment:${w.id}`, who, "assignment.suspended", `Agent ${status}: ${reason}`, { source: "operator" });
        affected += 1;
      }
    }
    await record(ctx, `agent:${key}`, who, `agent.${status}`, `${status} by ${who.name}: ${reason}.${status !== "active" ? ` ${affected} assignment(s) suspended. CompanyOS refuses it from now on; revoke its sessions to stop it at FeltKit too (npx feltkit session revoke).` : ""}`, { source: "operator" });
    return { affected };
  },
});

// ───────────── Assignments (operator side) ─────────────

export const assign = app.mutation({
  access: "assignments.write",
  args: {
    agentKey: s.string(), title: s.string({ minLength: 5 }), objective: s.string({ minLength: 10 }), context: s.string(),
    constraints: s.array(s.string()), expectedOutput: s.string({ minLength: 5 }), deadline: s.optional(s.string()),
    permittedCapabilities: s.array(s.string()), approvalRequired: s.boolean(),
    verifier: s.enum(["reconciliation-clean", "supplier-link-healthy", "departure-complete", "manual"]),
    subject: s.optional(s.object({ collection: s.string(), id: s.string() })),
  },
  handler: async (ctx, a) => {
    const who = await requirePerson(ctx, "assign work to an agent");
    const [agent] = await ctx.db.find(agents, { key: a.agentKey });
    if (!agent) fail("NOT_FOUND", `No agent ${a.agentKey}.`);
    if (agent.status !== "active") fail("FAILED_PRECONDITION", `${agent.name} is ${agent.status}.`);
    const perms = permissionsOf(agent.roles);
    for (const c of a.permittedCapabilities) {
      const needs = CAPABILITY_PERMISSION[c];
      if (!needs) fail("INVALID_ARGUMENT", `Unknown capability ${c}.`);
      if (!grants(perms, needs)) fail("FAILED_PRECONDITION", `${agent.name}'s roles (${agent.roles.join(", ")}) do not grant ${needs}, which ${c} needs. An assignment narrows authority; it cannot add to it.`);
    }
    const number = await nextNumber(ctx, "AS");
    const id = await ctx.db.insert(assignments, { ...a, number, status: "assigned", assignedBy: who.recordId, assignedAt: nowIso() });
    await record(ctx, `assignment:${id}`, who, "assignment.created", `${number} for ${agent.name}: ${a.title}. Permitted: ${a.permittedCapabilities.join(", ") || "(observe only)"}. Verified by: ${a.verifier}.`, { source: "operator" });
    await record(ctx, `agent:${agent.key}`, who, "assignment.received", `${number}: ${a.title}`, { source: "operator" });
    return id;
  },
});

export const listAssignments = app.query({
  access: "agents.read",
  args: { status: s.optional(s.string()), agentKey: s.optional(s.string()) },
  handler: async (ctx, { status, agentKey }) => {
    await actor(ctx);
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (agentKey) filter.agentKey = agentKey;
    return (await ctx.db.find(assignments, filter)).sort((a, b) => (a.assignedAt < b.assignedAt ? 1 : -1));
  },
});

export const assignmentDetail = app.query({
  access: "agents.read",
  args: { assignmentId: s.string() },
  handler: async (ctx, { assignmentId }) => {
    await actor(ctx);
    const a = await ctx.db.get(assignments, assignmentId);
    if (!a) fail("NOT_FOUND", `No assignment ${assignmentId}.`);
    const history = await ctx.db.find(timeline, { subject: `assignment:${assignmentId}` }, { orderBy: [{ field: "seq", direction: "asc" }] });
    const [agent] = await ctx.db.find(agents, { key: a.agentKey });
    const chain = [];
    let prev = a.reassignedFrom;
    while (prev) { const p = await ctx.db.get(assignments, prev); if (!p) break; chain.push({ id: p.id, number: p.number, agentKey: p.agentKey, status: p.status }); prev = p.reassignedFrom; }
    // What the agent changed elsewhere while this assignment was its work (other subjects:
    // incidents, links, invoices…). Direct MCP calls are not attached to its FeltKit task.
    const until = a.verification?.at ?? "9999";
    const elsewhere = (await ctx.db.find(timeline, { actorId: a.agentKey }))
      .filter((h) => h.subject !== `assignment:${assignmentId}` && h.at >= a.assignedAt && h.at <= until)
      .sort((x, y) => (x.at < y.at ? -1 : 1));
    // The agent's latest write anywhere in CompanyOS: the only liveness signal available
    // (FeltKit has no agent heartbeat; its reads are only in the activity log).
    const lastHeard = (await ctx.db.find(timeline, { actorId: a.agentKey })).sort((x, y) => (x.at < y.at ? 1 : -1))[0] ?? null;
    return { assignment: a, agent: agent ?? null, history, elsewhere, lastHeard: lastHeard ? { at: lastHeard.at, kind: lastHeard.kind, summary: lastHeard.summary } : null, check: await verifierCheck(ctx, a), reassignedChain: chain };
  },
});

/** What needs a person now. */
export const attention = app.query({
  access: "agents.read",
  handler: async (ctx) => {
    await actor(ctx);
    const now = nowIso();
    const all = await ctx.db.find(assignments, {});
    return all.filter((a) => ["waiting-approval", "waiting-intervention", "failed", "completed"].includes(a.status) || (ACTIVE.includes(a.status) && a.deadline && a.deadline < now))
      .map((a) => ({ assignment: a, reason: a.status === "completed" ? "Agent claims completion: verify it" : a.status === "waiting-approval" ? "An agent action awaits approval in FeltKit Studio" : a.status === "failed" ? "Failed: inspect, then resume or reassign" : a.status === "waiting-intervention" ? "Needs an operator" : "Past its deadline" }));
  },
});

async function operatorAct(ctx: MutationCtx, assignmentId: string) {
  const who = await requirePerson(ctx, "intervene in an assignment");
  const a = await ctx.db.get(assignments, assignmentId);
  if (!a) fail("NOT_FOUND", `No assignment ${assignmentId}.`);
  return { who, a };
}

export const intervene = app.mutation({
  access: "assignments.write",
  args: { assignmentId: s.string(), action: s.enum(["suspend", "resume", "cancel", "context", "escalate"]), note: s.string({ minLength: 3 }), escalateTo: s.optional(s.string()) },
  handler: async (ctx, { assignmentId, action, note, escalateTo }) => {
    const { who, a } = await operatorAct(ctx, assignmentId);
    const terminal = ["verified", "cancelled", "reassigned"];
    if (terminal.includes(a.status)) fail("FAILED_PRECONDITION", `${a.number} is ${a.status}; nothing to intervene in.`);
    let status = a.status;
    switch (action) {
      case "suspend": status = "suspended"; break;
      case "resume": {
        if (!["suspended", "failed", "waiting-intervention"].includes(a.status)) fail("FAILED_PRECONDITION", `${a.number} is ${a.status}; only a suspended, failed or waiting assignment resumes.`);
        const [agent] = await ctx.db.find(agents, { key: a.agentKey });
        if (agent?.status !== "active") fail("FAILED_PRECONDITION", `${agent?.name ?? a.agentKey} is ${agent?.status}; reassign the work instead.`);
        status = "recovering"; break;
      }
      case "cancel": status = "cancelled"; break;
      case "context": await ctx.db.patch(assignments, assignmentId, { context: `${a.context}\n\n[${nowIso()} ${who.name}] ${note}` }); break;
      case "escalate": {
        if (!escalateTo) fail("INVALID_ARGUMENT", "Name the person to escalate to.");
        const p = await ctx.db.get(people, escalateTo);
        if (!p || p.status !== "active") fail("FAILED_PRECONDITION", "Escalate to an active employee.");
        status = "waiting-intervention";
        await ctx.db.patch(assignments, assignmentId, { escalatedTo: escalateTo });
        if (p.login) ctx.afterCommit.notifications.send({ recipient: p.login, type: "assignment.attention", title: `${a.number} escalated to you`, body: note, data: { assignmentId } });
        break;
      }
    }
    if (status !== a.status) await ctx.db.patch(assignments, assignmentId, { status });
    await record(ctx, `assignment:${assignmentId}`, who, `operator.${action}`, `${who.name}: ${action}${status !== a.status ? ` (${a.status} → ${status})` : ""}. ${note}`, { source: "operator" });
    return status;
  },
});

/** Hand the work to another agent (a new assignment, same objective) or to a person (a work item). */
export const reassign = app.mutation({
  access: "assignments.write",
  args: { assignmentId: s.string(), toAgentKey: s.optional(s.string()), toPersonId: s.optional(s.string()), note: s.string({ minLength: 3 }) },
  handler: async (ctx, { assignmentId, toAgentKey, toPersonId, note }) => {
    const { who, a } = await operatorAct(ctx, assignmentId);
    if (!!toAgentKey === !!toPersonId) fail("INVALID_ARGUMENT", "Reassign to exactly one agent or one person.");
    if (["verified", "cancelled", "reassigned"].includes(a.status)) fail("FAILED_PRECONDITION", `${a.number} is ${a.status}.`);
    let target: string;
    let newId: string | null = null;
    if (toAgentKey) {
      const [agent] = await ctx.db.find(agents, { key: toAgentKey });
      if (!agent || agent.status !== "active") fail("FAILED_PRECONDITION", `${toAgentKey} is not an active agent.`);
      const perms = permissionsOf(agent.roles);
      const missing = a.permittedCapabilities.filter((c) => !grants(perms, CAPABILITY_PERMISSION[c] ?? c));
      if (missing.length) fail("FAILED_PRECONDITION", `${agent.name} cannot take this work: its roles do not cover ${missing.join(", ")}.`);
      const number = await nextNumber(ctx, "AS");
      const { id: _i, __version: _v, number: _n, feltkitTaskId: _t, claim: _c, verification: _ve, usage: _u, escalatedTo: _e, ...rest } = a as typeof a & { __version: number };
      newId = await ctx.db.insert(assignments, { ...rest, number, agentKey: toAgentKey, status: "assigned", assignedBy: who.recordId, assignedAt: nowIso(), reassignedFrom: a.id, context: `${a.context}\n\n[Reassigned from ${a.number} (${a.agentKey}, ${a.status})] ${note}` });
      target = `${agent.name} as ${number}`;
      await record(ctx, `assignment:${newId}`, who, "assignment.created", `${number}: reassigned from ${a.number}. ${note}`, { source: "operator" });
    } else {
      const p = await ctx.db.get(people, toPersonId!);
      if (!p || p.status !== "active") fail("FAILED_PRECONDITION", "Reassign to an active employee.");
      let [proj] = await ctx.db.find(projects, { name: "Agent takeovers" });
      const projectId = proj?.id ?? await ctx.db.insert(projects, { name: "Agent takeovers", kind: "business", ownerId: who.recordId, status: "active" });
      newId = await ctx.db.insert(workItems, { projectId, title: `${a.number} (taken over from ${a.agentKey}): ${a.title}`, status: "todo", assigneeId: p.id, dependsOn: [], evidence: `Objective: ${a.objective}\nExpected: ${a.expectedOutput}\nNote: ${note}` });
      target = `${p.name} (work item)`;
      if (p.login) ctx.afterCommit.notifications.send({ recipient: p.login, type: "assignment.attention", title: `You took over ${a.number}`, body: a.title, data: { workItemId: newId } });
    }
    await ctx.db.patch(assignments, assignmentId, { status: "reassigned", reassignedTo: newId! });
    await record(ctx, `assignment:${assignmentId}`, who, "operator.reassign", `${a.status} → reassigned to ${target}. ${note}`, { source: "operator" });
    return newId;
  },
});

// ───────────── Assignments (agent side) ─────────────

export const mine = app.query({
  access: "assignments.work",
  returns: s.array(Assignment),
  capability: { name: "assignments.mine", description: "The calling agent's assignments that are not finished." },
  handler: async (ctx) => {
    const who = await actor(ctx);
    return (await ctx.db.find(assignments, { agentKey: who.id })).filter((a) => ACTIVE.includes(a.status) || a.status === "suspended");
  },
});

async function ownAssignment(ctx: MutationCtx, assignmentId: string) {
  const who = await actor(ctx);
  const a = await ctx.db.get(assignments, assignmentId);
  if (!a) fail("NOT_FOUND", `No assignment ${assignmentId}.`);
  if (a.agentKey !== who.id) fail("FORBIDDEN", `${a.number} is assigned to ${a.agentKey}, not ${who.id}.`);
  if (a.status === "suspended") fail("FAILED_PRECONDITION", `${a.number} is suspended by an operator.`);
  if (["cancelled", "reassigned", "verified"].includes(a.status)) fail("FAILED_PRECONDITION", `${a.number} is ${a.status}.`);
  return { who, a };
}

export const accept = app.mutation({
  access: "assignments.work",
  args: { assignmentId: s.string(), feltkitTaskId: s.string() },
  returns: Assignment,
  capability: { name: "assignments.accept", description: "Accept an assignment and link the FeltKit agent task that carries its actions." },
  handler: async (ctx, { assignmentId, feltkitTaskId }) => {
    const { who, a } = await ownAssignment(ctx, assignmentId);
    if (a.feltkitTaskId && a.feltkitTaskId !== feltkitTaskId) {
      await record(ctx, `assignment:${assignmentId}`, who, "task.relinked", `Agent linked a new FeltKit task ${feltkitTaskId} (was ${a.feltkitTaskId}). The previous task's actions remain in FeltKit.`, { source: "assertion" });
    }
    await ctx.db.patch(assignments, assignmentId, { status: a.status === "recovering" ? "running" : "accepted", feltkitTaskId });
    await record(ctx, `assignment:${assignmentId}`, who, "assignment.accepted", `${who.name} accepted (FeltKit task ${feltkitTaskId}).`);
    return (await ctx.db.get(assignments, assignmentId))!;
  },
});

/** The agent's own statements. Recorded as assertions; status follows what it says. */
export const report = app.mutation({
  access: "assignments.work",
  args: {
    assignmentId: s.string(), kind: s.enum(["progress", "waiting-approval", "claim", "failure"]), text: s.string({ minLength: 3 }),
    data: s.optional(s.record(s.unknown())),
    usage: s.optional(s.object({ inputTokens: s.number(), outputTokens: s.number(), costUsd: s.number() })),
  },
  returns: s.string(),
  capability: { name: "assignments.report", description: "Report progress, a pending approval, a completion claim or a failure. Recorded as the agent's assertion, not as evidence." },
  handler: async (ctx, { assignmentId, kind, text, data, usage }) => {
    const { who, a } = await ownAssignment(ctx, assignmentId);
    const status = kind === "progress" ? "running" : kind === "waiting-approval" ? "waiting-approval" : kind === "claim" ? "completed" : "failed";
    const patch: Record<string, unknown> = { status };
    if (kind === "claim") patch.claim = text;
    if (usage) {
      const u = a.usage ?? { inputTokens: 0, outputTokens: 0, costUsd: 0, source: "agent-reported" };
      patch.usage = { inputTokens: u.inputTokens + usage.inputTokens, outputTokens: u.outputTokens + usage.outputTokens, costUsd: u.costUsd + usage.costUsd, source: "agent-reported" };
    }
    await ctx.db.patch(assignments, assignmentId, patch);
    await record(ctx, `assignment:${assignmentId}`, who, `agent.${kind}`, text, { source: "assertion", ...(data ? { data } : {}) });
    return status;
  },
});

// ───────────── Verification ─────────────

async function verifierCheck(ctx: QueryCtx | MutationCtx, a: { verifier: string; subject?: { collection: string; id: string } }) {
  switch (a.verifier) {
    case "reconciliation-clean": {
      const r = await reconcileState(ctx);
      return { ok: r.duplicates.length === 0 && r.overCommitted.length === 0, method: "finance.reconciliation computed by CompanyOS", detail: { duplicates: r.duplicates.length, overCommitted: r.overCommitted.length, openCommitments: r.openCommitments, openTotal: r.openTotal } };
    }
    case "supplier-link-healthy": {
      const linksNow = a.subject?.collection === "suppliers" ? await ctx.db.find(supplierLinks, { supplierId: a.subject.id }) : await ctx.db.find(supplierLinks, {});
      return { ok: linksNow.length > 0 && linksNow.every((l) => l.status === "healthy"), method: "supplier link state", detail: { links: linksNow.map((l) => ({ supplierId: l.supplierId, status: l.status, apiVersion: l.apiVersion, syncedThrough: l.syncedThrough })) } };
    }
    case "departure-complete": {
      if (a.subject?.collection !== "people") return { ok: false, method: "departure", detail: { error: "assignment has no person subject" } };
      const p = await ctx.db.get(people, a.subject.id);
      const live = await ctx.db.find(authorities, { holderId: a.subject.id, status: "active" });
      const pending = (await ctx.db.find(purchaseRequests, { status: "pending" })).filter((r) => r.steps.some((st) => !st.decision && st.assigneeId === a.subject!.id));
      const work = (await ctx.db.find(workItems, { assigneeId: a.subject.id })).filter((w) => w.status !== "done");
      const owned = await ctx.db.find(agents, { ownerId: a.subject.id });
      return { ok: p?.status === "departed" && !live.length && !pending.length && !work.length && !owned.length, method: "departure records", detail: { status: p?.status ?? "missing", activeGrants: live.length, pendingApprovals: pending.length, openWork: work.length, agentsOwned: owned.length } };
    }
    default:
      return { ok: null, method: "manual", detail: {} };
  }
}

export const verify = app.mutation({
  access: "assignments.verify",
  args: { assignmentId: s.string(), attestation: s.optional(s.string()) },
  handler: async (ctx, { assignmentId, attestation }) => {
    const who = await requirePerson(ctx, "verify an assignment");
    const a = await ctx.db.get(assignments, assignmentId);
    if (!a) fail("NOT_FOUND", `No assignment ${assignmentId}.`);
    if (["cancelled", "reassigned", "verified"].includes(a.status)) fail("FAILED_PRECONDITION", `${a.number} is ${a.status}.`);
    const c = await verifierCheck(ctx, a);
    if (c.ok === null && !attestation) fail("INVALID_ARGUMENT", "This assignment is verified by a person: give an attestation describing what you checked.");
    const ok = c.ok ?? true;
    const verification = { ok, by: who.recordId, at: nowIso(), method: c.ok === null ? `manual: ${attestation}` : c.method, detail: c.detail as Record<string, unknown> };
    await ctx.db.patch(assignments, assignmentId, { verification, status: ok ? "verified" : "waiting-intervention" });
    await record(ctx, `assignment:${assignmentId}`, who, ok ? "assignment.verified" : "assignment.verification-failed", ok ? `Verified by ${who.name} (${verification.method}).` : `Verification failed: ${JSON.stringify(c.detail)}`, { source: "verification", data: verification });
    return verification;
  },
});

// ───────────── Effectiveness ─────────────

export const metrics = app.query({
  access: "agents.read",
  handler: async (ctx) => {
    await actor(ctx);
    const [all, work, events] = await Promise.all([ctx.db.find(agents, {}), ctx.db.find(assignments, {}), ctx.db.find(timeline, {})]);
    return all.map((ag) => {
      const mineW = work.filter((w) => w.agentKey === ag.key);
      const ids = new Set(mineW.map((w) => `assignment:${w.id}`));
      const ev = events.filter((e) => ids.has(e.subject));
      const verified = mineW.filter((w) => w.verification?.ok);
      const durations = verified.map((w) => Date.parse(w.verification!.at) - Date.parse(w.assignedAt));
      const usage = mineW.reduce((u, w) => ({ inputTokens: u.inputTokens + (w.usage?.inputTokens ?? 0), outputTokens: u.outputTokens + (w.usage?.outputTokens ?? 0), costUsd: u.costUsd + (w.usage?.costUsd ?? 0) }), { inputTokens: 0, outputTokens: 0, costUsd: 0 });
      return {
        key: ag.key, name: ag.name, status: ag.status, provider: ag.provider, model: ag.model,
        attempted: mineW.length,
        claimedComplete: mineW.filter((w) => w.claim).length,
        verified: verified.length,
        verificationFailed: ev.filter((e) => e.kind === "assignment.verification-failed").length,
        failed: ev.filter((e) => e.kind === "agent.failure").length,
        approvalWaits: ev.filter((e) => e.kind === "agent.waiting-approval").length,
        interventions: ev.filter((e) => e.source === "operator" && e.kind.startsWith("operator.")).length,
        recoveries: ev.filter((e) => e.kind === "operator.resume").length + work.filter((w) => w.reassignedFrom && mineW.some((m) => m.id === w.reassignedFrom)).length,
        medianMinutesToVerified: durations.length ? Math.round(durations.sort((x, y) => x - y)[Math.floor(durations.length / 2)]! / 60000) : null,
        usage: { ...usage, source: "agent-reported (not metered by FeltKit)" },
        refusals: "not visible to CompanyOS: FeltKit records denials in its activity log (Studio → Activity), which applications cannot read (G-08)",
      };
    });
  },
});

/** Job handler (services.jobs "agents.sweep"): flag overdue work for an operator. */
export const sweepDeadlines = app.mutation({
  access: "assignments.write",
  args: { now: s.optional(s.string()) },
  handler: async (ctx, { now }) => {
    const who = await actor(ctx);
    const at = now ?? nowIso();
    let flagged = 0;
    for (const a of await ctx.db.find(assignments, {})) {
      if (!a.deadline || a.deadline >= at || !["assigned", "accepted", "running", "recovering"].includes(a.status)) continue;
      await ctx.db.patch(assignments, a.id, { status: "waiting-intervention" });
      await record(ctx, `assignment:${a.id}`, who, "deadline.missed", `Deadline ${a.deadline} passed while ${a.status}.`);
      flagged += 1;
    }
    return { flagged };
  },
});
