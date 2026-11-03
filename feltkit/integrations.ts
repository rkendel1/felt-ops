/**
 * External systems, connected with app.integration: each operation is an AppPort capability
 * with its own permission, and every call is recorded by FeltKit. CompanyOS learns what a
 * call returned only through `onOutcome` (application code cannot read the call records).
 */
import { fail, s } from "@feltdb/feltkit";
import { app, externalRefs, invoices, supplierLinks, suppliers, timeline } from "./app.js";
import { processInvoice } from "./_invoicing.js";
import { withinAssignment } from "./_scope.js";
import { actor, nowIso, record, requirePerson } from "./_lib.js";

// ───────────── Supplier invoice API (Northwind Components' feed) ─────────────

const V1Invoice = s.object({ deliveryId: s.string(), invoiceNumber: s.string(), po: s.optional(s.string()), total: s.number(), issued: s.string() });
const V2Invoice = s.object({ id: s.string(), number: s.string(), purchaseOrder: s.optional(s.string()), amount: s.object({ value: s.number(), currency: s.string() }), issuedAt: s.string() });

export const supplierapi = app.integration("supplierapi", {
  description: "Northwind Components' invoice feed.",
  baseUrl: { env: "SUPPLIER_API_URL", development: "http://127.0.0.1:4010" },
  timeoutMs: 5000,
  health: { path: "/health" },
  operations: {
    invoicesv1: {
      method: "GET", path: "/v1/invoices", description: "Invoices issued after `since` (API v1).",
      input: { since: s.string(), supplierId: s.string() },
      output: s.object({ invoices: s.array(V1Invoice) }),
      effect: "observation", access: "supplierapi.read", onOutcome: "integrations:onSupplierCall",
    },
    invoicesv2: {
      method: "GET", path: "/v2/accounts/{account}/invoices", description: "Invoices issued after `updatedAfter` (API v2).",
      input: { account: s.string(), updatedAfter: s.string(), supplierId: s.string() },
      output: s.object({ data: s.array(V2Invoice), next: s.nullable(s.string()) }),
      effect: "observation", access: "supplierapi.read", onOutcome: "integrations:onSupplierCall",
    },
  },
});

/**
 * What onOutcome receives (FeltKit 0.3.13): id, capability, state, determinedBy, status,
 * input, output, error, idempotencyKey. There is no `operation` field (finding F-019).
 */
type CallRecord = { id: string; state: string; capability: string; operation: string; input: Record<string, unknown>; output?: unknown; error?: { code: string; message: string }; determinedBy?: string };

/**
 * Runs as the caller when a supplier call finishes. Records the link's health and imports
 * what a successful call returned. Idempotent: import is keyed by the feed's delivery id.
 */
export const onSupplierCall = app.mutation({
  access: "supplierapi.read",
  args: { call: s.record(s.unknown()) },
  handler: async (ctx, { call: raw }) => {
    const who = await actor(ctx);
    const call = { ...(raw as unknown as CallRecord) };
    call.operation = String(call.capability ?? "").split(".").slice(1).join(".");
    await withinAssignment(ctx, who, call.capability);
    const supplierId = String(call.input.supplierId ?? "");
    const [link] = await ctx.db.find(supplierLinks, { supplierId });
    if (!link) return { recorded: false, reason: "no link" };
    const at = nowIso();
    if (call.state !== "succeeded") {
      const failure = { at, code: call.error?.code ?? call.state, message: call.error?.message ?? `Call ${call.state}`, callId: call.id };
      if (link.lastFailure?.callId === call.id) return { recorded: false, reason: "already recorded" };
      await ctx.db.patch(supplierLinks, link.id, { status: link.status === "isolated" ? "isolated" : "failing", lastFailure: failure });
      await record(ctx, `supplier-link:${link.id}`, who, "call.failed", `${call.operation} failed: ${failure.code} ${failure.message}`, { data: { callId: call.id } });
      return { recorded: true, state: "failing" };
    }
    const expected = link.apiVersion === "v1" ? "invoicesv1" : "invoicesv2";
    if (link.status === "isolated" || call.operation !== expected) {
      await record(ctx, `supplier-link:${link.id}`, who, "call.validated", `${call.operation} answered (link ${link.status}, active version ${link.apiVersion}); nothing imported.`, { source: "verification", data: { callId: call.id, rows: rowsOf(call).length } });
      return { recorded: true, imported: 0 };
    }
    const rows = rowsOf(call);
    let imported = 0;
    for (const row of rows) {
      const [seen] = await ctx.db.find(invoices, { externalId: row.externalId });
      if (seen) continue;
      await processInvoice(ctx, who, { supplierId, number: row.number, amount: row.amount, channel: "supplier-feed", externalId: row.externalId, ...(row.poNumber ? { poNumber: row.poNumber } : {}) });
      imported += 1;
    }
    const through = rows.reduce((m, r) => (r.issuedAt > m ? r.issuedAt : m), link.syncedThrough);
    await ctx.db.patch(supplierLinks, link.id, { status: "healthy", lastSuccessAt: at, syncedThrough: through });
    await record(ctx, `supplier-link:${link.id}`, who, "sync.succeeded", `${call.operation}: ${rows.length} row(s), ${imported} imported; synced through ${through}.`, { data: { callId: call.id } });
    return { recorded: true, imported };
  },
});

