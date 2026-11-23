// Minimal MCP JSON-RPC client over HTTP (same shape as felt-ops agents/runner.ts).
export function client(url, token) {
  let id = 0; let names = null;
  async function rpc(method, params = {}) {
    const res = await fetch(`${url}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { return { httpStatus: res.status, error: { message: text.slice(0, 300) } }; }
    return { httpStatus: res.status, ...body };
  }
  return {
    rpc,
    async call(capability, args = {}) {
      if (!names) {
        const init = await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "phase0-s2", version: "0" } });
        if (init.error) return { ok: false, code: `HTTP_${init.httpStatus}`, message: init.error.message };
        const list = await rpc("tools/list");
        names = new Map((list.result?.tools ?? []).map((t) => [t.name.replace(/_/g, "."), t.name]));
      }
      const r = await rpc("tools/call", { name: names.get(capability) ?? capability, arguments: args });
      if (r.error) return { ok: false, code: `RPC_${r.error.code}`, message: r.error.message };
      const text = r.result?.content?.[0]?.text ?? "";
      if (r.result?.isError) return { ok: false, code: text.match(/^([A-Z_]+):/)?.[1] ?? "ERROR", message: text.slice(0, 300) };
      const sc = r.result?.structuredContent;
      let value = sc && typeof sc === "object" ? (sc.result ?? sc) : text;
      if (typeof value === "string") { try { value = JSON.parse(value); } catch {} }
      return { ok: true, value };
    },
  };
}
