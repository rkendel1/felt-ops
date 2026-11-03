/**
 * Agent authority scoping shared by function modules. Not a function module.
 */
import { fail } from "@feltdb/feltkit";
import type { MutationCtx, QueryCtx } from "@feltdb/feltkit";
import { app, assignments } from "./app.js";
import type { Actor } from "./_lib.js";

export const ACTIVE = ["assigned", "accepted", "running", "waiting-approval", "waiting-intervention", "recovering"];

/** Permissions a set of roles grants, from the application's own role table. */
export function permissionsOf(roles: string[]) {
  const table = app.options.roles ?? {};
  return [...new Set(roles.flatMap((r) => table[r] ?? []))].sort();
}
export function grants(perms: string[], wanted: string) {
  return perms.some((p) => p === wanted || p === "*" || (p.endsWith(".*") && wanted.startsWith(p.slice(0, -1))));
}

/** Capability name → the permission it needs (CompanyOS capabilities agents use). */
export const CAPABILITY_PERMISSION: Record<string, string> = {
  "commitments.reverse": "commitments.reverse",
  "finance.reconciliation": "commitments.read",
  "commitments.list": "commitments.read",
  "invoices.list": "invoices.read",
  "invoices.ingest": "invoices.ingest",
  "integrations.isolate": "integrations.report",
  "integrations.link": "integrations.read",
  "supplierapi.invoicesv1": "supplierapi.read",
  "supplierapi.invoicesv2": "supplierapi.read",
  "incidents.open": "incidents.report",
  "incidents.note": "incidents.note",
  "incidents.list": "incidents.read",
  "org.depart": "org.access",
  "org.responsibilities": "org.read",
  "org.people": "org.read",
  "changes.evidence": "changes.evidence",
  "github.commit": "github.read",
  "github.runs": "github.read",
  "github.pulls": "github.read",
};

/**
 * Operator narrowing, enforced where CompanyOS executes: an agent may use a CompanyOS
 * capability only under an active assignment that permits it. WORKAROUND for G-04 (FeltKit
 * sessions carry roles, not per-task scopes). Integration operations (supplierapi.*,
 * github.*) run in FeltKit before any CompanyOS code, so only roles bound them.
 */
export async function withinAssignment(ctx: QueryCtx | MutationCtx, who: Actor, capability: string) {
  if (who.type !== "agent") return null;
  const mine = await ctx.db.find(assignments, { agentKey: who.id });
  const permitting = mine.find((a) => ACTIVE.includes(a.status) && a.permittedCapabilities.includes(capability));
  if (!permitting) {
    const suspended = mine.find((a) => a.status === "suspended" && a.permittedCapabilities.includes(capability));
    fail("FORBIDDEN", suspended
      ? `Assignment ${suspended.number} is suspended by an operator; ${capability} may not run under it.`
      : `${who.id} has no active assignment that permits ${capability}. An operator must assign the work first.`);
  }
  return permitting;
}

