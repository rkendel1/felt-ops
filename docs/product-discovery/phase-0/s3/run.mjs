// Phase 0 / S3c driver: steering over published FeltKit 0.3.37 (agent over MCP, person over HTTP).
// Usage: CODER=<session json> PAT=<session json> node run.mjs http://localhost:3312
import { readFileSync, writeFileSync } from "node:fs";
import { client } from "./mcp.mjs";
const url = process.argv[2];
const coder = client(url, JSON.parse(readFileSync(process.env.CODER, "utf8")).token);
const patToken = JSON.parse(readFileSync(process.env.PAT, "utf8")).token;
const log = []; const note = (step, data) => { log.push({ step, ...data }); console.log(JSON.stringify({ step, ...data }).slice(0, 500)); };
async function person(method, path, body) {
  const r = await fetch(`${url}${path}`, { method, headers: { authorization: `Bearer ${patToken}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 300); } return { status: r.status, body: j };
}
const created = await coder.call("feltkit.agent.create", { objective: "Phase 0 S3c: a coding run that a person steers", playbook: "handoff" });
note("agent-create", { created });
const taskId = created.value?.task?.task_id ?? created.value?.taskId ?? created.value?.task?.taskId;
note("task-id", { taskId });
note("checkpoint-1 (nothing pending)", { r: await coder.call("feltkit.agent.checkpoint", { taskId }) });
note("person-signal", { r: await person("POST", `/api/agent/tasks/${taskId}/control/signal`, {}) });
note("checkpoint-while-signaled (must proceed)", { r: await coder.call("feltkit.agent.checkpoint", { taskId }) });
const sub = await person("POST", `/api/agent/tasks/${taskId}/control/submit`, { text: "Also add a test for the empty-input case." });
note("person-submit", { r: sub });
note("propose-while-instruction-pending (must be refused)", { r: await coder.call("feltkit.agent.propose", { taskId, capability: "notes.ping", input: {}, reason: "observe" }) });
const cp = await coder.call("feltkit.agent.checkpoint", { taskId });
note("checkpoint-2 (delivers)", { r: cp });
const ins = cp.value?.instructions?.[0];
note("complete-with-open-update (must be refused)", { r: await coder.call("feltkit.agent.complete", { taskId, summary: "too early" }) });
note("acknowledge", { r: await coder.call("feltkit.agent.acknowledge", { taskId, instructionId: ins?.instructionId ?? ins?.id, outcome: "incorporated", note: "Added an empty-input test to the plan." }) });
note("person-pause", { r: await person("POST", `/api/agent/tasks/${taskId}/control/pause`, { reason: "review direction" }) });
note("checkpoint-while-paused (proceed must be false)", { r: await coder.call("feltkit.agent.checkpoint", { taskId }) });
note("person-resume", { r: await person("POST", `/api/agent/tasks/${taskId}/control/resume`, {}) });
note("checkpoint-after-resume", { r: await coder.call("feltkit.agent.checkpoint", { taskId }) });
const state = await person("GET", `/api/agent/tasks/${taskId}/control`);
note("person-reads-control-state", { r: state });
note("agent-complete", { r: await coder.call("feltkit.agent.complete", { taskId, summary: "S3c done" }) });
writeFileSync("evidence.json", JSON.stringify({ experiment: "phase-0/S3c", feltkit: JSON.parse(readFileSync("node_modules/@feltdb/feltkit/package.json")).version, log }, null, 2) + "\n");
