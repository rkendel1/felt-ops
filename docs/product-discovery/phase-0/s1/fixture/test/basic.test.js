import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/index.js";

test("formatMoney formats positive amounts", () => {
  assert.equal(L.formatMoney(123456), "$1,234.56");
  assert.equal(L.formatMoney(5, "EUR"), "€0.05");
});
test("parseMoney parses common forms", () => {
  assert.equal(L.parseMoney("$1,234.50"), 123450);
  assert.equal(L.parseMoney("-$5"), -500);
});
test("parseCSV parses simple rows", () => {
  assert.deepEqual(L.parseCSV("a,b\n1,2\n"), [["a", "b"], ["1", "2"]]);
});
test("addBusinessDays within a week", () => {
  assert.equal(L.addBusinessDays(new Date("2026-11-02T00:00:00Z"), 2).toISOString().slice(0, 10), "2026-11-04");
});
test("LRUCache keeps at most capacity entries", () => {
  const c = new L.LRUCache(2); c.set("a", 1).set("b", 2).set("c", 3);
  assert.equal(c.size, 2); assert.equal(c.has("a"), false);
});
test("compareVersions basic ordering", () => {
  assert.equal(L.compareVersions("1.2.3", "1.2.4"), -1);
  assert.equal(L.compareVersions("2.0.0", "2.0.0"), 0);
});
test("query round trip", () => {
  assert.deepEqual(L.parseQuery("?a=1&b=two%20words"), { a: "1", b: "two words" });
  assert.equal(L.stringifyQuery({ a: "1", b: "x y" }), "a=1&b=x%20y");
});
test("retry succeeds after failures", async () => {
  let n = 0;
  assert.equal(await L.retry(async () => { n++; if (n < 3) throw new Error("no"); return "ok"; }), "ok");
});
test("slugify", () => { assert.equal(L.slugify("Héllo, World!"), "hello-world"); });
test("renderTable", () => {
  assert.equal(L.renderTable([{ a: 1, b: "x" }]), "| a | b |\n| --- | --- |\n| 1 | x |");
});
