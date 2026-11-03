/**
 * CompanyOS: the application definition.
 *
 * One FeltDB instance per environment holds everything below. Platform authority (who may
 * call which capability) is FeltKit roles. Business authority (who may approve what, up to
 * which amount, for which department) is the `authorities` collection, evaluated inside the
 * mutations that need it: FeltKit has no resource-attribute authorization (see
 * docs/FELTKIT-GAP-REPORT.md, G-06). Approval of agent actions is FeltKit's own
 * (`approval: "required"` + AgentHost); CompanyOS never re-implements it.
 */
import { feltkit, s } from "@feltdb/feltkit";

const BASE = [
  "org.read", "ops.read", "work.read", "work.write", "policy.read", "policy.acknowledge",
  "purchasing.read", "purchasing.request", "purchasing.approve", "changes.read", "changes.request", "incidents.read",
  "agents.read", "feltkit.agent.read", "notifications.*", "files.read",
];

export const app = feltkit({
  name: "companyos",
  version: "0.1.0",
  description: "CompanyOS: a living business and software operations platform.",
  roles: {
    // People. A person may hold several roles; business limits live in `authorities`.
    staff: BASE,
    finance: [...BASE, "finance.*", "purchasing.approve", "policy.propose", "invoices.*", "commitments.*", "feltkit.agent.write"],
    procurement: [...BASE, "suppliers.*", "purchasing.*", "invoices.read", "integrations.read", "supplierapi.*"],
    operations: [...BASE, "customers.*", "ops.*", "suppliers.read", "suppliers.request"],
    product: [...BASE, "changes.*", "work.*"],
    engineering: [...BASE, "changes.read", "changes.engineer", "changes.evidence", "releases.*", "integrations.*", "supplierapi.*", "github.*", "incidents.*"],
    itsec: [...BASE, "org.access", "incidents.*", "agents.manage", "integrations.*", "supplierapi.*"],
    executive: [...BASE, "finance.read", "purchasing.approve", "policy.approve", "changes.approve", "releases.approve", "org.manage", "invoices.read", "commitments.read"],
    // Agent operators: assign, suspend, reassign, verify. Approving an agent's FeltKit action
    // additionally needs the action's own permission (FeltKit checks the approver).
    operator: [...BASE, "agents.*", "assignments.*", "feltkit.agent.*"],
    auditor: ["org.read", "ops.read", "work.read", "policy.read", "purchasing.read", "changes.read", "incidents.read", "agents.read", "finance.read", "invoices.read", "commitments.read", "feltkit.agent.read"],
    // Platform administration (Studio → Services).
    admin: ["org.admin", "intelligence.*", "credential.*", "configuration.*", "apikeys.*", "webhooks.*", "jobs.*", "schedules.*", "feltkit.operations.*"],
    // Agents. Narrow by design: each holds what its purpose needs, never `*.approve`.
    "agent-finance": ["org.read", "purchasing.read", "invoices.read", "commitments.read", "commitments.reverse", "finance.read", "incidents.read", "incidents.note", "assignments.work", "agents.read", "feltkit.agent.*"],
    "agent-integration": ["org.read", "suppliers.read", "invoices.read", "invoices.ingest", "integrations.read", "integrations.report", "supplierapi.*", "incidents.read", "incidents.report", "incidents.note", "assignments.work", "agents.read", "feltkit.agent.*"],
    "agent-access": ["org.read", "org.access", "purchasing.read", "work.read", "assignments.work", "agents.read", "feltkit.agent.*"],
    "agent-engineering": ["changes.read", "changes.evidence", "github.*", "incidents.read", "assignments.work", "agents.read", "feltkit.agent.*"],
  },
  auth: { accounts: { roles: ["staff"], signUp: false } },
  dev: {
    users: [
      { id: "omar", name: "Omar Haddad (CEO)", roles: ["staff", "executive"] },
      { id: "maria", name: "Maria Chen (CFO)", roles: ["staff", "executive", "finance"] },
      { id: "fiona", name: "Fiona Walsh (Finance Manager)", roles: ["staff", "finance"] },
      { id: "rhea", name: "Rhea Das (Senior Accountant)", roles: ["staff", "finance"] },
      { id: "priya", name: "Priya Nair (Operations Director)", roles: ["staff", "operations"] },
      { id: "pablo", name: "Pablo Ruiz (Procurement Lead)", roles: ["staff", "procurement"] },
      { id: "dana", name: "Dana Kim (Product Manager)", roles: ["staff", "product"] },
      { id: "eli", name: "Eli Novak (Engineering Lead)", roles: ["staff", "engineering"] },
      { id: "sam", name: "Sam Osei (Engineer)", roles: ["staff", "engineering"] },
      { id: "ivy", name: "Ivy Brennan (IT & Security Manager)", roles: ["staff", "itsec", "operator", "admin"] },
      { id: "otto", name: "Otto Lind (Agent Operator)", roles: ["staff", "operator", "finance"] },
      { id: "vic", name: "Vic Moreau (External Auditor)", roles: ["auditor"] },
      { id: "agent-ledger", name: "Ledger Reconciler", type: "agent", roles: ["agent-finance"] },
      { id: "agent-ledger-2", name: "Ledger Reconciler (standby)", type: "agent", roles: ["agent-finance"] },
      { id: "agent-sentry", name: "Integration Sentry", type: "agent", roles: ["agent-integration"] },
      { id: "agent-steward", name: "Access Steward", type: "agent", roles: ["agent-access"] },
      { id: "agent-scribe", name: "Engineering Scribe", type: "agent", roles: ["agent-engineering"] },
    ],
  },
  services: {
    files: true,
    notifications: { types: ["approval.requested", "assignment.attention", "incident.opened", "policy.effective"] },
    configuration: true,
    apiKeys: { roles: ["auditor"] },
    webhooks: { events: ["purchase.approved", "incident.opened", "incident.resolved", "change.released"] },
    jobs: { handlers: { "agents.sweep": "agents:sweepDeadlines" } },
    schedules: true,
    intelligence: true,
  },
  activity: { retain: 20000 },
});

