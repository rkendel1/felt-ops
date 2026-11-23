import { s } from "@feltdb/feltkit";
import { app } from "./app.js";
export const ping = app.query({ access: "notes.read", returns: s.string(), capability: { name: "notes.ping", description: "Observation." }, handler: async () => "pong" });