function rowsOf(call: CallRecord) {
  const out = (call.output ?? {}) as { invoices?: Array<Record<string, unknown>>; data?: Array<Record<string, unknown>> };
  if (Array.isArray(out.invoices)) return out.invoices.map((r) => ({ externalId: String(r.deliveryId), number: String(r.invoiceNumber), poNumber: r.po as string | undefined, amount: Number(r.total), issuedAt: String(r.issued) }));
  if (Array.isArray(out.data)) return out.data.map((r) => ({ externalId: String(r.id), number: String(r.number), poNumber: r.purchaseOrder as string | undefined, amount: Number((r.amount as { value: number }).value), issuedAt: String(r.issuedAt) }));
  return [];
}

export const links = app.query({
  access: "integrations.read",
  handler: async (ctx) => {
    await actor(ctx);
    const rows = await ctx.db.find(supplierLinks, {});
    return Promise.all(rows.map(async (l) => ({ ...l, supplier: (await ctx.db.get(suppliers, l.supplierId))?.name ?? "?", history: (await ctx.db.find(timeline, { subject: `supplier-link:${l.id}` }, { orderBy: [{ field: "seq", direction: "desc" }], limit: 10 })) })));
  },
});

export const linkStatus = app.query({
  access: "integrations.read",
  args: { supplierId: s.string() },
  returns: s.doc(supplierLinks),
  capability: { name: "integrations.link", description: "A supplier integration link: API version, health, sync watermark, last failure." },
  handler: async (ctx, { supplierId }) => {
    await actor(ctx);
    const [link] = await ctx.db.find(supplierLinks, { supplierId });
    if (!link) fail("NOT_FOUND", `No integration link for supplier ${supplierId}.`);
    return link;
  },
});

/** Stop importing from a failing link. The watermark stays where the last good sync left it. */
export const isolate = app.mutation({
  access: "integrations.report",
  args: { supplierId: s.string(), reason: s.string({ minLength: 5 }), incidentId: s.optional(s.string()) },
  returns: s.doc(supplierLinks),
  capability: { name: "integrations.isolate", description: "Isolate a failing supplier link: nothing is imported from it until it is restored." },
  handler: async (ctx, { supplierId, reason, incidentId }) => {
    const who = await actor(ctx);
    await withinAssignment(ctx, who, "integrations.isolate");
    const [link] = await ctx.db.find(supplierLinks, { supplierId });
    if (!link) fail("NOT_FOUND", `No link for ${supplierId}.`);
    if (link.status !== "isolated") {
      await ctx.db.patch(supplierLinks, link.id, { status: "isolated", isolatedBy: who.id });
      await record(ctx, `supplier-link:${link.id}`, who, "link.isolated", `Isolated: ${reason}. Watermark held at ${link.syncedThrough}.`, { data: { incidentId: incidentId ?? null } });
      if (incidentId) await record(ctx, `incident:${incidentId}`, who, "containment", `Supplier link isolated (${reason}).`);
    }
    return (await ctx.db.get(supplierLinks, link.id))!;
  },
});

/**
 * Put a link back in service on an API version. Restoring requires a successful validation
 * call on that version after the isolation (recorded by onSupplierCall), so a person cannot
 * restore a link nobody has shown to work.
 */
export const restore = app.mutation({
  access: "integrations.write",
  args: { supplierId: s.string(), apiVersion: s.enum(["v1", "v2"]), changeId: s.optional(s.string()) },
  handler: async (ctx, { supplierId, apiVersion, changeId }) => {
    const who = await requirePerson(ctx, "restore an integration link");
    const [link] = await ctx.db.find(supplierLinks, { supplierId });
    if (!link) fail("NOT_FOUND", `No link for ${supplierId}.`);
    const history = await ctx.db.find(timeline, { subject: `supplier-link:${link.id}` }, { orderBy: [{ field: "seq", direction: "asc" }] });
    const isolatedAt = [...history].reverse().find((h) => h.kind === "link.isolated")?.seq ?? 0;
    const validated = history.find((h) => h.seq > isolatedAt && h.kind === "call.validated" && String(h.summary).startsWith(`invoices${apiVersion}`));
    if (!validated) fail("FAILED_PRECONDITION", `No successful ${apiVersion} call has been recorded since the link was isolated. Validate the replacement first (supplierapi.invoices${apiVersion}).`);
    await ctx.db.patch(supplierLinks, link.id, { status: "healthy", apiVersion });
    await record(ctx, `supplier-link:${link.id}`, who, "link.restored", `Restored on ${apiVersion} (validated by call ${(validated.data as { callId?: string } | undefined)?.callId ?? "?"})${changeId ? `, change ${changeId}` : ""}. Missed invoices since ${link.syncedThrough} will be imported by the next sync.`);
    return link.id;
  },
});

