/**
 * Test support: a seeded CompanyOS on a fresh FeltDB instance, principals, and evidence
 * files. Not a test file (no .test.ts suffix).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestApp, type TestApp } from "@feltdb/feltkit/testing";
import type { PrincipalInput } from "@feltdb/feltkit";
import { api } from "../feltkit/_generated/api.js";

const ROLES: Record<string, string[]> = {
  omar: ["staff", "executive"], maria: ["staff", "executive", "finance"], fiona: ["staff", "finance"], rhea: ["staff", "finance"],
  priya: ["staff", "operations"], pablo: ["staff", "procurement"], dana: ["staff", "product"], eli: ["staff", "engineering"], sam: ["staff", "engineering"],
  ivy: ["staff", "itsec", "operator", "admin"], otto: ["staff", "operator", "finance"], vic: ["auditor"],
  "agent-ledger": ["agent-finance"], "agent-ledger-2": ["agent-finance"], "agent-sentry": ["agent-integration"], "agent-steward": ["agent-access"], "agent-scribe": ["agent-engineering"],
};

/** The principal FeltKit's runtime sees for a dev identity (for AgentHost calls). */
export function principal(id: string): PrincipalInput & { type: "user" | "agent" } {
  return { id, type: id.startsWith("agent-") ? "agent" : "user", roles: ROLES[id] ?? [] };
}

export async function seeded(options: Parameters<typeof createTestApp>[0] = {}) {
  const t = await createTestApp(options);
  const seed = await t.as("ivy").mutation(api.seed.seed);
  const ids: Record<string, string> = {};
  for (const login of ["omar", "maria", "fiona", "rhea", "priya", "pablo", "dana", "eli", "sam", "ivy", "otto"]) {
    ids[login] = (await t.as(login).query(api.org.me)).person!.id;
  }
  return { t, seed, ids };
}

/** Issue a session so AgentHost can resolve the principal (approval resolves the owner). */
export async function session(t: TestApp, id: string) {
  return t.runtime.issueSession(principal(id), { kind: "test", via: "test" });
}

export async function rejects(p: Promise<unknown>, code: string, match?: RegExp) {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code !== code) throw new Error(`expected ${code}, got ${err.code}: ${err.message}`);
    if (match && !match.test(err.message ?? "")) throw new Error(`expected message ${match}, got: ${err.message}`);
    return err;
  }
  throw new Error(`expected ${code}, but it succeeded`);
}

const DIR = process.env.EVIDENCE_DIR ?? join(process.cwd(), "evidence");
/** Write a scenario's evidence (what the system recorded) for docs/SCENARIO-RESULTS.md. */
export function evidence(name: string, data: unknown) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, `${name}.json`), JSON.stringify({ recordedAt: new Date().toISOString(), ...(data as object) }, null, 2) + "\n");
}

export { api };
