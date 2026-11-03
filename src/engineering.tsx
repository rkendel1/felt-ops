/**
 * Product, engineering and DevOps: changes on their three paths, releases, incidents,
 * integrations, and the evidence explorer.
 */
import { useState } from "react";
import { useMutation, useQueryState } from "@feltdb/feltkit/react";
import { api } from "../feltkit/_generated/api";
import { Act, Badge, Card, Empty, Field, Page, Q, Source, Timeline, ago, can, link } from "./ui";

const KIND_LABEL: Record<string, string> = { config: "Business configuration", application: "Application change", platform: "Platform change" };
const KIND_HELP: Record<string, string> = {
  config: "A policy version: approved and effective-dated, no deployment.",
  application: "Requirements → commit → CI (observed on GitHub) → release → deployment → business acceptance.",
  platform: "Release discovery → assessment → tests → approval → upgrade → data verification. Never bundled with application changes.",
};

export function Changes({ permissions }: { permissions: string[] }) {
  const [kind, setKind] = useState<"" | "config" | "application" | "platform">("");
  const rows = useQueryState(api.changes.list, kind ? { kind } : {});
  const request = useMutation(api.changes.request);
  const [f, setF] = useState({ title: "", problem: "" });
  return (
    <Page title="Changes" subtitle="Three kinds of change, three distinct paths.">
      <div className="tabs">{(["", "config", "application", "platform"] as const).map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{k ? KIND_LABEL[k] : "All"}</button>)}</div>
      {kind && <p className="small muted">{KIND_HELP[kind]}</p>}
      {can(permissions, "changes.request") && (
        <Card title="Request an application change">
          <div className="form-row"><input aria-label="Title" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /><input aria-label="Problem" placeholder="The business problem" value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} />
            <Act kind="primary" label="Request" disabled={f.title.length < 5 || f.problem.length < 10} run={async () => { await request({ kind: "application", title: f.title, problem: f.problem }); setF({ title: "", problem: "" }); }} /></div>
          <p className="small muted">Policy changes start under Policies; platform changes are recorded by engineering.</p>
        </Card>
      )}
      <Q state={rows}>{(list) => list.length === 0 ? <Card><Empty>No changes yet.</Empty></Card> : (
        <Card><table className="table"><thead><tr><th>#</th><th>Kind</th><th>Title</th><th>Status</th></tr></thead><tbody>
          {list.map((c) => <tr key={c.id}><td><a href={link(`change/${c.id}`)}>{c.number}</a></td><td className="small">{KIND_LABEL[c.kind]}</td><td>{c.title}</td><td><Badge value={c.status} /></td></tr>)}
        </tbody></table></Card>
      )}</Q>
    </Page>
  );
}

