// S1 harness H-CC: Claude Code headless in a container, one task, one attempt. Usage:
//   MODEL=claude-sonnet-5-5 KEY_FILE=<file holding the Anthropic key> node run-cc.mjs <taskId> <outDir>
// The workspace is a copy of the fixture mounted at /workspace; Claude Code's binary is mounted read-only.
// WebFetch/WebSearch are disallowed (the task needs no network beyond the model).
import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const s1 = join(here, "..");
const [task, outDir] = process.argv.slice(2);
const model = process.env.MODEL; if (!model) throw new Error("MODEL is required");
const LIMIT_MS = 20 * 60 * 1000;
rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true });
const ws = join(outDir, "workspace");
cpSync(join(s1, "fixture"), ws, { recursive: true });
execFileSync("chown", ["-R", "1000:1000", ws]);
const prompt = `${readFileSync(join(s1, "tasks", task, "prompt.md"), "utf8").trim()}\n\nThe repository is in /workspace. Run \`npm test\` to check your work. Finish the task without asking questions, then end your turn with a short summary.`;
const name = `s1-cc-${task}-${Date.now()}`;
const proxyEnv = ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"].flatMap((k) => (process.env[k] ? ["-e", k] : []));
const args = ["run", "--rm", "--name", name, "--network", "host", "-u", "node", "-w", "/workspace",
  "-e", "ANTHROPIC_API_KEY", "-e", "ANTHROPIC_BASE_URL=https://api.anthropic.com", "-e", "NODE_EXTRA_CA_CERTS=/ca.crt", "-e", "SSL_CERT_FILE=/ca.crt",
  "-e", "HOME=/home/node", "-e", "DISABLE_AUTOUPDATER=1", "-e", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1", ...proxyEnv,
  "-v", "/root/.ccr/ca-bundle.crt:/ca.crt:ro", "-v", "/opt/claude-code:/opt/claude-code:ro", "-v", `${ws}:/workspace`,
  "node:22-bookworm-slim", "/opt/claude-code/bin/claude", "-p", prompt, "--model", model, "--permission-mode", "bypassPermissions",
  "--disallowedTools", "WebFetch", "WebSearch", "--output-format", "stream-json", "--verbose"];
const started = Date.now();
const child = spawn("docker", args, { env: { ...process.env, ANTHROPIC_API_KEY: readFileSync(process.env.KEY_FILE, "utf8").trim() }, stdio: ["ignore", "pipe", "pipe"] });
const out = createWriteStream(join(outDir, "events.ndjson")); let raw = ""; let err = "";
child.stdout.on("data", (b) => { out.write(b); raw += b; }); child.stderr.on("data", (b) => (err += b));
let infra = null;
const timer = setTimeout(() => { infra = "timeout"; try { execFileSync("docker", ["kill", name]); } catch {} }, LIMIT_MS);
const code = await new Promise((r) => child.on("exit", r)); clearTimeout(timer); out.end();
const wallMs = Date.now() - started;
const events = raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const final = events.findLast((e) => e.type === "result");
const blocks = events.filter((e) => e.type === "assistant").flatMap((e) => e.message?.content ?? []);
const toolUses = blocks.filter((b) => b.type === "tool_use");
const results = events.filter((e) => e.type === "user").flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : [])).filter((b) => b.type === "tool_result");
const testRuns = toolUses.filter((t) => t.name === "Bash" && /npm (run )?test|node --test/.test(String(t.input?.command ?? ""))).length;
if (!final && !infra) infra = `no result (exit ${code}): ${err.slice(0, 200)}`;
const usage = final?.usage ? { input: (final.usage.input_tokens ?? 0) + (final.usage.cache_creation_input_tokens ?? 0) + (final.usage.cache_read_input_tokens ?? 0), output: final.usage.output_tokens ?? 0 } : null;
const grade = JSON.parse(execFileSync(process.execPath, [join(s1, "grade.mjs"), ws, task], { encoding: "utf8" }));
const result = { harness: "H-CC", task, model, route: "anthropic-direct", completed: !!final && final.subtype === "success" && !final.is_error && !infra, settledOutcome: final?.subtype ?? null, infra, wallMs, usage, costUsd: final?.total_cost_usd ?? null, turns: final?.num_turns ?? null, toolCalls: toolUses.length, toolErrors: results.filter((r) => r.is_error).length, testRuns, grade };
writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
