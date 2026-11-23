import { s } from "@feltdb/feltkit";
import { app, observations } from "./app.js";
/** Inbound GitHub delivery handler: runs as integration:github after AppPort Services verified it. */
export const github = app.mutation({
  access: "observations.write", args: { event: s.record(s.unknown()) },
  handler: async (ctx, { event }) => { await ctx.db.insert(observations, { source: "github-webhook", eventId: String(event.eventId), kind: String((event.payload as { action?: string })?.action ?? "unknown"), at: Date.now() }); return null; },
});
export const list = app.query({ access: "observations.read", returns: s.unknown(), capability: { name: "observations.list", description: "Observations recorded from inbound deliveries." }, handler: async (ctx) => ctx.db.find(observations, {}) });
