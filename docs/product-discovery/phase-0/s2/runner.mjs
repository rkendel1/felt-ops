// A runner process. Claims one invocation and renews its lease until killed or done.
// Prints one JSON line per step. Usage: node runner.mjs <url> <invocationId> <worker> <reports|forever> [finish]
import { client } from "./mcp.mjs";
const [url, id, worker, count, finish] = process.argv.slice(2);
const c = client(url, process.env.RUNNER_TOKEN);
const out = (o) => console.log(JSON.stringify({ worker, pid: process.pid, at: Date.now(), ...o }));
const claimed = await c.call("work.claim", { id, worker, leaseMs: 3000 });
out({ step: "claim", result: claimed });
if (!claimed.ok || !claimed.value.proceed) process.exit(2);
const claim = claimed.value.claim;
out({ step: "claim-token-for-replay", claim });
for (let i = 1; count === "forever" || i <= Number(count); i++) {
  await new Promise((r) => setTimeout(r, 800));
  out({ step: "report", n: i, result: await c.call("work.report", { id, claim, note: `${worker} progress ${i}` }) });
}
if (finish) out({ step: "finish", result: await c.call("work.finish", { id, claim }) });
