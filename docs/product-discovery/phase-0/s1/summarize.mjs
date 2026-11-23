// Apply PROTOCOL S1's fixed rule to result.json files. Usage: node summarize.mjs <eveDir> <ccDir> [out.json]
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [eveDir, ccDir, outFile] = process.argv.slice(2);
const tasks = ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10"];
const load = (dir, t) => { const f = join(dir, t, "result.json"); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { task: t, missing: true }; };
const rows = tasks.map((t) => ({ task: t, eve: load(eveDir, t), cc: load(ccDir, t) }));
const usable = (r) => !r.missing && r.grade?.usable === true;
const E = rows.filter((r) => usable(r.eve)).length, C = rows.filter((r) => usable(r.cc)).length;
const verdict = E >= 7 && E >= C - 2 ? "PASS" : E <= 5 || E < C - 3 ? "FAIL" : "INCONCLUSIVE";
const agg = (h) => { const rs = rows.map((r) => r[h]).filter((r) => !r.missing); const sum = (f) => rs.reduce((a, r) => a + (f(r) ?? 0), 0);
  const walls = rs.map((r) => r.wallMs).sort((a, b) => a - b);
  return { usable: rows.filter((r) => usable(r[h])).length, completed: rs.filter((r) => r.completed).length, infraFailures: rs.filter((r) => r.infra).map((r) => `${r.task}: ${r.infra}`), medianWallS: Math.round(walls[Math.floor(walls.length / 2)] / 1000), totalInputTokens: sum((r) => r.usage?.input), totalOutputTokens: sum((r) => r.usage?.output), toolCalls: sum((r) => r.toolCalls), toolErrors: sum((r) => r.toolErrors), testRuns: sum((r) => r.testRuns), costUsd: h === "cc" ? Number(sum((r) => r.costUsd).toFixed(2)) : null }; };
const summary = { rule: "PASS: EVE usable >= 7 and >= CC-2; FAIL: EVE <= 5 or < CC-3; else INCONCLUSIVE", eveUsable: E, ccUsable: C, verdict, eve: agg("eve"), cc: agg("cc"),
  perTask: rows.map((r) => ({ task: r.task, eve: { usable: usable(r.eve), completed: r.eve.completed, infra: r.eve.infra ?? null, wallS: Math.round((r.eve.wallMs ?? 0) / 1000), tools: r.eve.toolCalls, toolErrors: r.eve.toolErrors, tests: r.eve.testRuns, grader: r.eve.grade?.graderPass, visible: r.eve.grade?.visiblePass, missingVisible: r.eve.grade?.missingVisibleTests },
                                                    cc: { usable: usable(r.cc), completed: r.cc.completed, infra: r.cc.infra ?? null, wallS: Math.round((r.cc.wallMs ?? 0) / 1000), tools: r.cc.toolCalls, toolErrors: r.cc.toolErrors, tests: r.cc.testRuns, grader: r.cc.grade?.graderPass, visible: r.cc.grade?.visiblePass, missingVisible: r.cc.grade?.missingVisibleTests } })) };
if (outFile) writeFileSync(outFile, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ verdict, eveUsable: E, ccUsable: C, eve: summary.eve, cc: summary.cc }, null, 1));
