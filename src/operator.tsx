/**
 * The agent operator workspace: what needs attention, which agents are working, what they
 * may do and why, what they changed, what is verified, and what a person must do next.
 */
import { useState } from "react";
import { useMutation, useQueryState } from "@feltdb/feltkit/react";
import { api } from "../feltkit/_generated/api";
import { Act, Badge, Card, Empty, Field, Kpi, Page, Q, Source, Timeline, ago, can, link, useAgentTask, type AgentAction } from "./ui";

const CAPABILITIES = [
  "finance.reconciliation", "commitments.list", "commitments.reverse", "invoices.list", "invoices.ingest", "integrations.link", "integrations.isolate",
  "supplierapi.invoicesv1", "supplierapi.invoicesv2", "incidents.list", "incidents.open", "incidents.note", "org.people", "org.responsibilities", "org.depart",
  "changes.evidence", "github.commit", "github.runs", "github.pulls",
];
const VERIFIERS = ["reconciliation-clean", "supplier-link-healthy", "departure-complete", "manual"] as const;
const STUDIO_HINT = "Approvals of agent actions happen in FeltKit Studio → Agent (development: the Dashboard link `feltkit dev` prints; production: an operator grant). CompanyOS cannot host them (gap G-07).";

export function OperatorHome({ permissions }: { permissions: string[] }) {
  const attention = useQueryState(api.agents.attention, {});
  const agents = useQueryState(api.agents.list, {});
  const assignments = useQueryState(api.agents.listAssignments, {});
  const [filter, setFilter] = useState<string>("open");
  const open = ["assigned", "accepted", "running", "waiting-approval", "waiting-intervention", "failed", "recovering", "completed", "suspended"];
  return (
    <Page title="Agent operations" subtitle="What agents are doing, what they may do, and what has actually been verified."
      actions={can(permissions, "assignments.write") ? <a className="btn btn-primary" href={link("operator/assign")}>Assign work</a> : null}>
      <Q state={attention}>{(rows) => (
        <Card title={`Needs your attention (${rows.length})`} tone={rows.length ? "warn" : "ok"}>
          {rows.length === 0 ? <Empty>Nothing is waiting for a person.</Empty> : (
            <table className="table"><thead><tr><th>Assignment</th><th>Agent</th><th>Status</th><th>Why</th><th>Since</th></tr></thead><tbody>
              {rows.map(({ assignment: a, reason }) => (
                <tr key={a.id}><td><a href={link(`assignment/${a.id}`)}>{a.number}</a> {a.title}</td><td><a href={link(`agent/${a.agentKey}`)}>{a.agentKey}</a></td><td><Badge value={a.status} /></td><td>{reason}</td><td className="muted">{ago(a.assignedAt)}</td></tr>
              ))}
            </tbody></table>
          )}
          {rows.some((r) => r.assignment.status === "waiting-approval") && <p className="hint">{STUDIO_HINT}</p>}
        </Card>
      )}</Q>
      {can(permissions, "agents.manage") && <RegisterAgent />}
      <Q state={agents}>{(rows) => (
        <Card title="Agents" aside={<a href={link("operator/metrics")}>Effectiveness →</a>}>
          {rows.length === 0 ? <Empty>No agents are registered. IT &amp; Security registers agents with their roles; sessions are issued with <code>feltkit session create --type agent</code>.</Empty> : (
            <div className="agent-grid">
              {rows.map((a) => (
                <a key={a.key} className="agent-card" href={link(`agent/${a.key}`)}>
                  <div className="row-between"><strong>{a.name}</strong><Badge value={a.status} /></div>
                  <div className="muted small">{a.purpose}</div>
                  <div className="chips"><span>{a.active} active</span><span className={a.attention ? "chip-warn" : ""}>{a.attention} need attention</span><span>{a.verified} verified</span></div>
                  <div className="muted small">Roles: {a.roles.join(", ")} · Owner: {a.owner} · {a.provider}</div>
                </a>
              ))}
            </div>
          )}
        </Card>
      )}</Q>
      <Q state={assignments}>{(rows) => {
        const shown = rows.filter((a) => filter === "all" || (filter === "open" ? open.includes(a.status) : a.status === filter));
        return (
          <Card title="Assignments" aside={<select aria-label="Filter assignments" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="open">Open</option><option value="all">All</option>{["verified", "reassigned", "cancelled", "failed", "suspended"].map((s) => <option key={s}>{s}</option>)}</select>}>
            {shown.length === 0 ? <Empty>No assignments match.</Empty> : (
              <table className="table"><thead><tr><th>#</th><th>Title</th><th>Agent</th><th>Status</th><th>Approval</th><th>Verified by</th><th>Deadline</th></tr></thead><tbody>
                {shown.map((a) => (
                  <tr key={a.id}><td><a href={link(`assignment/${a.id}`)}>{a.number}</a></td><td>{a.title}</td><td>{a.agentKey}</td><td><Badge value={a.status} /></td><td>{a.approvalRequired ? "required" : "—"}</td><td className="muted small">{a.verifier}</td><td className="muted small">{a.deadline ? new Date(a.deadline).toLocaleDateString() : "—"}</td></tr>
                ))}
              </tbody></table>
            )}
          </Card>
        );
      }}</Q>
    </Page>
  );
}

