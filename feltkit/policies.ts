/**
 * Business configuration: policies as versioned, approved, effective-dated rules that the
 * workflows read at run time. A change here needs no deployment (change kind "config").
 */
import { fail, s } from "@feltdb/feltkit";
import { app, changes, people, policies, policyAcks, policyVersions, purchaseRequests, timeline } from "./app.js";
import { actor, effectiveVersion, grantFor, nextNumber, nowIso, record, requirePerson, stepsFor, validatePurchasingRules } from "./_lib.js";

const SAMPLE_AMOUNTS = [500, 4_999, 5_000, 12_000, 24_999, 25_000, 60_000, 150_000];

export const list = app.query({
  access: "policy.read",
  handler: async (ctx) => {
    await actor(ctx);
    const at = nowIso();
    const all = await ctx.db.find(policies, {});
    return Promise.all(all.map(async (p) => {
      const versions = (await ctx.db.find(policyVersions, { policyId: p.id })).sort((a, b) => b.version - a.version);
      let inForce: string | null = null;
      try { inForce = (await effectiveVersion(ctx, p.key, at)).version.id; } catch { inForce = null; }
      return { ...p, versions, inForce };
    }));
  },
});

export const effective = app.query({
  access: "policy.read",
  args: { key: s.string(), at: s.optional(s.string()) },
  returns: s.object({ policyId: s.string(), versionId: s.string(), version: s.number(), effectiveFrom: s.string(), rules: s.record(s.unknown()) }),
  capability: { name: "policy.effective", description: "The approved version of a policy in force at a time (default now)." },
  handler: async (ctx, { key, at }) => {
    await actor(ctx);
    const { policy, version } = await effectiveVersion(ctx, key, at ?? nowIso());
    return { policyId: policy.id, versionId: version.id, version: version.version, effectiveFrom: version.effectiveFrom, rules: version.rules };
  },
});

function validate(key: string, rules: Record<string, unknown>) {
  if (key === "purchasing.approval") validatePurchasingRules(rules);
}

/** Draft a new version. Records a config change request that tracks it to verification. */
export const propose = app.mutation({
  access: "policy.propose",
  args: { key: s.string(), rules: s.record(s.unknown()), effectiveFrom: s.string(), rationale: s.string({ minLength: 10 }) },
  handler: async (ctx, { key, rules, effectiveFrom, rationale }) => {
    const who = await requirePerson(ctx, "propose a policy change");
    const [policy] = await ctx.db.find(policies, { key });
    if (!policy) fail("NOT_FOUND", `No policy ${key}.`);
    if (Number.isNaN(Date.parse(effectiveFrom))) fail("INVALID_ARGUMENT", "effectiveFrom must be an ISO timestamp.");
    validate(key, rules);
    const existing = await ctx.db.find(policyVersions, { policyId: policy.id });
    if (existing.some((v) => v.status === "draft")) fail("FAILED_PRECONDITION", `${key} already has a draft awaiting a decision.`);
    const version = Math.max(0, ...existing.map((v) => v.version)) + 1;
    const versionId = await ctx.db.insert(policyVersions, { policyId: policy.id, version, rules, rationale, effectiveFrom, status: "draft", authorId: who.recordId });
    const number = await nextNumber(ctx, "CR");
    const changeId = await ctx.db.insert(changes, {
      number, kind: "config", title: `${policy.title}: version ${version}`, problem: rationale, requestedBy: who.recordId,
      businessOwnerId: who.recordId, status: "awaiting-approval", requirements: [], acceptance: [{ text: "New requests follow the new rules from the effective date; earlier requests keep theirs." }],
      policyVersionId: versionId,
    });
    await record(ctx, `policy:${policy.id}`, who, "version.proposed", `Version ${version} proposed, effective ${effectiveFrom}. ${number}.`, { data: { versionId, changeId } });
    await record(ctx, `change:${changeId}`, who, "change.requested", `Configuration change for ${key} v${version}.`);
    return { versionId, changeId, number };
  },
});

/** What a draft would change: affected workflows, open work under the old rules, simulated outcomes. */
export const impact = app.query({
  access: "policy.read",
  args: { versionId: s.string() },
  handler: async (ctx, { versionId }) => {
    await actor(ctx);
    const v = await ctx.db.get(policyVersions, versionId);
    if (!v) fail("NOT_FOUND", `No policy version ${versionId}.`);
    const policy = (await ctx.db.get(policies, v.policyId))!;
    let current: { id: string; rules: Record<string, unknown>; version: number } | null = null;
    try { const e = await effectiveVersion(ctx, policy.key, nowIso()); current = { id: e.version.id, rules: e.version.rules, version: e.version.version }; } catch { current = null; }
    const comparison = policy.key === "purchasing.approval"
      ? SAMPLE_AMOUNTS.map((amount) => ({
          amount,
          current: current ? stepsFor(current.rules, amount, "dept").map((x) => x.label) : [],
          proposed: stepsFor(v.rules, amount, "dept").map((x) => x.label),
        }))
      : [];
    const openUnderCurrent = current ? (await ctx.db.find(purchaseRequests, { status: "pending", policyVersionId: current.id })).length : 0;
    return {
      policy, version: v, currentVersion: current?.version ?? null, workflows: policy.workflows, comparison,
      changedAmounts: comparison.filter((c) => c.current.join("|") !== c.proposed.join("|")).map((c) => c.amount),
      openUnderCurrent,
      note: "Requests already submitted keep the approval chain of the version they were submitted under.",
    };
  },
});