export function ChangeDetail({ id, permissions, me }: { id: string; permissions: string[]; me: string | null }) {
  const d = useQueryState(api.changes.detail, { changeId: id });
  const advance = useMutation(api.changes.advance);
  const specify = useMutation(api.changes.specify);
  const check = useMutation(api.changes.checkCriterion);
  const [note, setNote] = useState("");
  const [spec, setSpec] = useState({ impact: "", requirements: "", acceptance: "" });
  return (
    <Q state={d}>{(x) => (
      <Page title={`${x.change.number}: ${x.change.title}`} subtitle={<><Badge value={x.change.status} /> {KIND_LABEL[x.change.kind]} · requested by {x.requestedBy} · business owner {x.businessOwner}</>}>
        <div className="grid2">
          <Card title="The change">
            <p>{x.change.problem}</p>
            {x.change.impact && <p><strong>Impact:</strong> {x.change.impact}</p>}
            {x.change.platform && <p><strong>Platform:</strong> {x.change.platform.package} {x.change.platform.from} → {x.change.platform.to}</p>}
            {x.change.requirements.length > 0 && <><h3>Requirements</h3><ul>{x.change.requirements.map((r) => <li key={r}>{r}</li>)}</ul></>}
            {x.incident && <p>Fixes incident <a href={link(`incident/${x.incident.id}`)}>{x.incident.number}</a>: {x.incident.title}</p>}
            {x.change.kind === "application" && ["requested", "assessed"].includes(x.change.status) && can(permissions, "changes.write") && (
              <div className="stack">
                <Field label="Impact"><input value={spec.impact} onChange={(e) => setSpec({ ...spec, impact: e.target.value })} /></Field>
                <Field label="Requirements (one per line)"><textarea rows={3} value={spec.requirements} onChange={(e) => setSpec({ ...spec, requirements: e.target.value })} /></Field>
                <Field label="Acceptance criteria (one per line)"><textarea rows={3} value={spec.acceptance} onChange={(e) => setSpec({ ...spec, acceptance: e.target.value })} /></Field>
                <Act kind="primary" label="Specify" run={() => specify({ changeId: id, impact: spec.impact, requirements: spec.requirements.split("\n").filter(Boolean), acceptance: spec.acceptance.split("\n").filter(Boolean) })} />
              </div>
            )}
          </Card>
          <Card title="Next steps">
            {x.next.length === 0 ? <Empty>No further transitions.</Empty> : (
              <>
                <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <ul className="next">{x.next.map((n) => <li key={n.to}><Act label={`→ ${n.to}`} disabled={!n.allowed} title={n.allowed ? "" : `Needs ${n.access}`} run={() => advance({ changeId: id, to: n.to, ...(note ? { note } : {}) })} /> <span className="small muted">{n.allowed ? "" : `needs ${n.access}`}{n.evidence ? ` · requires ${n.evidence} evidence` : ""}</span></li>)}</ul>
              </>
            )}
          </Card>
        </div>
        {x.change.acceptance.length > 0 && (
          <Card title="Acceptance criteria">
            <table className="table compact"><tbody>{x.change.acceptance.map((a, i) => <tr key={i}><td>{a.text}</td><td>{a.met === undefined ? <span className="muted">unchecked</span> : a.met ? <span className="ok">met</span> : <span className="danger">not met</span>}</td>
              <td>{(me === x.change.businessOwnerId || can(permissions, "changes.write")) && <><Act label="Met" run={() => check({ changeId: id, index: i, met: true, note: note || "Checked against the running system" })} /> <Act label="Not met" run={() => check({ changeId: id, index: i, met: false, note: note || "Does not behave as specified" })} /></>}</td></tr>)}</tbody></table>
          </Card>
        )}
        <Card title="Evidence from external systems">
          {x.refs.length === 0 ? <Empty>No commits, CI runs or deployments recorded. Observations come through the GitHub integration (the Engineering Scribe agent).</Empty> : (
            <table className="table compact"><thead><tr><th>System</th><th>Kind</th><th>Ref</th><th>Status</th><th>How it is known</th><th>When</th></tr></thead><tbody>
              {x.refs.map((r) => <tr key={r.id}><td>{r.system}</td><td>{r.kind}</td><td className="mono small">{r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.ref.slice(0, 12)}</a> : r.ref.slice(0, 16)}</td><td><Badge value={r.status.split("/").pop()} /> <span className="small">{r.status}</span></td><td>{r.observedVia === "reported" ? <Source source="assertion" /> : <Source source="verification" />} <span className="small muted">{r.observedVia.startsWith("integration:") ? "observed via integration" : r.observedVia}</span></td><td className="small muted">{ago(r.observedAt)}</td></tr>)}
            </tbody></table>
          )}
        </Card>
        {x.releases.length > 0 && <Card title="Releases">{x.releases.map((r) => <div key={r.id}>{r.version} <Badge value={r.status} /> <span className="mono small">{r.commit.slice(0, 12)}</span></div>)}</Card>}
        <Card title="History"><Timeline entries={x.history} /></Card>
      </Page>
    )}</Q>
  );
}