// ───────────────────────── Organization and identity ─────────────────────────

export const departments = app.collection("departments", {
  code: s.string({ minLength: 2, maxLength: 12 }),
  name: s.string(),
  responsibilities: s.array(s.string()),
  headId: s.optional(s.string()),
}, { unique: [["code"]] });

export const teams = app.collection("teams", {
  name: s.string(),
  departmentId: s.string(),
  kind: s.enum(["operating", "product", "management"]),
  leadId: s.optional(s.string()),
}, { unique: [["name"]] });

export const people = app.collection("people", {
  /** The FeltKit principal id this person signs in as, when they have one. */
  login: s.optional(s.string()),
  name: s.string(),
  email: s.string(),
  title: s.string(),
  departmentId: s.string(),
  teamId: s.optional(s.string()),
  managerId: s.optional(s.string()),
  status: s.enum(["active", "on-leave", "departed"]),
  startedOn: s.string(),
  leftOn: s.optional(s.string()),
}, { unique: [["email"], { fields: ["login"], sparse: true }], indexes: [{ fields: ["departmentId"] }, { fields: ["status"] }] });

/**
 * Explicit business authority: who may approve what, up to which amount, for which
 * department. Never deleted: ended grants keep who ended them and why.
 */
export const authorities = app.collection("authorities", {
  holderId: s.string(),
  holderType: s.enum(["person", "agent"]),
  kind: s.string(),
  limit: s.optional(s.number()),
  departmentId: s.optional(s.string()),
  status: s.enum(["active", "ended"]),
  grantedBy: s.string(),
  grantedAt: s.string(),
  /** When this grant was transferred from another holder's grant. */
  transferredFrom: s.optional(s.string()),
  endedAt: s.optional(s.string()),
  endedBy: s.optional(s.string()),
  endReason: s.optional(s.string()),
}, { indexes: [{ fields: ["holderId", "status"] }, { fields: ["kind", "status"] }] });

// ───────────────────────── Customers and commerce ─────────────────────────

export const customers = app.collection("customers", {
  name: s.string(),
  segment: s.enum(["enterprise", "mid-market", "public-sector"]),
  ownerId: s.string(),
  status: s.enum(["active", "at-risk", "churned"]),
}, { unique: [["name"]] });

