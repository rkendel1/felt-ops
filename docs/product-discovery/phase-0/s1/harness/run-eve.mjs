// S1 harness H-EVE: one task, one attempt. Usage:
//   MODEL=<gateway model id> node run-eve.mjs <taskId> <outDir> [--port 2101]
// Needs: Node 24 on PATH for eve, Docker daemon, AI_GATEWAY_API_KEY, and harness/eve-template/node_modules installed.
import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const s1 = join(here, "..");
const [task, outDir] = process.argv.slice(2);
const port = Number(process.argv[process.argv.indexOf("--port") + 1] || 2101);
const model = process.env.MODEL; if (!model) throw new Error("MODEL is required");
// PROVIDER=anthropic: call Anthropic directly through eve's anthropic() helper (reads ANTHROPIC_API_KEY),
// instead of the AI Gateway string. Same model; only the route differs (RESULTS: deviation D2).
const direct = process.env.PROVIDER === "anthropic";
const LIMIT_MS = 20 * 60 * 1000;
const work = join(outDir, "project");
rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true });
cpSync(join(here, "eve-template"), work, { recursive: true, filter: (p) => !p.endsWith("node_modules") });
symlinkSync(join(here, "eve-template", "node_modules"), join(work, "node_modules"));
writeFileSync(join(work, "agent/agent.ts"), direct
  ? `import { defineAgent } from "eve";\nimport { anthropic } from "eve/models/anthropic";\n\nexport default defineAgent({\n  model: anthropic(${JSON.stringify(model)}),\n  reasoning: "high",\n});\n`
  : readFileSync(join(work, "agent/agent.ts"), "utf8").replace("__MODEL__", model));
cpSync(join(s1, "fixture"), join(work, "agent/sandbox/workspace"), { recursive: true });
const prompt = `${readFileSync(join(s1, "tasks", task, "prompt.md"), "utf8").trim()}\n\nThe repository is in /workspace. Run \`npm test\` to check your work. Finish the task without asking questions, then end your turn with a short summary.`;
const before = new Set(execFileSync("docker", ["ps", "-aq"], { encoding: "utf8" }).split("\n").filter(Boolean));
const env = { ...process.env };
if (direct) { delete env.ANTHROPIC_BASE_URL; delete env.AI_GATEWAY_API_KEY; }
// Self-hosted production mode (eve build + eve start): eve dev's credential broker refused the direct
// Anthropic key (RESULTS P0-F4); a runner would run built servers anyway.
execFileSync(join(work, "node_modules/.bin/eve"), ["build"], { cwd: work, env, stdio: "ignore", timeout: 600000 });
const server = spawn(join(work, "node_modules/.bin/eve"), ["start", "--host", "127.0.0.1", "--port", String(port)], { cwd: work, env, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = ""; server.stdout.on("data", (b) => (serverLog += b)); server.stderr.on("data", (b) => (serverLog += b));
const t0 = Date.now();
while (!/listening at http/.test(serverLog)) { if (Date.now() - t0 > 300000) throw new Error("eve dev did not start"); await new Promise((r) => setTimeout(r, 500)); }
const base = `http://127.0.0.1:${port}/eve/v1`;
const started = Date.now();
const created = await (await fetch(`${base}/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: prompt }) })).json();
const facts = []; let settled = null; let infra = null; let next = 0; let ended = false;
const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), LIMIT_MS);
// EVE's stream serves renewable leases: it ends with {"$eve":"stream.lease-ended"} and the reader
// reconnects from its cursor (startIndex = next stored line). Heartbeats and lease markers are not stored lines.
try {
  while (!settled && !ended) {
    const res = await fetch(`${base}/session/${created.sessionId}/stream?startIndex=${next}`, { signal: ctl.signal });
    const reader = res.body.getReader(); let buf = "";
    read: for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += new TextDecoder().decode(value);
      let i; while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.$eve) { if (ev.$eve === "stream.ended") ended = true; if (ev.$eve !== "heartbeat") break read; continue; }
        next += 1;
        for (const f of ev.facts ?? []) { facts.push({ at: ev.at, ...f }); if (f.type === "turn.settled") settled = f; }
        if (settled) break read;
      }
    }
    try { await reader.cancel(); } catch {}
  }
} catch (e) { infra = ctl.signal.aborted ? "timeout" : `stream: ${e.message}`; }
clearTimeout(timer);
const wallMs = Date.now() - started;
const containers = execFileSync("docker", ["ps", "-aq"], { encoding: "utf8" }).split("\n").filter((c) => c && !before.has(c));
const ws = join(outDir, "workspace");
if (containers.length) { try { execFileSync("docker", ["cp", `${containers[0]}:/workspace/.`, ws]); } catch (e) { infra = infra ?? `copy: ${e.message}`; } }
server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 1500));
for (const c of containers) { try { execFileSync("docker", ["rm", "-f", c], { stdio: "ignore" }); } catch {} }
writeFileSync(join(outDir, "events.json"), JSON.stringify(facts, null, 1));
writeFileSync(join(outDir, "server.log"), serverLog);
const types = facts.map((f) => f.type);
const usage = facts.filter((f) => f.data?.usage).reduce((u, f) => ({ input: u.input + (f.data.usage.inputTokens ?? 0), output: u.output + (f.data.usage.outputTokens ?? 0) }), { input: 0, output: 0 });
const calls = facts.filter((f) => f.type === "call.settled");
const toolErrors = calls.filter((f) => f.data?.outcome !== "completed" || (typeof f.data?.output?.exitCode === "number" && f.data.output.exitCode !== 0)).length;
const testRuns = facts.filter((f) => f.type === "call.requested" && /npm (run )?test|node --test/.test(String(f.data?.input?.command ?? ""))).length;
let grade = null;
if (existsSync(ws)) grade = JSON.parse(execFileSync(process.execPath, [join(s1, "grade.mjs"), ws, task], { encoding: "utf8" }));
const result = { harness: "H-EVE", task, model, route: direct ? "anthropic-direct" : "ai-gateway", completed: !!settled && !infra && settled.data?.outcome !== "failed", settledOutcome: settled?.data?.outcome ?? null, infra: infra ?? (settled?.data?.outcome === "failed" ? `turn failed: ${settled.data.error?.code ?? "unknown"}` : null), wallMs, usage, toolCalls: calls.length, toolErrors, testRuns, factTypes: [...new Set(types)], grade };
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exit(0);
