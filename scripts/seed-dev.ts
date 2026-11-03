/**
 * Seed a running development server over HTTP, as Ivy (IT & Security, admin), through the
 * same client the frontend uses.
 *
 *   npx tsx scripts/seed-dev.ts [http://localhost:3000]
 */
import { createClient } from "@feltdb/feltkit/client";
import { api } from "../feltkit/_generated/api.js";

const url = process.argv[2] ?? "http://localhost:3000";
let token: string | null = null;
const client = createClient({ url, tokens: { get: () => token, set: (t) => { token = t; } } });
await client.signInAsDevUser("ivy");
try {
  console.log(await client.mutation(api.seed.seed));
} catch (e) {
  const err = e as { code?: string; message?: string };
  if (err.code === "FAILED_PRECONDITION") console.log("Already seeded.");
  else throw e;
}
