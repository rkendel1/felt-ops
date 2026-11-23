// GitHub-API stub for the S4 write path. Counts upstream requests per idempotency key.
// mode=drop: record the PR, then destroy the socket without answering (an unknown outcome).
import { createServer } from "node:http";
const port = Number(process.argv[2] ?? 4555);
const pulls = new Map(); const hits = [];
let mode = "normal";
createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    const key = req.headers["idempotency-key"] ?? null;
    hits.push({ method: req.method, url: req.url, key, auth: req.headers.authorization ? "present" : "absent" });
    if (req.url === "/_stub/mode" && req.method === "POST") { mode = JSON.parse(body).mode; return res.end("{}"); }
    if (req.url === "/_stub/hits") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(hits)); }
    const m = req.url.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls-by-head\/(.+)$/);
    if (m && req.method === "GET") { const pr = [...pulls.values()].find((p) => p.head.ref === decodeURIComponent(m[3])); res.setHeader("content-type", "application/json"); if (!pr) { res.statusCode = 404; return res.end('{"message":"Not Found"}'); } return res.end(JSON.stringify(pr)); }
    if (/^\/repos\/[^/]+\/[^/]+\/pulls$/.test(req.url) && req.method === "POST") {
      const b = JSON.parse(body); const pr = { number: pulls.size + 1, head: { ref: b.head }, base: { ref: b.base }, title: b.title, state: "open" };
      pulls.set(pr.number, pr);
      if (mode === "drop") { req.socket.destroy(); return; }
      res.statusCode = 201; res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(pr));
    }
    res.statusCode = 404; res.end('{"message":"Not Found"}');
  });
}).listen(port, "127.0.0.1", () => console.log(`stub on ${port}`));
