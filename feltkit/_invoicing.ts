/**
 * Invoice processing shared by manual entry and the supplier feed. Not a function module.
 */
import type { MutationCtx } from "@feltdb/feltkit";
import { commitments, invoices, purchaseOrders } from "./app.js";
import { money, nowIso, record } from "./_lib.js";

/**
 * Process an invoice: match it to its purchase order and commit the spend.
 * Shared by manual entry and the supplier feed.
 */
/** Invoice numbers as suppliers and clerks write them differ in case and punctuation. */
export const normalizeNumber = (n: string) => n.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function processInvoice(ctx: MutationCtx, who: { id: string; type: string; recordId?: string }, input: { supplierId: string; poNumber?: string; number: string; amount: number; channel: "manual" | "supplier-feed"; externalId?: string }) {
  const at = nowIso();
  // CR fix for INC (road-test Scenario 3): an invoice already received through any channel
  // is not processed again. It is kept as an exception, without a commitment, for review.
  const key = normalizeNumber(input.number);
  const earlier = (await ctx.db.find(invoices, { supplierId: input.supplierId })).find((i) => i.status !== "void" && normalizeNumber(i.number) === key);
  if (earlier) {
    const invoiceId = await ctx.db.insert(invoices, {
      supplierId: input.supplierId, number: input.number, amount: input.amount, channel: input.channel, status: "exception", receivedAt: at, enteredBy: who.id,
      ...(input.externalId ? { externalId: input.externalId } : {}),
    });
    await record(ctx, `invoice:${invoiceId}`, who, "invoice.duplicate", `${input.number} via ${input.channel} duplicates ${earlier.number} (${earlier.channel}, ${earlier.id}); held as an exception, nothing committed.`, { data: { duplicateOf: earlier.id } });
    return { invoiceId, status: "duplicate" as const, commitmentId: null };
  }
  const [po] = input.poNumber ? await ctx.db.find(purchaseOrders, { number: input.poNumber }) : [];
  const status = po && po.supplierId === input.supplierId ? "matched" : "exception";
  const invoiceId = await ctx.db.insert(invoices, {
    supplierId: input.supplierId, number: input.number, amount: input.amount, channel: input.channel, status, receivedAt: at, enteredBy: who.id,
    ...(po ? { poId: po.id } : {}), ...(input.externalId ? { externalId: input.externalId } : {}),
  });
  let commitmentId: string | null = null;
  if (status === "matched") {
    commitmentId = await ctx.db.insert(commitments, { departmentId: po!.departmentId, poId: po!.id, invoiceId, amount: input.amount, status: "open", createdAt: at });
  }
  await record(ctx, `invoice:${invoiceId}`, who, `invoice.${status}`, `${input.number} (${money(input.amount)}) via ${input.channel}: ${status}${commitmentId ? `, committed against ${po!.number}` : ""}.`);
  return { invoiceId, status, commitmentId };
}

