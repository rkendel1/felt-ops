/**
 * Scenario 6, live: real agent processes over MCP, a real crash, a real revoked session.
 *
 *   npx tsx scripts/scenario-6-live.ts
 *
 * The server is CompanyOS's runtime on a FeltDB state where release R1 created four
 * duplicate commitments, served over HTTP by FeltKit's own server (/mcp). Approvals are made
 * through AgentHost.approve as named people, which is what Studio's Approve button calls.
 * Writes evidence/scenario-6-live.json.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestApp } from "@feltdb/feltkit/testing";
import { startServer } from "@feltdb/feltkit/server";
import { api } from "../feltkit/_generated/api.js";
import { stateWithR1Duplicates } from "../tests/_r1.js";
import { principal } from "../tests/_support.js";

const out: Record<string, unknown> = {};
const r1 = await stateWithR1Duplicates(4);
const t = await createTestApp({ storage: r1.storage });
const server = await startServer({ runtime: t.runtime, projectDir: process.cwd(), port: 0, host: "127.0.0.1" });
const url = (server as unknown as { url: string }).url ?? `http://127.0.0.1:${(server as unknown as { port: number }).port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function runAgent(token: string, extra: string[] = []) {
  const child = spawn("npx", ["tsx", "agents/runner.ts", "--url", url, ...extra], { env: { ...process.env, AGENT_TOKEN: token }, stdio: ["ignore", "pipe", "pipe"] });
  const lines: string[] = [];
  child.stdout.on("data", (d) => lines.push(...String(d).trim().split("\n")));
  child.stderr.on("data", (d) => lines.push(...String(d).trim().split("\n").map((l) => `stderr: ${l}`)));
  const exit = new Promise<number>((r) => child.on("exit", (code) => r(code ?? -1)));
  return { lines, exit };
}
async function approveAs(person: string, max: number) {
  let approved = 0;
  for (let i = 0; i < 100 && approved < max; i += 1) {
    for (const row of await t.runtime.agent.list("admin")) {
      if (!row.pending || approved >= max) continue;
      const view = await t.runtime.agent.get(row.task.task_id, "admin");
      for (const p of view.pending) {
        if (approved >= max) break;
        await t.runtime.agent.approve(row.task.task_id, p.actionId, principal(person));
        approved += 1;
      }
    }
    if (approved < max) await sleep(300);
  }
  return approved;
}

try {
  out.server = url;
  for (const id of ["rhea", "maria", "otto"]) await t.runtime.issueSession(principal(id), { kind: "test", via: "test" });
  const asgId = await t.as("otto").mutation(api.agents.assign, { agentKey: "agent-ledger", title: "Reverse four duplicate Northwind commitments", objective: "Reverse each commitment finance.reconciliation lists as a duplicate.", context: "R1 defect.", constraints: ["One proposal per commitment"], expectedOutput: "Zero duplicates.", permittedCapabilities: ["finance.reconciliation", "commitments.reverse"], approvalRequired: true, verifier: "reconciliation-clean" });
  const a = await t.runtime.issueSession(principal("agent-ledger"), { kind: "agent", label: "scenario 6 live", via: "test" });

  // 1. The primary agent runs; Finance approves two; the agent process dies.
  const first = runAgent(a.token, ["--crash-after-succeeded", "2"]);
  out.approvedBeforeCrash = await approveAs("rhea", 2);
  const exitCode = await first.exit;
  out.firstAgent = { exitCode, log: first.lines };
  console.log("first agent exited", exitCode);

  // 2. Its session is revoked; the platform refuses it at the protocol boundary.
  out.sessionsRevoked = await t.runtime.sessions.revokePrincipal("agent-ledger");
  const replay = await fetch(`${url}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${a.token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "finance_reconciliation", arguments: {} } }) });
  out.revokedTokenStatus = replay.status;

  // 3. The operator establishes the real state.
  const detail = await t.as("otto").query(api.agents.assignmentDetail, { assignmentId: asgId });
  const taskId = detail.assignment.feltkitTaskId!;
  const task = await t.runtime.agent.get(taskId, principal("otto"));
  out.operatorView = { assignmentStatus: detail.assignment.status, lastAgentStatement: detail.history.filter((h) => h.source === "assertion").at(-1)?.summary, feltkitActions: task.actions.map((x) => x.state), recordsCheck: detail.check };
  console.log("operator view", out.operatorView);

  // 4. Recovery: suspend, cancel the orphaned task, reassign to the standby.
  await t.as("ivy").mutation(api.agents.setStatus, { key: "agent-ledger", status: "suspended", reason: "process crashed; session revoked" });
  await t.runtime.agent.cancel(taskId, principal("otto"), "agent lost; reassigned");
  const newId = await t.as("otto").mutation(api.agents.reassign, { assignmentId: asgId, toAgentKey: "agent-ledger-2", note: "Primary crashed after 2 of 4." });
  const b = await t.runtime.issueSession(principal("agent-ledger-2"), { kind: "agent", label: "scenario 6 live standby", via: "test" });
  const second = runAgent(b.token);
  out.approvedAfterRecovery = await approveAs("maria", 2);
  out.secondAgent = { exitCode: await second.exit, log: second.lines };

  // 5. Verification from records.
  const verification = await t.as("otto").mutation(api.agents.verify, { assignmentId: newId! });
  const reversed = await t.as("rhea").query(api.purchasing.listCommitments, { status: "reversed" });
  out.verification = verification;
  out.reversed = reversed.map((c) => ({ id: c.id, by: c.reversedBy }));
  out.exactlyOnce = reversed.length === 4 && new Set(reversed.map((c) => c.id)).size === 4 && r1.duplicates.every((d) => reversed.some((c) => c.id === d.commitmentId));
  out.ok = exitCode === 137 && replay.status === 401 && verification.ok && out.exactlyOnce === true && (out.secondAgent as { exitCode: number }).exitCode === 0;
} catch (e) {
  out.ok = false;
  out.error = (e as Error).stack;
} finally {
  await (server as unknown as { close(): Promise<void> }).close();
  await t.close();
  r1.cleanup();
  mkdirSync("evidence", { recursive: true });
  writeFileSync(join("evidence", "scenario-6-live.json"), JSON.stringify({ recordedAt: new Date().toISOString(), r1Commit: r1.sha, ...out }, null, 2) + "\n");
  console.log(out.ok ? "SCENARIO 6 LIVE: PASSED" : `SCENARIO 6 LIVE: FAILED ${out.error ?? ""}`);
  process.exit(out.ok ? 0 : 1);
}