export const contracts = app.collection("contracts", {
  customerId: s.string(),
  title: s.string(),
  annualValue: s.number(),
  startsOn: s.string(),
  endsOn: s.string(),
  slaHours: s.number(),
  status: s.enum(["active", "renewal-due", "expired"]),
}, { indexes: [{ fields: ["customerId"] }] });

export const customerIssues = app.collection("customerIssues", {
  customerId: s.string(),
  contractId: s.optional(s.string()),
  title: s.string(),
  severity: s.enum(["low", "medium", "high"]),
  status: s.enum(["open", "resolved"]),
  openedAt: s.string(),
  slaDueAt: s.string(),
  resolvedAt: s.optional(s.string()),
  incidentId: s.optional(s.string()),
});

// ───────────────────────── Procurement and finance ─────────────────────────

export const suppliers = app.collection("suppliers", {
  name: s.string(),
  category: s.string(),
  status: s.enum(["requested", "onboarding", "active", "suspended", "rejected"]),
  riskTier: s.optional(s.enum(["low", "medium", "high"])),
  taxId: s.optional(s.string()),
  bankVerified: s.optional(s.boolean()),
  requestedBy: s.optional(s.string()),
  /** Supplier onboarding workflow (CR-0002): each check, who did it, and when. */
  onboarding: s.optional(s.array(s.object({ step: s.string(), by: s.string(), at: s.string(), note: s.optional(s.string()) }))),
}, { unique: [["name"]] });

export const budgets = app.collection("budgets", {
  departmentId: s.string(),
  fiscalYear: s.number(),
  amount: s.number(),
}, { unique: [["departmentId", "fiscalYear"]] });

const Step = s.object({
  kind: s.string(),
  label: s.string(),
  departmentId: s.optional(s.string()),
  /** Who the business expects to act (may be reassigned). */
  assigneeId: s.optional(s.string()),
  decision: s.optional(s.enum(["approved", "rejected"])),
  decidedBy: s.optional(s.string()),
  decidedAt: s.optional(s.string()),
  note: s.optional(s.string()),
});

export const purchaseRequests = app.collection("purchaseRequests", {
  number: s.string(),
  departmentId: s.string(),
  supplierId: s.string(),
  requesterId: s.string(),
  amount: s.number({ minimum: 0.01 }),
  description: s.string({ minLength: 3 }),
  status: s.enum(["pending", "approved", "rejected", "ordered", "cancelled"]),
  /** The policy version in force at submission decides the approval chain, permanently. */
  policyVersionId: s.string(),
  steps: s.array(Step),
  submittedAt: s.string(),
}, { unique: [["number"]], indexes: [{ fields: ["status"] }] });

export const purchaseOrders = app.collection("purchaseOrders", {
  number: s.string(),
  requestId: s.string(),
  supplierId: s.string(),
  departmentId: s.string(),
  amount: s.number(),
  status: s.enum(["issued", "received", "closed"]),
  issuedAt: s.string(),
}, { unique: [["number"], ["requestId"]] });

export const receipts = app.collection("receipts", {
  poId: s.string(),
  receivedBy: s.string(),
  amount: s.number(),
  at: s.string(),
});

export const invoices = app.collection("invoices", {
  supplierId: s.string(),
  poId: s.optional(s.string()),
  number: s.string(),
  amount: s.number(),
  channel: s.enum(["manual", "supplier-feed"]),
  /** The supplier feed's identifier for the delivery that carried it. */
  externalId: s.optional(s.string()),
  status: s.enum(["received", "matched", "exception", "void"]),
  receivedAt: s.string(),
  enteredBy: s.string(),
}, { indexes: [{ fields: ["supplierId", "number"] }, { fields: ["poId"] }] });

export const commitments = app.collection("commitments", {
  departmentId: s.string(),
  poId: s.string(),
  invoiceId: s.string(),
  amount: s.number(),
  status: s.enum(["open", "reversed"]),
  createdAt: s.string(),
  reversedAt: s.optional(s.string()),
  reversedBy: s.optional(s.string()),
  reversalReason: s.optional(s.string()),
  incidentId: s.optional(s.string()),
}, { indexes: [{ fields: ["poId"] }, { fields: ["invoiceId"] }] });

// ───────────────────────── Policies (business configuration) ─────────────────────────

