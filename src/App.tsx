import { useEffect, useRef, useState, type FormEvent } from "react";
import { useConnectionState, useQueryState, useSession } from "@feltdb/feltkit/react";
import { api } from "../feltkit/_generated/api";
import { ThemeToggle } from "./theme";
import { Empty, Page, can, link, useRoute } from "./ui";
import { AgentDetail, AssignForm, AssignmentDetail, Metrics, OperatorHome } from "./operator";
import { Approvals, Customers, Finance, Org, Overview, Person, Policies, PolicyDetail, PurchaseDetail, Purchasing, Suppliers, Work } from "./business";
import { ChangeDetail, Changes, Evidence, IncidentDetail, Incidents, Integrations, Releases } from "./engineering";

const NAV: Array<{ group: string; items: Array<{ path: string; label: string; needs?: string }> }> = [
  { group: "Company", items: [{ path: "overview", label: "Overview" }, { path: "approvals", label: "Approvals" }, { path: "org", label: "Organization", needs: "org.read" }, { path: "work", label: "Work", needs: "work.read" }] },
  { group: "Business operations", items: [{ path: "purchasing", label: "Purchasing", needs: "purchasing.read" }, { path: "suppliers", label: "Suppliers", needs: "purchasing.read" }, { path: "finance", label: "Finance", needs: "commitments.read" }, { path: "policies", label: "Policies", needs: "policy.read" }, { path: "customers", label: "Customers", needs: "ops.read" }] },
  { group: "Product & engineering", items: [{ path: "changes", label: "Changes", needs: "changes.read" }, { path: "releases", label: "Releases", needs: "changes.read" }, { path: "incidents", label: "Incidents", needs: "incidents.read" }, { path: "integrations", label: "Integrations", needs: "integrations.read" }] },
  { group: "Agents", items: [{ path: "operator", label: "Agent operations", needs: "agents.read" }, { path: "operator/metrics", label: "Effectiveness", needs: "agents.read" }, { path: "evidence", label: "Evidence explorer", needs: "org.read" }] },
];

