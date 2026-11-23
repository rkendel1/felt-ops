/** Parse "a=1&b=two" into { a: "1", b: "two" }. */
export function parseQuery(qs) {
  const out = {};
  for (const part of qs.replace(/^\?/, "").split("&")) {
    if (!part) continue;
    const [k, v = ""] = part.split("=");
    out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}

/** Serialize { a: "1", b: "two" } into "a=1&b=two". */
export function stringifyQuery(obj) {
  return Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}
