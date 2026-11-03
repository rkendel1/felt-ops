/**
 * Shared domain rules. Not a function module (the leading underscore).
 */
import { fail } from "@feltdb/feltkit";
import type { MutationCtx, QueryCtx } from "@feltdb/feltkit";
import { agents, authorities, people, policies, policyVersions, timeline } from "./app.js";

export const nowIso = () => new Date().toISOString();

export interface Actor {
  /** The FeltKit principal id. */
  id: string;
  type: "person" | "agent";
  /** people._id or agents._id */
  recordId: string;
  name: string;
}

/**
 * Who is calling, as CompanyOS knows them. FeltKit has already authenticated the principal
 * and checked the function's permission. This adds what FeltKit cannot know: whether the
 * person is still employed, or the agent still active.
 *
 * WORKAROUND for G-01/G-02 (FELTKIT-GAP-REPORT): built-in accounts cannot be disabled and
 * application code cannot revoke sessions, so a departed person's or suspended agent's live
 * session would otherwise keep working. Revoking sessions (`feltkit session revoke`) is
 * still the platform step; this check closes the window in between.
 */
export async function actor(ctx: QueryCtx | MutationCtx): Promise<Actor> {
  const p = ctx.auth.requirePrincipal();
  if (p.type === "agent") {
    const [a] = await ctx.db.find(agents, { key: p.id });
    if (!a) fail("FORBIDDEN", `Agent ${p.id} is not registered in CompanyOS. Register it under Agents first.`);
    if (a.status !== "active") fail("FORBIDDEN", `Agent ${p.id} is ${a.status}${a.statusReason ? ` (${a.statusReason})` : ""}; it may not act.`);
    return { id: p.id, type: "agent", recordId: a.id, name: a.name };
  }
  const [person] = await ctx.db.find(people, { login: p.id });
  if (!person) fail("FORBIDDEN", `${p.id} is not linked to an employee record.`);
  if (person.status === "departed") fail("FORBIDDEN", `${person.name} left the company on ${person.leftOn}; access is revoked.`);
  return { id: p.id, type: "person", recordId: person.id, name: person.name };
}

export async function requirePerson(ctx: QueryCtx | MutationCtx, why: string): Promise<Actor> {
  const a = await actor(ctx);
  if (a.type !== "person") fail("FORBIDDEN", `Only a person may ${why}. Agents propose; people decide.`);
  return a;
}

/** Append to a subject's history, in this mutation's transaction. */
export async function record(
  ctx: MutationCtx,
  subject: string,
  who: Actor | { id: string; type: string },
  kind: string,
  summary: string,
  options: { source?: "platform" | "assertion" | "verification" | "operator"; data?: Record<string, unknown> } = {},
) {
  const seq = await ctx.db.sequence(`timeline:${subject}`);
  await ctx.db.insert(timeline, {
    subject, seq, at: nowIso(), actorId: who.id, actorType: who.type,
    source: options.source ?? "platform", kind, summary, ...(options.data ? { data: options.data } : {}),
  });
}

export async function nextNumber(ctx: MutationCtx, prefix: string) {
  const n = await ctx.db.sequence(`number:${prefix}`);
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

/** The approved version of a policy in force at `at` (latest effectiveFrom ≤ at). */
export async function effectiveVersion(ctx: QueryCtx | MutationCtx, key: string, at: string) {
  const [policy] = await ctx.db.find(policies, { key });
  if (!policy) fail("FAILED_PRECONDITION", `Policy ${key} is not defined.`);
  const versions = await ctx.db.find(policyVersions, { policyId: policy.id, status: "approved" });
  // In force: approved, effective, and approved by then (an approval is never retroactive).
  const inForce = versions.filter((v) => v.effectiveFrom <= at && (v.decidedAt ?? "") <= at).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : b.version - a.version))[0];
  if (!inForce) fail("FAILED_PRECONDITION", `No approved version of ${key} is in force at ${at}.`);
  return { policy, version: inForce };
}

export interface Tier { upTo: number | null; steps: Array<{ kind: string; label: string; scope?: "department" }> }

/** Approval steps a purchase of `amount` needs under a purchasing policy version. */
export function stepsFor(rules: Record<string, unknown>, amount: number, departmentId: string) {
  const tiers = rules.tiers as Tier[] | undefined;
  if (!Array.isArray(tiers) || tiers.length === 0) fail("FAILED_PRECONDITION", "The purchasing policy has no tiers.");
  const tier = tiers.find((t) => t.upTo === null || amount <= t.upTo);
  if (!tier) fail("FAILED_PRECONDITION", `No purchasing tier covers ${amount}.`);
  return tier.steps.map((s) => ({ kind: s.kind, label: s.label, ...(s.scope === "department" ? { departmentId } : {}) }));
}

/** Validate a purchasing rule set before it can be proposed. */
export function validatePurchasingRules(rules: Record<string, unknown>) {
  const tiers = rules.tiers as Tier[] | undefined;
  if (!Array.isArray(tiers) || tiers.length === 0) fail("INVALID_ARGUMENT", "rules.tiers must be a non-empty array.");
  let last = 0;
  tiers.forEach((t, i) => {
    const final = i === tiers.length - 1;
    if (final ? t.upTo !== null : typeof t.upTo !== "number" || t.upTo <= last) fail("INVALID_ARGUMENT", `Tier ${i + 1}: upTo must increase, and only the last tier is open-ended (null).`);
    if (typeof t.upTo === "number") last = t.upTo;
    if (!Array.isArray(t.steps) || t.steps.length === 0) fail("INVALID_ARGUMENT", `Tier ${i + 1} needs at least one approval step.`);
  });
}

/**
 * Does `holderId` hold an active grant of `kind` covering `amount` (and `departmentId`, when
 * the grant is department-scoped)? Returns the grant, or null.
 */
export async function grantFor(ctx: QueryCtx | MutationCtx, holderId: string, kind: string, amount?: number, departmentId?: string) {
  const grants = await ctx.db.find(authorities, { holderId, kind, status: "active" });
  return grants.find((g) => (g.limit === undefined || amount === undefined || amount <= g.limit) && (!g.departmentId || !departmentId || g.departmentId === departmentId)) ?? null;
}

export function money(n: number) {
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
