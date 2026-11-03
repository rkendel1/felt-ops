# CompanyOS agent operator guide

For people who direct and supervise CompanyOS's agents. You need the **operator** role
(Otto Lind and Ivy Brennan in the development company). Approving an agent's action also
needs the authority to perform that action yourself.

## 1. The model in one page

| Thing | Where it lives | What it tells you |
|---|---|---|
| **Agent** | CompanyOS → Agent operations → an agent card | Who it is, its purpose, runtime, provider/model, owner, its FeltKit roles, and *why* it may use each capability |
| **Assignment** (AS-0001…) | CompanyOS → Agent operations | The work you gave it: objective, context, constraints, deadline, the capabilities you permitted, whether approval is required, and how the outcome will be verified |
| **FeltKit task** | FeltKit (shown live on the assignment page) | Every consequential action the agent proposed: who proposed, who approved, whose authority it ran with, its state and outcome |
| **Approval of an agent action** | **FeltKit Studio → Agent** | The only place an agent action can be approved or rejected |
| **Verification** | The assignment page → *Verify now* | Computed from business records, never from what the agent says |

Three kinds of statement appear on an assignment, always labelled:

- **AGENT SAYS**: the agent's own report. It is not evidence.
- **RECORDED**: written by CompanyOS in the same transaction as the change, with the caller
  FeltKit authenticated. **OPERATOR** marks a person's intervention.
- **VERIFIED**: computed from records or observed from the external system (e.g. GitHub).

**Rule:** when *Agent says* and *Records check* disagree, the records win.

## 2. Where authority comes from

1. **FeltKit roles** (`agent-finance`, `agent-integration`, `agent-access`,
   `agent-engineering`) are the ceiling. They are attached to the agent's session when IT &
   Security issues it (`npx feltkit session create --type agent --id <key> --role <role>`) and
   checked on every call. The agent page's *Why it may act* table shows each capability, the
   permission it needs, and the role that grants it.
2. **Your assignment** narrows it: an agent may use a CompanyOS capability only under an
   active assignment that permits it. The assign form greys out capabilities the agent's
   roles do not grant: you cannot widen authority.
3. **Mandatory approval**: `commitments.reverse` and `org.depart` can never be run by an agent
   directly. The agent proposes; a person who may perform the action approves; it then runs
   **as the agent**, with the agent's permissions. Approval never adds authority.

## 3. Everyday tasks

**Assign work.** Agent operations → *Assign work*. Choose the agent, state the objective (what
must be true at the end), give context and constraints, set a deadline, tick only the
capabilities the work needs, keep *approval* on for anything consequential, and choose how
it is verified (`reconciliation-clean`, `supplier-link-healthy`, `departure-complete`, or
`manual`, meaning you attest).

**Start the agent.** Agents are separate processes. In development:

```bash
AGENT_TOKEN=<its session token> npx tsx agents/runner.ts --url http://localhost:3000
```

**Monitor.** *Needs your attention* lists assignments that wait for approval, failed, are
past their deadline, or claim completion. Open one to see the three lanes, the live FeltKit
actions, and *What it changed elsewhere while assigned* (incidents it opened, links it
isolated, …).

**Approve or reject an agent action.** Open FeltKit Studio (the *Studio ↗* link in the top bar
in development; an operator grant in production: `npx feltkit operator grant`), go to
**Agent**, open the task, and choose Approve or Reject. Studio shows Approve only if you
may perform the action. Then return to the assignment page: the action's state and
outcome update live.

**Intervene.** On the assignment page, write a note (always required), then:
*Suspend* (stop work under it), *Resume* (from suspended, failed or waiting), *Add context*,
*Cancel*, *Reassign* (to another agent: a new assignment carrying the context; or to a
person: a work item in “Agent takeovers”), or *Escalate* (to a person, who is notified).

**Suspend an agent entirely.** Agent page → reason → *Suspend agent*. CompanyOS refuses it at
once. Also revoke its FeltKit sessions (`npx feltkit session list`, then
`npx feltkit session revoke <ref>`) so FeltKit refuses it on every interface.

**Verify.** Assignment page → *Verify now*. A failed verification moves the assignment to
*waiting-intervention*.

## 4. After a failure

1. Do not trust the agent's last statement. Read **Records check** and the **FeltKit actions**.
2. An action in `succeeded` happened; `proposed` did not; `failed` returned an error and
   changed nothing; `interrupted` means the outcome is **unknown**. Check the records, then
   settle it in Studio (“It succeeded” / “It did not take effect”). Never re-propose it to
   “make sure”.
3. If the agent's process or session is gone: suspend the agent, cancel its FeltKit task in
   Studio (pending proposals are cancelled), then **Reassign** to the standby agent or a person.
   The new assignment's agent re-reads the records, so finished steps are not repeated;
   CompanyOS refuses a replay of a finished step (e.g. reversing an already reversed
   commitment).
4. Verify the new assignment.

## 5. Effectiveness and cost

Agent operations → *Effectiveness*: attempted, claimed done, **verified**, verification
failures, reported failures, approval waits, interventions, recoveries, median time to
verified. Token and cost figures are **reported by the agent** (FeltKit does not meter
agents); the CompanyOS agents are deterministic and report none. Refusals are visible only in
Studio → Activity.

## 6. Known limits (see docs/FELTKIT-GAP-REPORT.md)

- Agent approvals happen in Studio, not in CompanyOS.
- CompanyOS cannot see refusals or calls that changed nothing; Studio → Activity has them.
- Revoking sessions is a CLI step; in production the CLI refuses while the server runs, and
  production Studio does not manage sessions, so it requires a brief stop. Until then,
  suspending the agent in CompanyOS is what stops it there.
- Agents cannot delegate; there is no delegation primitive.
