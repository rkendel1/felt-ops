// Phase 0 / S2 driver. Runs flows A, B, C against a running `feltkit dev` and writes evidence.json.
// Usage: TOKENS=<path to {pat,runner-a,runner-b,runner-pool} json> node run.mjs http://localhost:3311
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { client } from "./mcp.mjs";

const url = process.argv[2];
const tokens = JSON.parse(readFileSync(process.env.TOKENS, "utf8"));
const run = `r${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const as = (who) => client(url, tokens[who]);
const log = [];
const note = (flow, step, data) => { const e = { flow, step, at: new Date().toISOString(), ...data }; log.push(e); console.log(JSON.stringify(e).slice(0, 400)); };

function startRunner(who, id, worker, count, finish) {
  const p = spawn(process.execPath, ["runner.mjs", url, id, worker, String(count), ...(finish ? ["finish"] : [])], { env: { ...process.env, RUNNER_TOKEN: tokens[who] }, stdio: ["ignore", "pipe", "inherit"] });
  const lines = [];
  p.stdout.on("data", (b) => { for (const l of b.toString().split("\n").filter(Boolean)) { lines.push(JSON.parse(l)); } });
  const done = new Promise((r) => p.on("exit", (code, signal) => r({ code, signal })));
  return { p, lines, done, waitFor: async (pred, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (lines.some(pred)) return true; await sleep(100); } return false; } };
}

const summary = {};

// ── Flow A: the person submits from their own session; can a separate runner claim it?
{
  const r = await as("pat").call("work.request", { key: `${run}-flowA`, instruction: "Flow A work" });
  note("A", "person-request", { r });
  const id = r.value?.invocation?.id ?? r.value?.id ?? r.value?.invocationId;
  note("A", "invocation-id", { id, receiptKeys: Object.keys(r.value ?? {}) });
  const viaRunner = await as("runner-pool").call("work.claim", { id, worker: "w-a", leaseMs: 3000 });
  note("A", "runner-claims-person-work", { viaRunner });
  summary.A = { runnerCanClaimPersonSubmitted: viaRunner.ok && viaRunner.value?.proceed === true, refusal: viaRunner.ok ? null : viaRunner.code };
}

// ── Flow B: a runner delivers via the bridge for the person; a DIFFERENT runner principal takes over.
{
  const r = await as("runner-a").call("work.deliver", { key: `${run}-flowB`, instruction: "Flow B work", person: "pat" });
  note("B", "runner-a-delivers", { r });
  const id = r.value?.invocation?.id ?? r.value?.id ?? r.value?.invocationId;
  const a = startRunner("runner-a", id, "w-a1", "forever");
  await a.waitFor((l) => l.step === "report" && l.n >= 3);
  a.p.kill("SIGKILL"); note("B", "runner-a-killed", { exit: await a.done, lines: a.lines.length });
  await sleep(3500);
  const b = await as("runner-b").call("work.claim", { id, worker: "w-b1", leaseMs: 3000 });
  note("B", "runner-b-claims-after-expiry", { b });
  summary.B = { distinctPrincipalCanTakeOver: b.ok && b.value?.proceed === true, refusal: b.ok ? null : b.code };
  await as("pat").call("work.cancel", { id });
}

// ── Flow C: one shared runner-pool principal, two OS processes (distinct worker ids).
{
  const pat = as("pat");
  const r = await as("runner-pool").call("work.deliver", { key: `${run}-flowC`, instruction: "Flow C work", person: "pat" });
  note("C", "pool-delivers", { r });
  const id = r.value?.invocation?.id ?? r.value?.id ?? r.value?.invocationId;
  const p1 = startRunner("runner-pool", id, "w-pool-1", "forever");
  const renewed = await p1.waitFor((l) => l.step === "report" && l.n >= 3 && l.result.ok);
  const reports = p1.lines.filter((l) => l.step === "report");
  note("C", "process-1-renewals", { renewed, reports: reports.map((l) => ({ n: l.n, ok: l.result.ok, leaseUntil: l.result.value?.leaseUntil })) });
  const oldClaim = p1.lines.find((l) => l.step === "claim-token-for-replay")?.claim;
  p1.p.kill("SIGKILL"); note("C", "process-1-SIGKILL", { exit: await p1.done });
  // Immediately: lease still held → second process must not proceed.
  const early = await as("runner-pool").call("work.claim", { id, worker: "w-pool-early", leaseMs: 3000 });
  note("C", "claim-before-expiry", { early });
  await sleep(3500);
  const p2 = startRunner("runner-pool", id, "w-pool-2", 2, true);
  await p2.done;
  const p2claim = p2.lines.find((l) => l.step === "claim")?.result;
  note("C", "process-2-claim", { p2claim, lines: p2.lines.map((l) => ({ step: l.step, ok: l.result?.ok, code: l.result?.code })) });
  // (d) replay the killed runner's last call with the old claim.
  const replay = await as("runner-pool").call("work.report", { id, claim: oldClaim, note: "late report from killed process" });
  note("C", "stale-claim-replay", { replay });
  // (e) the person reads it.
  const seen = await pat.call("work.status", { id });
  note("C", "person-reads", { state: seen.value?.state, attempts: seen.value?.executions?.[0]?.attempts?.map((a) => ({ id: a.id, outcome: a.outcome, worker: a.worker?.id ?? a.worker })), raw: seen.ok ? undefined : seen });
  summary.C = {
    a_claimByNonPerson: p1.lines.some((l) => l.step === "claim" && l.result.value?.proceed),
    b_threeRenewals: renewed,
    c_earlyClaimRefused: early.ok && early.value?.proceed === false,
    c_attempt2: p2claim?.value?.attempt, c_previous: p2claim?.value?.previous,
    d_staleRefused: !replay.ok ? replay.code : "ACCEPTED (unexpected)",
    e_personSees: seen.ok, finalState: seen.value?.state,
  };
}

// ── Flow C2: person cancels running work; progress after cancel must be refused.
{
  const r = await as("runner-pool").call("work.deliver", { key: `${run}-flowC2`, instruction: "Flow C2 work", person: "pat" });
  const id = r.value?.invocation?.id ?? r.value?.id ?? r.value?.invocationId;
  const c = await as("runner-pool").call("work.claim", { id, worker: "w-c2", leaseMs: 30000 });
  const cancel = await as("pat").call("work.cancel", { id });
  const after = await as("runner-pool").call("work.report", { id, claim: c.value?.claim, note: "after cancel" });
  const runnerCancel = await as("runner-pool").call("work.cancel", { id });
  note("C2", "cancel", { cancelState: cancel.value?.state, cancelOk: cancel.ok, after, runnerCancel: runnerCancel.ok ? "ALLOWED" : runnerCancel.code });
  summary.C2 = { personCancelled: cancel.ok && cancel.value?.state === "cancelled", progressAfterCancelRefused: !after.ok ? after.code : false, runnerCannotCancel: !runnerCancel.ok };
}

writeFileSync("evidence.json", JSON.stringify({ experiment: "phase-0/S2", feltkit: JSON.parse(readFileSync("node_modules/@feltdb/feltkit/package.json")).version, run, summary, log }, null, 2) + "\n");
console.log("SUMMARY", JSON.stringify(summary, null, 2));
