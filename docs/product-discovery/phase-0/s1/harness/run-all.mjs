// Run every S1 task with one harness, LANES tasks at a time. Usage:
//   HARNESS=eve|cc OUT=<dir> LANES=2 node run-all.mjs   (other env as run-eve.mjs / run-cc.mjs)
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const tasks = ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10"];
const harness = process.env.HARNESS; const out = process.env.OUT; const lanes = Number(process.env.LANES ?? 2);
let i = 0; let portBase = Number(process.env.PORT_BASE ?? 2200);
async function lane(n) {
  while (i < tasks.length) {
    const t = tasks[i++];
    const args = harness === "eve" ? ["run-eve.mjs", t, join(out, t), "--port", String(portBase + n)] : ["run-cc.mjs", t, join(out, t)];
    await new Promise((r) => { const p = spawn(process.execPath, args, { cwd: here, stdio: ["ignore", "inherit", "inherit"] }); p.on("exit", r); });
  }
}
await Promise.all(Array.from({ length: lanes }, (_, n) => lane(n)));
console.log("ALL DONE", harness);
