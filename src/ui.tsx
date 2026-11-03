/**
 * Shared UI: layout primitives, status badges, the provenance tag that separates what an
 * agent said from what the platform recorded and what was verified, and a mutation button
 * that shows the server's own refusal.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useFeltKit, type FeltKitClientError } from "@feltdb/feltkit/react";

export function useRoute(): [string[], (path: string) => void] {
  const read = () => (window.location.hash.replace(/^#\/?/, "") || "overview").split("/").map(decodeURIComponent);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [route, (path: string) => { window.location.hash = `/${path}`; }];
}

export const link = (path: string) => `#/${path}`;

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="page">
      <header className="page-head">
        <div><h1>{title}</h1>{subtitle && <p className="muted sub">{subtitle}</p>}</div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Card({ title, aside, children, tone }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; tone?: "warn" | "danger" | "ok" }) {
  return (
    <div className={`card${tone ? ` card-${tone}` : ""}`}>
      {(title || aside) && <div className="card-head"><h2>{title}</h2>{aside}</div>}
      {children}
    </div>
  );
}

const TONES: Record<string, string> = {
  active: "ok", healthy: "ok", verified: "ok", succeeded: "ok", approved: "ok", ordered: "ok", matched: "ok", resolved: "ok", reviewed: "ok", accepted: "ok", done: "ok", live: "ok", passed: "ok", "ci-passed": "ok", deployed: "ok", completed: "info",
  running: "info", accepted_: "info", assigned: "info", recovering: "info", doing: "info", investigating: "info", "in-review": "info", "in-development": "info", scheduled: "info", proposed: "info", executing: "info", candidate: "info", onboarding: "info", requested: "info", draft: "info", open: "warn",
  "waiting-approval": "warn", "waiting-intervention": "warn", pending: "warn", failing: "warn", blocked: "warn", exception: "warn", mitigated: "warn", "on-leave": "warn", interrupted: "warn", "renewal-due": "warn", "at-risk": "warn",
  failed: "danger", suspended: "danger", isolated: "danger", rejected: "danger", departed: "muted", cancelled: "muted", reassigned: "muted", reversed: "muted", void: "muted", retired: "muted", ended: "muted", sev1: "danger", sev2: "warn", sev3: "info",
};
export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <span className={`badge badge-${TONES[value] ?? "muted"}`}>{value}</span>;
}

const SOURCE: Record<string, { label: string; title: string }> = {
  assertion: { label: "Agent says", title: "The agent's own statement. Not evidence." },
  platform: { label: "Recorded", title: "Recorded by CompanyOS in the same transaction as the change, with the caller FeltKit authenticated." },
  verification: { label: "Verified", title: "Computed from records or observed from the external system, independently of the actor." },
  operator: { label: "Operator", title: "A person's intervention." },
};
export function Source({ source }: { source: string }) {
  const s = SOURCE[source] ?? { label: source, title: source };
  return <span className={`source source-${source}`} title={s.title}>{s.label}</span>;
}

export interface TimelineEntry { at: string; actorId: string; actorType?: string; source: string; kind: string; summary: string }
export function Timeline({ entries, empty = "Nothing recorded yet." }: { entries: TimelineEntry[] | undefined; empty?: string }) {
  if (!entries) return <Loading />;
  if (!entries.length) return <Empty>{empty}</Empty>;
  return (
    <ol className="timeline">
      {entries.map((e, i) => (
        <li key={i} className={`tl tl-${e.source}`}>
          <div className="tl-meta"><Source source={e.source} /><span className="mono">{e.kind}</span><span className="muted">{e.actorId}{e.actorType === "agent" ? " (agent)" : ""}</span><time className="muted" title={e.at}>{ago(e.at)}</time></div>
          <div>{e.summary}</div>
        </li>
      ))}
    </ol>
  );
}

export function Loading() { return <div className="muted pad" role="status">Loading…</div>; }
export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }
export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as FeltKitClientError;
  return <div className="notice error" role="alert"><strong>{e.code ?? "Error"}</strong> {e.message ?? String(error)}</div>;
}

/** A query's state: loading, error, or its data. */
export function Q<T>({ state, children }: { state: { data: T | undefined; error: unknown; isLoading: boolean }; children: (data: T) => ReactNode }) {
  if (state.error) return <ErrorBox error={state.error} />;
  if (state.data === undefined) return <Loading />;
  return <>{children(state.data)}</>;
}

