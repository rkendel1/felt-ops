/**
 * A stand-in for Northwind Components' invoice API, used by Scenario 4 and the evaluation
 * scripts. It is a TEST SUPPLIER, not part of CompanyOS: CompanyOS reaches it only through
 * its `supplierapi` integration over HTTP.
 *
 *   GET  /health
 *   GET  /v1/invoices?since=ISO                     (retired after cutover: 410 Gone)
 *   GET  /v2/accounts/{account}/invoices?updatedAfter=ISO
 *   POST /admin/invoices  { number, po?, total, issued }   the supplier issues an invoice
 *   POST /admin/cutover                                    retire v1
 *
 * Run standalone: npx tsx tools/supplier-api.ts [port]
 */
import { createServer, type Server } from "node:http";

export interface SupplierInvoice { seq: number; number: string; po?: string; total: number; issued: string }

export function startSupplierApi(port = 0): Promise<{ url: string; server: Server; state: { v1Retired: boolean; invoices: SupplierInvoice[]; requests: string[] } }> {
  const state = { v1Retired: false, invoices: [] as SupplierInvoice[], requests: [] as string[] };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    state.requests.push(`${req.method} ${url.pathname}`);
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method === "GET" && url.pathname === "/health") return send(200, { ok: true, v1: !state.v1Retired });
    if (req.method === "GET" && url.pathname === "/v1/invoices") {
      if (state.v1Retired) return send(410, { error: "gone", message: "API v1 was retired on 2026-11-02. Use /v2/accounts/{account}/invoices." });
      const since = url.searchParams.get("since") ?? "";
      return send(200, { invoices: state.invoices.filter((i) => i.issued > since).map((i) => ({ deliveryId: `nw-v1-${i.seq}`, invoiceNumber: i.number, ...(i.po ? { po: i.po } : {}), total: i.total, issued: i.issued })) });
    }
    const v2 = url.pathname.match(/^\/v2\/accounts\/([^/]+)\/invoices$/);
    if (req.method === "GET" && v2) {
      if (v2[1] !== "meridian") return send(404, { error: "unknown account" });
      const after = url.searchParams.get("updatedAfter") ?? "";
      return send(200, { data: state.invoices.filter((i) => i.issued > after).map((i) => ({ id: `inv_${i.seq}`, number: i.number, ...(i.po ? { purchaseOrder: i.po } : {}), amount: { value: i.total, currency: "USD" }, issuedAt: i.issued })), next: null });
    }
    if (req.method === "POST" && url.pathname.startsWith("/admin/")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (url.pathname === "/admin/cutover") { state.v1Retired = true; return send(200, { v1Retired: true }); }
        if (url.pathname === "/admin/invoices") {
          const i = JSON.parse(body) as Omit<SupplierInvoice, "seq">;
          const inv = { ...i, seq: state.invoices.length + 1 };
          state.invoices.push(inv);
          return send(201, inv);
        }
        send(404, { error: "not found" });
      });
      return;
    }
    send(404, { error: "not found" });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => {
    const addr = server.address() as { port: number };
    resolve({ url: `http://127.0.0.1:${addr.port}`, server, state });
  }));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  const port = Number(process.argv[2] ?? 4010);
  void startSupplierApi(port).then(({ url }) => console.log(`Test supplier API (Northwind) on ${url}`));
}