export const policies = app.collection("policies", {
  key: s.string(),
  title: s.string(),
  ownerDepartmentId: s.string(),
  /** Workflows whose behavior the policy's rules drive. */
  workflows: s.array(s.string()),
  /** Authority kind needed to approve a new version. */
  approvalKind: s.string(),
}, { unique: [["key"]] });

export const policyVersions = app.collection("policyVersions", {
  policyId: s.string(),
  version: s.number(),
  rules: s.record(s.unknown()),
  rationale: s.string(),
  effectiveFrom: s.string(),
  status: s.enum(["draft", "approved", "rejected"]),
  authorId: s.string(),
  decidedBy: s.optional(s.string()),
  decidedAt: s.optional(s.string()),
  verification: s.optional(s.record(s.unknown())),
}, { unique: [["policyId", "version"]] });

export const policyAcks = app.collection("policyAcks", {
  policyVersionId: s.string(),
  personId: s.string(),
  at: s.string(),
}, { unique: [["policyVersionId", "personId"]] });

// ───────────────────────── Work management ─────────────────────────

export const projects = app.collection("projects", {
  name: s.string(),
  kind: s.enum(["business", "engineering"]),
  ownerId: s.string(),
  teamId: s.optional(s.string()),
  status: s.enum(["active", "done", "on-hold"]),
}, { unique: [["name"]] });

export const workItems = app.collection("workItems", {
  projectId: s.string(),
  title: s.string(),
  status: s.enum(["todo", "doing", "blocked", "done"]),
  assigneeId: s.optional(s.string()),
  dueOn: s.optional(s.string()),
  dependsOn: s.array(s.string()),
  changeId: s.optional(s.string()),
  evidence: s.optional(s.string()),
}, { indexes: [{ fields: ["projectId"] }, { fields: ["assigneeId"] }] });

// ───────────────────────── Product, engineering, DevOps ─────────────────────────

/**
 * A change to the business or its software. `kind` keeps the three paths apart:
 *   config       business configuration (a policy version): no deployment
 *   application  code: requirements → PR → CI → review → release → deploy → acceptance
 *   platform     a FeltKit / FeltDB / AppPort upgrade: assessment → test → migration → deploy
 */
export const changes = app.collection("changes", {
  number: s.string(),
  kind: s.enum(["config", "application", "platform"]),
  title: s.string(),
  problem: s.string(),
  requestedBy: s.string(),
  businessOwnerId: s.string(),
  status: s.string(),
  impact: s.optional(s.string()),
  requirements: s.array(s.string()),
  acceptance: s.array(s.object({ text: s.string(), met: s.optional(s.boolean()), checkedBy: s.optional(s.string()) })),
  incidentId: s.optional(s.string()),
  policyVersionId: s.optional(s.string()),
  /** Platform changes: the package and versions. */
  platform: s.optional(s.object({ package: s.string(), from: s.string(), to: s.string() })),
}, { unique: [["number"]], indexes: [{ fields: ["kind", "status"] }] });

/**
 * Something an external system holds (a commit, CI run, pull request, deployment), as
 * CompanyOS observed it. `observedVia` says how: an integration call id (verified against
 * the system) or "reported" (someone's statement, not verified).
 */
export const externalRefs = app.collection("externalRefs", {
  subject: s.string(),
  system: s.enum(["github", "github-actions", "local-production", "fly", "vercel", "npm", "supplier"]),
  kind: s.string(),
  ref: s.string(),
  url: s.optional(s.string()),
  status: s.string(),
  observedAt: s.string(),
  observedBy: s.string(),
  observedVia: s.string(),
  detail: s.optional(s.record(s.unknown())),
}, { indexes: [{ fields: ["subject"] }] });

export const releases = app.collection("releases", {
  version: s.string(),
  changeIds: s.array(s.string()),
  status: s.enum(["candidate", "approved", "deployed", "verified", "rolled-back"]),
  commit: s.string(),
  approvedBy: s.optional(s.string()),
  deployedAt: s.optional(s.string()),
  receipt: s.optional(s.record(s.unknown())),
}, { unique: [["version"]] });

