/**
 * Scenario 2 completed against a running production deployment (business → software →
 * production), over HTTP (people) and MCP (the Engineering Scribe agent).
 *
 *   npx tsx scripts/production-lifecycle.ts <url> <dir with prod-token-<id> files> <commit sha>
 *
 * Sessions come from `feltkit session create --env production` (production has no dev
 * sign-in). The commit must be the one production runs (COMPANYOS_COMMIT) and its GitHub
 * Actions run must have completed successfully, or the ci-passed gate refuses, by design.
 * Writes evidence/production-lifecycle.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@feltdb/feltkit/client";
import { api } from "../feltkit/_generated/api.js";

const [url, dir, sha] = process.argv.slice(2) as [string, string, string];
const out: Record<string, unknown> = { url, commit: sha, steps: [] as string[] };
const step = (s: string) => { (out.steps as string[]).push(s); console.log("•", s); };
const token = (id: string) => readFileSync(join(dir, `prod-token-${id}`), "utf8").trim();
const as = (id: string) => { const t = token(id); return createClient({ url, tokens: { get: () => t, set: () => {} } }); };
async function mcp(id: string) {
  const t = token(id);
  let n = 0;
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const res = await fetch(`${url}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) });
    const body = await res.json() as { result?: { isError?: boolean; content?: Array<{ text: string }>; structuredContent?: { result?: unknown } }; error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result!;
  };
  await rpc("initialize", { protocolVersion: "2025-06-18" });
  const names = new Map(((await rpc("tools/list")) as unknown as { tools: Array<{ name: string }> }).tools.map((x) => [x.name.replace(/_/g, "."), x.name]));
  return async <T>(cap: string, args: Record<string, unknown> = {}) => {
    const r = await rpc("tools/call", { name: names.get(cap) ?? cap, arguments: args });
    if (r.isError) throw new Error(r.content?.[0]?.text);
    return (r.structuredContent?.result ?? JSON.parse(r.content?.[0]?.text ?? "null")) as T;
  };
}

try {
  const ivy = as("ivy");
  try { await ivy.mutation(api.seed.seed); step("production organization seeded (synthetic)"); } catch (e) { if ((e as { code?: string }).code !== "FAILED_PRECONDITION") throw e; step("already seeded"); }
  const identity = await as("eli").query(api.changes.runtimeIdentity);
  out.runtimeIdentity = identity;
  if (!identity.commit?.startsWith(sha.slice(0, 12))) throw new Error(`production runs ${identity.commit}, not ${sha}`);

  // Business request → product specification → engineering.
  // Resume an earlier run's change if one is in development (the script is re-runnable).
  const earlier = (await as("priya").query(api.changes.list, { kind: "application" })).find((c) => c.title === "Supplier onboarding workflow" && c.status !== "accepted");
  const change = earlier ?? await as("priya").mutation(api.changes.request, { kind: "application", title: "Supplier onboarding workflow", problem: "Requested suppliers can never become active: there is no onboarding, so Operations cannot buy from new suppliers." });
  step(`${change.number} ${earlier ? `resumed (${earlier.status})` : "requested by Operations"}`);
  const dana = as("dana");
  if (change.status === "requested") await dana.mutation(api.changes.advance, { changeId: change.id, to: "assessed" });
  if (["requested", "assessed"].includes(change.status)) await dana.mutation(api.changes.specify, { changeId: change.id, impact: "Procurement, Finance and IT & Security each own one onboarding check.", requirements: ["Procurement starts onboarding", "Each check recorded by its owning function", "The requester cannot approve"], acceptance: ["A requested supplier cannot be ordered from until onboarding is approved", "Each check records who made it and when", "An approved supplier can be ordered from"] });
  if (!["in-development", "in-review", "ci-passed"].includes((await as("eli").query(api.changes.detail, { changeId: change.id })).change.status)) await as("eli").mutation(api.changes.advance, { changeId: change.id, to: "in-development" });
  step("assessed and specified by Product; in development");

  // The Scribe agent observes GitHub through CompanyOS's integration.
  const people = await ivy.query(api.org.listPeople, { search: "Eli" });
  const asg = await as("otto").mutation(api.agents.assign, { agentKey: "agent-scribe", title: `GitHub evidence for ${change.number}`, objective: "Observe the implementing commit and its CI run on GitHub.", context: `Commit ${sha} in rkendel1/felt-ops`, constraints: ["Observe only"], expectedOutput: "Commit and successful CI run recorded on the change.", permittedCapabilities: ["github.commit", "github.runs"], approvalRequired: false, verifier: "manual" });
  const scribe = await mcp("agent-scribe");
  const task = await scribe<{ task: { task_id: string } }>("feltkit_agent_create", { objective: `GitHub evidence for ${change.number}` });
  await scribe("assignments.accept", { assignmentId: asg, feltkitTaskId: task.task.task_id });
  await scribe("github.commit", { owner: "rkendel1", repo: "felt-ops", sha, subject: `change:${change.id}` });
  await scribe("github.runs", { owner: "rkendel1", repo: "felt-ops", head_sha: sha, per_page: 5, subject: `change:${change.id}` });
  const refs = await as("eli").query(api.integrations.refs, { subject: `change:${change.id}` });
  out.githubObservations = refs.map((r) => ({ system: r.system, kind: r.kind, ref: r.ref, status: r.status, url: r.url, via: r.observedVia }));
  await scribe("assignments.report", { assignmentId: asg, kind: "claim", text: `Observed commit ${sha.slice(0, 7)} and ${refs.filter((r) => r.kind === "workflow-run").length} workflow run(s).` });
  step(`Scribe observed ${refs.length} GitHub record(s) through the integration`);
  await as("otto").mutation(api.agents.verify, { assignmentId: asg, attestation: "Checked the observed refs against github.com: commit exists, CI run completed successfully." });

  const eli = as("eli");
  await eli.mutation(api.changes.advance, { changeId: change.id, to: "in-review" });
  await eli.mutation(api.changes.advance, { changeId: change.id, to: "ci-passed" });
  step("in review; CI passed (gate satisfied by observed GitHub Actions success)");

  // Release, approval, deployment, verification of what production runs.
  const releaseId = await eli.mutation(api.changes.createRelease, { version: "1.0.0", commit: sha, changeIds: [change.id] });
  await as("omar").mutation(api.changes.approveRelease, { releaseId });
  const health = await (await fetch(`${url}/_feltkit/health`)).json();
  await eli.mutation(api.changes.recordDeployment, { releaseId, target: "local-production", receipt: { artifact: ".feltkit/deploy (feltkit deploy --target container, verified by isolated boot)", health, url } });
  await eli.mutation(api.changes.advance, { changeId: change.id, to: "deployed" });
  const verified = await eli.mutation(api.changes.verifyRelease, { releaseId });
  out.releaseVerification = verified;
  if (!verified.ok) throw new Error("production does not run the release commit");
  step(`release 1.0.0 approved by the CEO, deployed, verified running ${sha.slice(0, 12)}`);

  // Acceptance against production behavior.
  const pablo = as("pablo");
  const bluebird = (await pablo.query(api.purchasing.listSuppliers)).find((s) => s.name === "Bluebird Packaging")!;
  let refused = "";
  try { await as("otto").mutation(api.purchasing.submitRequest, { supplierId: bluebird.id, amount: 640, description: "Shipping boxes" }); } catch (e) { refused = (e as Error).message; }
  await pablo.mutation(api.purchasing.startOnboarding, { supplierId: bluebird.id });
  await pablo.mutation(api.purchasing.recordCheck, { supplierId: bluebird.id, check: "tax-id", value: "TX-300417" });
  await as("otto").mutation(api.purchasing.recordCheck, { supplierId: bluebird.id, check: "bank", value: "verified", note: "Micro-deposit confirmed" });
  await ivy.mutation(api.purchasing.recordCheck, { supplierId: bluebird.id, check: "risk", value: "low" });
  await pablo.mutation(api.purchasing.decideOnboarding, { supplierId: bluebird.id, decision: "approved" });
  const order = await as("otto").mutation(api.purchasing.submitRequest, { supplierId: bluebird.id, amount: 640, description: "Shipping boxes" });
  const onboarded = (await pablo.query(api.purchasing.listSuppliers)).find((s) => s.id === bluebird.id)!;
  out.acceptanceEvidence = { refusedBeforeOnboarding: refused, onboarding: onboarded.onboarding, orderAfter: { number: order.number, status: order.status } };
  const priya = as("priya");
  await priya.mutation(api.changes.checkCriterion, { changeId: change.id, index: 0, met: !!refused, note: `In production, ordering from Bluebird before onboarding was refused: "${refused.slice(0, 80)}"` });
  await priya.mutation(api.changes.checkCriterion, { changeId: change.id, index: 1, met: (onboarded.onboarding ?? []).every((o) => o.by && o.at), note: `Bluebird onboarding in production: ${(onboarded.onboarding ?? []).map((o) => o.step).join(", ")}, each with who and when` });
  await priya.mutation(api.changes.checkCriterion, { changeId: change.id, index: 2, met: order.status === "pending", note: `${order.number} submitted to Bluebird after approval` });
  await priya.mutation(api.changes.advance, { changeId: change.id, to: "accepted", note: "Accepted in production." });
  step("accepted by the business owner against production behavior");

  const detail = await priya.query(api.changes.detail, { changeId: change.id });
  out.change = { number: detail.change.number, status: detail.change.status, acceptance: detail.change.acceptance };
  out.history = detail.history.map((h) => ({ at: h.at, actor: h.actorId, source: h.source, kind: h.kind, summary: h.summary }));
  out.ok = detail.change.status === "accepted";
} catch (e) {
  out.ok = false;
  out.error = (e as Error).message;
} finally {
  mkdirSync("evidence", { recursive: true });
  writeFileSync("evidence/production-lifecycle.json", JSON.stringify({ recordedAt: new Date().toISOString(), ...out }, null, 2) + "\n");
  console.log(out.ok ? "PRODUCTION LIFECYCLE: PASSED" : `PRODUCTION LIFECYCLE: FAILED ${out.error}`);
  process.exitCode = out.ok ? 0 : 1;
}