/** Runs an action and shows the server's answer (including refusals) next to it. */
export function Act({ label, run, confirm, kind = "secondary", disabled, title }: { label: string; run: () => Promise<unknown>; confirm?: string; kind?: "primary" | "secondary" | "danger"; disabled?: boolean; title?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="act">
      <button className={`btn btn-${kind}`} disabled={busy || disabled} title={title} onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true); setMsg(null);
        try { await run(); setMsg({ ok: true, text: "Done" }); setTimeout(() => setMsg(null), 2500); }
        catch (e) { const err = e as FeltKitClientError; setMsg({ ok: false, text: `${err.code ?? "Error"}: ${err.message}` }); }
        finally { setBusy(false); }
      }}>{busy ? "…" : label}</button>
      {msg && <span className={msg.ok ? "act-ok" : "act-err"} role={msg.ok ? "status" : "alert"}>{msg.text}</span>}
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small className="muted">{hint}</small>}</label>;
}

export function money(n: number | undefined | null) {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
export function ago(iso?: string | null) {
  if (!iso) return "—";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (Math.abs(s) < 60) return "just now";
  const units: Array<[number, string]> = [[60, "min"], [3600, "h"], [86400, "d"]];
  if (s < 0) return `in ${Math.round(-s / 3600)} h`;
  const [div, u] = s < 3600 ? units[0]! : s < 86400 ? units[1]! : units[2]!;
  return `${Math.round(s / div)} ${u} ago`;
}
export function Kpi({ label, value, tone, href }: { label: string; value: ReactNode; tone?: "warn" | "danger" | "ok"; href?: string }) {
  const body = <><div className="kpi-value">{value}</div><div className="kpi-label">{label}</div></>;
  return href ? <a className={`kpi kpi-${tone ?? "plain"}`} href={href}>{body}</a> : <div className={`kpi kpi-${tone ?? "plain"}`}>{body}</div>;
}

export function can(granted: readonly string[] | undefined, permission: string) {
  return (granted ?? []).some((g) => g === "*" || g === permission || (g.endsWith(".*") && permission.startsWith(g.slice(0, -1))));
}

/**
 * FeltKit agent state, read through the application's /mcp endpoint with the signed-in
 * person's own session (application code cannot read it otherwise; gap G-07).
 */
export function useAgentTask(taskId: string | undefined, refreshMs = 3000) {
  const client = useFeltKit();
  const [state, setState] = useState<{ data?: AgentTaskView; error?: string }>({});
  useEffect(() => {
    if (!taskId) return;
    let stop = false;
    const load = async () => {
      try {
        const data = await mcpTool<AgentTaskView>(client, "feltkit_agent_get", { taskId });
        if (!stop) setState({ data });
      } catch (e) { if (!stop) setState({ error: (e as Error).message }); }
    };
    void load();
    const timer = setInterval(load, refreshMs);
    return () => { stop = true; clearInterval(timer); };
  }, [client, taskId, refreshMs]);
  return state;
}

export async function mcpTool<T>(client: ReturnType<typeof useFeltKit>, name: string, args: Record<string, unknown>): Promise<T> {
  const token = (client as unknown as { tokens: { get(): string | null } }).tokens.get();
  const res = await fetch("/mcp", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const body = await res.json() as { result?: { isError?: boolean; content?: Array<{ text: string }>; structuredContent?: { result?: T } }; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  if (body.result?.isError) throw new Error(body.result.content?.[0]?.text ?? "MCP error");
  return (body.result?.structuredContent?.result ?? JSON.parse(body.result?.content?.[0]?.text ?? "null")) as T;
}

export interface AgentAction { actionId: string; capability: string; state: string; input: Record<string, unknown>; reason: string; proposedBy: string; proposedAt: string; decidedBy?: string; decidedAt?: string; executedAs?: string; outcome?: { ok: boolean; error?: { code: string; message: string }; determinedBy: string; activityId?: string }; interruption?: string; history: Array<{ state: string; at: string; by: string; note?: string }> }
export interface AgentTaskView { task: { task_id: string; objective: string; status: string; owner: string; checkpoint_version: number }; checkpoints: Array<{ version: number; summary: string; created_at: string; evidence?: Array<{ verified?: boolean; description?: string }> }>; pending: AgentAction[]; actions: AgentAction[] }
