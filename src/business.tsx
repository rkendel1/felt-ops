/**
 * Business workspaces: overview, approvals, purchasing, suppliers, finance, policies,
 * customers, work, organization.
 */
import { useState } from "react";
import { useMutation, useQueryState, useFeltKit } from "@feltdb/feltkit/react";
import { api } from "../feltkit/_generated/api";
import { Act, Badge, Card, Empty, Field, Kpi, Page, Q, Timeline, ago, can, link, mcpTool, money } from "./ui";
import { useEffect } from "react";

export function Overview() {
  const dash = useQueryState(api.reports.dashboard, {});
  return (
    <Q state={dash}>{(d) => (
      <Page title="Meridian Works" subtitle={`${d.people.active} people across ${d.departments.length} departments · updated ${ago(d.at)}`}>
        <div className="kpis">
          <Kpi label="Purchase approvals pending" value={d.purchasing.pending} tone={d.purchasing.pendingOver3Days ? "warn" : undefined} href={link("approvals")} />
          <Kpi label="Committed spend" value={money(d.finance.committedTotal)} href={link("finance")} />
          <Kpi label="Invoice exceptions" value={d.finance.invoiceExceptions} tone={d.finance.invoiceExceptions ? "warn" : undefined} href={link("finance")} />
          <Kpi label="Open incidents" value={d.incidents.open} tone={d.incidents.sev1 ? "danger" : d.incidents.open ? "warn" : "ok"} href={link("incidents")} />
          <Kpi label="Customer SLA breaches" value={d.customers.slaBreached} tone={d.customers.slaBreached ? "danger" : "ok"} href={link("customers")} />
          <Kpi label="Agent work needing a person" value={d.agents.attention} tone={d.agents.attention ? "warn" : "ok"} href={link("operator")} />
          <Kpi label="Changes in flight" value={d.changes.inFlight} href={link("changes")} />
          <Kpi label="Blocked work items" value={d.work.blocked} tone={d.work.blocked ? "warn" : undefined} href={link("work")} />
        </div>
        <Card title="Departments">
          <table className="table"><thead><tr><th>Department</th><th>Headcount</th><th>Budget FY2026</th><th>Committed</th><th>Utilization</th><th>Pending requests</th></tr></thead><tbody>
            {d.departments.map((x) => (
              <tr key={x.id}><td><a href={link(`org/${x.id}`)}>{x.name}</a></td><td>{x.headcount}</td><td>{money(x.budget)}</td><td>{money(x.committed)}</td><td><div className="bar" aria-label={`${Math.round(x.utilization * 100)}%`}><span style={{ width: `${Math.min(100, x.utilization * 100)}%` }} /></div></td><td>{x.pendingRequests}</td></tr>
            ))}
          </tbody></table>
        </Card>
      </Page>
    )}</Q>
  );
}