export function AgentDetail({ agentKey, permissions }: { agentKey: string; permissions: string[] }) {
  const detail = useQueryState(api.agents.detail, { key: agentKey });
  const setStatus = useMutation(api.agents.setStatus);
  const [reason, setReason] = useState("");
  return (
    <Q state={detail}>{(d) => (
      <Page title={d.agent.name} subtitle={<><Badge value={d.agent.status} /> {d.agent.purpose}</>}>
        <div className="grid2">
          <Card title="Identity">
            <dl className="dl">
              <dt>Principal</dt><dd className="mono">{d.agent.key} (type agent)</dd>
              <dt>Runtime</dt><dd>{d.agent.runtime}</dd>
              <dt>Provider / model</dt><dd>{d.agent.provider} / {d.agent.model}</dd>
              <dt>Owner</dt><dd>{d.owner}</dd>
              <dt>Delegation</dt><dd>{d.agent.mayDelegate ? "may delegate" : "may not delegate (no platform delegation primitive)"}</dd>
              {d.agent.statusReason && <><dt>Status reason</dt><dd>{d.agent.statusReason}</dd></>}
            </dl>
            {can(permissions, "agents.manage") && (
              <div className="form-row">
                <input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
                {d.agent.status === "active"
                  ? <Act kind="danger" label="Suspend agent" disabled={reason.length < 3} confirm={`Suspend ${d.agent.name}? Its open assignments are suspended and CompanyOS refuses it at once. Revoke its FeltKit sessions too.`} run={() => setStatus({ key: agentKey, status: "suspended", reason })} />
                  : d.agent.status === "suspended" ? <Act label="Reactivate" disabled={reason.length < 3} run={() => setStatus({ key: agentKey, status: "active", reason })} /> : null}
              </div>
            )}
          </Card>
          <Card title="Why it may act">
            <p className="small muted">Authority comes from its FeltKit roles (<strong>{d.agent.roles.join(", ")}</strong>), checked on every call. An assignment can only narrow it. Consequential capabilities marked “approval” run only after a person approves.</p>
            <table className="table compact"><thead><tr><th>Capability</th><th>Needs</th><th>Allowed</th></tr></thead><tbody>
              {d.capabilities.map((c) => <tr key={c.capability}><td className="mono">{c.capability}{["commitments.reverse", "org.depart"].includes(c.capability) ? " · approval" : ""}</td><td className="mono small">{c.permission}</td><td>{c.allowed ? <span className="ok">via {c.viaRole}</span> : <span className="muted">no</span>}</td></tr>)}
            </tbody></table>
          </Card>
        </div>
        <Card title="Assignments">
          {d.assignments.length === 0 ? <Empty>No work assigned yet.</Empty> : (
            <table className="table"><tbody>{d.assignments.map((a) => <tr key={a.id}><td><a href={link(`assignment/${a.id}`)}>{a.number}</a></td><td>{a.title}</td><td><Badge value={a.status} /></td><td className="muted small">{ago(a.assignedAt)}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card title="History"><Timeline entries={d.history} /></Card>
      </Page>
    )}</Q>
  );
}

function ActionRow({ a }: { a: AgentAction }) {
  return (
    <tr>
      <td className="mono small">{a.capability}</td>
      <td className="small">{Object.entries(a.input).map(([k, v]) => `${k}: ${String(v)}`).join(", ").slice(0, 80)}</td>
      <td><Badge value={a.state} /></td>
      <td className="small">{a.proposedBy}</td>
      <td className="small">{a.decidedBy ?? "—"}</td>
      <td className="small">{a.executedAs ?? "—"}</td>
      <td className="small">{a.outcome ? (a.outcome.ok ? `ok (${a.outcome.determinedBy})` : <span className="danger">{a.outcome.error?.message}</span>) : a.interruption ?? ""}</td>
    </tr>
  );
}

export function AssignmentDetail({ id, permissions, people }: { id: string; permissions: string[]; people: Array<{ id: string; name: string }> }) {
  const detail = useQueryState(api.agents.assignmentDetail, { assignmentId: id });
  const agents = useQueryState(api.agents.list, {});
  const intervene = useMutation(api.agents.intervene);
  const reassign = useMutation(api.agents.reassign);
  const verify = useMutation(api.agents.verify);
  const [note, setNote] = useState("");
  const [to, setTo] = useState("");
  const [attest, setAttest] = useState("");
  const d = detail.data;
  const task = useAgentTask(d?.assignment.feltkitTaskId);
  const mayAct = can(permissions, "assignments.write");
  if (!d) return <Q state={detail}>{() => null}</Q>;
  const a = d.assignment;
  const said = d.history.filter((h) => h.source === "assertion");
  const recorded = d.history.filter((h) => h.source === "platform" || h.source === "operator");
  const verified = d.history.filter((h) => h.source === "verification");
  const terminal = ["verified", "cancelled", "reassigned"].includes(a.status);
  const actions = task.data?.actions ?? [];
  // Only a completion claim contradicted by the records is a disagreement; waiting is not.
  const mismatch = a.status === "completed" && d.check.ok === false;
  return (
    <Page title={`${a.number}: ${a.title}`} subtitle={<><Badge value={a.status} /> assigned to <a href={link(`agent/${a.agentKey}`)}>{d.agent?.name ?? a.agentKey}</a> {ago(a.assignedAt)}{a.reassignedTo && <> · continued as <a href={link(`assignment/${a.reassignedTo}`)}>next assignment</a></>}</>}>
      {mismatch && <div className="notice warn" role="alert"><strong>The agent claims it is done; the records disagree.</strong> Trust the records: {d.check.method} currently reports {JSON.stringify(d.check.detail)}.</div>}
      <div className="grid2">
        <Card title="The work">
          <dl className="dl">
            <dt>Objective</dt><dd>{a.objective}</dd>
            <dt>Expected output</dt><dd>{a.expectedOutput}</dd>
            <dt>Context</dt><dd className="pre">{a.context || "—"}</dd>
            <dt>Constraints</dt><dd>{a.constraints.length ? <ul>{a.constraints.map((c) => <li key={c}>{c}</li>)}</ul> : "—"}</dd>
            <dt>Deadline</dt><dd>{a.deadline ? new Date(a.deadline).toLocaleString() : "none"}</dd>
            <dt>Permitted</dt><dd>{a.permittedCapabilities.map((c) => <code key={c} className="cap">{c}</code>)}</dd>
            <dt>Approval</dt><dd>{a.approvalRequired ? "Consequential steps need a person's approval" : "Not required by the operator (capabilities may still require it)"}</dd>
            <dt>Verified by</dt><dd>{a.verifier}</dd>
            {d.reassignedChain.length > 0 && <><dt>Continues</dt><dd>{d.reassignedChain.map((c) => <a key={c.id} href={link(`assignment/${c.id}`)}>{c.number} ({c.agentKey}, {c.status}) </a>)}</dd></>}
          </dl>
        </Card>
        <Card title="Records check (computed now)" tone={d.check.ok === true ? "ok" : d.check.ok === false ? "warn" : undefined}>
          <p><strong>{d.check.ok === null ? "Verified by a person" : d.check.ok ? "Objective met according to records" : "Objective not met according to records"}</strong></p>
          <p className="small muted">{d.check.method}</p>
          <pre className="json">{JSON.stringify(d.check.detail, null, 2)}</pre>
          {a.verification && <p className="small"><Source source="verification" /> {a.verification.ok ? "Verified" : "Verification failed"} {ago(a.verification.at)} — {a.verification.method}</p>}
          {a.claim && <p className="small"><Source source="assertion" /> Agent's claim: “{a.claim}”</p>}
          {a.usage && <p className="small muted">Usage ({a.usage.source}): {a.usage.inputTokens + a.usage.outputTokens} tokens, ${a.usage.costUsd.toFixed(2)}</p>}
        </Card>
      </div>

      <LastHeard at={d.lastHeard?.at} kind={d.lastHeard?.kind} open={["accepted", "running", "waiting-approval", "recovering"].includes(a.status)} />
      <Card title="FeltKit actions" aside={a.feltkitTaskId ? <a className="small" href={`/_feltkit/#/agent/${a.feltkitTaskId}`} target="_blank" rel="noreferrer" title="Approve, reject, cancel or settle actions here. Sign in to Studio first with the link `feltkit dev` prints (production: an operator grant).">Open this task in Studio ↗</a> : null}>
        {!a.feltkitTaskId ? <Empty>The agent has not linked a FeltKit task yet (it does when it accepts).</Empty>
          : task.error ? <div className="notice error">Could not read the FeltKit task: {task.error}</div>
          : !task.data ? <div className="muted">Loading FeltKit task…</div> : (
          <>
            <p className="small muted">Read live from FeltKit (FeltDB agent state). Each action records who proposed it, who approved it, whose authority it ran with, and how its outcome was established. Task status: <Badge value={task.data.task.status} /></p>
            {actions.length === 0 ? <Empty>No consequential actions proposed.</Empty> : (
              <table className="table compact"><thead><tr><th>Capability</th><th>Input</th><th>State</th><th>Proposed by</th><th>Approved by</th><th>Ran as</th><th>Outcome</th></tr></thead><tbody>{actions.map((x) => <ActionRow key={x.actionId} a={x} />)}</tbody></table>
            )}
            {task.data.pending.length > 0 && <div className="notice warn">{task.data.pending.length} action(s) wait for approval. {STUDIO_HINT}</div>}
            {actions.some((x) => x.state === "interrupted") && <div className="notice error">An action's outcome is unknown (interrupted). Check the records, then settle it in Studio (“It succeeded” / “It did not take effect”). Never re-propose it to “make sure”.</div>}
            <details><summary className="small">Checkpoints ({task.data.checkpoints.length}) with FeltDB-verified evidence</summary>
              <ol className="small">{task.data.checkpoints.map((c) => <li key={c.version}>{c.summary} {c.evidence?.some((e) => e.verified) && <span className="ok">· evidence verified at commit</span>}</li>)}</ol>
            </details>
          </>
        )}
      </Card>

      <div className="lanes">
        <Card title={<><Source source="assertion" /> What the agent said</>}><Timeline entries={said} empty="The agent has said nothing yet." /></Card>
        <Card title={<><Source source="platform" /> What was recorded</>}><Timeline entries={recorded} /></Card>
        <Card title={<><Source source="verification" /> What was verified</>}><Timeline entries={verified} empty="Not verified yet." /></Card>
      </div>

      <Card title={<><Source source="platform" /> What it changed elsewhere while assigned</>}>
        <p className="small muted">CompanyOS records written by {a.agentKey} since this assignment started, on other subjects (incidents, integrations, finance…). Calls that changed nothing in CompanyOS, and refusals, are only in FeltKit Studio → Activity.</p>
        <Timeline entries={d.elsewhere.map((h) => ({ ...h, summary: `[${h.subject.split(":")[0]}] ${h.summary}` }))} empty="Nothing outside this assignment." />
      </Card>

      {mayAct && !terminal && (
        <Card title="Intervene">
          <Field label="Note (required for every intervention)"><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="btn-row">
            {a.status !== "suspended" && <Act label="Suspend" disabled={note.length < 3} run={() => intervene({ assignmentId: id, action: "suspend", note })} />}
            {["suspended", "failed", "waiting-intervention"].includes(a.status) && <Act label="Resume" disabled={note.length < 3} run={() => intervene({ assignmentId: id, action: "resume", note })} />}
            <Act label="Add context" disabled={note.length < 3} run={() => intervene({ assignmentId: id, action: "context", note })} />
            <Act kind="danger" label="Cancel" disabled={note.length < 3} confirm="Cancel this assignment? Cancel the FeltKit task in Studio too if actions are pending." run={() => intervene({ assignmentId: id, action: "cancel", note })} />
          </div>
          <div className="form-row">
            <select aria-label="Reassign or escalate to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Reassign or escalate to…</option>
              <optgroup label="Agents">{(agents.data ?? []).filter((x) => x.key !== a.agentKey && x.status === "active").map((x) => <option key={x.key} value={`agent:${x.key}`}>{x.name}</option>)}</optgroup>
              <optgroup label="People">{people.map((p) => <option key={p.id} value={`person:${p.id}`}>{p.name}</option>)}</optgroup>
            </select>
            <Act label="Reassign" disabled={!to || note.length < 3} run={() => reassign({ assignmentId: id, note, ...(to.startsWith("agent:") ? { toAgentKey: to.slice(6) } : { toPersonId: to.slice(7) }) })} />
            <Act label="Escalate" disabled={!to.startsWith("person:") || note.length < 3} title="Escalate to a person (keeps the assignment, waits for them)" run={() => intervene({ assignmentId: id, action: "escalate", note, escalateTo: to.slice(7) })} />
          </div>
        </Card>
      )}
      {can(permissions, "assignments.verify") && !terminal && (
        <Card title="Verify the outcome">
          <p className="small muted">Verification is computed from business records ({a.verifier}), never taken from the agent's claim.{a.verifier === "manual" && " This assignment is verified by a person: say what you checked."}</p>
          {a.verifier === "manual" && <Field label="Attestation"><input value={attest} onChange={(e) => setAttest(e.target.value)} /></Field>}
          <Act kind="primary" label="Verify now" run={() => verify({ assignmentId: id, ...(attest ? { attestation: attest } : {}) })} />
        </Card>
      )}
    </Page>
  );
}

export function AssignForm({ onDone }: { onDone: (id: string) => void }) {
  const agents = useQueryState(api.agents.list, {});
  const incidents = useQueryState(api.incidents.list, {});
  const assign = useMutation(api.agents.assign);
  const [subject, setSubject] = useState("");
  const [f, setF] = useState({ agentKey: "", title: "", objective: "", context: "", constraints: "", expectedOutput: "", deadline: "", approvalRequired: true, verifier: "manual" as (typeof VERIFIERS)[number], caps: [] as string[] });
  const agent = agents.data?.find((a) => a.key === f.agentKey);
  const permits = (cap: string) => !!agent && can(agent.permissions, permissionFor(cap));
  return (
    <Page title="Assign work to an agent" subtitle="Scope, context and authority for one piece of work. An assignment can narrow an agent's authority, never widen it.">
      <Card>
        <div className="form-grid">
          <Field label="Agent"><select value={f.agentKey} onChange={(e) => setF({ ...f, agentKey: e.target.value, caps: [] })}><option value="">Choose…</option>{(agents.data ?? []).filter((a) => a.status === "active").map((a) => <option key={a.key} value={a.key}>{a.name} — {a.roles.join(", ")}</option>)}</select></Field>
          <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Objective" hint="What must be true when the work is done."><textarea rows={2} value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} /></Field>
          <Field label="Business context"><textarea rows={2} value={f.context} onChange={(e) => setF({ ...f, context: e.target.value })} /></Field>
          <Field label="Constraints" hint="One per line."><textarea rows={2} value={f.constraints} onChange={(e) => setF({ ...f, constraints: e.target.value })} /></Field>
          <Field label="Expected output"><input value={f.expectedOutput} onChange={(e) => setF({ ...f, expectedOutput: e.target.value })} /></Field>
          <Field label="Deadline"><input type="datetime-local" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
          <Field label="Related record (optional)"><select value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">None</option>{(incidents.data ?? []).filter((i) => !["resolved", "reviewed"].includes(i.status)).map((i) => <option key={i.id} value={i.id}>{i.number}: {i.title}</option>)}</select></Field>
          <Field label="Verified by"><select value={f.verifier} onChange={(e) => setF({ ...f, verifier: e.target.value as typeof f.verifier })}>{VERIFIERS.map((v) => <option key={v}>{v}</option>)}</select></Field>
        </div>
        <fieldset className="caps"><legend>Permitted capabilities {agent ? `(greyed: ${agent.name}'s roles do not grant them)` : "(choose an agent first)"}</legend>
          {CAPABILITIES.map((c) => (
            <label key={c} className={permits(c) ? "" : "disabled"}><input type="checkbox" disabled={!permits(c)} checked={f.caps.includes(c)} onChange={(e) => setF({ ...f, caps: e.target.checked ? [...f.caps, c] : f.caps.filter((x) => x !== c) })} /> <code>{c}</code></label>
          ))}
        </fieldset>
        <label className="check"><input type="checkbox" checked={f.approvalRequired} onChange={(e) => setF({ ...f, approvalRequired: e.target.checked })} /> Consequential steps need a person's approval</label>
        <div className="btn-row">
          <Act kind="primary" label="Assign" run={async () => {
            const id = await assign({ agentKey: f.agentKey, title: f.title, objective: f.objective, context: f.context, constraints: f.constraints.split("\n").map((x) => x.trim()).filter(Boolean), expectedOutput: f.expectedOutput, ...(f.deadline ? { deadline: new Date(f.deadline).toISOString() } : {}), permittedCapabilities: f.caps, approvalRequired: f.approvalRequired, verifier: f.verifier, ...(subject ? { subject: { collection: "incidents", id: subject } } : {}) });
            onDone(id);
          }} />
        </div>
      </Card>
    </Page>
  );
}

const PERM: Record<string, string> = { "finance.reconciliation": "commitments.read", "commitments.list": "commitments.read", "commitments.reverse": "commitments.reverse", "invoices.list": "invoices.read", "invoices.ingest": "invoices.ingest", "integrations.link": "integrations.read", "integrations.isolate": "integrations.report", "incidents.list": "incidents.read", "incidents.open": "incidents.report", "incidents.note": "incidents.note", "org.people": "org.read", "org.responsibilities": "org.read", "org.depart": "org.access", "changes.evidence": "changes.evidence" };
function permissionFor(cap: string) { return PERM[cap] ?? (cap.startsWith("supplierapi.") ? "supplierapi.read" : cap.startsWith("github.") ? "github.read" : cap); }

export function Metrics() {
  const metrics = useQueryState(api.agents.metrics, {});
  return (
    <Page title="Agent effectiveness" subtitle="Business outcomes, not tool calls: an assignment counts as successful only when it is verified from records.">
      <Q state={metrics}>{(rows) => (
        <Card>
          <table className="table"><thead><tr><th>Agent</th><th>Attempted</th><th>Claimed done</th><th>Verified</th><th>Verification failed</th><th>Failures reported</th><th>Approval waits</th><th>Interventions</th><th>Recoveries</th><th>Median to verified</th><th>Tokens / cost</th></tr></thead><tbody>
            {rows.map((m) => (
              <tr key={m.key}><td><a href={link(`agent/${m.key}`)}>{m.name}</a> <Badge value={m.status} /></td><td>{m.attempted}</td><td>{m.claimedComplete}</td><td><strong>{m.verified}</strong></td><td>{m.verificationFailed}</td><td>{m.failed}</td><td>{m.approvalWaits}</td><td>{m.interventions}</td><td>{m.recoveries}</td><td>{m.medianMinutesToVerified ?? "—"}{m.medianMinutesToVerified !== null ? " min" : ""}</td><td className="small">{m.usage.inputTokens + m.usage.outputTokens} / ${m.usage.costUsd.toFixed(2)}<br /><span className="muted">{m.provider}</span></td></tr>
            ))}
          </tbody></table>
          <p className="small muted">Usage is agent-reported (FeltKit does not meter agents). Refusals are not counted here: FeltKit records denials in its activity log (Studio → Activity), which applications cannot read.</p>
        </Card>
      )}</Q>
    </Page>
  );
}

function LastHeard({ at, kind, open }: { at?: string; kind?: string; open: boolean }) {
  if (!at) return <div className="notice warn">CompanyOS has not heard from this agent yet.</div>;
  const minutes = (Date.now() - Date.parse(at)) / 60000;
  const stale = open && minutes > 10;
  return (
    <p className={`small ${stale ? "notice warn" : "muted"}`} role={stale ? "alert" : undefined}>
      Last heard from the agent {ago(at)} ({kind}).{stale && " It has open work and has been silent for more than 10 minutes: its process may have stopped. CompanyOS sees only what agents write; their reads and refusals are in Studio → Activity."}
    </p>
  );
}

const AGENT_ROLES = ["agent-finance", "agent-integration", "agent-access", "agent-engineering"];
function RegisterAgent() {
  const register = useMutation(api.agents.register);
  const people = useQueryState(api.org.listPeople, { status: "active" });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ key: "", name: "", purpose: "", runtime: "companyos-agent-runner (Node, MCP over HTTP)", provider: "none (deterministic playbook)", model: "none", role: AGENT_ROLES[0]!, ownerId: "" });
  const [done, setDone] = useState<string | null>(null);
  if (!open) return <div><button className="btn btn-secondary" onClick={() => setOpen(true)}>Register an agent</button></div>;
  return (
    <Card title="Register an agent">
      <div className="form-grid">
        <Field label="Key (its principal id)" hint="lowercase, e.g. agent-auditor"><input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} /></Field>
        <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Purpose"><input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
        <Field label="Role (its authority ceiling)"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{AGENT_ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Owner"><select value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">Choose…</option>{(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Runtime"><input value={f.runtime} onChange={(e) => setF({ ...f, runtime: e.target.value })} /></Field>
        <Field label="Provider"><input value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} /></Field>
        <Field label="Model"><input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></Field>
      </div>
      <div className="btn-row"><Act kind="primary" label="Register" run={async () => { await register({ key: f.key, name: f.name, purpose: f.purpose, runtime: f.runtime, provider: f.provider, model: f.model, roles: [f.role], ownerId: f.ownerId }); setDone(`npx feltkit session create --type agent --id ${f.key} --role ${f.role}`); }} /></div>
      {done && <div className="notice warn"><strong>Registered. It cannot act until IT &amp; Security issues its session</strong> (FeltKit keeps sessions; CompanyOS cannot issue them):<pre className="json">{done}</pre></div>}
    </Card>
  );
}

export { Kpi };
