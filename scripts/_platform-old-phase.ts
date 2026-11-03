/**
 * Scenario 7, old platform phase. Copied into a directory where FeltKit 0.3.12 and
 * FeltDB 0.20.0 are installed, and run there: production activity on the old platform,
 * then the platform change is recorded and the data baseline captured by CompanyOS itself.
 * Prints one JSON line.
 */
import { readFileSync } from "node:fs";
import { createTestApp } from "@feltdb/feltkit/testing";
import { api } from "./feltkit/_generated/api.js";

const storage = { kind: "local" as const, path: process.argv[2]! };
const version = (p: string) => {
  for (const base of ["node_modules/@feltdb/feltkit/node_modules", "node_modules"]) {
    try { return JSON.parse(readFileSync(`${base}/${p}/package.json`, "utf8")).version as string; } catch { /* next */ }
  }
  return "not installed";
};
const loaded = { feltkit: version("@feltdb/feltkit"), core: version("@feltdb/core") };

const t = await createTestApp({ storage });
const steps: string[] = [];
try {
  await t.as("ivy").mutation(api.seed.seed);
  steps.push("seeded");
  const supplierId = (await t.as("pablo").query(api.purchasing.listSuppliers)).find((s) => s.name === "Contoso Cloud")!.id;
  const req = await t.as("otto").mutation(api.purchasing.submitRequest, { supplierId, amount: 7_300, description: "Reserved capacity" });
  await t.as("priya").mutation(api.purchasing.decideRequest, { requestId: req.id, decision: "approved" });
  await t.as("fiona").mutation(api.purchasing.decideRequest, { requestId: req.id, decision: "approved" });
  steps.push(`purchase ${req.number} approved and ordered`);
  const change = await t.as("eli").mutation(api.changes.request, {
    kind: "platform", title: "Upgrade FeltKit 0.3.12 → 0.3.13 (FeltDB 0.20.0 → 0.21.0)", problem: "FeltKit 0.3.13 requires FeltDB >= 0.21.0 and fixes large-state paging and backup (per its docs).",
    businessOwnerId: (await t.as("maria").query(api.org.me)).person!.id, platform: { package: "@feltdb/feltkit", from: loaded.feltkit, to: "0.3.13" },
  });
  await t.as("eli").mutation(api.reports.captureBaseline, { changeId: change.id });
  steps.push(`change ${change.number} recorded; baseline captured`);
  const fingerprint = await t.as("eli").query(api.reports.dataFingerprint);
  console.log(JSON.stringify({ ok: true, loaded, steps, changeId: change.id, number: change.number, fingerprint }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, loaded, steps, error: { code: (e as { code?: string }).code, message: (e as Error).message } }));
} finally {
  await t.close();
}