export function Approvals({ permissions }: { permissions: string[] }) {
  const mine = useQueryState(api.purchasing.myApprovals, {});
  const policies = useQueryState(api.policies.list, {});
  const releases = useQueryState(api.changes.listReleases, {});
  const decide = useMutation(api.purchasing.decideRequest);
  const decidePolicy = useMutation(api.policies.decide);
  const approveRelease = useMutation(api.changes.approveRelease);
  const client = useFeltKit();
  const [agentPending, setAgentPending] = useState<number | null>(null);
  useEffect(() => { void mcpTool<{ tasks: Array<{ pending: number }> }>(client, "feltkit_agent_tasks", {}).then((r) => setAgentPending(r.tasks.reduce((n, t) => n + t.pending, 0))).catch(() => setAgentPending(null)); }, [client]);
  const drafts = (policies.data ?? []).flatMap((p) => p.versions.filter((v) => v.status === "draft").map((v) => ({ p, v })));
  return (
    <Page title="Approvals" subtitle="Everything waiting for a decision, and why you can (or cannot) make it.">
      <Q state={mine}>{(rows) => (
        <Card title={`Purchase requests (${rows.length})`}>
          {rows.length === 0 ? <Empty>No purchase approvals for you.</Empty> : (
            <table className="table"><thead><tr><th>Request</th><th>Supplier</th><th>Amount</th><th>Step</th><th>Your authority</th><th /></tr></thead><tbody>
              {rows.map(({ request: r, step, supplier, canDecide, why }) => (
                <tr key={r.id}><td><a href={link(`purchase/${r.id}`)}>{r.number}</a> <span className="muted">{r.description}</span></td><td>{supplier}</td><td>{money(r.amount)}</td><td>{step.label}</td><td className="small">{why}</td>
                  <td>{canDecide && <><Act kind="primary" label="Approve" run={() => decide({ requestId: r.id, decision: "approved" })} /> <Act kind="danger" label="Reject" run={() => decide({ requestId: r.id, decision: "rejected" })} /></>}</td></tr>
              ))}
            </tbody></table>
          )}
        </Card>
      )}</Q>
      <Card title={`Policy changes (${drafts.length})`}>
        {drafts.length === 0 ? <Empty>No policy drafts awaiting a decision.</Empty> : drafts.map(({ p, v }) => (
          <div key={v.id} className="row-between item"><div><a href={link(`policy/${p.id}`)}>{p.title}</a> v{v.version}, effective {new Date(v.effectiveFrom).toLocaleString()} — <span className="muted">{v.rationale}</span></div>
            {can(permissions, "policy.approve") ? <span><Act kind="primary" label="Approve" run={() => decidePolicy({ versionId: v.id, decision: "approved" })} /> <Act kind="danger" label="Reject" run={() => decidePolicy({ versionId: v.id, decision: "rejected" })} /></span> : <span className="muted small">Needs policy.approve</span>}</div>
        ))}
      </Card>
      <Card title="Releases">
        {(releases.data ?? []).filter((r) => r.status === "candidate").length === 0 ? <Empty>No release candidates awaiting approval.</Empty> : (releases.data ?? []).filter((r) => r.status === "candidate").map((r) => (
          <div key={r.id} className="row-between item"><div>{r.version} <span className="mono small">{r.commit.slice(0, 12)}</span></div>{can(permissions, "releases.approve") ? <Act kind="primary" label="Approve release" run={() => approveRelease({ releaseId: r.id })} /> : <span className="muted small">Needs releases.approve</span>}</div>
        ))}
      </Card>
      <Card title="Agent actions" tone={agentPending ? "warn" : undefined}>
        <p>{agentPending === null ? "Could not read FeltKit agent tasks." : `${agentPending} agent action(s) wait for a person.`}</p>
        <p className="small muted">Agent actions are approved in FeltKit Studio → Agent, where FeltKit checks that the approver may perform the action and runs it with the agent's own authority. CompanyOS cannot host that decision (gap G-07). See each assignment in <a href={link("operator")}>Agent operations</a> for context.</p>
      </Card>
    </Page>
  );
}

export function Purchasing() {
  const reqs = useQueryState(api.purchasing.listRequests, {});
  const suppliers = useQueryState(api.purchasing.listSuppliers, {});
  const orders = useQueryState(api.purchasing.listOrders, {});
  const submit = useMutation(api.purchasing.submitRequest);
  const [f, setF] = useState({ supplierId: "", amount: "", description: "" });
  const supName = (id: string) => suppliers.data?.find((s) => s.id === id)?.name ?? "…";
  return (
    <Page title="Purchasing" subtitle="Requests follow the purchasing policy in force when they are submitted.">
      <Card title="New purchase request">
        <div className="form-row">
          <select aria-label="Supplier" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">Supplier…</option>{(suppliers.data ?? []).filter((s) => s.status === "active").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <input aria-label="Amount" type="number" placeholder="Amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <input aria-label="Description" placeholder="What for" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <Act kind="primary" label="Submit" disabled={!f.supplierId || !Number(f.amount)} run={async () => { await submit({ supplierId: f.supplierId, amount: Number(f.amount), description: f.description }); setF({ supplierId: "", amount: "", description: "" }); }} />
        </div>
      </Card>
      <Q state={reqs}>{(rows) => (
        <Card title="Requests">
          <table className="table"><thead><tr><th>#</th><th>Supplier</th><th>Amount</th><th>Approval chain</th><th>Status</th><th>Submitted</th></tr></thead><tbody>
            {rows.slice(0, 60).map((r) => (
              <tr key={r.id}><td><a href={link(`purchase/${r.id}`)}>{r.number}</a></td><td>{supName(r.supplierId)}</td><td>{money(r.amount)}</td><td className="small">{r.steps.map((s) => `${s.label}${s.decision ? ` ✓` : ""}`).join(" → ")}</td><td><Badge value={r.status} /></td><td className="muted small">{ago(r.submittedAt)}</td></tr>
            ))}
          </tbody></table>
        </Card>
      )}</Q>
      <Q state={orders}>{(rows) => <Card title={`Purchase orders (${rows.length})`}><table className="table compact"><tbody>{rows.slice(0, 20).map((o) => <tr key={o.id}><td>{o.number}</td><td>{supName(o.supplierId)}</td><td>{money(o.amount)}</td><td><Badge value={o.status} /></td></tr>)}</tbody></table></Card>}</Q>
    </Page>
  );
}

