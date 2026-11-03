/**
 * Product, engineering and DevOps: change requests on three distinct paths, the evidence
 * external systems hold about them, and releases.
 *
 * A transition that claims something an external system knows (CI passed, a deployment
 * is live) requires evidence CompanyOS observed itself (an integration call), or is
 * explicitly marked as a report. Statements are never upgraded to evidence.
 */
import { fail, s } from "@feltdb/feltkit";
import { app, changes, externalRefs, incidents, people, releases, timeline } from "./app.js";
import { actor, nextNumber, nowIso, record, requirePerson } from "./_lib.js";
import { withinAssignment } from "./_scope.js";

const Change = s.doc(changes);

/** Allowed transitions per kind, with the permission each needs. */
const FLOW: Record<string, Record<string, { from: string[]; access: string; evidence?: string }>> = {
  application: {
    assessed: { from: ["requested"], access: "changes.write" },
    specified: { from: ["assessed"], access: "changes.write" },
    "in-development": { from: ["specified", "ci-failed"], access: "changes.engineer" },
    "in-review": { from: ["in-development"], access: "changes.engineer", evidence: "commit" },
    "ci-passed": { from: ["in-review", "ci-failed"], access: "changes.engineer", evidence: "ci-success" },
    "ci-failed": { from: ["in-review"], access: "changes.engineer" },
    "release-approved": { from: ["ci-passed"], access: "changes.approve" },
    deployed: { from: ["release-approved"], access: "releases.write", evidence: "deployment" },
    accepted: { from: ["deployed"], access: "changes.read" },
    rejected: { from: ["requested", "assessed", "specified"], access: "changes.write" },
  },
  platform: {
    assessed: { from: ["discovered"], access: "changes.engineer" },
    tested: { from: ["assessed", "test-failed"], access: "changes.engineer", evidence: "test-run" },
    "test-failed": { from: ["assessed"], access: "changes.engineer", evidence: "test-run" },
    approved: { from: ["tested"], access: "changes.approve" },
    deployed: { from: ["approved"], access: "releases.write", evidence: "deployment" },
    verified: { from: ["deployed"], access: "changes.engineer", evidence: "data-verification" },
    deferred: { from: ["discovered", "assessed", "tested", "test-failed"], access: "changes.approve" },
  },
};

export const list = app.query({
  access: "changes.read",
  args: { kind: s.optional(s.enum(["config", "application", "platform"])) },
  returns: s.array(Change),
  capability: { name: "changes.list", description: "Change requests (config, application, platform)." },
  handler: async (ctx, { kind }) => {
    await actor(ctx);
    const rows = await ctx.db.find(changes, kind ? { kind } : {});
    return rows.sort((a, b) => b.number.localeCompare(a.number));
  },
});

export const detail = app.query({
  access: "changes.read",
  args: { changeId: s.string() },
  handler: async (ctx, { changeId }) => {
    await actor(ctx);
    const change = await ctx.db.get(changes, changeId);
    if (!change) fail("NOT_FOUND", `No change ${changeId}.`);
    const [history, refs, allReleases, everyone] = await Promise.all([
      ctx.db.find(timeline, { subject: `change:${changeId}` }, { orderBy: [{ field: "seq", direction: "asc" }] }),
      ctx.db.find(externalRefs, { subject: `change:${changeId}` }),
      ctx.db.find(releases, {}),
      ctx.db.find(people, {}),
    ]);
    const name = (id: string) => everyone.find((p) => p.id === id)?.name ?? id;
    const flow = FLOW[change.kind] ?? {};
    const next = Object.entries(flow).filter(([, t]) => t.from.includes(change.status)).map(([to, t]) => ({ to, access: t.access, evidence: t.evidence ?? null, allowed: ctx.auth.has(t.access) }));
    return {
      change, requestedBy: name(change.requestedBy), businessOwner: name(change.businessOwnerId), history, refs,
      releases: allReleases.filter((r) => r.changeIds.includes(changeId)),
      incident: change.incidentId ? await ctx.db.get(incidents, change.incidentId) : null,
      next,
    };
  },
});

