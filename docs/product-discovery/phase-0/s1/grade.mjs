// Grade a workspace for one S1 task. Usage: node grade.mjs <workspaceDir> <taskId>  → prints JSON.
// usable = hidden grader passes AND visible suite passes AND no pre-existing visible test was deleted or skipped.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const [ws, task] = process.argv.slice(2);
const work = mkdtempSync(join(tmpdir(), `grade-${task}-`));
cpSync(ws, work, { recursive: true, filter: (p) => !p.includes("node_modules") && !p.includes("/.git/") });
const run = (args) => { try { return { ok: true, out: execFileSync(process.execPath, args, { cwd: work, encoding: "utf8", stdio: "pipe", timeout: 60000 }) }; } catch (e) { return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; } };
const count = (out, k) => Number((out.match(new RegExp(`^(?:#|ℹ) ${k} (\\d+)`, "m")) ?? [])[1] ?? NaN);
const visibleRun = existsSync(join(work, "test")) ? run(["--test"]) : { ok: false, out: "no test dir" };
cpSync(join(here, "tasks", task, "grader.test.js"), join(work, "test", "__grader__.test.js"));
const grader = run(["--test", "test/__grader__.test.js"]);
const baseNames = [...readFileSync(join(here, "fixture", "test", "basic.test.js"), "utf8").matchAll(/^test\("([^"]+)"/gm)].map((m) => m[1]);
const nowFile = existsSync(join(ws, "test", "basic.test.js")) ? readFileSync(join(ws, "test", "basic.test.js"), "utf8") : "";
const missing = baseNames.filter((n) => !nowFile.includes(`test("${n}"`));
const skipped = /\btest\.(skip|todo)\(|\{\s*skip:\s*true/.test(nowFile);
const result = { task, graderPass: grader.ok, visiblePass: visibleRun.ok, visibleTests: count(visibleRun.out, "pass"), missingVisibleTests: missing, skippedVisible: skipped };
result.usable = result.graderPass && result.visiblePass && missing.length === 0 && !skipped;
if (!grader.ok) result.graderOutput = grader.out.split("\n").filter((l) => /not ok|Error|expected|actual/.test(l)).slice(0, 12).join("\n");
console.log(JSON.stringify(result));