export function Releases() {
  const rows = useQueryState(api.changes.listReleases, {});
  const identity = useQueryState(api.changes.runtimeIdentity, {});
  return (
    <Page title="Releases" subtitle="What was released, approved, deployed and verified as running.">
      <Q state={identity}>{(i) => <Card title="This environment"><p>{i.environment} · running commit <span className="mono">{i.commit ?? "unidentified (COMPANYOS_COMMIT unset)"}</span>{i.deploymentId && <> · deployment {i.deploymentId}</>}</p></Card>}</Q>
      <Q state={rows}>{(list) => list.length === 0 ? <Card><Empty>No releases yet.</Empty></Card> : <Card><table className="table"><tbody>{list.map((r) => <tr key={r.id}><td>{r.version}</td><td><Badge value={r.status} /></td><td className="mono small">{r.commit.slice(0, 12)}</td><td className="small">{r.changeIds.length} change(s)</td><td className="small muted">{r.deployedAt ? `deployed ${ago(r.deployedAt)}` : ""}</td></tr>)}</tbody></table></Card>}</Q>
    </Page>
  );
}

export function Incidents() {
  const rows = useQueryState(api.incidents.list, {});
  return (
    <Page title="Incidents" subtitle="Production problems, their business impact, and their fixes.">
      <Q state={rows}>{(list) => list.length === 0 ? <Card><Empty>No incidents.</Empty></Card> : (
        <Card><table className="table"><thead><tr><th>#</th><th>Severity</th><th>Title</th><th>Process</th><th>Status</th><th>Opened</th></tr></thead><tbody>
          {list.map((i) => <tr key={i.id}><td><a href={link(`incident/${i.id}`)}>{i.number}</a></td><td><Badge value={i.severity} /></td><td>{i.title}</td><td>{i.process}</td><td><Badge value={i.status} /></td><td className="small muted">{ago(i.openedAt)} by {i.detectedBy}</td></tr>)}
        </tbody></table></Card>
      )}</Q>
    </Page>
  );
}

export function IncidentDetail({ id, permissions }: { id: string; permissions: string[] }) {
  const d = useQueryState(api.incidents.detail, { incidentId: id });
  const resolve = useMutation(api.incidents.resolve);
  const update = useMutation(api.incidents.update);
  const note = useMutation(api.incidents.note);
  const review = useMutation(api.incidents.review);
  const [text, setText] = useState("");
  return (
    <Q state={d}>{(x) => (
      <Page title={`${x.incident.number}: ${x.incident.title}`} subtitle={<><Badge value={x.incident.severity} /> <Badge value={x.incident.status} /> {x.incident.process} · detected by {x.incident.detectedBy} {ago(x.incident.openedAt)}</>}>
        <div className="grid2">
          <Card title="Business impact"><p>{x.incident.businessImpact}</p><p className="small">{x.incident.affected.length} affected record(s): {x.incident.affected.slice(0, 8).map((a) => <code key={a.id} className="cap">{a.collection}/{a.id.slice(0, 8)}</code>)}</p>{x.incident.rootCause && <p><strong>Root cause:</strong> {x.incident.rootCause}</p>}{x.change && <p>Fix: <a href={link(`change/${x.change.id}`)}>{x.change.number}</a> <Badge value={x.change.status} /></p>}</Card>
          <Card title="Process check (computed now)" tone={x.check.healthy === true ? "ok" : x.check.healthy === false ? "danger" : undefined}><p><strong>{x.check.summary}</strong></p><p className="small muted">Resolving requires this check to pass.</p></Card>
        </div>
        {can(permissions, "incidents.write") && (
          <Card title="Act">
            <textarea rows={2} aria-label="Note or review" placeholder="Note, root cause or post-incident review" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="btn-row">
              <Act label="Add note" disabled={text.length < 3} run={() => note({ incidentId: id, text })} />
              {x.incident.status === "open" && <Act label="Investigating" run={() => update({ incidentId: id, status: "investigating" })} />}
              <Act label="Set root cause" disabled={text.length < 3} run={() => update({ incidentId: id, rootCause: text })} />
              {!["resolved", "reviewed"].includes(x.incident.status) && <Act kind="primary" label="Resolve" run={() => resolve({ incidentId: id })} />}
              {x.incident.status === "resolved" && <Act kind="primary" label="Record review" disabled={text.length < 20} run={() => review({ incidentId: id, review: text })} />}
            </div>
          </Card>
        )}
        <Card title="Timeline"><Timeline entries={x.history} /></Card>
      </Page>
    )}</Q>
  );
}