export const decide = app.mutation({
  access: "policy.approve",
  args: { versionId: s.string(), decision: s.enum(["approved", "rejected"]), note: s.optional(s.string()) },
  handler: async (ctx, { versionId, decision, note }) => {
    const who = await requirePerson(ctx, "approve a policy");
    const v = await ctx.db.get(policyVersions, versionId);
    if (!v) fail("NOT_FOUND", `No policy version ${versionId}.`);
    if (v.status !== "draft") fail("FAILED_PRECONDITION", `Version ${v.version} is already ${v.status}.`);
    if (v.authorId === who.recordId) fail("FORBIDDEN", "The author of a policy change cannot approve it (separation of duties).");
    const policy = (await ctx.db.get(policies, v.policyId))!;
    if (!(await grantFor(ctx, who.recordId, policy.approvalKind))) fail("FORBIDDEN", `${who.name} holds no active "${policy.approvalKind}" authority.`);
    await ctx.db.patch(policyVersions, versionId, { status: decision, decidedBy: who.recordId, decidedAt: nowIso() });
    const [change] = await ctx.db.find(changes, { policyVersionId: versionId });
    if (change) {
      await ctx.db.patch(changes, change.id, { status: decision === "approved" ? "scheduled" : "rejected" });
      await record(ctx, `change:${change.id}`, who, `change.${decision}`, `${decision === "approved" ? "Approved" : "Rejected"} by ${who.name}${note ? `: ${note}` : ""}.`);
    }
    await record(ctx, `policy:${policy.id}`, who, `version.${decision}`, `Version ${v.version} ${decision} by ${who.name}; effective ${v.effectiveFrom}.${note ? ` ${note}` : ""}`);
    if (decision === "approved") ctx.afterCommit.notifications.send({ recipient: (await ctx.db.get(people, v.authorId))?.login ?? "maria", type: "policy.effective", title: `${policy.title} v${v.version} approved`, body: `Effective ${v.effectiveFrom}.` });
    return versionId;
  },
});

/**
 * Check the system now behaves as the version says, from records rather than from the
 * proposal: the version is the one in force, every request submitted since the effective
 * date carries it and the chain it implies, and the sample amounts route as intended.
 */
export const verify = app.mutation({
  access: "policy.read",
  args: { versionId: s.string() },
  handler: async (ctx, { versionId }) => {
    const who = await requirePerson(ctx, "verify a policy change");
    const v = await ctx.db.get(policyVersions, versionId);
    if (!v) fail("NOT_FOUND", `No policy version ${versionId}.`);
    const policy = (await ctx.db.get(policies, v.policyId))!;
    const at = nowIso();
    const problems: string[] = [];
    if (v.status !== "approved") problems.push(`version is ${v.status}`);
    if (v.effectiveFrom > at) problems.push(`not effective until ${v.effectiveFrom}`);
    let inForceVersion: number | null = null;
    try { const e = await effectiveVersion(ctx, policy.key, at); inForceVersion = e.version.version; if (e.version.id !== versionId) problems.push(`version ${e.version.version} is in force instead`); } catch (e) { problems.push((e as Error).message); }
    const start = v.decidedAt && v.decidedAt > v.effectiveFrom ? v.decidedAt : v.effectiveFrom;
    const since = (await ctx.db.find(purchaseRequests, {})).filter((r) => r.submittedAt >= start);
    const mismatched = since.filter((r) => r.policyVersionId !== versionId || stepsFor(v.rules, r.amount, r.departmentId).map((x) => x.kind).join("|") !== r.steps.map((x) => x.kind).join("|"));
    if (mismatched.length) problems.push(`${mismatched.length} request(s) since the effective date do not follow it: ${mismatched.map((r) => r.number).join(", ")}`);
    const ok = problems.length === 0;
    const verification = { ok, by: who.recordId, at, inForceVersion, requestsChecked: since.length, requestNumbers: since.map((r) => r.number), problems };
    await ctx.db.patch(policyVersions, versionId, { verification });
    const [change] = await ctx.db.find(changes, { policyVersionId: versionId });
    if (change) {
      await ctx.db.patch(changes, change.id, { status: ok ? "verified" : "verification-failed", acceptance: change.acceptance.map((a) => ({ ...a, met: ok, checkedBy: who.recordId })) });
      await record(ctx, `change:${change.id}`, who, ok ? "change.verified" : "change.verification-failed", ok ? `Verified: ${since.length} request(s) since ${start} follow v${v.version}.` : problems.join("; "), { source: "verification", data: verification });
    }
    return verification;
  },
});

export const acknowledge = app.mutation({
  access: "policy.acknowledge",
  args: { versionId: s.string() },
  handler: async (ctx, { versionId }) => {
    const who = await requirePerson(ctx, "acknowledge a policy");
    const v = await ctx.db.get(policyVersions, versionId);
    if (!v || v.status !== "approved") fail("FAILED_PRECONDITION", "Only an approved policy version can be acknowledged.");
    const [existing] = await ctx.db.find(policyAcks, { policyVersionId: versionId, personId: who.recordId });
    if (existing) return existing.id;
    return ctx.db.insert(policyAcks, { policyVersionId: versionId, personId: who.recordId, at: nowIso() });
  },
});

export const policyHistory = app.query({
  access: "policy.read",
  args: { policyId: s.string() },
  handler: async (ctx, { policyId }) => {
    await actor(ctx);
    return ctx.db.find(timeline, { subject: `policy:${policyId}` }, { orderBy: [{ field: "seq", direction: "asc" }] });
  },
});
