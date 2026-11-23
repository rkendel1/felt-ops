/** S2 functions. No collection stores claim, lease or attempt state (criterion f). */
import { s } from "@feltdb/feltkit";
import { app } from "./app.js";

const envelope = (surface: string, invocationId: string, instruction: string) => ({
  contract: "feltkit.invocation/1", invocationId, surface: { id: surface, version: "1.0.0" },
  instruction, context: [], returnTo: { kind: "app" }, submittedAt: Date.now(),
});

/** Dispatch job: records nothing and starts nothing; the work waits for a remote claim. */
export const placed = app.mutation({ access: "work.placed", args: { invocation: s.string() }, handler: async () => null });

export const request = app.mutation({
  access: "work.request", args: { key: s.string(), instruction: s.string() },
  returns: s.unknown(),
  capability: { name: "work.request", description: "A person delegates work from their own session." },
  handler: async (ctx, { key, instruction }) =>
    ctx.invocations.accept({ surface: "delegate-session", envelope: envelope("delegate-session", key, instruction), dispatch: { job: "work.placed" } }),
});

export const deliver = app.mutation({
  access: "work.deliver", args: { key: s.string(), instruction: s.string(), person: s.string() },
  returns: s.unknown(),
  capability: { name: "work.deliver", description: "A runner delivers work for a person through the bridge surface." },
  handler: async (ctx, { key, instruction, person }) =>
    ctx.invocations.accept({ surface: "delegate-bridge", person, envelope: envelope("delegate-bridge", key, instruction), dispatch: { job: "work.placed" } }),
});

export const claim = app.mutation({
  access: "work.claim", args: { id: s.string(), worker: s.string(), leaseMs: s.number() },
  returns: s.unknown(),
  capability: { name: "work.claim", description: "Claim execution (a new attempt) with a lease." },
  handler: async (ctx, { id, worker, leaseMs }) => ctx.invocations.start(id, { worker, leaseMs }),
});

export const report = app.mutation({
  access: "work.report", args: { id: s.string(), claim: s.string(), note: s.string() },
  returns: s.unknown(),
  capability: { name: "work.report", description: "Report progress on the held attempt; renews the lease." },
  handler: async (ctx, { id, claim, note }) => ctx.invocations.progress(id, { claim, note }),
});

export const finish = app.mutation({
  access: "work.finish", args: { id: s.string(), claim: s.string() },
  returns: s.unknown(),
  capability: { name: "work.finish", description: "Complete the held attempt." },
  handler: async (ctx, { id, claim }) => ctx.invocations.transition(id, "completed", { claim, result: { ok: true } }),
});

export const status = app.query({
  access: "work.read", args: { id: s.string() },
  returns: s.unknown(),
  capability: { name: "work.status", description: "Read an invocation's state and attempts." },
  handler: async (ctx, { id }) => ctx.invocations.get(id),
});

export const cancel = app.mutation({
  access: "work.cancel", args: { id: s.string() },
  returns: s.unknown(),
  capability: { name: "work.cancel", description: "The person cancels their own work." },
  handler: async (ctx, { id }) => ctx.invocations.cancel(id, { reason: "S2 criterion (e)" }),
});
