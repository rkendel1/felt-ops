// Phase 0 / S4 driver. Usage: PAT=<session json> ADMIN=<admin token> STUB=http://127.0.0.1:4555 node run.mjs http://localhost:3313
import { readFileSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { client } from "./mcp.mjs";
const url = process.argv[2];
const patToken = JSON.parse(readFileSync(process.env.PAT, "utf8")).token;
const pat = client(url, patToken);
const admin = (path, init = {}) => fetch(`${url}/_feltkit/api${path}`, { ...init, headers: { "x-feltkit-admin": process.env.ADMIN, "content-type": "application/json", ...(init.headers ?? {}) } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const stub = (path, init) => fetch(`${process.env.STUB}${path}`, init).then((r) => r.json());
const log = []; const note = (k, d) => { log.push({ step: k, ...d }); console.log(JSON.stringify({ step: k, ...d }).slice(0, 600)); };
const summary = {};

// (a) live reads
const pr = await pat.call("github.pullget", { owner: "rkendel1", repo: "felt-ops", number: 1 });
note("a-pull", { ok: pr.ok, code: pr.code, number: pr.value?.number, state: pr.value?.state, head: pr.value?.head?.sha, merged: pr.value?.merged });
const issue = await pat.call("github.issueget", { owner: "rkendel1", repo: "felt-ops", number: 1 });
note("a-issue", { ok: issue.ok, code: issue.code, title: issue.value?.title, hasPR: !!issue.value?.pull_request });
const branch = await pat.call("github.branchget", { owner: "rkendel1", repo: "felt-ops", branch: "claude/wonderful-wright-rgzwsf" });
note("a-branch", { ok: branch.ok, code: branch.code, sha: branch.value?.commit?.sha });
const checks = await pat.call("github.checkruns", { owner: "rkendel1", repo: "felt-ops", ref: pr.value?.head?.sha ?? "main" });
note("a-checks", { ok: checks.ok, code: checks.code, total: checks.value?.total_count, runs: (checks.value?.check_runs ?? []).map((c) => ({ name: c.name, conclusion: c.conclusion })) });
let integ = await admin("/integrations");
const calls = JSON.stringify(integ.body);
note("a-call-records", { status: integ.status, keys: Object.keys(integ.body ?? {}), sample: calls.slice(0, 400) });
summary.a = { pull: pr.ok, issue: issue.ok, branch: branch.ok, checks: checks.ok };

// (b) idempotent create: same key twice → one upstream request
const key = `s4-${Date.now()}`;
const c1 = await pat.rpc("tools/call", { name: "ghstub_pullscreate", arguments: { owner: "o", repo: "r", head: `handoff/${key}`, base: "main", title: "S4 b" }, _meta: { "dev.appport/idempotencyKey": key } });
note("b-create-1", { r: JSON.stringify(c1).slice(0, 300) });
const c2 = await pat.rpc("tools/call", { name: "ghstub_pullscreate", arguments: { owner: "o", repo: "r", head: `handoff/${key}`, base: "main", title: "S4 b" }, _meta: { "dev.appport/idempotencyKey": key } });
note("b-create-2", { r: JSON.stringify(c2).slice(0, 300) });
let hits = await stub("/_stub/hits");
const postsB = hits.filter((h) => h.method === "POST" && h.url === "/repos/o/r/pulls");
note("b-upstream", { posts: postsB.length, keys: postsB.map((h) => h.key), auth: postsB.map((h) => h.auth) });
summary.b = { upstreamPosts: postsB.length, sameKeySent: postsB.every((h) => h.key), keyHeaderValues: [...new Set(postsB.map((h) => h.key))].length };

// (c) unknown outcome: upstream records the PR and drops the connection
await stub("/_stub/mode", { method: "POST", body: JSON.stringify({ mode: "drop" }) });
const key2 = `s4u-${Date.now()}`;
const u1 = await pat.rpc("tools/call", { name: "ghstub_pullscreate", arguments: { owner: "o", repo: "r", head: `handoff/${key2}`, base: "main", title: "S4 c" }, _meta: { "dev.appport/idempotencyKey": key2 } });
note("c-first", { r: JSON.stringify(u1).slice(0, 400) });
await stub("/_stub/mode", { method: "POST", body: JSON.stringify({ mode: "normal" }) });
const u2 = await pat.rpc("tools/call", { name: "ghstub_pullscreate", arguments: { owner: "o", repo: "r", head: `handoff/${key2}`, base: "main", title: "S4 c" }, _meta: { "dev.appport/idempotencyKey": key2 } });
note("c-retry-same-key", { r: JSON.stringify(u2).slice(0, 400) });
hits = await stub("/_stub/hits");
const postsC = hits.filter((h) => h.method === "POST" && h.key === key2);
note("c-upstream", { posts: postsC.length });
integ = await admin("/integrations");
const callList = (integ.body?.calls ?? integ.body?.integrations?.flatMap?.((i) => i.calls ?? []) ?? []);
const unknownCall = callList.find?.((c) => JSON.stringify(c).includes(key2));
note("c-call-record", { found: !!unknownCall, record: JSON.stringify(unknownCall ?? integ.body).slice(0, 600) });
const verified = unknownCall ? await admin(`/integrations/calls/${unknownCall.id}/verify`, { method: "POST", body: JSON.stringify({ as: "pat" }) }) : null;
note("c-verify-probe", { status: verified?.status, state: verified?.body?.call?.state, determinedBy: verified?.body?.call?.determinedBy, body: JSON.stringify(verified?.body).slice(0, 300) });
const u3 = await pat.rpc("tools/call", { name: "ghstub_pullscreate", arguments: { owner: "o", repo: "r", head: `handoff/${key2}`, base: "main", title: "S4 c" }, _meta: { "dev.appport/idempotencyKey": key2 } });
note("c-retry-after-verify", { r: JSON.stringify(u3).slice(0, 300) });
const postsC2 = (await stub("/_stub/hits")).filter((h) => h.method === "POST" && h.key === key2).length;
summary.c = { afterVerifyState: verified?.body?.call?.state, determinedBy: verified?.body?.call?.determinedBy, upstreamPostsAfterRetry: postsC2, firstAnswer: u1.result?.isError ? (u1.result.content?.[0]?.text ?? "").slice(0, 120) : "ok", retryAnswer: u2.result?.isError ? (u2.result.content?.[0]?.text ?? "").slice(0, 120) : "ok (re-sent?)", upstreamPosts: postsC.length };

// (d) inbound webhooks
const reg = await admin("/services/manage/_appport/webhooks/integrations", { method: "POST", headers: { "x-feltkit-as": "pat" }, body: JSON.stringify({ provider: "github", signingCredentialRef: "credential-ref:ghhook" }) });
note("d-register", { status: reg.status, body: JSON.stringify(reg.body).slice(0, 300) });
const integrationId = reg.body?.item?.id ?? reg.body?.id ?? reg.body?.integration?.id ?? reg.body?.result?.id;
const secret = process.env.HOOK_SECRET;
const body = JSON.stringify({ action: "completed", check_suite: { head_sha: "abc", conclusion: "success" } });
const post = (headers) => fetch(`${url}/webhooks/inbound/${integrationId}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body }).then(async (r) => ({ status: r.status, body: (await r.text()).slice(0, 200) }));
const ghSig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
const native = await post({ "x-github-event": "check_suite", "x-github-delivery": "gh-delivery-1", "x-hub-signature-256": ghSig });
note("d-github-native-signature", native);
const ts = new Date().toISOString(); // AppPort Services parses x-appport-timestamp with Date.parse
const apSig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
const appport = await post({ "x-appport-event-id": "ev-1", "x-appport-timestamp": ts, "x-appport-signature-v2": apSig });
note("d-appport-signature", appport);
const replay = await post({ "x-appport-event-id": "ev-1", "x-appport-timestamp": ts, "x-appport-signature-v2": apSig });
note("d-replay", replay);
const bad = await post({ "x-appport-event-id": "ev-2", "x-appport-timestamp": ts, "x-appport-signature-v2": "00" + apSig.slice(2) });
note("d-bad-signature", bad);
const obs = await pat.call("observations.list", {});
note("d-observations", { n: obs.value?.length, obs: obs.value });
summary.d = { githubNative: native.status, appportSigned: appport.status, replay: replay.status, badSignature: bad.status, handlerRan: obs.value?.length ?? 0 };

// (e) credential never recorded
const everything = JSON.stringify(log) + JSON.stringify((await admin("/integrations")).body) + JSON.stringify((await admin("/activity")).body);
summary.e = { githubTokenAbsent: !everything.includes(process.env.GH_SECRET_PROBE), stubSecretAbsent: !everything.includes("stub-secret-value-123"), hookSecretAbsent: !everything.includes(secret) };
writeFileSync("evidence.json", JSON.stringify({ experiment: "phase-0/S4", feltkit: JSON.parse(readFileSync("node_modules/@feltdb/feltkit/package.json")).version, summary, log }, null, 2) + "\n");
console.log("SUMMARY", JSON.stringify(summary, null, 2));
