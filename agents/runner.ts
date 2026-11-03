/**
 * CompanyOS agent runner: a separate process that works one agent's assignments through
 * the application's MCP endpoint, with the agent's own session. It has no other access:
 * every read and every change goes through capabilities FeltKit authorizes per call, and
 * every consequential step is a proposal a person must approve.
 *
 * The decisions are a deterministic playbook (no model): which commitments to reverse is
 * what finance.reconciliation computes. Its statements to CompanyOS (assignments.report)
 * are recorded as assertions.
 *
 *   AGENT_TOKEN=<session token> npx tsx agents/runner.ts --url http://localhost:3000 [--crash-after-succeeded N]
 *
 * --crash-after-succeeded N   fault injection: exit abruptly (code 137, no report, no
 *                             cleanup) once N of its actions have succeeded.
 */
const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1]!]] : acc), []));
const URL_ = args.url ?? process.env.COMPANYOS_URL ?? "http://localhost:3000";
const TOKEN = process.env.AGENT_TOKEN ?? "";
const CRASH_AFTER = args["crash-after-succeeded"] ? Number(args["crash-after-succeeded"]) : null;
const POLL_MS = Number(args.poll ?? 300);
const TIMEOUT_MS = Number(args.timeout ?? 60_000);

let rpcId = 0;
const log = (...m: unknown[]) => console.log(`[agent ${new Date().toISOString()}]`, ...m);

class ToolError extends Error { constructor(readonly code: string, message: string) { super(message); } }

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${URL_}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
  const body = (await res.json()) as { result?: { isError?: boolean; content?: Array<{ text: string }>; structuredContent?: unknown }; error?: { code: number; message: string } };
  if (res.status === 401) throw new ToolError("UNAUTHORIZED", body.error?.message ?? "session refused");
  if (body.error) throw new ToolError(String(body.error.code), body.error.message);
  return body.result!;
}

let toolNames = new Map<string, string>();
async function call<T = unknown>(capability: string, input: Record<string, unknown> = {}): Promise<T> {
  const name = toolNames.get(capability) ?? capability;
  const r = await rpc("tools/call", { name, arguments: input });
  const text = r.content?.[0]?.text ?? "";
  if (r.isError) {
    const code = text.match(/^([A-Z_]+):/)?.[1] ?? "ERROR";
    throw new ToolError(code, text);
  }
  if (r.structuredContent && typeof r.structuredContent === "object") {
    const sc = r.structuredContent as { result?: unknown };
    return (sc.result ?? sc) as T;
  }
  try { return JSON.parse(text) as T; } catch { return text as T; }
}

type Assignment = { id: string; number: string; status: string; title: string; objective: string; feltkitTaskId?: string; verifier: string; permittedCapabilities: string[] };
type Action = { actionId: string; capability: string; state: string; input: { commitmentId?: string } };
type Dupe = { commitmentId: string; keeps: string; number: string; amount: number };

async function main() {
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "companyos-agent-runner", version: "0.1.0" } });
  const tools = (await rpc("tools/list")) as unknown as { tools: Array<{ name: string; description?: string }> };
  // Tool names are derived from capability names; map by description-independent normalization.
  toolNames = new Map(tools.tools.map((t) => [t.name.replace(/_/g, "."), t.name]));
  log(`connected to ${URL_}: ${tools.tools.length} tools`);

  const mine = await call<Assignment[]>("assignments.mine");
  const work = mine.find((a) => a.verifier === "reconciliation-clean" && ["assigned", "accepted", "running", "recovering", "waiting-approval"].includes(a.status));
  if (!work) { log("no reconciliation assignment to work"); return; }
  log(`working ${work.number} (${work.status}): ${work.title}`);

  let taskId = work.feltkitTaskId;
  if (!taskId || work.status === "assigned" || work.status === "recovering") {
    const created = await call<{ task: { task_id: string } }>("feltkit_agent_create", { objective: `${work.number}: ${work.objective}`, playbook: "handoff" });
    taskId = created.task.task_id;
    await call("assignments.accept", { assignmentId: work.id, feltkitTaskId: taskId });
    log(`accepted with FeltKit task ${taskId}`);
  }

  const reconciliation = await call<{ duplicates: Dupe[] }>("finance.reconciliation");
  const existing = (await call<{ actions: Action[] }>("feltkit_agent_get", { taskId })).actions;
  const already = new Set(existing.filter((a) => a.state !== "rejected" && a.state !== "cancelled").map((a) => a.input.commitmentId));
  let proposed = 0;
  for (const d of reconciliation.duplicates) {
    if (already.has(d.commitmentId)) continue;
    await call("feltkit_agent_propose", { taskId, capability: "commitments.reverse", input: { commitmentId: d.commitmentId, reason: `Duplicate of ${d.keeps} (${d.number})` }, reason: `finance.reconciliation lists ${d.commitmentId} (${d.amount}) as a duplicate of ${d.keeps}` });
    proposed += 1;
  }
  log(`${reconciliation.duplicates.length} duplicate(s); ${proposed} reversal(s) proposed`);
  if (proposed) await call("assignments.report", { assignmentId: work.id, kind: "waiting-approval", text: `${proposed} reversal(s) proposed; waiting for Finance approval.` });

  const started = Date.now();
  let lastSucceeded = -1;
  for (;;) {
    const view = await call<{ actions: Action[] }>("feltkit_agent_get", { taskId });
    const succeeded = view.actions.filter((a) => a.state === "succeeded").length;
    const open = view.actions.filter((a) => ["proposed", "approved", "executing", "interrupted"].includes(a.state)).length;
    if (CRASH_AFTER !== null && succeeded >= CRASH_AFTER) {
      log(`FAULT INJECTION: exiting abruptly after ${succeeded} succeeded action(s)`);
      process.exit(137);
    }
    if (succeeded !== lastSucceeded) {
      lastSucceeded = succeeded;
      if (succeeded > 0) await call("assignments.report", { assignmentId: work.id, kind: "progress", text: `${succeeded} reversal(s) executed; ${open} open.` });
    }
    if (open === 0) break;
    if (Date.now() - started > TIMEOUT_MS) { await call("assignments.report", { assignmentId: work.id, kind: "failure", text: `Timed out waiting for approvals; ${open} open.` }); return; }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  const after = await call<{ duplicates: Dupe[] }>("finance.reconciliation");
  const summary = `${after.duplicates.length === 0 ? "No duplicates remain" : `${after.duplicates.length} duplicate(s) remain`}; this task executed ${lastSucceeded} reversal(s).`;
  await call("assignments.report", { assignmentId: work.id, kind: after.duplicates.length === 0 ? "claim" : "failure", text: summary });
  await call("feltkit_agent_complete", { taskId, summary });
  log(`done: ${summary}`);
}

main().catch((e) => { log(`stopped: ${(e as ToolError).code ?? ""} ${(e as Error).message}`); process.exit(e instanceof ToolError && e.code === "UNAUTHORIZED" ? 3 : 1); });