export function Integrations() {
  const links = useQueryState(api.integrations.links, {});
  return (
    <Page title="Integrations and configuration" subtitle="External systems stay authoritative; CompanyOS records what it observed from them.">
      <Q state={links}>{(list) => list.map((l) => (
        <Card key={l.id} title={`${l.supplier} feed`} aside={<><Badge value={l.status} /> <span className="small">API {l.apiVersion}</span></>}>
          <p className="small">Synced through {new Date(l.syncedThrough).toLocaleString()} · last success {ago(l.lastSuccessAt)}{l.lastFailure && <> · last failure <span className="danger">{l.lastFailure.code}: {l.lastFailure.message}</span></>}</p>
          <Timeline entries={l.history} />
        </Card>
      ))}</Q>
      <Card title="GitHub">
        <p className="small">Commits, pull requests and Actions runs for <code>rkendel1/felt-ops</code> are read through the <code>github</code> integration (capabilities <code>github.commit</code>, <code>github.runs</code>, <code>github.pulls</code>) and recorded on the change they belong to.</p>
      </Card>
      <Card title="Platform services">
        <p className="small">Model selection, credentials, webhook endpoints, jobs and schedules are FeltKit's AppPort Services and are configured in FeltKit Studio → Services, not duplicated here.</p>
      </Card>
    </Page>
  );
}

export function Evidence() {
  const [actor, setActor] = useState("");
  const [source, setSource] = useState("");
  const rows = useQueryState(api.org.recentHistory, { ...(actor ? { actorId: actor } : {}), ...(source ? { source } : {}), limit: 200 });
  return (
    <Page title="Evidence explorer" subtitle="Who or what caused each change, and how it is known.">
      <Card>
        <div className="form-row">
          <input aria-label="Actor" placeholder="Actor (e.g. agent-ledger, maria)" value={actor} onChange={(e) => setActor(e.target.value)} />
          <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)}><option value="">All sources</option><option value="platform">Recorded</option><option value="assertion">Agent says</option><option value="verification">Verified</option><option value="operator">Operator</option></select>
        </div>
        <p className="small muted">This is CompanyOS's domain history (kept indefinitely). Every call, including refusals, is also in FeltKit's activity log (Studio → Activity; bounded, newest {20000}).</p>
      </Card>
      <Q state={rows}>{(list) => (
        <Card><table className="table compact"><thead><tr><th>When</th><th>Source</th><th>Actor</th><th>Subject</th><th>What</th></tr></thead><tbody>
          {list.map((h) => <tr key={h.id}><td className="small muted">{ago(h.at)}</td><td><Source source={h.source} /></td><td className="small">{h.actorId}</td><td className="mono small">{subjectLink(h.subject)}</td><td className="small">{h.summary}</td></tr>)}
        </tbody></table></Card>
      )}</Q>
    </Page>
  );
}

function subjectLink(subject: string) {
  const [kind, id] = subject.split(":");
  const route: Record<string, string> = { assignment: "assignment", change: "change", incident: "incident", person: "person", agent: "agent", purchase: "purchase", policy: "policy" };
  return route[kind!] ? <a href={link(`${route[kind!]}/${id}`)}>{subject.slice(0, 28)}</a> : subject.slice(0, 28);
}
