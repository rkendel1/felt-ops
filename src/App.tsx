import { useQueryState, useSession } from "@feltdb/feltkit/react";
import { api } from "../feltkit/_generated/api";

/** Placeholder while the CompanyOS workspaces are built (next commits). */
export function App() {
  const { session, signInAsDevUser } = useSession();
  const dash = useQueryState(api.reports.dashboard, session?.principal ? {} : "skip");
  if (!session?.principal) {
    return <main style={{ padding: 24 }}><h1>CompanyOS</h1>{session?.devUsers.map((u) => <button key={u.id} onClick={() => void signInAsDevUser(u.id)}>{u.name ?? u.id}</button>)}</main>;
  }
  return <main style={{ padding: 24 }}><h1>CompanyOS</h1><pre>{JSON.stringify(dash.data ?? dash.error?.message ?? "loading", null, 2)}</pre></main>;
}