export function PurchaseDetail({ id }: { id: string }) {
  const history = useQueryState(api.purchasing.requestHistory, { requestId: id });
  const reqs = useQueryState(api.purchasing.listRequests, {});
  const r = reqs.data?.find((x) => x.id === id);
  return (
    <Page title={r ? `${r.number} · ${money(r.amount)}` : "Purchase request"} subtitle={r ? <><Badge value={r.status} /> {r.description}</> : undefined}>
      {r && <Card title="Approval chain"><ol>{r.steps.map((s, i) => <li key={i}>{s.label}: {s.decision ? <><Badge value={s.decision} /> by {s.decidedBy} {ago(s.decidedAt)}</> : <span className="muted">waiting{s.assigneeId ? ` (expected: ${s.assigneeId})` : ""}</span>}</li>)}</ol><p className="small muted">Chain fixed by policy version {r.policyVersionId} at submission.</p></Card>}
      <Card title="History"><Q state={history}>{(h) => <Timeline entries={h} />}</Q></Card>
    </Page>
  );
}

export function Suppliers({ permissions }: { permissions: string[] }) {
  const rows = useQueryState(api.reports.supplierSummary, {});
  const request = useMutation(api.purchasing.requestSupplier);
  const start = useMutation(api.purchasing.startOnboarding);
  const check = useMutation(api.purchasing.recordCheck);
  const decide = useMutation(api.purchasing.decideOnboarding);
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <Page title="Suppliers" subtitle="New suppliers are onboarded with three checks, each by the function that owns it.">
      {can(permissions, "suppliers.request") && <Card title="Request a supplier"><div className="form-row"><input aria-label="Supplier name" placeholder="Supplier name" value={name} onChange={(e) => setName(e.target.value)} /><Act kind="primary" label="Request" disabled={name.length < 2} run={async () => { await request({ name, category: "General" }); setName(""); }} /></div></Card>}
      <Q state={rows}>{(list) => (
        <Card>
          <table className="table"><thead><tr><th>Supplier</th><th>Category</th><th>Status</th><th>Risk</th><th>Orders</th><th>Onboarding</th></tr></thead><tbody>
            {list.map((s) => {
              const done = new Set((s.onboarding ?? []).map((o) => o.step));
              return (
                <tr key={s.id}><td>{s.name}</td><td>{s.category}</td><td><Badge value={s.status} /></td><td>{s.riskTier ?? "—"}</td><td>{s.orders} ({money(s.ordered)})</td>
                  <td className="small">
                    {s.status === "requested" && <Act label="Start onboarding" run={() => start({ supplierId: s.id })} />}
                    {s.status === "onboarding" && (
                      <div className="stack">
                        {(["tax-id", "bank", "risk"] as const).map((c) => <div key={c}>{done.has(c) ? <span className="ok">✓ {c}</span> : <><input aria-label={`${c} value`} placeholder={c === "tax-id" ? "TX-123456" : c === "bank" ? "verified" : "low|medium|high"} value={values[`${s.id}${c}`] ?? ""} onChange={(e) => setValues({ ...values, [`${s.id}${c}`]: e.target.value })} /> <Act label={`Record ${c}`} run={() => check({ supplierId: s.id, check: c, value: values[`${s.id}${c}`] ?? "" })} /></>}</div>)}
                        <div><Act kind="primary" label="Approve supplier" run={() => decide({ supplierId: s.id, decision: "approved" })} /> <Act kind="danger" label="Reject" run={() => decide({ supplierId: s.id, decision: "rejected" })} /></div>
                      </div>
                    )}
                    {(s.onboarding ?? []).length > 0 && s.status !== "onboarding" && <span className="muted">{(s.onboarding ?? []).map((o) => o.step).join(" → ")}</span>}
                  </td></tr>
              );
            })}
          </tbody></table>
        </Card>
      )}</Q>
    </Page>
  );
}

