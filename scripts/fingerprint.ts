/**
 * Print the business-data fingerprint (counts and money totals) of a running CompanyOS,
 * for backup/restore and upgrade checks (docs/PRODUCTION-RUNBOOK.md).
 *
 *   npx tsx scripts/fingerprint.ts <session token> [url]
 */
import { createClient } from "@feltdb/feltkit/client";
import { api } from "../feltkit/_generated/api.js";

const [token, url = "http://127.0.0.1:3000"] = process.argv.slice(2);
const client = createClient({ url, tokens: { get: () => token ?? null, set: () => {} } });
console.log(JSON.stringify(await client.query(api.reports.dataFingerprint), null, 2));
