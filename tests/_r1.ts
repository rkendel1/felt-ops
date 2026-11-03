/**
 * Produce a FeltDB state directory in which release R1 (the defective invoice processing)
 * has created `count` duplicate commitments. Runs R1's actual source from git history.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestApp } from "@feltdb/feltkit/testing";
import { api } from "../feltkit/_generated/api.js";

export async function stateWithR1Duplicates(count: number) {
  const sha = execFileSync("git", ["log", "--format=%H", "--grep", "^CompanyOS R1:", "-n", "1"], { encoding: "utf8" }).trim();
  if (!sha) throw new Error("R1 commit not found in history (CI needs fetch-depth: 0)");
  const dir = mkdtempSync(join(tmpdir(), "companyos-r1-"));
  execFileSync("sh", ["-c", `git archive ${sha} | tar -x -C ${dir}`]);
  symlinkSync(join(process.cwd(), "node_modules"), join(dir, "node_modules"));
  const state = mkdtempSync(join(tmpdir(), "companyos-state-"));
  const storage = { kind: "local" as const, path: state };
  const a = await createTestApp({ projectDir: dir, storage });
  try {
    await a.as("ivy").mutation(api.seed.seed);
    const northwind = (await a.as("pablo").query(api.purchasing.listSuppliers)).find((s) => s.name === "Northwind Components")!.id;
    await a.as("otto").mutation(api.agents.assign, { agentKey: "agent-sentry", title: "Daily Northwind invoice sync", objective: "Import new Northwind invoices from the supplier feed.", context: "", constraints: [], expectedOutput: "Invoices imported.", permittedCapabilities: ["invoices.ingest"], approvalRequired: false, verifier: "supplier-link-healthy" });
    const rows = [];
    for (let i = 0; i < count; i += 1) {
      const amount = 1_000 + i * 250;
      const req = await a.as("rhea").mutation(api.purchasing.submitRequest, { supplierId: northwind, amount, description: `Batch ${i + 1}` });
      await a.as("maria").mutation(api.purchasing.decideRequest, { requestId: req.id, decision: "approved" });
      const po = (await a.as("rhea").query(api.purchasing.listOrders)).find((p) => p.requestId === req.id)!.number;
      await a.as("rhea").mutation(api.purchasing.enterInvoice, { supplierId: northwind, poNumber: po, number: `NW-9${100 + i}`, amount });
      rows.push({ externalId: `nw-del-${9100 + i}`, number: `nw9${100 + i}`, poNumber: po, amount, issuedAt: "2026-11-02T08:00:00.000Z" });
    }
    await a.as("agent-sentry").mutation(api.purchasing.ingestInvoices, { supplierId: northwind, rows });
    const rec = await a.as("fiona").query(api.purchasing.reconciliation);
    if (rec.duplicates.length !== count) throw new Error(`expected ${count} duplicates from R1, got ${rec.duplicates.length}`);
    return { sha, storage, duplicates: rec.duplicates, cleanup: () => { rmSync(dir, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }); } };
  } finally {
    await a.close();
  }
}