export function Finance() {
  const rec = useQueryState(api.purchasing.reconciliation, {});
  const invoices = useQueryState(api.purchasing.listInvoices, {});
  const budgets = useQueryState(api.purchasing.budgetSummary, {});
  return (
    <Page title="Finance" subtitle="Reconciliation is computed from records by CompanyOS, never by an agent.">
      <Q state={rec}>{(r) => (
        <Card title="Reconciliation" tone={r.duplicates.length || r.overCommitted.length ? "danger" : "ok"}>
          <div className="kpis"><Kpi label="Open commitments" value={r.openCommitments} /><Kpi label="Committed" value={money(r.openTotal)} /><Kpi label="Duplicate commitments" value={r.duplicates.length} tone={r.duplicates.length ? "danger" : "ok"} /><Kpi label="Over-committed POs" value={r.overCommitted.length} tone={r.overCommitted.length ? "danger" : "ok"} /></div>
          {r.duplicates.length > 0 && <table className="table compact"><thead><tr><th>Duplicate commitment</th><th>Invoice</th><th>Amount</th><th>Keeps</th></tr></thead><tbody>{r.duplicates.map((d) => <tr key={d.commitmentId}><td className="mono small">{d.commitmentId}</td><td>{d.number}</td><td>{money(d.amount)}</td><td className="mono small">{d.keeps}</td></tr>)}</tbody></table>}
        </Card>
      )}</Q>
      <Q state={budgets}>{(b) => <Card title="Budgets FY2026"><table className="table compact"><tbody>{b.map((x) => <tr key={x.id}><td>{x.departmentId}</td><td>{money(x.amount)}</td><td>{money(x.committed)} committed</td><td>{money(x.remaining)} left</td></tr>)}</tbody></table></Card>}</Q>
      <Q state={invoices}>{(rows) => <Card title="Invoices"><table className="table compact"><thead><tr><th>Number</th><th>Amount</th><th>Channel</th><th>Status</th><th>Received</th></tr></thead><tbody>{rows.slice(0, 40).map((i) => <tr key={i.id}><td>{i.number}</td><td>{money(i.amount)}</td><td>{i.channel}</td><td><Badge value={i.status} /></td><td className="muted small">{ago(i.receivedAt)}</td></tr>)}</tbody></table></Card>}</Q>
    </Page>
  );
}

export function Policies({ permissions }: { permissions: string[] }) {
  const list = useQueryState(api.policies.list, {});
  return (
    <Page title="Policies" subtitle="Business configuration: versioned, approved and effective-dated. A policy change takes effect without a deployment.">
      <Q state={list}>{(rows) => rows.map((p) => (
        <Card key={p.id} title={<a href={link(`policy/${p.id}`)}>{p.title}</a>} aside={<span className="muted small">{p.key}</span>}>
          <p className="small">Drives: {p.workflows.join(", ")}. Approval needs <code>{p.approvalKind}</code>.</p>
          <table className="table compact"><tbody>{p.versions.map((v) => <tr key={v.id}><td>v{v.version}</td><td><Badge value={v.status} />{p.inForce === v.id && <span className="badge badge-ok">in force</span>}</td><td className="small">effective {new Date(v.effectiveFrom).toLocaleString()}</td><td className="small muted">{v.rationale}</td><td>{v.verification ? <Badge value={(v.verification as { ok: boolean }).ok ? "verified" : "failed"} /> : null}</td></tr>)}</tbody></table>
          {can(permissions, "policy.propose") && <a href={link(`policy/${p.id}`)}>Propose a change →</a>}
        </Card>
      ))}</Q>
    </Page>
  );
}