export const request = app.mutation({
  access: "changes.request",
  args: { kind: s.enum(["application", "platform"]), title: s.string({ minLength: 5 }), problem: s.string({ minLength: 10 }), businessOwnerId: s.optional(s.string()), incidentId: s.optional(s.string()), platform: s.optional(s.object({ package: s.string(), from: s.string(), to: s.string() })) },
  returns: Change,
  capability: { name: "changes.request", description: "Request an application change or record a platform release to assess." },
  handler: async (ctx, args) => {
    const who = await actor(ctx);
    if (args.kind === "platform" && !args.platform) fail("INVALID_ARGUMENT", "A platform change names the package and versions.");
    const owner = args.businessOwnerId ?? (who.type === "person" ? who.recordId : undefined);
    if (!owner) fail("INVALID_ARGUMENT", "An agent's request must name a business owner.");
    const number = await nextNumber(ctx, "CR");
    const id = await ctx.db.insert(changes, {
      number, kind: args.kind, title: args.title, problem: args.problem, requestedBy: who.type === "person" ? who.recordId : who.id, businessOwnerId: owner,
      status: args.kind === "platform" ? "discovered" : "requested", requirements: [], acceptance: [],
      ...(args.incidentId ? { incidentId: args.incidentId } : {}), ...(args.platform ? { platform: args.platform } : {}),
    });
    await record(ctx, `change:${id}`, who, "change.requested", `${number} (${args.kind}): ${args.title}`);
    if (args.incidentId) await record(ctx, `incident:${args.incidentId}`, who, "change.linked", `Engineering change ${number} opened.`, { data: { changeId: id } });
    return (await ctx.db.get(changes, id))!;
  },
});

/** Product's part: impact, requirements and acceptance criteria. */
export const specify = app.mutation({
  access: "changes.write",
  args: { changeId: s.string(), impact: s.string({ minLength: 10 }), requirements: s.array(s.string({ minLength: 3 })), acceptance: s.array(s.string({ minLength: 3 })) },
  handler: async (ctx, { changeId, impact, requirements, acceptance }) => {
    const who = await requirePerson(ctx, "specify a change");
    const c = await ctx.db.get(changes, changeId);
    if (!c) fail("NOT_FOUND", `No change ${changeId}.`);
    if (c.kind !== "application") fail("FAILED_PRECONDITION", "Only application changes are specified here.");
    if (!["requested", "assessed"].includes(c.status)) fail("FAILED_PRECONDITION", `${c.number} is ${c.status}; requirements are fixed once specified.`);
    if (acceptance.length === 0) fail("INVALID_ARGUMENT", "At least one acceptance criterion is needed.");
    await ctx.db.patch(changes, changeId, { impact, requirements, acceptance: acceptance.map((text) => ({ text })), status: "specified" });
    await record(ctx, `change:${changeId}`, who, "change.specified", `${requirements.length} requirement(s), ${acceptance.length} acceptance criteria. Impact: ${impact}`);
    return changeId;
  },
});

/**
 * Record evidence. `observedVia` "reported" marks a statement CompanyOS could not observe
 * (a local test run, an npm lookup, a deployment receipt it cannot fetch). Integration-
 * observed evidence arrives through integrations:onGithubCall instead.
 */
export const recordEvidence = app.mutation({
  access: "changes.evidence",
  args: { changeId: s.string(), system: s.enum(["github", "github-actions", "local-production", "fly", "vercel", "npm"]), kind: s.string(), ref: s.string(), status: s.string(), url: s.optional(s.string()), detail: s.optional(s.record(s.unknown())) },
  returns: s.string(),
  capability: { name: "changes.evidence", description: "Record evidence about a change that CompanyOS cannot observe itself. It is stored as reported, not verified." },
  handler: async (ctx, a) => {
    const who = await actor(ctx);
    await withinAssignment(ctx, who, "changes.evidence");
    const c = await ctx.db.get(changes, a.changeId);
    if (!c) fail("NOT_FOUND", `No change ${a.changeId}.`);
    const id = await ctx.db.insert(externalRefs, { subject: `change:${a.changeId}`, system: a.system, kind: a.kind, ref: a.ref, status: a.status, observedAt: nowIso(), observedBy: who.id, observedVia: "reported", ...(a.url ? { url: a.url } : {}), ...(a.detail ? { detail: a.detail } : {}) });
    await record(ctx, `change:${a.changeId}`, who, "evidence.reported", `${who.name} reported ${a.system} ${a.kind} ${a.ref}: ${a.status}.`, { source: "assertion" });
    return id;
  },
});

async function evidenceFor(ctx: Parameters<typeof actor>[0], changeId: string, need: string) {
  const refs = await ctx.db.find(externalRefs, { subject: `change:${changeId}` });
  switch (need) {
    case "commit": return refs.find((r) => r.kind === "commit" && r.status === "exists" && r.observedVia.startsWith("integration:")) ?? null;
    case "ci-success": return refs.find((r) => r.kind === "workflow-run" && r.status === "completed/success" && r.observedVia.startsWith("integration:")) ?? null;
    case "deployment": return refs.find((r) => r.kind === "deployment" && r.status === "live") ?? null;
    case "test-run": return refs.find((r) => r.kind === "test-run") ?? null;
    case "data-verification": return refs.find((r) => r.kind === "data-verification" && r.status === "passed") ?? null;
    default: return null;
  }
}