export function App() {
  const { session, signInAsDevUser, signIn, signOut } = useSession();
  const live = useConnectionState();
  const [route, go] = useRoute();
  const principal = session?.principal ?? null;
  const permissions = session?.permissions ?? [];
  const tried = useRef(false);
  useEffect(() => {
    if (session && !principal && session.devUsers.length && !tried.current) {
      tried.current = true;
      void signInAsDevUser(session.devUsers.find((u) => u.id === "otto")?.id ?? session.devUsers[0]!.id);
    }
  }, [session, principal, signInAsDevUser]);
  const me = useQueryState(api.org.me, principal ? {} : "skip");
  const attention = useQueryState(api.agents.attention, principal && can(permissions, "agents.read") ? {} : "skip");
  const approvals = useQueryState(api.purchasing.myApprovals, principal && can(permissions, "purchasing.read") ? {} : "skip");
  const people = useQueryState(api.org.listPeople, principal && can(permissions, "org.read") ? { status: "active" } : "skip");

  if (!session) return <div className="pad muted">Connecting…</div>;
  if (!principal) return <SignIn devUsers={session.devUsers} onDev={signInAsDevUser} onSignIn={signIn} production={session.environment.production} />;

  const [section, id] = route;
  const counts: Record<string, number> = { operator: attention.data?.length ?? 0, approvals: (approvals.data ?? []).filter((a) => a.canDecide).length };
  const view = () => {
    switch (section) {
      case "overview": return <Overview />;
      case "approvals": return <Approvals permissions={permissions} />;
      case "org": return <Org />;
      case "person": return <Person id={id!} />;
      case "work": return <Work />;
      case "purchasing": return <Purchasing />;
      case "purchase": return <PurchaseDetail id={id!} />;
      case "suppliers": return <Suppliers permissions={permissions} />;
      case "finance": return <Finance />;
      case "policies": return <Policies permissions={permissions} />;
      case "policy": return <PolicyDetail id={id!} permissions={permissions} />;
      case "customers": return <Customers />;
      case "changes": return <Changes permissions={permissions} />;
      case "change": return <ChangeDetail id={id!} permissions={permissions} me={me.data?.person?.id ?? null} />;
      case "releases": return <Releases />;
      case "incidents": return <Incidents />;
      case "incident": return <IncidentDetail id={id!} permissions={permissions} />;
      case "integrations": return <Integrations />;
      case "evidence": return <Evidence />;
      case "operator": return id === "assign" ? <AssignForm onDone={(newId) => go(`assignment/${newId}`)} /> : id === "metrics" ? <Metrics /> : <OperatorHome permissions={permissions} />;
      case "agent": return <AgentDetail agentKey={id!} permissions={permissions} />;
      case "assignment": return <AssignmentDetail id={id!} permissions={permissions} people={(people.data ?? []).map((p) => ({ id: p.id, name: p.name }))} />;
      default: return <Page title="Not found"><Empty>No page at #{route.join("/")}.</Empty></Page>;
    }
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><span className="logo" aria-hidden>◆</span> CompanyOS <span className={`env${session.environment.production ? " env-prod" : ""}`}>{session.environment.name}</span></div>
        <div className="topbar-right">
          <span className={`live${live ? " on" : ""}`} title={live ? "Live updates connected" : "Reconnecting"}><span className="dot" /> {live ? "Live" : "Offline"}</span>
          {session.dashboard && <a className="dashboard-link" href={session.dashboard} target="_blank" rel="noreferrer" title="FeltKit Studio: agent approvals, activity, services">Studio ↗</a>}
          {session.devUsers.length > 0 ? (
            <label className="identity"><span className="sr-only">Acting as</span>
              <select value={principal.id} onChange={(e) => void signInAsDevUser(e.target.value)}>
                {session.devUsers.filter((u) => u.type !== "agent").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          ) : <span className="small">{principal.displayName ?? principal.id} <button className="btn btn-secondary" onClick={() => void signOut()}>Sign out</button></span>}
          <ThemeToggle />
        </div>
      </header>
      {me.error && <div className="notice error" role="alert">{me.error.message}</div>}
      <div className="workspace">
        <nav className="sidebar" aria-label="Workspaces">
          {NAV.map((g) => {
            const items = g.items.filter((i) => !i.needs || can(permissions, i.needs));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="sidebar-title">{g.group}</div>
                {items.map((i) => (
                  <a key={i.path} className={`nav${route.join("/") === i.path || (section === i.path && !id) ? " active" : ""}`} href={link(i.path)}>
                    <span>{i.label}</span>{counts[i.path] ? <span className="count-badge">{counts[i.path]}</span> : null}
                  </a>
                ))}
              </div>
            );
          })}
          <div className="whoami small muted">
            {me.data?.person ? <>{me.data.person.name}<br />{me.data.person.title}</> : principal.id}
            <br />Roles: {principal.roles.join(", ")}
          </div>
        </nav>
        <main className="main">{view()}</main>
      </div>
    </div>
  );
}

function SignIn({ devUsers, onDev, onSignIn, production }: { devUsers: Array<{ id: string; name: string; type: string }>; onDev: (id: string) => Promise<void>; onSignIn: (i: { email: string; password: string }) => Promise<void>; production: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => { e.preventDefault(); setError(null); try { await onSignIn({ email, password }); } catch (err) { setError((err as Error).message); } };
  return (
    <main className="signin">
      <h1>CompanyOS</h1>
      {devUsers.length > 0 && <div className="stack">{devUsers.filter((u) => u.type !== "agent").map((u) => <button key={u.id} className="btn btn-secondary" onClick={() => void onDev(u.id)}>{u.name}</button>)}</div>}
      {(production || devUsers.length === 0) && (
        <form onSubmit={submit} className="stack">
          <label className="field"><span>E-mail</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="btn btn-primary" type="submit">Sign in</button>
          {error && <div className="notice error">{error}</div>}
        </form>
      )}
    </main>
  );
}
