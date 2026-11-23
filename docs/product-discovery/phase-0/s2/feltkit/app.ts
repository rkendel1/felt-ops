/**
 * Phase 0 / S2: can an independent runner process claim, renew, lose and hand over work using
 * FeltKit 0.3.37's invocation lifecycle alone (no application-owned queue, lease or attempt state)?
 * See ../PROTOCOL.md (S2). Disposable spike code.
 */
import { feltkit } from "@feltdb/feltkit";

export const app = feltkit({
  name: "phase0-s2",
  description: "Phase 0 S2 spike: remote claiming through ctx.invocations.",
  roles: {
    // A person who delegates work.
    member: ["work.request", "work.read", "work.cancel", "work.placed"],
    // A runner (service principal). Also the bridge role of the `delegate-bridge` surface.
    runner: ["work.deliver", "work.claim", "work.report", "work.finish", "work.read", "work.placed"],
  },
  dev: {
    users: [
      { id: "pat", name: "Pat (delegator)", roles: ["member"] },
      { id: "runner-a", name: "Runner A", type: "service", roles: ["runner"] },
      { id: "runner-b", name: "Runner B", type: "service", roles: ["runner"] },
      { id: "runner-pool", name: "Runner pool", type: "service", roles: ["runner"] },
    ],
  },
  services: {
    // Dispatch target required by ctx.invocations.accept. It deliberately does not start the work:
    // the remote runner claims it.
    jobs: { handlers: { "work.placed": "work:placed" } },
  },
});

// Work a person submits from their own session.
export const sessionSurface = app.surface("delegate-session", { version: "1.0.0", delivery: "session", modes: ["summon", "status"], context: ["text"], returns: ["app"] });
// Work a runner (bridge role) submits for a person the application resolved.
export const bridgeSurface = app.surface("delegate-bridge", { version: "1.0.0", delivery: "bridge", bridge: { role: "runner" }, modes: ["summon", "status"], context: ["text"], returns: ["app"] });