export function PolicyDetail({ id, permissions }: { id: string; permissions: string[] }) {
  const list = useQueryState(api.policies.list, {});
  const history = useQueryState(api.policies.policyHistory, { policyId: id });
  const propose = useMutation(api.policies.propose);
  const verify = useMutation(api.policies.verify);
  const p = list.data?.find((x) => x.id === id);
  const current = p?.versions.find((v) => v.id === p.inForce);
  const draft = p?.versions.find((v) => v.status === "draft");
  const [rules, setRules] = useState<string>("");
  const [rationale, setRationale] = useState("");
  const [effective, setEffective] = useState("");
  const impact = useQueryState(api.policies.impact, draft ? { versionId: draft.id } : "skip");
  if (!p) return <Q state={list}>{() => <Empty>No such policy.</Empty>}</Q>;
  return (
    <Page title={p.title} subtitle={`${p.key} · drives ${p.workflows.join(", ")}`}>
      <div className="grid2">
        <Card title={`In force: v${current?.version ?? "—"}`}><pre className="json">{JSON.stringify(current?.rules ?? {}, null, 2)}</pre></Card>
        {draft ? (
          <Card title={`Draft v${draft.version} — awaiting approval`} tone="warn">
            <p className="small">{draft.rationale} · effective {new Date(draft.effectiveFrom).toLocaleString()}</p>
            <Q state={impact}>{(im) => (<>
              <p className="small">Changes the approval chain for: <strong>{im.changedAmounts.map((a) => money(a)).join(", ") || "no sample amount"}</strong>. {im.openUnderCurrent} open request(s) keep the current rules. {im.note}</p>
              <table className="table compact"><thead><tr><th>Amount</th><th>Now</th><th>Proposed</th></tr></thead><tbody>{im.comparison.map((c) => <tr key={c.amount} className={c.current.join() !== c.proposed.join() ? "changed" : ""}><td>{money(c.amount)}</td><td className="small">{c.current.join(" → ")}</td><td className="small">{c.proposed.join(" → ")}</td></tr>)}</tbody></table>
            </>)}</Q>
            <p className="small muted">Decide it under <a href={link("approvals")}>Approvals</a>.</p>
          </Card>
        ) : can(permissions, "policy.propose") ? (
          <Card title="Propose a new version">
            <Field label="Rules (JSON)" hint="Start from the version in force."><textarea rows={8} className="mono" value={rules || JSON.stringify(current?.rules ?? {}, null, 2)} onChange={(e) => setRules(e.target.value)} /></Field>
            <Field label="Effective from"><input type="datetime-local" value={effective} onChange={(e) => setEffective(e.target.value)} /></Field>
            <Field label="Rationale"><input value={rationale} onChange={(e) => setRationale(e.target.value)} /></Field>
            <Act kind="primary" label="Propose" disabled={rationale.length < 10} run={() => propose({ key: p.key, rules: JSON.parse(rules || JSON.stringify(current?.rules ?? {})), effectiveFrom: effective ? new Date(effective).toISOString() : new Date().toISOString(), rationale })} />
          </Card>
        ) : <Card><Empty>You cannot propose policy changes.</Empty></Card>}
      </div>
      <Card title="Versions">
        <table className="table compact"><tbody>{p.versions.map((v) => <tr key={v.id}><td>v{v.version}</td><td><Badge value={v.status} /></td><td className="small">{v.authorId} → {v.decidedBy ?? "—"}</td><td>{v.verification ? <pre className="json small">{JSON.stringify(v.verification)}</pre> : v.status === "approved" ? <Act label="Verify behavior" run={() => verify({ versionId: v.id })} /> : null}</td></tr>)}</tbody></table>
      </Card>
      <Card title="History"><Q state={history}>{(h) => <Timeline entries={h} />}</Q></Card>
    </Page>
  );
}

export function Customers() {
  const rows = useQueryState(api.operations.customerList, {});
  const issues = useQueryState(api.operations.issues, {});
  const resolve = useMutation(api.operations.resolveIssue);
  const now = new Date().toISOString();
  return (
    <Page title="Customers" subtitle="Accounts, contracts and service commitments.">
      <Q state={issues}>{(list) => (
        <Card title="Open issues by SLA">
          {list.filter((i) => i.status === "open").length === 0 ? <Empty>No open customer issues.</Empty> : <table className="table compact"><tbody>{list.filter((i) => i.status === "open").map((i) => <tr key={i.id}><td>{i.customer}</td><td>{i.title}</td><td><Badge value={i.severity} /></td><td className={i.slaDueAt < now ? "danger" : ""}>{i.slaDueAt < now ? "SLA breached" : `due ${ago(i.slaDueAt)}`}</td><td><Act label="Resolve" run={() => resolve({ issueId: i.id })} /></td></tr>)}</tbody></table>}
        </Card>
      )}</Q>
      <Q state={rows}>{(list) => (
        <Card title="Accounts"><table className="table"><thead><tr><th>Customer</th><th>Segment</th><th>Owner</th><th>Annual value</th><th>Contracts</th><th>Issues</th><th>Status</th></tr></thead><tbody>
          {list.map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.segment}</td><td>{c.owner}</td><td>{money(c.annualValue)}</td><td className="small">{c.contracts.map((k) => <div key={k.id}>{k.title} <Badge value={k.status} /> SLA {k.slaHours} h</div>)}</td><td>{c.openIssues}{c.breachedIssues ? <span className="danger"> ({c.breachedIssues} breached)</span> : null}</td><td><Badge value={c.status} /></td></tr>)}
        </tbody></table></Card>
      )}</Q>
    </Page>
  );
}

