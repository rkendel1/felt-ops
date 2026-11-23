/** Phase 0 / S3c: is FeltKit agent control (steering) usable on the published 0.3.37 package? See ../PROTOCOL.md. */
import { feltkit } from "@feltdb/feltkit";
export const app = feltkit({
  name: "phase0-s3",
  description: "Phase 0 S3c spike: agent control over MCP and HTTP on published FeltKit.",
  roles: { member: ["feltkit.agent.*", "notes.read"], agent: ["feltkit.agent.*", "notes.read"] },
  dev: { users: [ { id: "pat", name: "Pat", roles: ["member"] }, { id: "coder", name: "Coder agent", type: "agent", roles: ["agent"] } ] },
});
import { s } from "@feltdb/feltkit";
// A state contract needs at least one collection.
export const notes = app.collection("notes", { text: s.string() });