export const advance = app.mutation({
  access: "changes.read",
  args: { changeId: s.string(), to: s.string(), note: s.optional(s.string()) },
  handler: async (ctx, { changeId, to, note }) => {
    const who = await requirePerson(ctx, "advance a change");
    const c = await ctx.db.get(changes, changeId);
    if (!c) fail("NOT_FOUND", `No change ${changeId}.`);
    const t = FLOW[c.kind]?.[to];
    if (!t) fail("INVALID_ARGUMENT", `${c.kind} changes have no "${to}" state.`);
    if (!t.from.includes(c.status)) fail("FAILED_PRECONDITION", `${c.number} is ${c.status}; "${to}" needs ${t.from.join(" or ")}.`);
    ctx.auth.require(t.access);
    if (to === "accepted") {
      if (c.businessOwnerId !== who.recordId) fail("FORBIDDEN", "Only the business owner accepts a change.");
      if (c.acceptance.some((a) => a.met !== true)) fail("FAILED_PRECONDITION", "Every acceptance criterion must be checked as met first.");
    }
    let evidence = null;
    if (t.evidence) {
      evidence = await evidenceFor(ctx, changeId, t.evidence);
      if (!evidence) fail("FAILED_PRECONDITION", `"${to}" needs ${t.evidence} evidence on ${c.number}${t.evidence === "ci-success" || t.evidence === "commit" ? " observed through the GitHub integration (github.commit / github.runs with subject change:" + changeId + ")" : ""}.`);
      if (to === "test-failed" && evidence.status === "passed") fail("FAILED_PRECONDITION", "The recorded test run passed.");
      if (to === "tested" && evidence.status !== "passed") fail("FAILED_PRECONDITION", `The recorded test run is ${evidence.status}.`);
    }
    await ctx.db.patch(changes, changeId, { status: to });
    await record(ctx, `change:${changeId}`, who, `change.${to}`, `${c.status} → ${to} by ${who.name}${evidence ? ` (evidence: ${evidence.system} ${evidence.kind} ${evidence.ref}, ${evidence.observedVia === "reported" ? "reported" : "observed"})` : ""}${note ? `: ${note}` : ""}.`);
    return to;
  },
});

/** The business owner (or product) checks an acceptance criterion against the running system. */
export const checkCriterion = app.mutation({
  access: "changes.read",
  args: { changeId: s.string(), index: s.number(), met: s.boolean(), note: s.string({ minLength: 3 }) },
  handler: async (ctx, { changeId, index, met, note }) => {
    const who = await requirePerson(ctx, "check acceptance criteria");
    const c = await ctx.db.get(changes, changeId);
    if (!c) fail("NOT_FOUND", `No change ${changeId}.`);
    if (c.businessOwnerId !== who.recordId && !ctx.auth.has("changes.write")) fail("FORBIDDEN", "Only the business owner or product checks acceptance criteria.");
    if (!c.acceptance[index]) fail("INVALID_ARGUMENT", `No criterion ${index}.`);
    const acceptance = c.acceptance.map((a, i) => (i === index ? { ...a, met, checkedBy: who.recordId } : a));
    await ctx.db.patch(changes, changeId, { acceptance });
    await record(ctx, `change:${changeId}`, who, "acceptance.checked", `"${c.acceptance[index]!.text}": ${met ? "met" : "not met"} — ${note}`, { source: "verification" });
    return changeId;
  },
});

// ───────────── Releases ─────────────

export const createRelease = app.mutation({
  access: "releases.write",
  args: { version: s.string(), commit: s.string({ minLength: 7 }), changeIds: s.array(s.string()) },
  handler: async (ctx, { version, commit, changeIds }) => {
    const who = await requirePerson(ctx, "cut a release");
    for (const id of changeIds) {
      const c = await ctx.db.get(changes, id);
      if (!c) fail("NOT_FOUND", `No change ${id}.`);
      if (c.kind === "config") fail("FAILED_PRECONDITION", `${c.number} is a configuration change; it is not released (it takes effect by its effective date).`);
      if (!["ci-passed", "release-approved", "approved"].includes(c.status)) fail("FAILED_PRECONDITION", `${c.number} is ${c.status}; only changes that passed CI or were approved can be released.`);
    }
    const kinds = new Set(await Promise.all(changeIds.map(async (id) => (await ctx.db.get(changes, id))!.kind)));
    if (kinds.size > 1) fail("FAILED_PRECONDITION", "A release carries either application changes or a platform change, never both (platform upgrades are released on their own).");
    const id = await ctx.db.insert(releases, { version, commit, changeIds, status: "candidate" });
    await record(ctx, `release:${id}`, who, "release.created", `${version} at ${commit.slice(0, 12)} with ${changeIds.length} change(s).`);
    return id;
  },
});

