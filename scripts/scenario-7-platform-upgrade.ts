/**
 * Scenario 7 — Platform upgrade (platform → application → production).
 *
 *   npx tsx scripts/scenario-7-platform-upgrade.ts
 *
 * 1. Discovery: installed vs published versions (npm registry).
 * 2. Old platform: FeltKit 0.3.12 + FeltDB 0.20.0 installed from npm into a scratch
 *    directory with this repository's feltkit/ source; production activity on a FeltDB
 *    state directory; the platform change and its data baseline recorded in CompanyOS.
 * 3. Assessment and test: this repository's test suite on the new platform (FeltKit 0.3.13
 *    + FeltDB 0.21.0), recorded as test-run evidence.
 * 4. Upgrade: the same state directory opened by the new platform (what `feltkit start`
 *    does on deploy: schema checked and installed at start). Approval, release, data
 *    verification computed by CompanyOS.
 *
 * Writes evidence/scenario-7.json. Exits non-zero if any step fails.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestApp } from "@feltdb/feltkit/testing";
import { api } from "../feltkit/_generated/api.js";

const root = process.cwd();
const out: Record<string, unknown> = { startedAt: new Date().toISOString() };
const npmView = (spec: string) => execFileSync("npm", ["view", spec, "version"], { encoding: "utf8" }).trim();
/** The version Node resolves: FeltKit's own nested copy first, then the top level. */
function installed(p: string, dir = root): string {
  for (const base of [join(dir, "node_modules/@feltdb/feltkit/node_modules"), join(dir, "node_modules")]) {
    try { return JSON.parse(readFileSync(join(base, p, "package.json"), "utf8")).version as string; } catch { /* next */ }
  }
  return "not installed";
}

// 1. Discovery
const discovery = ["@feltdb/feltkit", "@feltdb/core", "@appport/sdk", "@appport/services"].map((p) => ({ package: p, installed: installed(p), latest: npmView(p) }));
out.discovery = discovery;
console.log("discovery", discovery);

// 2. Old platform
const old = mkdtempSync(join(tmpdir(), "companyos-old-platform-"));
const state = mkdtempSync(join(tmpdir(), "companyos-prod-state-"));
try {
  cpSync(join(root, "feltkit"), join(old, "feltkit"), { recursive: true });
  cpSync(join(root, "tsconfig.json"), join(old, "tsconfig.json"));
  cpSync(join(root, "scripts/_platform-old-phase.ts"), join(old, "old-phase.ts"));
  writeFileSync(join(old, "package.json"), JSON.stringify({ name: "companyos", version: "0.1.0", private: true, type: "module", dependencies: { "@feltdb/feltkit": "0.3.12", tsx: "4.20.6" }, overrides: { "@feltdb/core": "0.20.0" } }, null, 2));
  const install = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: old, encoding: "utf8" });
  if (install.status !== 0) throw new Error(`old platform install failed: ${install.stderr}`);
  const oldPhase = spawnSync("node", ["--import", "tsx", "old-phase.ts", state], { cwd: old, encoding: "utf8", env: { ...process.env, FELTKIT_ENV: "test" } });
  const line = oldPhase.stdout.trim().split("\n").filter((l) => l.startsWith("{")).at(-1);
  if (!line) throw new Error(`old phase produced no result: ${oldPhase.stderr.slice(-2000)}`);
  const oldResult = JSON.parse(line) as { ok: boolean; loaded: Record<string, string>; changeId: string; number: string; fingerprint: unknown; steps: string[]; error?: unknown };
  out.oldPlatform = oldResult;
  console.log("old platform", oldResult.loaded, oldResult.steps, oldResult.ok ? "" : oldResult.error);
  if (!oldResult.ok) throw new Error("CompanyOS did not run on the old platform");

  // 3. Test on the new platform
  const tests = spawnSync("npx", ["feltkit", "test"], { cwd: root, encoding: "utf8" });
  const count = (k: string) => Number(tests.stdout.match(new RegExp(`^# ${k} (\\d+)`, "m"))?.[1] ?? NaN);
  const testRun = { exit: tests.status, pass: count("pass"), fail: count("fail"), platform: { feltkit: installed("@feltdb/feltkit"), core: installed("@feltdb/core") } };
  out.testRun = testRun;
  console.log("tests on new platform", testRun);

  // 4. Upgrade: the new platform opens the old platform's production state.
  const t = await createTestApp({ storage: { kind: "local", path: state } });
  try {
    const schema = t.runtime.schema;
    out.schemaAtStart = { status: schema?.status, applied: schema?.applied ?? null };
    const changeId = oldResult.changeId;
    const eli = t.as("eli");
    await eli.mutation(api.changes.advance, { changeId, to: "assessed", note: `FeltKit pins @appport/sdk ${discovery.find((d) => d.package === "@appport/sdk")!.installed}; FeltDB 0.21.0 required by 0.3.13. No schema change in CompanyOS.` });
    await eli.mutation(api.changes.recordEvidence, { changeId, system: "npm", kind: "test-run", ref: `feltkit ${testRun.platform.feltkit}`, status: testRun.exit === 0 && testRun.fail === 0 ? "passed" : "failed", detail: testRun });
    await eli.mutation(api.changes.advance, { changeId, to: testRun.exit === 0 && testRun.fail === 0 ? "tested" : "test-failed" });
    await t.as("omar").mutation(api.changes.advance, { changeId, to: "approved", note: "Approved for production." });
    const releaseId = await eli.mutation(api.changes.createRelease, { version: "platform-0.3.13", commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), changeIds: [changeId] });
    await t.as("omar").mutation(api.changes.approveRelease, { releaseId });
    await eli.mutation(api.changes.recordDeployment, { releaseId, target: "local-production", receipt: { opened: "production state directory", by: `feltkit ${testRun.platform.feltkit}`, schema: schema?.status ?? null } });
    await eli.mutation(api.changes.advance, { changeId, to: "deployed" });
    const data = await eli.mutation(api.reports.verifyData, { changeId });
    out.dataVerification = data;
    if (data.passed) await eli.mutation(api.changes.advance, { changeId, to: "verified" });
    // Business capabilities still work on upgraded data.
    const rec = await t.as("fiona").query(api.purchasing.reconciliation);
    const pol = await t.as("fiona").query(api.policies.effective, { key: "purchasing.approval" });
    out.capabilitiesAfter = { reconciliationDuplicates: rec.duplicates.length, openCommitments: rec.openCommitments, policyVersion: pol.version };
    const detail = await eli.query(api.changes.detail, { changeId });
    out.change = { number: detail.change.number, status: detail.change.status, platform: detail.change.platform };
    out.history = detail.history.map((h) => ({ at: h.at, actor: h.actorId, source: h.source, kind: h.kind, summary: h.summary }));
    out.ok = data.passed && detail.change.status === "verified";
  } finally {
    await t.close();
  }
} catch (e) {
  out.ok = false;
  out.error = (e as Error).message;
} finally {
  rmSync(old, { recursive: true, force: true });
  rmSync(state, { recursive: true, force: true });
  mkdirSync(join(root, "evidence"), { recursive: true });
  writeFileSync(join(root, "evidence/scenario-7.json"), JSON.stringify({ recordedAt: new Date().toISOString(), ...out }, null, 2) + "\n");
  console.log(out.ok ? "SCENARIO 7: PASSED" : `SCENARIO 7: FAILED ${out.error ?? ""}`);
  process.exitCode = out.ok ? 0 : 1;
}