export function Work() {
  const rows = useQueryState(api.operations.projectList, {});
  const set = useMutation(api.operations.setWorkStatus);
  return (
    <Page title="Work" subtitle="Projects, dependencies and completion evidence.">
      <Q state={rows}>{(list) => list.length === 0 ? <Empty>No projects.</Empty> : list.map((p) => (
        <Card key={p.id} title={p.name} aside={<span className="muted small">{p.kind} · {p.owner} · {p.done}/{p.items.length} done{p.overdue ? ` · ${p.overdue} overdue` : ""}</span>}>
          <table className="table compact"><tbody>{p.items.map((w) => (
            <tr key={w.id}><td>{w.title}</td><td><Badge value={w.status} /></td><td className="small">{w.assignee ?? "—"}</td><td className="small muted">{w.dueOn ?? ""}</td><td className="small">{w.blockedBy.length ? <span className="warn">waits on {w.blockedBy.length}</span> : ""}</td>
              <td>{w.status !== "done" && <><Act label="Start" run={() => set({ itemId: w.id, status: "doing" })} /> <Act label="Done" run={() => { const evidence = window.prompt("What shows it is done?") ?? ""; return set({ itemId: w.id, status: "done", ...(evidence ? { evidence } : {}) }); }} /></>}</td></tr>
          ))}</tbody></table>
        </Card>
      ))}</Q>
    </Page>
  );
}

export function Org() {
  const org = useQueryState(api.org.overview, {});
  const [q, setQ] = useState("");
  const people = useQueryState(api.org.listPeople, q.length >= 2 ? { search: q } : "skip");
  return (
    <Page title="Organization" subtitle="Departments, teams, people and explicit authority.">
      <Card title="Find a person"><input aria-label="Search people" placeholder="Name or title (2+ letters)" value={q} onChange={(e) => setQ(e.target.value)} />
        {people.data && <table className="table compact"><tbody>{people.data.slice(0, 25).map((p) => <tr key={p.id}><td><a href={link(`person/${p.id}`)}>{p.name}</a></td><td>{p.title}</td><td><Badge value={p.status} /></td></tr>)}</tbody></table>}
      </Card>
      <Q state={org}>{(depts) => (
        <div className="grid2">{depts.map((d) => (
          <Card key={d.id} title={d.name} aside={<span className="muted small">{d.active} active{d.departed ? ` · ${d.departed} left` : ""}</span>}>
            <p className="small">Head: {d.head ?? "—"} · {d.responsibilities.join(", ")}</p>
            <ul className="small">{d.teams.map((t) => <li key={t.id}>{t.name} ({t.kind}, {t.members})</li>)}</ul>
          </Card>
        ))}</div>
      )}</Q>
    </Page>
  );
}

export function Person({ id }: { id: string }) {
  const r = useQueryState(api.org.responsibilities, { personId: id });
  return (
    <Q state={r}>{(d) => (
      <Page title={d.person.name} subtitle={<><Badge value={d.person.status} /> {d.person.title}{d.person.leftOn ? ` · left ${d.person.leftOn}` : ""}</>}>
        <div className="grid2">
          <Card title="Authority grants"><table className="table compact"><tbody>{d.grants.map((g) => <tr key={g.id}><td className="mono small">{g.kind}</td><td>{g.limit !== undefined ? money(g.limit) : "no limit"}</td><td><Badge value={g.status} /></td><td className="small muted">{g.transferredFrom ? "transferred" : `granted by ${g.grantedBy}`}{g.endReason ? ` · ended: ${g.endReason}` : ""}</td></tr>)}</tbody></table></Card>
          <Card title="Responsibilities">
            <p>{d.pendingApprovals.length} pending approval(s): {d.pendingApprovals.map((a) => a.number).join(", ") || "none"}</p>
            <p>{d.openWork.length} open work item(s)</p>
            <p>Owns agents: {d.agentsOwned.map((a) => a.name).join(", ") || "none"}</p>
          </Card>
        </div>
        <Card title="History"><Timeline entries={d.history.map((h) => ({ ...h, source: "platform" }))} /></Card>
      </Page>
    )}</Q>
  );
}