// ───────────── GitHub (pull requests, commits, Actions runs) ─────────────

export const github = app.integration("github", {
  description: "GitHub REST API: the source of truth for commits, pull requests and Actions runs.",
  baseUrl: { env: "GITHUB_API_URL", development: "https://api.github.com" },
  timeoutMs: 15000,
  operations: {
    commit: {
      method: "GET", path: "/repos/{owner}/{repo}/commits/{sha}", description: "A commit.",
      input: { owner: s.string(), repo: s.string(), sha: s.string(), subject: s.string() },
      output: s.record(s.unknown()), effect: "observation", access: "github.read", onOutcome: "integrations:onGithubCall",
    },
    runs: {
      method: "GET", path: "/repos/{owner}/{repo}/actions/runs", description: "GitHub Actions runs for a commit.",
      input: { owner: s.string(), repo: s.string(), head_sha: s.string(), per_page: s.optional(s.number()), subject: s.string() },
      output: s.record(s.unknown()), effect: "observation", access: "github.read", onOutcome: "integrations:onGithubCall",
    },
    pulls: {
      method: "GET", path: "/repos/{owner}/{repo}/pulls", description: "Pull requests (state open|closed|all).",
      input: { owner: s.string(), repo: s.string(), state: s.optional(s.string()), per_page: s.optional(s.number()), subject: s.string() },
      output: s.unknown(), effect: "observation", access: "github.read", onOutcome: "integrations:onGithubCall",
    },
  },
});

/**
 * Records what GitHub answered as an externalRef on the subject (e.g. "change:<id>").
 * `subject` travels in the operation's input because onOutcome receives only the call
 * record (it is sent to GitHub as an ignored query parameter; finding F-021).
 */
export const onGithubCall = app.mutation({
  access: "github.read",
  args: { call: s.record(s.unknown()) },
  handler: async (ctx, { call: raw }) => {
    const who = await actor(ctx);
    const call = { ...(raw as unknown as CallRecord) };
    call.operation = String(call.capability ?? "").split(".").slice(1).join(".");
    await withinAssignment(ctx, who, call.capability);
    const subject = String(call.input.subject ?? "");
    if (!subject) return { recorded: 0 };
    const prior = await ctx.db.find(externalRefs, { subject, observedVia: `integration:${call.id}` });
    if (prior.length) return { recorded: 0 };
    const at = nowIso();
    const base = { subject, observedAt: at, observedBy: who.id, observedVia: `integration:${call.id}` };
    if (call.state !== "succeeded") {
      await ctx.db.insert(externalRefs, { ...base, system: "github", kind: `${call.operation}.error`, ref: String(call.input.sha ?? call.input.head_sha ?? ""), status: call.error?.code ?? call.state });
      return { recorded: 1 };
    }
    const out = call.output as Record<string, unknown>;
    let n = 0;
    if (call.operation === "commit") {
      const commit = out.commit as { message?: string; author?: { date?: string } } | undefined;
      await ctx.db.insert(externalRefs, { ...base, system: "github", kind: "commit", ref: String(out.sha), url: String(out.html_url ?? ""), status: "exists", detail: { message: commit?.message?.split("\n")[0] ?? "", date: commit?.author?.date ?? "" } });
      n = 1;
    } else if (call.operation === "runs") {
      for (const run of ((out.workflow_runs ?? []) as Array<Record<string, unknown>>).slice(0, 10)) {
        await ctx.db.insert(externalRefs, { ...base, system: "github-actions", kind: "workflow-run", ref: String(run.id), url: String(run.html_url ?? ""), status: `${run.status}${run.conclusion ? `/${run.conclusion}` : ""}`, detail: { name: String(run.name ?? ""), head_sha: String(run.head_sha ?? ""), event: String(run.event ?? ""), created_at: String(run.created_at ?? "") } });
        n += 1;
      }
      if (n === 0) await ctx.db.insert(externalRefs, { ...base, system: "github-actions", kind: "workflow-run", ref: String(call.input.head_sha), status: "none-found" });
    } else if (call.operation === "pulls") {
      for (const pr of (Array.isArray(out) ? out : []).slice(0, 10) as Array<Record<string, unknown>>) {
        await ctx.db.insert(externalRefs, { ...base, system: "github", kind: "pull-request", ref: String(pr.number), url: String(pr.html_url ?? ""), status: String(pr.state ?? ""), detail: { title: String(pr.title ?? ""), head: String((pr.head as { ref?: string })?.ref ?? "") } });
        n += 1;
      }
    }
    if (subject.startsWith("change:")) await record(ctx, subject, who, "evidence.observed", `GitHub ${call.operation}: ${n} record(s) observed (call ${call.id}).`, { source: "verification" });
    return { recorded: n };
  },
});

export const refs = app.query({
  access: "changes.read",
  args: { subject: s.string() },
  handler: async (ctx, { subject }) => {
    await actor(ctx);
    return ctx.db.find(externalRefs, { subject }, { orderBy: [{ field: "observedAt", direction: "desc" }] });
  },
});