export const incidents = app.collection("incidents", {
  number: s.string(),
  title: s.string(),
  severity: s.enum(["sev1", "sev2", "sev3"]),
  status: s.enum(["open", "investigating", "mitigated", "resolved", "reviewed"]),
  process: s.string(),
  businessImpact: s.string(),
  affected: s.array(s.object({ collection: s.string(), id: s.string() })),
  detectedBy: s.string(),
  ownerId: s.optional(s.string()),
  openedAt: s.string(),
  changeId: s.optional(s.string()),
  rootCause: s.optional(s.string()),
  verification: s.optional(s.record(s.unknown())),
  review: s.optional(s.string()),
}, { unique: [["number"]] });

/** The live state of each supplier's integration link. */
export const supplierLinks = app.collection("supplierLinks", {
  supplierId: s.string(),
  apiVersion: s.enum(["v1", "v2"]),
  status: s.enum(["healthy", "failing", "isolated"]),
  lastSuccessAt: s.optional(s.string()),
  lastFailure: s.optional(s.object({ at: s.string(), code: s.string(), message: s.string(), callId: s.string() })),
  /** Supplier-feed watermark: invoices issued after this are not yet imported. */
  syncedThrough: s.string(),
  isolatedBy: s.optional(s.string()),
}, { unique: [["supplierId"]] });

// ───────────────────────── Agent operations ─────────────────────────

export const agents = app.collection("agents", {
  /** The FeltKit principal id the agent's sessions carry. */
  key: s.string(),
  name: s.string(),
  purpose: s.string(),
  runtime: s.string(),
  provider: s.string(),
  model: s.string(),
  /** FeltKit roles its sessions are issued with: the platform ceiling of its authority. */
  roles: s.array(s.string()),
  ownerId: s.string(),
  status: s.enum(["active", "suspended", "retired"]),
  statusReason: s.optional(s.string()),
  /** Agents never delegate in CompanyOS 0.1 (no platform delegation primitive; G-03). */
  mayDelegate: s.boolean(),
}, { unique: [["key"]] });

export const assignments = app.collection("assignments", {
  number: s.string(),
  agentKey: s.string(),
  title: s.string(),
  objective: s.string(),
  context: s.string(),
  constraints: s.array(s.string()),
  expectedOutput: s.string(),
  deadline: s.optional(s.string()),
  /** The operator's narrowing of the agent's authority for this work. */
  permittedCapabilities: s.array(s.string()),
  approvalRequired: s.boolean(),
  /** How the outcome is checked independently of the agent ("manual" = a person attests). */
  verifier: s.enum(["reconciliation-clean", "supplier-link-healthy", "departure-complete", "manual"]),
  escalatedTo: s.optional(s.string()),
  status: s.enum(["assigned", "accepted", "running", "waiting-approval", "waiting-intervention", "failed", "recovering", "completed", "verified", "cancelled", "suspended", "reassigned"]),
  assignedBy: s.string(),
  assignedAt: s.string(),
  subject: s.optional(s.object({ collection: s.string(), id: s.string() })),
  /** FeltKit agent task (actions, approvals, verified checkpoints). */
  feltkitTaskId: s.optional(s.string()),
  reassignedFrom: s.optional(s.string()),
  reassignedTo: s.optional(s.string()),
  /** What the agent says it produced. An assertion, never evidence. */
  claim: s.optional(s.string()),
  verification: s.optional(s.object({ ok: s.boolean(), by: s.string(), at: s.string(), method: s.string(), detail: s.record(s.unknown()) })),
  usage: s.optional(s.object({ inputTokens: s.number(), outputTokens: s.number(), costUsd: s.number(), source: s.string() })),
}, { unique: [["number"]], indexes: [{ fields: ["agentKey", "status"] }, { fields: ["status"] }] });

/**
 * Domain history, written in the same transaction as the change it describes, ordered by
 * a FeltDB sequence per subject. `source` separates what the platform recorded from what an
 * agent asserted and what was independently verified.
 */
export const timeline = app.collection("timeline", {
  subject: s.string(),
  seq: s.number(),
  at: s.string(),
  actorId: s.string(),
  actorType: s.string(),
  source: s.enum(["platform", "assertion", "verification", "operator"]),
  kind: s.string(),
  summary: s.string(),
  data: s.optional(s.record(s.unknown())),
}, { unique: [["subject", "seq"]], indexes: [{ fields: ["subject"] }, { fields: ["actorId"] }] });
