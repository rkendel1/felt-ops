/**
 * Repeatable agent-operator evaluation harness.
 *
 *   npm run build && npx tsx scripts/operator-eval.ts
 *
 * Starts a disposable `feltkit dev` (port 3300) on a copy of HEAD whose development state
 * holds four duplicate commitments produced by release R1. Then performs the 15 operator
 * workflows the way an operator would: in the CompanyOS UI and FeltKit Studio with a real
 * browser, and in a terminal where the guide says so (sessions, agent processes).
 *
 * For each workflow it records:
 * - outcome, duration, operator actions, and context switches (app ↔ Studio ↔ terminal);
 * - the obstacles it met;
 * - whether what the screen showed matched durable records, checked independently against
 *   the runtime (FeltDB / FeltKit agent state).
 *
 * Screenshots and the visible text of every screen go to evidence/operator-eval/ for an
 * independent reviewer. A scripted operator cannot measure human comprehension: that is the
 * reviewer's job (docs/AGENT-OPERATOR-EVALUATION.md).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { startDev } from "@feltdb/feltkit/server";
import { stateWithR1Duplicates } from "../tests/_r1.js";

// Playwright is preinstalled in the environment (not a project dependency); loaded untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;
const { chromium } = createRequire(import.meta.url)("playwright") as { chromium: { launch(): Promise<any> } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const ROOT = process.cwd();
const OUT = join(ROOT, "evidence/operator-eval");
const PORT = 3300;
const APP = `http://127.0.0.1:${PORT}`;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ── Environment ──────────────────────────────────────────────────────────────
const r1 = await stateWithR1Duplicates(4);
const project = mkdtempSync(join(tmpdir(), "companyos-eval-"));
execFileSync("sh", ["-c", `git -C ${ROOT} archive HEAD | tar -x -C ${project}`]);
symlinkSync(join(ROOT, "node_modules"), join(project, "node_modules"));
mkdirSync(join(project, ".feltkit/development"), { recursive: true });
cpSync(r1.storage.path, join(project, ".feltkit/development/state"), { recursive: true });
const dev = await startDev({ projectDir: project, port: PORT });
const rt = dev.runtime;
const P = (id: string, roles: string[], type: "user" | "agent" = "user") => ({ id, type, roles });
const people = { otto: P("otto", ["staff", "operator", "finance"]), ivy: P("ivy", ["staff", "itsec", "operator", "admin"]), eli: P("eli", ["staff", "engineering"]), fiona: P("fiona", ["staff", "finance"]) };
async function call<T>(name: string, args: unknown, who: ReturnType<typeof P>): Promise<T> {
  const r = await rt.call(name, args, { principal: who } as never) as { ok: boolean; value?: T; error?: { code: string; message: string } };
  if (!r.ok) throw Object.assign(new Error(r.error!.message), { code: r.error!.code });
  return r.value as T;
}

// ── Measurement ──────────────────────────────────────────────────────────────
interface Result { id: string; workflow: string; outcome: "completed" | "partial" | "not completed"; seconds: number; actions: number; switches: number; surfaces: string[]; obstacles: string[]; matched: boolean | null; check: string; screens: string[] }
const results: Result[] = [];
let cur: Result = { id: "", workflow: "", outcome: "completed", seconds: 0, actions: 0, switches: 0, surfaces: [], obstacles: [], matched: null, check: "", screens: [] };
let surface = "";
let t0 = 0;
function begin(id: string, workflow: string) { cur = { id, workflow, outcome: "completed", seconds: 0, actions: 0, switches: 0, surfaces: [], obstacles: [], matched: null, check: "", screens: [] }; surface = ""; t0 = Date.now(); console.log(`\n${id} ${workflow}`); }
function on(s: "app" | "studio" | "terminal") { if (surface && surface !== s) cur.switches += 1; if (!cur.surfaces.includes(s)) cur.surfaces.push(s); surface = s; }
function act(n = 1) { cur.actions += n; }
function obstacle(text: string, outcome?: Result["outcome"]) { cur.obstacles.push(text); if (outcome && (outcome === "not completed" || cur.outcome === "completed")) cur.outcome = outcome; console.log("   obstacle:", text); }
function verdict(matched: boolean, check: string) { cur.matched = matched; cur.check = check; console.log(`   display vs records: ${matched ? "match" : "MISMATCH"} — ${check}`); }
function end() { cur.seconds = Math.round((Date.now() - t0) / 100) / 10; results.push(cur); console.log(`   → ${cur.outcome}, ${cur.seconds}s, ${cur.actions} actions, ${cur.switches} switches`); }
async function shot(page: Page, name: string) {
  const file = `${cur.id}-${name}`;
  await page.screenshot({ path: join(OUT, `${file}.jpg`), type: "jpeg", quality: 60, fullPage: true });
  writeFileSync(join(OUT, `${file}.txt`), await page.innerText("body"));
  cur.screens.push(file);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(f: () => Promise<T | null | undefined | false>, ms = 30_000, step = 500): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) { const v = await f().catch(() => null); if (v) return v as T; if (Date.now() > end) return null; await sleep(step); }
}

// Terminal steps the guide prescribes.
async function issueAgentSession(key: string, role: string) { on("terminal"); act(); return (await rt.issueSession(P(key, [role], "agent"), { kind: "agent", label: "operator-eval", via: "cli" })).token; }
const procs: ChildProcess[] = [];
function startAgent(token: string, extra: string[] = []) {
  on("terminal"); act();
  const child = spawn("npx", ["tsx", "agents/runner.ts", "--url", APP, "--timeout", "600000", "--poll", "500", ...extra], { cwd: ROOT, env: { ...process.env, AGENT_TOKEN: token }, stdio: ["ignore", "pipe", "pipe"] });
  const log: string[] = [];
  child.stdout!.on("data", (d) => log.push(String(d)));
  child.stderr!.on("data", (d) => log.push(String(d)));
  const exited = new Promise<number>((r) => child.on("exit", (c) => r(c ?? -1)));
  procs.push(child);
  return { child, log, exited };
}

// ── Browser ──────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const app = await ctx.newPage();
const consoleErrors: string[] = [];
app.on("pageerror", (e: Error) => consoleErrors.push(e.message));
app.on("dialog", (d: { accept(t?: string): Promise<void> }) => void d.accept("evaluation"));
await app.goto(`${APP}/`);
await app.waitForSelector("text=Agent operations", { timeout: 30_000 });
const linkHref = (await app.getAttribute("a.dashboard-link", "href")) ?? "";
// The app's Studio link is what FeltKit's session reports. It carries no credential, so an
// operator following it is not signed in to Studio (finding E-01); use the link `feltkit dev`
// prints, as the guide says.
const studioLinkSignsIn = /token=/.test(linkHref);
const studioUrl = `${APP}/_feltkit/#token=${readFileSync(join(project, ".feltkit/development/admin-token"), "utf8").trim()}`;
const studio = await ctx.newPage();
studio.on("dialog", (d: { accept(t?: string): Promise<void> }) => void d.accept("Rejected during operator evaluation"));
/** A form field by its exact visible label (Field components wrap <span>label</span><control>). */
const field = (page: Page, label: string) => page.locator(`label.field:has(> span:text-is("${label}"))`).locator("input, textarea, select").first();
const go = async (hash: string) => { on("app"); act(); await app.goto(`${APP}/#/${hash}`); await app.waitForTimeout(1200); };
let studioSignedIn = false;
async function studioAs(name: string) {
  on("studio");
  if (!studioSignedIn) { act(); await studio.goto(studioUrl); await studio.reload(); await studio.waitForTimeout(1500); studioSignedIn = true; }
  act(); await studio.goto(`${APP}/_feltkit/#/agent`); await studio.waitForTimeout(1200);
  const select = studio.getByLabel("Act as").first();
  const value = await select.locator("option").evaluateAll((os: HTMLOptionElement[], n: string) => os.find((o) => o.text.includes(n))?.value ?? "", name);
  if (value) { act(); await select.selectOption(value); await studio.waitForTimeout(600); } else obstacle(`Studio "Act as" offers no ${name}`);
}
/** Open a task in Studio from its list (one click on its row link). */
async function studioOpenTask(id: string) {
  act(); await studio.goto(`${APP}/_feltkit/#/agent/${id}`); await studio.waitForTimeout(1500);
}
const assignmentPage = async (id: string) => go(`assignment/${id}`);