export const approveRelease = app.mutation({
  access: "releases.approve",
  args: { releaseId: s.string() },
  handler: async (ctx, { releaseId }) => {
    const who = await requirePerson(ctx, "approve a release");
    const r = await ctx.db.get(releases, releaseId);
    if (!r) fail("NOT_FOUND", `No release ${releaseId}.`);
    if (r.status !== "candidate") fail("FAILED_PRECONDITION", `${r.version} is ${r.status}.`);
    await ctx.db.patch(releases, releaseId, { status: "approved", approvedBy: who.recordId });
    for (const id of r.changeIds) {
      const c = (await ctx.db.get(changes, id))!;
      if (c.kind === "application" && c.status === "ci-passed") {
        await ctx.db.patch(changes, id, { status: "release-approved" });
        await record(ctx, `change:${id}`, who, "change.release-approved", `Release ${r.version} approved by ${who.name}.`);
      }
    }
    await record(ctx, `release:${releaseId}`, who, "release.approved", `${r.version} approved by ${who.name}.`);
    return releaseId;
  },
});

/**
 * Record the deployment of an approved release. The receipt is FeltKit's (or the target's)
 * own report, stored as reported: CompanyOS cannot fetch a deployment receipt itself.
 */
export const recordDeployment = app.mutation({
  access: "releases.write",
  args: { releaseId: s.string(), target: s.enum(["local-production", "fly", "vercel"]), receipt: s.record(s.unknown()) },
  handler: async (ctx, { releaseId, target, receipt }) => {
    const who = await requirePerson(ctx, "record a deployment");
    const r = await ctx.db.get(releases, releaseId);
    if (!r) fail("NOT_FOUND", `No release ${releaseId}.`);
    if (r.status !== "approved") fail("FAILED_PRECONDITION", `${r.version} is ${r.status}; only an approved release is deployed.`);
    const at = nowIso();
    await ctx.db.patch(releases, releaseId, { status: "deployed", deployedAt: at, receipt });
    for (const id of r.changeIds) {
      await ctx.db.insert(externalRefs, { subject: `change:${id}`, system: target, kind: "deployment", ref: r.version, status: "live", observedAt: at, observedBy: who.id, observedVia: "reported", detail: receipt });
      await record(ctx, `change:${id}`, who, "deployment.recorded", `${r.version} deployed to ${target} (receipt recorded as reported).`, { source: "assertion" });
    }
    ctx.afterCommit.webhooks.emit("change.released", { releaseId, version: r.version });
    return releaseId;
  },
});

/** What this process is running: compared against a release to verify a deployment. */
export const runtimeIdentity = app.query({
  access: "changes.read",
  handler: async (ctx) => {
    await actor(ctx);
    return { environment: ctx.environment.name, commit: process.env.COMPANYOS_COMMIT ?? null, deploymentId: process.env.FELTKIT_DEPLOYMENT_ID ?? null, revision: process.env.FELTKIT_DEPLOYMENT_REVISION ?? null };
  },
});

export const verifyRelease = app.mutation({
  access: "releases.write",
  args: { releaseId: s.string() },
  handler: async (ctx, { releaseId }) => {
    const who = await requirePerson(ctx, "verify a release");
    const r = await ctx.db.get(releases, releaseId);
    if (!r) fail("NOT_FOUND", `No release ${releaseId}.`);
    if (r.status !== "deployed") fail("FAILED_PRECONDITION", `${r.version} is ${r.status}.`);
    const running = process.env.COMPANYOS_COMMIT ?? null;
    const ok = running !== null && r.commit.startsWith(running.slice(0, 12)) || (running?.startsWith(r.commit.slice(0, 12)) ?? false);
    const detail = { environment: ctx.environment.name, runningCommit: running, releaseCommit: r.commit };
    if (!ok) {
      await record(ctx, `release:${releaseId}`, who, "release.verification-failed", `This process runs ${running ?? "an unidentified commit (COMPANYOS_COMMIT unset)"}, not ${r.commit.slice(0, 12)}.`, { source: "verification", data: detail });
      return { ok: false, ...detail };
    }
    await ctx.db.patch(releases, releaseId, { status: "verified" });
    await record(ctx, `release:${releaseId}`, who, "release.verified", `${ctx.environment.name} runs ${r.commit.slice(0, 12)}.`, { source: "verification", data: detail });
    return { ok: true, ...detail };
  },
});

export const listReleases = app.query({
  access: "changes.read",
  handler: async (ctx) => {
    await actor(ctx);
    return (await ctx.db.find(releases, {})).sort((a, b) => b.version.localeCompare(a.version, "en", { numeric: true }));
  },
});
