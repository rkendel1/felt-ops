/** Phase 0 / S4: GitHub through FeltKit 0.3.37's integration capability. See ../PROTOCOL.md (S4). Disposable. */
import { feltkit, s } from "@feltdb/feltkit";

export const app = feltkit({
  name: "phase0-s4",
  description: "Phase 0 S4 spike: GitHub via app.integration and inbound webhooks.",
  roles: {
    "integration-github": ["observations.write", "webhooks.receive"],
    member: ["github.read", "ghstub.read", "ghstub.write", "observations.read"],
    admin: ["webhooks.*", "credential.*", "feltkit.operations.*"],
  },
  dev: { users: [{ id: "pat", name: "Pat", roles: ["member", "admin"] }] },
  services: { webhooks: { inbound: { github: { handler: "hooks:github", roles: ["integration-github"] } } } },
});

/** Observations written from verified inbound deliveries (criterion d). */
export const observations = app.collection("observations", { source: s.string(), eventId: s.string(), kind: s.string(), at: s.number() });

/** Live, read-only GitHub. Credential is a custody reference (FELTKIT_CREDENTIAL_GITHUB at runtime). */
export const github = app.integration("github", {
  description: "GitHub REST API (read-only in this spike).",
  baseUrl: { env: "GITHUB_API_URL", development: "https://api.github.com" },
  credential: "credential-ref:github",
  timeoutMs: 15000,
  operations: {
    pullget: { method: "GET", path: "/repos/{owner}/{repo}/pulls/{number}", input: { owner: s.string(), repo: s.string(), number: s.number() }, output: s.record(s.unknown()), effect: "observation", access: "github.read" },
    issueget: { method: "GET", path: "/repos/{owner}/{repo}/issues/{number}", input: { owner: s.string(), repo: s.string(), number: s.number() }, output: s.record(s.unknown()), effect: "observation", access: "github.read" },
    branchget: { method: "GET", path: "/repos/{owner}/{repo}/branches/{branch}", input: { owner: s.string(), repo: s.string(), branch: s.string() }, output: s.record(s.unknown()), effect: "observation", access: "github.read" },
    checkruns: { method: "GET", path: "/repos/{owner}/{repo}/commits/{ref}/check-runs", input: { owner: s.string(), repo: s.string(), ref: s.string() }, output: s.record(s.unknown()), effect: "observation", access: "github.read" },
  },
});

const pull = s.object({ number: s.number(), state: s.string(), title: s.string(), head: s.object({ ref: s.string() }), base: s.object({ ref: s.string() }) });

/** A local stand-in for GitHub's PR write path (no real writes in Phase 0). */
export const ghstub = app.integration("ghstub", {
  description: "GitHub-API stub for the PR write path.",
  baseUrl: { env: "GH_STUB_URL" },
  credential: "credential-ref:ghstub",
  timeoutMs: 3000,
  operations: {
    pullscreate: {
      method: "POST", path: "/repos/{owner}/{repo}/pulls",
      input: { owner: s.string(), repo: s.string(), head: s.string(), base: s.string(), title: s.string() },
      output: pull, effect: "consequential", access: "ghstub.write", idempotencyHeader: "Idempotency-Key",
      verify: { operation: "pullbyhead", input: { owner: { $input: "/owner" }, repo: { $input: "/repo" }, head: { $input: "/head" } }, expect: [{ at: "/head/ref", equals: { $input: "/head" } }] },
    },
    pullbyhead: { method: "GET", path: "/repos/{owner}/{repo}/pulls-by-head/{head}", input: { owner: s.string(), repo: s.string(), head: s.string() }, output: pull, effect: "observation", access: "ghstub.read" },
  },
});