let asg = "";
let taskId = "";
let primary: ReturnType<typeof startAgent> | null = null;
const dupesAtStart = r1.duplicates.length;

try {
  // W01 ─ Register and configure an agent
  begin("W01", "Register and configure an agent");
  await go("operator");
  const registerUi = await app.getByRole("button", { name: /register an agent/i }).count();
  await shot(app, "operator");
  if (registerUi) {
    act(); await app.getByRole("button", { name: /register an agent/i }).click();
    for (const [label, value] of [["Key (its principal id)", "agent-auditor"], ["Name", "Ledger Auditor"], ["Purpose", "Read-only review of commitments for the quarterly audit."]] as const) { act(); await field(app, label).fill(value); }
    act(); await field(app, "Role (its authority ceiling)").selectOption("agent-finance");
    act(); await field(app, "Owner").selectOption({ label: "Otto Lind" });
    act(); await app.getByRole("button", { name: "Register", exact: true }).click(); await app.waitForTimeout(1500);
    await shot(app, "register-done");
    const shownCommand = (await app.innerText("main")).match(/npx feltkit session create[^\n]*/)?.[0] ?? "";
    if (!shownCommand) obstacle("Registration gave no next step.");
    await issueAgentSession("agent-auditor", "agent-finance");
    obstacle("Registration and credential issuance are two systems: CompanyOS records the agent, FeltKit's CLI issues its session, and nothing ties the session's roles to the registered role.");
  } else {
    obstacle("No way to register an agent in the CompanyOS UI; the page says IT & Security registers agents and sessions come from `feltkit session create`.", "partial");
    on("terminal"); act(2);
    await call("agents:register", { key: "agent-auditor", name: "Ledger Auditor", purpose: "Read-only review of commitments for the quarterly audit.", runtime: "companyos-agent-runner", provider: "none (deterministic playbook)", model: "none", roles: ["agent-finance"], ownerId: (await call<{ person: { id: string } }>("org:me", {}, people.otto)).person.id }, people.ivy);
    await issueAgentSession("agent-auditor", "agent-finance");
    obstacle("Registered through the API (agents:register) plus a CLI session: two systems, and nothing ties the session's roles to the registry's roles.");
  }
  await go("agent/agent-auditor");
  await shot(app, "registered");
  const shown = (await app.innerText("main")).includes("Ledger Auditor");
  const stored = (await call<Array<{ key: string; roles: string[] }>>("agents:list", {}, people.otto)).find((a) => a.key === "agent-auditor");
  verdict(shown && !!stored, `agent page shows the agent: ${shown}; registry record roles: ${stored?.roles.join(",")}`);
  end();

  // W02 ─ Understand its authority
  begin("W02", "Understand and grant its authority");
  await go("agent/agent-ledger");
  await shot(app, "why");
  const rowText = async (cap: string) => (await app.locator("tr", { hasText: cap }).first().innerText()).replace(/\s+/g, " ");
  const reverseRow = await rowText("commitments.reverse");
  const departRow = await rowText("org.depart");
  const perms = rt.authority.permissionsFor(P("agent-ledger", ["agent-finance"], "agent") as never);
  const can = (p: string) => perms.some((g) => g === p || (g.endsWith(".*") && p.startsWith(g.slice(0, -1))));
  verdict(/via agent-finance/.test(reverseRow) === can("commitments.reverse") && /no/.test(departRow) === !can("org.access"), `UI "${reverseRow}" / "${departRow}"; FeltKit authority: commitments.reverse=${can("commitments.reverse")}, org.access=${can("org.access")}`);
  obstacle("Granting authority is not an operator action: roles are fixed in code (feltkit/app.ts) and attached when a session is issued; the UI explains authority but cannot change it.", "partial");
  end();

  // W03 ─ Assign a business task
  begin("W03", "Assign a business task to an agent");
  await go("operator/assign");
  act(); await field(app, "Agent").selectOption({ label: "Ledger Reconciler — agent-finance" });
  for (const [label, value] of [["Title", "Reverse duplicate Northwind commitments"], ["Objective", "Every commitment finance.reconciliation lists as a duplicate is reversed."], ["Business context", "Release R1 processed four Northwind invoices twice."], ["Constraints", "One proposal per commitment\nNever touch a commitment that is not listed"], ["Expected output", "Zero duplicates in finance.reconciliation."]] as const) {
    act(); await field(app, label).fill(value);
  }
  act(); await field(app, "Verified by").selectOption("reconciliation-clean");
  for (const c of ["finance.reconciliation", "commitments.reverse"]) { act(); await app.getByLabel(c, { exact: true }).check(); }
  const disabled = await app.getByLabel("org.depart", { exact: true }).isDisabled();
  await shot(app, "form");
  act(); await app.getByRole("button", { name: "Assign", exact: true }).click();
  await app.waitForURL(/#\/assignment\//, { timeout: 15_000 });
  asg = decodeURIComponent(app.url().split("/assignment/")[1]!);
  await app.waitForTimeout(1200);
  await shot(app, "assigned");
  const rec = await call<{ assignment: { permittedCapabilities: string[]; status: string } }>("agents:assignmentDetail", { assignmentId: asg }, people.otto);
  verdict(rec.assignment.permittedCapabilities.join() === "finance.reconciliation,commitments.reverse" && disabled, `stored caps ${rec.assignment.permittedCapabilities.join(", ")}; org.depart greyed out: ${disabled}`);
  end();

  // W04 ─ Monitor execution
  begin("W04", "Monitor execution");
  const token = await issueAgentSession("agent-ledger", "agent-finance");
  primary = startAgent(token);
  await assignmentPage(asg);
  const fourProposed = await until(async () => { await app.reload(); await app.waitForTimeout(1500); const t = await app.innerText("main"); return (t.match(/\bproposed\b/g) ?? []).length >= 4 ? t : null; }, 60_000, 2000);
  await shot(app, "running");
  const view = await call<{ assignment: { status: string; feltkitTaskId?: string } }>("agents:assignmentDetail", { assignmentId: asg }, people.otto);
  taskId = view.assignment.feltkitTaskId ?? "";
  const task = taskId ? await rt.agent.get(taskId, "admin") : null;
  if (!fourProposed) obstacle("The four proposals never appeared on the assignment page within 60 s.", "not completed");
  verdict(!!fourProposed && task?.pending.length === dupesAtStart && /waiting-approval/.test(fourProposed ?? ""), `page shows 4 proposed + waiting-approval: ${!!fourProposed}; FeltKit pending: ${task?.pending.length}; stored status: ${view.assignment.status}`);
  end();

  // W05 ─ Inspect capability usage and evidence
  begin("W05", "Inspect capability usage and evidence");
  await assignmentPage(asg);
  act(); await app.getByText(/Checkpoints \(\d+\)/).click();
  await shot(app, "evidence");
  const text = await app.innerText("main");
  const activity = (await rt.activity.list({ limit: 500 })).filter((e) => e.principal?.id === "agent-ledger");
  const reads = activity.filter((e) => e.name.includes("reconciliation") || e.name.includes("assignments")).length;
  const readsShown = /finance\.reconciliation/.test(text.split("FeltKit actions")[1] ?? "") && /assignments\.mine/.test(text);
  if (!readsShown) obstacle(`The agent made ${activity.length} recorded calls (${reads} reads of the reconciliation and its assignments); the page shows only its ${dupesAtStart} proposals. Its reads and every refusal are only in Studio → Activity.`, "partial");
  verdict(true, `proposals shown = FeltKit actions (${task?.actions.length}); direct calls visible on the page: ${readsShown}; in the activity log: ${activity.length}`);
  end();

  // W06 ─ Review and approve a consequential action
  begin("W06", "Review and approve a consequential action");
  if (!studioLinkSignsIn) {
    on("studio"); act(); await studio.goto(`${APP}${linkHref.startsWith("/") ? linkHref : `/${linkHref}`}`); await studio.waitForTimeout(1500);
    await shot(studio, "studio-from-app-link");
    obstacle(`The app's "Studio ↗" link (${linkHref}) opens Studio without signing in; the operator needs the tokenized link printed by \`feltkit dev\` (production: an operator grant).`);
    on("terminal"); act();
  }
  await studioAs("Rhea");
  await studio.screenshot({ path: join(OUT, "W06-studio-list.jpg"), type: "jpeg", quality: 60, fullPage: true }); cur.screens.push("W06-studio-list");
  await studioOpenTask(taskId);
  await shot(studio, "studio-task");
  const studioText = await studio.innerText("body");
  if (/Waiting for a coding agent/.test(studioText)) obstacle('Studio labels the agent\'s own running task "Waiting for a coding agent — Nothing works on this task until one claims it", although the agent owns it and is waiting for approval.');
  if (/"commitmentId": "mw/.test(studioText)) obstacle("The proposal shows a raw commitment id; the amount, invoice and supplier are not on the approval screen.");
  const approveButtons = studio.getByRole("button", { name: /^Approve/ });
  if (!(await approveButtons.count())) obstacle("No Approve button for Rhea in Studio.", "not completed");
  else { act(); await approveButtons.first().click(); await studio.waitForTimeout(2000); }
  await assignmentPage(asg);
  const succeeded = await until(async () => { await app.reload(); await app.waitForTimeout(1200); return /succeeded/.test(await app.innerText("main")); }, 20_000, 1500);
  await shot(app, "after-approve");
  const t6 = await rt.agent.get(taskId, "admin");
  const ok6 = t6.actions.filter((a) => a.state === "succeeded");
  verdict(!!succeeded && ok6.length === 1 && ok6[0]!.decidedBy === "user:rhea" && ok6[0]!.executedAs === "agent:agent-ledger", `page shows succeeded: ${!!succeeded}; FeltKit: ${ok6.length} succeeded, approved by ${ok6[0]?.decidedBy}, ran as ${ok6[0]?.executedAs}`);
  end();

  // W07 ─ Reject an action and observe the refusal
  begin("W07", "Reject an action and observe the refusal");
  await studioAs("Rhea");
  await studioOpenTask(taskId);
  const rejectButtons = studio.getByRole("button", { name: /^Reject/ });
  if (!(await rejectButtons.count())) obstacle("No Reject button in Studio.", "not completed");
  else { act(); await rejectButtons.first().click(); await studio.waitForTimeout(1500); }
  await shot(studio, "studio-rejected");
  await assignmentPage(asg);
  const rejected = await until(async () => { await app.reload(); await app.waitForTimeout(1200); return /rejected/.test(await app.innerText("main")); }, 15_000, 1500);
  await shot(app, "after-reject");
  const t7 = await rt.agent.get(taskId, "admin");
  const recon7 = await call<{ duplicates: unknown[] }>("purchasing:reconciliation", {}, people.fiona);
  verdict(!!rejected && t7.actions.some((a) => a.state === "rejected") && recon7.duplicates.length === dupesAtStart - 1, `page shows rejected: ${!!rejected}; FeltKit rejected: ${t7.actions.filter((a) => a.state === "rejected").length}; duplicates left ${recon7.duplicates.length} (rejected one still a duplicate)`);
  end();

  // W08 ─ Intervene in a running task
  begin("W08", "Intervene in a running task (context, suspend, approval while suspended, resume)");
  await assignmentPage(asg);
  const note = field(app, "Note (required for every intervention)");
  act(); await note.fill("Finance confirms: the NW-91xx invoices are the duplicates.");
  act(); await app.getByRole("button", { name: "Add context" }).click(); await app.waitForTimeout(1200);
  act(); await note.fill("Pausing while Finance double-checks.");
  act(); await app.getByRole("button", { name: "Suspend", exact: true }).click(); await app.waitForTimeout(1500);
  await shot(app, "suspended");
  await studioAs("Rhea");
  await studioOpenTask(taskId);
  const stillApprovable = await studio.getByRole("button", { name: /^Approve/ }).count();
  if (stillApprovable) { obstacle("Studio still offers Approve on a task whose CompanyOS assignment is suspended: the two systems do not share the suspension."); act(); await studio.getByRole("button", { name: /^Approve/ }).first().click(); await studio.waitForTimeout(2000); }
  await assignmentPage(asg);
  await app.reload(); await app.waitForTimeout(1500);
  const t8 = await rt.agent.get(taskId, "admin");
  const blocked = t8.actions.find((a) => a.state === "failed");
  act(); await field(app, "Note (required for every intervention)").fill("Finance confirmed; continue.");
  act(); await app.getByRole("button", { name: "Resume", exact: true }).click(); await app.waitForTimeout(1500);
  await shot(app, "resumed");
  const s8 = await call<{ assignment: { status: string; context: string } }>("agents:assignmentDetail", { assignmentId: asg }, people.otto);
  verdict(!!blocked && /suspended/.test(blocked.outcome?.error?.message ?? "") && s8.assignment.status === "recovering" && s8.assignment.context.includes("NW-91xx"), `approval while suspended → ${blocked?.state}: "${blocked?.outcome?.error?.message}"; status now ${s8.assignment.status}; context updated: ${s8.assignment.context.includes("NW-91xx")}`);
  end();

  // W13 ─ Determine the real state after a process failure
  begin("W13", "Determine the real state of a task after a process failure");
  on("terminal"); act();
  const alreadyGone = primary.child.exitCode !== null;
  if (!alreadyGone) primary.child.kill("SIGKILL");
  const code = await primary.exited;
  if (alreadyGone) obstacle(`The agent process had already exited (${code}) during the suspension: its progress report was refused ("${(primary.log.join("").match(/stopped: .*/)?.[0] ?? "").slice(0, 120)}"). Nothing in CompanyOS said so.`);
  await assignmentPage(asg);
  await shot(app, "after-crash");
  const page13 = await app.innerText("main");
  const recon13 = await call<{ duplicates: unknown[] }>("purchasing:reconciliation", {}, people.fiona);
  const shownDupes = Number(page13.match(/"duplicates":\s*(\d+)/)?.[1] ?? NaN);
  const t13 = await rt.agent.get(taskId, "admin");
  const statesShown = ["succeeded", "rejected", "failed", "proposed"].every((s) => page13.includes(s));
  if (!/process|exited|stopped|heartbeat|last seen/i.test(page13)) obstacle("Nothing on the page says the agent's process is gone: no heartbeat or last-seen time; the operator infers it from silence.");
  verdict(shownDupes === recon13.duplicates.length && statesShown, `process exit ${code}; records check shows ${shownDupes} duplicates, reconciliation has ${recon13.duplicates.length}; FeltKit states ${t13.actions.map((a) => a.state).join(",")} all on the page: ${statesShown}`);
  end();

  // W12 ─ Investigate a production incident
  begin("W12", "Investigate a production incident");
  const inc = await call<{ id: string; number: string }>("incidents:open", { title: "Invoice processing duplicates commitments", severity: "sev2", process: "invoice-processing", businessImpact: "Duplicate commitments overstate Finance spend.", affected: r1.duplicates.map((d) => ({ collection: "commitments", id: d.commitmentId })) }, people.eli);
  await go("incidents");
  act(); await app.getByRole("link", { name: inc.number }).click(); await app.waitForTimeout(1500);
  await shot(app, "incident");
  const page12 = await app.innerText("main");
  const shown12 = Number(page12.match(/(\d+) duplicate commitment/)?.[1] ?? NaN);
  if (!/Agent work on this incident/.test(page12)) obstacle("The incident page does not show agent work on it.");
  else if (/No agent is assigned to this incident/.test(page12)) obstacle("The remediation assignment (made before the incident was opened) is not linked to the incident, so the incident page says no agent works on it; linking needs the assign form's related-record picker at assignment time.");
  verdict(shown12 === recon13.duplicates.length, `incident check shows ${shown12} duplicates; records ${recon13.duplicates.length}`);
  end();

  // W09 ─ Recover from the failed task
  begin("W09", "Recover from a failed task (suspend agent, cancel task, reassign, finish)");
  await go("agent/agent-ledger");
  act(); await app.getByLabel("Reason").fill("Process crashed during reversal run");
  act(); await app.getByRole("button", { name: "Suspend agent" }).click(); await app.waitForTimeout(1500);
  await studioAs("Otto");
  await studioOpenTask(taskId);
  const cancel = studio.getByRole("button", { name: /Cancel task/ });
  if (await cancel.count()) { act(); await cancel.first().click(); await studio.waitForTimeout(800); const c2 = studio.getByRole("button", { name: /Cancel task|Confirm/ }); if (await c2.count()) { act(); await c2.last().click(); } await studio.waitForTimeout(1500); } else obstacle("No Cancel task in Studio.", "partial");
  await shot(studio, "studio-cancelled");
  await assignmentPage(asg);
  act(); await field(app, "Note (required for every intervention)").fill("Primary crashed; standby takes over.");
  act(); await app.getByLabel("Reassign or escalate to").selectOption({ label: "Ledger Reconciler (standby)" });
  act(); await app.getByRole("button", { name: "Reassign", exact: true }).click(); await app.waitForTimeout(1500);
  const next = (await call<Array<{ id: string; agentKey: string; status: string }>>("agents:listAssignments", { agentKey: "agent-ledger-2" }, people.otto))[0]!;
  const standby = startAgent(await issueAgentSession("agent-ledger-2", "agent-finance"));
  await assignmentPage(next.id);
  const proposed9 = await until(async () => { const v = await call<{ assignment: { feltkitTaskId?: string } }>("agents:assignmentDetail", { assignmentId: next.id }, people.otto); if (!v.assignment.feltkitTaskId) return null; const t = await rt.agent.get(v.assignment.feltkitTaskId, "admin"); return t.pending.length ? v.assignment.feltkitTaskId : null; }, 60_000, 1500);
  await studioAs("Maria");
  if (proposed9) await studioOpenTask(proposed9); else obstacle("The standby never proposed anything.", "partial");
  for (let i = 0; i < 6; i += 1) { const b = studio.getByRole("button", { name: /^Approve/ }); if (!(await b.count())) break; act(); await b.first().click(); await studio.waitForTimeout(1500); }
  await shot(studio, "studio-standby");
  const done9 = await until(async () => (await standby.exited.then((c) => c === 0).catch(() => false)) || null, 60_000, 1000);
  await assignmentPage(next.id);
  act(); await app.getByRole("button", { name: "Verify now" }).click(); await app.waitForTimeout(1500);
  await shot(app, "verified");
  const recon9 = await call<{ duplicates: unknown[] }>("purchasing:reconciliation", {}, people.fiona);
  const reversed = await call<Array<{ id: string; reversedBy?: string }>>("purchasing:listCommitments", { status: "reversed" }, people.fiona);
  const v9 = await call<{ assignment: { status: string } }>("agents:assignmentDetail", { assignmentId: next.id }, people.otto);
  if (!proposed9 || !done9) obstacle("The standby did not finish within the time allowed.", "partial");
  verdict(recon9.duplicates.length === 0 && reversed.length === dupesAtStart && new Set(reversed.map((c) => c.id)).size === dupesAtStart && v9.assignment.status === "verified", `duplicates left ${recon9.duplicates.length}; reversed ${reversed.length} (unique ${new Set(reversed.map((c) => c.id)).size}); new assignment ${v9.assignment.status}`);
  end();

  // W10 ─ Reassign work to a person
  begin("W10", "Reassign work to a human");
  const extra = await call<string>("agents:assign", { agentKey: "agent-auditor", title: "Quarterly commitment review", objective: "Review open commitments above 10,000 for the audit.", context: "", constraints: [], expectedOutput: "List of reviewed commitments.", permittedCapabilities: ["commitments.list"], approvalRequired: false, verifier: "manual" }, people.otto);
  await assignmentPage(extra);
  act(); await field(app, "Note (required for every intervention)").fill("The auditor agent is not ready; Rhea takes it.");
  act(); await app.getByLabel("Reassign or escalate to").selectOption({ label: "Rhea Das" });
  act(); await app.getByRole("button", { name: "Reassign", exact: true }).click(); await app.waitForTimeout(1500);
  await go("work");
  await shot(app, "work");
  const workShown = (await app.innerText("main")).includes("Quarterly commitment review");
  verdict(workShown, `"Agent takeovers" work item visible on Work: ${workShown}`);
  if (!/Rhea/.test(await app.locator("tr", { hasText: "Quarterly commitment review" }).first().innerText().catch(() => ""))) obstacle("The work item does not show who it was handed to on the Work page.");
  end();

  // W11 ─ Trace a business change through engineering and deployment
  begin("W11", "Trace a business change through engineering and deployment");
  const change = await call<{ id: string; number: string }>("changes:request", { kind: "application", title: "Deduplicate invoices across channels", problem: "Same invoice via manual entry and feed is processed twice.", incidentId: inc.id }, people.eli);
  await call("incidents:update", { incidentId: inc.id, changeId: change.id, rootCause: "Per-channel deduplication only." }, people.eli);
  await go(`incident/${inc.id}`);
  act(); await app.getByRole("link", { name: change.number }).click(); await app.waitForTimeout(1500);
  await shot(app, "change");
  const p11 = await app.innerText("main");
  const traced = p11.includes(inc.number) && /Evidence from external systems/.test(p11);
  if (/No commits, CI runs or deployments recorded/.test(p11)) obstacle("In this environment no GitHub evidence can be observed (sandbox network, F-016); the trace stops at the change. The production run (evidence/production-lifecycle.json) shows the full chain.", "partial");
  verdict(traced, `incident → change link works both ways: ${traced}`);
  end();

  // W14 ─ Evaluate effectiveness and cost
  begin("W14", "Evaluate agent effectiveness and operational cost");
  await go("operator/metrics");
  await shot(app, "metrics");
  const metrics = await call<Array<{ key: string; verified: number; attempted: number }>>("agents:metrics", {}, people.otto);
  const row = await app.locator("tr", { hasText: "Ledger Reconciler (standby)" }).first().innerText();
  const m = metrics.find((x) => x.key === "agent-ledger-2")!;
  obstacle("No cost: FeltKit does not meter external agents and the deterministic agents report none; refusals are not counted.", "partial");
  verdict(row.includes(String(m.verified)) && row.includes(String(m.attempted)), `UI row "${row.replace(/\s+/g, " ")}" vs metrics attempted=${m.attempted} verified=${m.verified}`);
  end();

  // W15 ─ Revoke authority and verify refusal
  begin("W15", "Revoke authority and verify that execution is refused");
  await go("agent/agent-ledger-2");
  act(); await app.getByLabel("Reason").fill("Quarter closed; standby retired from finance work");
  act(); await app.getByRole("button", { name: "Suspend agent" }).click(); await app.waitForTimeout(1500);
  await shot(app, "suspended");
  on("terminal"); act(); const revoked = await rt.sessions.revokePrincipal("agent-ledger-2");
  const tokenAfter = await issueAgentSession("agent-ledger-2", "agent-finance");
  const attempt = startAgent(tokenAfter);
  const exit15 = await attempt.exited;
  const refusedText = attempt.log.join("").match(/stopped: .*/)?.[0] ?? attempt.log.join("").slice(-200);
  if (tokenAfter) obstacle("Nothing stopped IT from issuing a new FeltKit session to the suspended agent; only CompanyOS's own check refuses it.");
  verdict(exit15 !== 0 && /suspended/.test(refusedText), `old sessions revoked: ${revoked}; a fresh session's run exited ${exit15}: ${refusedText.trim()}`);
  end();
} catch (e) {
  obstacle(`HARNESS ERROR: ${(e as Error).message}`, "not completed");
  await shot(app, "error").catch(() => {});
  end();
} finally {
  for (const p of procs) if (p.exitCode === null) p.kill("SIGKILL");
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ recordedAt: new Date().toISOString(), commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), consoleErrors, results }, null, 2) + "\n");
  console.log("\nSUMMARY");
  for (const r of results) console.log(`${r.id} ${r.outcome.padEnd(13)} ${String(r.seconds).padStart(5)}s ${String(r.actions).padStart(3)} actions ${r.switches} switches  match=${r.matched}  ${r.workflow}`);
  await browser.close();
  await dev.close();
  rmSync(project, { recursive: true, force: true });
  r1.cleanup();
  process.exit(0);
}
